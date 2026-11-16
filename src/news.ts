import Parser from 'rss-parser';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';
import { publicText } from './http.js';
import { message } from './errors.js';

export type Candidate = { id: string; url: string; originalUrl: string; title: string; date: string; text: string; evidence: string; priority: number };
export function canonicalUrl(input: string) {
  const url = new URL(input); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.toLowerCase(); url.searchParams.sort();
  return url.toString().replace(/\/$/, '');
}
export function recentDate(value: string | undefined, now = Date.now()) { const time = Date.parse(value ?? ''); return Number.isFinite(time) && time <= now && time >= now - 7 * 86400_000; }
export async function collect(db: Db, onProgress: (detail: string) => void) {
  const parser = new Parser(); const candidates: Candidate[] = []; const failures: string[] = [];
  const feeds = db.prepare('SELECT * FROM feeds WHERE enabled=1 ORDER BY priority DESC').all() as Array<{ name: string; url: string; priority: number }>;
  for (const feed of feeds) {
    onProgress(`Coletando ${feed.name}`);
    try {
      const xml = await publicText(feed.url); const parsed = await parser.parseString(xml.text);
      const items = parsed.items.filter(i => i.link && recentDate(i.isoDate ?? i.pubDate)).slice(0, 8);
      for (const item of items) {
        try {
          const originalUrl = new URL(item.link!, feed.url).toString();
          if (db.prepare('SELECT 1 FROM news n JOIN posts p ON p.topic_id=n.topic_id WHERE n.canonical_url=?').get(canonicalUrl(originalUrl))) continue;
          const page = await publicText(originalUrl); const { document } = parseHTML(page.text);
          const metaDate = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ?? document.querySelector('time[datetime]')?.getAttribute('datetime') ?? undefined;
          const date = metaDate ?? item.isoDate ?? item.pubDate;
          if (!recentDate(date)) continue;
          const article = new Readability(document as unknown as Document).parse();
          const text = article?.textContent?.replace(/\s+/g, ' ').trim();
          if (!text || text.length < 250) continue;
          const url = canonicalUrl(page.url);
          if (candidates.some(c => c.url === url)) continue;
          candidates.push({ id: randomUUID(), url, originalUrl, title: article?.title || item.title || 'Notícia', date: new Date(date!).toISOString(), text: text.slice(0, 14000), evidence: metaDate ? 'Data publicada no HTML original' : `Data de publicação do feed ${feed.name}; conteúdo original consultado`, priority: feed.priority });
        } catch { /* A bad article does not prevent other sources from being considered. */ }
      }
    } catch (error) { failures.push(`${feed.name}: ${message(error)}`); }
    if (candidates.length >= 20) break;
  }
  return { candidates, failures, enabledFeeds: feeds.length };
}
