import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, parseDuration, parseDue } from '../public/js/parser.js';

const now = new Date(2026, 10, 9, 10, 0); // Mon Nov 9 2026
const ctx = { projects: ['Example: Spring Product Launch', 'Acme Corp Rebrand', 'Nike Holiday'], now };
const p = (s) => parseCommand(s, ctx);

test('durations', () => {
  const cases = {
    '45 minutes': 0.75, '1.5 hours': 1.5, 'an hour and a half': 1.5, 'half an hour': 0.5,
    '2 hours 15 minutes': 2.25, '1h30': 1.5, '90 mins': 1.5, 'two hours': 2, 'an hour': 1, '3 hrs': 3,
  };
  for (const [s, h] of Object.entries(cases)) assert.equal(parseDuration(`did stuff for ${s}`)?.hours, h, s);
  assert.equal(parseDuration('pitched 5 reporters'), null);
});

test('due dates', () => {
  assert.equal(parseDue('call them tomorrow', now).due, '2026-11-10');
  assert.equal(parseDue('by friday', now).due, '2026-11-13');
  assert.equal(parseDue('next friday', now).due, '2026-11-20');
  assert.equal(parseDue('on monday', now).due, '2026-11-16');
  assert.equal(parseDue('due 12/1', now).due, '2026-12-01');
  assert.equal(parseDue('end of week', now).due, '2026-11-13');
});

test('log with project, category and next step', () => {
  const r = p('Jarvis, log 45 minutes on Spring Launch: pitched TechCrunch and Axios, waiting on replies');
  assert.equal(r.intent, 'log');
  assert.equal(r.hours, 0.75);
  assert.equal(r.project, 'Example: Spring Product Launch');
  assert.equal(r.workDone, 'Pitched TechCrunch and Axios');
  assert.equal(r.category, 'Media Relations & Pitching');
  assert.equal(r.notes, 'Waiting on replies');
});

test('log keeps project mention inside the description', () => {
  const r = p('Spent an hour and a half drafting the Acme press release. Next step: send to client for review');
  assert.equal(r.hours, 1.5);
  assert.equal(r.project, 'Acme Corp Rebrand');
  assert.equal(r.workDone, 'Drafting the Acme press release');
  assert.equal(r.category, 'Press Releases & Writing');
  assert.equal(r.notes, 'Send to client for review');
});

test('timer', () => {
  const s = p('start working on Acme Corp Rebrand press release');
  assert.equal(s.intent, 'timer_start');
  assert.equal(s.project, 'Acme Corp Rebrand');
  assert.equal(s.task, 'Press release');
  assert.equal(p('stop').intent, 'timer_stop');
  assert.equal(p("I'm done").intent, 'timer_stop');
  assert.equal(p('cancel the timer').intent, 'timer_cancel');
});

test('to-dos', () => {
  const a = p('add to-do: follow up with Axios Friday');
  assert.deepEqual([a.intent, a.todo, a.due], ['todo_add', 'Follow up with Axios', '2026-11-13']);
  const b = p('remind me to send the Nike recap tomorrow, urgent');
  assert.deepEqual([b.todo, b.due, b.priority, b.project], ['Send the Nike recap', '2026-11-10', 'high', 'Nike Holiday']);
  assert.equal(p('add call the venue to my list').todo, 'Call the venue');
  assert.equal(p("what's on my list").intent, 'todo_list');
  assert.equal(p('check off follow up with Axios').intent, 'todo_complete');
});

test('questions, reports and rhythm', () => {
  const q = p('how many hours did I spend on Acme this month');
  assert.deepEqual([q.intent, q.period, q.project], ['query_hours', 'this month', 'Acme Corp Rebrand']);
  assert.equal(p('what did I do yesterday').period, 'yesterday');
  assert.equal(p('weekly report').intent, 'report');
  assert.equal(p('write a report for Nike Holiday last week').period, 'last week');
  assert.equal(p('good morning jarvis').intent, 'brief');
  assert.equal(p('wrap up my day').intent, 'wrapup');
  // "report" inside a log is still a log
  assert.equal(p('log 1 hour drafting the monthly report').intent, 'log');
});
