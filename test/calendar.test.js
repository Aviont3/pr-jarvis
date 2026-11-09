import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, DEFAULT_CATEGORY_KEYWORDS } from '../public/js/parser.js';
import { meetingToEntry, answerMeetings, unloggedMeetings, morningBrief, wrapUp } from '../public/js/insights.js';
import { Jarvis } from '../public/js/jarvis.js';

const NOW = new Date(2026, 10, 10, 14, 0); // Tue Nov 10 2026, 2pm local
const at = (h, m = 0) => new Date(2026, 10, 10, h, m).toISOString();
const settings = {
  projects: ['Acme Corp Rebrand', 'Nike Holiday'], categories: Object.keys(DEFAULT_CATEGORY_KEYWORDS),
  keywords: DEFAULT_CATEGORY_KEYWORDS, calendarEnabled: true, meetingCategory: 'Internal Meetings',
};
const events = [
  { id: 'a', title: 'Acme check-in', start: at(9), end: at(9, 30), date: '2026-11-10' },
  { id: 'b', title: 'Team standup', start: at(11), end: at(11, 15), date: '2026-11-10' },
  { id: 'c', title: 'Nike launch strategy', start: at(16), end: at(17), date: '2026-11-10' },
  { id: 'd', title: 'Vogue interview prep', start: new Date(2026, 10, 11, 10).toISOString(), end: new Date(2026, 10, 11, 11).toISOString(), date: '2026-11-11' },
];

test('calendar commands parse', () => {
  const p = (s) => parseCommand(s, { projects: settings.projects, now: NOW });
  assert.equal(p('what meetings do I have today').intent, 'calendar_list');
  assert.equal(p("what's on my calendar tomorrow").period, 'tomorrow');
  assert.equal(p("when's my next meeting").next, true);
  assert.equal(p('log my meetings').intent, 'calendar_log');
  assert.deepEqual([p('log the Acme check-in meeting').intent, p('log the Acme check-in meeting').query], ['calendar_log', 'Acme check-in']);
  // a normal log with a duration is still a normal log
  assert.equal(p('log 30 minutes client call with Nike').intent, 'log');
});

test('meeting becomes an entry with project and category', () => {
  const a = meetingToEntry(events[0], settings);
  assert.equal(a.hours, 0.5);
  assert.equal(a.project, 'Acme Corp Rebrand');
  assert.equal(a.category, 'Client Communication');
  assert.equal(a.calendarEventId, 'a');
  assert.equal(meetingToEntry(events[1], settings).category, 'Internal Meetings');
  assert.equal(meetingToEntry(events[2], settings).category, 'Strategy & Planning');
});

test('answers, brief and wrap-up include meetings', () => {
  const state = { settings, entries: [{ id: 'x', date: '2026-11-10', hours: 0.5, calendarEventId: 'a' }], todos: [], timer: null, events };
  assert.deepEqual(unloggedMeetings(state, NOW).map((e) => e.id), ['b']);
  assert.match(answerMeetings(state, { period: 'today' }, NOW).speech, /3 meetings today.*Next up: Nike launch strategy/);
  assert.match(answerMeetings(state, { period: 'tomorrow' }, NOW).speech, /1 meeting tomorrow/);
  assert.match(answerMeetings(state, { next: true }, NOW).speech, /Nike launch strategy, at 4:00 PM/);
  assert.match(morningBrief(state, NOW).speech, /3 meetings today, starting with Acme check-in/);
  assert.match(wrapUp(state, NOW).speech, /1 of today's meetings isn't logged/);
});

test('"log my meetings" logs finished, unlogged meetings once', async () => {
  const state = { settings, entries: [], todos: [], timer: null, events };
  const added = [];
  const j = new Jarvis(() => state, { addEntry: async (e) => { added.push(e); state.entries.push(e); return e; } }, () => NOW);
  const r = await j.handle('log my meetings');
  assert.equal(added.length, 2);
  assert.match(r.speech, /Logged 2 meetings, 45 min/);
  const r2 = await j.handle('log my meetings');
  assert.equal(added.length, 2);
  assert.match(r2.speech, /already logged/);
});
