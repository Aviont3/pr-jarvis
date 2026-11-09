import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseSpecificDate } from '../public/js/parser.js';
import { answerLog, answerHours, buildReport } from '../public/js/insights.js';
import { periodRange } from '../public/js/util.js';

const NOW = new Date(2026, 10, 9, 15); // Mon Nov 9 2026
const ctx = { projects: ['Acme Corp Rebrand', 'Nike Holiday'], now: NOW };
const p = (s) => parseCommand(s, ctx);

test('understands specific past days', () => {
  const d = (s) => parseSpecificDate(s, NOW)?.date;
  assert.equal(d('October 19th'), '2026-10-19');
  assert.equal(d('oct 19'), '2026-10-19');
  assert.equal(d('the 19th of October'), '2026-10-19');
  assert.equal(d('10/19'), '2026-10-19');
  assert.equal(d('10/19/2025'), '2025-10-19');
  assert.equal(d('December 3rd'), '2025-12-03'); // future date without a year = last year
  assert.equal(d('last Tuesday'), '2026-11-03');
  assert.equal(d('3 days ago'), '2026-11-06');
  assert.equal(d('February 31'), undefined);
});

test('day lookups by voice', () => {
  for (const s of ['what did I do on October 19th', 'pull up 10/19', 'everything I worked on Oct 19', 'October 19th', 'show me Oct 19']) {
    const r = p(s);
    assert.deepEqual([r.intent, r.period], ['query_log', 'day:2026-10-19'], s);
  }
  assert.equal(p('how many hours on Oct 19').period, 'day:2026-10-19');
  assert.equal(p('report for October 19').period, 'day:2026-10-19');
  // to-dos keep using due dates, not lookups
  assert.equal(p('remind me to call the venue on friday').intent, 'todo_add');
});

test('log work for a past day', () => {
  const a = p('yesterday I spent 2 hours drafting the Acme release');
  assert.deepEqual([a.intent, a.date, a.hours, a.workDone], ['log', '2026-11-08', 2, 'Drafting the Acme release']);
  const b = p('log 1 hour on Oct 19 drafting the Nike pitch');
  assert.deepEqual([b.date, b.project, b.workDone], ['2026-10-19', 'Nike Holiday', 'Drafting the Nike pitch']);
  assert.equal(p('log 30 minutes pitching Axios').date, '');
});

test('answers for one day', () => {
  const state = {
    settings: {},
    entries: [
      { id: '1', date: '2026-10-19', project: 'Acme Corp Rebrand', workDone: 'Drafted release', task: 'Drafted release', category: 'Press Releases & Writing', hours: 2, createdAt: '2026-10-19T14:00:00Z' },
      { id: '2', date: '2026-10-19', project: 'Nike Holiday', workDone: 'Pitched Vogue', task: 'Pitched Vogue', category: 'Media Relations & Pitching', hours: 0.5, createdAt: '2026-10-19T16:00:00Z' },
      { id: '3', date: '2026-10-20', project: 'Nike Holiday', workDone: 'Other day', hours: 1 },
    ],
    todos: [{ id: 't', text: 'Send media list', done: true, doneAt: '2026-10-19T18:00:00Z' }],
  };
  assert.equal(periodRange('day:2026-10-19', NOW).label, 'on Mon, Oct 19');
  const r = answerLog(state, { period: 'day:2026-10-19' }, NOW);
  assert.match(r.speech, /^On Mon, Oct 19 you logged 2 entries, 2 hr 30 min in total/);
  assert.deepEqual(r.sections.map((s) => s.heading), ['2 entries · 2 hr 30 min', 'By project', 'To-dos finished']);
  assert.match(answerLog(state, { period: 'day:2026-10-18' }, NOW).speech, /Nothing was logged on Sun, Oct 18/);
  assert.match(answerHours(state, { period: 'day:2026-10-19', project: 'Nike Holiday' }, NOW).speech, /30 min on Nike Holiday on Mon, Oct 19/);
  assert.match(buildReport(state, { period: 'day:2026-10-19' }, NOW).text, /Total: 2.50 hrs across 2 entries/);
});
