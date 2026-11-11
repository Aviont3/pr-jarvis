#!/bin/bash
# Jarvis.app launcher: the first time it sets Jarvis up (about a minute, needs internet),
# after that it just makes sure Jarvis is running and opens it in the browser.
# All data lives in ~/Library/Application Support/Jarvis/data and is kept forever,
# even if this app is deleted or reinstalled.

BASE="$HOME/Library/Application Support/Jarvis"
LABEL="com.prjarvis.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT=4747
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
URL="http://localhost:$PORT"

say_dialog() { /usr/bin/osascript -e "display dialog \"$1\" with title \"Jarvis\" buttons {\"OK\"} default button 1 with icon POSIX file \"$RES/Jarvis.icns\" giving up after ${2:-120}" >/dev/null 2>&1; }
alert() { /usr/bin/osascript -e "display alert \"$1\" message \"$2\" as critical" >/dev/null 2>&1; }

open_jarvis() {
  for _ in $(seq 1 40); do
    /usr/bin/curl -fs -o /dev/null "$URL/api/state" && break
    sleep 0.5
  done
  /usr/bin/open -a "Google Chrome" "$URL" 2>/dev/null || /usr/bin/open "$URL"
}

mkdir -p "$BASE"

if [ ! -x "$BASE/node/bin/node" ] || [ ! -f "$BASE/app/server.js" ] || [ ! -f "$PLIST" ]; then
  # First time: set up in the background and tell the person what's happening.
  say_dialog "Setting up Jarvis… 🌸\n\nThis takes about a minute the first time (it needs the internet). Jarvis opens in your browser when it's ready." 75 &
  DIALOG=$!
  if JARVIS_FROM_APP=1 /bin/bash "$RES/install.sh" >"$BASE/setup.log" 2>&1; then
    kill "$DIALOG" 2>/dev/null
    open_jarvis
    exit 0
  fi
  kill "$DIALOG" 2>/dev/null
  alert "Jarvis couldn't finish setting up" "Please check your internet connection and open Jarvis again. (Details: $BASE/setup.log)"
  exit 1
fi

# Every other time: make sure Jarvis is running, then open it.
/bin/launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl kickstart "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
open_jarvis
