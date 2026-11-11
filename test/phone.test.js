import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairingCode, tryPair, deviceFor, blockedForPhone } from '../phone.js';

const req = (cookie = '', ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)') => ({ headers: { cookie, 'user-agent': ua } });

test('pairing: right code once, wrong codes refused, too many tries resets', () => {
  const { code } = pairingCode(true);
  assert.match(code, /^\d{6}$/);
  assert.match(tryPair('000000' === code ? '111111' : '000000', req()).error, /doesn’t match/);
  const ok = tryPair(code, req());
  assert.equal(ok.device.name, 'iPhone');
  assert.match(ok.cookie, /HttpOnly; SameSite=Lax/);
  assert.ok(!JSON.stringify(ok.device).includes(ok.cookie.split('=')[1].split(';')[0]), 'only a hash is stored');
  assert.match(tryPair(code, req()).error, /doesn’t match/, 'a code works only once');
  // the paired phone is recognised by its cookie; others are not
  const devices = [ok.device];
  assert.equal(deviceFor(req(ok.cookie.split(';')[0]), devices)?.id, ok.device.id);
  assert.equal(deviceFor(req('jarvis_device=nope'), devices), null);
  // brute force: after 8 wrong tries the code changes
  const c2 = pairingCode(true).code;
  for (let i = 0; i < 8; i++) tryPair('999999' === c2 ? '888888' : '999999', req());
  assert.match(tryPair(c2, req()).error, /Too many wrong codes/);
  assert.notEqual(pairingCode().code, c2);
});

test('phones cannot change settings, restore, update or manage phones', () => {
  assert.equal(blockedForPhone('/api/settings', 'PATCH'), true);
  assert.equal(blockedForPhone('/api/backup/restore', 'POST'), true);
  assert.equal(blockedForPhone('/api/update', 'POST'), true);
  assert.equal(blockedForPhone('/api/phone/status', 'GET'), true);
  assert.equal(blockedForPhone('/api/entries', 'POST'), false);
  assert.equal(blockedForPhone('/api/state', 'GET'), false);
});
