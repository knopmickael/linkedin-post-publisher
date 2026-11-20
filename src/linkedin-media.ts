import { createReadStream } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from './errors.js';
import { mediaBytes, type Media } from './posts.js';
import { mediaPath } from './media.js';

type Headers = Record<string, string>;
function uploadUrl(value: unknown) {
  let url: URL;
  try { url = new URL(String(value)); } catch { throw new AppError('Resposta de upload inválida do LinkedIn.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !/(^|\.)(linkedin\.com|licdn\.com)$/.test(url.hostname)) throw new AppError('Resposta de upload inválida do LinkedIn.');
  return url;
}

export async function uploadAsset(headers: Headers, author: string, media: Media, dataDir: string, initialized: (urn: string) => void, renew: () => void) {
  const video = media.kind === 'video';
  const init = await fetch(`https://api.linkedin.com/rest/${video ? 'videos' : 'images'}?action=initializeUpload`, {
    method: 'POST', headers, redirect: 'error', signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ initializeUploadRequest: { owner: author, ...(video ? { fileSizeBytes: media.size, uploadCaptions: false, uploadThumbnail: false } : {}) } }),
  });
  if (!init.ok) throw new AppError(`LinkedIn recusou o início do upload (HTTP ${init.status}). Confira Share on LinkedIn, versão e w_member_social.`, 409);
  const { value } = await init.json() as { value?: { image?: string; uploadUrl?: string; video?: string; uploadToken?: string; uploadInstructions?: Array<{ firstByte: number; lastByte: number; uploadUrl: string }> } };
  if (!video) {
    if (!value?.image?.startsWith('urn:li:image:')) throw new AppError('Resposta de upload inválida do LinkedIn.');
    const url = uploadUrl(value.uploadUrl); initialized(value.image);
    const response = await fetch(url, { method: 'PUT', headers: { Authorization: headers.Authorization, 'Content-Type': media.mime_type }, body: new Uint8Array(await mediaBytes(dataDir, media.path)), signal: AbortSignal.timeout(90000), redirect: 'error' });
    if (!response.ok) throw new AppError(`Upload da imagem ou GIF recusado (HTTP ${response.status}).`, 409);
    return value.image;
  }
  if (!value?.video?.startsWith('urn:li:video:') || typeof value.uploadToken !== 'string' || !Array.isArray(value.uploadInstructions) || !value.uploadInstructions.length || value.uploadInstructions.length > 2000) throw new AppError('Resposta de upload de vídeo inválida do LinkedIn.');
  let next = 0;
  const parts = value.uploadInstructions.map(part => {
    if (!Number.isSafeInteger(part.firstByte) || !Number.isSafeInteger(part.lastByte) || part.firstByte !== next || part.lastByte < part.firstByte || part.lastByte >= media.size) throw new AppError('Intervalos de upload de vídeo inválidos.');
    next = part.lastByte + 1;
    return { ...part, url: uploadUrl(part.uploadUrl) };
  });
  if (next !== media.size) throw new AppError('Intervalos de upload de vídeo incompletos.');
  initialized(value.video);
  const uploadedPartIds: string[] = [];
  for (const part of parts) {
    renew();
    const stream = createReadStream(mediaPath(dataDir, media.path), { start: part.firstByte, end: part.lastByte });
    try {
      const options = { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(part.lastByte - part.firstByte + 1) }, body: stream, duplex: 'half', signal: AbortSignal.timeout(90000), redirect: 'error' } as unknown as RequestInit;
      const response = await fetch(part.url, options);
      if (!response.ok) throw new AppError(`Upload de parte do vídeo recusado (HTTP ${response.status}).`, 409);
      const etag = response.headers.get('etag')?.replace(/^"|"$/g, '');
      if (!etag) throw new AppError('LinkedIn não retornou ETag da parte do vídeo.');
      uploadedPartIds.push(etag);
    } finally { stream.destroy(); }
  }
  renew();
  const finalized = await fetch('https://api.linkedin.com/rest/videos?action=finalizeUpload', { method: 'POST', headers, body: JSON.stringify({ finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken, uploadedPartIds } }), signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!finalized.ok) throw new AppError(`LinkedIn recusou a finalização do vídeo (HTTP ${finalized.status}).`, 409);
  return value.video;
}

export async function waitForVideo(headers: Headers, urn: string, renew: () => void) {
  for (let attempt = 0; attempt < 30; attempt++) {
    renew();
    const response = await fetch(`https://api.linkedin.com/rest/videos/${encodeURIComponent(urn)}`, { method: 'GET', headers, signal: AbortSignal.timeout(30000), redirect: 'error' });
    if (!response.ok) throw new AppError(`Não foi possível consultar o processamento do vídeo (HTTP ${response.status}). Confira as permissões do LinkedIn antes de tentar novamente.`, 409);
    const result = await response.json() as { id?: string; status?: string };
    if (result.id && result.id !== urn) throw new AppError('Status de vídeo incompatível com o upload.');
    if (result.status === 'AVAILABLE') return;
    if (result.status === 'PROCESSING_FAILED') throw new AppError('LinkedIn não conseguiu processar o vídeo. Importe outro MP4.', 409);
    if (result.status !== 'PROCESSING' && result.status !== 'WAITING_UPLOAD') throw new AppError('Status de processamento de vídeo inválido.');
    if (attempt < 29) await delay(2000);
  }
  throw new AppError('Vídeo ainda em processamento no LinkedIn. Aguarde, aprove novamente e tente publicar. O upload finalizado será reaproveitado.', 409);
}
