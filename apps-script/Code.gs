/**
 * Jarvis → Google Sheets sync.
 *
 * Paste this into your tracker sheet (Extensions → Apps Script), then
 * Deploy → New deployment → Web app, Execute as: Me, Who has access: Anyone.
 * Copy the web app URL into Jarvis → Settings → Google Sheet sync.
 *
 * The token below must match the one in Jarvis. If you copied this script
 * from Jarvis Settings, it's already filled in.
 */
const TOKEN = 'PASTE_TOKEN_HERE';

const LOG_SHEET = 'Daily Log';
const TODO_SHEET = 'To-Do';
const LISTS_SHEET = 'Lists';
const LOG_HEADERS = ['Date', 'Project', 'Task', 'Work Done', 'Category', 'Time Spent (hrs)', 'Notes / Next Steps', 'Jarvis ID'];
const TODO_HEADERS = ['Status', 'To-Do', 'Project', 'Due', 'Priority', 'Created', 'Completed', 'Jarvis ID'];

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
      const ctx = { ss: ss, index: {} };
      (body.ops || []).forEach(function (op) { apply_(ctx, op); });
      SpreadsheetApp.flush();
      return json_({ ok: true, spreadsheet: ss.getName() });
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
    case 'upsertEntry': return upsert_(ctx, logSheet_(ctx.ss), op.entry.id, entryRow_(op.entry), 'log');
    case 'deleteEntry': return remove_(ctx, logSheet_(ctx.ss), op.id, 'log');
    case 'upsertTodo': return upsert_(ctx, todoSheet_(ctx.ss), op.todo.id, todoRow_(op.todo), 'todo');
    case 'deleteTodo': return remove_(ctx, todoSheet_(ctx.ss), op.id, 'todo');
    case 'setLists': return setLists_(ctx.ss, op.projects || [], op.categories || []);
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
  return [t.done ? 'Done' : 'Open', t.text || '', t.project || '', toDate_(t.due),
    t.priority === 'high' ? 'High' : t.priority === 'low' ? 'Low' : 'Normal',
    t.createdAt ? new Date(t.createdAt) : '', t.doneAt ? new Date(t.doneAt) : '', t.id];
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
      .whenFormulaSatisfied('=$A2="Done"').setFontColor('#9ca3af').setStrikethrough(true)
      .setRanges([sh.getRange('A2:G')]).build();
    sh.setConditionalFormatRules([rule]);
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
  } else {
    sh.getRange(r, 4).setNumberFormat('ddd, mmm d');
    sh.getRange(r, 6, 1, 2).setNumberFormat('mmm d, h:mm am/pm');
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
