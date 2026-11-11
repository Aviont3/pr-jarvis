// Coverage scanning: finds news articles that mention a client, using the free
// Google News search feed (no account or API key needed).

const NEWS_BASE = process.env.JARVIS_NEWS_BASE || 'https://news.google.com';

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');
// Google's snippets are HTML that has itself been HTML-escaped, so decode twice.
const stripTags = (s) => decode(decode(s)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const list = (s) => String(s || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

/** Search words for a project: its own terms, else the client name, else the project name. */
export function searchTerms(name, info = {}) {
  const t = list(info.terms);
  if (t.length) return t;
  if (info.client) return [info.client.trim()];
  return [String(name).replace(/^example:\s*/i, '').trim()];
}

/** Google News query: "A" OR "B" -"exclude" when:Nd */
export function buildQuery(name, info = {}, days = 7) {
  const terms = searchTerms(name, info).map((t) => `"${t.replace(/"/g, '')}"`);
  const minus = list(info.exclude).map((t) => `-"${t.replace(/"/g, '')}"`);
  return `${terms.length > 1 ? `(${terms.join(' OR ')})` : terms[0]}${minus.length ? ` ${minus.join(' ')}` : ''} when:${days}d`;
}

/** Parse a Google News RSS feed into articles. */
export function parseFeed(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const tag = (t) => (block.match(new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`)) || [])[1] || '';
    const srcM = block.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/);
    const outlet = srcM ? decode(srcM[2]).trim() : '';
    let title = decode(tag('title')).trim();
    if (outlet && title.endsWith(` - ${outlet}`)) title = title.slice(0, -(outlet.length + 3)).trim();
    const url = decode(tag('link')).trim();
    const date = new Date(decode(tag('pubDate')));
    if (!title || !url) continue;
    items.push({
      title,
      url,
      outlet,
      outletUrl: srcM?.[1] ? decode(srcM[1]) : '',
      publishedAt: Number.isNaN(date.getTime()) ? null : date.toISOString(),
      // Google's snippet is often just the headline + outlet again; only keep it when it adds something
      snippet: ((d) => (d.toLowerCase().startsWith(title.toLowerCase().slice(0, 40)) ? '' : d.slice(0, 280)))(stripTags(tag('description'))),
    });
  }
  return items;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Keep only articles that really mention a search word (and match the watched outlets, if any). */
export function relevant(items, name, info = {}) {
  const terms = searchTerms(name, info).map(norm).filter(Boolean);
  const excludes = list(info.exclude).map(norm).filter(Boolean);
  const outlets = list(info.outlets).map((o) => norm(o.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')));
  return items.filter((it) => {
    const text = norm(`${it.title} ${it.snippet}`);
    if (!terms.some((t) => text.includes(t))) return false;
    if (excludes.some((x) => text.includes(x))) return false;
    if (outlets.length) {
      const src = norm(`${it.outlet} ${it.outletUrl.replace(/^https?:\/\//, '').replace(/^www\./, '')}`);
      if (!outlets.some((o) => src.includes(o))) return false;
    }
    return true;
  });
}

/** Search the news for one project. */
export async function scanNews(name, info = {}, days = 7) {
  const q = buildQuery(name, info, days);
  const url = `${NEWS_BASE}/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh) Jarvis-PR-Tracker' }, signal: AbortSignal.timeout(30000) });
  } catch {
    throw new Error("Couldn't reach Google News. Check your internet connection.");
  }
  if (!res.ok) throw new Error(`Google News returned an error (${res.status}). Jarvis will try again later.`);
  return relevant(parseFeed(await res.text()), name, info);
}
