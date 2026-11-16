import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { addMedia, approve, touch } from '../src/posts.js';
import { seedPost } from './helpers.js';

test('API protege origem, sessão, revisão e exporta apenas texto/imagens', async () => {
  const base = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp'; const dir = await fs.mkdtemp(path.join(base, 'publisher-api-')); await fs.mkdir(path.join(dir, 'media'));
  const { app, db } = await createApp({ port: 4317, origin: 'http://127.0.0.1:4317', dataDir: dir, https: undefined });
  try {
    const host = { host: '127.0.0.1:4317' };
    assert.equal((await app.inject({ method: 'GET', url: '/api/status', headers: host })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/session', headers: { host: 'attacker.example' } })).statusCode, 403);
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: host }); const csrf = session.json().csrf;
    const cookie = session.cookies.find(c => c.name === 'publisher')!.value;
    const headers = { ...host, cookie: `publisher=${cookie}`, origin: 'http://127.0.0.1:4317', 'x-csrf-token': csrf };
    assert.equal((await app.inject({ method: 'POST', url: '/api/generate', headers: { ...headers, origin: 'https://attacker.example' }, payload: { count: 1 } })).statusCode, 403);
    const id = seedPost(db);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/posts/${id}`, headers, payload: { revision: 1, text: 'Novo texto', format: 'pdf', count: 1 } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/posts/${id}`, headers, payload: { revision: 1, text: 'Texto revisado', format: 'single', count: 1 } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/posts/${id}`, headers, payload: { revision: 1, text: 'Texto obsoleto', format: 'single', count: 1 } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `/api/posts/${id}/approve`, headers, payload: { revision: 2 } })).statusCode, 400);
    const exported = await app.inject({ method: 'GET', url: `/api/posts/${id}/export`, headers }); assert.equal(exported.statusCode, 200); assert.equal(exported.rawPayload.subarray(0, 2).toString(), 'PK');
    const status = (await app.inject({ method: 'GET', url: '/api/status', headers })).json(); assert.equal(status.imageApiEnabled, false); assert.equal(status.openai.connected, false);
    const incomplete = await app.inject({ method: 'POST', url: '/api/auth/linkedin/start', headers, payload: { clientId: 'fake-client' } });
    assert.equal(incomplete.statusCode, 400);
    const connect = await app.inject({ method: 'POST', url: '/api/auth/linkedin/start', headers, payload: { clientId: 'fake-client', clientSecret: 'fake-secret-for-configuration-test', version: '202610' } });
    assert.equal(connect.statusCode, 200);
    const authorization = new URL(connect.json().url); assert.equal(authorization.hostname, 'www.linkedin.com');
    assert.equal(authorization.searchParams.get('client_id'), 'fake-client'); assert.equal(authorization.searchParams.get('scope'), 'openid profile w_member_social');
    assert.ok(!connect.body.includes('fake-secret-for-configuration-test'));
    assert.equal((await app.inject({ method: 'GET', url: '/api/status', headers })).json().hasLinkedinConfig, true);
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/linkedin/start', headers, payload: {} })).statusCode, 200);
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('exclusão aceita somente rascunhos atuais e remove dependências sem perder execuções', async () => {
  const base = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp'; const dir = await fs.mkdtemp(path.join(base, 'publisher-delete-')); await fs.mkdir(path.join(dir, 'media'));
  const { app, db } = await createApp({ port: 4317, origin: 'http://127.0.0.1:4317', dataDir: dir, https: undefined });
  try {
    const host = { host: '127.0.0.1:4317' };
    const session = await app.inject({ method: 'GET', url: '/api/session', headers: host });
    const headers = { ...host, cookie: `publisher=${session.cookies.find(c => c.name === 'publisher')!.value}`, origin: 'http://127.0.0.1:4317', 'x-csrf-token': session.json().csrf };
    const id = seedPost(db), otherId = seedPost(db);
    const remove = (revision: number) => app.inject({ method: 'DELETE', url: `/api/posts/${id}`, headers, payload: { revision } });
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/posts/${id}`, headers: { ...headers, 'x-csrf-token': 'invalid' }, payload: { revision: 1 } })).statusCode, 403);
    for (const status of ['aprovado', 'publicando', 'publicado', 'falha']) {
      db.prepare('UPDATE posts SET status=? WHERE id=?').run(status, id);
      assert.equal((await remove(1)).statusCode, 409);
    }
    db.prepare("UPDATE posts SET status='rascunho' WHERE id=?").run(id);
    const bytes = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#205bdb' } }).png().toBuffer();
    const mediaId = await addMedia(db, dir, id, 1, bytes, 'Imagem de teste');
    approve(db, id, 2); touch(db, id);
    const attemptId = randomUUID(), runId = randomUUID(), now = new Date().toISOString();
    db.prepare('INSERT INTO attempts(id,post_id,revision,snapshot,stage,outcome,started_at) VALUES (?,?,?,?,?,?,?)').run(attemptId, id, 2, '{}', 'upload', 'unknown', now);
    db.prepare('INSERT INTO uploads VALUES (?,?,?,?,?)').run(randomUUID(), attemptId, mediaId, 'urn:li:image:test', 'uploaded');
    assert.equal((await remove(3)).statusCode, 409);
    db.prepare("UPDATE attempts SET outcome='failed' WHERE id=?").run(attemptId);
    db.prepare('INSERT INTO runs(id,trigger,started_at,status,stage,post_id) VALUES (?,?,?,?,?,?)').run(runId, 'manual', now, 'concluido', 'concluido', id);
    assert.equal((await remove(2)).statusCode, 409);
    assert.equal((await remove(3)).statusCode, 200);
    assert.equal((await remove(3)).statusCode, 404);
    for (const table of ['media', 'attempts', 'revisions']) assert.equal(db.prepare(`SELECT 1 FROM ${table} WHERE post_id=?`).get(id), undefined);
    assert.equal(db.prepare('SELECT 1 FROM uploads WHERE attempt_id=?').get(attemptId), undefined);
    const run = db.prepare('SELECT post_id,detail FROM runs WHERE id=?').get(runId) as { post_id: string | null; detail: string };
    assert.equal(run.post_id, null); assert.match(run.detail, /Rascunho removido/);
    assert.equal((await app.inject({ method: 'GET', url: `/api/posts/${id}`, headers })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: `/api/posts/${otherId}`, headers })).statusCode, 200);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal((db.prepare('SELECT count(*) AS total FROM topics').get() as { total: number }).total, 1);
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
