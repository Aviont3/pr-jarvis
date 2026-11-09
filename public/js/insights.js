// Numbers, briefs, wrap-ups and reports, built from templates (no AI).
// Pure functions of app state, so they can be unit-tested in Node.

import {
  isoDate, parseIso, addDays, periodRange, inRange, fmtHours, fmtNum, fmtDate, sum,
} from './util.js';
import { matchProject, guessCategory } from './parser.js';

export const displayProject = (p) => (p ? p.replace(/^example:\s*/i, '') : 'No project');

// ------------------------------------------------------------------ calendar meetings

export const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export const meetingHours = (ev) => Math.round(((new Date(ev.end) - new Date(ev.start)) / 3600000) * 100) / 100;
export const isMeetingLogged = (ev, entries) => entries.some((e) => e.calendarEventId === ev.id);
export const meetingsOn = (events = [], iso) => events.filter((ev) => ev.date === iso);

/** Meetings that have ended today and aren't logged yet. */
export function unloggedMeetings(state, now = new Date()) {
  return meetingsOn(state.events, isoDate(now))
    .filter((ev) => new Date(ev.end) <= now && !isMeetingLogged(ev, state.entries));
}

/** Turn a calendar event into a Daily Log entry. */
export function meetingToEntry(ev, settings = {}) {
  const cats = settings.categories || [];
  const pm = matchProject(`${ev.title} ${ev.calendar || ''}`, settings.projects || []);
  let category = guessCategory(ev.title, settings.keywords, cats.length ? cats : null);
  // Meeting titles rarely say "meeting"; a known client in the title usually means a client call.
  if (!category || category === 'Admin') {
    category = pm && cats.includes('Client Communication') ? 'Client Communication' : (settings.meetingCategory || 'Internal Meetings');
  }
  return {
    date: ev.date,
    project: pm?.project || '',
    task: ev.title,
    workDone: `Meeting: ${ev.title} (${fmtTime(ev.start)}–${fmtTime(ev.end)})`,
    category,
    hours: meetingHours(ev),
    notes: '',
    calendarEventId: ev.id,
  };
}

const meetingLine = (ev, entries) =>
  `${fmtTime(ev.start)}–${fmtTime(ev.end)} · ${ev.title}${entries && isMeetingLogged(ev, entries) ? ' ✓ logged' : ''}`;

export function answerMeetings(state, { period = 'today', next = false } = {}, now = new Date()) {
  const events = state.events || [];
  if (next) {
    const up = events.filter((ev) => new Date(ev.start) > now).sort((a, b) => (a.start < b.start ? -1 : 1))[0];
    if (!up) return { title: 'Next meeting', speech: 'You have no more meetings coming up today. 🌼', sections: [] };
    const mins = Math.round((new Date(up.start) - now) / 60000);
    const when = mins < 60 ? `in ${mins} minutes` : `at ${fmtTime(up.start)}`;
    return { title: 'Next meeting', speech: `Your next meeting is ${up.title}, ${when}.`, sections: [{ heading: 'Up next', items: [meetingLine(up)] }] };
  }
  let list;
  let label;
  if (period === 'tomorrow') { const d = isoDate(addDays(now, 1)); list = meetingsOn(events, d); label = 'tomorrow'; }
  else if (period === 'this week') { const r = periodRange('this week', now); list = events.filter((ev) => inRange(ev.date, r)); label = 'this week'; }
  else { list = meetingsOn(events, isoDate(now)); label = 'today'; }
  if (!list.length) return { title: `Meetings ${label}`, speech: `No meetings on your calendar ${label}. Enjoy the open time! 🌷`, sections: [] };
  const hrs = sum(list, meetingHours);
  const multiDay = period === 'this week';
  const items = list.map((ev) => `${multiDay ? `${fmtDate(ev.date)} · ` : ''}${meetingLine(ev, state.entries)}`);
  const first = list.filter((ev) => new Date(ev.end) > now)[0];
  return {
    title: `Meetings ${label}`,
    speech: `You have ${list.length} ${list.length === 1 ? 'meeting' : 'meetings'} ${label}, ${fmtHours(hrs)} in total.${first && label === 'today' ? ` Next up: ${first.title} at ${fmtTime(first.start)}.` : ''}`,
    sections: [{ heading: `${list.length} meetings`, items }],
  };
}

export function filterEntries(entries, { range, project, category } = {}) {
  return entries.filter((e) =>
    (!range || inRange(e.date, range)) &&
    (!project || e.project === project) &&
    (!category || e.category === category));
}

/** Group hours by a key -> [{ key, hours }] sorted desc */
export function hoursBy(entries, key) {
  const m = new Map();
  for (const e of entries) {
    const k = e[key] || '';
    m.set(k, (m.get(k) || 0) + (Number(e.hours) || 0));
  }
  return [...m.entries()].map(([k, hours]) => ({ key: k, hours })).sort((a, b) => b.hours - a.hours);
}

export function stats(state, now = new Date()) {
  const { entries } = state;
  const today = periodRange('today', now);
  const week = periodRange('this week', now);
  const month = periodRange('this month', now);
  const wk = filterEntries(entries, { range: week });
  return {
    today: sum(filterEntries(entries, { range: today }), (e) => e.hours),
    week: sum(wk, (e) => e.hours),
    month: sum(filterEntries(entries, { range: month }), (e) => e.hours),
    all: sum(entries, (e) => e.hours),
    weekStart: week.from,
    categoryWeek: hoursBy(wk, 'category'),
    categoryAll: hoursBy(entries, 'category'),
    projectWeek: hoursBy(wk, 'project'),
    projectAll: hoursBy(entries, 'project'),
    dailyWeek: Array.from({ length: 7 }, (_, i) => {
      const d = isoDate(addDays(parseIso(week.from), i));
      return { date: d, hours: sum(entries.filter((e) => e.date === d), (e) => e.hours) };
    }),
  };
}

const PRI = { high: 0, normal: 1, low: 2 };
export const sortTodos = (a, b) =>
  (a.done - b.done) ||
  ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) ||
  ((PRI[a.priority] ?? 1) - (PRI[b.priority] ?? 1)) ||
  (a.createdAt < b.createdAt ? -1 : 1);

export function todoBuckets(todos, now = new Date()) {
  const t = isoDate(now);
  const open = todos.filter((x) => !x.done).sort(sortTodos);
  return {
    open,
    overdue: open.filter((x) => x.due && x.due < t),
    today: open.filter((x) => x.due === t),
    upcoming: open.filter((x) => x.due && x.due > t),
    someday: open.filter((x) => !x.due),
    doneToday: todos.filter((x) => x.done && (x.doneAt || '').slice(0, 10) === t),
  };
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'about'].includes(w));

/** Fuzzy-find an open to-do by spoken description. */
export function findTodo(todos, query) {
  const q = norm(query);
  if (!q.length) return null;
  let best = null;
  for (const td of todos.filter((x) => !x.done)) {
    const w = new Set(norm(`${td.text} ${displayProject(td.project)}`));
    const hits = q.filter((x) => w.has(x) || [...w].some((y) => y.startsWith(x) || x.startsWith(y))).length;
    const score = hits / q.length;
    if (hits && (!best || score > best.score)) best = { todo: td, score };
  }
  return best && best.score >= 0.5 ? best.todo : null;
}

function dueLabel(td, now) {
  if (!td.due) return '';
  const t = isoDate(now);
  if (td.due < t) return ` (overdue, was due ${fmtDate(td.due)})`;
  if (td.due === t) return ' (due today)';
  if (td.due === isoDate(addDays(now, 1))) return ' (due tomorrow)';
  return ` (due ${fmtDate(td.due)})`;
}
export const todoLine = (td, now = new Date()) =>
  `${td.priority === 'high' ? '❗ ' : ''}${td.text}${td.project ? ` · ${displayProject(td.project)}` : ''}${dueLabel(td, now)}`;

function greeting(now, name) {
  const h = now.getHours();
  const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  return name ? `${part}, ${name}.` : `${part}.`;
}

const list = (arr, n = 3) => {
  const a = arr.slice(0, n);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
};

// ------------------------------------------------------------------ morning brief

export function morningBrief(state, now = new Date()) {
  const name = state.settings?.userName || '';
  const todayIso = isoDate(now);
  const prevDates = [...new Set(state.entries.map((e) => e.date).filter((d) => d < todayIso))].sort();
  const lastDay = prevDates[prevDates.length - 1];
  const lastEntries = lastDay ? state.entries.filter((e) => e.date === lastDay) : [];
  const b = todoBuckets(state.todos, now);
  const st = stats(state, now);

  const sections = [];
  const speech = [greeting(now, name)];

  if (lastDay) {
    const hrs = sum(lastEntries, (e) => e.hours);
    const projects = [...new Set(lastEntries.map((e) => displayProject(e.project)))];
    const when = lastDay === isoDate(addDays(now, -1)) ? 'Yesterday' : `On ${fmtDate(lastDay)}`;
    speech.push(`${when} you logged ${fmtHours(hrs)} across ${lastEntries.length} ${lastEntries.length === 1 ? 'entry' : 'entries'}, mostly on ${list(projects, 2)}.`);
    sections.push({
      heading: `${when}: ${fmtHours(hrs)}`,
      items: lastEntries.map((e) => `${displayProject(e.project)}: ${e.workDone || e.task} (${fmtHours(e.hours)})`),
    });
  } else {
    speech.push("There's no work logged yet. Say something like 'log 30 minutes pitching Axios on Spring Launch' to start.");
  }

  const urgent = [...b.overdue, ...b.today];
  if (urgent.length) {
    const parts = [];
    if (b.overdue.length) parts.push(`${b.overdue.length} overdue`);
    if (b.today.length) parts.push(`${b.today.length} due today`);
    speech.push(`On your list: ${parts.join(' and ')}. Top of the list: ${urgent[0].text}.`);
    sections.push({ heading: 'Due now', items: urgent.map((t) => todoLine(t, now)) });
  } else if (b.open.length) {
    speech.push(`Nothing is due today. You have ${b.open.length} open ${b.open.length === 1 ? 'to-do' : 'to-dos'}.`);
  } else {
    speech.push('Your to-do list is clear.');
  }
  const todaysMeetings = meetingsOn(state.events, todayIso);
  if (todaysMeetings.length) {
    const first = todaysMeetings[0];
    speech.push(`You have ${todaysMeetings.length} ${todaysMeetings.length === 1 ? 'meeting' : 'meetings'} today, starting with ${first.title} at ${fmtTime(first.start)}.`);
    sections.push({ heading: '📅 Meetings today', items: todaysMeetings.map((ev) => meetingLine(ev)) });
  }

  const later = [...b.upcoming, ...b.someday].slice(0, 5);
  if (later.length) sections.push({ heading: 'Coming up', items: later.map((t) => todoLine(t, now)) });

  const openNext = lastEntries.filter((e) => e.notes).map((e) => `${displayProject(e.project)}: ${e.notes}`);
  if (openNext.length) sections.push({ heading: 'Next steps from last time', items: openNext });

  if (st.week > 0) speech.push(`You're at ${fmtHours(st.week)} for the week.`);
  if (state.timer) speech.push(`Your timer is still running on ${state.timer.task || displayProject(state.timer.project)}.`);

  return { title: 'Morning brief', speech: speech.join(' '), sections };
}

// ------------------------------------------------------------------ end of day

export function wrapUp(state, now = new Date()) {
  const t = isoDate(now);
  const todays = state.entries.filter((e) => e.date === t);
  const hrs = sum(todays, (e) => e.hours);
  const b = todoBuckets(state.todos, now);
  const tomorrow = isoDate(addDays(now, 1));
  const dueTomorrow = b.open.filter((x) => x.due === tomorrow);
  const sections = [];
  const speech = [];

  if (!todays.length) {
    speech.push("You haven't logged anything today. Tell me what you worked on and I'll log it, for example 'log 2 hours drafting the Acme release'.");
  } else {
    const byProj = hoursBy(todays, 'project');
    speech.push(`Nice work. You logged ${fmtHours(hrs)} today across ${todays.length} ${todays.length === 1 ? 'entry' : 'entries'}.`);
    speech.push(`Most of it went to ${displayProject(byProj[0].key)} at ${fmtHours(byProj[0].hours)}.`);
    sections.push({ heading: `Today: ${fmtHours(hrs)}`, items: byProj.map((p) => `${displayProject(p.key)}: ${fmtHours(p.hours)}`) });
    sections.push({ heading: 'What you did', items: todays.map((e) => `${e.workDone || e.task} (${fmtHours(e.hours)})`) });
  }
  if (b.doneToday.length) {
    speech.push(`You checked off ${b.doneToday.length} ${b.doneToday.length === 1 ? 'to-do' : 'to-dos'}.`);
    sections.push({ heading: 'Completed to-dos', items: b.doneToday.map((x) => x.text) });
  }
  const carry = [...b.overdue, ...b.today];
  if (carry.length) {
    speech.push(`${carry.length} ${carry.length === 1 ? 'item rolls' : 'items roll'} over to tomorrow.`);
    sections.push({ heading: 'Rolling over', items: carry.map((x) => todoLine(x, now)) });
  }
  if (dueTomorrow.length) sections.push({ heading: 'Due tomorrow', items: dueTomorrow.map((x) => todoLine(x, now)) });
  const missed = unloggedMeetings(state, now);
  if (missed.length) {
    speech.push(`${missed.length} of today's meetings ${missed.length === 1 ? "isn't" : "aren't"} logged yet. Say "log my meetings" to add ${missed.length === 1 ? 'it' : 'them'}.`);
    sections.push({ heading: '📅 Meetings not logged', items: missed.map((ev) => `${meetingLine(ev)} (${fmtHours(meetingHours(ev))})`) });
  }
  if (state.timer) speech.push(`Heads up: your timer is still running on ${state.timer.task || displayProject(state.timer.project)}. Say "stop" to log it.`);
  return { title: 'End of day wrap-up', speech: speech.join(' '), sections };
}

// ------------------------------------------------------------------ questions

export function answerHours(state, { period = 'this week', project = '', category = '' }, now = new Date()) {
  const range = periodRange(period, now);
  const es = filterEntries(state.entries, { range, project, category });
  const hrs = sum(es, (e) => e.hours);
  const what = project ? ` on ${displayProject(project)}` : category ? ` on ${category}` : '';
  const speech = hrs
    ? `You've logged ${fmtHours(hrs)}${what} ${range.label}.`
    : `I don't have any hours${what} ${range.label}.`;
  const sections = [];
  if (hrs && !project) sections.push({ heading: 'By project', items: hoursBy(es, 'project').map((p) => `${displayProject(p.key)}: ${fmtHours(p.hours)}`) });
  if (hrs && !category) sections.push({ heading: 'By category', items: hoursBy(es, 'category').map((p) => `${p.key || 'Uncategorized'}: ${fmtHours(p.hours)}`) });
  return { title: `Hours ${range.label}${what}`, speech, sections };
}

export function answerLog(state, { period = 'today', project = '' }, now = new Date()) {
  const range = periodRange(period, now);
  const es = filterEntries(state.entries, { range, project })
    .sort((a, b) => (a.date === b.date ? ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1) : a.date < b.date ? -1 : 1));
  const what = project ? ` on ${displayProject(project)}` : '';
  const singleDay = range.from === range.to;
  const title = singleDay && range.label.startsWith('on ')
    ? `${fmtDate(range.from, true)}${what}`
    : `Work ${range.label}${what}`;
  const finished = state.todos.filter((t) => t.done && t.doneAt && inRange(t.doneAt.slice(0, 10), range) && (!project || t.project === project));
  const sections = [];
  if (es.length) {
    const items = es.map((e) => `${singleDay ? '' : `${fmtDate(e.date)} · `}${project ? '' : `${displayProject(e.project)}: `}${e.workDone || e.task} (${fmtHours(e.hours)})`);
    sections.push({ heading: `${es.length} ${es.length === 1 ? 'entry' : 'entries'} · ${fmtHours(sum(es, (e) => e.hours))}`, items });
    if (!project && singleDay) {
      const byProj = hoursBy(es, 'project');
      if (byProj.length > 1) sections.push({ heading: 'By project', items: byProj.map((p) => `${displayProject(p.key)}: ${fmtHours(p.hours)}`) });
    }
  }
  if (finished.length) sections.push({ heading: 'To-dos finished', items: finished.map((t) => t.text) });
  const When = range.label[0].toUpperCase() + range.label.slice(1);
  if (!es.length) {
    return {
      title,
      speech: `Nothing was logged${what} ${range.label}.${finished.length ? ` You did finish ${finished.length} ${finished.length === 1 ? 'to-do' : 'to-dos'}.` : ''}`,
      sections,
    };
  }
  const top = es.slice(0, 3).map((e) => e.task || e.workDone);
  return {
    title,
    speech: `${When} you logged ${es.length} ${es.length === 1 ? 'entry' : 'entries'}${what}, ${fmtHours(sum(es, (e) => e.hours))} in total. Including: ${list(top, 3)}.`,
    sections,
  };
}

export function answerTodos(state, now = new Date()) {
  const b = todoBuckets(state.todos, now);
  if (!b.open.length) return { title: 'To-do list', speech: 'Your to-do list is clear. Nice.', sections: [] };
  const sections = [];
  if (b.overdue.length) sections.push({ heading: 'Overdue', items: b.overdue.map((x) => todoLine(x, now)) });
  if (b.today.length) sections.push({ heading: 'Due today', items: b.today.map((x) => todoLine(x, now)) });
  if (b.upcoming.length) sections.push({ heading: 'Upcoming', items: b.upcoming.map((x) => todoLine(x, now)) });
  if (b.someday.length) sections.push({ heading: 'No date', items: b.someday.map((x) => todoLine(x, now)) });
  const first = [...b.overdue, ...b.today, ...b.upcoming, ...b.someday].slice(0, 3).map((x) => x.text);
  return {
    title: 'To-do list',
    speech: `You have ${b.open.length} open ${b.open.length === 1 ? 'item' : 'items'}${b.overdue.length ? `, ${b.overdue.length} overdue` : ''}. ${first.length > 1 ? 'First up' : 'It is'}: ${list(first, 3)}.`,
    sections,
  };
}

// ------------------------------------------------------------------ reports

/** Copy-ready plain-text report for a period, optionally one project. */
export function buildReport(state, { period = 'this week', project = '' } = {}, now = new Date()) {
  const range = periodRange(period, now);
  const es = filterEntries(state.entries, { range, project }).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const total = sum(es, (e) => e.hours);
  const name = state.settings?.userName ? ` · ${state.settings.userName}` : '';
  const span = range.label === 'all time' ? 'All time' :
    range.from === range.to ? fmtDate(range.from, true) : `${fmtDate(range.from)} – ${fmtDate(range.to, true)}`;
  const kind = String(period).startsWith('day:') ? 'Daily'
    : { today: 'Daily', yesterday: 'Daily', 'this week': 'Weekly', 'last week': 'Weekly', 'this month': 'Monthly', 'last month': 'Monthly' }[period] || '';
  const title = `${project ? `${displayProject(project)}: ` : ''}${kind ? `${kind} ` : ''}Work Report`;

  const L = [];
  L.push(`${title}${name}`);
  L.push(span);
  L.push('');
  if (!es.length) {
    L.push('No work logged for this period.');
    return { title, text: L.join('\n'), speech: `There's nothing logged ${range.label}${project ? ` for ${displayProject(project)}` : ''}, so the report is empty.`, sections: [] };
  }
  const projects = hoursBy(es, 'project');
  L.push(`Total: ${fmtNum(total)} hrs across ${es.length} ${es.length === 1 ? 'entry' : 'entries'}${project ? '' : ` and ${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}`);
  L.push('');

  for (const p of projects) {
    if (!project) L.push(`${displayProject(p.key)} (${fmtNum(p.hours)} hrs)`);
    for (const e of es.filter((x) => (x.project || '') === p.key)) {
      L.push(`  • ${range.from !== range.to ? `${fmtDate(e.date)}: ` : ''}${e.workDone || e.task} (${fmtNum(e.hours)} hrs)`);
    }
    L.push('');
  }

  L.push('Time by category');
  for (const c of hoursBy(es, 'category')) {
    L.push(`  • ${c.key || 'Uncategorized'}: ${fmtNum(c.hours)} hrs (${Math.round((c.hours / total) * 100)}%)`);
  }

  const completed = state.todos.filter((t) => t.done && t.doneAt && inRange(t.doneAt.slice(0, 10), range) && (!project || t.project === project));
  if (completed.length) {
    L.push('');
    L.push('Completed');
    completed.forEach((t) => L.push(`  • ${t.text}`));
  }
  const open = state.todos.filter((t) => !t.done && (!project || t.project === project)).sort(sortTodos);
  if (open.length) {
    L.push('');
    L.push('Next steps / open items');
    open.slice(0, 12).forEach((t) => L.push(`  • ${todoLine(t, now)}`));
  }

  return {
    title,
    text: L.join('\n'),
    speech: `Here's your ${kind ? `${kind.toLowerCase()} ` : ''}report${project ? ` for ${displayProject(project)}` : ''}: ${fmtHours(total)} across ${es.length} entries. It's ready to copy.`,
    sections: [],
  };
}

/** CSV export matching the Google Sheet's Daily Log columns. */
export function toCsv(entries) {
  const cols = ['Date', 'Project', 'Task', 'Work Done', 'Category', 'Time Spent (hrs)', 'Notes / Next Steps'];
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => [fmtDate(e.date, true), e.project, e.task, e.workDone, e.category, fmtNum(e.hours), e.notes].map(q).join(','));
  return [cols.map(q).join(','), ...rows].join('\n');
}
