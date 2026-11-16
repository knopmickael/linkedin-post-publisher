import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AppError } from './errors.js';
import type { Db } from './db.js';

function dpapi(value: string, decrypt: boolean): Promise<string> {
  const method = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume();
    child.on('error', () => reject(new AppError('Não foi possível acessar o armazenamento protegido do Windows.', 503)));
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(new AppError('Falha no DPAPI. Execute pelo mesmo usuário do Windows.', 503)));
    child.stdin.end(value);
  });
}
export class Vault {
  constructor(private db: Db) {}
  async put(key: string, value: unknown) {
    const raw = Buffer.from(JSON.stringify(value)); let encrypted: string;
    if (process.platform === 'win32') encrypted = `dpapi:${await dpapi(raw.toString('base64'), false)}`;
    else {
      const secret = this.key(); const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', secret, iv);
      const bytes = Buffer.concat([cipher.update(raw), cipher.final()]);
      encrypted = `aes:${Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64')}`;
    }
    this.db.prepare('INSERT INTO secrets VALUES (?,?) ON CONFLICT(key) DO UPDATE SET encrypted=excluded.encrypted').run(key, encrypted);
  }
  async get<T>(key: string): Promise<T | undefined> {
    const row = this.db.prepare('SELECT encrypted FROM secrets WHERE key=?').get(key) as { encrypted: string } | undefined;
    if (!row) return undefined;
    let raw: Buffer;
    if (row.encrypted.startsWith('dpapi:')) {
      if (process.platform !== 'win32') throw new AppError('Credencial protegida por outro sistema.', 503);
      raw = Buffer.from(await dpapi(row.encrypted.slice(6), true), 'base64');
    } else {
      const bytes = Buffer.from(row.encrypted.slice(4), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', this.key(), bytes.subarray(0, 12)); decipher.setAuthTag(bytes.subarray(12, 28));
      raw = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    }
    return JSON.parse(raw.toString('utf8')) as T;
  }
  remove(key: string) { this.db.prepare('DELETE FROM secrets WHERE key=?').run(key); }
  private key() { const key = Buffer.from(process.env.APP_SECRET_KEY ?? '', 'base64'); if (key.length !== 32) throw new AppError('Em desenvolvimento fora do Windows, configure APP_SECRET_KEY com 32 bytes em base64.', 503); return key; }
}
