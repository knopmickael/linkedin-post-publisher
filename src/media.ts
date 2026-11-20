import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createFile, type MP4BoxBuffer } from 'mp4box';
import sharp from 'sharp';
import { AppError } from './errors.js';

export const imageLimit = 20 * 1024 * 1024;
export const videoLimit = 500_000_000;
export function validateVideoSize(size: number) {
  if (size < 75_000 || size > videoLimit) throw new AppError('Vídeo deve ter entre 75 KB e 500 MB.');
}
export function mediaPath(dataDir: string, relative: string) {
  const target = path.resolve(dataDir, relative), root = path.resolve(dataDir, 'media') + path.sep;
  if (!target.startsWith(root)) throw new AppError('Caminho de mídia inválido.');
  return target;
}
export async function fileHash(filePath: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
export const isGif = (bytes: Buffer) => ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'));
export async function inspectGif(bytes: Buffer) {
  if (bytes.length > imageLimit) throw new AppError('Limite de 20 MB por imagem ou GIF.');
  if (bytes.length < 10) throw new AppError('GIF inválido.');
  // libvips reports frame dimensions; the original GIF logical canvas also needs a bound.
  if (bytes.readUInt16LE(6) * bytes.readUInt16LE(8) >= 36_152_320) throw new AppError('GIF deve ter menos de 36.152.320 pixels por quadro.');
  const meta = await sharp(bytes, { animated: true, limitInputPixels: false }).metadata().catch(() => { throw new AppError('GIF inválido.'); });
  const width = meta.width ?? 0, height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height || width * height >= 36_152_320) throw new AppError('GIF deve ter menos de 36.152.320 pixels por quadro.');
  if ((meta.pages ?? 1) > 250) throw new AppError('GIF deve ter no máximo 250 quadros.');
  if (meta.format !== 'gif') throw new AppError('GIF inválido.');
  return { width, height };
}

export async function inspectVideo(filePath: string) {
  const stat = await fs.stat(filePath); validateVideoSize(stat.size);
  const handle = await fs.open(filePath, 'r');
  const parser = createFile(false);
  let parsingError = false;
  parser.onError = () => { parsingError = true; };
  try {
    // Bound container metadata before handing it to the parser; media data is discarded.
    let offset = 0, boxes = 0, metadataBytes = 0, hasMedia = false, hasType = false;
    const mediaRanges: Array<{ start: number; end: number }> = [];
    while (offset < stat.size) {
      const header = Buffer.alloc(16), { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8 || ++boxes > 10000) throw new AppError('Contêiner MP4 inválido ou truncado.');
      let size = header.readUInt32BE(0), headerSize = 8;
      const type = header.subarray(4, 8).toString('ascii');
      if (size === 1) { if (bytesRead < 16) throw new AppError('MP4 truncado.'); size = Number(header.readBigUInt64BE(8)); headerSize = 16; }
      if (size === 0) size = stat.size - offset;
      if (!Number.isSafeInteger(size) || size < headerSize || offset + size > stat.size) throw new AppError('Contêiner MP4 inválido ou truncado.');
      if (type === 'mdat') { hasMedia = size > headerSize || hasMedia; mediaRanges.push({ start: offset + headerSize, end: offset + size }); }
      else { metadataBytes += size; if (metadataBytes > 16 * 1024 * 1024) throw new AppError('Metadados MP4 excedem o limite de 16 MB.'); }
      if (type === 'ftyp' && size >= 16) {
        const brand = Buffer.alloc(4); await handle.read(brand, 0, 4, offset + headerSize);
        hasType = /^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV)$/.test(brand.toString('ascii'));
      }
      offset += size;
    }
    if (!hasType || !hasMedia) throw new AppError('Importe um MP4 válido com trilha de vídeo.');
    for (let start = 0; start < stat.size;) {
      const chunk = Buffer.alloc(Math.min(256 * 1024, stat.size - start));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, start);
      if (!bytesRead) throw new AppError('MP4 truncado.');
      const buffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + bytesRead) as MP4BoxBuffer;
      buffer.fileStart = start; parser.appendBuffer(buffer); start += bytesRead;
      if (parsingError) throw new AppError('Contêiner MP4 inválido.');
    }
    parser.flush();
    if (parsingError || !parser.moov) throw new AppError('Metadados MP4 inválidos.');
    const info = parser.getInfo(), track = info.videoTracks[0];
    if (!track?.video?.width || !track.video.height || !track.nb_samples) throw new AppError('MP4 deve conter uma trilha de vídeo.');
    let videoHasData = false;
    for (const item of info.tracks) for (const sample of parser.getTrackSamplesInfo(item.id)) {
      const end = sample.offset + sample.size;
      if (!Number.isSafeInteger(sample.offset) || !Number.isSafeInteger(sample.size) || !Number.isSafeInteger(end) || sample.size < 0) throw new AppError('Tabela de amostras MP4 inválida.');
      if (!sample.size) continue;
      // Locate the enclosing mdat in logarithmic time, including fragmented files with many boxes.
      let low = 0, high = mediaRanges.length - 1;
      while (low < high) { const middle = Math.ceil((low + high) / 2); if (mediaRanges[middle].start <= sample.offset) low = middle; else high = middle - 1; }
      const range = mediaRanges[low];
      if (!range || sample.offset < range.start || end > range.end) throw new AppError('Amostra MP4 aponta para dados inexistentes fora do mdat.');
      if (item.id === track.id) videoHasData = true;
    }
    if (!videoHasData) throw new AppError('Trilha de vídeo MP4 não contém dados de amostras.');
    const durationMs = Math.round(Math.max(info.duration / info.timescale, track.samples_duration / track.timescale) * 1000);
    if (!Number.isFinite(durationMs) || durationMs < 3000 || durationMs > 1_800_000) throw new AppError('Vídeo deve durar entre 3 segundos e 30 minutos.');
    return { width: track.video.width, height: track.video.height, durationMs, size: stat.size };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Arquivo MP4 inválido ou metadados incompletos.');
  } finally { await handle.close(); parser.stop(); }
}

export function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start < size && end >= start ? { start, end } : null;
}
