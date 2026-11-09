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

export function parsePeriod(text, fallback = null) {
  const t = text.toLowerCase();
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
    .replace(/\b(for|on|about|to|by|and|with|at|in)\s*$/i, '')
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

  if (/\b(morning brief|good morning|start (my|the) day|brief me|daily brief|what'?s (the plan|up) today)\b/.test(t)) return out('brief');

  if (/\b(wrap (it |things )?up|wrap ?up|end of (the )?day|end my day|eod|good ?night|day summary|daily summary|how did i do today|close out (my|the) day)\b/.test(t)) return out('wrapup');

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
  if (/^(?:complete|completed|check off|checked off|cross off|tick off|mark)\s+/i.test(t) ||
      /\b(as )?(done|complete|completed|finished)$/.test(t) && /^(mark|set)\b/.test(t)) {
    const q = text
      .replace(/^(?:complete|completed|check off|checked off|cross off|tick off|mark|set)\s+/i, '')
      .replace(/\s+(?:as\s+)?(?:done|complete|completed|finished)$/i, '')
      .replace(/^(?:the\s+)?(?:to-?do|task|item)\s*(?:to\s+|about\s+|for\s+)?/i, '')
      .replace(/\s+(?:to-?do|task)$/i, '');
    return out('todo_complete', { query: tidy(q) });
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

  if (/(what'?s|what is|read( me)?|show( me)?|list|open|check)\s+(on\s+)?(my|the)\s+(to-?\s?do|todo|task)?\s*(list|items|tasks|to-?\s?dos)|\bmy (to-?\s?dos|todos|tasks)\b|what do i (have|need|still need) to do|what'?s (due|overdue|left)|\bto-?\s?do list\b|anything (due|overdue)/.test(t)) {
    return out('todo_list');
  }

  // Questions
  if (/how (many|much) (hours|time)|\bhours (did|have) i\b|\btotal hours\b|how long (did|have) i (spend|spent|work|worked|been)|\bhours (today|this week|this month|so far)\b/.test(t)) {
    const pm = matchProject(text, projects);
    const cat = pm ? null : matchCategoryName(text, categories);
    return out('query_hours', { period: parsePeriod(text, 'this week'), project: pm?.project || '', category: cat || '' });
  }

  if (/what (did|have) i (do|done|work(ed)? on|get done|accomplish(ed)?)|what have i been (doing|working on)|show (me )?(my )?(log|entries|work)/.test(t)) {
    const pm = matchProject(text, projects);
    return out('query_log', { period: parsePeriod(text, 'today'), project: pm?.project || '' });
  }

  if (/^(?:give me |write |generate |create |make |send |show |build |draft |prepare )?(?:me )?(?:a |an |my |the )?(?:quick )?(?:weekly |monthly |daily |client |project )?(?:status )?(?:report|recap|summary)\b/.test(t)) {
    const pm = matchProject(text, projects);
    let period = parsePeriod(text, null);
    if (!period) period = /monthly/.test(t) ? 'this month' : /daily/.test(t) ? 'today' : 'this week';
    return out('report', { period, project: pm?.project || '' });
  }

  // Logging work
  const dur = parseDuration(text);
  const logLead = /^(?:log|logged|add|record|recorded|track|tracked|i spent|spent|i worked|worked|i did|did|just did|just finished|i just)\b/i;
  if (logLead.test(text) || dur) {
    let body = text.replace(/^(?:log|logged|add|record|recorded|track|tracked)\b\s*(?:that\s+)?(?:i\s+)?/i, '');
    const { body: b2, notes } = splitNotes(body);
    body = b2;
    if (dur) body = removeRaw(body, dur.raw);
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
