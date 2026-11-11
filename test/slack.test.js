import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { parseCommand } from '../public/js/parser.js';
import { toSlackText, validWebhook } from '../slack.js';

const p = (s) => parseCommand(s, { projects: ['Acme Corp Rebrand', 'Nike Holiday'], now: new Date(2026, 10, 11, 9) });

test('Slack commands parse', () => {
  const k = (s) => { const r = p(s); return [r.intent, r.kind, r.project]; };
  assert.deepEqual(k('post my wrap-up to Slack'), ['slack_post', 'wrapup', '']);
  assert.deepEqual(k('send the weekly report to slack'), ['slack_post', 'report', '']);
  assert.deepEqual(k('share the Acme agenda on Slack'), ['slack_post', 'agenda', 'Acme Corp Rebrand']);
  assert.deepEqual(k('post the Nike coverage to slack'), ['slack_post', 'coverage', 'Nike Holiday']);
  assert.equal(p('log 15 minutes answering slack messages').intent, 'log');
});

test('Slack formatting and links', () => {
  assert.equal(validWebhook('https://hooks.slack.com/services/T000/B000/XXXX'), true);
  assert.equal(validWebhook('https://example.com/hook'), false);
  const text = toSlackText({ title: 'End of day', speech: 'You logged 3 hours & 2 <entries>.', sections: [{ heading: 'Today', items: ['Acme: 2 hours'] }] });
  assert.equal(text, '*End of day*\nYou logged 3 hours &amp; 2 &lt;entries&gt;.\n\n*Today*\n• Acme: 2 hours');
});

test('Slack errors become plain English', async () => {
  process.env.JARVIS_SLACK_ALLOW_LOCAL = '1';
  const { postToSlack } = await import(`../slack.js?local=${Date.now()}`);
  const server = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
      if (req.url === '/gone') { res.writeHead(404); return res.end('no_service'); }
      assert.equal(JSON.parse(b).text, 'hi');
      res.writeHead(200); res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal(await postToSlack(`${base}/ok`, 'hi'), true);
  await assert.rejects(postToSlack(`${base}/gone`, 'hi'), /webhook was removed/);
  server.close();
});
