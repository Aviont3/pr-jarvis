import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, DEFAULT_CATEGORY_KEYWORDS } from '../public/js/parser.js';
import { Jarvis } from '../public/js/jarvis.js';

const NOW = new Date(2026, 10, 9, 15);
const projects = ['Acme Corp Rebrand', 'Nike Holiday', 'Spring Product Launch'];
const p = (s) => parseCommand(s, { projects, now: NOW });

test('project commands for to-dos parse', () => {
  const cases = {
    'put follow up with Axios under Acme': ['Follow up with Axios', 'Acme Corp Rebrand'],
    'assign the venue to Nike': ['Venue', 'Nike Holiday'],
    'change the project of the recap to Spring Launch': ['Recap', 'Spring Product Launch'],
    'move the venue to the Nike project': ['Venue', 'Nike Holiday'],
    'file the media list under Spring Launch': ['Media list', 'Spring Product Launch'],
  };
  for (const [s, [q, pr]] of Object.entries(cases)) {
    const r = p(s);
    assert.deepEqual([r.intent, r.query, r.project], ['todo_project', q, pr], s);
  }
  // due dates still win when the target is a date
  assert.equal(p('move the venue to friday').intent, 'todo_due');
  // unknown project name: not treated as a project change
  assert.notEqual(p('put the flowers in the vase').intent, 'todo_project');
  // list for one project; new to-dos still pick up the project
  assert.deepEqual([p("what's on my list for Acme").intent, p("what's on my list for Acme").project], ['todo_list', 'Acme Corp Rebrand']);
  assert.equal(p('remind me to email Vogue for Nike tomorrow').project, 'Nike Holiday');
});

test('Jarvis files a to-do under a project and lists by project', async () => {
  const state = {
    settings: { projects, categories: Object.keys(DEFAULT_CATEGORY_KEYWORDS), keywords: DEFAULT_CATEGORY_KEYWORDS },
    entries: [],
    todos: [
      { id: 'a', text: 'Follow up with Axios', project: '', due: '', done: false },
      { id: 'b', text: 'Book the venue', project: 'Nike Holiday', due: '', done: false },
    ],
  };
  const j = new Jarvis(() => state, { updateTodo: async (id, f) => Object.assign(state.todos.find((t) => t.id === id), f) }, () => NOW);
  assert.match((await j.handle('put follow up with Axios under Acme')).speech, /now under Acme Corp Rebrand/);
  assert.equal(state.todos[0].project, 'Acme Corp Rebrand');
  const r = await j.handle("what's on my list for Nike");
  assert.match(r.speech, /1 open item for Nike Holiday/);
  assert.match((await j.handle("what's on my list for Spring Launch")).speech, /list for Spring Product Launch is clear/);
});
