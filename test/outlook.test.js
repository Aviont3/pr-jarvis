import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand } from '../public/js/parser.js';
import { emailSummary, morningBrief } from '../public/js/insights.js';
import { Jarvis } from '../public/js/jarvis.js';
import { explainMsError, loginUrl, outlookStatus } from '../outlook.js';

const p = (s) => parseCommand(s, { projects: [], now: new Date(2026, 10, 11, 9) });

test('email questions parse; logging an email is still logging', () => {
  for (const s of ['any new emails?', 'check my email', 'read me my emails', "what's in my inbox", 'do I have any new mail', 'new emails', 'inbox']) {
    assert.equal(p(s).intent, 'email_check', s);
  }
  assert.equal(p('any important emails').important, true);
  assert.equal(p('log 20 minutes emailing the client about the embargo').intent, 'log');
  assert.equal(p('remind me to check my email from Sarah tomorrow').intent, 'todo_add');
});

const msgs = [
  { from: 'Sarah Kim', subject: 'Embargo lifts at 9am', important: true, focused: true },
  { from: 'Nike Comms', subject: 'Move our call?', important: false, focused: true },
  { from: 'PR Weekly', subject: 'Sale', important: false, focused: false },
];

test('email summaries', () => {
  assert.match(emailSummary(msgs).speech, /3 unread emails, 2 look important\. Top of the pile: Sarah Kim about Embargo lifts at 9am and Nike Comms about Move our call\?/);
  assert.match(emailSummary(msgs, { importantOnly: true }).speech, /2 important new emails/);
  assert.match(emailSummary([]).speech, /No new emails/);
  const brief = morningBrief({ settings: {}, entries: [], todos: [], inbox: { enabled: true, messages: msgs } }, new Date(2026, 10, 11, 9));
  assert.ok(brief.sections.some((s) => s.heading === '📧 New emails'));
});

test('Jarvis answers about email only when Outlook is connected', async () => {
  const base = { settings: {}, entries: [], todos: [] };
  const j1 = new Jarvis(() => base, {});
  assert.match((await j1.handle('any new emails?')).speech, /Outlook isn’t connected/);
  const j2 = new Jarvis(() => ({ ...base, outlook: { connected: true }, inbox: { enabled: true, messages: msgs } }), {});
  assert.match((await j2.handle('any new emails?')).speech, /3 unread emails/);
});

test('Microsoft sign-in link and plain-English errors', () => {
  const url = new URL(loginUrl({ msClientId: 'abc', msTenant: 'organizations' }, 'http://localhost:4747/api/outlook/callback'));
  assert.equal(url.pathname, '/organizations/oauth2/v2.0/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(url.searchParams.get('scope'), /Mail\.Read/);
  assert.doesNotMatch(url.searchParams.get('scope'), /Mail\.Send|ReadWrite/); // read-only
  assert.equal(explainMsError('consent_required', 'AADSTS65001: not consented').needsAdmin, true);
  assert.match(explainMsError('invalid_request', 'AADSTS50011: redirect mismatch').message, /Redirect URI/);
  const st = outlookStatus({ refreshToken: 'secret', account: { email: 'a@b.c' } }, { msClientId: 'abc' });
  assert.equal(st.connected, true);
  assert.ok(!JSON.stringify(st).includes('secret'));
});
