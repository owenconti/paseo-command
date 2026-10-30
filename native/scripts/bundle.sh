#!/bin/sh
# Build the native app into native/build/Paseo Command.app. A running copy
# keeps running: the new executable replaces the old one's file, and Restart app in
# the command palette swaps to it (see main.swift's `reload`).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
config=${1:-release}
cd "$here"
swift build -c "$config"
bin=$(swift build -c "$config" --show-bin-path)
app="$here/build/Paseo Command.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$here/Info.plist" "$app/Contents/Info.plist"
cp "$here/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
cp "$here/../LICENSE" "$here/../THIRD_PARTY_NOTICES.md" "$app/Contents/Resources/"
# The splash's lettering: the page's own header and body fonts.
cp "$here/../web/src/themes/fonts/paseo-barlow-600.woff2" "$here/../web/src/themes/fonts/paseo-source-sans-400.woff2" "$app/Contents/Resources/"
# Replaced, not overwritten: a running copy keeps its own executable.
cp "$bin/PaseoCommandNative" "$app/Contents/MacOS/.PaseoCommandNative.new"
mv -f "$app/Contents/MacOS/.PaseoCommandNative.new" "$app/Contents/MacOS/PaseoCommandNative"
codesign --force --sign - "$app" >/dev/null 2>&1
echo "$app"
