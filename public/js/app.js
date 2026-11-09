import { Jarvis } from './jarvis.js';
import { Voice } from './voice.js';
import { parseCommand, guessCategory, shortTask } from './parser.js';
import { HELP } from './jarvis.js';
import {
  stats, todoBuckets, sortTodos, buildReport, toCsv, displayProject, filterEntries, morningBrief, wrapUp,
  meetingsOn, isMeetingLogged, meetingToEntry, unloggedMeetings, fmtTime, meetingHours,
} from './insights.js';
import {
  isoDate, fmtHours, fmtNum, fmtDate, fmtClock, escapeHtml as h, periodRange, sum, parseIso, addDays,
} from './util.js';

// ------------------------------------------------------------------ state & API

let state = { settings: { projects: [], categories: [], keywords: {} }, entries: [], todos: [], timer: null, sync: {}, meta: {} };
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

async function api(method, path, body) {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (json.state) { state = json.state; renderAll(); }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

const actions = {
  addEntry: async (e) => (await api('POST', 'entries', e)).item,
  updateEntry: async (id, e) => (await api('PATCH', `entries/${id}`, e)).item,
  deleteEntry: async (id) => (await api('DELETE', `entries/${id}`)).removed,
  restoreEntry: async (removed) => (await api('POST', 'entries/restore', { removed })).item,
  addTodo: async (t) => (await api('POST', 'todos', t)).item,
  updateTodo: async (id, t) => (await api('PATCH', `todos/${id}`, t)).item,
  deleteTodo: async (id) => api('DELETE', `todos/${id}`),
  restoreTodo: async (id) => (await api('POST', `todos/${id}/restore`)).item,
  startTimer: async (t) => (await api('POST', 'timer/start', t)).item,
  stopTimer: async (note) => (await api('POST', 'timer/stop', { note })).item,
  cancelTimer: async () => api('POST', 'timer/cancel'),
};

// Calendar events live alongside the stored state (fetched from Google, not saved locally).
let calendar = { enabled: false, events: [], error: null };
const full = () => ({ ...state, events: calendar.events });
const jarvis = new Jarvis(full, actions);

// ------------------------------------------------------------------ spring delight: petals & flower confetti

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function startPetals() {
  if (reduceMotion) return;
  const box = $('#petals');
  const kinds = ['🌸', '🌸', '🌼', '🍃', '🌸', '💮'];
  for (let i = 0; i < 14; i++) {
    const p = document.createElement('span');
    p.className = 'petal';
    p.textContent = kinds[i % kinds.length];
    p.style.left = `${Math.random() * 100}vw`;
    p.style.fontSize = `${12 + Math.random() * 14}px`;
    p.style.animationDuration = `${14 + Math.random() * 16}s`;
    p.style.animationDelay = `${-Math.random() * 30}s`;
    box.append(p);
  }
}

/** A little burst of flowers from a point (or the center of an element). */
function celebrate(from) {
  if (reduceMotion) return;
  let x = window.innerWidth / 2;
  let y = window.innerHeight / 2;
  if (from?.getBoundingClientRect) {
    const r = from.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  const bits = ['🌸', '🌼', '🌷', '✨', '🌿', '💐', '🦋'];
  for (let i = 0; i < 16; i++) {
    const s = document.createElement('span');
    s.className = 'burst';
    s.textContent = bits[i % bits.length];
    s.style.left = `${x}px`;
    s.style.top = `${y}px`;
    document.body.append(s);
    const angle = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 90;
    s.animate([
      { transform: 'translate(-50%, -50%) scale(.4)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist - 30}px)) scale(1.1) rotate(${Math.random() * 180 - 90}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist * 1.1}px), calc(-50% + ${Math.sin(angle) * dist + 60}px)) scale(.8)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 400, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => s.remove();
  }
}

const CHEERS = ['Blooming nicely! 🌷', 'Look at you grow! 🌱', 'Fresh progress! 🌼', 'Another petal on the board! 🌸', 'Sunny work! ☀️'];
const cheer = () => CHEERS[Math.floor(Math.random() * CHEERS.length)];

/** Short message at the bottom. With { action, onAction } it gets a button (e.g. Undo) and stays longer. */
function toast(msg, opts = {}) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('has-action', !!opts.action);
  if (opts.action) {
    const b = Object.assign(document.createElement('button'), { className: 'toast-btn', textContent: opts.action });
    b.onclick = () => { t.classList.remove('show'); opts.onAction(); };
    t.append(b);
  }
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), opts.action ? 8000 : 2600);
}

/** Delete an entry right away, with an Undo button instead of an "are you sure?" box. */
async function removeEntry(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  const removed = await actions.deleteEntry(id);
  const extra = removed?.todos?.length ? ' (and its to-do)' : '';
  toast(`🗑️ Deleted “${shorten(entry.workDone || entry.task, 40)}”${extra}`, {
    action: '↩️ Undo',
    onAction: async () => { await actions.restoreEntry(removed); toast('Brought it back 🌷'); },
  });
}
const shorten = (s, n) => (String(s || '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s || ''));

// ------------------------------------------------------------------ voice & chat

let voiceCapture = null; // when set (mic test), heard speech goes here instead of to Jarvis
const voice = new Voice({
  onInterim: (t) => { $('#interim').textContent = t; },
  onFinal: (t) => { $('#interim').textContent = ''; if (voiceCapture) voiceCapture(t); else converse(t); },
  onState: (s) => {
    const mic = $('#mic-btn');
    mic.classList.toggle('listening', s === 'listening');
    mic.classList.toggle('speaking', s === 'speaking');
    $('#jarvis-status').innerHTML = s === 'listening' ? 'Listening…' : s === 'speaking' ? 'Speaking… <span class="muted">(Esc to stop)</span>' : 'Tap the flower or press <kbd>⌘J</kbd> and talk to me 🌼';
  },
  onError: (m) => jarvisSay({ speech: m }, false),
});

function addUserMsg(text) {
  const el = document.createElement('div');
  el.className = 'msg user';
  el.textContent = text;
  $('#chat').append(el);
  scrollChat();
}

function scrollChat() { const c = $('#chat'); c.scrollTop = c.scrollHeight; }

function categoryOptions(selected) {
  const cats = state.settings.categories || [];
  return `<option value="">(none)</option>${cats.map((c) => `<option ${c === selected ? 'selected' : ''}>${h(c)}</option>`).join('')}`;
}

// A proposed-entry card stays editable only while Jarvis is still waiting on that entry.
function retireStaleCards() {
  for (const c of $$('#chat .card[data-entry-card]')) {
    if (jarvis.pending?.entry !== c._entry) c.classList.add('done');
  }
}

function entryCard(entry) {
  const card = document.createElement('div');
  card.className = 'card';
  card.dataset.entryCard = '1';
  card._entry = entry;
  card.innerHTML = `
    <div class="grid">
      <input name="workDone" placeholder="Work done" value="${h(entry.workDone)}">
      <input name="hours" type="number" step="0.05" min="0" placeholder="hrs" value="${entry.hours ?? ''}">
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr">
      <input name="project" list="project-options" placeholder="Project" value="${h(entry.project)}">
      <select name="category">${categoryOptions(entry.category)}</select>
    </div>
    <input name="notes" placeholder="Notes / next steps (optional)" value="${h(entry.notes)}">
    <div class="actions"><button class="btn ghost small" data-act="discard">Discard</button><button class="btn primary small" data-act="save">Save</button></div>`;
  card.addEventListener('click', async (ev) => {
    const act = ev.target.dataset.act;
    if (!act) return;
    let res;
    if (act === 'discard') res = await jarvis.resolveCard(null);
    else {
      const f = (n) => $(`[name=${n}]`, card).value;
      const workDone = f('workDone').trim();
      res = await jarvis.resolveCard({
        ...entry, workDone, task: entry.task && workDone.startsWith(entry.task.replace('…', '')) ? entry.task : workDone.split(/[.;:]/)[0].slice(0, 80),
        hours: parseFloat(f('hours')), project: f('project').trim(), category: f('category'), notes: f('notes').trim(),
      });
    }
    jarvisSay(res);
  });
  return card;
}

function reportCard(text) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `<pre>${h(text)}</pre><button class="btn ghost small">Copy report</button>`;
  $('button', wrap).onclick = () => { navigator.clipboard.writeText(text); toast('Report copied'); };
  return wrap;
}

function jarvisSay(res, speak = true) {
  const el = document.createElement('div');
  el.className = 'msg jarvis';
  let html = '';
  if (res.title) html += `<div class="title">${h(res.title)}</div>`;
  if (res.speech) html += `<div>${h(res.speech)}</div>`;
  for (const s of res.sections || []) {
    if (!s.items?.length) continue;
    html += `<div class="sec"><h4>${h(s.heading)}</h4><ul>${s.items.map((i) => `<li>${h(i)}</li>`).join('')}</ul></div>`;
  }
  el.innerHTML = html;
  if (res.card?.kind === 'entry') el.append(entryCard(res.card.entry));
  if (res.card?.kind === 'report') el.append(reportCard(res.card.text));
  if (res.undo) {
    const b = Object.assign(document.createElement('button'), { className: 'btn ghost small', textContent: '↩️ Undo' });
    b.style.marginTop = '8px';
    b.onclick = async () => { b.disabled = true; await actions.restoreEntry(res.undo); b.textContent = '✓ Brought back'; toast('Brought it back 🌷'); };
    el.append(b);
  }
  if (res.openEntry) setTimeout(() => openEntry(res.openEntry), 300);
  if (res.card?.kind === 'day') {
    const b = Object.assign(document.createElement('button'), { className: 'btn ghost small', textContent: '📒 Open this day in My Work' });
    b.style.marginTop = '8px';
    b.onclick = () => openDay(res.card.date);
    el.append(b);
  }
  $('#chat').append(el);
  if (res.saved || res.celebrate) { celebrate(el); if (res.saved) toast(cheer()); }
  retireStaleCards();
  scrollChat();
  if (speak && state.settings.speakReplies) voice.speak(res.speech);
}

async function converse(text) {
  if (!text.trim()) return;
  addUserMsg(text);
  try {
    const res = await jarvis.handle(text);
    jarvisSay(res);
  } catch (err) {
    jarvisSay({ speech: `Something went wrong: ${err.message}` });
  }
}

// ------------------------------------------------------------------ rendering

function renderAll() {
  voice.enabled = !!state.settings.speakReplies;
  voice.voiceName = state.settings.voiceName || '';
  $('#today-label').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  $('#project-options').innerHTML = (state.settings.projects || []).map((p) => `<option value="${h(p)}">`).join('');
  renderSync();
  renderGoogleStatus();
  renderBackups();
  renderHello();
  renderTimer();
  renderMeetings();
  renderToday();
  renderTodos();
  if ($('#view-log').classList.contains('active')) renderLog();
  if ($('#view-dashboard').classList.contains('active')) renderDashboard();
  fillProjectSelects();
}

function renderSync() {
  const pill = $('#sync-pill');
  const s = state.sync || {};
  pill.className = 'sync-pill';
  if (!state.settings.sheetUrl) { pill.textContent = 'Connect Google'; pill.title = 'Click to connect your Google Sheet & Calendar'; return; }
  if (s.lastError) { pill.classList.add('err'); pill.textContent = 'Google needs attention'; pill.title = s.lastError; return; }
  if (s.pending) { pill.classList.add('pending'); pill.textContent = 'Saving to Google…'; return; }
  pill.classList.add('ok');
  pill.textContent = 'Saved to Google';
  pill.title = s.lastSyncAt ? `Last saved ${new Date(s.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Connected';
}
$('#sync-pill').onclick = () => (state.settings.sheetUrl ? show('settings') : openGoogleGuide());

let timerTick = null;
function renderTimer() {
  const el = $('#timer-panel');
  clearInterval(timerTick);
  const t = state.timer;
  if (t) {
    el.className = 'panel timer-panel';
    el.innerHTML = `
      <div class="clock" id="clock">0:00:00</div>
      <div class="what"><b>${h(t.task)}</b><span class="muted">${h(displayProject(t.project))}${t.category ? ` · ${h(t.category)}` : ''}</span></div>
      <button class="btn primary" id="timer-stop">Stop &amp; log</button>
      <button class="btn ghost small" id="timer-cancel" title="Discard timer">✕</button>`;
    const tick = () => { const c = $('#clock'); if (c) c.textContent = fmtClock(Date.now() - new Date(t.startedAt)); };
    tick();
    timerTick = setInterval(tick, 1000);
    $('#timer-stop').onclick = async () => { const e = await actions.stopTimer(''); jarvisSay({ speech: `Stopped. Logged ${fmtHours(e.hours)} on ${e.task}.`, saved: true }); };
    $('#timer-cancel').onclick = async () => { if (confirm('Discard this timer without logging?')) await actions.cancelTimer(); };
  } else {
    el.className = 'panel timer-panel idle';
    el.innerHTML = `
      <form class="timer-start" id="timer-form">
        <input name="task" placeholder="Start a timer: what are you working on?" required>
        <input name="project" list="project-options" placeholder="Project">
        <button class="btn primary">▶ Start</button>
      </form>`;
    $('#timer-form').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const task = f.get('task').trim();
      const guess = parseCommand(`start ${task}`, { projects: state.settings.projects, categories: state.settings.categories, keywords: state.settings.keywords });
      await actions.startTimer({ task, project: f.get('project').trim() || guess.project || '', category: guess.category || state.settings.defaultCategory || '' });
    };
  }
}

/** ✏️ / 🗑️ buttons shown on every entry. */
function rowActions(e) {
  return `<span class="row-actions"><button type="button" class="ra" data-edit="${e.id}" title="Change this" aria-label="Change this entry">✏️</button><button type="button" class="ra del" data-del="${e.id}" title="Delete this" aria-label="Delete this entry">🗑️</button></span>`;
}

function entryLi(e) {
  return `<li data-entry="${e.id}"><span class="hrs">${fmtNum(e.hours)}</span><div class="body"><div>${h(e.workDone || e.task)}</div><div class="meta">${h(displayProject(e.project))}${e.category ? ` · ${h(e.category)}` : ''}${e.notes ? ` · Next: ${h(e.notes)}` : ''}</div></div>${rowActions(e)}</li>`;
}

function dueMeta(td) {
  if (!td.due) return '';
  const t = isoDate();
  if (td.due < t) return `<span class="over">Overdue · ${fmtDate(td.due)}</span>`;
  if (td.due === t) return '<span class="today">Today</span>';
  return fmtDate(td.due);
}

// "today 2:15 PM" / "yesterday" / "Nov 3" (+ exact time on hover)
function whenLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const day = isoDate(d);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (day === isoDate()) return `today ${time}`;
  if (day === isoDate(addDays(new Date(), -1))) return 'yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}
const fullWhen = (iso) => new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const stamp = (label, iso, cls = '') => (iso ? `<span class="stamp ${cls}" title="${label} ${fullWhen(iso)}">${label} ${whenLabel(iso)}</span>` : '');

function todoLi(td) {
  // Open to-dos: the due date is a button that opens the date picker.
  const due = td.done ? dueMeta(td)
    : `<button type="button" class="due-btn ${td.due ? '' : 'empty'}" data-due-edit="${td.id}" title="Change the due date">📅 ${td.due ? dueMeta(td) : 'Add due date'}</button>`;
  const proj = td.done ? (td.project && h(displayProject(td.project)))
    : `<button type="button" class="proj-btn ${td.project ? '' : 'empty'}" data-proj-edit="${td.id}" title="Change the project">🌷 ${td.project ? h(displayProject(td.project)) : 'Add project'}</button>`;
  const pri = td.done ? (td.priority === 'high' && '🔥 Urgent')
    : `<button type="button" class="pri-btn pri-${td.priority || 'normal'}" data-pri-edit="${td.id}" title="Change how urgent this is">${PRIORITY_LABEL[td.priority || 'normal']}</button>`;
  const meta = [due, proj, pri].filter(Boolean).join(' · ');
  const dates = [stamp('Added', td.createdAt), td.done && stamp('Completed', td.doneAt, 'done-stamp')].filter(Boolean).join(' · ');
  return `<li class="${td.done ? 'done' : ''} ${td.priority === 'high' ? 'high' : ''}" data-todo="${td.id}">
    <input type="checkbox" ${td.done ? 'checked' : ''} aria-label="Done">
    <div class="t"><span contenteditable="plaintext-only" spellcheck="false">${h(td.text)}</span>${meta ? `<div class="meta">${meta}</div>` : ''}${dates ? `<div class="meta dates">${dates}</div>` : ''}</div>
    <button class="x" title="Delete">✕</button></li>`;
}

// ---- Due date picker (one small pop-up shared by all to-dos)

const duePop = Object.assign(document.createElement('div'), { className: 'due-pop', hidden: true });
document.body.append(duePop);
let duePopFor = null;

function nextWeekday(target) { // 0=Sun … 6=Sat, always in the future
  const d = new Date();
  const diff = ((target - d.getDay() + 7) % 7) || 7;
  return isoDate(addDays(d, diff));
}

function openDuePicker(btn, td) {
  duePopFor = td.id;
  const today = new Date();
  const choices = [
    ['Today', isoDate(today)], ['Tomorrow', isoDate(addDays(today, 1))],
    ['Friday', nextWeekday(5)], ['Next Monday', nextWeekday(1)], ['In a week', isoDate(addDays(today, 7))],
  ].filter(([, d], i, all) => all.findIndex(([, x]) => x === d) === i); // no duplicate dates
  duePop.innerHTML = `
    <div class="due-pop-title">📅 When is it due?</div>
    <div class="due-pop-chips">${choices.map(([l, d]) => `<button type="button" data-set-due="${d}" class="${td.due === d ? 'on' : ''}">${l}<small>${fmtDate(d)}</small></button>`).join('')}</div>
    <label class="due-pop-pick">Or pick a date <input type="date" id="due-pop-date" value="${td.due || ''}"></label>
    <div class="due-pop-foot">${td.due ? '<button type="button" class="link" data-set-due="">✕ No due date</button>' : '<span></span>'}<button type="button" class="link" id="due-pop-close">Close</button></div>`;
  duePop.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = duePop.offsetWidth;
  const h2 = duePop.offsetHeight;
  duePop.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, r.left))}px`;
  duePop.style.top = `${r.bottom + 8 + h2 < window.innerHeight ? r.bottom + 6 : Math.max(12, r.top - h2 - 6)}px`;
}
function closeDuePicker() { duePop.hidden = true; duePopFor = null; }

async function setDue(id, due) {
  const td = state.todos.find((x) => x.id === id);
  closeDuePicker();
  await actions.updateTodo(id, { due });
  toast(due ? `📅 “${shorten(td?.text, 30)}” is now due ${fmtDate(due)}` : `📅 Removed the due date from “${shorten(td?.text, 30)}”`);
}

duePop.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-set-due]');
  if (b && duePopFor) setDue(duePopFor, b.dataset.setDue);
  if (ev.target.id === 'due-pop-close') closeDuePicker();
});
duePop.addEventListener('change', (ev) => {
  if (ev.target.id === 'due-pop-date' && ev.target.value && duePopFor) setDue(duePopFor, ev.target.value);
});
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-due-edit]');
  if (b) {
    ev.stopPropagation();
    const td = state.todos.find((x) => x.id === b.dataset.dueEdit);
    if (duePopFor === td?.id) closeDuePicker(); else if (td) openDuePicker(b, td);
    return;
  }
  if (!duePop.hidden && !duePop.contains(ev.target)) closeDuePicker();
}, true);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !duePop.hidden) closeDuePicker(); });
window.addEventListener('scroll', () => { if (!duePop.hidden) closeDuePicker(); }, { passive: true });

// ---- Urgency picker for to-dos

const PRIORITY_LABEL = { high: '🔥 Urgent', normal: '⚑ Normal', low: '🐢 Low' };
const priPop = Object.assign(document.createElement('div'), { className: 'due-pop pri-pop', hidden: true });
document.body.append(priPop);
let priPopFor = null;

function openPriorityPicker(btn, td) {
  priPopFor = td.id;
  const cur = td.priority || 'normal';
  priPop.innerHTML = `
    <div class="due-pop-title">How urgent is it?</div>
    <div class="pri-pop-list">
      <button type="button" data-set-pri="high" class="${cur === 'high' ? 'on' : ''}">🔥 Urgent<small>Shows first, marked in red</small></button>
      <button type="button" data-set-pri="normal" class="${cur === 'normal' ? 'on' : ''}">⚑ Normal</button>
      <button type="button" data-set-pri="low" class="${cur === 'low' ? 'on' : ''}">🐢 Low<small>Whenever there's time</small></button>
    </div>`;
  priPop.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = priPop.offsetWidth;
  const ht = priPop.offsetHeight;
  priPop.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, r.left))}px`;
  priPop.style.top = `${r.bottom + 8 + ht < window.innerHeight ? r.bottom + 6 : Math.max(12, r.top - ht - 6)}px`;
}
function closePriorityPicker() { priPop.hidden = true; priPopFor = null; }
priPop.addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-set-pri]');
  if (!b || !priPopFor) return;
  const id = priPopFor;
  const td = state.todos.find((x) => x.id === id);
  closePriorityPicker();
  await actions.updateTodo(id, { priority: b.dataset.setPri });
  toast(`“${shorten(td?.text, 30)}” is now ${{ high: 'urgent 🔥', normal: 'normal priority', low: 'low priority 🐢' }[b.dataset.setPri]}`);
});
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-pri-edit]');
  if (b) {
    ev.stopPropagation();
    const td = state.todos.find((x) => x.id === b.dataset.priEdit);
    if (priPopFor === td?.id) closePriorityPicker(); else if (td) openPriorityPicker(b, td);
    return;
  }
  if (!priPop.hidden && !priPop.contains(ev.target)) closePriorityPicker();
}, true);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !priPop.hidden) closePriorityPicker(); });
window.addEventListener('scroll', () => { if (!priPop.hidden) closePriorityPicker(); }, { passive: true });

// ---- Project picker for to-dos

const projPop = Object.assign(document.createElement('div'), { className: 'due-pop proj-pop', hidden: true });
document.body.append(projPop);
let projPopFor = null;

function openProjectPicker(btn, td) {
  projPopFor = td.id;
  const projects = state.settings.projects || [];
  projPop.innerHTML = `
    <div class="due-pop-title">🌷 Which project is this for?</div>
    <div class="proj-pop-list">${projects.map((pr) => `<button type="button" data-set-proj="${h(pr)}" class="${td.project === pr ? 'on' : ''}">${h(displayProject(pr))}</button>`).join('') || '<p class="muted">No projects yet. Add one below.</p>'}</div>
    <div class="proj-pop-new"><input id="proj-pop-new" placeholder="+ New project…"><button type="button" class="btn primary small" id="proj-pop-add">Add</button></div>
    <div class="due-pop-foot">${td.project ? '<button type="button" class="link" data-set-proj="">✕ No project</button>' : '<span></span>'}<button type="button" class="link" id="proj-pop-close">Close</button></div>`;
  projPop.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = projPop.offsetWidth;
  const ht = projPop.offsetHeight;
  projPop.style.left = `${Math.min(window.innerWidth - w - 12, Math.max(12, r.left))}px`;
  projPop.style.top = `${r.bottom + 8 + ht < window.innerHeight ? r.bottom + 6 : Math.max(12, r.top - ht - 6)}px`;
}
function closeProjectPicker() { projPop.hidden = true; projPopFor = null; }

async function setTodoProject(id, project) {
  const td = state.todos.find((x) => x.id === id);
  closeProjectPicker();
  if (project && !(state.settings.projects || []).includes(project)) {
    await api('PATCH', 'settings', { projects: [...(state.settings.projects || []), project] }); // new project
  }
  await actions.updateTodo(id, { project });
  toast(project ? `🌷 “${shorten(td?.text, 30)}” is now under ${displayProject(project)}` : `Removed the project from “${shorten(td?.text, 30)}”`);
}
function addNewProjectFromPicker() {
  const name = $('#proj-pop-new').value.trim();
  if (name && projPopFor) setTodoProject(projPopFor, (state.settings.projects || []).find((p2) => p2.toLowerCase() === name.toLowerCase()) || name);
}
projPop.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-set-proj]');
  if (b && projPopFor) setTodoProject(projPopFor, b.dataset.setProj);
  if (ev.target.id === 'proj-pop-add') addNewProjectFromPicker();
  if (ev.target.id === 'proj-pop-close') closeProjectPicker();
});
projPop.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.id === 'proj-pop-new') { ev.preventDefault(); addNewProjectFromPicker(); } });
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-proj-edit]');
  if (b) {
    ev.stopPropagation();
    const td = state.todos.find((x) => x.id === b.dataset.projEdit);
    closeDuePicker();
    if (projPopFor === td?.id) closeProjectPicker(); else if (td) openProjectPicker(b, td);
    return;
  }
  if (!projPop.hidden && !projPop.contains(ev.target)) closeProjectPicker();
}, true);
document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !projPop.hidden) closeProjectPicker(); });
window.addEventListener('scroll', () => { if (!projPop.hidden) closeProjectPicker(); }, { passive: true });

function deletedTodoLi(td) {
  const dates = [stamp('Added', td.createdAt), td.doneAt && stamp('Completed', td.doneAt, 'done-stamp'), stamp('Deleted', td.deletedAt, 'del-stamp')].filter(Boolean).join(' · ');
  return `<li class="deleted" data-deleted-todo="${td.id}">
    <span class="del-icon">🗑️</span>
    <div class="t"><span>${h(td.text)}</span>${td.project ? `<div class="meta">${h(displayProject(td.project))}</div>` : ''}<div class="meta dates">${dates}</div></div>
    <button type="button" class="btn ghost small" data-restore-todo="${td.id}">↩️ Restore</button></li>`;
}

function renderToday() {
  const t = isoDate();
  const todays = state.entries.filter((e) => e.date === t).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  $('#today-entries').innerHTML = todays.length ? todays.map(entryLi).join('') : '<li class="empty">Nothing logged yet today. Tell Jarvis what you worked on.</li>';
  $('#today-hours').textContent = todays.length ? `${fmtHours(sum(todays, (e) => e.hours))} logged` : '';
  const b = todoBuckets(state.todos);
  const list = [...b.overdue, ...b.today, ...b.upcoming, ...b.someday].slice(0, 8);
  $('#today-todos').innerHTML = list.length ? list.map(todoLi).join('') : '<li class="empty">All clear ✨</li>';
  const urgent = b.overdue.length + b.today.length;
  const badge = $('#todo-badge');
  badge.hidden = !urgent;
  badge.textContent = urgent;
}

// Which project the To-Dos page is showing: '' = all, NO_PROJECT = to-dos without one.
const NO_PROJECT = '__none__';
let todoFilter = '';
const matchesFilter = (td) => !todoFilter || (todoFilter === NO_PROJECT ? !td.project : td.project === todoFilter);

// Due-date filter and "urgent only" switch for open to-dos.
let dueFilter = '';
let urgentOnly = false;
const DUE_FILTERS = [
  ['', 'All'], ['overdue', '⚠️ Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'],
  ['7', 'Next 7 days'], ['30', 'Next 30 days'], ['none', 'No date'],
];
function matchesDue(td, f = dueFilter) {
  const t = isoDate();
  if (!f) return true;
  if (f === 'none') return !td.due;
  if (!td.due) return false;
  if (f === 'overdue') return td.due < t;
  if (f === 'today') return td.due === t;
  if (f === 'tomorrow') return td.due === isoDate(addDays(new Date(), 1));
  return td.due >= t && td.due <= isoDate(addDays(new Date(), Number(f))); // next N days
}
const matchesUrgent = (td) => !urgentOnly || td.priority === 'high';

function renderDueFilter() {
  const open = state.todos.filter((t) => !t.done && matchesFilter(t));
  const chips = DUE_FILTERS.map(([v, label]) => {
    const n = open.filter((t) => matchesDue(t, v) && matchesUrgent(t)).length;
    return `<button type="button" data-due-filter="${v}" class="${dueFilter === v ? 'on' : ''} ${v === 'overdue' && n ? 'warn' : ''} ${n ? '' : 'zero'}">${label} <span class="n">${n}</span></button>`;
  }).join('');
  const urgentN = open.filter((t) => t.priority === 'high' && matchesDue(t)).length;
  $('#todo-due-filter').innerHTML = `<span class="chips-label">Due:</span>${chips}
    <button type="button" class="urgent-toggle ${urgentOnly ? 'on' : ''}" id="urgent-only" aria-pressed="${urgentOnly}">🔥 Urgent only <span class="n">${urgentN}</span></button>`;
}
$('#todo-due-filter').onclick = (ev) => {
  const b = ev.target.closest('[data-due-filter]');
  if (b) { dueFilter = b.dataset.dueFilter; renderTodos(); return; }
  if (ev.target.closest('#urgent-only')) { urgentOnly = !urgentOnly; renderTodos(); }
};

// Urgent first; Upcoming is by date (then urgency) so it can be grouped by day.
const PRI_RANK = { high: 0, normal: 1, low: 2 };
const byUrgency = (a, b) => (PRI_RANK[a.priority] ?? 1) - (PRI_RANK[b.priority] ?? 1) || ((a.due || '9') < (b.due || '9') ? -1 : 1);
const byDate = (a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : (PRI_RANK[a.priority] ?? 1) - (PRI_RANK[b.priority] ?? 1));

function upcomingWithHeadings(items) {
  let last = '';
  return items.map((td) => {
    const head = td.due !== last ? `<li class="date-head">${td.due === isoDate(addDays(new Date(), 1)) ? 'Tomorrow · ' : ''}${fmtDate(td.due)}</li>` : '';
    last = td.due;
    return head + todoLi(td);
  }).join('');
}

function renderTodoFilter() {
  const open = state.todos.filter((t) => !t.done);
  const known = [...new Set([...(state.settings.projects || []), ...open.map((t) => t.project).filter(Boolean)])];
  if (todoFilter && todoFilter !== NO_PROJECT && !known.includes(todoFilter)) todoFilter = '';
  const count = (fn) => open.filter(fn).length;
  const chip = (value, label, n) => `<button type="button" data-todo-filter="${h(value)}" class="${todoFilter === value ? 'on' : ''}">${label} <span class="n">${n}</span></button>`;
  const noneCount = count((t) => !t.project);
  $('#todo-filter').innerHTML = `<span class="chips-label">Show:</span>${chip('', 'All', open.length)}${
    known.map((pr) => chip(pr, `🌷 ${h(displayProject(pr))}`, count((t) => t.project === pr))).join('')}${
    noneCount ? chip(NO_PROJECT, 'No project', noneCount) : ''}`;
  // New to-dos go into the project being shown.
  if (todoFilter && todoFilter !== NO_PROJECT) $('#todo-project').value = todoFilter;
}
$('#todo-filter').onclick = (ev) => {
  const b = ev.target.closest('[data-todo-filter]');
  if (!b) return;
  todoFilter = b.dataset.todoFilter;
  if (!todoFilter || todoFilter === NO_PROJECT) $('#todo-project').value = '';
  renderTodos();
};

function renderTodos() {
  renderTodoFilter();
  renderDueFilter();
  const filtered = state.todos.filter((t) => matchesFilter(t) && (t.done || (matchesDue(t) && matchesUrgent(t))));
  const b = todoBuckets(filtered);
  const filtering = dueFilter || urgentOnly;
  const cols = [
    ['overdue', 'Overdue', b.overdue.sort(byUrgency)], ['today', 'Today', b.today.sort(byUrgency)],
    ['upcoming', 'Upcoming', b.upcoming.sort(byDate)], ['someday', 'No date', b.someday.sort(byUrgency)],
  ].filter(([k, , items]) => items.length || (k === 'today' && !filtering));
  $('#todo-columns').innerHTML = cols.length ? cols.map(([k, label, items]) => `
    <div class="todo-col ${k}"><h3>${label} <span class="n">${items.length}</span></h3>
    <ul class="todo-list">${!items.length ? '<li class="empty">Nothing here</li>' : k === 'upcoming' ? upcomingWithHeadings(items) : items.map(todoLi).join('')}</ul></div>`).join('')
    : `<div class="todo-col empty-col"><p class="empty">No to-dos match. <button type="button" class="link" id="clear-todo-filters">Show all</button></p></div>`;
  const clear = $('#clear-todo-filters');
  if (clear) clear.onclick = () => { dueFilter = ''; urgentOnly = false; todoFilter = ''; renderTodos(); };
  const allDone = state.todos.filter((x) => x.done && matchesFilter(x));
  const done = allDone.sort((a, b2) => (a.doneAt < b2.doneAt ? 1 : -1)).slice(0, 100);
  $('#done-count').textContent = `(${allDone.length})`;
  $('#todo-done').innerHTML = done.map(todoLi).join('');
  const deleted = (state.deletedTodos || []).filter(matchesFilter);
  $('#deleted-count').textContent = `(${deleted.length})`;
  $('#todo-deleted').innerHTML = deleted.length ? deleted.map(deletedTodoLi).join('') : '<li class="empty">Nothing deleted.</li>';
}

function renderLog() {
  const range = periodRange(logPeriod());
  const isDay = $('#log-period').value === 'day';
  $('#day-picker').hidden = !isDay;
  $('#day-copy').hidden = !isDay;
  const q = $('#log-search').value.toLowerCase();
  const es = filterEntries(state.entries, { range, project: $('#log-project').value, category: $('#log-category').value })
    .filter((e) => !q || [e.project, e.task, e.workDone, e.notes, e.category].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.date === b.date ? ((a.createdAt < b.createdAt) === isDay ? -1 : 1) : a.date < b.date ? 1 : -1));
  $('#log-body').innerHTML = es.length ? es.map((e) => `
    <tr data-entry="${e.id}" title="Click to change">
      <td class="nowrap"><button type="button" class="link day-link" data-day="${e.date}" title="See everything from this day">${fmtDate(e.date)}</button></td><td>${h(displayProject(e.project))}</td>
      <td class="wd">${h(e.workDone || e.task)}</td><td>${e.category ? `<span class="tag">${h(e.category)}</span>` : ''}</td>
      <td class="num">${fmtNum(e.hours)}</td><td>${h(e.notes)}</td><td class="actions-col">${rowActions(e)}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="empty">${isDay
      ? `Nothing was logged on ${fmtDate(range.from, true)}. Use ◀ ▶ to look at other days, or click “+ Log work” to add something for this day.`
      : 'Nothing here yet. Try “Everything” in the Show menu, or click “+ Log work”.'}</td></tr>`;
  $('#log-total').textContent = fmtNum(sum(es, (e) => e.hours));

  // A friendly heading for a single day: date, total, and to-dos finished that day.
  const heading = $('#log-heading');
  heading.hidden = !isDay;
  if (isDay) {
    const done = state.todos.filter((t) => t.done && (t.doneAt || '').slice(0, 10) === range.from);
    const dayName = parseIso(range.from).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    heading.innerHTML = `<h2>📅 ${dayName}</h2>
      <p>${es.length ? `${es.length} ${es.length === 1 ? 'thing' : 'things'} logged · <b>${fmtHours(sum(es, (e) => e.hours))}</b>` : 'Nothing logged'}${done.length ? ` · ✅ ${done.length} ${done.length === 1 ? 'to-do' : 'to-dos'} finished: ${done.map((t) => h(t.text)).join(', ')}` : ''}</p>`;
  }
}

/** The My Work filter as a period: a named range, or "day:YYYY-MM-DD". */
function logPeriod() {
  const v = $('#log-period').value;
  if (v !== 'day') return v;
  if (!$('#log-day').value) $('#log-day').value = isoDate();
  return `day:${$('#log-day').value}`;
}

/** Jump to My Work showing one day. */
function openDay(date) {
  $('#log-period').value = 'day';
  $('#log-day').value = date;
  $('#log-project').value = '';
  $('#log-category').value = '';
  $('#log-search').value = '';
  show('log');
}

function stepDay(n) {
  $('#log-day').value = isoDate(addDays(parseIso(logPeriod().slice(4)), n));
  renderLog();
}
$('#day-prev').onclick = () => stepDay(-1);
$('#day-next').onclick = () => stepDay(1);
$('#log-day').onchange = renderLog;
$('#day-copy').onclick = () => {
  const r = buildReport(state, { period: logPeriod(), project: $('#log-project').value });
  navigator.clipboard.writeText(r.text);
  toast('Day summary copied 📋 Paste it anywhere');
};

// --- dashboard: single-series bar charts (one hue, no legend needed)

const tip = Object.assign(document.createElement('div'), { className: 'tip' });
document.body.append(tip);
document.addEventListener('mousemove', (ev) => {
  const t = ev.target.closest('[data-tip]');
  if (!t) { tip.style.display = 'none'; return; }
  tip.textContent = t.dataset.tip;
  tip.style.display = 'block';
  tip.style.left = `${ev.clientX + 12}px`;
  tip.style.top = `${ev.clientY + 12}px`;
});

function hbars(rows, labelFn) {
  if (!rows.length || !rows.some((r) => r.hours > 0)) return '<div class="empty">No hours logged yet.</div>';
  const max = Math.max(...rows.map((r) => r.hours), 0.01);
  const total = sum(rows, (r) => r.hours);
  return rows.map((r) => `
    <div class="hbar ${r.hours ? '' : 'zero'}" data-tip="${h(labelFn(r.key))}: ${fmtHours(r.hours)} (${Math.round((r.hours / total) * 100)}%)">
      <span class="lab">${h(labelFn(r.key))}</span>
      <div class="track"><div class="fill" style="width:${(r.hours / max) * 100}%"></div></div>
      <span class="val">${fmtNum(r.hours)}</span>
    </div>`).join('');
}

function renderDashboard() {
  const st = stats(state);
  const b = todoBuckets(state.todos);
  const tile = (label, v, unit = 'hrs') => `<div class="stat"><div class="label">${label}</div><div class="value">${v}<small>${unit}</small></div></div>`;
  $('#stat-row').innerHTML =
    tile('Today', fmtNum(st.today)) + tile(`This week (since ${fmtDate(st.weekStart)})`, fmtNum(st.week)) +
    tile('This month', fmtNum(st.month)) + tile('Open to-dos', b.open.length, b.overdue.length ? ` · ${b.overdue.length} overdue` : '');

  const today = isoDate();
  const max = Math.max(...st.dailyWeek.map((d) => d.hours), 1);
  $('#chart-days').innerHTML = `
    <div class="vbars">${st.dailyWeek.map((d) => `
      <div class="vbar ${d.date === today ? 'today' : ''}" data-tip="${fmtDate(d.date)}: ${fmtHours(d.hours)}">
        ${d.hours ? `<span class="v">${fmtNum(d.hours)}</span>` : ''}
        <div class="fill" style="height:${(d.hours / max) * 85}%"></div>
      </div>`).join('')}</div>
    <div class="vlabels">${st.dailyWeek.map((d) => `<span>${d.date === today ? '🌸 ' : ''}${parseIso(d.date).toLocaleDateString('en-US', { weekday: 'short' })}</span>`).join('')}</div>`;

  const catScope = $('#cat-scope').value;
  const catRows = catScope === 'week' ? st.categoryWeek : st.categoryAll;
  const allCats = (state.settings.categories || []).map((c) => catRows.find((r) => r.key === c) || { key: c, hours: 0 });
  const extra = catRows.filter((r) => !(state.settings.categories || []).includes(r.key));
  $('#chart-cats').innerHTML = hbars([...allCats, ...extra].sort((a, b2) => b2.hours - a.hours), (k) => k || 'Uncategorized');

  const projRows = $('#proj-scope').value === 'week' ? st.projectWeek : st.projectAll;
  $('#chart-projects').innerHTML = hbars(projRows, displayProject);

  $('#report-text').textContent = buildReport(state, { period: $('#report-period').value, project: $('#report-project').value }).text;
}

function fillProjectSelects() {
  const projects = [...new Set([...(state.settings.projects || []), ...state.entries.map((e) => e.project).filter(Boolean)])];
  for (const sel of ['#log-project', '#report-project', '#todo-project']) {
    const el = $(sel);
    const v = el.value;
    const first = el.options[0].outerHTML;
    el.innerHTML = first + projects.map((p) => `<option value="${h(p)}">${h(displayProject(p))}</option>`).join('');
    el.value = projects.includes(v) ? v : '';
  }
  const cat = $('#log-category');
  const cv = cat.value;
  cat.innerHTML = '<option value="">All types</option>' + (state.settings.categories || []).map((c) => `<option>${h(c)}</option>`).join('');
  cat.value = cv;
}

// ------------------------------------------------------------------ entry dialog

const dlg = $('#entry-dialog');
let editingId = null;
function syncEntryChips() {
  const f = $('#entry-form');
  const hrs = parseFloat(f.hours.value);
  $$('#time-chips [data-h]').forEach((b) => b.classList.toggle('on', parseFloat(b.dataset.h) === hrs));
  $$('#project-chips [data-p]').forEach((b) => b.classList.toggle('on', b.dataset.p === f.project.value));
}

function openEntry(entry = null) {
  editingId = entry?.id || null;
  const f = $('#entry-form');
  $('#entry-dialog-title').textContent = editingId ? '✏️ Change this entry'
    : entry?.date && entry.date !== isoDate() ? `🌷 Log work for ${fmtDate(entry.date)}` : '🌷 Log work';
  // New entries: leave the type blank and let Jarvis decide from the words.
  f.category.innerHTML = categoryOptions(entry?.category || '').replace('(none)', '✨ Let Jarvis decide');
  f.date.value = entry?.date || isoDate();
  f.hours.value = entry?.hours ?? '';
  for (const k of ['project', 'task', 'workDone', 'notes']) f[k].value = entry?.[k] || '';
  $('#project-chips').innerHTML = (state.settings.projects || [])
    .map((p) => `<button type="button" data-p="${h(p)}">${h(displayProject(p))}</button>`).join('');
  $('.more', f).open = false;
  $('#entry-delete').hidden = !editingId;
  syncEntryChips();
  dlg.showModal();
  if (!editingId) f.workDone.focus();
}
$('#time-chips').onclick = (ev) => {
  const b = ev.target.closest('[data-h]');
  if (!b) return;
  $('#entry-form').hours.value = b.dataset.h;
  syncEntryChips();
};
$('#project-chips').onclick = (ev) => {
  const b = ev.target.closest('[data-p]');
  if (!b) return;
  const f = $('#entry-form');
  f.project.value = f.project.value === b.dataset.p ? '' : b.dataset.p;
  syncEntryChips();
};
$('#entry-form').hours.oninput = syncEntryChips;
$('#entry-form').project.oninput = syncEntryChips;
$('#entry-cancel').onclick = () => dlg.close();
$('#entry-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const s = state.settings;
  const workDone = f.workDone.value.trim();
  const data = {
    date: f.date.value || isoDate(), hours: parseFloat(f.hours.value), project: f.project.value.trim(),
    task: f.task.value.trim() || shortTask(workDone), workDone,
    category: f.category.value || guessCategory(`${workDone} ${f.notes.value}`, s.keywords, s.categories) || s.defaultCategory || '',
    notes: f.notes.value.trim(),
  };
  if (!data.workDone && !data.task) { toast('✏️ Write a few words about what you did'); f.workDone.focus(); return; }
  if (!(data.hours > 0)) { toast('⏱ Pick how long it took'); return; }
  if (editingId) await actions.updateEntry(editingId, data); else await actions.addEntry(data);
  dlg.close();
  if (editingId) toast('Entry updated ✏️');
  else { celebrate(); toast(cheer()); }
};
$('#entry-delete').onclick = async () => {
  if (!editingId) return;
  const id = editingId;
  dlg.close();
  await removeEntry(id);
};

document.addEventListener('click', (ev) => {
  const del = ev.target.closest('[data-del]');
  if (del) { removeEntry(del.dataset.del); return; }
  const edit = ev.target.closest('[data-edit]');
  if (edit) { openEntry(state.entries.find((e) => e.id === edit.dataset.edit)); return; }
  const dayBtn = ev.target.closest('[data-day]');
  if (dayBtn) { openDay(dayBtn.dataset.day); return; }
  const row = ev.target.closest('[data-entry]');
  if (row) openEntry(state.entries.find((e) => e.id === row.dataset.entry));
});

// ------------------------------------------------------------------ to-do interactions

document.addEventListener('change', async (ev) => {
  const li = ev.target.closest('[data-todo]');
  if (!li || ev.target.type !== 'checkbox') return;
  const id = li.dataset.todo;
  const td = state.todos.find((x) => x.id === id);
  if (ev.target.checked && td) {
    celebrate(ev.target);
    const res = await jarvis.completeTodo(td); // marks done, then offers to log time
    delete res.celebrate;
    jarvisSay(res, false);
  } else {
    await actions.updateTodo(id, { done: false });
  }
});
document.addEventListener('click', async (ev) => {
  const restoreBtn = ev.target.closest('[data-restore-todo]');
  if (restoreBtn) {
    await actions.restoreTodo(restoreBtn.dataset.restoreTodo);
    toast('Brought it back 🌷');
    return;
  }
  if (!ev.target.matches('.todo-list .x')) return;
  const li = ev.target.closest('[data-todo]');
  const td = state.todos.find((x) => x.id === li.dataset.todo);
  await actions.deleteTodo(li.dataset.todo);
  toast(`🗑️ Deleted “${shorten(td?.text, 40)}” (see To-Dos → Deleted)`, {
    action: '↩️ Undo',
    onAction: async () => { await actions.restoreTodo(td.id); toast('Brought it back 🌷'); },
  });
});
document.addEventListener('focusout', async (ev) => {
  const span = ev.target.closest('[data-todo] [contenteditable]');
  if (!span) return;
  const id = span.closest('[data-todo]').dataset.todo;
  const text = span.textContent.trim();
  const td = state.todos.find((x) => x.id === id);
  if (td && text && text !== td.text) await actions.updateTodo(id, { text });
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.matches('[data-todo] [contenteditable]')) { ev.preventDefault(); ev.target.blur(); }
});

function parseQuickTodo(text) {
  const c = parseCommand(`add to-do: ${text}`, { projects: state.settings.projects });
  return { text: c.todo || text, due: c.due, priority: c.priority, project: c.project };
}

$('#quick-todo').onsubmit = async (ev) => {
  ev.preventDefault();
  const inp = $('#quick-todo-input');
  if (!inp.value.trim()) return;
  await actions.addTodo(parseQuickTodo(inp.value.trim()));
  inp.value = '';
};

$('#todo-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const quick = parseQuickTodo($('#todo-text').value.trim());
  await actions.addTodo({
    text: quick.text,
    project: $('#todo-project').value || quick.project,
    due: $('#todo-due').value || quick.due,
    priority: $('#todo-priority').value !== 'normal' ? $('#todo-priority').value : quick.priority,
  });
  ev.target.reset();
  renderTodoFilter(); // keep the project of the current view selected
};

// ------------------------------------------------------------------ settings

function keywordsToText(cats, kw) {
  return cats.map((c) => `${c}: ${(kw[c] || []).join(', ')}`).join('\n');
}
function textToKeywords(text) {
  const categories = [];
  const keywords = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    const name = (i >= 0 ? line.slice(0, i) : line).trim();
    if (!name) continue;
    categories.push(name);
    keywords[name] = i >= 0 ? line.slice(i + 1).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) : [];
  }
  return { categories, keywords };
}

// Projects as friendly chips instead of a text box.
function renderProjectEditor(projects) {
  const f = $('#settings-form');
  f.projects.value = JSON.stringify(projects);
  $('#project-editor').innerHTML = `
    ${projects.map((p, i) => `<span class="pchip">${h(displayProject(p))}<button type="button" data-remove="${i}" title="Remove">✕</button></span>`).join('')}
    <span class="padd"><input id="project-add" placeholder="Add a project or client…"><button type="button" class="btn primary small" id="project-add-btn">+ Add</button></span>`;
}
$('#project-editor').addEventListener('click', (ev) => {
  const projects = JSON.parse($('#settings-form').projects.value || '[]');
  const rm = ev.target.closest('[data-remove]');
  if (rm) {
    const name = projects[Number(rm.dataset.remove)];
    if (!confirm(`Remove "${displayProject(name)}" from your projects? (Work you already logged stays.)`)) return;
    projects.splice(Number(rm.dataset.remove), 1);
    renderProjectEditor(projects);
    saveSettings();
  }
  if (ev.target.id === 'project-add-btn') addProjectFromInput();
});
$('#project-editor').addEventListener('keydown', (ev) => {
  if (ev.target.id === 'project-add' && ev.key === 'Enter') { ev.preventDefault(); addProjectFromInput(); }
});
function addProjectFromInput() {
  const inp = $('#project-add');
  const name = inp.value.trim();
  if (!name) return;
  const projects = JSON.parse($('#settings-form').projects.value || '[]');
  if (!projects.some((p) => p.toLowerCase() === name.toLowerCase())) projects.push(name);
  renderProjectEditor(projects);
  $('#project-add').focus();
  saveSettings();
}

function renderGoogleStatus() {
  const s = state.settings;
  const el = $('#google-status');
  const f = $('#settings-form');
  for (const n of ['calendarEnabled', 'meetingPrompts']) f[n].closest('label').hidden = !s.sheetUrl;
  $('#sync-test').hidden = !s.sheetUrl;
  if (!s.sheetUrl) {
    el.className = 'google-status off';
    el.innerHTML = '<b>Not connected yet.</b> Connect once and Jarvis will copy your work into your Google Sheet and show your calendar meetings.';
    $('#google-connect').textContent = '🔗 Connect Google';
    return;
  }
  const err = state.sync?.lastError;
  el.className = `google-status ${err ? 'err' : 'on'}`;
  el.innerHTML = err
    ? `<b>⚠️ Something needs fixing.</b> ${h(err)}`
    : `<b>✅ Connected.</b> Your work is being saved to your Google Sheet${s.calendarEnabled ? ' and your meetings show on Home' : ''}.`;
  $('#google-connect').textContent = err ? '🔧 Fix the connection' : 'Set up again';
}

function renderSettings() {
  const s = state.settings;
  const f = $('#settings-form');
  f.userName.value = s.userName || '';
  renderProjectEditor(s.projects || []);
  renderGoogleStatus();
  f.sheetLink.value = s.sheetLink || '';
  f.keywords.value = keywordsToText(s.categories || [], s.keywords || {});
  f.defaultCategory.innerHTML = categoryOptions(s.defaultCategory);
  for (const k of ['speakReplies', 'autoBrief', 'notesToTodos', 'autoSaveVoiceLogs', 'calendarEnabled', 'calendarAll', 'meetingPrompts', 'driveBackup']) f[k].checked = !!s[k];
  f.meetingCategory.innerHTML = categoryOptions(s.meetingCategory).replace('<option value="">(none)</option>', '');
  f.checkInMinutes.value = String(s.checkInMinutes || 0);
  f.workStart.value = s.workStart || '09:00';
  f.workEnd.value = s.workEnd || '18:00';
  f.sheetUrl.value = s.sheetUrl || '';
  const voices = voice.voices;
  f.voiceName.innerHTML = '<option value="">Automatic</option>' + voices.map((v) => `<option ${v.name === s.voiceName ? 'selected' : ''} value="${h(v.name)}">${h(v.name)} (${h(v.lang)})</option>`).join('');
}

// Settings save themselves: no Save button to forget.
let saveTimer = null;
const settingsForm = $('#settings-form');
settingsForm.addEventListener('change', (ev) => { if (ev.target.id !== 'project-add') saveSettings(); });
settingsForm.addEventListener('input', (ev) => {
  if (['userName', 'keywords', 'sheetUrl', 'sheetLink'].includes(ev.target.name)) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSettings, 800);
  }
});

async function saveSettings() {
  clearTimeout(saveTimer);
  const f = settingsForm;
  const { categories, keywords } = textToKeywords(f.keywords.value);
  const prevCal = state.settings.calendarEnabled;
  const body = {
    userName: f.userName.value.trim(),
    projects: JSON.parse(f.projects.value || '[]'),
    sheetLink: f.sheetLink.value.trim(),
    categories, keywords,
    defaultCategory: f.defaultCategory.value,
    speakReplies: f.speakReplies.checked, autoBrief: f.autoBrief.checked, notesToTodos: f.notesToTodos.checked,
    autoSaveVoiceLogs: f.autoSaveVoiceLogs.checked,
    calendarEnabled: f.calendarEnabled.checked, calendarAll: f.calendarAll.checked,
    meetingPrompts: f.meetingPrompts.checked, meetingCategory: f.meetingCategory.value,
    driveBackup: f.driveBackup.checked,
    voiceName: f.voiceName.value, checkInMinutes: Number(f.checkInMinutes.value),
    workStart: f.workStart.value, workEnd: f.workEnd.value, sheetUrl: f.sheetUrl.value.trim(),
  };
  if (!categories.length) { toast('The types of work list can’t be empty'); return; }
  await api('PATCH', 'settings', body);
  if (body.calendarEnabled !== prevCal || body.calendarEnabled) loadCalendar(body.calendarEnabled !== prevCal);
  renderGoogleStatus();
  $('#settings-msg').textContent = '✓ Saved';
  clearTimeout(saveSettings.t);
  saveSettings.t = setTimeout(() => { $('#settings-msg').textContent = ''; }, 2000);
  if (body.checkInMinutes && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

$('#voice-test').onclick = () => {
  voice.voiceName = $('#settings-form').voiceName.value;
  voice.speak(`Hello${state.settings.userName ? ` ${state.settings.userName}` : ''}. I'm Jarvis, ready to track your day.`, true);
};
$('#copy-script').onclick = async () => {
  const code = await (await fetch('/api/apps-script')).text();
  await navigator.clipboard.writeText(code);
  toast('Script copied. Paste it into Apps Script.');
};
$('#sync-test').onclick = async () => {
  const msg = $('#sync-msg');
  msg.textContent = 'Testing…';
  try { msg.textContent = (await api('POST', 'sync/test')).message; } catch (err) { msg.textContent = `❌ ${err.message}`; }
};
$('#sync-all').onclick = async () => {
  const msg = $('#sync-msg');
  msg.textContent = 'Sending everything to the sheet…';
  try { await api('POST', 'sync/all'); msg.textContent = 'All data synced ✓'; } catch (err) { msg.textContent = `❌ ${err.message}`; }
};

// ------------------------------------------------------------------ navigation & controls

function show(view) {
  if (!$(`#view-${view}`)) view = 'today';
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#settings-btn').classList.toggle('active', view === 'settings');
  window.scrollTo({ top: 0 });
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'log') renderLog();
  if (view === 'dashboard') renderDashboard();
  if (view === 'settings') renderSettings();
  location.hash = view;
}
$$('.tabs button').forEach((b) => { b.onclick = () => show(b.dataset.view); });
$('#settings-btn').onclick = () => show('settings');
document.addEventListener('click', (ev) => { const g = ev.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });

['#log-period', '#log-project', '#log-category'].forEach((s) => { $(s).onchange = renderLog; });
$('#log-search').oninput = renderLog;
$('#log-new').onclick = () => openEntry($('#log-period').value === 'day' ? { date: logPeriod().slice(4) } : null);
$('#quick-log-btn').onclick = () => openEntry();
['#cat-scope', '#proj-scope', '#report-period', '#report-project'].forEach((s) => { $(s).onchange = renderDashboard; });
$('#report-copy').onclick = () => { navigator.clipboard.writeText($('#report-text').textContent); toast('Report copied'); };
$('#export-csv').onclick = () => {
  const range = periodRange(logPeriod());
  const es = filterEntries(state.entries, { range, project: $('#log-project').value, category: $('#log-category').value });
  const blob = new Blob([toCsv(es)], { type: 'text/csv' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `work-log-${isoDate()}.csv` });
  a.click();
};

$('#mic-btn').onclick = () => voice.toggle();
$('#ask-form').onsubmit = (ev) => {
  ev.preventDefault();
  const inp = $('#ask-input');
  const v = inp.value;
  inp.value = '';
  converse(v);
};
$('#chips').onclick = (ev) => { const s = ev.target.closest('[data-say]'); if (s) converse(s.dataset.say); };

document.addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'j') {
    ev.preventDefault();
    if (!$('#view-today').classList.contains('active')) show('today');
    voice.toggle();
  }
  if (ev.key === 'Escape') voice.stopSpeaking();
});

// ------------------------------------------------------------------ Home: greeting & big buttons

function renderHello() {
  const now = new Date();
  const hr = now.getHours();
  const part = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const flower = hr < 12 ? '🌷' : hr < 17 ? '🌻' : '🌙';
  const name = state.settings.userName;
  const t = isoDate(now);
  const hrs = sum(state.entries.filter((e) => e.date === t), (e) => e.hours);
  const open = state.todos.filter((x) => !x.done).length;
  const bits = [hrs ? `${fmtHours(hrs)} logged today` : 'Nothing logged yet today', `${open} ${open === 1 ? 'to-do' : 'to-dos'}`];
  $('#hello').innerHTML = `<h1>${part}${name ? `, ${h(name)}` : ''} ${flower}</h1><p>${bits.join(' · ')}</p>`;
  $('#chip-meetings').hidden = !state.settings.calendarEnabled;
}

$('#qa-talk').onclick = () => { $('#jarvis-panel').scrollIntoView({ behavior: 'smooth', block: 'center' }); voice.toggle(); };
$('#qa-log').onclick = () => openEntry();
$('#qa-timer').onclick = () => {
  const inp = $('#timer-form [name=task]');
  if (!inp) { toast('A timer is already running. Press “Stop & log” when you’re done.'); $('#timer-panel').scrollIntoView({ block: 'center' }); return; }
  inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inp.focus();
  $('#timer-panel').classList.add('flash');
  setTimeout(() => $('#timer-panel').classList.remove('flash'), 1200);
};
$('#qa-todo').onclick = () => {
  const inp = $('#quick-todo-input');
  inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  inp.focus();
  $('#todo-panel').classList.add('flash');
  setTimeout(() => $('#todo-panel').classList.remove('flash'), 1200);
};

// ------------------------------------------------------------------ step-by-step guides (one instruction per screen)

const guideDlg = $('#guide-dialog');
let guide = null; // { steps, i, onDone }

function runGuide(steps, onDone) {
  guide = { steps, i: 0, onDone };
  renderGuideStep();
  if (!guideDlg.open) guideDlg.showModal();
}

function renderGuideStep() {
  const { steps, i } = guide;
  const st = steps[i];
  $('#guide-progress').innerHTML = steps.map((_, k) => `<span class="${k < i ? 'done' : k === i ? 'now' : ''}"></span>`).join('');
  $('#guide-body').innerHTML = `${st.emoji ? `<div class="guide-emoji">${st.emoji}</div>` : ''}<h2>${st.title}</h2>${st.html || ''}`;
  $('#guide-back').style.visibility = i === 0 || st.noBack ? 'hidden' : 'visible';
  $('#guide-skip').hidden = !st.skip;
  $('#guide-skip').textContent = st.skip || 'Skip';
  $('#guide-next').textContent = st.nextLabel || (i === steps.length - 1 ? 'Finish 🌸' : 'Next →');
  $('#guide-next').hidden = !!st.hideNext;
  $('#guide-next').disabled = false;
  st.onShow?.($('#guide-body'));
  const first = $('#guide-body input');
  if (first) setTimeout(() => first.focus(), 50);
}

async function guideNext() {
  const st = guide.steps[guide.i];
  if (st.onNext) {
    $('#guide-next').disabled = true;
    const ok = await st.onNext($('#guide-body'));
    $('#guide-next').disabled = false;
    if (ok === false || !guide) return;
  }
  if (guide.i >= guide.steps.length - 1) return endGuide(true);
  guide.i += 1;
  renderGuideStep();
}
function endGuide(finished) {
  voiceCapture = null;
  const done = guide?.onDone;
  guide = null;
  guideDlg.close();
  done?.(finished);
}
$('#guide-next').onclick = guideNext;
$('#guide-back').onclick = () => { if (guide.i > 0) { guide.i -= 1; renderGuideStep(); } };
$('#guide-skip').onclick = async () => {
  const st = guide.steps[guide.i];
  if (st.onSkip) return st.onSkip();
  if (guide.i >= guide.steps.length - 1) return endGuide(false);
  guide.i += 1;
  renderGuideStep();
};
guideDlg.addEventListener('cancel', (ev) => { ev.preventDefault(); if (confirm('Close this setup? You can finish it later from ❓ Help.')) endGuide(false); });
guideDlg.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && !ev.target.dataset.enterAdd) { ev.preventDefault(); guideNext(); }
});

const kbd = (k) => `<kbd>${k}</kbd>`;
const ui = (t, cls = '') => `<span class="ui ${cls}">${t}</span>`;

// ---- Welcome (first time only)

function openWelcome() {
  welcomeFlow.thenGoogle = false;
  welcomeFlow.thenTour = false;
  let projects = (state.settings.projects || []).filter((p) => !/^example:/i.test(p));
  const drawProjects = (body) => {
    $('.wz-chips', body).innerHTML = projects.length
      ? projects.map((p, i) => `<span class="pchip">${h(p)}<button type="button" data-i="${i}">✕</button></span>`).join('')
      : '<span class="muted">No projects yet. Add one above.</span>';
  };
  runGuide([
    {
      emoji: '🌸', title: "Hi! I'm Jarvis.",
      html: `<p class="lead">I'll help you keep track of everything you do in your workday, so your timesheets, reports and to-dos take care of themselves.</p>
             <p>Setting me up takes about <b>2 minutes</b>.</p>`,
      nextLabel: "Let's go →", noBack: true,
    },
    {
      emoji: '👋', title: "What's your first name?",
      html: `<input class="big-input" id="wz-name" placeholder="Your first name" value="${h(state.settings.userName || '')}">`,
      onNext: async (body) => {
        const name = $('#wz-name', body).value.trim();
        if (!name) { toast('Type your first name 🙂'); return false; }
        await api('PATCH', 'settings', { userName: name });
        return true;
      },
    },
    {
      emoji: '🌷', title: 'What projects or clients do you work on?',
      html: `<p>Add each one. I'll listen for these names when you talk to me.</p>
             <div class="row"><input class="big-input" id="wz-proj" data-enter-add="1" placeholder="e.g. Acme Corp Rebrand"><button type="button" class="btn primary" id="wz-proj-add">+ Add</button></div>
             <div class="wz-chips"></div>
             <p class="muted">You can change these anytime in ⚙️ Settings.</p>`,
      onShow: (body) => {
        drawProjects(body);
        const add = () => {
          const inp = $('#wz-proj', body);
          const v = inp.value.trim();
          if (v && !projects.some((p) => p.toLowerCase() === v.toLowerCase())) projects.push(v);
          inp.value = '';
          inp.focus();
          drawProjects(body);
        };
        $('#wz-proj-add', body).onclick = add;
        $('#wz-proj', body).onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(); } };
        $('.wz-chips', body).onclick = (ev) => {
          const b = ev.target.closest('[data-i]');
          if (b) { projects.splice(Number(b.dataset.i), 1); drawProjects(body); }
        };
      },
      onNext: async (body) => {
        const pending = $('#wz-proj', body).value.trim();
        if (pending && !projects.includes(pending)) projects.push(pending);
        if (!projects.length) { toast('Add at least one project, or click Skip'); return false; }
        await api('PATCH', 'settings', { projects });
        return true;
      },
      skip: 'Skip for now',
    },
    {
      emoji: '🎤', title: "Let's test your microphone",
      html: `<p>Click the flower, then say <b>“Hello Jarvis”</b>.</p>
             <button type="button" class="mic wz-mic" id="wz-mic"><span class="mic-ring"></span><svg viewBox="0 0 24 24"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"/></svg></button>
             <p class="heard" id="wz-heard">If your browser asks to use the microphone, click <b>Allow</b>.</p>
             <label class="check"><input type="checkbox" id="wz-speak" ${state.settings.speakReplies ? 'checked' : ''}> Jarvis talks back out loud</label>`,
      onShow: (body) => {
        if (!voice.supported) {
          $('#wz-heard', body).innerHTML = '🎧 Talking needs <b>Google Chrome</b>. You can still type everything, so this step is optional.';
        }
        $('#wz-mic', body).onclick = () => {
          voiceCapture = (t) => {
            $('#wz-heard', body).innerHTML = `✅ I heard: <b>“${h(t)}”</b>. Your microphone works!`;
            celebrate($('#wz-mic', body));
            voice.speak(`Hello${state.settings.userName ? ` ${state.settings.userName}` : ''}! I can hear you perfectly.`, $('#wz-speak', body).checked);
          };
          voice.toggle();
        };
        $('#wz-speak', body).onchange = (ev) => api('PATCH', 'settings', { speakReplies: ev.target.checked });
      },
      onNext: async () => { voiceCapture = null; return true; },
      skip: 'Skip',
    },
    {
      emoji: '🔗', title: 'Connect your Google Sheet and Calendar?',
      html: `<p>Then everything you log is also saved in your Google Sheet, and your meetings show up in Jarvis.</p>
             <p class="muted">Optional. It takes about 3 minutes and I'll walk you through every click. You can also do it later from ⚙️ Settings.</p>`,
      nextLabel: 'Yes, connect Google',
      onNext: async () => { welcomeFlow.thenGoogle = true; endGuide(true); return false; },
      skip: 'Maybe later',
    },
    {
      emoji: '🎉', title: "You're all set!",
      html: `<p class="lead">Here's all you need to know:</p>
             <ul class="tips">
               <li>🎤 <b>Tap the flower</b> and tell me what you did, like “30 minutes pitching Axios for Spring Launch”.</li>
               <li>📝 Or use the big <b>Log work</b> button.</li>
               <li>❓ Stuck? Click <b>Help</b> at the top right anytime.</li>
             </ul>`,
      nextLabel: 'Show me around 🧭',
      skip: 'Start using Jarvis',
      onSkip: () => endGuide(true),
      onNext: async () => { welcomeFlow.thenTour = true; return true; },
    },
  ], async () => {
    await api('PATCH', 'meta', { onboarded: true });
    renderAll();
    if (welcomeFlow.thenGoogle) openGoogleGuide();
    else if (welcomeFlow.thenTour) startTour();
    else celebrate();
  });
}
// Choices made in the welcome guide ("connect Google next", "show me around").
const welcomeFlow = {};

// ---- Connect Google (Sheet + Calendar), one click per screen

function openGoogleGuide() {
  let copied = false;
  runGuide([
    {
      emoji: '🔗', title: 'Connect Google',
      html: `<p class="lead">This lets Jarvis save your work into your Google Sheet and show your calendar meetings.</p>
             <ul class="tips"><li>⏱ About 3 minutes</li><li>🖱 You'll copy and paste one thing and click a few buttons</li><li>🔒 Only you can use the connection, and Jarvis can't change your calendar</li></ul>
             <p class="muted">Tip: keep this box open. I'll tell you exactly where to click.</p>`,
      nextLabel: "Let's start →", noBack: true,
    },
    {
      emoji: '📗', title: 'Open your Google Sheet',
      html: `<p>Paste the link to your work tracker sheet (copy it from the address bar when the sheet is open):</p>
             <input class="big-input" id="g-sheet" placeholder="https://docs.google.com/spreadsheets/d/…" value="${h(state.settings.sheetLink || '')}">
             <p><button type="button" class="btn primary" id="g-open-sheet">📗 Open my sheet</button>
             <span class="muted"> or <a href="https://sheets.new" target="_blank" rel="noopener">start a new blank sheet</a></span></p>`,
      onShow: (body) => {
        $('#g-open-sheet', body).onclick = async () => {
          const link = $('#g-sheet', body).value.trim();
          if (!/^https:\/\/docs\.google\.com\/spreadsheets\//.test(link)) { toast('Paste your sheet link first. It starts with https://docs.google.com/spreadsheets'); return; }
          await api('PATCH', 'settings', { sheetLink: link });
          window.open(link, '_blank', 'noopener');
        };
      },
      onNext: async (body) => {
        const link = $('#g-sheet', body).value.trim();
        if (link && /^https:\/\/docs\.google\.com\/spreadsheets\//.test(link)) await api('PATCH', 'settings', { sheetLink: link });
        return true;
      },
    },
    {
      emoji: '🧩', title: 'Open Apps Script',
      html: `<p>In your Google Sheet, look at the menu along the top and click:</p>
             <div class="mock-menu">${ui('File')}${ui('Edit')}${ui('View')}${ui('Insert')}${ui('Format')}${ui('Data')}${ui('Tools')}${ui('Extensions', 'hl')}${ui('Help')}</div>
             <div class="mock-drop">${ui('Add-ons')}${ui('Macros')}${ui('Apps Script', 'hl')}</div>
             <p><b>Extensions → Apps Script</b>. A new tab opens with a code editor.</p>`,
    },
    {
      emoji: '📋', title: 'Copy and paste the code',
      html: `<p><b>Step 1.</b> Click this button:</p>
             <p><button type="button" class="btn primary big" id="g-copy">📋 Copy the code</button> <span id="g-copied" class="ok-note"></span></p>
             <p><b>Step 2.</b> In the Apps Script tab, click inside the code area and press ${kbd('⌘ Cmd')} + ${kbd('A')}, then ${kbd('Delete')}. The code area should be <b>completely empty</b>, with no <code>function myFunction() {</code> left.</p>
             <p><b>Step 3.</b> Press ${kbd('⌘ Cmd')} + ${kbd('V')} to paste.</p>
             <p><b>Step 4.</b> Click the save icon ${ui('💾')} (or press ${kbd('⌘ Cmd')} + ${kbd('S')}).</p>`,
      onShow: (body) => {
        $('#g-copy', body).onclick = async () => {
          const code = await (await fetch('/api/apps-script')).text();
          await navigator.clipboard.writeText(code);
          copied = true;
          $('#g-copied', body).textContent = '✓ Copied!';
        };
      },
      onNext: async () => { if (!copied) { toast('Click “Copy the code” first 📋'); return false; } return true; },
    },
    {
      emoji: '🚀', title: 'Turn it on',
      html: `<ol class="click-steps">
               <li>Click the blue ${ui('Deploy', 'blue')} button at the top right, then ${ui('New deployment')}.</li>
               <li>Click the gear ${ui('⚙️')} next to “Select type”, then choose ${ui('Web app')}.</li>
               <li>Under “Who has access”, change it to ${ui('Anyone', 'hl')}.</li>
               <li>Click ${ui('Deploy', 'blue')}.</li>
             </ol>`,
    },
    {
      emoji: '✅', title: 'Give permission',
      html: `<p>Google will ask you to allow the script you just pasted. It's yours, so this is safe:</p>
             <ol class="click-steps">
               <li>Click ${ui('Authorize access')} and choose your Google account.</li>
               <li>If you see <i>“Google hasn't verified this app”</i>, that's normal for your own scripts. Click ${ui('Advanced')}, then ${ui('Go to … (unsafe)')}.</li>
               <li>Click ${ui('Allow', 'blue')}.</li>
             </ol>`,
    },
    {
      emoji: '🔑', title: 'Paste the link here',
      html: `<p>Google now shows a <b>Web app</b> link. Click ${ui('Copy')} under it, then paste it here:</p>
             <input class="big-input" id="g-url" placeholder="https://script.google.com/macros/s/…/exec">
             <div class="check-list" id="g-checks"></div>`,
      nextLabel: 'Check it',
      onShow: (body) => {
        const inp = $('#g-url', body);
        inp.addEventListener('paste', () => setTimeout(() => guideNext(), 50));
      },
      onNext: async (body) => {
        const url = $('#g-url', body).value.trim();
        const checks = $('#g-checks', body);
        // (localhost is allowed only so the guide can be tested without Google)
        if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec|^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(url)) {
          checks.innerHTML = '<p class="bad">That doesn\'t look right. The link should start with <b>https://script.google.com/macros/s/</b> and end with <b>/exec</b>.</p>';
          return false;
        }
        checks.innerHTML = '<p>⏳ Checking your Google Sheet…</p>';
        const previousUrl = state.settings.sheetUrl || '';
        await api('PATCH', 'settings', { sheetUrl: url });
        try {
          await api('POST', 'sync/test');
        } catch (err) {
          await api('PATCH', 'settings', { sheetUrl: previousUrl }); // don't leave a broken link saved
          checks.innerHTML = `<p class="bad">❌ Couldn't reach your sheet: ${h(err.message)}</p><p class="muted">Check that “Who has access” was set to <b>Anyone</b>. You can click Back to see the steps again.</p>`;
          return false;
        }
        checks.innerHTML = '<p>✅ Google Sheet connected!</p><p>⏳ Checking your calendar…</p>';
        await api('PATCH', 'settings', { calendarEnabled: true });
        const c = await loadCalendar(true);
        checks.innerHTML = c.error
          ? '<p>✅ Google Sheet connected!</p><p class="bad">⚠️ Calendar didn\'t connect. That\'s OK, your sheet works. You can try again later from Settings.</p>'
          : `<p>✅ Google Sheet connected!</p><p>✅ Calendar connected (${meetingsOn(c.events, isoDate()).length} meetings today)</p>`;
        if (c.error) await api('PATCH', 'settings', { calendarEnabled: false });
        // First backup to Google Drive
        checks.insertAdjacentHTML('beforeend', '<p id="g-backup-line">⏳ Saving your first backup to Google Drive…</p>');
        await api('PATCH', 'settings', { driveBackup: true });
        const bk = (await api('POST', 'backup/now')).backups || {};
        $('#g-backup-line', body).outerHTML = bk.lastDriveAt && !bk.driveError
          ? '<p>✅ Backups to Google Drive are on (folder “Jarvis Backups”)</p>'
          : '<p class="bad">⚠️ Drive backups didn\'t work yet. Backups are still saved on your Mac. You can try again from Settings.</p>';
        api('POST', 'sync/all').catch(() => {}); // copy existing work into the sheet
        celebrate($('#g-checks', body));
        await new Promise((r) => setTimeout(r, 1200));
        return true;
      },
    },
    {
      emoji: '🎉', title: "You're connected!",
      html: `<ul class="tips"><li>📗 Everything you log is saved in your Google Sheet automatically.</li>
             <li>📅 Your meetings appear on Home, and I'll ask to log them when they end.</li></ul>`,
      noBack: true,
    },
  ], () => { renderAll(); renderSettings(); });
}

// ---- Guided tour (spotlight + bubble)

const TOUR = [
  ['#quick-actions', '👆 <b>These big buttons</b> are the quickest way to do anything: talk, log work, start a timer or add a to-do.'],
  ['#mic-btn', '🌼 <b>Tap the flower and just talk.</b> Say things like “I spent an hour drafting the Acme press release”.'],
  ['#ask-form', '⌨️ Prefer typing? <b>Type here</b> instead, in normal words.'],
  ['#today-panel', '📝 <b>Everything you did today</b> shows up here. Click any item to change it.'],
  ['#todo-panel', '✅ <b>Your to-dos.</b> Tick the circle when something is done.'],
  ['#main-tabs', '🗂 <b>Switch pages here.</b> My Work = everything you logged · To-Dos = your full list · Insights = charts and reports.'],
  ['#help-btn', '❓ <b>Lost?</b> Click Help anytime to see this tour again.'],
];
let tourI = -1;
function startTour() { show('today'); tourI = -1; nextTour(); }
function clearTourFocus() { $$('.tour-focus').forEach((x) => x.classList.remove('tour-focus')); }
function nextTour() {
  clearTourFocus();
  tourI += 1;
  const b = $('#tour-bubble');
  if (tourI >= TOUR.length) { b.hidden = true; toast('You’re ready! 🌸'); return; }
  const [sel, text] = TOUR[tourI];
  const el = $(sel);
  el.classList.add('tour-focus');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('#tour-text').innerHTML = text;
  $('#tour-count').textContent = `${tourI + 1} of ${TOUR.length}`;
  $('#tour-next').textContent = tourI === TOUR.length - 1 ? 'Finish' : 'Next →';
  b.hidden = false;
  setTimeout(() => {
    const r = el.getBoundingClientRect();
    const bw = b.offsetWidth;
    const below = r.bottom + 16 + b.offsetHeight < window.innerHeight;
    b.style.top = `${below ? r.bottom + 14 : Math.max(10, r.top - b.offsetHeight - 14)}px`;
    b.style.left = `${Math.min(window.innerWidth - bw - 12, Math.max(12, r.left + r.width / 2 - bw / 2))}px`;
  }, 350);
}
$('#tour-next').onclick = nextTour;
$('#tour-end').onclick = () => { clearTourFocus(); $('#tour-bubble').hidden = true; };

// ---- Help

const helpDlg = $('#help-dialog');
$('#help-btn').onclick = () => {
  $('#help-commands').innerHTML = HELP.sections.map((s) => `<div class="help-sec"><h4>${h(s.heading)}</h4><ul>${s.items.map((i) => `<li>${h(i)}</li>`).join('')}</ul></div>`).join('');
  helpDlg.showModal();
};
$('#help-close').onclick = () => helpDlg.close();
$('#help-tour').onclick = () => { helpDlg.close(); startTour(); };
$('#help-google').onclick = () => { helpDlg.close(); openGoogleGuide(); };
$('#google-connect').onclick = () => openGoogleGuide();
$('#rerun-welcome').onclick = () => openWelcome();

// ---- Saving & backups

const timeAgo = (iso) => {
  if (!iso) return 'not yet';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return d.toDateString() === new Date().toDateString()
    ? `today at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

function renderBackups() {
  const b = state.backups || {};
  const s = state.settings;
  const lines = [`<li>✅ <b>On this Mac:</b> last backup ${timeAgo(b.lastLocalAt)}</li>`];
  let showUpdate = false;
  if (!s.sheetUrl) {
    lines.push('<li>☁️ <b>Google Drive:</b> connect Google (above) to also keep backups in your Drive</li>');
  } else if (b.scriptOutdated) {
    lines.push('<li class="bad">⚠️ <b>Google:</b> your Google script needs a quick update to use the newest features. Click “Update Google script”.</li>');
    showUpdate = true;
  } else if (!s.driveBackup) {
    lines.push('<li>☁️ <b>Google Drive:</b> off</li>');
  } else if (b.driveError) {
    lines.push(`<li class="bad">⚠️ <b>Google Drive:</b> ${h(b.driveError)} <span class="muted">(Jarvis will keep trying every 5 minutes)</span></li>`);
    showUpdate = /permission|authoriz|access/i.test(b.driveError);
  } else {
    lines.push(`<li>✅ <b>Google Drive:</b> last backup ${timeAgo(b.lastDriveAt)}</li>`);
  }
  $('#backup-status').innerHTML = lines.join('');
  if (b.scriptOutdated && s.sheetUrl && !renderBackups.nudged && !guide) {
    renderBackups.nudged = true;
    toast('🔧 One quick step to update your Google connection', { action: 'Show me', onAction: openScriptUpdateGuide });
  }
  $('#drive-backup-row').hidden = !s.sheetUrl;
  $('#script-update').hidden = !showUpdate;
  const folder = $('#backup-folder');
  folder.hidden = !(s.sheetUrl && b.driveFolderUrl);
  if (b.driveFolderUrl) folder.href = b.driveFolderUrl;
}

$('#backup-now').onclick = async () => {
  const btn = $('#backup-now');
  btn.disabled = true;
  btn.textContent = '⏳ Backing up…';
  try {
    const b = (await api('POST', 'backup/now')).backups || {};
    toast(state.settings.sheetUrl && state.settings.driveBackup && b.driveError ? '💾 Saved on this Mac. Google Drive needs attention.' : '💾 Backed up!');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Back up now';
  }
};

$('#restore-file').onchange = async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t a Jarvis backup.'); return; }
  const n = Array.isArray(data.entries) ? data.entries.length : 0;
  if (!confirm(`Replace everything in Jarvis with this backup (${n} entries)?\n\nWhat you have now is saved first, just in case.`)) return;
  try {
    const r = await api('POST', 'backup/restore', { data });
    celebrate();
    toast(`♻️ ${r.message}`);
    renderSettings();
    loadCalendar(true);
  } catch (err) {
    toast(`❌ ${err.message}`);
  }
};

// Updating the Google script after Jarvis gains a feature (e.g. Drive backups).
function openScriptUpdateGuide() {
  let copied = false;
  runGuide([
    {
      emoji: '🔧', title: 'Update your Google script',
      html: `<p class="lead">Jarvis learned something new, so your Google script needs the newest code. It takes about a minute, and your link stays the same.</p>
             <p><button type="button" class="btn primary" id="u-open">📗 Open my Google Sheet</button></p>
             <p>In the sheet, click ${ui('Extensions', 'hl')} → ${ui('Apps Script', 'hl')}.</p>`,
      noBack: true,
      onShow: (body) => {
        $('#u-open', body).onclick = () => {
          if (state.settings.sheetLink) window.open(state.settings.sheetLink, '_blank', 'noopener');
          else toast('Open your Google Sheet, then click Extensions → Apps Script');
        };
      },
    },
    {
      emoji: '📋', title: 'Replace the code',
      html: `<p><b>1.</b> <button type="button" class="btn primary" id="u-copy">📋 Copy the new code</button> <span class="ok-note" id="u-copied"></span></p>
             <p><b>2.</b> In Apps Script, click in the code and press ${kbd('⌘ Cmd')} + ${kbd('A')}, then ${kbd('Delete')}, so it's <b>completely empty</b>.</p>
             <p><b>3.</b> Press ${kbd('⌘ Cmd')} + ${kbd('V')} to paste, then click ${ui('💾')} to save.</p>`,
      onShow: (body) => {
        $('#u-copy', body).onclick = async () => {
          await navigator.clipboard.writeText(await (await fetch('/api/apps-script')).text());
          copied = true;
          $('#u-copied', body).textContent = '✓ Copied!';
        };
      },
      onNext: async () => { if (!copied) { toast('Click “Copy the new code” first 📋'); return false; } return true; },
    },
    {
      emoji: '🚀', title: 'Turn on the new version',
      html: `<ol class="click-steps">
               <li>Click ${ui('Deploy', 'blue')} → ${ui('Manage deployments')}.</li>
               <li>Click the pencil ${ui('✏️')} (Edit).</li>
               <li>Under “Version”, choose ${ui('New version', 'hl')}.</li>
               <li>Click ${ui('Deploy', 'blue')}. If Google asks for permission (for example to use <b>Google Drive</b> for backups), click ${ui('Authorize access')} → your account → ${ui('Advanced')} → ${ui('Go to … (unsafe)')} → ${ui('Allow', 'blue')}.</li>
             </ol>`,
    },
    {
      emoji: '✅', title: "Let's check it",
      html: '<div class="check-list" id="u-checks"><p>Click <b>Check it</b> when you\'ve clicked Deploy.</p></div>',
      nextLabel: 'Check it',
      onNext: async (body) => {
        const checks = $('#u-checks', body);
        checks.innerHTML = '<p>⏳ Checking your Google script…</p>';
        try { await api('POST', 'sync/test'); } catch { /* reported below */ }
        const b = state.settings.driveBackup ? ((await api('POST', 'backup/now')).backups || {}) : (state.backups || {});
        if (state.backups?.scriptOutdated || b.scriptOutdated || (state.settings.driveBackup && b.driveError)) {
          checks.innerHTML = `<p class="bad">❌ ${h(b.driveError || 'Still the old code.')}</p><p class="muted">Make sure you chose <b>New version</b> before clicking Deploy. Click Back to see the steps.</p>`;
          return false;
        }
        checks.innerHTML = '<p>✅ All set! Your Google script is up to date.</p>';
        celebrate(checks);
        await new Promise((r) => setTimeout(r, 1200));
        return true;
      },
    },
  ], () => { renderAll(); renderSettings(); });
}
$('#script-update').onclick = () => openScriptUpdateGuide();

// ---- Updates

async function checkForUpdates(manual = false) {
  try {
    const r = await (await fetch('/api/update/check')).json();
    $('#version-line').textContent = `You have version ${r.current}.`;
    if (manual) {
      $('#update-msg').textContent = r.error ? r.error
        : r.available ? `Version ${r.latest} is ready.` : 'You have the newest version 🌸';
    }
    const dismissed = localStorage.getItem('jarvis.updateDismissed') === r.latest;
    $('#update-banner').hidden = !(r.available && (manual || !dismissed));
    $('#update-now').dataset.installed = r.installed ? '1' : '';
    return r;
  } catch { return null; }
}
$('#update-check').onclick = () => checkForUpdates(true);
$('#update-later').onclick = async () => {
  const r = await (await fetch('/api/update/check')).json();
  localStorage.setItem('jarvis.updateDismissed', r.latest);
  $('#update-banner').hidden = true;
};
$('#update-now').onclick = async () => {
  if (!$('#update-now').dataset.installed) {
    alert('This copy of Jarvis was set up by hand, so it can’t update itself.\n\nTo switch to the easy version, run the one-line installer from the README. Your work is kept.');
    return;
  }
  $('#update-banner').innerHTML = '⏳ Updating Jarvis… this takes a few seconds.';
  try {
    const res = await fetch('/api/update', { method: 'POST' });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error);
  } catch (err) {
    $('#update-banner').innerHTML = `❌ ${h(err.message)}`;
    return;
  }
  // Wait for Jarvis to come back, then reload.
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 750));
    try { if ((await fetch('/api/version')).ok && i > 1) { location.reload(); return; } } catch { /* restarting */ }
  }
  location.reload();
};

// ------------------------------------------------------------------ Google Calendar meetings

async function loadCalendar(refresh = false) {
  if (!state.settings.calendarEnabled) { calendar = { enabled: false, events: [], error: null }; renderMeetings(); return calendar; }
  // Monday of this week through a week from today covers "today", "tomorrow" and "this week".
  const now = new Date();
  const monday = addDays(now, -((now.getDay() + 6) % 7));
  const qs = `from=${isoDate(monday)}&to=${isoDate(addDays(now, 7))}${refresh ? '&refresh=1' : ''}`;
  try {
    const r = await (await fetch(`/api/calendar?${qs}`)).json();
    calendar = { enabled: !!r.enabled, events: r.events || [], error: r.error || null };
  } catch (err) {
    calendar = { ...calendar, error: err.message };
  }
  renderMeetings();
  return calendar;
}

function renderMeetings() {
  if (typeof calendar === 'undefined') return;
  const panel = $('#meetings-panel');
  panel.hidden = !state.settings.calendarEnabled;
  if (panel.hidden) return;
  const now = new Date();
  const todays = meetingsOn(calendar.events, isoDate(now));
  const list = $('#meeting-list');
  let html = calendar.error ? `<li class="cal-error">⚠️ ${h(calendar.error)}</li>` : '';
  html += todays.length ? todays.map((ev) => {
    const started = new Date(ev.start) <= now;
    const ended = new Date(ev.end) <= now;
    const cls = ended ? 'past' : started ? 'now' : '';
    const logged = isMeetingLogged(ev, state.entries);
    const action = logged
      ? '<span class="logged">✓ Logged</span>'
      : `<button class="btn ${ended ? 'primary' : 'ghost'} small" data-log-meeting="${h(ev.id)}">Log ${fmtHours(meetingHours(ev))}</button>`;
    return `<li class="${cls}"><span class="when">${fmtTime(ev.start)}</span>
      <div class="t"><b>${h(ev.title)}</b><span class="meta">${fmtHours(meetingHours(ev))}${ev.location ? ` · ${h(ev.location)}` : ''}${ev.guests ? ` · ${ev.guests} guests` : ''}</span></div>${action}</li>`;
  }).join('') : (calendar.error ? '' : '<li class="empty">No meetings today. Lots of time to make things bloom 🌷</li>');
  list.innerHTML = html;
  $('#meetings-log-all').hidden = !unloggedMeetings(full(), now).length;
}

document.addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-log-meeting]');
  if (!btn) return;
  const meeting = calendar.events.find((x) => x.id === btn.dataset.logMeeting);
  if (!meeting) return;
  celebrate(btn);
  const e = await actions.addEntry(meetingToEntry(meeting, state.settings));
  toast(`Logged ${fmtHours(e.hours)}: ${meeting.title} 🌸`);
});
$('#meetings-log-all').onclick = () => converse('log my meetings');
$('#meetings-refresh').onclick = async () => { await loadCalendar(true); toast('Calendar refreshed 📅'); };

$('#cal-test').onclick = async () => {
  const msg = $('#cal-msg');
  if (!state.settings.calendarEnabled) { msg.textContent = 'Tick “Show my Google Calendar meetings” and click Save first.'; return; }
  msg.textContent = 'Checking your calendar…';
  const c = await loadCalendar(true);
  if (c.error) msg.textContent = `❌ ${c.error}`;
  else {
    const n = meetingsOn(c.events, isoDate()).length;
    msg.textContent = `✅ Connected. ${n} ${n === 1 ? 'meeting' : 'meetings'} today, ${c.events.length} in the next week.`;
  }
};

// Ask once per meeting, shortly after it ends.
const PROMPTED_KEY = 'jarvis.promptedMeetings';
function meetingTick() {
  if (!state.settings.calendarEnabled || !state.settings.meetingPrompts) return;
  const prompted = new Set(JSON.parse(localStorage.getItem(PROMPTED_KEY) || '[]'));
  const now = Date.now();
  const just = unloggedMeetings(full(), new Date()).filter((ev) => !prompted.has(ev.id) && now - new Date(ev.end) < 15 * 60000);
  if (!just.length || jarvis.pending) return;
  const ev = just[0];
  prompted.add(ev.id);
  localStorage.setItem(PROMPTED_KEY, JSON.stringify([...prompted].slice(-200)));
  jarvisSay(jarvis.promptMeeting(ev));
  notify(`Your meeting "${ev.title}" just ended. Want to log it?`);
}

// ------------------------------------------------------------------ daily rhythm: brief, check-ins, wrap-up nudge

const minutesOf = (hhmm) => { const [a, b] = (hhmm || '0:0').split(':').map(Number); return a * 60 + b; };
let lastCheckIn = Date.now();

function notify(text) {
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Jarvis', { body: text });
  }
}

async function rhythmTick() {
  renderMeetings();
  meetingTick();
  const s = state.settings;
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const workday = now.getDay() >= 1 && now.getDay() <= 5;
  const inHours = workday && mins >= minutesOf(s.workStart) && mins < minutesOf(s.workEnd);
  const today = isoDate(now);

  // Check-in: nothing logged for N minutes during work hours and no timer running
  const inMeeting = calendar.events.some((ev) => new Date(ev.start) <= now && new Date(ev.end) > now);
  if (s.checkInMinutes && inHours && !state.timer && !inMeeting) {
    const todays = state.entries.filter((e) => e.date === today);
    const lastActivity = Math.max(
      ...todays.map((e) => new Date(e.updatedAt || e.createdAt).getTime()),
      new Date(`${today}T${s.workStart || '09:00'}`).getTime(),
      lastCheckIn,
    );
    if (Date.now() - lastActivity >= s.checkInMinutes * 60000) {
      lastCheckIn = Date.now();
      const msg = `Quick check-in: it's been ${fmtHours(s.checkInMinutes / 60)} since you last logged anything. What have you been working on?`;
      jarvisSay({ speech: msg });
      notify(msg);
    }
  }

  // End-of-day nudge (once per day)
  if (workday && mins >= minutesOf(s.workEnd) && state.meta?.lastWrapNudge !== today) {
    await api('PATCH', 'meta', { lastWrapNudge: today });
    const r = wrapUp(full(), now);
    jarvisSay({ ...r, title: "It's end of day. Here's your wrap-up" });
    notify('End of day: your wrap-up is ready.');
  }
}

// ------------------------------------------------------------------ boot

async function boot() {
  startPetals();
  await api('GET', 'state');
  show((location.hash || '#today').slice(1) || 'today');
  await loadCalendar();
  const today = isoDate();
  const firstTime = !state.meta?.onboarded && !state.settings.userName;
  if (firstTime) {
    jarvisSay({ speech: "Hi! I'm Jarvis 🌸 Let's get you set up." }, false);
    openWelcome();
  } else if (state.settings.autoBrief && state.meta?.lastBriefDate !== today) {
    await api('PATCH', 'meta', { lastBriefDate: today });
    jarvisSay(morningBrief(full()));
  } else {
    const name = state.settings.userName;
    jarvisSay({ speech: `Hi${name ? ` ${name}` : ''}! Tap the flower and tell me what you worked on, or use the big buttons above.` }, false);
  }
  setInterval(rhythmTick, 60000);
  setInterval(() => loadCalendar(), 5 * 60000);
  setInterval(() => { if (state.sync?.pending) api('GET', 'state'); }, 15000);
  setInterval(() => { if ($('#view-settings').classList.contains('active')) api('GET', 'state'); }, 30000);
  checkForUpdates();
  setInterval(() => checkForUpdates(), 6 * 3600 * 1000);
  if (!voice.supported) jarvisSay({ speech: 'Talking to me works in Google Chrome. Here you can type instead, and everything else works the same.' }, false);
}

boot().catch(() => {
  document.body.innerHTML = `<div class="offline"><div class="offline-card">
    <div style="font-size:56px">🌸</div><h1>Jarvis is taking a nap</h1>
    <p>Jarvis isn't running right now. Double-click the <b>Jarvis</b> app on your Desktop (or in Launchpad) to wake it up.</p>
    <button class="btn primary" onclick="location.reload()">Try again</button></div></div>`;
});

// expose for debugging in the console
window.jarvis = { state: () => state, jarvis, addDays };
