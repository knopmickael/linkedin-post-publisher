import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createApp } from '../src/app.js';
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
