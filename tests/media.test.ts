import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { openDb } from '../src/db.js';
import { addMedia, addVideoFile, approve, getPost, replaceMedia } from '../src/posts.js';
import { inspectVideo, validateVideoSize } from '../src/media.js';
import { createApp } from '../src/app.js';
import { seedPost } from './helpers.js';
import { animatedGif, mp4Fixture, multipartFile } from './media-fixtures.js';

const base = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp';

test('GIF animado mantém bytes e quadros na importação e substituição', async () => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-gif-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir);
  try {
    const id = seedPost(db); db.prepare("UPDATE posts SET format='gif' WHERE id=?").run(id);
    const bytes = animatedGif();
    const mediaId = await addMedia(db, dir, id, 1, bytes, 'Animação de teste');
    let post = getPost(db, id);
    assert.equal(post.media[0].kind, 'gif'); assert.equal(post.media[0].mime_type, 'image/gif');
    assert.deepEqual(await fs.readFile(path.join(dir, post.media[0].path)), bytes);
    assert.equal((await sharp(await fs.readFile(path.join(dir, post.media[0].path)), { animated: true }).metadata()).pages, 2);
    await replaceMedia(db, dir, id, mediaId, 2, animatedGif(3));
    post = getPost(db, id); assert.equal((await sharp(await fs.readFile(path.join(dir, post.media[0].path)), { animated: true }).metadata()).pages, 3);
    approve(db, id, 3); assert.equal(getPost(db, id).status, 'aprovado');
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('GIF recusa mais de 250 quadros, overlay e mistura com galeria', async () => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-gif-limit-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir);
  try {
    const id = seedPost(db); db.prepare("UPDATE posts SET format='gif' WHERE id=?").run(id);
    await assert.rejects(addMedia(db, dir, id, 1, animatedGif(251)), /250/);
    const huge = animatedGif(); huge.writeUInt16LE(65535, 6); huge.writeUInt16LE(65535, 8);
    await assert.rejects(addMedia(db, dir, id, 1, huge), /pixels/);
    await assert.rejects(addMedia(db, dir, id, 1, animatedGif(), '', 'Título'), /GIF|anima/i);
    db.prepare("UPDATE posts SET format='gallery' WHERE id=?").run(id);
    await assert.rejects(addMedia(db, dir, id, 1, animatedGif()), /formato|galeria/i);
    assert.equal(getPost(db, id).media.length, 0);
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('MP4 valida tamanho, conteúdo, trilha de vídeo e duração no servidor', async () => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-mp4-')); const file = path.join(dir, 'input.mp4');
  try {
    for (const size of [74999, 500000001]) assert.throws(() => validateVideoSize(size), /75 KB.*500 MB/);
    for (const size of [75000, 500000000]) assert.doesNotThrow(() => validateVideoSize(size));
    await fs.writeFile(file, mp4Fixture());
    const meta = await inspectVideo(file); assert.equal(meta.width, 640); assert.equal(meta.height, 360); assert.equal(meta.durationMs, 4000);
    for (const duration of [2000, 1801000]) { await fs.writeFile(file, mp4Fixture(duration)); await assert.rejects(inspectVideo(file), /3 segundos.*30 minutos/); }
    await fs.writeFile(file, mp4Fixture(4000, false)); await assert.rejects(inspectVideo(file), /trilha de vídeo/);
    await fs.writeFile(file, Buffer.alloc(76000)); await assert.rejects(inspectVideo(file), /MP4/);
    await fs.writeFile(file, mp4Fixture().subarray(0, 100)); await assert.rejects(inspectVideo(file));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('vídeo importado revalida revisão e combinações sem persistir em conflito', async () => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-mp4-add-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir);
  const input = path.join(dir, 'temp.mp4'); await fs.writeFile(input, mp4Fixture());
  try {
    const id = seedPost(db); db.prepare("UPDATE posts SET format='video' WHERE id=?").run(id);
    await addVideoFile(db, dir, id, 1, input);
    const post = getPost(db, id); assert.equal(post.media[0].duration_ms, 4000); assert.equal(post.media[0].kind, 'video');
    approve(db, id, 2);
    await assert.rejects(addVideoFile(db, dir, id, 1, input), /mudou/);
    await assert.rejects(addVideoFile(db, dir, id, 2, input), /únic|arquivo|mídia/i);
    assert.equal(getPost(db, id).media.length, 1);
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('API preserva GIF ao editar descrição e serve MP4 com Range e ZIP de extensão correta', async () => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-media-api-')); await fs.mkdir(path.join(dir, 'media'));
  const { app, db } = await createApp({ port: 4317, origin: 'http://127.0.0.1:4317', dataDir: dir, https: undefined });
  try {
    const session = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:4317' } });
    const headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', cookie: `publisher=${session.cookies[0].value}`, 'x-csrf-token': session.json().csrf };
    const id = seedPost(db); db.prepare("UPDATE posts SET format='gif' WHERE id=?").run(id);
    const gif = animatedGif(), mid = await addMedia(db, dir, id, 1, gif, 'GIF');
    const edit = await app.inject({ method: 'PATCH', url: `/api/posts/${id}/media/${mid}`, headers, payload: { revision: 2, altText: 'Nova descrição', overlayText: '' } });
    assert.equal(edit.statusCode, 200, edit.body);
    const response = await app.inject({ url: `/api/media/${mid}`, headers });
    assert.match(response.headers['content-type']!, /image\/gif/); assert.deepEqual(response.rawPayload, gif);
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/posts/${id}/media/${mid}`, headers, payload: { revision: 3, altText: 'GIF', overlayText: 'Não pode' } })).statusCode, 400);
    const vid = seedPost(db); db.prepare("UPDATE posts SET format='video' WHERE id=?").run(vid);
    const bytes = mp4Fixture(); const form = multipartFile(bytes, 1, 'video/mp4');
    const uploaded = await app.inject({ method: 'POST', url: `/api/posts/${vid}/media`, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${form.boundary}` }, payload: form.payload });
    assert.equal(uploaded.statusCode, 200, uploaded.body);
    const videoId = uploaded.json().media[0].id;
    const range = await app.inject({ url: `/api/media/${videoId}`, headers: { ...headers, range: 'bytes=0-99' } });
    assert.equal(range.statusCode, 206); assert.equal(range.rawPayload.length, 100); assert.deepEqual(range.rawPayload, bytes.subarray(0, 100));
    assert.match(range.headers['content-type']!, /video\/mp4/); assert.equal(range.headers['content-range'], `bytes 0-99/${bytes.length}`);
    assert.equal((await app.inject({ url: `/api/media/${videoId}`, headers: { ...headers, range: 'bytes=-20' } })).rawPayload.length, 20);
    assert.equal((await app.inject({ url: `/api/media/${videoId}`, headers: { ...headers, range: 'bytes=999999-' } })).statusCode, 416);
    const zip = await app.inject({ url: `/api/posts/${vid}/export`, headers }); assert.ok(zip.rawPayload.includes(Buffer.from('01.mp4')));
    const gifZip = await app.inject({ url: `/api/posts/${id}/export`, headers }); assert.ok(gifZip.rawPayload.includes(Buffer.from('01.gif')));
    const invalid = multipartFile(Buffer.alloc(76000), 2, 'video/mp4');
    assert.equal((await app.inject({ method: 'POST', url: `/api/posts/${vid}/media/${videoId}/replace`, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${invalid.boundary}` }, payload: invalid.payload })).statusCode, 400);
    assert.equal(getPost(db, vid).media[0].sha256, uploaded.json().media[0].sha256);
    assert.deepEqual(await fs.readdir(path.join(dir, 'media')).then(files => files.filter(name => name.endsWith('.upload'))), []);
    const truncated = form.payload.subarray(0, form.payload.length - 100);
    assert.ok((await app.inject({ method: 'POST', url: `/api/posts/${vid}/media`, headers: { ...headers, 'content-type': `multipart/form-data; boundary=${form.boundary}` }, payload: truncated })).statusCode >= 400);
    assert.deepEqual(await fs.readdir(path.join(dir, 'media')).then(files => files.filter(name => name.endsWith('.upload'))), []);
  } finally { await app.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('revisão alterada enquanto vídeo é inspecionado não deixa arquivo órfão', async t => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-mp4-race-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir);
  const input = path.join(dir, 'temp.mp4'); await fs.writeFile(input, mp4Fixture());
  try {
    const id = seedPost(db); db.prepare("UPDATE posts SET format='video' WHERE id=?").run(id);
    const copy = fs.copyFile.bind(fs);
    t.mock.method(fs, 'copyFile', async (...args: Parameters<typeof fs.copyFile>) => {
      await copy(...args); db.prepare('UPDATE posts SET revision=2 WHERE id=?').run(id);
    });
    await assert.rejects(addVideoFile(db, dir, id, 1, input), /mudou/);
    assert.equal(getPost(db, id).media.length, 0); assert.deepEqual(await fs.readdir(path.join(dir, 'media')), []);
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('MP4 com amostra fora do mdat é recusado sem arquivo final ou registro', async () => {
  const dir = await fs.mkdtemp(path.join(base, 'publisher-mp4-sample-')); await fs.mkdir(path.join(dir, 'media')); const db = openDb(dir);
  const input = path.join(dir, 'temp.mp4');
  try {
    const bytes = mp4Fixture(), trun = bytes.indexOf(Buffer.from('trun'));
    assert.ok(trun > 0);
    // FullBox flags + sample_count + data_offset + first_sample_flags + sample_duration precede size.
    const flags = bytes.readUInt32BE(trun + 4) & 0xffffff;
    let sizeOffset = trun + 12 + ((flags & 1) ? 4 : 0) + ((flags & 4) ? 4 : 0) + ((flags & 0x100) ? 4 : 0);
    assert.ok(flags & 0x200); bytes.writeUInt32BE(99_999_999, sizeOffset);
    await fs.writeFile(input, bytes);
    const id = seedPost(db); db.prepare("UPDATE posts SET format='video' WHERE id=?").run(id);
    await assert.rejects(addVideoFile(db, dir, id, 1, input), /amostra|mdat/i);
    assert.equal(getPost(db, id).media.length, 0); assert.deepEqual(await fs.readdir(path.join(dir, 'media')), []);
  } finally { db.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
