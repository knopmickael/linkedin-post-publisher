import { lookup } from 'node:dns';
import { Agent, request } from 'undici';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.js';

export function publicAddress(address: string) {
  try { let ip = ipaddr.parse(address); if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) ip = (ip as ipaddr.IPv6).toIPv4Address(); return ip.range() === 'unicast'; } catch { return false; }
}
const agent = new Agent({ connect: { lookup(hostname, options, callback) {
  lookup(hostname, { all: true }, (error, addresses) => {
    if (error) { callback(error, '', 4); return; }
    if (!addresses.length || addresses.some(a => !publicAddress(a.address))) { callback(new Error('Destino privado bloqueado.'), '', 4); return; }
    // Pin the connection to the checked DNS results (including dual-stack lookups).
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
} } });

export async function publicText(input: string, maxBytes = 2_000_000): Promise<{ text: string; url: string }> {
  let url = new URL(input);
  for (let redirect = 0; redirect < 5; redirect++) {
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new AppError('URL pública inválida.');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (ipaddr.isValid(host) && !publicAddress(host)) throw new AppError('Endereço privado bloqueado.');
    const result = await request(url, { dispatcher: agent, signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'LinkedInPostPublisher/0.1 (+local RSS reader)', accept: 'text/html,application/rss+xml,application/atom+xml,application/xml,text/xml' } });
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      await result.body.dump(); const next = result.headers.location; if (!next) throw new AppError('Redirecionamento inválido.'); url = new URL(String(next), url); continue;
    }
    if (result.statusCode !== 200) { await result.body.dump(); throw new AppError(`Fonte retornou HTTP ${result.statusCode}.`); }
    const type = String(result.headers['content-type'] ?? '');
    if (!/(html|xml|text|rss|atom)/i.test(type)) { await result.body.dump(); throw new AppError('Fonte não contém texto/HTML/RSS.'); }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of result.body) { size += chunk.length; if (size > maxBytes) { result.body.destroy(); throw new AppError('Fonte excede limite de leitura.'); } chunks.push(Buffer.from(chunk)); }
    return { text: Buffer.concat(chunks).toString('utf8'), url: url.toString() };
  }
  throw new AppError('Excesso de redirecionamentos.');
}

export async function formRequest(url: string, params: Record<string, string>) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params), signal: AbortSignal.timeout(30000), redirect: 'error' });
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new AppError(`Autenticação recusada (${String(body.error ?? response.status)}). Reconecte a conta ou confira a configuração.`, 400, 'oauth_failed');
  return body;
}
