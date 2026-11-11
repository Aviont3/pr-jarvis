// 🌷 Projects page: one place per project for its work, to-dos, agenda and coverage.

import { buildAgenda, coverageReport, displayProject, sortTodos } from './insights.js';
import { isoDate, addDays, fmtDate, fmtHours, fmtNum, sum, escapeHtml as h, periodRange, inRange } from './util.js';

const TABS = [['overview', 'Overview'], ['work', 'Work'], ['todos', 'To-dos'], ['agenda', 'Agenda'], ['coverage', 'Coverage']];

export function initProjects(ctx) {
  const { getState, api, toast, celebrate, openEntry, todoLi, rowActions } = ctx;
  const $ = (s, el = document) => el.querySelector(s);
  const root = $('#view-projects');
  let current = null;        // project name being viewed (null = all projects)
  let tab = 'overview';
  let covFilter = 'new';
  const coverage = new Map(); // project -> articles
  let saveTimer = null;

  const info = (name) => getState().projectInfo?.[name] || {};
  const projects = () => getState().settings.projects || [];

  async function loadCoverage(name) {
    const r = await (await fetch(`/api/coverage?project=${encodeURIComponent(name)}`)).json();
    coverage.set(name, r.items || []);
    return coverage.get(name);
  }
  const patchProject = (name, fields) => api('PATCH', `projects/${encodeURIComponent(name)}`, fields);

  // ------------------------------------------------------------------ numbers per project
  function numbers(name) {
    const s = getState();
    const es = s.entries.filter((e) => e.project === name);
    const week = periodRange('this week');
    const month = periodRange('this month');
    const open = s.todos.filter((t) => t.project === name && !t.done);
    const today = isoDate();
    return {
      week: sum(es.filter((e) => inRange(e.date, week)), (e) => e.hours),
      month: sum(es.filter((e) => inRange(e.date, month)), (e) => e.hours),
      all: sum(es, (e) => e.hours),
      entries: es,
      open,
      overdue: open.filter((t) => t.due && t.due < today).length,
      cov: s.coverageSummary?.[name] || { new: 0, kept: 0, latestNew: [] },
      last: es.reduce((m, e) => (e.date > m ? e.date : m), ''),
    };
  }

  // ------------------------------------------------------------------ all projects
  function renderList() {
    const names = projects();
    root.innerHTML = `
      <div class="page-title"><h1>🌷 Projects</h1><p>Everything for each client in one place: work, to-dos, agendas and press coverage.</p></div>
      <div class="project-grid">
        ${names.map((n) => {
          const x = numbers(n);
          const i = info(n);
          return `<button class="project-card" data-open-project="${h(n)}">
            <div class="pc-top"><b>${h(displayProject(n))}</b>${x.cov.new ? `<span class="badge">📰 ${x.cov.new} new</span>` : ''}</div>
            ${i.client ? `<div class="pc-client">${h(i.client)}</div>` : ''}
            <div class="pc-stats">
              <span><b>${fmtNum(x.week)}</b> hrs this week</span>
              <span><b>${x.open.length}</b> to-dos${x.overdue ? ` · <span class="over">${x.overdue} overdue</span>` : ''}</span>
              <span><b>${x.cov.kept}</b> coverage</span>
            </div>
            <div class="pc-last">${x.last ? `Last worked on ${fmtDate(x.last)}` : 'No work logged yet'}</div>
          </button>`;
        }).join('')}
        <div class="project-card new-project">
          <b>+ New project</b>
          <input id="new-project-name" placeholder="Project or client name">
          <button class="btn primary small" id="new-project-add">Add project</button>
        </div>
      </div>`;
    $('#new-project-add', root).onclick = addProject;
    $('#new-project-name', root).onkeydown = (ev) => { if (ev.key === 'Enter') addProject(); };
  }

  async function addProject() {
    const name = $('#new-project-name', root).value.trim();
    if (!name) { toast('Type a name for the project'); return; }
    const r = await api('POST', 'projects', { name });
    celebrate();
    open(r.item);
  }

  // ------------------------------------------------------------------ one project
  function renderProject() {
    const name = current;
    const x = numbers(name);
    const i = info(name);
    root.innerHTML = `
      <div class="proj-head">
        <button class="link" id="proj-back">← All projects</button>
        <div class="proj-title">
          <h1>🌷 ${h(displayProject(name))}</h1>
          <button class="link small" id="proj-rename">Rename</button>
        </div>
        <label class="proj-client">Client <input id="proj-client" value="${h(i.client || '')}" placeholder="Client or company name"></label>
      </div>
      <nav class="proj-tabs">${TABS.map(([k, l]) => `<button data-proj-tab="${k}" class="${tab === k ? 'on' : ''}">${l}${k === 'coverage' && x.cov.new ? ` <span class="badge">${x.cov.new}</span>` : ''}${k === 'todos' && x.open.length ? ` <span class="n">${x.open.length}</span>` : ''}</button>`).join('')}</nav>
      <div class="proj-body" id="proj-body"></div>`;
    $('#proj-back', root).onclick = () => open(null);
    $('#proj-rename', root).onclick = rename;
    $('#proj-client', root).oninput = (ev) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => patchProject(name, { client: ev.target.value.trim() }), 700); };
    root.querySelectorAll('[data-proj-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.projTab; renderProject(); }; });
    ({ overview, work, todos, agenda, coverage: coverageTab })[tab]($('#proj-body', root), name, x, i);
  }

  async function rename() {
    const to = prompt('New name for this project:', current);
    if (!to || to.trim() === current) return;
    try {
      const r = await api('POST', `projects/${encodeURIComponent(current)}/rename`, { to: to.trim() });
      coverage.delete(current);
      current = r.item;
      toast('Renamed 🌷 (work, to-dos and coverage moved with it)');
      renderProject();
    } catch (err) { toast(`❌ ${err.message}`); }
  }

  // ---- Overview
  async function overview(el, name, x) {
    const recent = [...x.entries].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    const next = [...x.open].sort(sortTodos).slice(0, 5);
    el.innerHTML = `
      <div class="stat-row small">
        <div class="stat"><div class="label">This week</div><div class="value">${fmtNum(x.week)}<small>hrs</small></div></div>
        <div class="stat"><div class="label">This month</div><div class="value">${fmtNum(x.month)}<small>hrs</small></div></div>
        <div class="stat"><div class="label">Open to-dos</div><div class="value">${x.open.length}<small>${x.overdue ? ` · ${x.overdue} overdue` : ''}</small></div></div>
        <div class="stat"><div class="label">Coverage kept</div><div class="value">${x.cov.kept}<small>${x.cov.new ? ` · ${x.cov.new} new` : ''}</small></div></div>
      </div>
      <div class="proj-grid">
        <div class="panel"><div class="panel-head"><h2>📝 Recent work</h2><button class="link" data-proj-tab-go="work">See all →</button></div>
          <ul class="entry-list">${recent.length ? recent.map((e) => `<li data-entry="${e.id}"><span class="hrs">${fmtNum(e.hours)}</span><div class="body"><div>${h(e.workDone || e.task)}</div><div class="meta">${fmtDate(e.date)}${e.category ? ` · ${h(e.category)}` : ''}</div></div>${rowActions(e)}</li>`).join('') : '<li class="empty">Nothing logged for this project yet.</li>'}</ul>
          <button class="btn ghost full" id="ov-log">+ Log work for ${h(displayProject(name))}</button></div>
        <div class="panel"><div class="panel-head"><h2>✅ Next up</h2><button class="link" data-proj-tab-go="todos">See all →</button></div>
          <ul class="todo-list">${next.length ? next.map(todoLi).join('') : '<li class="empty">No open to-dos. 🌼</li>'}</ul></div>
        <div class="panel"><div class="panel-head"><h2>📰 New coverage</h2><button class="link" data-proj-tab-go="coverage">See all →</button></div>
          <ul class="cov-mini">${x.cov.latestNew.length ? x.cov.latestNew.map((c) => `<li><b>${h(c.outlet || 'News')}</b> ${h(c.title)}</li>`).join('') : `<li class="empty">${info(name).scan ? 'No new articles since you last looked.' : 'Coverage scanning is off. Turn it on in the Coverage tab.'}</li>`}</ul></div>
        <div class="panel"><div class="panel-head"><h2>🗒️ Notes</h2></div>
          <textarea id="proj-notes" rows="6" placeholder="Key contacts, messaging, embargo dates… anything to remember about this project.">${h(info(name).notes || '')}</textarea>
          <label class="proj-slack">💬 Slack channel for this project <span class="muted">(optional; otherwise your main Slack channel)</span>
            <input id="proj-slack" value="${h(info(name).slackWebhook || '')}" placeholder="https://hooks.slack.com/services/…"></label></div>
      </div>`;
    $('#ov-log', el).onclick = () => openEntry({ project: name });
    el.querySelectorAll('[data-proj-tab-go]').forEach((b) => { b.onclick = () => { tab = b.dataset.projTabGo; renderProject(); }; });
    $('#proj-notes', el).oninput = (ev) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => patchProject(name, { notes: ev.target.value }), 700); };
    $('#proj-slack', el).onchange = async (ev) => {
      const v = ev.target.value.trim();
      if (v && !/^https:\/\/hooks\.slack\.com\//.test(v)) { toast('That isn’t a Slack link. It starts with https://hooks.slack.com/'); return; }
      await patchProject(name, { slackWebhook: v });
      toast(v ? '💬 This project will post to its own Slack channel' : 'This project will use your main Slack channel');
    };
  }

  // ---- Work
  function work(el, name, x) {
    const es = [...x.entries].sort((a, b) => (a.date === b.date ? ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1) : a.date < b.date ? 1 : -1));
    el.innerHTML = `
      <div class="panel">
        <div class="toolbar"><h2>📝 All work · ${fmtHours(x.all)}</h2><div class="toolbar-actions"><button class="btn primary" id="pw-log">+ Log work</button></div></div>
        <div class="table-wrap"><table class="log-table">
          <thead><tr><th>Date</th><th>What I did</th><th>Type</th><th class="num">Hours</th><th>Next step</th><th class="actions-col"></th></tr></thead>
          <tbody>${es.length ? es.map((e) => `<tr data-entry="${e.id}"><td class="nowrap"><button type="button" class="link day-link" data-day="${e.date}">${fmtDate(e.date)}</button></td>
            <td class="wd">${h(e.workDone || e.task)}</td><td>${e.category ? `<span class="tag">${h(e.category)}</span>` : ''}</td>
            <td class="num">${fmtNum(e.hours)}</td><td>${h(e.notes)}</td><td class="actions-col">${rowActions(e)}</td></tr>`).join('')
            : '<tr><td colspan="6" class="empty">Nothing logged for this project yet.</td></tr>'}</tbody>
          <tfoot><tr><td colspan="3">Total</td><td class="num">${fmtNum(x.all)}</td><td colspan="2"></td></tr></tfoot>
        </table></div>
      </div>`;
    $('#pw-log', el).onclick = () => openEntry({ project: name });
  }

  // ---- To-dos
  function todos(el, name) {
    const s = getState();
    const open = s.todos.filter((t) => t.project === name && !t.done).sort(sortTodos);
    const done = s.todos.filter((t) => t.project === name && t.done).sort((a, b) => ((a.doneAt || '') < (b.doneAt || '') ? 1 : -1));
    el.innerHTML = `
      <div class="panel">
        <form class="inline-add" id="pt-add"><input id="pt-text" placeholder="Add a to-do for ${h(displayProject(name))}… (try “send recap Friday urgent”)"></form>
        <ul class="todo-list">${open.length ? open.map(todoLi).join('') : '<li class="empty">No open to-dos for this project. 🌼</li>'}</ul>
        <details class="done-wrap"><summary>Finished (${done.length})</summary><ul class="todo-list">${done.slice(0, 50).map(todoLi).join('')}</ul></details>
      </div>`;
    $('#pt-add', el).onsubmit = async (ev) => {
      ev.preventDefault();
      const text = $('#pt-text', el).value.trim();
      if (!text) return;
      const quick = ctx.parseQuickTodo(text);
      await ctx.actions.addTodo({ ...quick, project: name });
      toast('Added ✅');
    };
  }

  // ---- Agenda
  async function agenda(el, name) {
    const i = info(name);
    const items = coverage.get(name) || await loadCoverage(name);
    const fresh = buildAgenda(getState(), name, new Date(), { coverage: items, meetingDate: i.agenda?.meetingDate || '' });
    const draft = i.agenda || { subject: fresh.subject, body: fresh.body, meetingDate: '' };
    const history = i.agendaHistory || [];
    el.innerHTML = `
      <div class="proj-grid agenda-grid">
        <div class="panel">
          <div class="panel-head"><h2>📋 Agenda to send</h2><span class="muted">Covers ${fmtDate(fresh.since)} → today: ${fresh.stats.entries} updates, ${fresh.stats.coverage} coverage, ${fresh.stats.open} open items</span></div>
          <div class="agenda-fields">
            <label>Meeting date <input type="date" id="ag-date" value="${h(draft.meetingDate || isoDate())}"></label>
            <label class="grow">Send to <input id="ag-to" value="${h(i.recipients || '')}" placeholder="client@company.com, teammate@agency.com"></label>
          </div>
          <label class="agenda-subject">Subject <input id="ag-subject" value="${h(draft.subject)}"></label>
          <textarea id="ag-body" rows="20" class="agenda-body">${h(draft.body)}</textarea>
          <div class="row agenda-actions">
            <button class="btn ghost" id="ag-refresh" title="Rebuild from your latest work, to-dos and coverage">✨ Refresh from latest</button>
            <button class="btn ghost" id="ag-copy">📋 Copy</button>
            <button class="btn ghost" id="ag-mail">✉️ Open in my email app</button>
            <button class="btn ghost" id="ag-owa">🌐 Outlook on the web</button>
            ${getState().slack?.connected ? '<button class="btn ghost" id="ag-slack">💬 Post to Slack</button>' : ''}
            <span class="spacer"></span>
            <button class="btn primary" id="ag-sent">✅ Mark as sent</button>
          </div>
          <p class="muted">Edit anything you like. Your changes are saved. “Mark as sent” files it below, and the next agenda starts from that date.</p>
        </div>
        <div class="panel">
          <h2>🗂️ Sent agendas</h2>
          ${history.length ? `<ul class="agenda-history">${history.map((a, k) => `<li><details><summary><b>${fmtDate(a.sentAt.slice(0, 10), true)}</b> · ${h(a.subject)}</summary><pre>${h(a.body)}</pre><button class="btn ghost small" data-ag-copy="${k}">📋 Copy</button></details></li>`).join('')}</ul>` : '<p class="muted">Nothing sent yet.</p>'}
        </div>
      </div>`;
    const val = () => ({ meetingDate: $('#ag-date', el).value, subject: $('#ag-subject', el).value, body: $('#ag-body', el).value });
    const saveDraft = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => patchProject(name, { agenda: val() }), 700); };
    ['#ag-subject', '#ag-body'].forEach((s) => { $(s, el).oninput = saveDraft; });
    $('#ag-to', el).oninput = (ev) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => patchProject(name, { recipients: ev.target.value.trim(), agenda: val() }), 700); };
    $('#ag-date', el).onchange = async () => {
      const r = buildAgenda(getState(), name, new Date(), { coverage: items, meetingDate: $('#ag-date', el).value });
      $('#ag-subject', el).value = r.subject;
      await patchProject(name, { agenda: val() });
    };
    $('#ag-refresh', el).onclick = async () => {
      if (i.agenda && !confirm('Rebuild the agenda from your latest work? Your edits to this draft will be replaced.')) return;
      const r = buildAgenda(getState(), name, new Date(), { coverage: await loadCoverage(name), meetingDate: $('#ag-date', el).value });
      await patchProject(name, { agenda: { meetingDate: $('#ag-date', el).value, subject: r.subject, body: r.body } });
      toast('✨ Agenda refreshed');
    };
    $('#ag-copy', el).onclick = () => { navigator.clipboard.writeText(`${val().subject}\n\n${val().body}`); toast('📋 Agenda copied. Paste it into an email.'); };
    const to = () => $('#ag-to', el).value.split(/[,;\s]+/).filter(Boolean).join(',');
    $('#ag-mail', el).onclick = () => {
      const v = val();
      location.href = `mailto:${encodeURIComponent(to()).replace(/%2C/g, ',').replace(/%40/g, '@')}?subject=${encodeURIComponent(v.subject)}&body=${encodeURIComponent(v.body)}`;
    };
    $('#ag-owa', el).onclick = () => {
      const v = val();
      window.open(`https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to())}&subject=${encodeURIComponent(v.subject)}&body=${encodeURIComponent(v.body)}`, '_blank', 'noopener');
    };
    const slackBtn = $('#ag-slack', el);
    if (slackBtn) slackBtn.onclick = () => ctx.postToSlack({ title: `📋 ${val().subject}`, text: val().body, project: name });
    $('#ag-sent', el).onclick = async () => {
      await api('POST', `projects/${encodeURIComponent(name)}/agenda-sent`, val());
      celebrate($('#ag-sent', el));
      toast('✅ Filed under Sent agendas. The next one starts from today.');
    };
    el.querySelectorAll('[data-ag-copy]').forEach((b) => { b.onclick = () => { const a = history[Number(b.dataset.agCopy)]; navigator.clipboard.writeText(`${a.subject}\n\n${a.body}`); toast('📋 Copied'); }; });
  }

  // ---- Coverage
  async function coverageTab(el, name) {
    const i = info(name);
    el.innerHTML = '<div class="panel"><p class="muted">Loading coverage…</p></div>';
    const items = coverage.get(name) || await loadCoverage(name);
    const counts = { new: 0, kept: 0, dismissed: 0 };
    for (const c of items) counts[c.status] = (counts[c.status] || 0) + 1;
    const list = items.filter((c) => c.status === covFilter);
    const termsHint = i.client || displayProject(name);
    el.innerHTML = `
      <div class="proj-grid coverage-grid">
        <div class="panel">
          <div class="panel-head"><h2>📰 Coverage</h2>
            <div class="row">${getState().slack?.connected ? '<button class="btn ghost small" id="cv-slack">💬 Share to Slack</button>' : ''}<button class="btn ghost small" id="cv-report">📋 Copy coverage report</button><button class="btn primary small" id="cv-scan">🔎 Scan now</button></div></div>
          <p class="muted cv-status">${i.scan
            ? `${i.lastScanAt ? `Last checked ${new Date(i.lastScanAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. ` : ''}Jarvis checks the news every 6 hours.`
            : 'Scanning is off for this project. Turn it on at the right, or click Scan now.'}${i.scanError ? ` <span class="bad">⚠️ ${h(i.scanError)}</span>` : ''}</p>
          <div class="chips cov-filter">
            ${[['new', '🆕 New'], ['kept', '⭐ Kept'], ['dismissed', '✕ Dismissed']].map(([k, l]) => `<button data-cov-filter="${k}" class="${covFilter === k ? 'on' : ''}">${l} <span class="n">${counts[k] || 0}</span></button>`).join('')}
          </div>
          <ul class="cov-list">${list.length ? list.map((c) => `
            <li data-cov="${c.id}">
              <div class="cov-meta"><b>${h(c.outlet || 'News')}</b>${c.publishedAt ? ` · ${fmtDate(c.publishedAt.slice(0, 10), true)}` : ''}${c.manual ? ' · added by hand' : ''}</div>
              <a class="cov-title" href="${h(c.url)}" target="_blank" rel="noopener">${h(c.title)}</a>
              ${c.snippet ? `<div class="cov-snippet">${h(c.snippet)}</div>` : ''}
              <div class="cov-actions">
                ${c.status !== 'kept' ? '<button class="btn primary small" data-cov-set="kept">⭐ Keep</button>' : '<button class="btn ghost small" data-cov-set="new">↩︎ Unkeep</button>'}
                ${c.status !== 'dismissed' ? '<button class="btn ghost small" data-cov-set="dismissed">✕ Not relevant</button>' : '<button class="btn ghost small" data-cov-set="new">↩︎ Restore</button>'}
              </div>
            </li>`).join('') : `<li class="empty">${covFilter === 'new' ? (i.scan || i.lastScanAt ? 'No new articles. 🌼' : 'Click “Scan now” to search the news for this client.') : covFilter === 'kept' ? 'Keep articles with ⭐ and they show up here, in the agenda and in the coverage report.' : 'Nothing dismissed.'}</li>`}</ul>
          <details class="cov-manual"><summary>+ Add an article by hand</summary>
            <div class="cov-manual-grid">
              <input id="cvm-title" placeholder="Headline">
              <input id="cvm-outlet" placeholder="Publication (e.g. Vogue)">
              <input id="cvm-url" placeholder="Link (optional)">
              <input type="date" id="cvm-date" value="${isoDate()}">
              <button class="btn primary small" id="cvm-add">Add</button>
            </div>
          </details>
        </div>
        <div class="panel cov-settings">
          <h2>🔎 What to look for</h2>
          <label class="check"><input type="checkbox" id="cv-on" ${i.scan ? 'checked' : ''}> Scan the news for this client automatically</label>
          <label>Search words <span class="muted">(comma-separated)</span><input id="cv-terms" value="${h(i.terms || '')}" placeholder="${h(termsHint)}"></label>
          <label>Leave out articles mentioning <input id="cv-exclude" value="${h(i.exclude || '')}" placeholder="e.g. stock price, recall"></label>
          <label>Only these publications <span class="muted">(optional)</span><input id="cv-outlets" value="${h(i.outlets || '')}" placeholder="e.g. Vogue, TechCrunch, nytimes.com"></label>
          <p class="muted">Tip: use the brand and spokesperson names, e.g. “Acme Corp, Acme Rebrand, Jane Doe Acme”. Jarvis only keeps articles that actually mention one of them.</p>
        </div>
      </div>`;
    el.querySelectorAll('[data-cov-filter]').forEach((b) => { b.onclick = () => { covFilter = b.dataset.covFilter; coverageTab(el, name); }; });
    el.querySelectorAll('[data-cov-set]').forEach((b) => {
      b.onclick = async () => {
        const id = b.closest('[data-cov]').dataset.cov;
        const status = b.dataset.covSet;
        await api('PATCH', `coverage/${id}`, { status });
        const c = items.find((x) => x.id === id);
        if (c) c.status = status;
        if (status === 'kept') { celebrate(b); toast('⭐ Kept. It will be in the coverage report and agenda.'); }
        coverageTab(el, name);
      };
    });
    const saveSettings = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => patchProject(name, {
        scan: $('#cv-on', el).checked, terms: $('#cv-terms', el).value.trim(), exclude: $('#cv-exclude', el).value.trim(), outlets: $('#cv-outlets', el).value.trim(),
      }), 600);
    };
    ['#cv-terms', '#cv-exclude', '#cv-outlets'].forEach((s) => { $(s, el).oninput = saveSettings; });
    $('#cv-on', el).onchange = async () => {
      await patchProject(name, { scan: $('#cv-on', el).checked, terms: $('#cv-terms', el).value.trim(), exclude: $('#cv-exclude', el).value.trim(), outlets: $('#cv-outlets', el).value.trim() });
      if ($('#cv-on', el).checked && !info(name).lastScanAt) $('#cv-scan', root)?.click();
    };
    $('#cv-scan', el).onclick = async () => {
      const btn = $('#cv-scan', el);
      btn.disabled = true;
      btn.textContent = '⏳ Searching the news…';
      await patchProject(name, { terms: $('#cv-terms', el).value.trim(), exclude: $('#cv-exclude', el).value.trim(), outlets: $('#cv-outlets', el).value.trim() });
      try {
        const r = await api('POST', `projects/${encodeURIComponent(name)}/scan`);
        await loadCoverage(name);
        covFilter = 'new';
        toast(r.added ? `📰 Found ${r.added} new ${r.added === 1 ? 'article' : 'articles'}` : 'No new articles right now 🌼');
        if (r.added) celebrate();
      } catch (err) { toast(`❌ ${err.message}`); await loadCoverage(name); }
      if (current === name && tab === 'coverage') renderProject();
    };
    const cvSlack = $('#cv-slack', el);
    if (cvSlack) cvSlack.onclick = () => {
      const kept = items.filter((c) => c.status === 'kept');
      if (!kept.length) { toast('Keep some articles with ⭐ first'); return; }
      const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const lines = kept.sort((a, b) => ((b.publishedAt || '') > (a.publishedAt || '') ? 1 : -1))
        .map((c) => `• ${c.outlet ? `*${esc(c.outlet)}*: ` : ''}${c.url ? `<${c.url}|${esc(c.title)}>` : esc(c.title)}${c.publishedAt ? ` (${fmtDate(c.publishedAt.slice(0, 10))})` : ''}`);
      ctx.postToSlack({ raw: true, project: name, text: `📰 *${esc(displayProject(name))} · Coverage report* (${kept.length})\n${lines.join('\n')}` });
    };
    $('#cv-report', el).onclick = () => {
      const kept = items.filter((c) => c.status === 'kept').length;
      if (!kept) { toast('Keep some articles with ⭐ first'); return; }
      navigator.clipboard.writeText(coverageReport(name, items));
      toast(`📋 Coverage report copied (${kept} ${kept === 1 ? 'article' : 'articles'})`);
    };
    $('#cvm-add', el).onclick = async () => {
      const title = $('#cvm-title', el).value.trim();
      if (!title) { toast('Add the headline'); return; }
      await api('POST', 'coverage', { project: name, title, outlet: $('#cvm-outlet', el).value.trim(), url: $('#cvm-url', el).value.trim(), publishedAt: $('#cvm-date', el).value });
      await loadCoverage(name);
      covFilter = 'kept';
      toast('⭐ Added to coverage');
      renderProject();
    };
  }

  // ------------------------------------------------------------------ public
  function render() {
    if (!root.classList.contains('active')) return;
    if (current && !projects().includes(current)) current = null;
    if (!current) { renderList(); return; }
    // Don't redraw a tab while someone is typing in it.
    const typing = document.activeElement && root.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (typing) return;
    renderProject();
  }
  function open(name, whichTab) {
    current = name;
    if (whichTab) tab = whichTab;
    else if (name) tab = 'overview';
    ctx.show('projects');
    if (!name) renderList();
  }
  return { render, open };
}
