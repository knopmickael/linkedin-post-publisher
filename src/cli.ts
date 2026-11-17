import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { openDb, recover } from './db.js';
import { Vault } from './vault.js';
import { Auth } from './auth.js';
import { generate } from './generation.js';
import { message } from './errors.js';

const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'data-dir': { type: 'string' }, count: { type: 'string', default: '1' }, subject: { type: 'string' }, from: { type: 'string' }, help: { type: 'boolean' } } });
if (values['data-dir']) process.env.APP_DATA_DIR = path.resolve(values['data-dir']);
const command = positionals[0];
if (values.help || !command) {
  console.log('Uso: node dist/cli.js <generate|backup|restore|status> [--data-dir PATH] [--count 1..20] [--subject "ASSUNTO"] [--from BACKUP]');
} else {
  const config = loadConfig();
  try {
    if (command === 'restore') {
      if (!values.from) throw new Error('Informe --from com a pasta de backup. Use --data-dir com um destino novo e execute com o servidor parado.');
      const source = path.resolve(values.from), target = config.dataDir;
      try { await fs.access(path.join(target, 'database.sqlite')); throw new Error('O destino já contém um banco. Restaure em uma pasta nova para não sobrescrever seus dados.'); } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error; }
      const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8')) as { format: number };
      if (manifest.format !== 1) throw new Error('Formato de backup inválido.');
      await fs.copyFile(path.join(source, 'database.sqlite'), path.join(target, 'database.sqlite'));
      await fs.cp(path.join(source, 'media'), path.join(target, 'media'), { recursive: true });
      const restored = openDb(target); const result = restored.pragma('integrity_check', { simple: true }); restored.close();
      if (result !== 'ok') throw new Error('Falha de integridade no banco restaurado.');
      console.log(JSON.stringify({ event: 'restored', dataDir: target, note: 'Credenciais DPAPI exigem o mesmo usuário e Windows. Reconecte as integrações se necessário.' }));
    } else {
      const db = openDb(config.dataDir); const auth = new Auth(db, new Vault(db), config);
      try {
        recover(db);
        if (command === 'generate') {
          const count = Number(values.count); if (!Number.isInteger(count) || count < 1 || count > 20) throw new Error('Quantidade de imagens deve estar entre 1 e 20.');
          const result = await generate(db, auth, count, values.subject);
          console.log(JSON.stringify({ event: 'generation_finished', ...result }));
        } else if (command === 'backup') {
          const backupDir = path.join(config.dataDir, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
          await fs.mkdir(backupDir, { recursive: true });
          await db.backup(path.join(backupDir, 'database.sqlite'));
          // Media versions are immutable on disk; copying after the DB snapshot includes every referenced file.
          await fs.cp(path.join(config.dataDir, 'media'), path.join(backupDir, 'media'), { recursive: true });
          await fs.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify({ format: 1, createdAt: new Date().toISOString(), appVersion: '0.1.0', credentials: 'Windows CurrentUser DPAPI; same user required' }, null, 2));
          console.log(JSON.stringify({ event: 'backup_completed', directory: backupDir }));
        } else if (command === 'status') {
          console.log(JSON.stringify({ dataDir: config.dataDir, lastRun: db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT 1').get(), posts: db.prepare('SELECT status,count(*) AS count FROM posts GROUP BY status').all() }, null, 2));
        } else throw new Error(`Comando desconhecido: ${command}`);
      } finally { await auth.close(); db.close(); }
    }
  } catch (error) { console.error(JSON.stringify({ event: 'command_failed', message: message(error) })); process.exitCode = 1; }
}
