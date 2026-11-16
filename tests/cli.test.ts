import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openDb } from '../src/db.js';
import { seedPost } from './helpers.js';

const execute = promisify(execFile);
test('backup e restauração preservam SQLite e mídias sem sobrescrever destino existente', async () => {
  const base = process.env.TEMP ? path.join(process.env.TEMP, 'opencode') : '/tmp'; const root = await fs.mkdtemp(path.join(base, 'publisher-backup-'));
  const source = path.join(root, 'source'), restored = path.join(root, 'restored');
  await fs.mkdir(path.join(source, 'media'), { recursive: true }); await fs.mkdir(path.join(source, 'backups'));
  const db = openDb(source); const id = seedPost(db); db.close(); await fs.writeFile(path.join(source, 'media', 'preserved-test.txt'), 'immutable media version');
  // Run the same TypeScript CLI before the production build, without dependencies on dist artifacts.
  const cli = (args: string[]) => execute(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { env: { ...process.env, APP_ORIGIN: 'http://127.0.0.1:4317', TLS_CERT_PATH: '', TLS_KEY_PATH: '' } });
  try {
    const backup = await cli(['backup', '--data-dir', source]); const directory = JSON.parse(backup.stdout.trim()).directory;
    await cli(['restore', '--from', directory, '--data-dir', restored]);
    const copy = openDb(restored); assert.ok(copy.prepare('SELECT 1 FROM posts WHERE id=?').get(id)); copy.close();
    assert.equal(await fs.readFile(path.join(restored, 'media', 'preserved-test.txt'), 'utf8'), 'immutable media version');
    await assert.rejects(cli(['restore', '--from', directory, '--data-dir', restored]));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
