// Jarvis: the conversation layer. It turns parsed commands into actions
// and spoken replies, and remembers short follow-ups ("How long did that take?" -> "45 minutes").

import { parseCommand, parseDuration, matchProject, guessCategory, shortTask, tidy } from './parser.js';
import {
  morningBrief, wrapUp, answerHours, answerLog, answerTodos, buildReport, findTodo, displayProject,
  answerMeetings, answerEmail, unloggedMeetings, meetingToEntry, meetingsOn, isMeetingLogged, fmtTime,
} from './insights.js';
import { isoDate, fmtHours, roundHours, fmtDate } from './util.js';

export const HELP = {
  title: 'What you can say',
  speech: 'You can log work, run a timer, manage your to-dos, and ask about your hours. The full list of commands is on screen.',
  sections: [
    { heading: 'Log work', items: [
      '"Log 45 minutes on Spring Launch: pitched TechCrunch and Axios"',
      '"Spent 2 hours drafting the Acme press release. Next step: send to client"',
    ] },
    { heading: 'Fix mistakes', items: ['"Change that to 45 minutes"', '"Change that to Nike Holiday"', '"Edit my last entry"', '"Delete my last entry" / "Undo that"'] },
    { heading: 'Timer', items: ['"Start working on Acme press release"', '"Stop" / "Done"', '"What am I working on?"', '"Cancel timer"'] },
    { heading: 'To-dos', items: ['"Add to-do: follow up with Axios Friday"', '"Remind me to send the recap tomorrow, urgent"', '"What\'s on my list?"', '"Check off follow up with Axios"', '"Move follow up with Axios to Friday"', '"Put the venue under Nike"', '"Make the venue urgent"', '"What\'s on my list for Acme?"', '"What\'s due this week?"', '"What\'s urgent?"'] },
    { heading: 'Questions & reports', items: ['"How many hours on Acme this month?"', '"What did I do yesterday?"', '"What did I do on October 19th?"', '"Weekly report" / "Report for Nike last week"'] },
    { heading: 'Email (Outlook)', items: ['"Any new emails?"', '"Any important emails?"', '"Check my inbox"'] },
    { heading: 'Calendar', items: ['"What meetings do I have today?"', '"When\'s my next meeting?"', '"Log my meetings"', '"Log the Acme check-in meeting"'] },
    { heading: 'Daily rhythm', items: ['"Morning brief"', '"Wrap up my day"'] },
  ],
};

const say = (speech, extra = {}) => ({ speech, title: '', sections: [], ...extra });

/** The most recently logged entry (by when it was saved, not the day it's for). */
const lastEntry = (entries) => [...entries].sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? 1 : -1))[0];

/** Fields an "edit" command asked to change: hours, project, date. */
function editChanges(cmd) {
  const c = {};
  if (cmd.hours) c.hours = cmd.hours;
  if (cmd.project) c.project = cmd.project;
  if (cmd.date) c.date = cmd.date;
  return c;
}

const CAL_OFF = 'No calendar is connected yet. In ⚙️ Settings, connect Google or Outlook to see your meetings.';

function findMeeting(events, query) {
  const q = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  let best = null;
  for (const ev of events) {
    const t = ev.title.toLowerCase();
    const hits = q.filter((w) => t.includes(w)).length;
    if (hits && (!best || hits > best.hits)) best = { ev, hits };
  }
  return best?.ev || null;
}

export class Jarvis {
  /**
   * @param {() => object} getState  returns { settings, entries, todos, timer }
   * @param {object} actions  async { addEntry, addTodo, updateTodo, startTimer, stopTimer }
   */
  constructor(getState, actions, nowFn = () => new Date()) {
    this.getState = getState;
    this.actions = actions;
    this.now = nowFn;
    this.pending = null; // { type, entry?, todo? }
  }

  ctx() {
    const s = this.getState().settings;
    return { projects: s.projects, categories: s.categories, keywords: s.keywords, now: this.now() };
  }

  newEntry(fields) {
    const s = this.getState().settings;
    return {
      date: fields.date || isoDate(this.now()),
      project: fields.project || '',
      task: fields.task || shortTask(fields.workDone || ''),
      workDone: fields.workDone || fields.task || '',
      category: fields.category || s.defaultCategory || '',
      hours: fields.hours ?? null,
      notes: fields.notes || '',
    };
  }

  describeEntry(e) {
    const bits = [fmtHours(e.hours)];
    if (e.project) bits.push(`on ${displayProject(e.project)}`);
    if (e.category) bits.push(`under ${e.category}`);
    if (e.date && e.date !== isoDate(this.now())) bits.push(`for ${fmtDate(e.date)}`);
    return bits.join(' ');
  }

  async proposeEntry(entry) {
    if (entry.hours == null) {
      this.pending = { type: 'needHours', entry };
      return say(`Got it: "${entry.workDone || entry.task}". How long did that take?`, { card: { kind: 'entry', entry } });
    }
    if (this.getState().settings.autoSaveVoiceLogs) return this.saveEntry(entry);
    this.pending = { type: 'confirmLog', entry };
    return say(`Logging ${this.describeEntry(entry)}. Say yes to save, or edit it below.`, { card: { kind: 'entry', entry } });
  }

  async saveEntry(entry) {
    this.pending = null;
    const saved = await this.actions.addEntry(entry);
    const next = entry.notes ? ` I added "${entry.notes}" to your to-dos.` : '';
    return say(`Saved. ${this.describeEntry(saved || entry)}.${next}`, { saved: true });
  }

  /** Called by the UI when the user presses Save/Discard on a proposed card. */
  async resolveCard(entry) {
    if (!entry) { this.pending = null; return say('Okay, discarded.'); }
    if (!(Number(entry.hours) > 0)) return say('Add the time spent first.');
    return this.saveEntry(entry);
  }

  async handle(input) {
    const cmd = parseCommand(input, this.ctx());
    const state = this.getState();
    const now = this.now();

    // ---- follow-ups to a pending question
    if (this.pending) {
      const p = this.pending;
      if (cmd.intent === 'no') { this.pending = null; return say('Okay, never mind.'); }
      if (p.type === 'confirmLog' && cmd.intent === 'yes') return this.saveEntry(p.entry);
      if (p.type === 'confirmDelete' && cmd.intent === 'yes') return this.deleteEntry(p.entry);
      // "change that…" / "delete that" while an entry is still waiting to be saved: fix the draft instead.
      if ((p.type === 'confirmLog' || p.type === 'needHours') && cmd.intent === 'entry_edit') {
        const changes = editChanges(cmd);
        if (!Object.keys(changes).length) return say('Make your changes in the box below, then click Save.', { card: { kind: 'entry', entry: p.entry } });
        return this.proposeEntry({ ...p.entry, ...changes });
      }
      if ((p.type === 'confirmLog' || p.type === 'needHours' || p.type === 'needWork') && cmd.intent === 'entry_delete') {
        this.pending = null;
        return say("Okay, I won't save that one.");
      }
      const dur = parseDuration(cmd.text);
      const bareDuration = dur && cmd.intent === 'log' && !cmd.workDone;
      if ((p.type === 'needHours' || p.type === 'confirmLog') && bareDuration) {
        return this.proposeEntry({ ...p.entry, hours: dur.hours });
      }
      if (p.type === 'todoDoneLog' && (bareDuration || cmd.intent === 'yes')) {
        if (!dur) return say('How long did it take?');
        const td = p.todo;
        return this.proposeEntry(this.newEntry({
          project: td.project, workDone: td.text, task: shortTask(td.text), hours: dur.hours,
          category: guessCategory(td.text, state.settings.keywords, state.settings.categories) || '',
        }));
      }
      if (p.type === 'needWork' && (cmd.intent === 'unknown' || (cmd.intent === 'log' && cmd.workDone))) {
        const s = state.settings;
        const w = cmd.intent === 'log' ? cmd.workDone : tidy(cmd.text);
        const pm = matchProject(cmd.text, s.projects);
        return this.proposeEntry({
          ...p.entry,
          workDone: w,
          task: shortTask(w),
          project: p.entry.project || pm?.project || '',
          category: guessCategory(w, s.keywords, s.categories) || p.entry.category,
        });
      }
      this.pending = null; // anything else: move on
    }

    switch (cmd.intent) {
      case 'empty': return say("I'm listening.");

      case 'entry_delete': {
        const last = lastEntry(state.entries);
        if (!last) return say("There's nothing logged to delete yet.");
        this.pending = { type: 'confirmDelete', entry: last };
        return say(`Delete “${last.workDone || last.task}” (${fmtHours(last.hours)}, ${fmtDate(last.date)})? Say yes to delete it.`);
      }

      case 'entry_edit': {
        const last = lastEntry(state.entries);
        if (!last) return say("There's nothing logged to change yet.");
        const changes = editChanges(cmd);
        if (!Object.keys(changes).length) {
          return say(`Here's “${last.workDone || last.task}”. Make your changes and click Save.`, { openEntry: last });
        }
        const updated = await this.actions.updateEntry(last.id, changes);
        return say(`Updated. It's now ${this.describeEntry({ ...last, ...changes, ...(updated || {}) })}.`, { saved: true });
      }
      case 'help': return { ...HELP };
      case 'yes': return say("There's nothing waiting for a yes right now.");
      case 'no': return say('Okay.');

      case 'brief': return morningBrief(state, now);

      case 'email_check': {
        if (!state.outlook?.connected) return say('Outlook isn’t connected yet. Go to ⚙️ Settings → Outlook and click “Sign in with Microsoft”.');
        if (!state.inbox?.enabled) return say('Email updates are turned off. Turn on “Tell me about new emails” in ⚙️ Settings → Outlook.');
        return answerEmail(state, cmd);
      }

      case 'calendar_list':
        if (!state.calendarActive && !state.settings.calendarEnabled) return say(CAL_OFF);
        return answerMeetings(state, cmd, now);

      case 'calendar_log': {
        if (!state.calendarActive && !state.settings.calendarEnabled) return say(CAL_OFF);
        const today = meetingsOn(state.events, isoDate(now)).filter((ev) => !isMeetingLogged(ev, state.entries));
        if (cmd.query) {
          const ev = findMeeting(today, cmd.query);
          if (!ev) return say(`I couldn't find an unlogged meeting today matching "${cmd.query}".`);
          return this.proposeEntry(meetingToEntry(ev, state.settings));
        }
        const done = unloggedMeetings(state, now);
        if (!done.length) {
          return say(today.length ? 'All your finished meetings are already logged. 🌼' : 'There are no finished meetings to log today.');
        }
        let total = 0;
        for (const ev of done) {
          const e = meetingToEntry(ev, state.settings);
          total += e.hours;
          await this.actions.addEntry(e);
        }
        return say(`Logged ${done.length} ${done.length === 1 ? 'meeting' : 'meetings'}, ${fmtHours(total)} in total.`, {
          saved: true, sections: [{ heading: 'Logged', items: done.map((ev) => `${fmtTime(ev.start)} · ${ev.title}`) }],
        });
      }
      case 'wrapup': return wrapUp(state, now);
      case 'todo_list': return answerTodos(state, now, cmd.project, { window: cmd.window, urgent: cmd.urgent });

      case 'todo_priority': {
        const td = findTodo(state.todos, cmd.query);
        if (!td) return say(`I couldn't find an open to-do matching "${cmd.query}". Say "what's on my list" to hear them.`);
        await this.actions.updateTodo(td.id, { priority: cmd.priority });
        const how = { high: 'marked urgent 🔥', normal: 'back to normal priority', low: 'marked low priority' }[cmd.priority];
        return say(`Done. "${td.text}" is ${how}.`);
      }

      case 'todo_project': {
        const td = findTodo(state.todos, cmd.query);
        if (!td) return say(`I couldn't find an open to-do matching "${cmd.query}". Say "what's on my list" to hear them.`);
        await this.actions.updateTodo(td.id, { project: cmd.project });
        return say(`Done. "${td.text}" is now under ${displayProject(cmd.project)}.`);
      }
      case 'query_hours': return answerHours(state, cmd, now);
      case 'query_log': {
        const r = answerLog(state, cmd, now);
        return cmd.period?.startsWith('day:') ? { ...r, card: { kind: 'day', date: cmd.period.slice(4) } } : r;
      }
      case 'report': {
        const r = buildReport(state, cmd, now);
        return { ...r, card: { kind: 'report', text: r.text, title: r.title } };
      }

      case 'log': {
        const entry = this.newEntry(cmd);
        if (!cmd.workDone) {
          this.pending = { type: 'needWork', entry };
          return say(`${fmtHours(cmd.hours)}, got it. What did you work on? You can fill it in below.`, { card: { kind: 'entry', entry } });
        }
        return this.proposeEntry(entry);
      }

      case 'timer_start': {
        let prefix = '';
        if (state.timer) {
          const e = await this.actions.stopTimer('');
          if (e) prefix = `Logged ${fmtHours(e.hours)} on ${e.task || displayProject(e.project)}. `;
        }
        const t = { project: cmd.project, task: cmd.task || 'Untitled task', category: cmd.category || state.settings.defaultCategory || '' };
        await this.actions.startTimer(t);
        const on = [t.task, t.project && `for ${displayProject(t.project)}`].filter(Boolean).join(' ');
        return say(`${prefix}Timer started: ${on}. Say "stop" when you're done.`);
      }

      case 'timer_stop': {
        if (!state.timer) {
          if (cmd.note) {
            const td = findTodo(state.todos, cmd.note);
            if (td) return this.completeTodo(td);
          }
          return say("There's no timer running. To log time, say something like 'log 30 minutes drafting the release'.");
        }
        const e = await this.actions.stopTimer(cmd.note);
        return say(`Stopped. Logged ${this.describeEntry(e)}.`, { saved: true });
      }

      case 'timer_cancel': {
        if (!state.timer) return say("There's no timer running.");
        await this.actions.cancelTimer();
        return say('Timer discarded. Nothing was logged.');
      }

      case 'timer_status': {
        if (!state.timer) return say('No timer is running.');
        const hrs = (now - new Date(state.timer.startedAt)) / 3600000;
        return say(`You've been on ${state.timer.task}${state.timer.project ? ` for ${displayProject(state.timer.project)}` : ''} for ${fmtHours(roundHours(hrs))}.`);
      }

      case 'todo_add': {
        if (!cmd.todo) return say('What should I add to your list?');
        const td = await this.actions.addTodo({ text: cmd.todo, due: cmd.due, priority: cmd.priority, project: cmd.project });
        const due = td.due ? `, due ${td.due === isoDate(now) ? 'today' : fmtDate(td.due)}` : '';
        return say(`Added to your list: ${td.text}${due}${td.priority === 'high' ? ', marked urgent' : ''}.`);
      }

      case 'todo_due': {
        const td = findTodo(state.todos, cmd.query);
        if (!td) return say(`I couldn't find an open to-do matching "${cmd.query}". Say "what's on my list" to hear them.`);
        await this.actions.updateTodo(td.id, { due: cmd.due });
        if (!cmd.due) return say(`Removed the due date from "${td.text}".`);
        const when = cmd.due === isoDate(now) ? 'today' : fmtDate(cmd.due);
        return say(`Done. "${td.text}" is now due ${when}.`);
      }

      case 'todo_complete': {
        const td = findTodo(state.todos, cmd.query);
        if (!td) return say(`I couldn't find an open to-do matching "${cmd.query}". Say "what's on my list" to hear them.`);
        return this.completeTodo(td);
      }

      default: {
        // Plain description with no command word: treat it as work and ask for the time.
        const words = cmd.text.split(/\s+/).length;
        if (words >= 3) {
          const s = state.settings;
          const pm = matchProject(cmd.text, s.projects);
          return this.proposeEntry(this.newEntry({
            workDone: tidy(cmd.text), project: pm?.project || '',
            category: guessCategory(cmd.text, s.keywords, s.categories) || '',
          }));
        }
        return say(`Sorry, I didn't catch that. Say "help" to see what I can do.`);
      }
    }
  }

  async deleteEntry(entry) {
    this.pending = null;
    const removed = await this.actions.deleteEntry(entry.id);
    return say(`Deleted “${entry.workDone || entry.task}”.`, { undo: removed });
  }

  /** Offer to log a meeting that just ended. "yes" saves it. */
  promptMeeting(ev) {
    const entry = meetingToEntry(ev, this.getState().settings);
    this.pending = { type: 'confirmLog', entry };
    return say(`Your meeting "${ev.title}" just ended. Log ${fmtHours(entry.hours)}${entry.project ? ` on ${displayProject(entry.project)}` : ''}? Say yes, or edit it below.`, {
      title: '📅 Meeting finished', card: { kind: 'entry', entry },
    });
  }

  async completeTodo(td) {
    await this.actions.updateTodo(td.id, { done: true, doneAt: new Date().toISOString() });
    this.pending = { type: 'todoDoneLog', todo: td };
    return say(`Checked off "${td.text}". Want to log time for it? Just say how long, like "30 minutes", or say no.`, { celebrate: true });
  }
}
