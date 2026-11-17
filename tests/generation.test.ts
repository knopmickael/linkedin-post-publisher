import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Agent, MockAgent } from 'undici';
import { createApp } from '../src/app.js';
import { openDb, setSetting } from '../src/db.js';
import { generate } from '../src/generation.js';
import type { Auth } from '../src/auth.js';

const tempBase = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp';
const fakeAuth = { access: async () => ({ access_token: 'not-a-real-token' }) } as unknown as Auth;

test('geração pesquisa o assunto informado ou usa os predefinidos e registra ausência de pauta', async t => {
  const dir = await fs.mkdtemp(path.join(tempBase, 'publisher-subject-'));
  const db = openDb(dir), backingAgent = new Agent();
  // Keep the mock's own dispatcher independent from the application's Agent.
  backingAgent.dispatch = backingAgent.dispatch.bind(backingAgent);
  const dispatcher = new MockAgent({ agent: backingAgent });
  dispatcher.disableNetConnect();
  t.mock.method(Agent.prototype, 'dispatch', dispatcher.dispatch.bind(dispatcher));
  const now = new Date().toISOString();
  const text = 'Uma mudança verificada nas ferramentas de desenvolvimento permite analisar o impacto prático para as equipes. Confira o anúncio original antes de adotar a novidade.';
  const requests: Array<{ instructions: string; subject: string | null }> = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const input = JSON.parse(body.input[0].content);
    requests.push({ instructions: body.instructions, subject: input.subject });
    const result = input.subject === 'Assunto sem cobertura' ? null : {
      sourceId: input.sources[0].id, eventKey: `evento-${requests.length}`, text,
      visualConcept: 'Ilustração editorial técnica.',
      slides: [{ purpose: 'Impacto prático', imagePrompt: 'Blocos de software azuis', overlayText: '', altText: 'Blocos conectados' }],
    };
    const events = [{ type: 'response.output_text.delta', delta: JSON.stringify(result) }, { type: 'response.completed', response: { status: 'completed' } }];
    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  try {
    setSetting(db, 'model', 'test-model');
    db.prepare('DELETE FROM feeds').run();
    db.prepare('INSERT INTO feeds(name,url,priority) VALUES (?,?,?)').run('Fonte simulada', 'https://example.com/feed', 3);
    for (const [index, subject] of [undefined, '   ', '  Novidades em ferramentas de desenvolvimento  ', 'Assunto sem cobertura'].entries()) {
      const url = `https://example.com/article-${index}`;
      dispatcher.get('https://example.com').intercept({ path: '/feed' }).reply(200, `<rss version="2.0"><channel><title>Notícias</title><link>https://example.com</link><description>Fonte simulada</description><item><title>Notícia ${index}</title><link>${url}</link><pubDate>${new Date(now).toUTCString()}</pubDate></item></channel></rss>`, { headers: { 'content-type': 'application/rss+xml' } });
      dispatcher.get('https://example.com').intercept({ path: `/article-${index}` }).reply(200, `<html><head><title>Notícia ${index}</title><meta property="article:published_time" content="${now}"></head><body><article><h1>Notícia ${index}</h1><p>${text.repeat(5)}</p></article></body></html>`, { headers: { 'content-type': 'text/html' } });
      const result = await generate(db, fakeAuth, 1, subject);
      const run = db.prepare('SELECT subject,status,detail FROM runs WHERE id=?').get(result.id) as { subject: string | null; status: string; detail: string };
      const expectedSubject = subject?.trim() || null;
      assert.equal(run.subject, expectedSubject);
      assert.equal(requests.length, index + 1, run.detail);
      assert.equal(requests[index].subject, expectedSubject);
      if (expectedSubject) {
        assert.match(requests[index].instructions, /assunto informado substitui os temas predefinidos/);
        assert.ok(!requests[index].instructions.includes(expectedSubject));
      } else {
        assert.match(requests[index].instructions, /exclusivamente AI .*Cloud, System Design, arquitetura de software, performance e escalabilidade/);
      }
      if (index === 3) {
        assert.equal(result.status, 'sem_pauta');
        assert.match(run.detail, /adequada ao assunto informado/);
        assert.equal(result.postId, undefined);
      } else {
        assert.equal(result.status, 'concluido');
        const post = db.prepare('SELECT edited_text FROM posts WHERE id=?').get(result.postId) as { edited_text: string };
        assert.ok(post.edited_text.endsWith(url));
      }
    }
    assert.equal((db.prepare('SELECT count(*) AS total FROM posts').get() as { total: number }).total, 3);
    dispatcher.assertNoPendingInterceptors();
  } finally { db.close(); await dispatcher.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('API aceita assunto opcional, normaliza espaços e recusa tipo e tamanho inválidos antes da geração', async t => {
  const dir = await fs.mkdtemp(path.join(tempBase, 'publisher-subject-api-'));
  const { app, db, auth } = await createApp({ port: 4317, origin: 'http://127.0.0.1:4317', dataDir: dir, https: undefined });
  t.mock.method(auth, 'access', fakeAuth.access);
  try {
    db.prepare('DELETE FROM feeds').run(); setSetting(db, 'model', 'test-model');
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: { host: '127.0.0.1:4317' } });
    const headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', cookie: `publisher=${session.cookies[0].value}`, 'x-csrf-token': session.json().csrf };
    for (const subject of [42, null, 'a'.repeat(501)]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/generate', headers, payload: { subject } })).statusCode, 400);
    }
    assert.equal((db.prepare('SELECT count(*) AS total FROM runs').get() as { total: number }).total, 0);
    for (const payload of [{}, { subject: '   ' }, { subject: '  Arquitetura de software  ' }]) {
      assert.equal((await app.inject({ method: 'POST', url: '/api/generate', headers, payload })).statusCode, 202);
      const response = await app.inject({ method: 'GET', url: '/api/runs', headers });
      const runs = response.json() as Array<{ subject: string | null; status: string }>;
      assert.ok(runs.some(run => run.subject === (payload.subject?.trim() || null) && run.status === 'sem_pauta'));
    }
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('migração adiciona assunto preservando execuções anteriores e reaplicação não altera dados', async () => {
  const dir = await fs.mkdtemp(path.join(tempBase, 'publisher-subject-migration-'));
  let db = openDb(dir);
  try {
    db.prepare('DELETE FROM migrations WHERE version=3').run();
    db.exec('ALTER TABLE runs DROP COLUMN subject');
    db.prepare('INSERT INTO runs(id,trigger,started_at,status,stage) VALUES (?,?,?,?,?)').run('old-run', 'manual', new Date().toISOString(), 'concluido', 'concluido');
    db.close(); db = openDb(dir);
    assert.deepEqual(db.prepare('SELECT status,subject FROM runs WHERE id=?').get('old-run'), { status: 'concluido', subject: null });
    db.prepare('UPDATE runs SET subject=? WHERE id=?').run('Assunto preservado', 'old-run');
    db.close(); db = openDb(dir);
    assert.deepEqual(db.prepare('SELECT subject FROM runs WHERE id=?').get('old-run'), { subject: 'Assunto preservado' });
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
