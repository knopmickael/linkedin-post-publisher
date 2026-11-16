import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { openDb, lease, recover } from '../src/db.js';
import { approve, editable, addMedia, getPost, touch, renderImage } from '../src/posts.js';
import { canonicalUrl, recentDate } from '../src/news.js';
import { publicAddress, publicText } from '../src/http.js';
import { similarEvent, generate } from '../src/generation.js';
import { publish, linkedinBody, publicationOutcome } from '../src/linkedin.js';
import type { Auth } from '../src/auth.js';
import { Vault } from '../src/vault.js';
import { editorial } from '../src/openai.js';
import { Auth as AuthService } from '../src/auth.js';
import type { Candidate } from '../src/news.js';
import { seedPost } from './helpers.js';

const tempBase = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp';
async function fixture() { const dir = await fs.mkdtemp(path.join(tempBase, 'publisher-test-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir); return { db, dir, close: async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); } }; }
const fakeAuth = { access: async () => ({ access_token: 'not-a-real-token', subject: 'test-member' }) } as unknown as Auth;
async function photo() { return sharp({ create: { width: 800, height: 600, channels: 3, background: '#315cc8' } }).png().toBuffer(); }

test('canonicalização preserva parâmetros significativos e elimina rastreamento', () => {
  assert.equal(canonicalUrl('https://Example.com/release?version=3&utm_source=mail#section'), 'https://example.com/release?version=3');
  assert.ok(recentDate(new Date(Date.now() - 86400_000).toISOString())); assert.ok(!recentDate('not-a-date')); assert.ok(!recentDate(new Date(Date.now() + 86400_000).toISOString()));
  assert.ok(similarEvent('Spring Boot 4.0 release available now', 'Spring Boot 4.0 release available today'));
});
test('SSRF bloqueia loopback, IPv6 mapeado, rede privada e metadados', async () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1']) assert.equal(publicAddress(ip), false);
  assert.equal(publicAddress('8.8.8.8'), true);
  await assert.rejects(publicText('http://127.0.0.1/private'), /privado/);
});
test('lease exclui outra execução, pode ser renovada e recuperada', async () => {
  const f = await fixture(); try { const l = lease(f.db, 'generation'); assert.throws(() => lease(f.db, 'generation'), /andamento/); l.renew(); l.release(); const second = lease(f.db, 'generation'); second.release(); } finally { await f.close(); }
});
test('migração substitui feeds antigos uma vez e preserva histórico e edições posteriores', async () => {
  const f = await fixture(); let db = f.db;
  try {
    const postId = seedPost(db);
    db.prepare('DELETE FROM migrations WHERE version=2').run();
    db.prepare('DELETE FROM feeds').run();
    db.prepare('INSERT INTO feeds(name,url,priority) VALUES (?,?,?)').run('Spring Blog', 'https://spring.io/blog.atom', 3);
    db.prepare('INSERT INTO feeds(name,url,priority) VALUES (?,?,?)').run('Fonte anterior personalizada', 'https://example.com/old-feed', 1);
    db.close(); db = openDb(f.dir);
    assert.equal((db.prepare("SELECT count(*) AS total FROM feeds WHERE enabled=1").get() as { total: number }).total, 10);
    assert.equal((db.prepare("SELECT count(*) AS total FROM feeds WHERE enabled=0").get() as { total: number }).total, 2);
    assert.equal(getPost(db, postId).status, 'rascunho');
    db.prepare("UPDATE feeds SET enabled=0,priority=1 WHERE url='https://openai.com/news/rss.xml'").run();
    db.prepare('DELETE FROM feeds WHERE url=?').run('https://deepmind.google/blog/rss.xml');
    db.close(); db = openDb(f.dir);
    assert.deepEqual(db.prepare("SELECT enabled,priority FROM feeds WHERE url='https://openai.com/news/rss.xml'").get(), { enabled: 0, priority: 1 });
    assert.equal(db.prepare('SELECT 1 FROM feeds WHERE url=?').get('https://deepmind.google/blog/rss.xml'), undefined);
    assert.equal(getPost(db, postId).status, 'rascunho');
  } finally { db.close(); await fs.rm(f.dir, { recursive: true, force: true }); }
});
test('aprovação exige quantidade, alt e revisão; alterações invalidam aprovação', async () => {
  const f = await fixture(); try {
    const id = seedPost(f.db); assert.throws(() => approve(f.db, id, 1), /exige/);
    await addMedia(f.db, f.dir, id, 1, await photo(), 'Imagem técnica azul.');
    assert.throws(() => approve(f.db, id, 1), /mudou/); approve(f.db, id, 2);
    assert.equal(getPost(f.db, id).status, 'aprovado'); assert.ok(f.db.prepare('SELECT 1 FROM revisions WHERE post_id=?').get(id));
    touch(f.db, id); assert.equal(getPost(f.db, id).status, 'rascunho'); assert.equal(getPost(f.db, id).approved_revision, null);
    f.db.prepare("UPDATE posts SET status='publicando' WHERE id=?").run(id); assert.throws(() => editable(f.db, id, 3), /não pode/);
  } finally { await f.close(); }
});
test('PDF é rejeitado e overlay usa composição legível', async () => {
  await assert.rejects(renderImage(Buffer.from('%PDF-1.4\nnot an image')));
  const rendered = await renderImage(await photo(), 'Spring Boot — uma mudança prática'); assert.equal(rendered.info.format, 'png');
  assert.equal(rendered.info.width, 800);
});
test('galeria gera corpo MultiImage, imagem única usa media e status ambíguo não é falha definitiva', () => {
  const one = linkedinBody('urn:li:person:test', 'Texto técnico #Java', [{ id: 'urn:li:image:1', altText: 'um' }]);
  assert.ok('media' in one.content); assert.equal(one.author, 'urn:li:person:test'); assert.match(one.commentary, /\\#Java/);
  const many = linkedinBody('urn:li:person:test', 'Texto', [{ id: 'urn:li:image:1', altText: 'um' }, { id: 'urn:li:image:2', altText: 'dois' }]); assert.ok('multiImage' in many.content);
  assert.equal(publicationOutcome(400), 'failed'); assert.equal(publicationOutcome(500), 'unknown'); assert.equal(publicationOutcome(), 'unknown'); assert.equal(publicationOutcome(201), 'unknown');
});
test('queda após criação bloqueia reenvio e recupera interrupção como resultado incerto', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch;
  try {
    const id = seedPost(f.db); await addMedia(f.db, f.dir, id, 1, await photo(), 'Blocos azuis.'); approve(f.db, id, 2);
    let creations = 0;
    globalThis.fetch = (async input => {
      const url = String(input);
      if (url.includes('initializeUpload')) return new Response(JSON.stringify({ value: { image: 'urn:li:image:fake', uploadUrl: 'https://www.linkedin.com/test-upload' } }), { status: 200 });
      if (url.includes('test-upload')) return new Response('', { status: 201 });
      if (url.endsWith('/rest/posts')) { creations++; throw new Error('Network disconnected after send'); }
      throw new Error('Unexpected request');
    }) as typeof fetch;
    await assert.rejects(publish(f.db, fakeAuth, f.dir, id, 2));
    const post = getPost(f.db, id); assert.equal(post.status, 'falha'); assert.equal((post.attempts[0] as { outcome: string }).outcome, 'unknown');
    assert.throws(() => approve(f.db, id, 2), /incerto/); await assert.rejects(publish(f.db, fakeAuth, f.dir, id, 2)); assert.equal(creations, 1);
    f.db.prepare("UPDATE attempts SET outcome='active',stage='creating' WHERE post_id=?").run(id); recover(f.db); assert.equal((getPost(f.db, id).attempts[0] as { outcome: string }).outcome, 'unknown');
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});
test('publicação simulada preserva snapshot e registra URN, sem chamadas reais', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch;
  try {
    const id = seedPost(f.db); await addMedia(f.db, f.dir, id, 1, await photo(), 'Blocos azuis.'); approve(f.db, id, 2);
    let sent: Record<string, unknown> | undefined;
    globalThis.fetch = (async (input, options) => {
      const url = String(input);
      if (url.includes('initializeUpload')) return new Response(JSON.stringify({ value: { image: 'urn:li:image:fake', uploadUrl: 'https://www.linkedin.com/test-upload' } }), { status: 200 });
      if (url.includes('test-upload')) return new Response('', { status: 201 });
      sent = JSON.parse(String(options?.body)); return new Response('', { status: 201, headers: { 'x-restli-id': 'urn:li:share:fake' } });
    }) as typeof fetch;
    await publish(f.db, fakeAuth, f.dir, id, 2); assert.equal(getPost(f.db, id).status, 'publicado'); assert.equal(sent?.author, 'urn:li:person:test-member'); assert.equal(getPost(f.db, id).linkedin_urn, 'urn:li:share:fake');
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});
test('gerações manuais no mesmo dia são independentes e liberam o lease após falha', async () => {
  const f = await fixture(); let calls = 0;
  const auth = { access: async () => { calls++; throw new Error('Sem sessão de teste'); } } as unknown as Auth;
  try {
    await assert.rejects(generate(f.db, auth), /Sem sessão de teste/);
    await assert.rejects(generate(f.db, auth, 3), /Sem sessão de teste/);
    const runs = f.db.prepare('SELECT id,trigger,status FROM runs').all() as Array<{ id: string; trigger: string; status: string }>;
    assert.equal(calls, 2); assert.equal(runs.length, 2); assert.notEqual(runs[0].id, runs[1].id);
    assert.ok(runs.every(run => run.trigger === 'manual' && run.status === 'falha'));
  } finally { await f.close(); }
});
test('credenciais protegidas fazem roundtrip sem texto aberto no SQLite', async () => {
  const f = await fixture(); try { const vault = new Vault(f.db); await vault.put('test', { value: 'fake-secret-for-test' }); const row = f.db.prepare('SELECT encrypted FROM secrets').get() as { encrypted: string }; assert.ok(!row.encrypted.includes('fake-secret-for-test')); assert.deepEqual(await vault.get('test'), { value: 'fake-secret-for-test' }); vault.remove('test'); assert.equal(await vault.get('test'), undefined); } finally { await f.close(); }
});

test('OpenAI valida stream completo e rejeita limite após texto parcial sem consumir API real', async () => {
  const originalFetch = globalThis.fetch;
  const source: Candidate = { id: randomUUID(), url: 'https://spring.io/release', originalUrl: 'https://spring.io/release', title: 'Spring release', date: new Date().toISOString(), text: 'Fonte técnica verificada.', evidence: 'Teste', priority: 3 };
  const text = JSON.stringify({ sourceId: source.id, eventKey: 'spring-new-release', text: 'Uma atualização prática do Spring altera a forma de configurar aplicações. A mudança ajuda quem desenvolve e opera software a verificar as opções disponíveis.', visualConcept: 'Ilustração técnica editorial.', slides: [{ purpose: 'Mudança', imagePrompt: 'Blocos de software', overlayText: '', altText: 'Blocos azuis' }] });
  function sse(events: object[]) { return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }); }
  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)); assert.equal(body.store, false); assert.equal(body.stream, true); assert.ok(Array.isArray(body.input)); assert.equal(body.temperature, undefined);
      return sse([{ type: 'response.output_text.delta', delta: text }, { type: 'response.completed', response: { status: 'completed' } }]);
    }) as typeof fetch;
    const result = await editorial(fakeAuth, 'test-model', [source], [], 1); assert.ok(result?.text.endsWith(source.url));
    globalThis.fetch = (async () => sse([{ type: 'response.output_text.delta', delta: text }, { type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }])) as typeof fetch;
    await assert.rejects(editorial(fakeAuth, 'test-model', [source], [], 1), /não concluída/);
    globalThis.fetch = (async () => sse([{ type: 'response.output_text.delta', delta: text }])) as typeof fetch;
    await assert.rejects(editorial(fakeAuth, 'test-model', [source], [], 1), /interrompido/);
  } finally { globalThis.fetch = originalFetch; }
});

test('OAuth rejeita state ausente e refresh preserva client e substitui tokens protegidos', async () => {
  const f = await fixture(); const originalFetch = globalThis.fetch;
  try {
    const vault = new Vault(f.db); const auth = new AuthService(f.db, vault, { dataDir: f.dir, port: 4317, origin: 'http://127.0.0.1:4317', https: undefined });
    await assert.rejects(auth.callback('openai', new URLSearchParams('code=fake&state=wrong')), /state inválido/);
    await vault.put('openai', { access_token: 'old', refresh_token: 'old-refresh', id_token: 'old-id-token', expires_at: Date.now() - 1, scope: 'chatgpt.tokens.use.direct', client_id: 'oaiapp_test', subject: 'test-user', label: 'Test user' });
    globalThis.fetch = (async (_url, init) => { const body = init?.body as URLSearchParams; assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('client_id'), 'oaiapp_test'); assert.equal(body.get('resource'), 'https://api.openai.com/v1'); return new Response(JSON.stringify({ access_token: 'new', refresh_token: 'new-refresh', expires_in: 3600, scope: 'chatgpt.tokens.use.direct offline_access' }), { status: 200 }); }) as typeof fetch;
    const tokens = await auth.access('openai'); assert.equal(tokens.access_token, 'new'); assert.equal(tokens.refresh_token, 'new-refresh'); assert.equal(tokens.subject, 'test-user');
    assert.equal((await vault.get<{ refresh_token: string }>('openai'))?.refresh_token, 'new-refresh');
    await auth.close();
  } finally { globalThis.fetch = originalFetch; await f.close(); }
});
