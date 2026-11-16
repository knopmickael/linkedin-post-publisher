import Database from 'better-sqlite3';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './errors.js';

export function openDb(dataDir: string) {
  const db = new Database(path.join(dataDir, 'database.sqlite'));
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON'); db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, encrypted TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS feeds (id INTEGER PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL DEFAULT 1, priority INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, title TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS news (id TEXT PRIMARY KEY, topic_id TEXT REFERENCES topics(id), original_url TEXT NOT NULL, canonical_url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, published_at TEXT NOT NULL, excerpt TEXT NOT NULL, evidence TEXT NOT NULL, collected_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, trigger TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, stage TEXT NOT NULL, detail TEXT, post_id TEXT);
    CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL UNIQUE REFERENCES topics(id), news_id TEXT NOT NULL REFERENCES news(id), run_id TEXT REFERENCES runs(id), generated_text TEXT NOT NULL, edited_text TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('single','gallery')), status TEXT NOT NULL CHECK(status IN ('rascunho','aprovado','publicando','publicado','falha')), revision INTEGER NOT NULL DEFAULT 1, approved_revision INTEGER, visual_json TEXT NOT NULL, linkedin_urn TEXT, published_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), revision INTEGER NOT NULL, snapshot TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(post_id,revision));
    CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), path TEXT NOT NULL, original_path TEXT NOT NULL, position INTEGER NOT NULL, alt_text TEXT NOT NULL, overlay_text TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id), revision INTEGER NOT NULL, snapshot TEXT NOT NULL, stage TEXT NOT NULL, outcome TEXT NOT NULL, http_status INTEGER, linkedin_urn TEXT, detail TEXT, started_at TEXT NOT NULL, finished_at TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_attempt ON attempts(post_id) WHERE outcome IN ('active','unknown');
    CREATE TABLE IF NOT EXISTS uploads (id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL REFERENCES attempts(id), media_id TEXT NOT NULL REFERENCES media(id), asset_urn TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (state TEXT PRIMARY KEY, provider TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS post_history ON posts(created_at DESC);
    INSERT OR IGNORE INTO migrations VALUES (1, datetime('now'));
  `);
  if (!setting(db, 'feedsInitialized', false) && !db.prepare('SELECT 1 FROM feeds LIMIT 1').get()) {
    const add = db.prepare('INSERT INTO feeds(name,url,priority) VALUES (?,?,?)');
    db.transaction(() => {
      add.run('Spring Blog', 'https://spring.io/blog.atom', 3);
      add.run('AWS — novidades', 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', 3);
      add.run('Kubernetes Blog', 'https://kubernetes.io/feed.xml', 3);
      add.run('Inside Java', 'https://inside.java/feed.xml', 3);
      add.run('GitHub Blog — ferramentas', 'https://github.blog/changelog/feed/', 1);
    })();
  }
  setSetting(db, 'feedsInitialized', true);
  return db;
}
export type Db = ReturnType<typeof openDb>;
export function setting<T>(db: Db, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) as T : fallback;
}
export function setSetting(db: Db, key: string, value: unknown) { db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
export function lease(db: Db, name: string, seconds = 120): { renew: () => void; release: () => void } {
  const owner = randomUUID();
  db.transaction(() => {
    db.prepare('DELETE FROM leases WHERE name=? AND expires_at<?').run(name, Date.now());
    const result = db.prepare('INSERT OR IGNORE INTO leases VALUES (?,?,?)').run(name, owner, Date.now() + seconds * 1000);
    if (!result.changes) throw new AppError('Já existe uma operação em andamento. Aguarde.', 409, 'busy');
  })();
  return {
    renew: () => { if (!db.prepare('UPDATE leases SET expires_at=? WHERE name=? AND owner=?').run(Date.now() + seconds * 1000, name, owner).changes) throw new AppError('A exclusividade da operação expirou.', 409); },
    release: () => { db.prepare('DELETE FROM leases WHERE name=? AND owner=?').run(name, owner); },
  };
}
export function recover(db: Db) {
  if (!db.prepare("SELECT 1 FROM leases WHERE name='generation' AND expires_at>?").get(Date.now())) db.prepare("UPDATE runs SET status='falha',detail='Geração interrompida. Inicie uma nova execução manual.',finished_at=? WHERE status='executando'").run(new Date().toISOString());
  // Only recover attempts when their owning publication lease has expired.
  const stale = db.prepare(`SELECT a.* FROM attempts a WHERE outcome='active' AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.name='publish:'||a.post_id AND l.expires_at>?)`).all(Date.now()) as Array<{ id: string; post_id: string; stage: string }>;
  db.transaction(() => { for (const a of stale) {
    const unknown = a.stage === 'creating';
    db.prepare('UPDATE attempts SET outcome=?, detail=?, finished_at=? WHERE id=?').run(unknown ? 'unknown' : 'failed', unknown ? 'Processo interrompido durante envio. Verifique no LinkedIn.' : 'Operação interrompida antes da criação do post.', new Date().toISOString(), a.id);
    db.prepare("UPDATE posts SET status='falha' WHERE id=? AND status='publicando'").run(a.post_id);
  } })();
}
