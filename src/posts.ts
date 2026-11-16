import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Db } from './db.js';
import { AppError } from './errors.js';
import type { Editorial } from './openai.js';

export type Post = { id: string; edited_text: string; generated_text: string; format: 'single' | 'gallery'; status: string; revision: number; approved_revision: number | null; visual_json: string; linkedin_urn: string | null; published_url: string | null; title: string; canonical_url: string; published_at: string; evidence: string; created_at: string; updated_at: string };
export type Media = { id: string; post_id: string; path: string; original_path: string; position: number; alt_text: string; overlay_text: string; sha256: string; width: number; height: number; size: number };
export function getPost(db: Db, id: string) {
  const post = db.prepare('SELECT p.*,n.title,n.canonical_url,n.published_at,n.evidence FROM posts p JOIN news n ON n.id=p.news_id WHERE p.id=?').get(id) as Post | undefined;
  if (!post) throw new AppError('Publicação não encontrada.', 404);
  const media = db.prepare('SELECT * FROM media WHERE post_id=? ORDER BY position,id').all(id) as Media[];
  const attempts = db.prepare('SELECT id,revision,stage,outcome,http_status,linkedin_urn,detail,started_at,finished_at FROM attempts WHERE post_id=? ORDER BY started_at DESC').all(id);
  return { ...post, visual: JSON.parse(post.visual_json) as Editorial & { desiredCount: number }, media, attempts };
}
export function editable(db: Db, id: string, revision: number) {
  const post = getPost(db, id);
  if (post.revision !== revision) throw new AppError('O conteúdo mudou em outra operação. Reabra o post.', 409, 'revision_conflict');
  if (['publicando', 'publicado'].includes(post.status)) throw new AppError('Conteúdo em publicação ou publicado não pode ser alterado.', 409);
  if (db.prepare("SELECT 1 FROM attempts WHERE post_id=? AND outcome IN ('active','unknown')").get(id)) throw new AppError('Resolva a tentativa com resultado incerto antes de editar.', 409);
  return post;
}
export function touch(db: Db, id: string) { db.prepare("UPDATE posts SET revision=revision+1,approved_revision=NULL,status='rascunho',updated_at=? WHERE id=?").run(new Date().toISOString(), id); }
export function snapshot(db: Db, id: string) { const p = getPost(db, id); return JSON.stringify({ text: p.edited_text, format: p.format, media: p.media.map(m => ({ id: m.id, sha256: m.sha256, path: m.path, altText: m.alt_text, position: m.position })) }); }
export function approve(db: Db, id: string, revision: number) {
  db.transaction(() => {
    const post = editable(db, id, revision);
    if (!post.edited_text.trim() || post.edited_text.length > 3000) throw new AppError('O texto deve ter entre 1 e 3.000 caracteres.');
    if ((post.format === 'single' && post.media.length !== 1) || (post.format === 'gallery' && (post.media.length < 2 || post.media.length > 20))) throw new AppError('Imagem única exige 1 arquivo; galeria exige de 2 a 20 imagens.');
    if (post.media.length !== post.visual.desiredCount) throw new AppError(`Importe ${post.visual.desiredCount} imagem(ns), conforme a quantidade definida para este post.`);
    if (post.media.some(m => !m.alt_text.trim())) throw new AppError('Preencha o texto alternativo de todas as imagens.');
    const now = new Date().toISOString();
    db.prepare('INSERT INTO revisions VALUES (?,?,?,?,?) ON CONFLICT(post_id,revision) DO NOTHING').run(randomUUID(), id, revision, snapshot(db, id), now);
    db.prepare("UPDATE posts SET status='aprovado',approved_revision=?,updated_at=? WHERE id=?").run(revision, now, id);
  })();
}
const escapeXml = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export async function renderImage(bytes: Buffer, overlay = '') {
  if (bytes.length > 20 * 1024 * 1024) throw new AppError('Limite de 20 MB por imagem.');
  if (bytes.subarray(0, 5).toString() === '%PDF-') throw new AppError('PDF não é aceito. Importe somente imagens JPG, PNG ou WebP.');
  const image = sharp(bytes, { limitInputPixels: 36_152_319, animated: false, failOn: 'warning' });
  const meta = await image.metadata().catch(() => { throw new AppError('Arquivo inválido. Importe uma imagem JPG, PNG ou WebP estática com menos de 36 milhões de pixels.'); });
  if (!['jpeg', 'png', 'webp'].includes(meta.format ?? '') || !meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new AppError('Importe uma imagem estática JPG, PNG ou WebP. PDF e imagens animadas não são aceitos.');
  let pipeline = image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
  const normalized = await pipeline.png().toBuffer({ resolveWithObject: true });
  if (overlay.trim()) {
    const words = overlay.trim().split(/\s+/); const lines: string[] = []; let line = '';
    const fontSize = Math.max(18, Math.floor(normalized.info.width / 24)); const maxChars = 35;
    for (const word of words) { if (word.length > maxChars) throw new AppError('Título na imagem contém palavra longa demais.'); if ((line + ' ' + word).trim().length > maxChars) { lines.push(line); line = word; } else line = (line + ' ' + word).trim(); } if (line) lines.push(line);
    if (lines.length > 4) throw new AppError('Reduza o título na imagem para no máximo quatro linhas.');
    const h = (lines.length + 1.2) * fontSize * 1.3;
    if (h > normalized.info.height * 0.55 || normalized.info.width < 360) throw new AppError('Imagem pequena demais para esse título. Use imagem maior ou menos texto.');
    const svg = `<svg width="${normalized.info.width}" height="${normalized.info.height}"><rect y="${normalized.info.height - h}" width="100%" height="${h}" fill="#0c172a" fill-opacity="0.94"/>${lines.map((l, i) => `<text x="${fontSize}" y="${normalized.info.height - h + fontSize * (1.8 + i * 1.3)}" fill="white" font-size="${fontSize}" font-family="Arial, sans-serif" font-weight="bold">${escapeXml(l)}</text>`).join('')}</svg>`;
    return sharp(normalized.data).composite([{ input: Buffer.from(svg) }]).png().toBuffer({ resolveWithObject: true });
  }
  return normalized;
}
export async function addMedia(db: Db, dataDir: string, postId: string, revision: number, bytes: Buffer, altText = '', overlay = '') {
  const post = editable(db, postId, revision);
  if (post.media.length >= 20) throw new AppError('Limite de 20 imagens por post.');
  const rendered = await renderImage(bytes, overlay); const id = randomUUID();
  const original = `media/${id}-original.png`, file = `media/${id}.png`;
  await fs.writeFile(path.join(dataDir, original), await sharp(bytes).rotate().png().toBuffer(), { flag: 'wx' });
  await fs.writeFile(path.join(dataDir, file), rendered.data, { flag: 'wx' });
  try { db.transaction(() => {
    editable(db, postId, revision);
    db.prepare('INSERT INTO media(id,post_id,path,original_path,position,alt_text,overlay_text,sha256,width,height,size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(id, postId, file, original, post.media.length, altText, overlay, createHash('sha256').update(rendered.data).digest('hex'), rendered.info.width, rendered.info.height, rendered.data.length, new Date().toISOString());
    touch(db, postId);
  })(); } catch (e) { await fs.unlink(path.join(dataDir, original)); await fs.unlink(path.join(dataDir, file)); throw e; }
  return id;
}
export async function mediaBytes(dataDir: string, relative: string) {
  const target = path.resolve(dataDir, relative); const root = path.resolve(dataDir, 'media') + path.sep;
  if (!target.startsWith(root)) throw new AppError('Caminho de mídia inválido.');
  return fs.readFile(target);
}

export async function replaceMedia(db: Db, dataDir: string, postId: string, mediaId: string, revision: number, bytes: Buffer) {
  const post = editable(db, postId, revision); const old = post.media.find(m => m.id === mediaId);
  if (!old) throw new AppError('Imagem a substituir não encontrada.', 404);
  const original = await renderImage(bytes); const rendered = old.overlay_text ? await renderImage(bytes, old.overlay_text) : original;
  const file = `media/${randomUUID()}.png`, originalFile = `media/${randomUUID()}-original.png`;
  await fs.writeFile(path.join(dataDir, file), rendered.data, { flag: 'wx' }); await fs.writeFile(path.join(dataDir, originalFile), original.data, { flag: 'wx' });
  db.transaction(() => {
    editable(db, postId, revision);
    db.prepare('UPDATE media SET path=?,original_path=?,sha256=?,width=?,height=?,size=? WHERE id=? AND post_id=?').run(file, originalFile, createHash('sha256').update(rendered.data).digest('hex'), rendered.info.width, rendered.info.height, rendered.data.length, mediaId, postId);
    touch(db, postId);
  })();
}
