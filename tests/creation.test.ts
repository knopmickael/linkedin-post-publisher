import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDb, lease } from '../src/db.js';
import { seedPost } from './helpers.js';
import { getPost } from '../src/posts.js';

const base = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp';

test('manual cria rascunho vazio offline durante geração e permite salvar e aprovar somente texto', async t => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-manual-'));
  const { app, db, auth } = await createApp({ port: 4317, origin: 'http://127.0.0.1:4317', dataDir: dir, https: undefined });
  t.mock.method(auth, 'access', async () => { throw new Error('Manual não deve autenticar'); });
  const lock = lease(db, 'generation');
  try {
    const session = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:4317' } });
    const headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', cookie: `publisher=${session.cookies[0].value}`, 'x-csrf-token': session.json().csrf };
    assert.equal((await app.inject({ method: 'POST', url: '/api/posts', headers: { ...headers, 'x-csrf-token': 'wrong' }, payload: {} })).statusCode, 403);
    const created = await app.inject({ method: 'POST', url: '/api/posts', headers, payload: { subject: '  Meu assunto  ' } });
    assert.equal(created.statusCode, 201, created.body);
    const post = created.json();
    assert.equal(post.title, 'Meu assunto'); assert.equal(post.mode, 'manual'); assert.equal(post.status, 'rascunho');
    assert.equal(post.format, 'text'); assert.equal(post.edited_text, ''); assert.equal(post.generated_text, '');
    assert.equal(post.canonical_url, null); assert.equal(post.visual.desiredCount, 0);
    for (const table of ['news', 'topics', 'runs']) assert.equal((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n, 0);
    const save = (revision: number, text: string) => app.inject({ method: 'PATCH', url: `/api/posts/${post.id}`, headers, payload: { revision, text, format: 'text', count: 0 } });
    assert.equal((await save(1, '')).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/api/posts/${post.id}/approve`, headers, payload: { revision: 2 } })).statusCode, 400);
    assert.equal((await save(2, 'Uma publicação escrita manualmente.')).statusCode, 200);
    assert.equal((await save(2, 'Edição obsoleta')).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `/api/posts/${post.id}/approve`, headers, payload: { revision: 3 } })).statusCode, 200);
    const listed = (await app.inject({ url: '/api/posts', headers })).json();
    assert.equal(listed[0].title, 'Meu assunto');
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/posts/${post.id}`, headers, payload: { revision: 3 } })).statusCode, 200);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { lock.release(); await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('migração de criação mantém posts antigos e adiciona fontes sem reconfigurar preferências', async () => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-creation-migration-'));
  let db = openDb(dir);
  try {
    const id = seedPost(db);
    db.prepare("UPDATE posts SET status='aprovado',approved_revision=1 WHERE id=?").run(id);
    db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?)').run('old-revision', id, 1, '{}', new Date().toISOString());
    db.prepare('INSERT INTO media(id,post_id,path,original_path,position,alt_text,sha256,width,height,size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('old-media', id, 'media/old.png', 'media/original.png', 0, 'Arte antiga', 'hash', 800, 600, 100, new Date().toISOString());
    db.prepare('INSERT INTO attempts(id,post_id,revision,snapshot,stage,outcome,started_at) VALUES (?,?,?,?,?,?,?)').run('old-attempt', id, 1, '{}', 'completed', 'failed', new Date().toISOString());
    db.prepare('INSERT INTO uploads VALUES (?,?,?,?,?)').run('old-upload', 'old-attempt', 'old-media', 'urn:li:image:old', 'uploaded');
    // Reconstruct the v3 on-disk schema to exercise an actual upgrade with dependents.
    db.pragma('foreign_keys = OFF');
    db.exec(`CREATE TABLE posts_v3 (id TEXT PRIMARY KEY, topic_id TEXT NOT NULL UNIQUE REFERENCES topics(id), news_id TEXT NOT NULL REFERENCES news(id), run_id TEXT REFERENCES runs(id), generated_text TEXT NOT NULL, edited_text TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('single','gallery')), status TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, approved_revision INTEGER, visual_json TEXT NOT NULL, linkedin_urn TEXT, published_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO posts_v3 SELECT id,topic_id,news_id,run_id,generated_text,edited_text,format,status,revision,approved_revision,visual_json,linkedin_urn,published_url,created_at,updated_at FROM posts;
      DROP TABLE posts; ALTER TABLE posts_v3 RENAME TO posts; CREATE INDEX post_history ON posts(created_at DESC);
      ALTER TABLE runs DROP COLUMN mode;
      ALTER TABLE media DROP COLUMN kind; ALTER TABLE media DROP COLUMN mime_type; ALTER TABLE media DROP COLUMN duration_ms;
      DELETE FROM migrations WHERE version>=4;
      DELETE FROM feeds WHERE priority>=4;`);
    db.pragma('foreign_keys = ON');
    db.close(); db = openDb(dir);
    const post = getPost(db, id);
    assert.equal(post.mode, 'news'); assert.equal(post.title, 'Spring Boot: atualização prática');
    assert.equal(post.approved_revision, 1); assert.equal(post.revision, 1);
    assert.equal(post.media[0].id, 'old-media'); assert.equal(post.media[0].kind, 'image'); assert.equal(post.media[0].mime_type, 'image/png');
    assert.deepEqual(db.prepare('SELECT asset_urn,status FROM uploads WHERE id=?').get('old-upload'), { asset_urn: 'urn:li:image:old', status: 'uploaded' });
    const feeds = db.prepare('SELECT url,priority FROM feeds WHERE priority>=4').all();
    assert.equal(feeds.length, 3);
    db.prepare('UPDATE feeds SET enabled=0,priority=1 WHERE url=?').run('https://www.bleepingcomputer.com/feed/');
    db.close(); db = openDb(dir);
    assert.deepEqual(db.prepare('SELECT enabled,priority FROM feeds WHERE url=?').get('https://www.bleepingcomputer.com/feed/'), { enabled: 0, priority: 1 });
    assert.ok(db.prepare('SELECT 1 FROM revisions WHERE id=?').get('old-revision'));
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
