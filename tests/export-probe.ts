// Child-process probe: a crash in yazl must be observable without crashing the test runner.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.js';
import { seedPost } from './helpers.js';

const base = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp';
const dir = await fsp.mkdtemp(path.join(base, 'publisher-export-probe-'));
await fsp.mkdir(path.join(dir, 'media'));
const { app, db } = await createApp({ port: 4317, origin: 'http://127.0.0.1:4317', dataDir: dir, https: undefined });
const original = fs.createReadStream;
try {
  const id = seedPost(db), mid = randomUUID(), file = path.join(dir, 'media', 'unreadable.png');
  db.prepare('INSERT INTO media(id,post_id,path,original_path,position,alt_text,sha256,width,height,size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(mid, id, 'media/unreadable.png', 'media/unreadable.png', 0, 'Arte', 'hash', 1, 1, 100, new Date().toISOString());
  if (process.argv[2] === 'read') {
    await fsp.writeFile(file, Buffer.alloc(100));
    fs.createReadStream = ((input: fs.PathLike, options?: unknown) => String(input) === file
      ? new Readable({ read() { this.destroy(new Error('Simulated read failure')); } })
      : original(input, options as never)) as typeof fs.createReadStream;
  }
  const session = await app.inject({ url: '/api/session', headers: { host: '127.0.0.1:4317' } });
  const headers = { host: '127.0.0.1:4317', cookie: `publisher=${session.cookies[0].value}` };
  try {
    const response = await app.inject({ url: `/api/posts/${id}/export`, headers });
    // Errors before headers yield 500; read errors after headers terminate the stream.
    assert.ok(response.statusCode >= 500 || !response.rawPayload.includes(Buffer.from('PK\x05\x06')));
  } catch (e) { assert.ok(e instanceof Error); }
  assert.equal((await app.inject({ url: '/api/status', headers })).statusCode, 200);
} finally { fs.createReadStream = original; await app.close(); await fsp.rm(dir, { recursive: true, force: true }); }
