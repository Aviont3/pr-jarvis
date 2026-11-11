// Jarvis command parser. Rule based, no AI.
// Turns a spoken or typed sentence into an intent plus extracted fields.
// It is pure (no DOM and no storage) so it can be unit-tested in Node.

import { isoDate, addDays, startOfWeek } from './util.js';

// ---------------------------------------------------------------- defaults

export const DEFAULT_CATEGORY_KEYWORDS = {
  'Media Relations & Pitching': ['pitch', 'pitched', 'pitching', 'journalist', 'journalists', 'reporter', 'reporters', 'editor', 'editors', 'media list', 'outreach', 'interview', 'exclusive', 'embargo', 'producer', 'booked', 'segment'],
  'Press Releases & Writing': ['press release', 'release', 'draft', 'drafted', 'drafting', 'wrote', 'write', 'writing', 'edited', 'editing', 'copy', 'blog', 'byline', 'op-ed', 'boilerplate', 'fact sheet', 'media kit', 'talking points', 'proofread', 'q&a doc'],
  'Social Media': ['social', 'instagram', 'linkedin', 'tiktok', 'twitter', 'facebook', 'threads', 'caption', 'captions', 'influencer', 'influencers', 'content calendar', 'post', 'posts', 'posted', 'reel', 'reels'],
  'Client Communication': ['client call', 'client meeting', 'client email', 'emailed the client', 'client update', 'check-in with', 'call with', 'client'],
  'Events': ['event', 'events', 'venue', 'rsvp', 'rsvps', 'press conference', 'panel', 'activation', 'launch party', 'run of show', 'guest list'],
  'Crisis Communications': ['crisis', 'holding statement', 'incident', 'backlash', 'response plan', 'damage control', 'reactive statement'],
  'Media Monitoring & Research': ['monitoring', 'clips', 'clip', 'coverage', 'research', 'researched', 'mentions', 'news scan', 'competitor', 'competitors', 'media scan', 'google alerts'],
  'Reporting & Analytics': ['report', 'reporting', 'analytics', 'metrics', 'recap', 'kpi', 'kpis', 'results', 'impressions', 'dashboard'],
  'Strategy & Planning': ['strategy', 'plan', 'planning', 'brainstorm', 'brainstormed', 'campaign', 'proposal', 'messaging', 'positioning', 'roadmap', 'pr plan'],
  'Internal Meetings': ['meeting', 'standup', 'stand-up', 'team sync', 'sync', '1:1', 'one on one', 'huddle', 'all hands', 'staff meeting'],
  'Admin': ['admin', 'timesheet', 'timesheets', 'invoice', 'invoices', 'expenses', 'inbox', 'filing', 'scheduling', 'calendar'],
};

// ---------------------------------------------------------------- numbers & durations

const WORD_NUM = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, 'twenty-five': 25, thirty: 30, forty: 40,
  'forty-five': 45, fifty: 50, sixty: 60, ninety: 90,
};
const NUM = `(\\d+(?:\\.\\d+)?|${Object.keys(WORD_NUM).sort((a, b) => b.length - a.length).join('|')})`;
const toNum = (s) => (s in WORD_NUM ? WORD_NUM[s] : parseFloat(s));
const HR = '(?:hours?|hrs?|h)';
const MIN = '(?:minutes?|mins?|m)';

/**
 * Find a duration in text. Returns { hours, raw } or null.
 * Handles: "45 minutes", "1.5 hours", "an hour and a half", "half an hour",
 * "2 hours 15 minutes", "1h30", "1 hr and 20 min", "90 mins".
 */
export function parseDuration(text) {
  const t = text.toLowerCase();
  const tries = [
    [new RegExp(`\\b${NUM}\\s*${HR}\\s*(?:and\\s*)?${NUM}\\s*${MIN}\\b`), (m) => toNum(m[1]) + toNum(m[2]) / 60],
    [/\b(\d+)h(\d{1,2})\b/, (m) => +m[1] + +m[2] / 60],
    [new RegExp(`\\b${NUM}\\s+and\\s+a\\s+half\\s+${HR}\\b`), (m) => toNum(m[1]) + 0.5],
    [new RegExp(`\\b${NUM}\\s*${HR}\\s+and\\s+a\\s+half\\b`), (m) => toNum(m[1]) + 0.5],
    [/\b(?:a\s+)?half\s+(?:an\s+)?hour\b/, () => 0.5],
    [/\b(?:a\s+)?quarter\s+(?:of\s+)?(?:an\s+)?hour\b/, () => 0.25],
    [/\bthree\s+quarters\s+of\s+an\s+hour\b/, () => 0.75],
    [new RegExp(`\\b${NUM}\\s*${HR}\\b`), (m) => toNum(m[1])],
    [new RegExp(`\\b${NUM}\\s*${MIN}\\b`), (m) => toNum(m[1]) / 60],
  ];
  for (const [re, fn] of tries) {
    const m = t.match(re);
    if (m) {
      const hours = Math.round(fn(m) * 100) / 100;
      if (hours > 0 && hours <= 24) {
        return { hours, raw: text.substr(m.index, m[0].length) };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- dates

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Find a due date in text. Returns { due: 'YYYY-MM-DD', raw } or null. */
export function parseDue(text, now = new Date()) {
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lead = '(?:\\s*\\b(?:by|on|due|before|for)\\s+)?';
  const tries = [
    [new RegExp(`${lead}\\b(?:today|tonight|this (?:afternoon|evening|morning))\\b`), () => today],
    [new RegExp(`${lead}\\btomorrow\\b`), () => addDays(today, 1)],
    [new RegExp(`${lead}\\b(?:the\\s+)?end of (?:the |this )?week\\b`), () => addDays(startOfWeek(today), 4)],
    [new RegExp(`${lead}\\bnext week\\b`), () => addDays(startOfWeek(today), 7)],
    [new RegExp(`${lead}\\bin (\\d+|${Object.keys(WORD_NUM).join('|')}) days?\\b`), (m) => addDays(today, toNum(m[1]))],
    [new RegExp(`${lead}\\b(?:(this|next)\\s+)?(${WEEKDAYS.join('|')})\\b`), (m) => {
      const target = WEEKDAYS.indexOf(m[2]);
      // "next friday" = the friday of next week (Mon-Sun weeks)
      if (m[1] === 'next') return addDays(startOfWeek(today), 7 + ((target + 6) % 7));
      let diff = (target - today.getDay() + 7) % 7;
      if (diff === 0) diff = 7; // "friday" said on a friday means next friday
      return addDays(today, diff);
    }],
    [new RegExp(`${lead}\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?\\b`), (m) => {
      let y = m[3] ? +m[3] : today.getFullYear();
      if (y < 100) y += 2000;
      let d = new Date(y, +m[1] - 1, +m[2]);
      if (!m[3] && d < today) d = new Date(y + 1, +m[1] - 1, +m[2]);
      return d;
    }],
  ];
  for (const [re, fn] of tries) {
    const m = t.match(re);
    if (m) return { due: isoDate(fn(m)), raw: text.substr(m.index, m[0].length) };
  }
  return null;
}

export function parsePriority(text) {
  const t = text.toLowerCase();
  const hi = t.match(/[,\s]*\b(urgent(?:ly)?|asap|high priority|top priority|important)\b/);
  if (hi) return { priority: 'high', raw: text.substr(hi.index, hi[0].length) };
  const lo = t.match(/[,\s]*\b(low priority|whenever|no rush)\b/);
  if (lo) return { priority: 'low', raw: text.substr(lo.index, lo[0].length) };
  return null;
}

// ---------------------------------------------------------------- projects & categories

const STOP = new Set(['the', 'and', 'for', 'with', 'example', 'project', 'client', 'campaign', 'launch', 'new', 'pr', 'inc', 'llc', 'co']);
const cleanProjectName = (p) => p.replace(/^example:\s*/i, '').trim();
const words = (s) => s.toLowerCase().match(/[a-z0-9&']+/g) || [];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The contiguous run of words in text that all belong to the project name,
// e.g. "Spring Launch" for project "Spring Product Launch".
function spanFor(text, nameWords) {
  const set = new Set(nameWords);
  const re = /[A-Za-z0-9&']+/g;
  let m; let run = null; let bestRun = null;
  while ((m = re.exec(text))) {
    const w = m[0].toLowerCase();
    if (set.has(w)) {
      if (run && text.slice(run.end, m.index).trim() === '') run.end = m.index + m[0].length;
      else run = { start: m.index, end: m.index + m[0].length, sig: 0 };
      if (w.length >= 3 && !STOP.has(w)) run.sig += 1;
      if (run.sig && (!bestRun || run.end - run.start > bestRun.end - bestRun.start)) bestRun = { ...run };
    } else run = null;
  }
  return bestRun ? text.slice(bestRun.start, bestRun.end) : null;
}

/**
 * Best project match for text. Full-name mentions win; otherwise
 * distinctive words ("Acme" for "Acme Corp Rebrand"). Returns { project, raw } or null.
 */
export function matchProject(text, projects = []) {
  const t = text.toLowerCase();
  let best = null;
  for (const p of projects) {
    if (!p) continue;
    const name = cleanProjectName(p).toLowerCase();
    if (!name) continue;
    const idx = t.search(new RegExp(`\\b${escapeRe(name)}\\b`));
    if (idx >= 0) {
      const score = 1000 + name.length;
      if (!best || score > best.score) best = { project: p, score, raw: text.substr(idx, name.length) };
      continue;
    }
    const sig = words(name).filter((w) => w.length >= 3 && !STOP.has(w));
    const hits = sig.filter((w) => new RegExp(`\\b${escapeRe(w)}\\b`).test(t));
    if (hits.length) {
      const score = hits.length * 10 + hits.join('').length;
      if (!best || score > best.score) best = { project: p, score, raw: spanFor(text, words(name)), tie: false };
      else if (best.score === score) best.tie = true;
    }
  }
  if (!best || best.tie) return null;
  return { project: best.project, raw: best.raw };
}

/** Pick the category whose keywords appear most (multi-word phrases weigh more). */
export function guessCategory(text, keywordMap = DEFAULT_CATEGORY_KEYWORDS, categories = null) {
  const t = ` ${text.toLowerCase()} `;
  let best = null;
  for (const [cat, kws] of Object.entries(keywordMap || {})) {
    if (categories && !categories.includes(cat)) continue;
    let score = 0;
    for (const kw of kws || []) {
      const k = kw.toLowerCase().trim();
      if (k && new RegExp(`(^|[^a-z0-9])${escapeRe(k)}([^a-z0-9]|$)`).test(t)) score += k.split(/\s+/).length;
    }
    if (score > 0 && (!best || score > best.score)) best = { category: cat, score };
  }
  return best ? best.category : null;
}

/** Match a category by its own name ("hours on social media this week"). */
export function matchCategoryName(text, categories = []) {
  const t = text.toLowerCase();
  let best = null;
  for (const c of categories) {
    const sig = words(c).filter((w) => w.length >= 4);
    const hits = sig.filter((w) => t.includes(w)).length;
    if (hits && (!best || hits > best.hits)) best = { category: c, hits };
  }
  return best ? best.category : null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const ORD = '(?:st|nd|rd|th)?';

/**
 * A specific PAST day mentioned in text ("October 19th", "oct 19", "19th of October",
 * "10/19", "10/19/2025", "last Tuesday", "3 days ago", "the 19th").
 * Without a year, a date later than today means last year. Returns { date, raw } or null.
 */
export function parseSpecificDate(text, now = new Date()) {
  const t = text.toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const past = (m, d, y) => {
    let dt = new Date(y ?? today.getFullYear(), m, d);
    if (y == null && dt > today) dt = new Date(today.getFullYear() - 1, m, d);
    return dt.getMonth() === m ? dt : null; // rejects Feb 31 etc.
  };
  const year = (s) => (s ? (+s < 100 ? 2000 + +s : +s) : null);
  const tries = [
    [new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`), (m) => past(MONTHS.indexOf(m[1].slice(0, 3)), +m[2], year(m[3]))],
    [new RegExp(`\\b(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`), (m) => past(MONTHS.indexOf(m[2].slice(0, 3)), +m[1], year(m[3]))],
    [/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => past(+m[1] - 1, +m[2], year(m[3]))],
    [/\b(\d{4})-(\d{2})-(\d{2})\b/, (m) => past(+m[2] - 1, +m[3], +m[1])],
    [new RegExp(`\\b(\\d+|${Object.keys(WORD_NUM).join('|')})\\s+days?\\s+ago\\b`), (m) => addDays(today, -toNum(m[1]))],
    [new RegExp(`\\b(?:last|this past|past|on|from)\\s+(${WEEKDAYS.join('|')})\\b`), (m) => {
      const diff = (today.getDay() - WEEKDAYS.indexOf(m[1]) + 7) % 7 || 7;
      return addDays(today, -diff);
    }],
    [/\b(?:on\s+)?the\s+(\d{1,2})(?:st|nd|rd|th)\b/, (m) => {
      let dt = new Date(today.getFullYear(), today.getMonth(), +m[1]);
      if (dt > today) dt = new Date(today.getFullYear(), today.getMonth() - 1, +m[1]);
      return dt;
    }],
  ];
  for (const [re, fn] of tries) {
    const m = t.match(re);
    if (m) {
      const d = fn(m);
      if (d && !Number.isNaN(d.getTime())) return { date: isoDate(d), raw: text.substr(m.index, m[0].length) };
    }
  }
  return null;
}

export function parsePeriod(text, fallback = null, now = new Date()) {
  const t = text.toLowerCase();
  const day = parseSpecificDate(text, now);
  if (day) return `day:${day.date}`;
  if (/\btoday\b|\bso far\b/.test(t)) return 'today';
  if (/\byesterday\b/.test(t)) return 'yesterday';
  if (/\blast week\b/.test(t)) return 'last week';
  if (/\bthis week\b|\bthe week\b/.test(t)) return 'this week';
  if (/\blast month\b/.test(t)) return 'last month';
  if (/\bthis month\b|\bthe month\b/.test(t)) return 'this month';
  if (/\b(all time|ever|total|overall|in total)\b/.test(t)) return 'all time';
  return fallback;
}

// ---------------------------------------------------------------- text cleanup

function removeRaw(text, raw) {
  if (!raw) return text;
  const i = text.toLowerCase().indexOf(raw.toLowerCase());
  return i < 0 ? text : text.slice(0, i) + ' ' + text.slice(i + raw.length);
}

export function tidy(s) {
  let out = s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,.;:\-–—]+|[\s,;:\-–—]+$/g, '')
    .replace(/(?<![\w-])(for|on|about|to|by|and|with|at|in)\s*$/i, '')
    .replace(/^(for|on|about|and|that|i|the)\s+/i, '')
    .trim();
  out = out.replace(/[\s,;:\-–—]+$/g, '');
  return out ? out[0].toUpperCase() + out.slice(1) : out;
}

/** Strip wake words and filler from the start of a command. */
export function stripWake(text) {
  return text
    .trim()
    .replace(/^(hey|hi|ok|okay|yo)\s+/i, '')
    .replace(/^jarvis[\s,.:!]*/i, '')
    .replace(/^(please|can you|could you|would you)\s+/i, '')
    .replace(/[\s.!]+$/, '')
    .trim();
}

// Split off "next step(s): ..." / "waiting on ..." / "follow up ..." into notes.
function splitNotes(text) {
  const m = text.match(/(?:[.;,]\s*|\s+-\s+|\s+)(?:(next steps?|then|follow[- ]?up)\s*(?:is|are|:|-)?\s+|(?=(waiting (?:on|for)|need to|needs to|follow up with)\b))(.+)$/i);
  if (!m) return { body: text, notes: '' };
  // Only treat a bare "then"/"need to" as a notes separator if punctuation precedes it.
  const sepIsPunct = /^[.;,]|\s-\s/.test(m[0]);
  if (!m[1] && !m[2]) return { body: text, notes: '' };
  if ((m[1] && /^then$/i.test(m[1]) || /^need/i.test(m[2] || '')) && !sepIsPunct) return { body: text, notes: '' };
  return { body: text.slice(0, m.index), notes: tidy(m[3]) };
}

// ---------------------------------------------------------------- main parse

/**
 * Parse a command.
 * ctx: { projects: string[], categories: string[], keywords: {cat: [kw]}, now: Date }
 * Returns { intent, ...fields, text }.
 */
export function parseCommand(input, ctx = {}) {
  const projects = ctx.projects || [];
  const categories = ctx.categories || Object.keys(DEFAULT_CATEGORY_KEYWORDS);
  const keywords = ctx.keywords || DEFAULT_CATEGORY_KEYWORDS;
  const now = ctx.now || new Date();
  const text = stripWake(input || '');
  const t = text.toLowerCase();
  const out = (intent, fields = {}) => ({ intent, text, ...fields });

  if (!t) return out('empty');

  // Short replies used for follow-up questions.
  if (/^(yes|yeah|yep|yup|sure|ok|okay|save( it)?|confirm|correct|do it|sounds good|log it)$/.test(t)) return out('yes');
  if (/^(no|nope|nah|cancel|never ?mind|forget it|scratch that|don'?t)$/.test(t)) return out('no');

  if (/^(help|what can you do|commands|what can i say|how do i use (this|you))\b/.test(t)) return out('help');

  // Fixing the most recent entry: "delete my last entry", "undo that", "change that to 45 minutes"
  const LAST = '(?:that|it|this|the last (?:one|entry|thing|log)|my last (?:one|entry|thing|log)|last entry|the entry|what i just logged)';
  if (new RegExp(`^(?:delete|remove|erase|undo|get rid of|scrap)\\s+${LAST}$`).test(t) || /^undo( that| it)?$/.test(t)) {
    return out('entry_delete');
  }
  const edit = text.match(new RegExp(`^(?:edit|change|fix|update|correct|make)\\s+${LAST}(?:\\s+(?:to|into|so it'?s|so it says|as)\\s+(.+))?$`, 'i'));
  if (edit) {
    const to = edit[1] || '';
    const d = to ? parseDuration(to) : null;
    const pm = to ? matchProject(to, projects) : null;
    const day = to ? (/\byesterday\b/i.test(to) ? isoDate(addDays(now, -1)) : parseSpecificDate(to, now)?.date) : null;
    return out('entry_edit', { hours: d?.hours ?? null, project: pm?.project || '', date: day || '' });
  }

  if (/\b(morning brief|good morning|start (my|the) day|brief me|daily brief|what'?s (the plan|up) today)\b/.test(t)) return out('brief');

  if (/\b(wrap (it |things )?up|wrap ?up|end of (the )?day|end my day|eod|good ?night|day summary|daily summary|how did i do today|close out (my|the) day)\b/.test(t)) return out('wrapup');

  // Projects: "open the Acme project", "prepare the Acme agenda", "any new coverage for Acme?", "scan coverage for Nike"
  if (!/^(?:log|logged|i spent|spent|record)\b/.test(t) && !parseDuration(text)) {
    if (/\b(coverage|press hits|clips|press mentions|news mentions)\b/.test(t) && /^(?:any|scan|check|find|search|show|what|did|look|get|pull|new|open)\b|\b(new coverage|coverage for|coverage about|coverage on)\b/.test(t)) {
      const pm = matchProject(text, projects);
      return out('coverage_check', { project: pm?.project || '', scan: /\b(scan|check|search|find|look|pull)\b/.test(t) });
    }
    if (/\bagenda\b/.test(t)) {
      const pm = matchProject(text, projects);
      if (pm) return out('project_open', { project: pm.project, tab: 'agenda' });
    }
    const po = text.match(/^(?:open|show(?: me)?|go to|pull up|take me to)\s+(?:the\s+)?(?:project\s+)?(.+?)(?:\s+project)?$/i);
    if (po && /\bproject\b/i.test(text)) {
      const pm = matchProject(po[1], projects);
      if (pm) return out('project_open', { project: pm.project, tab: 'overview' });
    }
  }

  // Email (Outlook): "any new emails?", "check my email", "read me my emails", "what's in my inbox"
  if (!/^(?:log|logged|i spent|spent|record)\b/.test(t) && !parseDuration(text) &&
      /^(?:any|check|read|what'?s in|what is in|do i have|show|open|how many|did i get|anything (?:new|important) in)\b.*\b(e-?mails?|inbox|mail|messages)\b|^(?:new|unread|important) (?:e-?mails?|mail|messages)\b|^(?:my )?(?:e-?mails?|inbox)\??$/.test(t)) {
    return out('email_check', { important: /\b(important|urgent)\b/.test(t) });
  }

  // Calendar
  if (/^(?:log|record|track|add)\s+(?:all\s+)?(?:of\s+)?(?:my|the|today'?s)?\s*(?:meetings|calls|calendar)\b/.test(t)) {
    return out('calendar_log', { query: '' });
  }
  const meetLog = text.match(/^(?:log|record|track)\s+(?:the\s+|my\s+)?(.+?)\s+(?:meeting|call|sync|check-?in)$/i);
  if (meetLog && !parseDuration(text)) return out('calendar_log', { query: tidy(meetLog[1]) });
  if (/\b(what'?s|what is) on my (calendar|schedule|agenda)|\bmy (calendar|schedule|agenda)\b|\b(what|any) (meetings|calls)\b|\bmeetings? (do i have|today|tomorrow|this week)\b|\bdo i have (any )?(meetings|calls)\b|\bnext (meeting|call)\b|\bwhen'?s my next\b/.test(t)) {
    const next = /\bnext (meeting|call)\b|\bwhen'?s my next\b/.test(t);
    const period = /\btomorrow\b/.test(t) ? 'tomorrow' : /\bthis week\b|\bthe week\b/.test(t) ? 'this week' : 'today';
    return out('calendar_list', { period, next });
  }

  // Timer
  if (/^(cancel|discard|scrap|delete|reset) (the |my )?timer\b/.test(t)) return out('timer_cancel');
  if (/^(what am i working on|timer status|how long have i been working|is (the|my) timer (running|on)|what'?s the timer)/.test(t)) return out('timer_status');

  const start = text.match(/^(?:start(?:ing)?(?: working on| work on| the timer (?:on|for)| timer (?:on|for)| tracking| on)?|begin(?:ning)?(?: working on)?|clock(?:ing)? in(?: on| for)?|i'?m (?:now )?(?:starting|working) on|now working on|working on)\s+(.+)$/i);
  if (start && !parseDuration(start[1])) {
    const rest = start[1];
    const pm = matchProject(rest, projects);
    let task = tidy(removeRaw(rest, pm?.raw).replace(/^(the|my)\s+/i, ''));
    if (!task && pm) task = '';
    const category = guessCategory(rest, keywords, categories);
    return out('timer_start', { project: pm?.project || '', task, category: category || '' });
  }

  const stop = text.match(/^(?:stop(?:ped)?(?: the)?(?: timer| tracking| working)?|(?:i'?m |i am )?(?:done|finished|all done)(?: with (?:that|this|it))?|that'?s (?:done|it)|end(?: the)? timer|clock(?:ing)? out|pause(?: the timer)?)(?:\s*[,:\-]?\s*(.*))?$/i);
  if (stop) {
    let note = (stop[1] || '').trim();
    const withM = note.match(/^with\s+(.+)$/i);
    if (withM) note = withM[1];
    return out('timer_stop', { note: tidy(note) });
  }

  // To-dos
  if (/^(?:complete|completed|check off|checked off|cross off|tick off)\s+/i.test(t) ||
      /\b(as )?(done|complete|completed|finished)$/.test(t) && /^(mark|set)\b/.test(t)) {
    const q = text
      .replace(/^(?:complete|completed|check off|checked off|cross off|tick off|mark|set)\s+/i, '')
      .replace(/\s+(?:as\s+)?(?:done|complete|completed|finished)$/i, '')
      .replace(/^(?:the\s+)?(?:to-?do|task|item)\s*(?:to\s+|about\s+|for\s+)?/i, '')
      .replace(/\s+(?:to-?do|task)$/i, '');
    return out('todo_complete', { query: tidy(q) });
  }

  // Changing a to-do's due date:
  //   "move follow up with Axios to Friday", "push the venue to next week",
  //   "change the due date of the media list to 11/20", "remove the due date from the venue"
  const noDue = text.match(/^(?:remove|clear|delete|take off)\s+(?:the\s+)?due\s+date\s+(?:from|for|on|of)\s+(?:the\s+)?(?:to-?do\s+)?(.+)$/i);
  if (noDue) return out('todo_due', { query: tidy(noDue[1]), due: '' });
  const moveM =
    text.match(/^(?:change|set|update|move)\s+(?:the\s+)?due\s+date\s+(?:of|for|on)\s+(?:the\s+)?(?:to-?do\s+)?(.+?)\s+to\s+(.+)$/i) ||
    text.match(/^(?:move|push|reschedule|bump|shift|postpone)\s+(?:the\s+)?(?:to-?do\s+)?(.+?)\s+(?:to|until|till|for)\s+(.+)$/i) ||
    text.match(/^make\s+(?:the\s+)?(?:to-?do\s+)?(.+?)\s+due\s+(.+)$/i);
  if (moveM) {
    const due = parseDue(moveM[2], now);
    if (due) return out('todo_due', { query: tidy(moveM[1]), due: due.due });
  }

  // Changing how urgent a to-do is:
  //   "make follow up with Axios urgent", "mark the venue as low priority", "the recap isn't urgent"
  const priM =
    text.match(/^(?:make|mark|set|flag|change)\s+(?:the\s+)?(?:to-?do\s+)?(.+?)\s+(?:as\s+|to\s+)?(urgent|important|high priority|top priority|low priority|not urgent|normal(?: priority)?|regular(?: priority)?)$/i) ||
    text.match(/^(?:the\s+)?(?:to-?do\s+)?(.+?)\s+(?:is|isn'?t|is not)\s+(urgent|not urgent|low priority|high priority)$/i);
  if (priM) {
    const negated = /\b(isn'?t|is not)\b/i.test(text) || /^not urgent$/i.test(priM[2]);
    const level = negated ? 'normal' : /urgent|important|high|top/i.test(priM[2]) ? 'high' : /low/i.test(priM[2]) ? 'low' : 'normal';
    return out('todo_priority', { query: tidy(priM[1]), priority: level });
  }

  // Changing a to-do's project:
  //   "put follow up with Axios under Acme", "assign the venue to Nike",
  //   "change the project of the recap to Spring Launch", "move the venue to the Nike project"
  const projM =
    text.match(/^(?:change|set|update)\s+(?:the\s+)?project\s+(?:of|for|on)\s+(?:the\s+)?(?:to-?do\s+)?(.+?)\s+to\s+(.+)$/i) ||
    text.match(/^(?:put|file|move)\s+(?:the\s+)?(?:to-?do\s+)?(.+?)\s+(?:under|in|into|to)\s+(?:the\s+)?(.+?)(?:\s+project)?$/i) ||
    text.match(/^(?:assign|tag|link)\s+(?:the\s+)?(?:to-?do\s+)?(.+?)\s+(?:to|with|as)\s+(?:the\s+)?(.+?)(?:\s+project)?$/i);
  if (projM) {
    const pm = matchProject(projM[2], projects);
    if (pm) return out('todo_project', { query: tidy(projM[1]), project: pm.project });
  }

  const todoM =
    text.match(/^(?:add|create|new|put|make)?\s*(?:a\s+)?(?:to-?\s?do|todo|task|reminder)(?:\s+to my list)?\s*(?:[:,\-]|\s+to\s+|\s+)\s*(.+)$/i) ||
    text.match(/^remind me (?:to\s+)?(.+)$/i) ||
    text.match(/^add\s+(.+?)\s+to\s+(?:my|the)\s+(?:to-?\s?do\s+|todo\s+|task\s+)?list$/i) ||
    text.match(/^(?:i need to|i have to|i gotta|don'?t forget to|don'?t let me forget to)\s+(.+)$/i);
  if (todoM && !/^(list|items)$/i.test(todoM[1])) {
    let body = todoM[1];
    const due = parseDue(body, now);
    body = removeRaw(body, due?.raw);
    const pr = parsePriority(body);
    body = removeRaw(body, pr?.raw);
    const pm = matchProject(body, projects);
    return out('todo_add', {
      todo: tidy(body), due: due?.due || '', priority: pr?.priority || 'normal', project: pm?.project || '',
    });
  }

  if (/(what'?s|what is|read( me)?|show( me)?|list|open|check)\s+(on\s+)?(my|the)\s+(to-?\s?do|todo|task)?\s*(list|items|tasks|to-?\s?dos)|\bmy (to-?\s?dos|todos|tasks)\b|what do i (have|need|still need) to do|what'?s (due|overdue|left|coming up|urgent)|\bto-?\s?do list\b|anything (due|overdue|urgent|coming up)|^(?:what'?s\s+|show(?: me)?\s+|list\s+|any\s+)?(?:my\s+)?(?:upcoming|coming up)\b|\bwhat (is|are) (due|urgent)\b|\b(my|what|any) deadlines\b/.test(t)) {
    const pm = matchProject(text, projects);
    // Which due dates: "due tomorrow", "this week", "next week", "next 10 days", "coming up", "overdue"
    let window = '';
    const nDays = t.match(/\bnext\s+(\d+|seven|ten|fourteen|thirty)\s+days\b/);
    if (/\boverdue\b/.test(t)) window = 'overdue';
    else if (/\btomorrow\b/.test(t)) window = 'tomorrow';
    else if (/\btoday\b/.test(t)) window = 'today';
    else if (/\bnext week\b/.test(t)) window = 'next week';
    else if (/\bthis week\b/.test(t)) window = 'this week';
    else if (/\bthis month\b/.test(t)) window = 'this month';
    else if (nDays) window = String({ seven: 7, ten: 10, fourteen: 14, thirty: 30 }[nDays[1]] || Number(nDays[1]));
    else if (/\b(coming up|upcoming|soon)\b/.test(t)) window = '7';
    const urgent = /\b(urgent|important|high priority)\b/.test(t);
    return out('todo_list', { project: pm?.project || '', window, urgent });
  }

  // Questions
  if (/how (many|much) (hours|time)|\bhours (did|have) i\b|\btotal hours\b|how long (did|have) i (spend|spent|work|worked|been)|\bhours (today|this week|this month|so far)\b/.test(t)) {
    const pm = matchProject(text, projects);
    const cat = pm ? null : matchCategoryName(text, categories);
    return out('query_hours', { period: parsePeriod(text, 'this week', now), project: pm?.project || '', category: cat || '' });
  }

  if (/what (did|have) i (do|done|work(ed)? on|get done|accomplish(ed)?)|what have i been (doing|working on)|show (me )?(my )?(log|entries|work)/.test(t)) {
    const pm = matchProject(text, projects);
    return out('query_log', { period: parsePeriod(text, 'today', now), project: pm?.project || '' });
  }

  if (/^(?:give me |write |generate |create |make |send |show |build |draft |prepare )?(?:me )?(?:a |an |my |the )?(?:quick )?(?:weekly |monthly |daily |client |project )?(?:status )?(?:report|recap|summary)\b/.test(t)) {
    const pm = matchProject(text, projects);
    let period = parsePeriod(text, null, now);
    if (!period) period = /monthly/.test(t) ? 'this month' : /daily/.test(t) ? 'today' : 'this week';
    return out('report', { period, project: pm?.project || '' });
  }

  // Looking up a specific day: "October 19th", "pull up 10/19", "show me last Tuesday",
  // "everything I worked on Oct 19".
  const dur = parseDuration(text);
  const logLead = /^(?:log|logged|add|record|recorded|track|tracked|i spent|spent|i worked|worked|i did|did|just did|just finished|i just)\b/i;
  const askedDay = parseSpecificDate(text, now);
  if (askedDay && !dur && !logLead.test(text)) {
    const rest = removeRaw(text, askedDay.raw).toLowerCase().replace(/[^a-z ]/g, ' ').trim();
    const lookup = /\b(show|pull|open|see|view|find|look|list|get|what|everything|anything|work|worked|did|do|done|happened|day|log)\b/.test(rest);
    if (lookup || !rest || /^(on|for|from)$/.test(rest)) {
      const pm = matchProject(text, projects);
      return out('query_log', { period: `day:${askedDay.date}`, project: pm?.project || '' });
    }
  }

  // Logging work (optionally for a past day: "yesterday I spent…", "log 1 hour on Oct 19 …")
  if (logLead.test(text) || dur) {
    let body = text.replace(/^(?:log|logged|add|record|recorded|track|tracked)\b\s*(?:that\s+)?(?:i\s+)?/i, '');
    const { body: b2, notes } = splitNotes(body);
    body = b2;
    if (dur) body = removeRaw(body, dur.raw);
    let date = '';
    const ydM = body.match(/\b(?:yesterday|last night)\b/i);
    if (ydM) { date = isoDate(addDays(now, -1)); body = removeRaw(body, ydM[0]); }
    else {
      const sd = parseSpecificDate(body, now);
      if (sd) { date = sd.date; body = removeRaw(body, sd.raw); }
    }
    const pm = matchProject(body, projects);
    if (pm?.raw) {
      // Drop the project name only where it labels the work ("on Acme:", "for Acme"),
      // not where it is part of the description ("pitched the Acme rebrand").
      const i = body.toLowerCase().indexOf(pm.raw.toLowerCase());
      const before = body.slice(0, i);
      const after = body.slice(i + pm.raw.length);
      if (/(?:^|\b(?:on|for|re|with|to))\s*$/i.test(before) || /^\s*[:\-–—]/.test(after) || !after.trim()) {
        body = before.replace(/\b(?:on|for|re)\s*$/i, ' ') + ' ' + after;
      }
    }
    body = body
      .replace(/^\s*(?:i\s+)?(?:spent|worked|did|just did|just finished|just)\b/i, '')
      .replace(/\b(?:for|on)\s+(?=[,.:;]|$)/gi, ' ')
      .replace(/^\s*(?:for|on)\s+(?:the\s+)?/i, '')
      .replace(/\s+(?:for|on)\s+(?:the\s+)?(?:project|client|account)\s*$/i, '');
    let workDone = tidy(body.replace(/^\s*(?:on|for|working on|working)\s*[:,]?\s*/i, ''));
    workDone = workDone.replace(/^(?:on|for)\s+/i, '');
    workDone = tidy(workDone);
    const category = guessCategory(`${workDone} ${notes}`, keywords, categories);
    if (!dur && !workDone) return out('unknown');
    return out('log', {
      hours: dur?.hours ?? null,
      date,
      project: pm?.project || '',
      workDone,
      task: shortTask(workDone),
      category: category || '',
      notes,
    });
  }

  return out('unknown');
}

/** A short "Task" label from a longer description: first clause, up to about 8 words. */
export function shortTask(workDone) {
  if (!workDone) return '';
  const first = workDone.split(/[.;:]|,\s(?=and |then )|\s-\s/)[0];
  const w = first.split(/\s+/);
  const s = w.length > 8 ? w.slice(0, 8).join(' ') + '…' : first;
  return tidy(s);
}
