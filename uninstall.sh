#!/bin/bash
# Removes the Jarvis app and stops it from starting at login.
# Your saved work is KEPT unless you add --delete-data.
#   curl -fsSL https://raw.githubusercontent.com/Aviont3/pr-jarvis/main/uninstall.sh | bash

LABEL="com.prjarvis.server"
BASE="$HOME/Library/Application Support/Jarvis"

launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
rm -rf "$HOME/Applications/Jarvis.app"
[ -L "$HOME/Desktop/Jarvis" ] && rm -f "$HOME/Desktop/Jarvis"
rm -rf "$BASE/app" "$BASE/node" "$BASE/jarvis.log"

if [ "${1:-}" = "--delete-data" ]; then
  rm -rf "$BASE"
  echo "Jarvis and all of its data were removed."
else
  echo "Jarvis was removed. Your saved work is still in: $BASE/data"
fi
