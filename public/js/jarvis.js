// Jarvis: the conversation layer. It turns parsed commands into actions
// and spoken replies, and remembers short follow-ups ("How long did that take?" -> "45 minutes").

import { parseCommand, parseDuration, matchProject, guessCategory, shortTask, tidy } from './parser.js';
import {
  morningBrief, wrapUp, answerHours, answerLog, answerTodos, buildReport, findTodo, displayProject,
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
    { heading: 'Timer', items: ['"Start working on Acme press release"', '"Stop" / "Done"', '"What am I working on?"', '"Cancel timer"'] },
    { heading: 'To-dos', items: ['"Add to-do: follow up with Axios Friday"', '"Remind me to send the recap tomorrow, urgent"', '"What\'s on my list?"', '"Check off follow up with Axios"'] },
    { heading: 'Questions & reports', items: ['"How many hours on Acme this month?"', '"What did I do yesterday?"', '"Weekly report" / "Report for Nike last week"'] },
    { heading: 'Daily rhythm', items: ['"Morning brief"', '"Wrap up my day"'] },
  ],
};

const say = (speech, extra = {}) => ({ speech, title: '', sections: [], ...extra });

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
      date: isoDate(this.now()),
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
      case 'help': return { ...HELP };
      case 'yes': return say("There's nothing waiting for a yes right now.");
      case 'no': return say('Okay.');

      case 'brief': return morningBrief(state, now);
      case 'wrapup': return wrapUp(state, now);
      case 'todo_list': return answerTodos(state, now);
      case 'query_hours': return answerHours(state, cmd, now);
      case 'query_log': return answerLog(state, cmd, now);
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
        return say(`Stopped. Logged ${this.describeEntry(e)}.`);
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

  async completeTodo(td) {
    await this.actions.updateTodo(td.id, { done: true, doneAt: new Date().toISOString() });
    this.pending = { type: 'todoDoneLog', todo: td };
    return say(`Checked off "${td.text}". Want to log time for it? Just say how long, like "30 minutes", or say no.`);
  }
}
