/**
 * Jarvis → Google Sheets sync.
 *
 * Paste this into your tracker sheet (Extensions → Apps Script), then
 * Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Copy the web app URL into Jarvis → Settings → Google Sheet sync.
 *
 * The token below must match the one in Jarvis. If you copied this script
 * from Jarvis Settings, it's already filled in.
 *
 * Google Calendar: Jarvis can also read your meetings through this script.
 * After updating the script, use Deploy → Manage deployments → ✏️ Edit →
 * Version: New version → Deploy, and approve the calendar permission.
 * The web app URL stays the same. Jarvis only reads events; it never changes your calendar.
 *
 * Projects & Coverage: Jarvis keeps a "Projects" summary tab and a "Coverage" tab up to date.
 *
 * Backups: Jarvis also saves a copy of all your data in a "Jarvis Backups" folder
 * in your Google Drive (one file per day, the last 30 days are kept).
 */
const TOKEN = 'PASTE_TOKEN_HERE';
const SCRIPT_VERSION = 4; // Jarvis asks you to update the script when this is behind

const LOG_SHEET = 'Daily Log';
const TODO_SHEET = 'To-Do';
const LISTS_SHEET = 'Lists';
const LOG_HEADERS = ['Date', 'Project', 'Task', 'Work Done', 'Category', 'Time Spent (hrs)', 'Notes / Next Steps', 'Jarvis ID'];
// Jarvis ID stays in column H (used to find rows); Deleted was added later, in column I.
const TODO_HEADERS = ['Status', 'To-Do', 'Project', 'Due', 'Priority', 'Created', 'Completed', 'Jarvis ID', 'Deleted'];

function doGet() {
  return ContentService.createTextOutput('Jarvis sync is installed. Jarvis sends data here with POST requests.');
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (body.token !== TOKEN) {
      return json_({ ok: false, error: 'Token mismatch. Copy the script again from Jarvis → Settings and redeploy.' });
    }
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const ctx = { ss: ss, index: {}, out: {} };
      (body.ops || []).forEach(function (op) { apply_(ctx, op); });
      SpreadsheetApp.flush();
      const result = { ok: true, spreadsheet: ss.getName(), scriptVersion: SCRIPT_VERSION };
      Object.keys(ctx.out).forEach(function (k) { result[k] = ctx.out[k]; });
      return json_(result);
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function apply_(ctx, op) {
  switch (op.op) {
    case 'ping': return;
    case 'getEvents': ctx.out.events = getEvents_(op.from, op.to, op.allCalendars); return;
    case 'backup': ctx.out.backup = backup_(op.name, op.content, op.keep); return;
    case 'upsertEntry': return upsert_(ctx, logSheet_(ctx.ss), op.entry.id, entryRow_(op.entry), 'log');
    case 'deleteEntry': return remove_(ctx, logSheet_(ctx.ss), op.id, 'log');
    case 'upsertTodo': return upsert_(ctx, todoSheet_(ctx.ss), op.todo.id, todoRow_(op.todo), 'todo');
    case 'deleteTodo': return remove_(ctx, todoSheet_(ctx.ss), op.id, 'todo');
    case 'setLists': return setLists_(ctx.ss, op.projects || [], op.categories || []);
    case 'upsertCoverage': return upsert_(ctx, coverageSheet_(ctx.ss), op.item.id, coverageRow_(op.item), 'coverage');
    case 'deleteCoverage': return remove_(ctx, coverageSheet_(ctx.ss), op.id, 'coverage');
    case 'projectsTable': return projectsTable_(ctx.ss, op.rows || []);
  }
}

// ---------------------------------------------------------------- rows

function toDate_(iso) {
  if (!iso) return '';
  const p = String(iso).slice(0, 10).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function entryRow_(e) {
  return [toDate_(e.date), e.project || '', e.task || '', e.workDone || '', e.category || '',
    Number(e.hours) || 0, e.notes || '', e.id];
}

function todoRow_(t) {
  return [t.deletedAt ? 'Deleted' : t.done ? 'Done' : 'Open', t.text || '', t.project || '', toDate_(t.due),
    t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal',
    t.createdAt ? new Date(t.createdAt) : '', t.doneAt ? new Date(t.doneAt) : '', t.id,
    t.deletedAt ? new Date(t.deletedAt) : ''];
}

// ---------------------------------------------------------------- sheets

function logSheet_(ss) {
  let sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  if (sh.getRange(1, 8).getValue() !== 'Jarvis ID') {
    sh.getRange(1, 8).setValue('Jarvis ID').setFontWeight('bold');
    sh.hideColumns(8);
  }
  return sh;
}

function todoSheet_(ss) {
  let sh = ss.getSheetByName(TODO_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TODO_SHEET);
    sh.getRange(1, 1, 1, TODO_HEADERS.length).setValues([TODO_HEADERS])
      .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 360);
    sh.hideColumns(8);
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=OR($A2="Done",$A2="Deleted")').setFontColor('#9ca3af').setStrikethrough(true)
      .setRanges([sh.getRange('A2:G')]).build();
    sh.setConditionalFormatRules([rule]);
  }
  if (sh.getRange(1, 9).getValue() !== 'Deleted') {
    sh.getRange(1, 9).setValue('Deleted').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  }
  return sh;
}

function setLists_(ss, projects, categories) {
  const sh = ss.getSheetByName(LISTS_SHEET) || ss.insertSheet(LISTS_SHEET);
  const max = Math.max(sh.getMaxRows() - 1, 1);
  sh.getRange(2, 1, max, 2).clearContent();
  if (projects.length) sh.getRange(2, 1, projects.length, 1).setValues(projects.map(function (p) { return [p]; }));
  if (categories.length) sh.getRange(2, 2, categories.length, 1).setValues(categories.map(function (c) { return [c]; }));
}

// ---------------------------------------------------------------- Projects & Coverage tabs

const COVERAGE_SHEET = 'Coverage';
const PROJECTS_SHEET = 'Projects';
const COVERAGE_HEADERS = ['Published', 'Project', 'Outlet', 'Headline', 'Link', 'Status', 'Found', 'Jarvis ID'];
const PROJECTS_HEADERS = ['Project', 'Client', 'Hours this week', 'Hours this month', 'Hours all time', 'Open to-dos', 'Overdue',
  'Coverage kept', 'New coverage', 'Last worked', 'Last agenda sent', 'Notes', 'Updated'];

function headerRow_(sh, headers, color) {
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground(color).setFontColor('#ffffff');
  sh.setFrozenRows(1);
}

function coverageSheet_(ss) {
  let sh = ss.getSheetByName(COVERAGE_SHEET);
  if (!sh) {
    sh = ss.insertSheet(COVERAGE_SHEET);
    headerRow_(sh, COVERAGE_HEADERS, '#b83b6f');
    sh.setColumnWidth(4, 420);
    sh.setColumnWidth(5, 260);
    sh.hideColumns(8);
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$F2="Kept"').setBackground('#e9f8ee')
      .setRanges([sh.getRange('A2:G')]).build();
    sh.setConditionalFormatRules([rule]);
  }
  return sh;
}

function coverageRow_(c) {
  const link = c.url ? '=HYPERLINK("' + String(c.url).replace(/"/g, '""') + '","Open article")' : '';
  return [c.publishedAt ? new Date(c.publishedAt) : '', c.project || '', c.outlet || '', c.title || '', link,
    c.status === 'kept' ? 'Kept' : 'New', c.foundAt ? new Date(c.foundAt) : '', c.id];
}

/** The Projects tab is a summary, rewritten as a whole each time. */
function projectsTable_(ss, rows) {
  let sh = ss.getSheetByName(PROJECTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PROJECTS_SHEET);
    sh.setColumnWidth(1, 220);
    sh.setColumnWidth(12, 320);
  }
  sh.clearContents();
  headerRow_(sh, PROJECTS_HEADERS, '#2f8a5a');
  if (!rows.length) return;
  const now = new Date();
  const values = rows.map(function (r) {
    return [r.project, r.client || '', r.week || 0, r.month || 0, r.all || 0, r.open || 0, r.overdue || 0,
      r.kept || 0, r.fresh || 0, toDate_(r.lastWorked), r.lastAgenda ? new Date(r.lastAgenda) : '', r.notes || '', now];
  });
  sh.getRange(2, 1, values.length, PROJECTS_HEADERS.length).setValues(values);
  sh.getRange(2, 3, values.length, 3).setNumberFormat('0.00');
  sh.getRange(2, 10, values.length, 1).setNumberFormat('ddd, mmm d, yyyy');
  sh.getRange(2, 11, values.length, 1).setNumberFormat('mmm d, yyyy');
  sh.getRange(2, 13, values.length, 1).setNumberFormat('mmm d, h:mm am/pm');
}

// ---------------------------------------------------------------- upsert by hidden ID column (H)

function index_(ctx, sh, key) {
  if (!ctx.index[key]) {
    const map = {};
    const last = sh.getLastRow();
    if (last >= 2) {
      sh.getRange(2, 8, last - 1, 1).getValues().forEach(function (r, i) { if (r[0]) map[r[0]] = i + 2; });
    }
    ctx.index[key] = map;
  }
  return ctx.index[key];
}

function upsert_(ctx, sh, id, row, key) {
  const idx = index_(ctx, sh, key);
  let r = idx[id];
  if (!r) {
    r = sh.getLastRow() + 1;
    idx[id] = r;
  }
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  if (key === 'log') {
    sh.getRange(r, 1).setNumberFormat('ddd, mmm d, yyyy');
    sh.getRange(r, 6).setNumberFormat('0.00');
  } else if (key === 'coverage') {
    sh.getRange(r, 1).setNumberFormat('mmm d, yyyy');
    sh.getRange(r, 7).setNumberFormat('mmm d, h:mm am/pm');
  } else {
    sh.getRange(r, 4).setNumberFormat('ddd, mmm d');
    sh.getRange(r, 6, 1, 2).setNumberFormat('mmm d, h:mm am/pm');
    sh.getRange(r, 9).setNumberFormat('mmm d, h:mm am/pm');
  }
}

function remove_(ctx, sh, id, key) {
  const idx = index_(ctx, sh, key);
  const r = idx[id];
  if (!r) return;
  sh.deleteRow(r);
  delete idx[id];
  Object.keys(idx).forEach(function (k) { if (idx[k] > r) idx[k] -= 1; });
}

// ---------------------------------------------------------------- Google Calendar (read-only)

function getEvents_(fromIso, toIso, allCalendars) {
  const from = toDate_(fromIso);
  const to = toDate_(toIso);
  to.setDate(to.getDate() + 1); // inclusive end date
  const cals = allCalendars
    ? CalendarApp.getAllCalendars().filter(function (c) { return !c.isHidden(); })
    : [CalendarApp.getDefaultCalendar()];
  const tz = Session.getScriptTimeZone();
  const out = [];
  cals.forEach(function (cal) {
    cal.getEvents(from, to).forEach(function (ev) {
      if (ev.isAllDayEvent()) return;
      let status = '';
      try { status = String(ev.getMyStatus()); } catch (e) { /* not a guest */ }
      if (status === 'NO') return; // declined
      const start = ev.getStartTime();
      const end = ev.getEndTime();
      out.push({
        id: ev.getId() + '_' + start.getTime(),
        title: ev.getTitle() || '(No title)',
        start: start.toISOString(),
        end: end.toISOString(),
        date: Utilities.formatDate(start, tz, 'yyyy-MM-dd'),
        location: ev.getLocation() || '',
        guests: ev.getGuestList().length,
        calendar: cal.getName(),
      });
    });
  });
  out.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
  return out;
}

// ---------------------------------------------------------------- Backups to Google Drive

function backup_(name, content, keep) {
  if (!/^jarvis-backup-[\d-]+\.json$/.test(String(name))) throw new Error('Bad backup name');
  const folders = DriveApp.getFoldersByName('Jarvis Backups');
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder('Jarvis Backups');
  const existing = folder.getFilesByName(name);
  let file;
  if (existing.hasNext()) {
    file = existing.next();
    file.setContent(content); // today's backup is updated through the day
  } else {
    file = folder.createFile(name, content, 'application/json');
  }
  // Keep only the newest backups.
  const all = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (/^jarvis-backup-/.test(f.getName())) all.push(f);
  }
  all.sort(function (a, b) { return a.getName() < b.getName() ? 1 : -1; });
  all.slice(keep || 30).forEach(function (f) { f.setTrashed(true); });
  return { name: name, fileUrl: file.getUrl(), folderUrl: folder.getUrl() };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
