import { Jarvis } from './jarvis.js';
import { Voice } from './voice.js';
import { parseCommand } from './parser.js';
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
  deleteEntry: async (id) => api('DELETE', `entries/${id}`),
  addTodo: async (t) => (await api('POST', 'todos', t)).item,
  updateTodo: async (id, t) => (await api('PATCH', `todos/${id}`, t)).item,
  deleteTodo: async (id) => api('DELETE', `todos/${id}`),
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

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ------------------------------------------------------------------ voice & chat

const voice = new Voice({
  onInterim: (t) => { $('#interim').textContent = t; },
  onFinal: (t) => { $('#interim').textContent = ''; converse(t); },
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
  if (!state.settings.sheetUrl) { pill.textContent = 'Sheet sync off'; return; }
  if (s.lastError) { pill.classList.add('err'); pill.textContent = 'Sheet sync error'; pill.title = s.lastError; return; }
  if (s.pending) { pill.classList.add('pending'); pill.textContent = `Syncing ${s.pending}…`; return; }
  pill.classList.add('ok');
  pill.textContent = s.lastSyncAt ? `Synced ${new Date(s.lastSyncAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Sheet connected';
  pill.title = 'Google Sheet sync is on';
}

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

function entryLi(e) {
  return `<li data-entry="${e.id}"><span class="hrs">${fmtNum(e.hours)}</span><div class="body"><div>${h(e.workDone || e.task)}</div><div class="meta">${h(displayProject(e.project))}${e.category ? ` · ${h(e.category)}` : ''}${e.notes ? ` · Next: ${h(e.notes)}` : ''}</div></div></li>`;
}

function dueMeta(td) {
  if (!td.due) return '';
  const t = isoDate();
  if (td.due < t) return `<span class="over">Overdue · ${fmtDate(td.due)}</span>`;
  if (td.due === t) return '<span class="today">Today</span>';
  return fmtDate(td.due);
}

function todoLi(td) {
  const meta = [dueMeta(td), td.project && h(displayProject(td.project)), td.priority === 'high' && 'High priority'].filter(Boolean).join(' · ');
  return `<li class="${td.done ? 'done' : ''} ${td.priority === 'high' ? 'high' : ''}" data-todo="${td.id}">
    <input type="checkbox" ${td.done ? 'checked' : ''} aria-label="Done">
    <div class="t"><span contenteditable="plaintext-only" spellcheck="false">${h(td.text)}</span>${meta ? `<div class="meta">${meta}</div>` : ''}</div>
    <button class="x" title="Delete">✕</button></li>`;
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

function renderTodos() {
  const b = todoBuckets(state.todos);
  const cols = [
    ['overdue', 'Overdue', b.overdue], ['today', 'Today', b.today], ['upcoming', 'Upcoming', b.upcoming], ['someday', 'No date', b.someday],
  ].filter(([k, , items]) => items.length || k === 'today');
  $('#todo-columns').innerHTML = cols.map(([k, label, items]) => `
    <div class="todo-col ${k}"><h3>${label} <span class="n">${items.length}</span></h3>
    <ul class="todo-list">${items.length ? items.map(todoLi).join('') : '<li class="empty">Nothing here</li>'}</ul></div>`).join('');
  const done = state.todos.filter((x) => x.done).sort((a, b2) => (a.doneAt < b2.doneAt ? 1 : -1)).slice(0, 100);
  $('#done-count').textContent = `(${state.todos.filter((x) => x.done).length})`;
  $('#todo-done').innerHTML = done.map(todoLi).join('');
}

function renderLog() {
  const range = periodRange($('#log-period').value);
  const q = $('#log-search').value.toLowerCase();
  const es = filterEntries(state.entries, { range, project: $('#log-project').value, category: $('#log-category').value })
    .filter((e) => !q || [e.project, e.task, e.workDone, e.notes, e.category].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  $('#log-body').innerHTML = es.length ? es.map((e) => `
    <tr data-entry="${e.id}">
      <td>${fmtDate(e.date)}</td><td>${h(displayProject(e.project))}</td><td>${h(e.task)}</td>
      <td class="wd">${h(e.workDone)}</td><td>${e.category ? `<span class="tag">${h(e.category)}</span>` : ''}</td>
      <td class="num">${fmtNum(e.hours)}</td><td>${h(e.notes)}</td><td><button class="link">Edit</button></td>
    </tr>`).join('') : '<tr><td colspan="8" class="empty">No entries for this filter.</td></tr>';
  $('#log-total').textContent = fmtNum(sum(es, (e) => e.hours));
}

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
  cat.innerHTML = '<option value="">All categories</option>' + (state.settings.categories || []).map((c) => `<option>${h(c)}</option>`).join('');
  cat.value = cv;
}

// ------------------------------------------------------------------ entry dialog

const dlg = $('#entry-dialog');
let editingId = null;
function openEntry(entry = null) {
  editingId = entry?.id || null;
  const f = $('#entry-form');
  $('#entry-dialog-title').textContent = editingId ? 'Edit entry' : 'Log work';
  f.category.innerHTML = categoryOptions(entry?.category || state.settings.defaultCategory);
  f.date.value = entry?.date || isoDate();
  f.hours.value = entry?.hours ?? '';
  for (const k of ['project', 'task', 'workDone', 'notes']) f[k].value = entry?.[k] || '';
  $('#entry-delete').hidden = !editingId;
  dlg.showModal();
}
$('#entry-cancel').onclick = () => dlg.close();
$('#entry-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const data = {
    date: f.date.value, hours: parseFloat(f.hours.value), project: f.project.value.trim(), task: f.task.value.trim(),
    workDone: f.workDone.value.trim(), category: f.category.value, notes: f.notes.value.trim(),
  };
  if (!data.task && !data.workDone) { toast('Add a task or a description'); return; }
  if (editingId) await actions.updateEntry(editingId, data); else await actions.addEntry(data);
  dlg.close();
  if (editingId) toast('Entry updated ✏️');
  else { celebrate(); toast(cheer()); }
};
$('#entry-delete').onclick = async () => {
  if (editingId && confirm('Delete this entry?')) { await actions.deleteEntry(editingId); dlg.close(); toast('Deleted'); }
};

document.addEventListener('click', (ev) => {
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
  if (!ev.target.matches('.todo-list .x')) return;
  const li = ev.target.closest('[data-todo]');
  await actions.deleteTodo(li.dataset.todo);
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

function renderSettings() {
  const s = state.settings;
  const f = $('#settings-form');
  f.userName.value = s.userName || '';
  f.projects.value = (s.projects || []).join('\n');
  f.keywords.value = keywordsToText(s.categories || [], s.keywords || {});
  f.defaultCategory.innerHTML = categoryOptions(s.defaultCategory);
  for (const k of ['speakReplies', 'autoBrief', 'notesToTodos', 'autoSaveVoiceLogs', 'calendarEnabled', 'calendarAll', 'meetingPrompts']) f[k].checked = !!s[k];
  f.meetingCategory.innerHTML = categoryOptions(s.meetingCategory).replace('<option value="">(none)</option>', '');
  f.checkInMinutes.value = String(s.checkInMinutes || 0);
  f.workStart.value = s.workStart || '09:00';
  f.workEnd.value = s.workEnd || '18:00';
  f.sheetUrl.value = s.sheetUrl || '';
  const voices = voice.voices;
  f.voiceName.innerHTML = '<option value="">Automatic</option>' + voices.map((v) => `<option ${v.name === s.voiceName ? 'selected' : ''} value="${h(v.name)}">${h(v.name)} (${h(v.lang)})</option>`).join('');
}

$('#settings-form').onsubmit = async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const { categories, keywords } = textToKeywords(f.keywords.value);
  const body = {
    userName: f.userName.value.trim(),
    projects: f.projects.value.split('\n').map((s) => s.trim()).filter(Boolean),
    categories, keywords,
    defaultCategory: f.defaultCategory.value,
    speakReplies: f.speakReplies.checked, autoBrief: f.autoBrief.checked, notesToTodos: f.notesToTodos.checked,
    autoSaveVoiceLogs: f.autoSaveVoiceLogs.checked,
    calendarEnabled: f.calendarEnabled.checked, calendarAll: f.calendarAll.checked,
    meetingPrompts: f.meetingPrompts.checked, meetingCategory: f.meetingCategory.value,
    voiceName: f.voiceName.value, checkInMinutes: Number(f.checkInMinutes.value),
    workStart: f.workStart.value, workEnd: f.workEnd.value, sheetUrl: f.sheetUrl.value.trim(),
  };
  await api('PATCH', 'settings', body);
  loadCalendar(true);
  renderSettings();
  $('#settings-msg').textContent = 'Saved ✓';
  setTimeout(() => { $('#settings-msg').textContent = ''; }, 2500);
  if (body.checkInMinutes && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
};

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
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'log') renderLog();
  if (view === 'dashboard') renderDashboard();
  if (view === 'settings') renderSettings();
  location.hash = view;
}
$$('.tabs button').forEach((b) => { b.onclick = () => show(b.dataset.view); });
document.addEventListener('click', (ev) => { const g = ev.target.closest('[data-goto]'); if (g) show(g.dataset.goto); });

['#log-period', '#log-project', '#log-category'].forEach((s) => { $(s).onchange = renderLog; });
$('#log-search').oninput = renderLog;
$('#log-new').onclick = () => openEntry();
$('#quick-log-btn').onclick = () => openEntry();
['#cat-scope', '#proj-scope', '#report-period', '#report-project'].forEach((s) => { $(s).onchange = renderDashboard; });
$('#report-copy').onclick = () => { navigator.clipboard.writeText($('#report-text').textContent); toast('Report copied'); };
$('#export-csv').onclick = () => {
  const range = periodRange($('#log-period').value);
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
      : `<button class="btn ${ended ? 'primary' : 'ghost'} small" data-log-meeting="${h(ev.id)}">Log ${fmtNum(meetingHours(ev))}h</button>`;
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
  if (state.settings.autoBrief && state.meta?.lastBriefDate !== today) {
    await api('PATCH', 'meta', { lastBriefDate: today });
    jarvisSay(morningBrief(full()));
  } else {
    const name = state.settings.userName;
    jarvisSay({ speech: `Hi${name ? ` ${name}` : ''}, I'm ready. Tell me what you've worked on, start a timer, or say "help".` }, false);
  }
  setInterval(rhythmTick, 60000);
  setInterval(() => loadCalendar(), 5 * 60000);
  setInterval(() => { if (state.sync?.pending) api('GET', 'state'); }, 15000);
  if (!voice.supported) jarvisSay({ speech: 'Voice input needs Google Chrome. You can still type commands below.' }, false);
}

boot().catch((err) => {
  document.body.insertAdjacentHTML('afterbegin', `<div style="padding:20px;background:#7f1d1d">Couldn't reach the Jarvis server. Is it running? (${h(err.message)})</div>`);
});

// expose for debugging in the console
window.jarvis = { state: () => state, jarvis, addDays };
