#!/bin/bash
# 🌸 Jarvis installer for Mac
#
# Paste this one line into Terminal:
#   curl -fsSL https://raw.githubusercontent.com/Aviont3/pr-jarvis/main/install.sh | bash
#
# What it does (no admin password needed, everything stays in your user folder):
#   1. Downloads a private copy of Node.js just for Jarvis
#   2. Downloads Jarvis
#   3. Starts Jarvis now and every time you log in
#   4. Puts a "Jarvis" app in your Applications folder and on your Desktop
# Your data lives in ~/Library/Application Support/Jarvis/data and is never touched by updates.

set -euo pipefail

REPO_ZIP="https://github.com/Aviont3/pr-jarvis/archive/refs/heads/main.zip"
NODE_INDEX="https://nodejs.org/dist/latest-v22.x"
BASE="$HOME/Library/Application Support/Jarvis"
APP_DIR="$BASE/app"
DATA_DIR="$BASE/data"
NODE_DIR="$BASE/node"
PORT=4747
LABEL="com.prjarvis.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LAUNCHER="$HOME/Applications/Jarvis.app"

step() { printf "\n\033[1;35m🌸 %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$1"; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "This installer is for Mac computers."

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$BASE" "$DATA_DIR" "$HOME/Library/LaunchAgents" "$HOME/Applications"

# ------------------------------------------------------------------ 1. Node.js (private copy)
if [ ! -x "$NODE_DIR/bin/node" ]; then
  step "Getting things ready (1 of 4)… this takes about a minute"
  if [ "$(uname -m)" = "arm64" ]; then ARCH="arm64"; else ARCH="x64"; fi
  SUMS="$(curl -fsSL "$NODE_INDEX/SHASUMS256.txt")" || fail "Couldn't reach nodejs.org. Check your internet connection and try again."
  FILE="$(printf '%s\n' "$SUMS" | awk '{print $2}' | grep "darwin-$ARCH.tar.gz$" | head -1)"
  WANT="$(printf '%s\n' "$SUMS" | grep " $FILE\$" | awk '{print $1}')"
  curl -fL --progress-bar -o "$TMP/node.tgz" "$NODE_INDEX/$FILE" || fail "Download failed. Check your internet connection and try again."
  GOT="$(shasum -a 256 "$TMP/node.tgz" | awk '{print $1}')"
  [ "$GOT" = "$WANT" ] || fail "The download looks damaged. Please run the installer again."
  mkdir -p "$NODE_DIR"
  tar -xzf "$TMP/node.tgz" -C "$NODE_DIR" --strip-components=1
else
  step "Getting things ready (1 of 4)… already done"
fi

# ------------------------------------------------------------------ 2. Jarvis itself
step "Downloading Jarvis (2 of 4)…"
curl -fsSL -o "$TMP/jarvis.zip" "$REPO_ZIP" || fail "Couldn't download Jarvis. Check your internet connection and try again."
ditto -x -k "$TMP/jarvis.zip" "$TMP/unzipped"
SRC="$(find "$TMP/unzipped" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -f "$SRC/server.js" ] || fail "The download looks incomplete. Please run the installer again."
rm -rf "$APP_DIR.old"
[ -d "$APP_DIR" ] && mv "$APP_DIR" "$APP_DIR.old"
mv "$SRC" "$APP_DIR"
rm -rf "$APP_DIR.old"

# Bring over data from an older, manual install (~/pr-jarvis) if there is one.
if [ ! -f "$DATA_DIR/db.json" ] && [ -f "$HOME/pr-jarvis/data/db.json" ]; then
  cp "$HOME/pr-jarvis/data/db.json" "$DATA_DIR/db.json"
  echo "   Moved your existing Jarvis data over. 👍"
fi

# ------------------------------------------------------------------ 3. Start now and at every login
step "Setting Jarvis to start automatically (3 of 4)…"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_DIR/bin/node</string>
    <string>$APP_DIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>JARVIS_DATA_DIR</key><string>$DATA_DIR</string>
    <key>JARVIS_INSTALLED</key><string>1</string>
    <key>PORT</key><string>$PORT</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$BASE/jarvis.log</string>
  <key>StandardErrorPath</key><string>$BASE/jarvis.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
# Stop a manually started copy, if one is using Jarvis's port.
OLD_PIDS="$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null || true)"
[ -n "$OLD_PIDS" ] && kill $OLD_PIDS >/dev/null 2>&1 || true
sleep 1
launchctl bootstrap "gui/$(id -u)" "$PLIST"

# ------------------------------------------------------------------ 4. The Jarvis app icon
step "Adding the Jarvis app (4 of 4)…"
rm -rf "$LAUNCHER"
osacompile -o "$LAUNCHER" \
  -e "do shell script \"launchctl kickstart gui/$(id -u)/$LABEL >/dev/null 2>&1 || true\"" \
  -e "repeat 20 times" \
  -e "  try" \
  -e "    do shell script \"curl -fs -o /dev/null http://localhost:$PORT/api/state\"" \
  -e "    exit repeat" \
  -e "  end try" \
  -e "  delay 0.5" \
  -e "end repeat" \
  -e "try" \
  -e "  do shell script \"open -a 'Google Chrome' http://localhost:$PORT\"" \
  -e "on error" \
  -e "  open location \"http://localhost:$PORT\"" \
  -e "end try"
# Flower icon (built from assets/icon.png with the Mac's own tools).
if [ -f "$APP_DIR/assets/icon.png" ]; then
  ICONSET="$TMP/Jarvis.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$APP_DIR/assets/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1 || true
    d=$((s * 2))
    sips -z $d $d "$APP_DIR/assets/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
  done
  if iconutil -c icns "$ICONSET" -o "$LAUNCHER/Contents/Resources/applet.icns" >/dev/null 2>&1; then
    touch "$LAUNCHER"
  fi
fi
ln -sfn "$LAUNCHER" "$HOME/Desktop/Jarvis" 2>/dev/null || true   # macOS may block Desktop access; the app is still in Launchpad

# Wait for Jarvis to answer, then open it.
for _ in $(seq 1 30); do
  curl -fs -o /dev/null "http://localhost:$PORT/api/state" && break
  sleep 0.5
done
open "$LAUNCHER"

printf "\n\033[1;32m✅ All done! Jarvis is open in your browser.\033[0m\n"
printf "   Next time, just double-click \033[1mJarvis\033[0m on your Desktop (or find it in Launchpad).\n"
if [ ! -d "/Applications/Google Chrome.app" ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  printf "   Tip: talking to Jarvis works best in Google Chrome: https://www.google.com/chrome\n"
fi
printf "   You can close this Terminal window now. 🌷\n\n"
