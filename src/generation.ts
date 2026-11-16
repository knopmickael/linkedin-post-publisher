import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { lease, setting } from './db.js';
import type { Auth } from './auth.js';
import { collect } from './news.js';
import { editorial } from './openai.js';
import { message } from './errors.js';

export function similarEvent(title: string, previous: string) {
  const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').match(/[a-z0-9]+(?:\.[0-9]+)*/g)?.filter(w => w.length > 2) ?? []);
  const a = words(title), b = words(previous); const intersection = [...a].filter(x => b.has(x)).length;
  return intersection >= 4 && intersection / Math.min(a.size, b.size) >= 0.75;
}
export async function generate(db: Db, auth: Auth, count = 1) {
  const lock = lease(db, 'generation', 120); const id = randomUUID();
  const heartbeat = setInterval(() => { try { lock.renew(); } catch { /* Checked before commit. */ } }, 30000);
  try {
    db.prepare('INSERT INTO runs(id,trigger,started_at,status,stage) VALUES (?,?,?,?,?)').run(id, 'manual', new Date().toISOString(), 'executando', 'autenticacao');
    const progress = (stage: string, detail: string) => db.prepare('UPDATE runs SET stage=?,detail=? WHERE id=?').run(stage, detail, id);
    await auth.access('openai');
    const model = setting(db, 'model', '');
    if (!model) throw new Error('Selecione e salve um modelo na aba Configurações.');
    const { candidates, failures, enabledFeeds } = await collect(db, detail => progress('coleta', detail));
    const historyRows = db.prepare('SELECT event_key,title FROM topics WHERE id IN (SELECT topic_id FROM posts)').all() as Array<{ event_key: string; title: string }>;
    const fresh = candidates.filter(c => !historyRows.some(h => similarEvent(c.title, h.title)));
    if (!fresh.length) {
      const detail = !enabledFeeds ? 'Nenhum feed habilitado.' : `Nenhuma pauta verificável e inédita nos últimos sete dias.${failures.length ? ` Falhas: ${failures.join(' | ')}` : ''}`;
      db.prepare('UPDATE runs SET status=?,stage=?,detail=?,finished_at=? WHERE id=?').run(failures.length === enabledFeeds && enabledFeeds > 0 ? 'falha' : 'sem_pauta', 'concluido', detail, new Date().toISOString(), id);
      return { id, status: 'sem_pauta' };
    }
    progress('geracao', `Selecionando entre ${fresh.length} fontes verificadas. Imagens serão importadas manualmente.`);
    const result = await editorial(auth, model, fresh, historyRows.map(h => `${h.event_key}: ${h.title}`), count);
    lock.renew();
    if (!result || historyRows.some(h => h.event_key === result.eventKey)) {
      db.prepare('UPDATE runs SET status=?,stage=?,detail=?,finished_at=? WHERE id=?').run('sem_pauta', 'concluido', 'Seleção não identificou uma pauta inédita adequada.', new Date().toISOString(), id);
      return { id, status: 'sem_pauta' };
    }
    const source = fresh.find(s => s.id === result.sourceId)!; const postId = randomUUID(); const topicId = randomUUID(); const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('INSERT INTO topics VALUES (?,?,?)').run(topicId, result.eventKey, source.title);
      db.prepare('INSERT INTO news VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET topic_id=excluded.topic_id').run(source.id, topicId, source.originalUrl, source.url, source.title, source.date, source.text, source.evidence, now);
      const news = db.prepare('SELECT id FROM news WHERE canonical_url=?').get(source.url) as { id: string };
      db.prepare(`INSERT INTO posts(id,topic_id,news_id,run_id,generated_text,edited_text,format,status,visual_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'rascunho',?,?,?)`).run(postId, topicId, news.id, id, result.text, result.text, count === 1 ? 'single' : 'gallery', JSON.stringify({ ...result, desiredCount: count }), now, now);
      db.prepare('UPDATE runs SET status=?,stage=?,detail=?,post_id=?,finished_at=? WHERE id=?').run('concluido', 'concluido', `Rascunho criado. Importe ${count} imagem(ns).${failures.length ? ` ${failures.length} feed(s) indisponível(is).` : ''}`, postId, now, id);
    })();
    return { id, status: 'concluido', postId };
  } catch (error) {
    db.prepare('UPDATE runs SET status=?,detail=?,finished_at=? WHERE id=?').run('falha', message(error), new Date().toISOString(), id);
    throw error;
  } finally { clearInterval(heartbeat); lock.release(); }
}
