import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { z, ZodError } from 'zod';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { ZipFile } from 'yazl';
import OpenAI from 'openai';
import { openDb, recover, setting, setSetting, lease } from './db.js';
import { Vault } from './vault.js';
import { Auth } from './auth.js';
import type { Config } from './config.js';
import { AppError, message } from './errors.js';
import { models } from './openai.js';
import { generate } from './generation.js';
import { addMedia, approve, deletePost, editable, getPost, mediaBytes, renderImage, replaceMedia, touch } from './posts.js';
import { publish } from './linkedin.js';

const idSchema = z.string().uuid();
const revisionSchema = z.object({ revision: z.number().int().positive() });
const providerSchema = z.enum(['openai', 'linkedin']);
const feedSchema = z.object({ name: z.string().trim().min(1).max(100), url: z.string().url().max(2048).refine(s => ['https:', 'http:'].includes(new URL(s).protocol)), enabled: z.boolean(), priority: z.number().int().min(1).max(5) });

export async function createApp(config: Config) {
  const db = openDb(config.dataDir); recover(db); const vault = new Vault(db); const auth = new Auth(db, vault, config);
  const app = Fastify({ logger: false, bodyLimit: 256000, ...(config.https ? { https: config.https } : {}) });
  await app.register(cookie); await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 3, parts: 4 } });
  const session = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
  const jobs = new Set<Promise<unknown>>();
  const same = (a: unknown, b: string) => typeof a === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const allowedHosts = new Set([new URL(config.origin).host, `127.0.0.1:${config.port}`, `localhost:${config.port}`]);
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer').header('Cache-Control', 'no-store').header('Content-Security-Policy', "default-src 'self'; img-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (!allowedHosts.has(request.headers.host ?? '')) throw new AppError('Host não permitido.', 403);
    const route = request.routeOptions.url ?? request.url;
    if (route.startsWith('/api/') && route !== '/api/session' && !same(request.cookies.publisher, session)) throw new AppError('Sessão local expirada. Recarregue o painel.', 401);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      if (request.headers.origin !== config.origin || !same(request.headers['x-csrf-token'], csrf) || !same(request.cookies.publisher, session)) throw new AppError('Origem ou sessão inválida. Abra o painel na origem configurada.', 403);
    }
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) { reply.code(400).send({ error: 'Dados inválidos.', details: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).slice(0, 8) }); return; }
    const known = error instanceof AppError;
    const statusCode = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 500;
    reply.code(known ? error.status : (statusCode === 413 ? 413 : 500)).send({ error: known ? error.message : statusCode === 413 ? 'Arquivo muito grande. Limite: 20 MB.' : 'Não foi possível concluir a operação. Confira os dados e tente novamente.', code: known ? error.code : 'internal_error' });
  });
  app.get('/api/session', async (_request, reply) => { reply.setCookie('publisher', session, { httpOnly: true, sameSite: 'strict', secure: !!config.https, path: '/' }); return { csrf, origin: config.origin }; });
  app.get('/api/status', async () => ({
    openai: setting(db, 'openaiConnection', { connected: false }), linkedin: setting(db, 'linkedinConnection', { connected: false }),
    capabilities: setting(db, 'linkedinCapabilities', {}), model: setting(db, 'model', ''), linkedinVersion: setting(db, 'linkedinVersion', '202610'),
    imageApiEnabled: setting(db, 'imageApiEnabled', false), imageModel: setting(db, 'imageModel', 'gpt-image-1'),
    hasImageKey: !!db.prepare("SELECT 1 FROM secrets WHERE key='imageApiKey'").get(), hasLinkedinConfig: !!db.prepare("SELECT 1 FROM secrets WHERE key='linkedinConfig'").get(),
    callback: `${config.origin}/auth/linkedin/callback`, dataDir: config.dataDir, timezone: 'America/Sao_Paulo',
  }));
  app.get('/api/posts', async () => { recover(db); return db.prepare('SELECT p.id,p.edited_text,p.format,p.status,p.revision,p.created_at,p.updated_at,n.title,(SELECT id FROM media WHERE post_id=p.id ORDER BY position LIMIT 1) AS thumbnail FROM posts p JOIN news n ON n.id=p.news_id ORDER BY p.created_at DESC').all(); });
  app.get('/api/runs', async () => db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 100').all());
  app.get('/api/posts/:id', async request => { recover(db); return getPost(db, idSchema.parse((request.params as { id: string }).id)); });
  app.delete('/api/posts/:id', async request => {
    const id = idSchema.parse((request.params as { id: string }).id);
    deletePost(db, id, revisionSchema.parse(request.body).revision);
    return { message: 'Publicação removida da aplicação.' };
  });
  app.post('/api/generate', async (request, reply) => {
    const { count } = z.object({ count: z.number().int().min(1).max(20).default(1) }).parse(request.body);
    // Preflight is read-only. The real service still checks all invariants under its lease.
    if (db.prepare("SELECT 1 FROM leases WHERE name='generation' AND expires_at>?").get(Date.now())) throw new AppError('Geração já em andamento.', 409);
    const job = generate(db, auth, count).catch(error => { console.error(JSON.stringify({ event: 'generation_failed', message: message(error) })); }).finally(() => jobs.delete(job)); jobs.add(job);
    reply.code(202); return { message: 'Geração iniciada. Acompanhe na aba Execuções.' };
  });
  app.patch('/api/posts/:id', async request => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = revisionSchema.extend({ text: z.string().trim().min(1).max(3000), format: z.enum(['single', 'gallery']), count: z.number().int().min(1).max(20) }).parse(request.body);
    if ((body.format === 'single' && body.count !== 1) || (body.format === 'gallery' && body.count < 2)) throw new AppError('Quantidade incompatível com o formato.');
    db.transaction(() => { const post = editable(db, id, body.revision); post.visual.desiredCount = body.count;
      db.prepare('UPDATE posts SET edited_text=?,format=?,visual_json=? WHERE id=?').run(body.text, body.format, JSON.stringify(post.visual), id); touch(db, id);
    })(); return getPost(db, id);
  });
  app.post('/api/posts/:id/approve', async request => { const id = idSchema.parse((request.params as { id: string }).id); approve(db, id, revisionSchema.parse(request.body).revision); return getPost(db, id); });
  app.post('/api/posts/:id/publish', async request => { const id = idSchema.parse((request.params as { id: string }).id); return publish(db, auth, config.dataDir, id, revisionSchema.parse(request.body).revision); });
  app.post('/api/posts/:id/resolve', async request => {
    const id = idSchema.parse((request.params as { id: string }).id);
    const body = z.object({ outcome: z.enum(['published', 'not_published']), url: z.string().url().optional(), confirmed: z.literal(true) }).parse(request.body);
    const lock = lease(db, `publish:${id}`, 30);
    try { db.transaction(() => {
      const unknown = db.prepare("SELECT id FROM attempts WHERE post_id=? AND outcome='unknown'").get(id) as { id: string } | undefined;
      if (!unknown) throw new AppError('Não há tentativa incerta para resolver.');
      if (body.outcome === 'published') {
        const url = new URL(body.url ?? ''); if (url.protocol !== 'https:' || !['www.linkedin.com', 'linkedin.com'].includes(url.hostname)) throw new AppError('Informe a URL HTTPS do post encontrado no LinkedIn.');
        db.prepare("UPDATE attempts SET outcome='success',detail='Publicação confirmada manualmente.',finished_at=? WHERE id=?").run(new Date().toISOString(), unknown.id);
        db.prepare("UPDATE posts SET status='publicado',published_url=?,updated_at=? WHERE id=?").run(url.toString(), new Date().toISOString(), id);
      } else {
        db.prepare("UPDATE attempts SET outcome='failed',detail='Usuário conferiu o perfil e confirmou ausência do post.',finished_at=? WHERE id=?").run(new Date().toISOString(), unknown.id);
        db.prepare("UPDATE posts SET status='rascunho',approved_revision=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      }
    })(); } finally { lock.release(); } return getPost(db, id);
  });
  app.post('/api/posts/:id/media', async request => {
    const id = idSchema.parse((request.params as { id: string }).id); const part = await request.file();
    if (!part) throw new AppError('Escolha uma imagem.');
    const bytes = await part.toBuffer(); if (part.file.truncated) throw new AppError('Limite de 20 MB por imagem.');
    const fields = part.fields as Record<string, { value?: unknown }>;
    const revision = z.coerce.number().int().positive().parse(fields.revision?.value);
    const alt = z.string().max(1000).parse(fields.altText?.value ?? '');
    await addMedia(db, config.dataDir, id, revision, bytes, alt); return getPost(db, id);
  });
  app.get('/api/media/:id', async (request, reply) => {
    const row = db.prepare('SELECT path FROM media WHERE id=?').get(idSchema.parse((request.params as { id: string }).id)) as { path: string } | undefined;
    if (!row) throw new AppError('Imagem não encontrada.', 404); reply.type('image/png'); return mediaBytes(config.dataDir, row.path);
  });
  app.post('/api/posts/:id/media/:mediaId/replace', async request => {
    const { id, mediaId } = z.object({ id: idSchema, mediaId: idSchema }).parse(request.params); const part = await request.file();
    if (!part) throw new AppError('Escolha uma imagem.');
    const bytes = await part.toBuffer(); if (part.file.truncated) throw new AppError('Limite de 20 MB por imagem.');
    const fields = part.fields as Record<string, { value?: unknown }>;
    await replaceMedia(db, config.dataDir, id, mediaId, z.coerce.number().int().positive().parse(fields.revision?.value), bytes);
    return getPost(db, id);
  });
  app.patch('/api/posts/:id/media/:mediaId', async request => {
    const { id, mediaId } = z.object({ id: idSchema, mediaId: idSchema }).parse(request.params);
    const body = revisionSchema.extend({ altText: z.string().max(1000), overlayText: z.string().max(140) }).parse(request.body);
    const post = editable(db, id, body.revision); const media = post.media.find(m => m.id === mediaId); if (!media) throw new AppError('Imagem não encontrada.', 404);
    const rendered = await renderImage(await mediaBytes(config.dataDir, media.original_path), body.overlayText); const file = `media/${randomUUID()}.png`;
    await fsp.writeFile(path.join(config.dataDir, file), rendered.data, { flag: 'wx' });
    db.transaction(() => { editable(db, id, body.revision); db.prepare('UPDATE media SET alt_text=?,overlay_text=?,path=?,sha256=?,size=?,width=?,height=? WHERE id=?').run(body.altText, body.overlayText, file, createHash('sha256').update(rendered.data).digest('hex'), rendered.data.length, rendered.info.width, rendered.info.height, mediaId); touch(db, id); })();
    return getPost(db, id);
  });
  app.delete('/api/posts/:id/media/:mediaId', async request => {
    const { id, mediaId } = z.object({ id: idSchema, mediaId: idSchema }).parse(request.params); const { revision } = revisionSchema.parse(request.body);
    db.transaction(() => { editable(db, id, revision); if (!db.prepare('DELETE FROM media WHERE id=? AND post_id=?').run(mediaId, id).changes) throw new AppError('Imagem não encontrada.', 404); touch(db, id); })(); return getPost(db, id);
  });
  app.post('/api/posts/:id/reorder', async request => {
    const id = idSchema.parse((request.params as { id: string }).id); const body = revisionSchema.extend({ ids: z.array(idSchema).min(1).max(20) }).parse(request.body);
    db.transaction(() => { const post = editable(db, id, body.revision); if (new Set(body.ids).size !== post.media.length || body.ids.length !== post.media.length || body.ids.some(mid => !post.media.some(m => m.id === mid))) throw new AppError('Lista de imagens inválida.');
      body.ids.forEach((mid, i) => db.prepare('UPDATE media SET position=? WHERE id=?').run(i, mid)); touch(db, id);
    })(); return getPost(db, id);
  });
  app.get('/api/posts/:id/export', async (request, reply) => {
    const id = idSchema.parse((request.params as { id: string }).id); const post = getPost(db, id); const archive = new ZipFile();
    reply.type('application/zip').header('Content-Disposition', `attachment; filename="post-${id}.zip"`);
    archive.addBuffer(Buffer.from(post.edited_text), 'texto.txt'); archive.addBuffer(Buffer.from(JSON.stringify({ source: post.canonical_url, format: post.format, images: post.media.map((m, i) => ({ file: `${String(i + 1).padStart(2, '0')}.png`, altText: m.alt_text })) }, null, 2)), 'descricao-e-fonte.json');
    for (const [i, media] of post.media.entries()) archive.addBuffer(await mediaBytes(config.dataDir, media.path), `${String(i + 1).padStart(2, '0')}.png`);
    archive.end(); return reply.send(archive.outputStream);
  });
  app.get('/api/feeds', async () => db.prepare('SELECT * FROM feeds ORDER BY priority DESC,name').all());
  app.post('/api/feeds', async request => { const b = feedSchema.parse(request.body); db.prepare('INSERT INTO feeds(name,url,enabled,priority) VALUES (?,?,?,?)').run(b.name, b.url, Number(b.enabled), b.priority); return { ok: true }; });
  app.put('/api/feeds/:id', async request => { const id = z.coerce.number().int().positive().parse((request.params as { id: string }).id); const b = feedSchema.parse(request.body); db.prepare('UPDATE feeds SET name=?,url=?,enabled=?,priority=? WHERE id=?').run(b.name, b.url, Number(b.enabled), b.priority, id); return { ok: true }; });
  app.delete('/api/feeds/:id', async request => { db.prepare('DELETE FROM feeds WHERE id=?').run(z.coerce.number().int().positive().parse((request.params as { id: string }).id)); return { ok: true }; });
  app.post('/api/settings', async request => {
    const b = z.object({ model: z.string().max(100), linkedinVersion: z.string().regex(/^20\d{4}$/), imageApiEnabled: z.boolean(), imageModel: z.string().min(1).max(100), imageKey: z.string().max(512).optional(), linkedinClientId: z.string().max(512).optional(), linkedinClientSecret: z.string().max(512).optional() }).parse(request.body);
    if (b.imageKey) await vault.put('imageApiKey', { key: b.imageKey });
    if (b.imageApiEnabled && !db.prepare("SELECT 1 FROM secrets WHERE key='imageApiKey'").get()) throw new AppError('Informe uma API key da API Platform para habilitar imagens pagas.');
    if (b.linkedinClientId || b.linkedinClientSecret) { if (!b.linkedinClientId || !b.linkedinClientSecret) throw new AppError('Preencha Client ID e Secret juntos.'); await vault.put('linkedinConfig', { clientId: b.linkedinClientId, clientSecret: b.linkedinClientSecret }); }
    for (const key of ['model', 'linkedinVersion', 'imageApiEnabled', 'imageModel'] as const) setSetting(db, key, b[key]);
    return { message: 'Configurações salvas. Credenciais não são devolvidas ao navegador.' };
  });
  app.get('/api/openai/models', async () => models(auth));
  app.post('/api/auth/:provider/start', async request => {
    const provider = providerSchema.parse((request.params as { provider: string }).provider);
    const b = z.object({ fresh: z.boolean().default(false), clientId: z.string().trim().min(1).max(512).optional(), clientSecret: z.string().trim().min(1).max(512).optional(), version: z.string().regex(/^20\d{4}$/).optional() }).parse(request.body ?? {});
    if (provider === 'linkedin') {
      if (b.clientId || b.clientSecret) {
        if (!b.clientId || !b.clientSecret) throw new AppError('Preencha Client ID e Client Secret juntos.');
        await vault.put('linkedinConfig', { clientId: b.clientId, clientSecret: b.clientSecret });
      }
      if (b.version) setSetting(db, 'linkedinVersion', b.version);
    }
    return { url: await auth.start(provider, b.fresh) };
  });
  app.post('/api/auth/:provider/disconnect', async request => auth.disconnect(providerSchema.parse((request.params as { provider: string }).provider)));
  app.get('/auth/linkedin/callback', async (request, reply) => {
    await auth.callback('linkedin', new URL(request.url, config.origin).searchParams); return reply.redirect('/?connected=linkedin');
  });
  app.post('/api/posts/:id/generate-image', async request => {
    const id = idSchema.parse((request.params as { id: string }).id); const b = revisionSchema.extend({ prompt: z.string().trim().min(10).max(4000), paidConsent: z.literal(true), replaceId: idSchema.optional() }).parse(request.body);
    if (!setting(db, 'imageApiEnabled', false)) throw new AppError('Geração paga de imagens está desativada. Use o prompt no ChatGPT e importe o arquivo.');
    const key = await vault.get<{ key: string }>('imageApiKey'); if (!key) throw new AppError('Configure uma API key para imagens.');
    const lock = lease(db, `image:${id}`, 180);
    try {
      const post = editable(db, id, b.revision); if (post.media.length >= 20 && !b.replaceId) throw new AppError('Limite de imagens atingido.');
      if (b.replaceId && !post.media.some(m => m.id === b.replaceId)) throw new AppError('Imagem a substituir não encontrada.');
      const client = new OpenAI({ apiKey: key.key, maxRetries: 0, timeout: 150000 });
      const result = await client.images.generate({ model: setting(db, 'imageModel', 'gpt-image-1'), prompt: b.prompt, n: 1, size: '1024x1024' }, { signal: AbortSignal.timeout(150000) });
      const encoded = result.data?.[0]?.b64_json; if (!encoded) throw new AppError('A API não retornou uma imagem em base64.');
      // Recheck revision after paid request; never overwrite concurrent user edits.
      editable(db, id, b.revision);
      if (b.replaceId) await replaceMedia(db, config.dataDir, id, b.replaceId, b.revision, Buffer.from(encoded, 'base64'));
      else await addMedia(db, config.dataDir, id, b.revision, Buffer.from(encoded, 'base64'));
      return getPost(db, id);
    } finally { lock.release(); }
  });
  const publicDir = path.resolve('public');
  if (fs.existsSync(path.join(publicDir, 'index.html'))) {
    await app.register(staticFiles, { root: publicDir, prefix: '/' });
    app.setNotFoundHandler((request, reply) => { if (request.url.startsWith('/api/') || request.url.startsWith('/auth/')) return reply.code(404).send({ error: 'Rota não encontrada.' }); return reply.sendFile('index.html'); });
  } else app.get('/', async (_req, reply) => reply.type('text/html').send('<h1>Execute npm run build para abrir o painel.</h1>'));
  app.addHook('onClose', async () => { await Promise.allSettled([...jobs]); await auth.close(); db.close(); });
  return { app, db, auth, vault };
}
