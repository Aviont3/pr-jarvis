import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, DEFAULT_CATEGORY_KEYWORDS } from '../public/js/parser.js';
import { Jarvis } from '../public/js/jarvis.js';

const NOW = new Date(2026, 10, 9, 15);
const projects = ['Acme Corp Rebrand', 'Nike Holiday'];
const p = (s) => parseCommand(s, { projects, now: NOW });

test('fix-it commands parse', () => {
  for (const s of ['delete my last entry', 'undo that', 'undo', 'remove the last one', 'delete that']) assert.equal(p(s).intent, 'entry_delete', s);
  assert.deepEqual([p('change that to 45 minutes').intent, p('change that to 45 minutes').hours], ['entry_edit', 0.75]);
  assert.equal(p('change that to Nike Holiday').project, 'Nike Holiday');
  assert.equal(p('change the last entry to yesterday').date, '2026-11-08');
  assert.equal(p('edit my last entry').intent, 'entry_edit');
  // not confused with normal commands
  assert.equal(p('log 1 hour drafting the release').intent, 'log');
  assert.equal(p('cancel').intent, 'no');
});

function setup() {
  const state = {
    settings: { projects, categories: Object.keys(DEFAULT_CATEGORY_KEYWORDS), keywords: DEFAULT_CATEGORY_KEYWORDS },
    entries: [
      { id: 'old', date: '2026-10-19', workDone: 'Old work', hours: 1, createdAt: '2026-10-19T10:00:00Z' },
      { id: 'new', date: '2026-11-09', workDone: 'Pitched Axios', project: 'Acme Corp Rebrand', hours: 0.5, createdAt: '2026-11-09T14:00:00Z' },
    ],
    todos: [],
  };
  const actions = {
    addEntry: async (e) => { const x = { ...e, id: `n${state.entries.length}`, createdAt: new Date().toISOString() }; state.entries.push(x); return x; },
    updateEntry: async (id, f) => Object.assign(state.entries.find((e) => e.id === id), f),
    deleteEntry: async (id) => { const entry = state.entries.find((e) => e.id === id); state.entries = state.entries.filter((e) => e.id !== id); return { entry, todos: [] }; },
  };
  return { state, j: new Jarvis(() => state, actions, () => NOW) };
}

test('"delete my last entry" asks first, then deletes the newest one with undo info', async () => {
  const { state, j } = setup();
  const r = await j.handle('delete my last entry');
  assert.match(r.speech, /Delete “Pitched Axios” \(30 min, Mon, Nov 9\)\? Say yes/);
  assert.equal(state.entries.length, 2);
  const r2 = await j.handle('yes');
  assert.deepEqual(state.entries.map((e) => e.id), ['old']);
  assert.equal(r2.undo.entry.id, 'new');
});

test('"no" keeps the entry', async () => {
  const { state, j } = setup();
  await j.handle('undo that');
  await j.handle('no');
  assert.equal(state.entries.length, 2);
});

test('"change that to 45 minutes / Nike" updates the newest entry', async () => {
  const { state, j } = setup();
  const r = await j.handle('change that to 45 minutes');
  assert.equal(state.entries[1].hours, 0.75);
  assert.match(r.speech, /Updated\. It's now 45 min on Acme Corp Rebrand/);
  await j.handle('change that to Nike Holiday');
  assert.equal(state.entries[1].project, 'Nike Holiday');
  const open = await j.handle('edit my last entry');
  assert.equal(open.openEntry.id, 'new');
});

test('changing a draft before it is saved edits the draft', async () => {
  const { state, j } = setup();
  await j.handle('log 30 minutes pitching Vogue for Acme');
  const r = await j.handle('change that to 1 hour');
  assert.equal(r.card.entry.hours, 1);
  assert.equal(state.entries.length, 2); // still not saved
  await j.handle('yes');
  assert.equal(state.entries.length, 3);
  assert.equal(state.entries[2].hours, 1);
});
