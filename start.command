#!/bin/bash
# Double-click this file in Finder to start Jarvis.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Download the LTS installer from https://nodejs.org, install it, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi
if curl -s -o /dev/null http://localhost:4747/api/state; then
  echo "Jarvis is already running."
else
  (sleep 1.5 && open -a "Google Chrome" http://localhost:4747 2>/dev/null || open http://localhost:4747) &
  node server.js
  exit
fi
open -a "Google Chrome" http://localhost:4747 2>/dev/null || open http://localhost:4747
