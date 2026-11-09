import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, DEFAULT_CATEGORY_KEYWORDS } from '../public/js/parser.js';
import { answerTodos, dueWindow } from '../public/js/insights.js';
import { Jarvis } from '../public/js/jarvis.js';

const NOW = new Date(2026, 10, 9, 15); // Mon Nov 9 2026
const p = (s) => parseCommand(s, { projects: ['Acme Corp Rebrand'], now: NOW });

test('urgency commands parse', () => {
  const cases = {
    'make follow up with Axios urgent': ['Follow up with Axios', 'high'],
    'mark the venue as low priority': ['Venue', 'low'],
    'the recap isn\'t urgent': ['Recap', 'normal'],
    'set the media list to high priority': ['Media list', 'high'],
    'make the venue normal priority': ['Venue', 'normal'],
  };
  for (const [s, [q, pri]] of Object.entries(cases)) {
    const r = p(s);
    assert.deepEqual([r.intent, r.query, r.priority], ['todo_priority', q, pri], s);
  }
  // other commands keep their meaning
  assert.equal(p('remind me to call the venue tomorrow, urgent').intent, 'todo_add');
  assert.equal(p('log 30 minutes prepping the upcoming launch').intent, 'log');
});

test('due-date questions parse', () => {
  const w = (s) => { const r = p(s); return [r.intent, r.window, r.urgent]; };
  assert.deepEqual(w("what's due this week"), ['todo_list', 'this week', false]);
  assert.deepEqual(w("what's due tomorrow"), ['todo_list', 'tomorrow', false]);
  assert.deepEqual(w("what's coming up"), ['todo_list', '7', false]);
  assert.deepEqual(w("what's due in the next 30 days"), ['todo_list', '30', false]);
  assert.deepEqual(w("what's overdue"), ['todo_list', 'overdue', false]);
  assert.deepEqual(w("what's urgent"), ['todo_list', '', true]);
  assert.deepEqual(w('upcoming deadlines'), ['todo_list', '7', false]);
});

test('answers filtered by due date and urgency', () => {
  const state = {
    todos: [
      { id: '1', text: 'Overdue thing', due: '2026-11-05', priority: 'normal', done: false },
      { id: '2', text: 'Tomorrow thing', due: '2026-11-10', priority: 'high', done: false },
      { id: '3', text: 'Friday thing', due: '2026-11-13', priority: 'normal', done: false },
      { id: '4', text: 'Later thing', due: '2026-12-20', priority: 'high', done: false },
      { id: '5', text: 'No date thing', due: '', priority: 'normal', done: false },
    ],
  };
  assert.deepEqual(dueWindow('this week', NOW), { from: '0000-01-01', to: '2026-11-15', label: 'due this week' });
  assert.match(answerTodos(state, NOW, '', { window: 'tomorrow' }).speech, /^You have 1 to-do due tomorrow\. It is: Tomorrow thing/);
  assert.match(answerTodos(state, NOW, '', { window: 'this week' }).speech, /3 to-dos due this week/);
  assert.match(answerTodos(state, NOW, '', { urgent: true }).speech, /2 urgent to-dos/);
  assert.match(answerTodos(state, NOW, '', { window: 'next week' }).speech, /Nothing due next week/);
});

test('Jarvis changes urgency', async () => {
  const state = { settings: { projects: [], categories: Object.keys(DEFAULT_CATEGORY_KEYWORDS), keywords: DEFAULT_CATEGORY_KEYWORDS }, entries: [],
    todos: [{ id: 'a', text: 'Follow up with Axios', priority: 'normal', done: false }] };
  const j = new Jarvis(() => state, { updateTodo: async (id, f) => Object.assign(state.todos.find((t) => t.id === id), f) }, () => NOW);
  assert.match((await j.handle('make follow up with Axios urgent')).speech, /marked urgent/);
  assert.equal(state.todos[0].priority, 'high');
  await j.handle('follow up with Axios is not urgent');
  assert.equal(state.todos[0].priority, 'normal');
});
