import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { z } from 'zod';

export function loadConfig() {
  const port = z.coerce.number().int().min(1024).max(65535).parse(process.env.PORT ?? 4317);
  const origin = process.env.APP_ORIGIN ?? `http://127.0.0.1:${port}`;
  const url = new URL(origin);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.origin !== origin) throw new Error('APP_ORIGIN deve ser uma origem local sem caminho.');
  const dataDir = path.resolve(process.env.APP_DATA_DIR ?? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), '.local', 'share'), 'LinkedInPostPublisher'));
  for (const folder of ['', 'media', 'exports', 'backups']) fs.mkdirSync(path.join(dataDir, folder), { recursive: true, mode: 0o700 });
  let https: { cert: Buffer; key: Buffer } | undefined;
  if (url.protocol === 'https:') {
    if (!process.env.TLS_CERT_PATH || !process.env.TLS_KEY_PATH) throw new Error('Configure TLS_CERT_PATH e TLS_KEY_PATH para HTTPS.');
    https = { cert: fs.readFileSync(process.env.TLS_CERT_PATH), key: fs.readFileSync(process.env.TLS_KEY_PATH) };
  } else if (url.protocol !== 'http:') throw new Error('Protocolo inválido.');
  return { port, origin, dataDir, https };
}
export type Config = ReturnType<typeof loadConfig>;
