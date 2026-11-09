import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, DEFAULT_CATEGORY_KEYWORDS } from '../public/js/parser.js';
import { Jarvis } from '../public/js/jarvis.js';

const NOW = new Date(2026, 10, 9, 15); // Mon Nov 9 2026
const p = (s) => parseCommand(s, { projects: ['Nike Holiday'], now: NOW });

test('due-date commands parse', () => {
  const cases = {
    'move follow up with Axios to Friday': ['Follow up with Axios', '2026-11-13'],
    'push the venue to next week': ['Venue', '2026-11-16'],
    'change the due date of the media list to 11/20': ['Media list', '2026-11-20'],
    'reschedule call Vogue for tomorrow': ['Call Vogue', '2026-11-10'],
    'make the recap due next friday': ['Recap', '2026-11-20'],
    'remove the due date from the venue': ['Venue', ''],
  };
  for (const [s, [q, due]] of Object.entries(cases)) {
    const r = p(s);
    assert.deepEqual([r.intent, r.query, r.due], ['todo_due', q, due], s);
  }
  // not hijacked: these keep their old meaning
  assert.equal(p('change that to 45 minutes').intent, 'entry_edit');
  assert.equal(p('remind me to move the venue to friday').intent, 'todo_add');
});

test('Jarvis moves the matching to-do', async () => {
  const state = {
    settings: { projects: [], categories: Object.keys(DEFAULT_CATEGORY_KEYWORDS), keywords: DEFAULT_CATEGORY_KEYWORDS },
    entries: [],
    todos: [{ id: 'a', text: 'Follow up with Axios', due: '', done: false }, { id: 'b', text: 'Book the venue', due: '2026-11-10', done: false }],
  };
  const j = new Jarvis(() => state, { updateTodo: async (id, f) => Object.assign(state.todos.find((t) => t.id === id), f) }, () => NOW);
  assert.match((await j.handle('move follow up with Axios to Friday')).speech, /now due Fri, Nov 13/);
  assert.equal(state.todos[0].due, '2026-11-13');
  await j.handle('remove the due date from the venue');
  assert.equal(state.todos[1].due, '');
  assert.match((await j.handle('move the gala to friday')).speech, /couldn't find/);
});
