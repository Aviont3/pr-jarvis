# 🌸 Jarvis: your PR workday assistant

Jarvis keeps track of everything you do in your workday. Talk to it (or type), and it logs your work, times tasks, keeps your to-do list, shows your meetings, and writes your weekly report for you.

It runs on your Mac, and your work stays on your Mac. If you want, it can also copy everything into your Google Sheet.

---

## Install (one time, about 2 minutes)

1. Open **Terminal**: press **⌘ Command + Space**, type **Terminal**, and press **Return**.
2. Copy this whole line, paste it into Terminal, and press **Return**:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/Aviont3/pr-jarvis/main/install.sh | bash
   ```
3. Wait for **✅ All done!** Jarvis opens in your browser by itself. You can close Terminal.

That's it. The installer doesn't need your password and doesn't change anything else on your Mac.

**From now on:** double-click **🌸 Jarvis** on your Desktop, or find it in **Launchpad**. Jarvis also starts by itself when you turn on your Mac.

> 💡 Talking to Jarvis works best in **Google Chrome**. When Chrome asks to use your microphone, click **Allow**.

## First time you open it

A short welcome guide asks for your name and your projects, and tests your microphone. Then you can take a quick tour. You can replay the tour anytime with **❓ Help** at the top right.

## Connect your Google Sheet & Calendar (optional, about 3 minutes)

Click **Connect Google** at the top right (or **⚙️ Settings → Connect Google**). Jarvis walks you through it one step at a time and checks that everything works at the end. Afterwards:
- 📗 Everything you log is saved in your Google Sheet automatically.
- 📅 Today's meetings show on Home. When a meeting ends, Jarvis asks whether to log it.

## Using Jarvis

**Home** has four big buttons: **🎤 Talk to Jarvis · 📝 Log work · ⏱️ Start a timer · ✅ Add a to-do**.

Or tap the flower 🌼 and just talk, in your own words:

| Say something like… | Jarvis… |
|---|---|
| “I spent 45 minutes pitching TechCrunch for Spring Launch” | logs it (and asks you to confirm) |
| “Drafted the Acme press release. Next step: send to client” | asks how long, logs it, and adds the next step to your to-dos |
| “Start working on the Nike media list” … “Stop” | times it and logs it |
| “Remind me to call the venue Friday, urgent” | adds an urgent to-do due Friday |
| “What's on my list?” | reads your to-dos |
| “What meetings do I have today?” / “Log my meetings” | reads or logs your calendar |
| “How many hours on Acme this month?” | tells you |
| “Weekly report” | writes a report you can copy into an email |
| “Good morning” / “Wrap up my day” | your daily plan / end-of-day summary |

**The other pages:**
- **📒 My Work:** everything you've logged. Click any row to change it. **⬇️ Download** opens it in Excel or Numbers.
- **✅ To-Dos:** your full list. Tick the circle when something's done.
- **📊 Insights:** charts of your time and a ready-to-send report.
- **⚙️ Settings:** your name, projects, Google connection and voice. Changes save automatically.

## Updates

When there's a new version, a small banner appears at the top. Click **Update now** and Jarvis updates itself in a few seconds. Your work is never touched. You can also check in **⚙️ Settings → Updates**.

## Your data

- Saved on your Mac in `~/Library/Application Support/Jarvis/data`, with a daily backup.
- **⚙️ Settings → Save a backup copy** downloads everything as one file.
- Only your own Mac can open Jarvis.

## Uninstall

Paste this into Terminal (your saved work is kept):
```bash
curl -fsSL https://raw.githubusercontent.com/Aviont3/pr-jarvis/main/uninstall.sh | bash
```

---

<details>
<summary>For developers</summary>

```bash
npm start    # run on http://localhost:4747 (data in ./data)
npm test     # unit tests
```
No dependencies; plain Node.js and browser JavaScript.
- `install.sh` / `uninstall.sh`: Mac installer (private Node.js, a LaunchAgent so Jarvis runs at login, an AppleScript app launcher)
- `server.js`: local API, JSON storage, Google Sheets sync queue, calendar proxy, self-update
- `public/js/parser.js`: rule-based command understanding
- `public/js/jarvis.js`: conversation flow
- `public/js/insights.js`: stats, briefs, reports, meetings
- `public/js/app.js`: the UI, welcome and Google guides, tour
- `apps-script/Code.gs`: the Google side (Sheet sync and read-only Calendar)

Manual setup without the installer: install Node.js 18+, `git clone` this repo, run `npm start`, and open http://localhost:4747. (`start.command` does this with a double-click.)
</details>
