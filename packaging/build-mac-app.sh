#!/bin/bash
# Builds dist/Jarvis-mac.zip containing Jarvis.app (a small launcher; see packaging/mac/launcher.sh).
# Runs on Mac or Linux. Needs: python3 with Pillow (for the icon), zip.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
OUT="dist/build/Jarvis.app"
rm -rf dist/build
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

cp packaging/mac/launcher.sh "$OUT/Contents/MacOS/Jarvis"
chmod 755 "$OUT/Contents/MacOS/Jarvis"
cp install.sh "$OUT/Contents/Resources/install.sh"
python3 -c "from PIL import Image; Image.open('assets/icon.png').save('$OUT/Contents/Resources/Jarvis.icns', sizes=[(16,16),(32,32),(64,64),(128,128),(256,256),(512,512),(1024,1024)])"

cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Jarvis</string>
  <key>CFBundleDisplayName</key><string>Jarvis</string>
  <key>CFBundleIdentifier</key><string>com.prjarvis.app</string>
  <key>CFBundleExecutable</key><string>Jarvis</string>
  <key>CFBundleIconFile</key><string>Jarvis</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.productivity</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# (If you have an Apple Developer ID, sign and notarize here so Macs open it without a warning:
#   codesign --deep --force --options runtime --sign "Developer ID Application: …" "$OUT"
#   xcrun notarytool submit … --wait && xcrun stapler staple "$OUT")

rm -f dist/Jarvis-mac.zip
(cd dist/build && zip -qry -X ../Jarvis-mac.zip Jarvis.app)
rm -rf dist/build
echo "Built dist/Jarvis-mac.zip (Jarvis $VERSION)"
