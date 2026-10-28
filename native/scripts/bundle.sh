#!/bin/sh
# Build the native app and wrap it as native/build/Paseo Command.app.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
config=${1:-release}
cd "$here"
swift build -c "$config"
bin=$(swift build -c "$config" --show-bin-path)
app="$here/build/Paseo Command.app"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$bin/PaseoCommandNative" "$app/Contents/MacOS/PaseoCommandNative"
cp "$here/Info.plist" "$app/Contents/Info.plist"
codesign --force --sign - "$app" >/dev/null 2>&1
echo "$app"
