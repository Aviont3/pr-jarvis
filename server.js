// Jarvis local server: serves the app, stores data in data/db.json,
// and syncs to Google Sheets through an Apps Script web app. No npm dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATEGORY_KEYWORDS } from './public/js/parser.js';
import { isoDate, roundHours } from './public/js/util.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const INSTALLED = process.env.JARVIS_INSTALLED === '1'; // set by install.sh
const REPO_RAW = 'https://raw.githubusercontent.com/Aviont3/pr-jarvis/main';
const REPO_ZIP = 'https://github.com/Aviont3/pr-jarvis/archive/refs/heads/main.zip';
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = process.env.JARVIS_DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PORT = Number(process.env.PORT) || 4747;
const HOST = '127.0.0.1'; // only reachable from this computer

const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

// ------------------------------------------------------------------ database

const DEFAULT_SETTINGS = () => ({
  userName: '',
  projects: ['Example: Spring Product Launch'],
  categories: Object.keys(DEFAULT_CATEGORY_KEYWORDS),
  keywords: DEFAULT_CATEGORY_KEYWORDS,
  defaultCategory: '',
  notesToTodos: true,
  autoSaveVoiceLogs: false,
  speakReplies: true,
  voiceName: '',
  autoBrief: true,
  checkInMinutes: 0,
  workStart: '09:00',
  workEnd: '18:00',
  sheetUrl: '',
  sheetLink: '',
  sheetToken: crypto.randomBytes(12).toString('hex'),
  calendarEnabled: false,
  calendarAll: false,
  meetingPrompts: true,
  meetingCategory: 'Internal Meetings',
});

function emptyDb() {
  return {
    version: 1,
    settings: DEFAULT_SETTINGS(),
    entries: [],
    todos: [],
    timer: null,
    sync: { queue: [], lastSyncAt: null, lastError: null },
    meta: { lastBriefDate: null },
  };
}

function loadDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) return emptyDb();
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const base = emptyDb();
  return {
    ...base, ...raw,
    settings: { ...base.settings, ...raw.settings },
    sync: { ...base.sync, ...raw.sync },
    meta: { ...base.meta, ...raw.meta },
  };
}

let db = loadDb();

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function backup() {
  if (!fs.existsSync(DB_FILE)) return;
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `db-${isoDate()}.json`);
  if (!fs.existsSync(target)) fs.copyFileSync(DB_FILE, target);
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.startsWith('db-')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - 30))) fs.unlinkSync(path.join(BACKUP_DIR, f));
}

const publicState = () => ({
  settings: db.settings,
  entries: db.entries,
  todos: db.todos,
  timer: db.timer,
  sync: { pending: db.sync.queue.length, lastSyncAt: db.sync.lastSyncAt, lastError: db.sync.lastError },
  meta: db.meta,
});

// ------------------------------------------------------------------ domain

const ENTRY_FIELDS = ['date', 'project', 'task', 'workDone', 'category', 'hours', 'notes', 'calendarEventId'];
const TODO_FIELDS = ['text', 'project', 'due', 'priority', 'done', 'doneAt', 'notes'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

function cleanEntry(e) {
  const out = pick(e, ENTRY_FIELDS);
  if (out.hours !== undefined) out.hours = Math.round((Number(out.hours) || 0) * 100) / 100;
  for (const k of ['project', 'task', 'workDone', 'category', 'notes']) if (out[k] !== undefined) out[k] = String(out[k] ?? '').trim();
  if (out.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(out.date)) out.date = isoDate();
  return out;
}

function addTodo(fields) {
  const td = {
    id: uid(), text: '', project: '', due: '', priority: 'normal', done: false, doneAt: null, notes: '',
    sourceEntryId: null, createdAt: new Date().toISOString(),
    ...pick(fields, [...TODO_FIELDS, 'sourceEntryId']),
  };
  td.text = String(td.text).trim();
  db.todos.push(td);
  enqueue({ op: 'upsertTodo', id: td.id });
  return td;
}

function addEntry(fields) {
  const e = {
    id: uid(), date: isoDate(), project: '', task: '', workDone: '', category: '', hours: 0, notes: '',
    createdAt: new Date().toISOString(), ...cleanEntry(fields),
  };
  if (!e.task) e.task = e.workDone.split(/[.;]/)[0].slice(0, 80);
  db.entries.push(e);
  enqueue({ op: 'upsertEntry', id: e.id });
  if (db.settings.notesToTodos && e.notes) addTodo({ text: e.notes, project: e.project, sourceEntryId: e.id });
  return e;
}

function updateEntry(id, fields) {
  const e = db.entries.find((x) => x.id === id);
  if (!e) return null;
  const before = e.notes;
  Object.assign(e, cleanEntry(fields), { updatedAt: new Date().toISOString() });
  enqueue({ op: 'upsertEntry', id: e.id });
  if (db.settings.notesToTodos && e.notes !== before) {
    const linked = db.todos.find((t) => t.sourceEntryId === e.id && !t.done);
    if (linked && e.notes) { linked.text = e.notes; linked.project = e.project; enqueue({ op: 'upsertTodo', id: linked.id }); }
    else if (!linked && e.notes) addTodo({ text: e.notes, project: e.project, sourceEntryId: e.id });
  }
  return e;
}

function stopTimer(note = '') {
  const t = db.timer;
  if (!t) return null;
  const hours = roundHours((Date.now() - new Date(t.startedAt).getTime()) / 3600000);
  db.timer = null;
  return addEntry({
    date: isoDate(new Date(t.startedAt)),
    project: t.project, task: t.task, category: t.category,
    workDone: note ? `${t.task}: ${note}` : t.task,
    hours,
  });
}

// ------------------------------------------------------------------ Google Sheets sync

function enqueue(op) {
  if (!db.settings.sheetUrl) return;
  // keep only the latest op per item
  // (deletes are queued as upserts of a missing id; see materialize)
  db.sync.queue = db.sync.queue.filter((q) => !(q.op === op.op && q.id === op.id));
  db.sync.queue.push(op);
  scheduleFlush();
}

function enqueueEverything() {
  db.sync.queue = [];
  db.sync.queue.push({ op: 'setLists' });
  for (const e of db.entries) db.sync.queue.push({ op: 'upsertEntry', id: e.id });
  for (const t of db.todos) db.sync.queue.push({ op: 'upsertTodo', id: t.id });
}

// Expand queued ops (which only hold ids) into the payload the Apps Script expects.
function materialize(op) {
  if (op.op === 'upsertEntry') {
    const e = db.entries.find((x) => x.id === op.id);
    return e ? { op: 'upsertEntry', entry: e } : { op: 'deleteEntry', id: op.id };
  }
  if (op.op === 'upsertTodo') {
    const t = db.todos.find((x) => x.id === op.id);
    return t ? { op: 'upsertTodo', todo: t } : { op: 'deleteTodo', id: op.id };
  }
  if (op.op === 'setLists') return { op: 'setLists', projects: db.settings.projects, categories: db.settings.categories };
  return op;
}

async function callSheet(payload) {
  let res;
  try {
    res = await fetch(db.settings.sheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ token: db.settings.sheetToken, ...payload }),
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error("Couldn't reach Google. Check the link and your internet connection.");
  }
  if (res.status === 404) throw new Error('Google says that link doesn’t exist. Copy the Web app link again.');
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    // Common mistake: pasting the code inside Google's empty "function myFunction() { }".
    if (/Script function not found:\s*doPost/i.test(text)) {
      throw new Error('Google can’t find the Jarvis code. In Apps Script, select everything (⌘A), delete it so the editor is empty, paste the code again (there should be no “function myFunction() {” at the top), click Save, then deploy a new version.');
    }
    throw new Error(res.ok
      ? 'Unexpected reply from Google. Check the web app is deployed with access set to "Anyone".'
      : `Google returned HTTP ${res.status}.`);
  }
  if (!json.ok) throw new Error(json.error || 'The sheet script reported an error.');
  return json;
}

let flushTimer = null;
let flushing = false;
function scheduleFlush(delay = 1500) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, delay);
}

async function flush() {
  if (flushing || !db.settings.sheetUrl || !db.sync.queue.length) return;
  flushing = true;
  const batch = db.sync.queue.slice(0, 200);
  try {
    await callSheet({ ops: batch.map(materialize) });
    db.sync.queue = db.sync.queue.slice(batch.length);
    db.sync.lastSyncAt = new Date().toISOString();
    db.sync.lastError = null;
  } catch (err) {
    db.sync.lastError = String(err.message || err);
  } finally {
    flushing = false;
    save();
  }
  if (db.sync.queue.length) scheduleFlush(db.sync.lastError ? 60000 : 500);
}

// ------------------------------------------------------------------ HTTP

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.gs': 'text/plain; charset=utf-8',
};

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function readBody(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 5e6) throw new Error('Request too large');
  }
  return data ? JSON.parse(data) : {};
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

async function api(req, res, pathname) {
  const m = req.method;
  const parts = pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [resource, id, action] = parts;
  const body = ['POST', 'PATCH', 'PUT'].includes(m) ? await readBody(req) : {};
  const ok = (extra = {}) => { save(); return send(res, 200, { state: publicState(), ...extra }); };

  if (resource === 'state' && m === 'GET') return send(res, 200, { state: publicState() });

  if (resource === 'entries') {
    if (m === 'POST' && !id) return ok({ item: addEntry(body) });
    if (m === 'PATCH' && id) { const e = updateEntry(id, body); return e ? ok({ item: e }) : send(res, 404, { error: 'Not found' }); }
    if (m === 'DELETE' && id) {
      db.entries = db.entries.filter((x) => x.id !== id);
      enqueue({ op: 'upsertEntry', id }); // materializes to a delete
      return ok();
    }
  }

  if (resource === 'todos') {
    if (m === 'POST' && !id) {
      if (!String(body.text || '').trim()) return send(res, 400, { error: 'To-do text is required' });
      return ok({ item: addTodo(body) });
    }
    if (m === 'PATCH' && id) {
      const t = db.todos.find((x) => x.id === id);
      if (!t) return send(res, 404, { error: 'Not found' });
      Object.assign(t, pick(body, TODO_FIELDS));
      if (body.done === true && !t.doneAt) t.doneAt = new Date().toISOString();
      if (body.done === false) t.doneAt = null;
      enqueue({ op: 'upsertTodo', id });
      return ok({ item: t });
    }
    if (m === 'DELETE' && id) {
      db.todos = db.todos.filter((x) => x.id !== id);
      enqueue({ op: 'upsertTodo', id });
      return ok();
    }
  }

  if (resource === 'timer' && m === 'POST') {
    if (id === 'start') {
      let stopped = null;
      if (db.timer) stopped = stopTimer('');
      db.timer = {
        project: String(body.project || ''), task: String(body.task || 'Untitled task'),
        category: String(body.category || ''), startedAt: new Date().toISOString(),
      };
      return ok({ item: stopped });
    }
    if (id === 'stop') return ok({ item: stopTimer(String(body.note || '')) });
    if (id === 'cancel') { db.timer = null; return ok(); }
  }

  if (resource === 'settings' && m === 'PATCH') {
    const prevUrl = db.settings.sheetUrl;
    const listsChanged = ['projects', 'categories'].some((k) => body[k] && JSON.stringify(body[k]) !== JSON.stringify(db.settings[k]));
    const allowed = Object.keys(DEFAULT_SETTINGS()).filter((k) => k !== 'sheetToken');
    Object.assign(db.settings, pick(body, allowed));
    if (body.sheetUrl !== undefined) db.settings.sheetUrl = String(body.sheetUrl).trim();
    if (db.settings.sheetUrl && db.settings.sheetUrl !== prevUrl) enqueueEverything();
    else if (listsChanged) enqueue({ op: 'setLists' });
    scheduleFlush(200);
    return ok();
  }

  if (resource === 'meta' && m === 'PATCH') {
    Object.assign(db.meta, body);
    return ok();
  }

  if (resource === 'sync' && m === 'POST') {
    if (!db.settings.sheetUrl) return send(res, 400, { error: 'Add your Google Sheet web app URL in Settings first.' });
    if (id === 'test') {
      try {
        const r = await callSheet({ ops: [{ op: 'ping' }] });
        db.sync.lastError = null;
        return ok({ message: `Connected to "${r.spreadsheet || 'your sheet'}".` });
      } catch (err) {
        db.sync.lastError = String(err.message || err);
        save();
        return send(res, 502, { error: db.sync.lastError, state: publicState() });
      }
    }
    if (id === 'all') enqueueEverything();
    await flush();
    return db.sync.lastError ? send(res, 502, { error: db.sync.lastError, state: publicState() }) : ok({ message: 'Synced.' });
  }

  if (resource === 'apps-script' && m === 'GET') {
    const code = fs.readFileSync(path.join(ROOT, 'apps-script', 'Code.gs'), 'utf8')
      .replace('PASTE_TOKEN_HERE', db.settings.sheetToken);
    return send(res, 200, code, MIME['.gs']);
  }

  if (resource === 'version' && m === 'GET') return send(res, 200, { version: VERSION, installed: INSTALLED });

  if (resource === 'update' && id === 'check' && m === 'GET') {
    try {
      const r = await fetch(`${REPO_RAW}/package.json`, { cache: 'no-store' });
      const latest = (await r.json()).version;
      return send(res, 200, { current: VERSION, latest, available: newer(latest, VERSION), installed: INSTALLED });
    } catch {
      return send(res, 200, { current: VERSION, latest: null, available: false, installed: INSTALLED, error: "Couldn't check for updates. Are you online?" });
    }
  }

  if (resource === 'update' && !id && m === 'POST') {
    if (!INSTALLED) return send(res, 400, { error: 'This copy was set up by hand. Update it with "git pull" in Terminal, or reinstall with the one-line installer.' });
    try {
      await installUpdate();
      send(res, 200, { ok: true, message: 'Updated! Jarvis is restarting…' });
      setTimeout(() => process.exit(0), 600); // the Mac restarts Jarvis automatically
      return undefined;
    } catch (err) {
      return send(res, 500, { error: `Update failed: ${err.message}. Your data is safe.` });
    }
  }

  if (resource === 'backup' && m === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="jarvis-backup-${isoDate()}.json"`,
    });
    return res.end(JSON.stringify(db, null, 2));
  }

  return send(res, 404, { error: 'Unknown API route' });
}

// ------------------------------------------------------------------ self-update (only for copies set up by install.sh)

function newer(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function installUpdate() {
  const run = promisify(execFile);
  // Unpack next to the app folder so the final rename stays on the same disk.
  const tmp = fs.mkdtempSync(path.join(path.dirname(ROOT), '.jarvis-update-'));
  try {
    const r = await fetch(REPO_ZIP);
    if (!r.ok) throw new Error(`download returned ${r.status}`);
    fs.writeFileSync(path.join(tmp, 'jarvis.zip'), Buffer.from(await r.arrayBuffer()));
    await run('ditto', ['-x', '-k', path.join(tmp, 'jarvis.zip'), path.join(tmp, 'unzipped')]);
    const [dir] = fs.readdirSync(path.join(tmp, 'unzipped'));
    const src = path.join(tmp, 'unzipped', dir);
    if (!fs.existsSync(path.join(src, 'server.js'))) throw new Error('download was incomplete');
    // Swap folders. Data lives elsewhere (JARVIS_DATA_DIR), so it is never touched.
    const old = `${ROOT}.old`;
    fs.rmSync(old, { recursive: true, force: true });
    fs.renameSync(ROOT, old);
    try {
      fs.renameSync(src, ROOT);
    } catch (err) {
      fs.renameSync(old, ROOT); // put it back
      throw err;
    }
    fs.rmSync(old, { recursive: true, force: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ Google Calendar (read-only, via the same Apps Script)

const calCache = new Map(); // key -> { at, events }
const CAL_TTL = 5 * 60 * 1000;

async function calendarApi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const from = url.searchParams.get('from') || isoDate();
  const to = url.searchParams.get('to') || from;
  const fresh = url.searchParams.get('refresh') === '1';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return send(res, 400, { error: 'Bad date' });
  if (!db.settings.calendarEnabled) return send(res, 200, { enabled: false, events: [] });
  if (!db.settings.sheetUrl) return send(res, 200, { enabled: true, events: [], error: 'Connect the Google script in Settings first.' });

  const key = `${from}|${to}|${db.settings.calendarAll ? 'all' : 'default'}`;
  const hit = calCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < CAL_TTL) return send(res, 200, { enabled: true, events: hit.events, cachedAt: hit.at });
  try {
    const r = await callSheet({ ops: [{ op: 'getEvents', from, to, allCalendars: !!db.settings.calendarAll }] });
    if (!Array.isArray(r.events)) {
      throw new Error('Your Google script is an older version. Copy the script again from Settings, paste it in, and deploy a new version.');
    }
    calCache.set(key, { at: Date.now(), events: r.events });
    return send(res, 200, { enabled: true, events: r.events, cachedAt: Date.now() });
  } catch (err) {
    const msg = String(err.message || err);
    const hint = /permission|authoriz|calendar/i.test(msg)
      ? `${msg} (In Apps Script, deploy a new version and approve calendar access.)` : msg;
    return send(res, 200, { enabled: true, events: hit?.events || [], error: hint });
  }
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (pathname.startsWith('/api/calendar')) return await calendarApi(req, res);
    if (pathname.startsWith('/api/')) return await api(req, res, pathname);
    return serveStatic(req, res, decodeURIComponent(pathname));
  } catch (err) {
    console.error(err);
    return send(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  backup();
  save();
  setInterval(backup, 6 * 3600 * 1000);
  if (db.sync.queue.length) scheduleFlush(2000);
  console.log(`\n  🤖 Jarvis is running at  http://localhost:${PORT}\n  Data file: ${DB_FILE}\n  Press Ctrl+C to stop.\n`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log(`Jarvis already seems to be running at http://localhost:${PORT}`);
  else console.error(err);
  process.exit(1);
});
