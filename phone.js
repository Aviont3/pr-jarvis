// 📱 Phone access: lets a phone on the same Wi-Fi use Jarvis, while all data stays on this Mac.
//
// Off by default. When it's on, Jarvis also listens on the local network (port 4748), but
// every request must come from a phone that was paired with a 6-digit code shown on the Mac.
// Paired phones get a long random key in a cookie; only a hash of that key is stored.

import crypto from 'node:crypto';
import os from 'node:os';

export const PHONE_PORT = Number(process.env.JARVIS_PHONE_PORT) || 4748;
const CODE_TTL = 10 * 60 * 1000;
const COOKIE = 'jarvis_device';

let pairing = { code: null, expiresAt: 0, failures: 0 };

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** Current pairing code (a new one every 10 minutes, after each pairing, or after too many wrong tries). */
export function pairingCode(force = false) {
  if (force || !pairing.code || Date.now() > pairing.expiresAt) {
    pairing = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expiresAt: Date.now() + CODE_TTL, failures: 0 };
  }
  return pairing;
}

/** This Mac's addresses on the local network, best first. */
export function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      const rank = /^en0$|^wlan0$|^wl/.test(name) ? 0 : /^en\d|^eth/.test(name) ? 1 : 2;
      out.push({ address: a.address, rank });
    }
  }
  return out.sort((x, y) => x.rank - y.rank).map((x) => x.address);
}

function deviceName(ua = '') {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Device';
}

function cookieValue(req) {
  const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`));
  return m ? m[1] : null;
}

/** The paired device making this request, or null. */
export function deviceFor(req, devices) {
  const key = cookieValue(req);
  if (!key) return null;
  const h = hash(key);
  return devices.find((d) => d.keyHash === h) || null;
}

/** Check a code; on success return { device, cookie } for a newly paired phone. */
export function tryPair(code, req) {
  const p = pairingCode();
  if (p.failures >= 8) { pairingCode(true); return { error: 'Too many wrong codes. Look at your Mac for a new code.' }; }
  if (String(code || '').replace(/\D/g, '') !== p.code) {
    p.failures += 1;
    return { error: 'That code doesn’t match. Check the 6-digit code in Jarvis on your Mac (⚙️ Settings → 📱 Phone).' };
  }
  const key = crypto.randomBytes(32).toString('base64url');
  const device = {
    id: crypto.randomBytes(6).toString('hex'),
    name: deviceName(req.headers['user-agent']),
    keyHash: hash(key),
    pairedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };
  pairingCode(true); // each code works once
  const cookie = `${COOKIE}=${key}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${400 * 24 * 3600}`;
  return { device, cookie };
}

/** Things a phone may not do (they stay on the Mac). */
export function blockedForPhone(pathname, method) {
  return /^\/api\/(update|phone\/|apps-script|backup\/restore)/.test(pathname)
    || /^\/api\/outlook\/(login|callback|disconnect)/.test(pathname)
    || (pathname === '/api/settings' && method !== 'GET');
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The "enter your code" page a phone sees before it's paired. */
export function pairPage(message = '', ok = false) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect to Jarvis</title><link rel="icon" href="/icon.png"><link rel="apple-touch-icon" href="/icon.png">
<style>body{font-family:-apple-system,ui-rounded,system-ui,sans-serif;background:linear-gradient(160deg,#ffe3ee,#fffaf2 50%,#dff5e6);min-height:100vh;margin:0;display:grid;place-items:center;color:#3a2c35}
.c{background:#fff;border-radius:26px;padding:30px 26px;width:min(360px,88vw);text-align:center;box-shadow:0 14px 40px rgba(232,100,154,.15)}
h1{font-size:22px;margin:8px 0}p{line-height:1.5;color:#6b5763}input{font-size:30px;letter-spacing:.3em;text-align:center;width:100%;box-sizing:border-box;padding:12px;border-radius:16px;border:2px solid #f3dde6;margin:12px 0}
button{width:100%;font-size:17px;font-weight:700;padding:14px;border:0;border-radius:999px;background:#3f9d6a;color:#fff}.m{color:${ok ? '#2f8a5a' : '#d94c63'};font-weight:600}</style></head>
<body><form class="c" method="POST" action="/pair"><div style="font-size:52px">🌸</div><h1>Connect to Jarvis</h1>
<p>On your Mac, open Jarvis → ⚙️ Settings → 📱 Phone, and type the 6-digit code shown there.</p>
${message ? `<p class="m">${esc(message)}</p>` : ''}
<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="••••••" required autofocus>
<button>Connect</button></form></body></html>`;
}
