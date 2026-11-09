# Jarvis: PR Daily Work Tracker

A personal, voice-driven assistant for tracking your PR workday. It runs on your Mac, and your data stays on your Mac.

Talk to it (or type), and Jarvis logs your work, runs timers, keeps your to-do list, briefs you in the morning, wraps up your day and writes your reports. It can also copy everything to your **PR Daily Work Tracker** Google Sheet.

No AI service, no account and no monthly cost. Jarvis understands a set of everyday phrases (listed below).

---

## 1. One-time setup (about 5 minutes)

1. **Install Node.js.** Go to <https://nodejs.org>, download the **LTS** installer for macOS and run it.
2. **Get the code.** Open **Terminal** (⌘+Space, type "Terminal") and paste:
   ```bash
   git clone https://github.com/Aviont3/pr-jarvis.git ~/pr-jarvis
   ```
   (If your Mac asks to install developer tools, click **Install**, wait, then run the command again.)
   Or, on GitHub, click **Code → Download ZIP** and unzip it into your home folder.
3. **Start Jarvis.** In Finder, open the `pr-jarvis` folder and **double-click `start.command`**.
   - The first time, macOS may say it can't verify the file: **right-click → Open → Open**.
   - Or, in Terminal: `cd ~/pr-jarvis && npm start`
4. Jarvis opens at **http://localhost:4747**. Use **Google Chrome** for the best voice support. When Chrome asks for microphone access, click **Allow**.
5. Go to **Settings**: add your name and your projects/clients (one per line), then click **Save**.

Leave the Terminal window open while you use Jarvis. Close it (or press Ctrl+C) to stop.

> Tip: drag `start.command` to your Dock, or add it under System Settings → General → Login Items, so Jarvis starts when you log in.

## 2. Connect your Google Sheet (optional, about 3 minutes)

1. In Jarvis go to **Settings → Google Sheet sync** and click **Copy script**.
2. Open your PR Daily Work Tracker sheet → **Extensions → Apps Script**. Delete what's there, paste, then click 💾 Save.
3. Click **Deploy → New deployment**. Click the ⚙️ next to "Select type", choose **Web app**, set **Execute as: Me** and **Who has access: Anyone**, then click **Deploy**. Approve the permissions. (Google warns that the app is unverified because it's your own script: click *Advanced → Go to …*.)
4. Copy the **Web app URL**, paste it into Jarvis, click **Save settings**, then **Test connection**.

From then on, every entry and to-do is copied to the sheet:
- **Daily Log:** the same columns as your sheet, plus a hidden "Jarvis ID" column so edits update the right row
- **To-Do:** a new tab with status, due date and priority
- **Lists:** your projects and categories, kept up to date

The sheet link only works with the secret token built into your copy of the script, so nobody else can write to your sheet with it.

### Google Calendar meetings 📅
Jarvis reads your meetings through the same script, so set up the sheet sync first.

1. **Settings → Copy script**, then paste it into Apps Script again, replacing the old code. Click 💾 Save.
2. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.** Approve the calendar permission. Your web app URL stays the same.
3. In Jarvis **Settings → Google Calendar**, tick **Show my Google Calendar meetings**, click **Save**, then **Test calendar**.

What you get:
- **📅 Meetings today** panel on the Today screen, with a one-click **Log** button for each meeting. The duration is filled in, the project is guessed from the meeting title, and the category is guessed too (Client Communication when a client's name is in the title).
- **When a meeting ends**, Jarvis asks whether to log it. Say "yes".
- Meetings appear in the **morning brief**, and the **wrap-up** points out meetings you haven't logged.
- Declined meetings and all-day events are skipped. Each meeting can only be logged once.
- Jarvis only *reads* your calendar and never changes it. Your main calendar is used unless you tick **Include all my calendars**.

## 3. Talking to Jarvis

Click the glowing mic, or press **⌘J**, and speak. You can also type in the box.

| You say | Jarvis does |
|---|---|
| "Log 45 minutes on Spring Launch: pitched TechCrunch and Axios, waiting on replies" | Fills in project, time, category (Media Relations) and next step, then asks you to confirm |
| "Spent 2 hours drafting the Acme press release. Next step: send to client" | Logs it, and adds "Send to client" to your to-dos |
| "Pitched the Nike story to Vogue" | Asks "How long did that take?" Answer "30 minutes" |
| "Start working on Acme press release" / "Stop" | Times the task and logs it when you stop |
| "What am I working on?" / "Cancel timer" | Timer status / discard |
| "Add to-do: follow up with Axios Friday" | Adds a to-do due Friday |
| "Remind me to send the Nike recap tomorrow, urgent" | High-priority to-do due tomorrow |
| "What's on my list?" | Reads your overdue, today and upcoming to-dos |
| "Check off follow up with Axios" | Completes it and offers to log time for it |
| "How many hours on Acme this month?" | Answers, with a breakdown |
| "What did I do yesterday?" / "…last week on Nike?" | Lists your entries |
| "Weekly report" / "Report for Nike last week" | A copy-ready report for your manager or client |
| "What meetings do I have today?" / "…tomorrow?" | Reads your calendar |
| "When's my next meeting?" | Next meeting and how soon it starts |
| "Log my meetings" | Logs every finished meeting you haven't logged today |
| "Log the Acme check-in meeting" | Logs that one meeting (asks you to confirm) |
| "Morning brief" / "Wrap up my day" | Your daily kickoff and end-of-day summary |
| "Help" | Shows all commands |

Jarvis picks the **category** from keywords (e.g. *pitch* → Media Relations & Pitching, *draft* → Press Releases & Writing). You can edit the keywords in **Settings**. Project names match on a distinctive word, so "Acme" finds "Acme Corp Rebrand".

### Daily rhythm
- **Morning brief:** shown automatically the first time you open Jarvis each day
- **Check-ins:** optional; Jarvis asks "What have you been working on?" if nothing has been logged for a while (set in Settings). It stays quiet while you're in a meeting.
- **End-of-day wrap-up:** offered automatically at the end of your workday

## 4. Screens
- **Today:** the Jarvis chat, the timer, today's meetings, entries and to-dos
- **Log:** every entry, with filters, search, editing and CSV export
- **To-Do:** overdue / today / upcoming / no date, plus completed items
- **Dashboard:** hours today, this week and this month; charts by day, category and project; the report builder
- **Settings:** projects, categories and keywords, voice, reminders, Sheet sync and backups

## Your data
- Stored in `pr-jarvis/data/db.json`, with daily backups in `data/backups/` (the last 30 are kept)
- **Settings → Download a backup** saves everything as one file
- Jarvis only accepts connections from your own Mac

## For developers
```bash
npm start    # run the server on http://localhost:4747
npm test     # unit tests for the command parser and Jarvis logic
```
No dependencies. The code is plain Node.js and browser JavaScript.
- `server.js`: local API, JSON storage and the Google Sheets sync queue
- `public/js/parser.js`: rule-based command understanding
- `public/js/jarvis.js`: conversation flow and follow-up questions
- `public/js/insights.js`: stats, briefs, wrap-ups and reports
- `public/js/voice.js`: speech recognition and speech output
- `apps-script/Code.gs`: the Google Sheet side of the sync
