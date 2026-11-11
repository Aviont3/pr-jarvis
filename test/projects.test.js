import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, parseFeed, relevant, searchTerms } from '../coverage.js';
import { buildAgenda, coverageReport } from '../public/js/insights.js';
import { parseCommand } from '../public/js/parser.js';

// Same shape as Google News search RSS
const FEED = `<?xml version="1.0"?><rss><channel>
<item><title>Acme Corp unveils bold new look - TechCrunch</title><link>https://news.google.com/rss/articles/abc</link>
<pubDate>Tue, 10 Nov 2026 14:00:00 GMT</pubDate><description>&lt;a href="x"&gt;Acme Corp unveils bold new look&lt;/a&gt;&amp;nbsp;&lt;font&gt;TechCrunch&lt;/font&gt;</description>
<source url="https://techcrunch.com">TechCrunch</source></item>
<item><title>Acme stock slides on earnings - MarketWatch</title><link>https://news.google.com/rss/articles/def</link>
<pubDate>Mon, 09 Nov 2026 10:00:00 GMT</pubDate><description>Acme Corp stock price falls</description><source url="https://www.marketwatch.com">MarketWatch</source></item>
<item><title>Unrelated roadrunner cartoon retrospective - Vulture</title><link>https://news.google.com/rss/articles/ghi</link>
<pubDate>Sun, 08 Nov 2026 10:00:00 GMT</pubDate><description>Wile E. Coyote</description><source url="https://www.vulture.com">Vulture</source></item>
</channel></rss>`;

test('coverage query and feed parsing', () => {
  assert.deepEqual(searchTerms('Example: Spring Product Launch'), ['Spring Product Launch']);
  assert.deepEqual(searchTerms('Acme Corp Rebrand', { client: 'Acme Corp' }), ['Acme Corp']);
  assert.equal(buildQuery('X', { terms: 'Acme Corp, Jane Doe', exclude: 'stock price' }, 7), '("Acme Corp" OR "Jane Doe") -"stock price" when:7d');
  const items = parseFeed(FEED);
  assert.equal(items.length, 3);
  assert.deepEqual([items[0].title, items[0].outlet, items[0].publishedAt], ['Acme Corp unveils bold new look', 'TechCrunch', '2026-11-10T14:00:00.000Z']);
  assert.equal(items[0].snippet, ''); // just repeated the headline
  assert.equal(items[1].snippet, 'Acme Corp stock price falls');
});

test('only relevant articles are kept', () => {
  const items = parseFeed(FEED);
  assert.deepEqual(relevant(items, 'Acme Corp Rebrand', { client: 'Acme Corp' }).map((i) => i.outlet), ['TechCrunch', 'MarketWatch']);
  assert.deepEqual(relevant(items, 'p', { terms: 'Acme Corp', exclude: 'stock price' }).map((i) => i.outlet), ['TechCrunch']);
  assert.deepEqual(relevant(items, 'p', { terms: 'Acme', outlets: 'marketwatch.com' }).map((i) => i.outlet), ['MarketWatch']);
});

const NOW = new Date(2026, 10, 11, 10);
const state = {
  settings: { userName: 'Avionte' },
  projectInfo: { 'Acme Corp Rebrand': { agendaLastSent: '2026-11-06T15:00:00Z' } },
  entries: [
    { id: 1, project: 'Acme Corp Rebrand', date: '2026-11-05', workDone: 'Old work before last agenda', hours: 1 },
    { id: 2, project: 'Acme Corp Rebrand', date: '2026-11-09', workDone: 'Drafted the rebrand press release', hours: 2 },
    { id: 3, project: 'Acme Corp Rebrand', date: '2026-11-10', workDone: 'Pitched TechCrunch and Axios', hours: 1 },
    { id: 4, project: 'Nike Holiday', date: '2026-11-10', workDone: 'Other client work', hours: 1 },
  ],
  todos: [
    { id: 'a', project: 'Acme Corp Rebrand', text: 'Follow up with Axios', due: '2026-11-13', priority: 'high', done: false, createdAt: '1' },
    { id: 'b', project: 'Acme Corp Rebrand', text: 'Send media list', done: true, doneAt: '2026-11-09T12:00:00Z' },
  ],
};
const cov = [
  { project: 'Acme Corp Rebrand', status: 'kept', outlet: 'TechCrunch', title: 'Acme Corp unveils bold new look', url: 'https://t.co/a', publishedAt: '2026-11-10T14:00:00Z' },
  { project: 'Acme Corp Rebrand', status: 'dismissed', outlet: 'MarketWatch', title: 'Stock slides', publishedAt: '2026-11-09T10:00:00Z' },
  { project: 'Acme Corp Rebrand', status: 'new', outlet: 'Gizmodo', title: 'Not reviewed yet', publishedAt: '2026-11-10T10:00:00Z' },
];

test('agenda is built from work since the last agenda, coverage and open items', () => {
  const a = buildAgenda(state, 'Acme Corp Rebrand', NOW, { coverage: cov, meetingDate: '2026-11-12' });
  assert.equal(a.subject, 'Acme Corp Rebrand · Status & agenda · Thu, Nov 12');
  assert.equal(a.since, '2026-11-06');
  assert.match(a.body, /1\. Updates since Fri, Nov 6\n {3}• Drafted the rebrand press release\n {3}• Pitched TechCrunch and Axios\n {3}• Done: Send media list/);
  assert.doesNotMatch(a.body, /Old work|Other client|Stock slides|Not reviewed yet/);
  assert.match(a.body, /2\. Coverage\n {3}• TechCrunch: “Acme Corp unveils bold new look” \(Tue, Nov 10\)/);
  assert.match(a.body, /3\. Open items & next steps\n {3}• Follow up with Axios \(due Fri, Nov 13\) \[urgent\]/);
  assert.match(a.body, /Thanks,\nAvionte$/);
  assert.match(coverageReport('Acme Corp Rebrand', cov), /1 article\n\n• Tue, Nov 10, 2026 · TechCrunch\n {2}“Acme Corp unveils bold new look”/);
});

test('project and coverage voice commands', () => {
  const p = (s) => parseCommand(s, { projects: ['Acme Corp Rebrand', 'Nike Holiday'], now: NOW });
  assert.deepEqual([p('open the Acme project').intent, p('open the Acme project').project], ['project_open', 'Acme Corp Rebrand']);
  assert.deepEqual([p('prepare the Acme agenda').intent, p('prepare the Acme agenda').tab], ['project_open', 'agenda']);
  assert.deepEqual([p('any new coverage?').intent, p('any new coverage?').project], ['coverage_check', '']);
  const s = p('scan coverage for Nike');
  assert.deepEqual([s.intent, s.project, s.scan], ['coverage_check', 'Nike Holiday', true]);
  assert.equal(p('log 30 minutes pulling coverage for Acme').intent, 'log');
});
