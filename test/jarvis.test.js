import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Jarvis } from '../public/js/jarvis.js';
import { DEFAULT_CATEGORY_KEYWORDS } from '../public/js/parser.js';
import { buildReport, morningBrief, wrapUp } from '../public/js/insights.js';

const NOW = new Date(2026, 10, 10, 10, 0); // Tue Nov 10 2026

function setup() {
  const state = {
    settings: {
      projects: ['Acme Corp Rebrand', 'Nike Holiday'], categories: Object.keys(DEFAULT_CATEGORY_KEYWORDS),
      keywords: DEFAULT_CATEGORY_KEYWORDS, notesToTodos: true, userName: 'Sam',
    },
    entries: [
      { id: 'e1', date: '2026-11-09', project: 'Acme Corp Rebrand', task: 'Press release', workDone: 'Drafted press release', category: 'Press Releases & Writing', hours: 2, notes: 'Send to client', createdAt: '2026-11-09T15:00:00Z' },
    ],
    todos: [
      { id: 't1', text: 'Follow up with Axios', project: '', due: '2026-11-09', priority: 'high', done: false, createdAt: '2026-11-08' },
      { id: 't2', text: 'Book venue', project: 'Nike Holiday', due: '', priority: 'normal', done: false, createdAt: '2026-11-08' },
    ],
    timer: null,
  };
  let n = 0;
  const actions = {
    addEntry: async (e) => { const x = { ...e, id: `n${++n}` }; state.entries.push(x); return x; },
    addTodo: async (t) => { const x = { priority: 'normal', ...t, id: `t${++n}`, done: false }; state.todos.push(x); return x; },
    updateTodo: async (id, f) => Object.assign(state.todos.find((x) => x.id === id), f),
    startTimer: async (t) => { state.timer = { ...t, startedAt: new Date(NOW - 30 * 60000).toISOString() }; },
    stopTimer: async (note) => { const t = state.timer; state.timer = null; const e = { ...t, workDone: t.task + (note ? `: ${note}` : ''), hours: 0.5, id: `n${++n}` }; state.entries.push(e); return e; },
    cancelTimer: async () => { state.timer = null; },
  };
  return { state, j: new Jarvis(() => state, actions, () => NOW) };
}

test('log needs confirmation, then yes saves', async () => {
  const { state, j } = setup();
  const r = await j.handle('log 45 minutes on Acme: pitched 3 reporters');
  assert.equal(r.card.kind, 'entry');
  assert.equal(state.entries.length, 1);
  const r2 = await j.handle('yes');
  assert.ok(r2.saved);
  assert.equal(state.entries.length, 2);
  assert.equal(state.entries[1].hours, 0.75);
  assert.equal(state.entries[1].project, 'Acme Corp Rebrand');
});

test('missing time triggers a follow-up question', async () => {
  const { state, j } = setup();
  const r = await j.handle('pitched the Nike story to Vogue');
  assert.match(r.speech, /How long/);
  await j.handle('30 minutes');
  await j.handle('yes');
  assert.equal(state.entries.at(-1).hours, 0.5);
  assert.equal(state.entries.at(-1).project, 'Nike Holiday');
});

test('completing a to-do offers to log time', async () => {
  const { state, j } = setup();
  const r = await j.handle('check off follow up with Axios');
  assert.match(r.speech, /Checked off/);
  assert.equal(state.todos[0].done, true);
  await j.handle('20 minutes');
  await j.handle('yes');
  assert.equal(state.entries.at(-1).workDone, 'Follow up with Axios');
});

test('timer start and stop', async () => {
  const { state, j } = setup();
  await j.handle('start working on Nike Holiday media list');
  assert.equal(state.timer.project, 'Nike Holiday');
  const r = await j.handle('stop');
  assert.match(r.speech, /Logged 30 min/);
  assert.equal(state.timer, null);
});

test('brief, wrap-up and report', () => {
  const { state } = setup();
  const b = morningBrief(state, NOW);
  assert.match(b.speech, /Good morning, Sam/);
  assert.match(b.speech, /Yesterday you logged 2 hours/);
  assert.match(b.speech, /1 overdue/);
  const w = wrapUp(state, NOW);
  assert.match(w.speech, /haven't logged anything today/);
  const rep = buildReport(state, { period: 'this week' }, NOW);
  assert.match(rep.text, /Total: 2.00 hrs/);
  assert.match(rep.text, /Acme Corp Rebrand \(2.00 hrs\)/);
});
