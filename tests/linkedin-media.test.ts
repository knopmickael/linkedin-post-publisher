import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { addMedia, addVideoFile, approve, getPost } from '../src/posts.js';
import { linkedinBody, publish } from '../src/linkedin.js';
import type { Auth } from '../src/auth.js';
import { seedPost } from './helpers.js';
import { animatedGif, mp4Fixture } from './media-fixtures.js';

const base = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp';
const auth = { access: async () => ({ access_token: 'fake', subject: 'member' }) } as unknown as Auth;
async function fixture() {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-linkedin-media-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir);
  const id = seedPost(db); db.prepare("UPDATE posts SET format='video' WHERE id=?").run(id);
  const file = path.join(dir, 'input.mp4'), bytes = mp4Fixture(); await fs.writeFile(file, bytes);
  await addVideoFile(db, dir, id, 1, file); approve(db, id, 2);
  return { db, dir, id, bytes, close: async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); } };
}

test('corpo somente texto omite content e vídeo não recebe altText de imagem', () => {
  assert.ok(!('content' in linkedinBody('urn:li:person:member', 'Texto #Tecnologia', [])));
  const body = linkedinBody('urn:li:person:member', 'Vídeo', [{ id: 'urn:li:video:one', altText: 'Descrição local' }]);
  assert.deepEqual(body.content, { media: { id: 'urn:li:video:one' } });
});

test('publicação MP4 envia partes inclusivas, finaliza, consulta disponibilidade e reaproveita upload', async t => {
  const f = await fixture();
  const stages: string[] = []; let creations = 0;
  t.mock.method(globalThis, 'fetch', async (input: unknown, options?: RequestInit) => {
    const url = String(input); stages.push(url);
    if (url.includes('initializeUpload')) {
      assert.ok(url.includes('/rest/videos')); assert.equal(JSON.parse(String(options?.body)).initializeUploadRequest.fileSizeBytes, f.bytes.length);
      return Response.json({ value: { video: 'urn:li:video:one', uploadToken: 'opaque', uploadInstructions: [{ firstByte: 0, lastByte: 999, uploadUrl: 'https://www.linkedin.com/part-1' }, { firstByte: 1000, lastByte: f.bytes.length - 1, uploadUrl: 'https://www.linkedin.com/part-2' }] } });
    }
    if (url.includes('/part-')) {
      const chunks: Buffer[] = [];
      for await (const chunk of options?.body as unknown as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      const number = url.endsWith('1') ? 1 : 2;
      assert.deepEqual(Buffer.concat(chunks), number === 1 ? f.bytes.subarray(0, 1000) : f.bytes.subarray(1000));
      return new Response(null, { status: 200, headers: { etag: `"etag-${number}"` } });
    }
    if (url.includes('finalizeUpload')) {
      assert.deepEqual(JSON.parse(String(options?.body)), { finalizeUploadRequest: { video: 'urn:li:video:one', uploadToken: 'opaque', uploadedPartIds: ['etag-1', 'etag-2'] } });
      return new Response(null, { status: 200 });
    }
    if (options?.method === 'GET') return Response.json({ id: 'urn:li:video:one', status: 'AVAILABLE' });
    if (url.endsWith('/rest/posts')) {
      assert.deepEqual(JSON.parse(String(options?.body)).content, { media: { id: 'urn:li:video:one' } });
      creations++; return creations === 1 ? new Response(null, { status: 400 }) : new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:video' } });
    }
    throw new Error(`Chamada inesperada ${url}`);
  });
  try {
    await assert.rejects(publish(f.db, auth, f.dir, f.id, 2), /recusou/);
    assert.equal(stages.filter(url => url.includes('initializeUpload')).length, 1);
    assert.ok(stages.findIndex(url => url.includes('finalizeUpload')) < stages.findIndex(url => url.endsWith('/rest/posts')));
    approve(f.db, f.id, 2); await publish(f.db, auth, f.dir, f.id, 2);
    assert.equal(stages.filter(url => url.includes('initializeUpload')).length, 1); assert.equal(creations, 2);
    assert.equal(getPost(f.db, f.id).status, 'publicado');
  } finally { await f.close(); }
});

test('instruções malformadas, ETag ausente, finalize e processamento falhos impedem criar post', async t => {
  for (const failure of ['domain', 'range', 'etag', 'finalize', 'processing', 'permission']) {
    const f = await fixture(); let creations = 0;
    const mock = t.mock.method(globalThis, 'fetch', async (input: unknown, options?: RequestInit) => {
      const url = String(input);
      if (url.includes('initializeUpload')) return Response.json({ value: { video: 'urn:li:video:one', uploadToken: '', uploadInstructions: [{ firstByte: failure === 'range' ? 1 : 0, lastByte: f.bytes.length - 1, uploadUrl: failure === 'domain' ? 'https://attacker.example/upload' : 'https://www.linkedin.com/part' }] } });
      if (url.endsWith('/part')) {
        for await (const _ of options?.body as unknown as AsyncIterable<Buffer>) { /* drain mock upload */ }
        return new Response(null, { status: 200, headers: failure === 'etag' ? {} : { etag: 'part-id' } });
      }
      if (url.includes('finalizeUpload')) return new Response(null, { status: failure === 'finalize' ? 400 : 200 });
      if (options?.method === 'GET') return failure === 'permission' ? new Response(null, { status: 403 }) : Response.json({ status: 'PROCESSING_FAILED' });
      if (url.endsWith('/rest/posts')) { creations++; return new Response(null, { status: 201 }); }
      throw new Error(`Destino indevido ${url}`);
    });
    try {
      const expected: Record<string, RegExp> = { domain: /upload inválida/, range: /Intervalos/, etag: /ETag/, finalize: /finalização/, processing: /processar/, permission: /permissões/ };
      await assert.rejects(publish(f.db, auth, f.dir, f.id, 2), expected[failure]);
      assert.equal(creations, 0, failure); assert.equal((getPost(f.db, f.id).attempts[0] as { outcome: string }).outcome, 'failed');
    } finally { mock.mock.restore(); await f.close(); }
  }
});

test('hash de vídeo alterado depois da aprovação impede qualquer chamada remota', async t => {
  const f = await fixture();
  t.mock.method(globalThis, 'fetch', async () => { assert.fail('Vídeo alterado não pode ser enviado'); });
  try {
    const post = getPost(f.db, f.id); await fs.appendFile(path.join(f.dir, post.media[0].path), Buffer.from([1]));
    await assert.rejects(publish(f.db, auth, f.dir, f.id, 2), /mudou após a aprovação/);
    assert.equal(getPost(f.db, f.id).attempts.length, 0);
  } finally { await f.close(); }
});

test('GIF chega ao LinkedIn animado com MIME correto e timeout de criação fica incerto', async t => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-linkedin-gif-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir);
  let creations = 0;
  const gif = animatedGif();
  t.mock.method(globalThis, 'fetch', async (input: unknown, options?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rest/images')) return Response.json({ value: { image: 'urn:li:image:gif', uploadUrl: 'https://www.linkedin.com/gif' } });
    if (url.endsWith('/gif')) { assert.equal((options?.headers as Record<string, string>)['Content-Type'], 'image/gif'); assert.deepEqual(Buffer.from(options?.body as Uint8Array), gif); return new Response(null, { status: 201 }); }
    creations++; throw new Error('Timeout após envio');
  });
  try {
    const id = seedPost(db); db.prepare("UPDATE posts SET format='gif' WHERE id=?").run(id); await addMedia(db, dir, id, 1, gif, 'Animação'); approve(db, id, 2);
    await assert.rejects(publish(db, auth, dir, id, 2));
    assert.equal((getPost(db, id).attempts[0] as { outcome: string }).outcome, 'unknown');
    await assert.rejects(publish(db, auth, dir, id, 2)); assert.equal(creations, 1);
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
