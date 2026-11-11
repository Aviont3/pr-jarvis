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

## Connect Outlook (work email & calendar)

Go to **⚙️ Settings → 📧 Outlook** and click **🔑 Sign in with Microsoft**. Sign in with your work account. Afterwards:
- 📅 **Outlook meetings** show on Home and in your morning brief, and Jarvis asks to log each one when it ends (alongside Google Calendar, if you use both).
- 🚩 **Flagged emails become to-dos**, with the flag's due date, marked urgent if the email is important, and an **✉️ Open email** link. Un-flag or complete it in Outlook and Jarvis ticks it off.
- 📧 **New emails** show on Home, the morning brief mentions them, and you can ask *“Any new emails?”* or *“Any important emails?”*

Jarvis only **reads** your mail and calendar. It can't send, change or delete anything, and your Microsoft sign-in stays on your Mac (it's never put in backups or the Google Sheet).

**Your company may need to approve Jarvis.** If so, Jarvis shows an approval link in Settings. Send it to IT; once they approve, sign in again.

<details>
<summary><b>One-time setup (for whoever installs Jarvis, about 5 minutes)</b></summary>

Microsoft only lets apps sign in once they're registered. Jarvis walks you through this in **Settings → Outlook → Set up (one time)**, or:

1. Open [Azure portal → App registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → **+ New registration**.
2. Name: **Jarvis**. Supported account types: **Accounts in any organizational directory (Multitenant)**.
3. Redirect URI: platform **Public client/native (mobile & desktop)**, value `http://localhost:4747/api/outlook/callback` → **Register**.
4. **Authentication** → *Allow public client flows* → **Yes** → Save.
5. **API permissions** → Add a permission → Microsoft Graph → **Delegated**: `Calendars.Read`, `Mail.Read`, `User.Read`, `offline_access` → Add. (An admin can click **Grant admin consent** here to approve it for the whole company.)
6. Copy the **Application (client) ID** from the Overview page into Jarvis (the setup guide asks for it, or **Settings → Advanced → Microsoft app (client) ID**).

No app secret is needed: Jarvis uses Microsoft's standard sign-in for desktop apps (authorization code with PKCE).
</details>

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
| “What meetings do I have today?” / “Log my meetings” | reads or logs your calendar (Google and/or Outlook) |
| “Any new emails?” / “Any important emails?” | reads your new Outlook emails |
| “How many hours on Acme this month?” | tells you |
| “What did I do on October 19th?” / “Pull up last Tuesday” | shows everything from that day, with a button to open it in My Work |
| “Yesterday I spent 2 hours on the Acme release” | logs work for a past day |
| “Change that to 45 minutes” / “Delete my last entry” / “Undo that” | fixes the last thing you logged |
| “Weekly report” | writes a report you can copy into an email |
| “Good morning” / “Wrap up my day” | your daily plan / end-of-day summary |

**The other pages:**
- **📒 My Work:** everything you've logged. Click ✏️ to change or 🗑️ to delete any entry, from any day (a deleted entry can be brought back with **Undo**). To see one day, choose **Show → 📅 A specific day…** and pick a date (◀ ▶ step a day at a time), or click any date in the list. **📋 Copy summary** copies that day's work, and **⬇️ Download** opens it in Excel or Numbers.
- **✅ To-Dos:** your full list. Tick the circle when something's done. Click a to-do's **📅 date** to change when it's due (or say “move … to Friday”), and its **🌷 project** to file it under a project (or say “put … under Acme”). Use the **Show:** buttons to see one project's to-dos; new to-dos added there go into that project. Click **⚑ Normal / 🔥 Urgent / 🐢 Low** to change how urgent a to-do is (or say “make … urgent”). The **Due:** buttons show what's overdue, due today, tomorrow, in the next 7 or 30 days, or has no date, and **🔥 Urgent only** narrows it to urgent to-dos. Upcoming to-dos are grouped by date. You can also ask “what's due this week?” or “what's urgent?”. Each to-do shows when it was **added**, and finished ones when they were **completed**. Deleted to-dos go to **🗑️ Deleted** with their **deletion date**, and you can **Restore** them. The same dates appear in the Google Sheet's To-Do tab.
- **📊 Insights:** charts of your time and a ready-to-send report.
- **⚙️ Settings:** your name, projects, Google connection and voice. Changes save automatically.

## Updates

When there's a new version, a small banner appears at the top. Click **Update now** and Jarvis updates itself in a few seconds. Your work is never touched. You can also check in **⚙️ Settings → Updates**.

## Your data: saving & backups

- **Saved instantly:** everything you log is saved on your Mac the moment you save it (in `~/Library/Application Support/Jarvis/data`).
- **Automatic backups:** a backup copy is made shortly after every change, and Jarvis checks every 5 minutes.
- **Google Drive backups:** if Google is connected, each backup also goes to a **“Jarvis Backups”** folder in your Google Drive (one file per day, the last 30 days are kept). If you connected Google before this feature existed, Jarvis shows **“One quick step to turn on Google Drive backups”** and walks you through updating the script (about a minute).
- **⚙️ Settings → Saving & backups** shows when the last backup happened. It also has **Back up now**, **Open my Drive backups**, **Save a backup copy** (downloads one file) and **Restore from a backup…** (pick a backup file, and Jarvis puts everything back; what you had before is saved first, just in case).
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
- `outlook.js`: Microsoft 365 sign-in (PKCE), Outlook calendar, flagged emails → to-dos, unread emails (read-only)
- `public/js/parser.js`: rule-based command understanding
- `public/js/jarvis.js`: conversation flow
- `public/js/insights.js`: stats, briefs, reports, meetings
- `public/js/app.js`: the UI, welcome and Google guides, tour
- `apps-script/Code.gs`: the Google side (Sheet sync and read-only Calendar)

Manual setup without the installer: install Node.js 18+, `git clone` this repo, run `npm start`, and open http://localhost:4747. (`start.command` does this with a double-click.)
</details>
