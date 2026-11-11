// Jarvis local server: serves the app, stores data in data/db.json,
// and syncs to Google Sheets through an Apps Script web app. No npm dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DEFAULT_CATEGORY_KEYWORDS, matchProject } from './public/js/parser.js';
import {
  emptyOutlook, outlookStatus, loginUrl, finishLogin, explainMsError, getOutlookEvents, getFlagged, flagStatus, getInbox, graph,
} from './outlook.js';
import { scanNews } from './coverage.js';
import { isoDate, roundHours } from './public/js/util.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const INSTALLED = process.env.JARVIS_INSTALLED === '1'; // set by install.sh
const REPO_RAW = 'https://raw.githubusercontent.com/Aviont3/pr-jarvis/main';
const SCRIPT_VERSION = 3; // must match apps-script/Code.gs
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
  // Outlook (Microsoft 365)
  msClientId: process.env.JARVIS_MS_CLIENT_ID || '',
  msTenant: 'organizations',
  outlookCalendar: true,
  outlookFlagged: true,
  outlookMail: true,
  sheetToken: crypto.randomBytes(12).toString('hex'),
  calendarEnabled: false,
  calendarAll: false,
  meetingPrompts: true,
  meetingCategory: 'Internal Meetings',
  driveBackup: true,
});

function emptyDb() {
  return {
    version: 1,
    settings: DEFAULT_SETTINGS(),
    entries: [],
    todos: [],
    timer: null,
    sync: { queue: [], lastSyncAt: null, lastError: null },
    backups: { lastLocalAt: null, lastDriveAt: null, driveError: null, driveFolderUrl: null, scriptOutdated: false },
    outlook: emptyOutlook(),
    projectInfo: {}, // per project: client, coverage search words, agenda draft & history
    coverage: [],    // news articles found about clients
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
    backups: { ...base.backups, ...raw.backups },
    outlook: { ...base.outlook, ...raw.outlook },
  };
}

let db = loadDb();

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ------------------------------------------------------------------ automatic backups
// Every change is saved to db.json immediately. On top of that, a backup copy is made
// shortly after each change (batched), with a 5-minute check as a safety net:
//   • on this Mac: data/backups/latest.json (+ a start-of-day copy per day, last 30 days)
//   • in Google Drive (if connected): "Jarvis Backups/jarvis-backup-YYYY-MM-DD.json"

const BACKUP_DELAY = Number(process.env.JARVIS_BACKUP_DELAY_MS) || 20 * 1000; // wait for a burst of edits to finish
const BACKUP_CHECK = 5 * 60 * 1000;
let backupDirty = false;
let backupTimer = null;
let backingUp = false;

function markChanged() {
  backupDirty = true;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => runBackup(), BACKUP_DELAY);
}

const backupSnapshot = () => JSON.stringify({ ...db, sync: { ...db.sync, queue: [] }, outlook: undefined }, null, 2);

async function runBackup({ force = false } = {}) {
  if (backingUp || (!backupDirty && !force)) return db.backups;
  backingUp = true;
  backupDirty = false;
  const b = db.backups;
  const content = backupSnapshot();
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const tmp = path.join(BACKUP_DIR, 'latest.json.tmp');
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, path.join(BACKUP_DIR, 'latest.json'));
    b.lastLocalAt = new Date().toISOString();
    if (db.settings.sheetUrl && db.settings.driveBackup) {
      try {
        const r = await callSheet({ ops: [{ op: 'backup', name: `jarvis-backup-${isoDate()}.json`, content, keep: 30 }] });
        if (!r.backup) {
          b.scriptOutdated = true;
          throw new Error('Your Google script needs a quick update before it can save backups.');
        }
        b.lastDriveAt = new Date().toISOString();
        b.driveFolderUrl = r.backup.folderUrl;
        b.driveError = null;
      } catch (err) {
        b.driveError = String(err.message || err);
        backupDirty = true; // try again at the next check
      }
    }
  } finally {
    backingUp = false;
    save();
  }
  return b;
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
  todos: db.todos.filter((t) => !t.deletedAt),
  deletedTodos: db.todos.filter((t) => t.deletedAt).sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1)).slice(0, 100),
  timer: db.timer,
  sync: { pending: db.sync.queue.length, lastSyncAt: db.sync.lastSyncAt, lastError: db.sync.lastError },
  meta: db.meta,
  backups: db.backups,
  outlook: outlookStatus(db.outlook, db.settings),
  // Meetings come from Google Calendar and/or Outlook.
  calendarActive: !!((db.settings.calendarEnabled && db.settings.sheetUrl) || (db.settings.outlookCalendar && db.outlook.refreshToken)),
  projectInfo: db.projectInfo,
  coverageSummary: coverageSummary(),
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
    const linked = db.todos.find((t) => t.sourceEntryId === e.id && !t.done && !t.deletedAt);
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
  // Older scripts don't know newer features (Drive backups, deleted to-dos).
  db.backups.scriptOutdated = (Number(json.scriptVersion) || 0) < SCRIPT_VERSION;
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
    if (data.length > 60e6) throw new Error('Request too large');
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
  const ok = (extra = {}) => {
    save();
    if (m !== 'GET' && ['entries', 'todos', 'timer', 'settings', 'projects', 'coverage'].includes(resource)) markChanged();
    return send(res, 200, { state: publicState(), ...extra });
  };

  if (resource === 'state' && m === 'GET') return send(res, 200, { state: publicState() });

  if (resource === 'entries') {
    if (m === 'POST' && !id) return ok({ item: addEntry(body) });
    if (m === 'PATCH' && id) { const e = updateEntry(id, body); return e ? ok({ item: e }) : send(res, 404, { error: 'Not found' }); }
    if (m === 'DELETE' && id) {
      const entry = db.entries.find((x) => x.id === id);
      if (!entry) return send(res, 404, { error: 'That entry was already deleted.' });
      db.entries = db.entries.filter((x) => x.id !== id);
      enqueue({ op: 'upsertEntry', id }); // materializes to a delete
      // The open to-do made from this entry's "next step" goes too (finished ones stay).
      const now = new Date().toISOString();
      const todos = db.todos.filter((t) => t.sourceEntryId === id && !t.done && !t.deletedAt);
      for (const t of todos) { t.deletedAt = now; enqueue({ op: 'upsertTodo', id: t.id }); }
      return ok({ removed: { entry, todos } }); // the client keeps this for Undo
    }
    // Undo a delete: put back exactly what was removed (same ids, no new to-dos).
    if (m === 'POST' && id === 'restore') {
      const { entry, todos = [] } = body.removed || {};
      if (!entry?.id) return send(res, 400, { error: 'Nothing to restore.' });
      if (!db.entries.some((x) => x.id === entry.id)) {
        db.entries.push({ ...entry, ...cleanEntry(entry) });
        enqueue({ op: 'upsertEntry', id: entry.id });
      }
      for (const t of todos) {
        if (!t?.id) continue;
        const existing = db.todos.find((x) => x.id === t.id);
        if (existing) existing.deletedAt = null;
        else db.todos.push({ ...t, deletedAt: null });
        enqueue({ op: 'upsertTodo', id: t.id });
      }
      return ok({ item: entry });
    }
  }

  // ---------------------------------------------------------------- projects
  if (resource === 'projects') {
    const name = id ? decodeURIComponent(id) : '';
    if (m === 'POST' && !id) {
      const n = String(body.name || '').trim();
      if (!n) return send(res, 400, { error: 'Give the project a name.' });
      const existing = db.settings.projects.find((x) => x.toLowerCase() === n.toLowerCase());
      if (!existing) db.settings.projects.push(n);
      const key = existing || n;
      db.projectInfo[key] = { ...projectInfo(key), ...pick(body, PROJECT_FIELDS) };
      enqueue({ op: 'setLists' });
      return ok({ item: key });
    }
    if (!name || !db.settings.projects.includes(name)) return send(res, 404, { error: 'That project doesn’t exist.' });
    if (m === 'PATCH' && !action) {
      Object.assign(projectInfo(name), pick(body, PROJECT_FIELDS));
      return ok({ item: name });
    }
    if (m === 'POST' && action === 'rename') {
      const to = String(body.to || '').trim();
      if (!to) return send(res, 400, { error: 'Type the new name.' });
      if (to !== name && db.settings.projects.includes(to)) return send(res, 400, { error: 'There’s already a project with that name.' });
      renameProject(name, to);
      return ok({ item: to });
    }
    if (m === 'POST' && action === 'scan') {
      const r = await scanProject(name);
      return r.error ? send(res, 502, { error: r.error, state: publicState() }) : ok(r);
    }
    if (m === 'POST' && action === 'agenda-sent') {
      const info = projectInfo(name);
      info.agendaHistory = [{ sentAt: new Date().toISOString(), subject: String(body.subject || ''), body: String(body.body || '') }, ...(info.agendaHistory || [])].slice(0, 50);
      info.agendaLastSent = info.agendaHistory[0].sentAt;
      info.agenda = null; // next time, start a fresh draft from what's new
      return ok({ item: name });
    }
  }

  // ---------------------------------------------------------------- coverage
  if (resource === 'coverage') {
    if (m === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const project = url.searchParams.get('project');
      const items = db.coverage.filter((c) => !project || c.project === project)
        .sort((a, b) => ((b.publishedAt || b.foundAt) > (a.publishedAt || a.foundAt) ? 1 : -1));
      return send(res, 200, { items });
    }
    if (m === 'POST' && !id) { // add an article by hand (e.g. print or a paywalled link)
      const title = String(body.title || '').trim();
      const project = String(body.project || '');
      if (!title || !db.settings.projects.includes(project)) return send(res, 400, { error: 'Add a headline and pick a project.' });
      const item = {
        id: uid(), project, title, url: String(body.url || '').trim(), outlet: String(body.outlet || '').trim(), outletUrl: '',
        publishedAt: body.publishedAt ? new Date(`${body.publishedAt}T12:00:00`).toISOString() : new Date().toISOString(),
        foundAt: new Date().toISOString(), snippet: '', status: 'kept', manual: true,
      };
      db.coverage.push(item);
      return ok({ item });
    }
    if (m === 'PATCH' && id) {
      const c = db.coverage.find((x) => x.id === id);
      if (!c) return send(res, 404, { error: 'Not found' });
      if (['new', 'kept', 'dismissed'].includes(body.status)) c.status = body.status;
      if (typeof body.note === 'string') c.note = body.note;
      return ok({ item: c });
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
    // Deleting keeps the to-do (with its deletion date) so it can be seen and restored.
    if (m === 'DELETE' && id) {
      const t = db.todos.find((x) => x.id === id);
      if (!t) return send(res, 404, { error: 'Not found' });
      t.deletedAt = new Date().toISOString();
      enqueue({ op: 'upsertTodo', id });
      return ok({ item: t });
    }
    if (m === 'POST' && id && action === 'restore') {
      const t = db.todos.find((x) => x.id === id);
      if (!t) return send(res, 404, { error: 'Not found' });
      t.deletedAt = null;
      enqueue({ op: 'upsertTodo', id });
      return ok({ item: t });
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

  if (resource === 'backup' && id === 'now' && m === 'POST') {
    const b = await runBackup({ force: true });
    return send(res, 200, { state: publicState(), backups: b });
  }

  // Restore everything from a backup file (from Google Drive or "Save a backup copy").
  if (resource === 'backup' && id === 'restore' && m === 'POST') {
    const data = body.data;
    if (!data || !Array.isArray(data.entries) || !Array.isArray(data.todos) || !data.settings) {
      return send(res, 400, { error: 'That file isn’t a Jarvis backup. Pick a file named like “jarvis-backup-2026-11-09.json”.' });
    }
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const safety = path.join(BACKUP_DIR, `before-restore-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(safety, backupSnapshot()); // in case they restore the wrong file
    const base = emptyDb();
    db = {
      ...base, ...data,
      settings: { ...base.settings, ...data.settings, sheetToken: db.settings.sheetToken, sheetUrl: db.settings.sheetUrl || data.settings.sheetUrl || '' },
      sync: { ...base.sync },
      meta: { ...base.meta, ...data.meta },
      backups: { ...db.backups },
      outlook: db.outlook, // stay signed in to Outlook
      timer: null,
    };
    if (db.settings.sheetUrl) { enqueueEverything(); scheduleFlush(500); }
    markChanged();
    return ok({ message: `Restored ${db.entries.length} entries and ${db.todos.length} to-dos.` });
  }

  if (resource === 'backup' && m === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="jarvis-backup-${isoDate()}.json"`,
    });
    return res.end(backupSnapshot());
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
  const useGoogle = !!(db.settings.calendarEnabled && db.settings.sheetUrl);
  const useOutlook = !!(db.settings.outlookCalendar && db.outlook.refreshToken);
  if (!useGoogle && !useOutlook) return send(res, 200, { enabled: false, events: [] });

  const key = `${from}|${to}|${useGoogle ? (db.settings.calendarAll ? 'g-all' : 'g') : ''}|${useOutlook ? 'ms' : ''}`;
  const hit = calCache.get(key);
  if (hit && !fresh && Date.now() - hit.at < CAL_TTL) return send(res, 200, { enabled: true, events: hit.events, cachedAt: hit.at });

  const errors = [];
  let events = [];
  if (useGoogle) {
    try {
      const r = await callSheet({ ops: [{ op: 'getEvents', from, to, allCalendars: !!db.settings.calendarAll }] });
      if (!Array.isArray(r.events)) throw new Error('Your Google script is an older version. Use “Update Google script” in Settings.');
      events.push(...r.events);
    } catch (err) {
      const msg = String(err.message || err);
      errors.push(`Google Calendar: ${/permission|authoriz|calendar/i.test(msg) ? `${msg} (In Apps Script, deploy a new version and approve calendar access.)` : msg}`);
    }
  }
  if (useOutlook) {
    try {
      events.push(...await getOutlookEvents(db.outlook, db.settings, from, to));
      db.outlook.lastError = null;
    } catch (err) {
      noteOutlookError(err);
      errors.push(`Outlook: ${err.message}`);
    } finally { save(); }
  }
  // Same meeting on both calendars (e.g. an invite accepted in both): keep one.
  const seen = new Set();
  events = events.sort((x, y) => (x.start < y.start ? -1 : 1)).filter((ev) => {
    const k = `${ev.title.trim().toLowerCase()}|${ev.start}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!errors.length) calCache.set(key, { at: Date.now(), events });
  return send(res, 200, { enabled: true, events: errors.length && hit && !events.length ? hit.events : events, error: errors.join(' ') || null });
}

// ------------------------------------------------------------------ projects & coverage

const PROJECT_FIELDS = ['client', 'terms', 'exclude', 'outlets', 'scan', 'recipients', 'agenda', 'notes'];
const COVERAGE_EVERY = 6 * 3600 * 1000;

function projectInfo(name) {
  if (!db.projectInfo[name]) db.projectInfo[name] = { client: '', terms: '', exclude: '', outlets: '', scan: false, recipients: '', agenda: null, agendaHistory: [], notes: '' };
  return db.projectInfo[name];
}

function coverageSummary() {
  const out = {};
  for (const c of db.coverage) {
    const s = out[c.project] || (out[c.project] = { new: 0, kept: 0, latestNew: [] });
    if (c.status === 'new') { s.new += 1; s.latestNew.push({ title: c.title, outlet: c.outlet, publishedAt: c.publishedAt }); }
    if (c.status === 'kept') s.kept += 1;
  }
  for (const s of Object.values(out)) s.latestNew = s.latestNew.sort((a, b) => ((b.publishedAt || '') > (a.publishedAt || '') ? 1 : -1)).slice(0, 3);
  return out;
}

/** Rename a project everywhere: settings, work entries, to-dos, details and coverage. */
function renameProject(from, to) {
  db.settings.projects = db.settings.projects.map((x) => (x === from ? to : x));
  for (const e of db.entries) if (e.project === from) { e.project = to; enqueue({ op: 'upsertEntry', id: e.id }); }
  for (const t of db.todos) if (t.project === from) { t.project = to; enqueue({ op: 'upsertTodo', id: t.id }); }
  for (const c of db.coverage) if (c.project === from) c.project = to;
  if (db.projectInfo[from]) { db.projectInfo[to] = db.projectInfo[from]; delete db.projectInfo[from]; }
  if (db.timer?.project === from) db.timer.project = to;
  enqueue({ op: 'setLists' });
}

const titleKey = (t) => String(t).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80);

/** Search the news for one project and store new articles. */
async function scanProject(name) {
  const info = projectInfo(name);
  try {
    const found = await scanNews(name, info, info.lastScanAt ? 7 : 30);
    const mine = db.coverage.filter((c) => c.project === name);
    const urls = new Set(mine.map((c) => c.url));
    const titles = new Set(mine.map((c) => titleKey(c.title)));
    let added = 0;
    for (const a of found) {
      if (urls.has(a.url) || titles.has(titleKey(a.title))) continue;
      db.coverage.push({ id: uid(), project: name, ...a, foundAt: new Date().toISOString(), status: 'new' });
      urls.add(a.url); titles.add(titleKey(a.title));
      added += 1;
    }
    // keep the list tidy: at most 300 articles per project (kept ones are never dropped)
    const forProject = db.coverage.filter((c) => c.project === name && c.status !== 'kept')
      .sort((a, b) => ((b.publishedAt || b.foundAt) > (a.publishedAt || a.foundAt) ? 1 : -1));
    const drop = new Set(forProject.slice(300).map((c) => c.id));
    if (drop.size) db.coverage = db.coverage.filter((c) => !drop.has(c.id));
    info.lastScanAt = new Date().toISOString();
    info.scanError = null;
    if (added) markChanged();
    save();
    return { added, found: found.length };
  } catch (err) {
    info.scanError = String(err.message || err);
    save();
    return { added: 0, error: info.scanError };
  }
}

async function scanAllCoverage() {
  for (const name of db.settings.projects) {
    if (db.projectInfo[name]?.scan) await scanProject(name);
  }
}

// ------------------------------------------------------------------ Outlook (Microsoft 365)

const FLAG_SYNC_EVERY = 5 * 60 * 1000;
const redirectUri = () => `http://localhost:${PORT}/api/outlook/callback`;
let inboxCache = { at: 0, messages: [] };

function noteOutlookError(err) {
  db.outlook.lastError = String(err.message || err);
  if (err.needsAdmin) db.outlook.needsAdmin = true;
}

/** Flagged emails become to-dos; un-flagging or completing in Outlook ticks them off. */
async function syncFlagged() {
  if (!db.outlook.refreshToken || !db.settings.outlookFlagged) return { added: 0, done: 0 };
  let added = 0;
  let done = 0;
  try {
    const flagged = await getFlagged(db.outlook, db.settings);
    const known = new Map(db.todos.filter((t) => t.outlookId).map((t) => [t.outlookId, t]));
    for (const m of flagged) {
      const existing = known.get(m.id);
      if (existing) {
        // keep the due date in step with Outlook (unless the to-do was finished or deleted in Jarvis)
        if (!existing.done && !existing.deletedAt && m.due && existing.due !== m.due) { existing.due = m.due; enqueue({ op: 'upsertTodo', id: existing.id }); }
        continue;
      }
      const pm = matchProject(m.subject, db.settings.projects || []);
      const td = addTodo({
        text: `✉️ ${m.subject}${m.from ? ` (from ${m.from})` : ''}`,
        project: pm?.project || '',
        due: m.due || '',
        priority: m.important ? 'high' : 'normal',
      });
      Object.assign(td, { outlookId: m.id, outlookLink: m.link, source: 'outlook' });
      added += 1;
    }
    const flaggedIds = new Set(flagged.map((m) => m.id));
    for (const t of db.todos.filter((x) => x.outlookId && !x.done && !x.deletedAt && !flaggedIds.has(x.outlookId))) {
      const st = await flagStatus(db.outlook, db.settings, t.outlookId);
      if (st !== 'flagged') {
        t.done = true;
        t.doneAt = new Date().toISOString();
        enqueue({ op: 'upsertTodo', id: t.id });
        done += 1;
      }
    }
    db.outlook.lastSyncAt = new Date().toISOString();
    db.outlook.lastError = null;
    if (added || done) markChanged();
  } catch (err) {
    noteOutlookError(err);
  } finally {
    save();
  }
  return { added, done };
}

const page = (title, body, ok = true) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,ui-rounded,sans-serif;background:#fffaf2;display:grid;place-items:center;min-height:100vh;margin:0;color:#3a2c35}
.c{background:#fff;border-radius:24px;padding:36px;max-width:440px;text-align:center;box-shadow:0 10px 30px rgba(232,100,154,.12)}
h1{font-size:22px}p{line-height:1.5}a{color:#2f8a5a;font-weight:700}</style></head>
<body><div class="c"><div style="font-size:52px">${ok ? '🌸' : '🌧️'}</div><h1>${title}</h1>${body}</div>
<script>try{window.opener&&window.opener.postMessage({jarvisOutlook:${ok ? 'true' : 'false'}},'*')}catch(e){}${ok ? 'setTimeout(function(){window.close()},1800)' : ''}</script></body></html>`;

async function outlookApi(req, res, pathname) {
  const url = new URL(req.url, 'http://localhost');
  const what = pathname.replace('/api/outlook/', '');
  const html = (status, body) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); };

  if (what === 'login' && req.method === 'GET') {
    if (!db.settings.msClientId) return html(400, page('One more setup step', '<p>Jarvis needs its Microsoft app ID first. Ask whoever set up Jarvis to follow “Connect Outlook: one-time setup” in the README.</p>', false));
    res.writeHead(302, { Location: loginUrl(db.settings, redirectUri()) });
    return res.end();
  }

  if (what === 'callback' && req.method === 'GET') {
    const err = url.searchParams.get('error');
    if (err) {
      const e = explainMsError(err, url.searchParams.get('error_description'));
      db.outlook.lastError = e.message;
      if (e.needsAdmin) db.outlook.needsAdmin = true;
      save();
      return html(200, page(e.needsAdmin ? 'Your IT team needs to approve Jarvis' : 'Sign-in didn’t finish', `<p>${e.message}</p><p>You can close this window and go back to Jarvis.</p>`, false));
    }
    try {
      await finishLogin(db.outlook, db.settings, { code: url.searchParams.get('code'), state: url.searchParams.get('state'), redirectUri: redirectUri() });
      calCache.clear();
      save();
      syncFlagged().catch(() => {});
      return html(200, page('Outlook is connected!', `<p>Signed in as <b>${(db.outlook.account?.email || '').replace(/[<>&"]/g, '')}</b>.</p><p>This window closes by itself. Go back to Jarvis. 🌷</p>`));
    } catch (e2) {
      noteOutlookError(e2);
      save();
      return html(200, page(e2.needsAdmin ? 'Your IT team needs to approve Jarvis' : 'Sign-in didn’t finish', `<p>${e2.message}</p><p>You can close this window and go back to Jarvis.</p>`, false));
    }
  }

  const ok = (extra = {}) => send(res, 200, { state: publicState(), ...extra });

  if (what === 'disconnect' && req.method === 'POST') {
    db.outlook = emptyOutlook();
    calCache.clear();
    inboxCache = { at: 0, messages: [] };
    save();
    return ok();
  }

  if (what === 'test' && req.method === 'POST') {
    try {
      const me = await graph(db.outlook, db.settings, '/me?$select=displayName,mail,userPrincipalName');
      db.outlook.account = { name: me.displayName || '', email: me.mail || me.userPrincipalName || '' };
      const [events, inbox] = await Promise.all([
        getOutlookEvents(db.outlook, db.settings, isoDate(), isoDate()),
        getInbox(db.outlook, db.settings, 2),
      ]);
      const r = await syncFlagged();
      db.outlook.lastError = null;
      db.outlook.needsAdmin = false;
      save();
      return ok({ message: `✅ Connected as ${db.outlook.account.email}: ${events.length} meetings today, ${inbox.length} unread emails, ${r.added} new flagged email to-dos.` });
    } catch (err) {
      noteOutlookError(err);
      save();
      return send(res, 502, { error: err.message, state: publicState() });
    }
  }

  if (what === 'sync' && req.method === 'POST') {
    const r = await syncFlagged();
    return db.outlook.lastError ? send(res, 502, { error: db.outlook.lastError, state: publicState() }) : ok(r);
  }

  if (what === 'inbox' && req.method === 'GET') {
    if (!db.outlook.refreshToken || !db.settings.outlookMail) return send(res, 200, { enabled: false, messages: [] });
    if (url.searchParams.get('refresh') !== '1' && Date.now() - inboxCache.at < 2 * 60 * 1000) return send(res, 200, { enabled: true, messages: inboxCache.messages });
    try {
      const messages = await getInbox(db.outlook, db.settings, 2);
      inboxCache = { at: Date.now(), messages };
      db.outlook.lastError = null;
      save();
      return send(res, 200, { enabled: true, messages });
    } catch (err) {
      noteOutlookError(err);
      save();
      return send(res, 200, { enabled: true, messages: inboxCache.messages, error: err.message });
    }
  }

  return send(res, 404, { error: 'Unknown Outlook route' });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (pathname.startsWith('/api/calendar')) return await calendarApi(req, res);
    if (pathname.startsWith('/api/outlook/')) return await outlookApi(req, res, pathname);
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
  setInterval(() => runBackup(), BACKUP_CHECK);
  setInterval(() => syncFlagged().catch(() => {}), FLAG_SYNC_EVERY);
  setTimeout(() => syncFlagged().catch(() => {}), 5000);
  setInterval(() => scanAllCoverage().catch(() => {}), COVERAGE_EVERY);
  setTimeout(() => scanAllCoverage().catch(() => {}), 30000);
  backupDirty = true; // one backup shortly after starting
  backupTimer = setTimeout(() => runBackup(), BACKUP_DELAY);
  if (db.sync.queue.length) scheduleFlush(2000);
  console.log(`\n  🤖 Jarvis is running at  http://localhost:${PORT}\n  Data file: ${DB_FILE}\n  Press Ctrl+C to stop.\n`);
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.log(`Jarvis already seems to be running at http://localhost:${PORT}`);
  else console.error(err);
  process.exit(1);
});
