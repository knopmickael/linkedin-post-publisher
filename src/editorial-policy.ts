import { AppError } from './errors.js';

export const defaultEditorialFocus = 'Priorize notícias atuais do mundo da tecnologia, com grande importância para novas vulnerabilidades, falhas críticas, exploração confirmada e correções de segurança. Cubra também software, hardware, sistemas operacionais, serviços, empresas, infraestrutura, AI (inteligência artificial), Cloud, System Design, arquitetura de software, performance e escalabilidade. Notícias de tecnologia e segurança vêm em primeiro lugar; não restrinja a seleção a IA ou a um fornecedor. A prioridade da fonte orienta a seleção, sem substituir relevância e verificação.';

export function composeEditorialText(text: string, hashtags: string[], sourceUrl?: string) {
  const tags = hashtags.map(tag => tag.replace(/^#/, '').normalize('NFC'));
  if (tags.length !== 3 || tags.some(tag => !/^[\p{L}\p{N}_]{1,64}$/u.test(tag)) || new Set(tags.map(tag => tag.toLowerCase())).size !== 3) throw new AppError('O modelo deve sugerir três hashtags diferentes e válidas.');
  // The application supplies verified links and the final hashtag block, never model URLs.
  const body = text.replace(/https?:\/\/\S+/g, '').replace(/(?:\s*#[\p{L}\p{N}_]+)+\s*$/u, '').trim();
  const missing = tags.filter(tag => !body.split(/\s+/).some(word => word.toLowerCase() === `#${tag.toLowerCase()}`));
  const result = body + (missing.length ? `\n\n${missing.map(tag => `#${tag}`).join(' ')}` : '') + (sourceUrl ? `\n\nFonte: ${sourceUrl}` : '');
  if (result.length > 3000) throw new AppError('Texto excede 3.000 caracteres após inclusão das hashtags e da fonte.');
  return result;
}
