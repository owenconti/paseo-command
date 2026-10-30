#!/bin/sh
# Build the native app with its own Node, server and page.
#   sh native/scripts/bundle.sh             native/build/Paseo Command Dev.app (port 4321, ad-hoc signed)
#   sh native/scripts/bundle.sh --release   native/build/Paseo Command.app (port 4310, signed as
#                                           "Paseo Command Release")
# Needs web/dist (npm run app:build) and web/dist-server/server.mjs (npm run app:bundle-server).
# A running copy keeps running: the new executable replaces the old one's file, and Restart app in
# the command palette swaps to it (see main.swift's `reload`).
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$here/.." && pwd)
config=release
case "${1:-}" in
  "") flavour=dev ;;
  --release) flavour=release ;;
  *) echo "usage: bundle.sh [--release]" >&2; exit 2 ;;
esac
if [ "$flavour" = release ]; then
  identity="Paseo Command Release"
  if ! security find-identity -p codesigning | grep -q "\"$identity\""; then
    echo "No \"$identity\" signing identity in the login keychain. Run npm run release:setup first." >&2
    exit 1
  fi
  name="Paseo Command"; id=io.github.owenconti.paseo-command; port=4310
else
  identity=-
  name="Paseo Command Dev"; id=io.github.owenconti.paseo-command.dev; port=4321
fi
cd "$here"
[ -f "$root/web/dist/index.html" ] || { echo "Missing web/dist: run npm run app:build first." >&2; exit 1; }
[ -f "$root/web/dist-server/server.mjs" ] || { echo "Missing web/dist-server/server.mjs: run npm run app:bundle-server first." >&2; exit 1; }
node scripts/theme.mjs --check
swift build -c "$config"
bin=$(swift build -c "$config" --show-bin-path)
node_bin=$(node scripts/fetch-node.mjs)
app="$here/build/$name.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/node" "$app/Contents/Resources/server"
cp "$here/Info.plist" "$app/Contents/Info.plist"
plist="$app/Contents/Info.plist"
version=$(node -p "require('$root/package.json').version")
build=$(git -C "$root" rev-list --count HEAD)
buddy() { /usr/libexec/PlistBuddy -c "$1" "$plist"; }
buddy "Set :CFBundleIdentifier $id"
buddy "Set :CFBundleName $name"
buddy "Set :CFBundleDisplayName $name"
buddy "Set :CFBundleShortVersionString $version"
buddy "Set :CFBundleVersion $build"
buddy "Add :PaseoCommandFlavor string $flavour"
buddy "Add :PaseoCommandPort string $port"
cp "$here/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"
cp "$here/../LICENSE" "$here/../THIRD_PARTY_NOTICES.md" "$app/Contents/Resources/"
# The splash's lettering: the page's own header and body fonts.
cp "$here/../web/src/themes/fonts/paseo-barlow-600.woff2" "$here/../web/src/themes/fonts/paseo-source-sans-400.woff2" "$app/Contents/Resources/"
# Conquer uses the React panel's body fonts in native controls too.
cp "$here/../web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2" "$app/Contents/Resources/"
# The server finds its page at ../ui. Node is replaced like the executable below, as a running
# copy's server is that file.
cp "$node_bin" "$app/Contents/Resources/node/.node.new"
mv -f "$app/Contents/Resources/node/.node.new" "$app/Contents/Resources/node/node"
cp "$root/web/dist-server/server.mjs" "$app/Contents/Resources/server/server.mjs"
rm -rf "$app/Contents/Resources/ui"
cp -R "$root/web/dist" "$app/Contents/Resources/ui"
# Replaced, not overwritten: a running copy keeps its own executable.
cp "$bin/PaseoCommandNative" "$app/Contents/MacOS/.PaseoCommandNative.new"
mv -f "$app/Contents/MacOS/.PaseoCommandNative.new" "$app/Contents/MacOS/PaseoCommandNative"
# Signed inside out: Node, (Sparkle goes here once it is bundled,) then the app.
codesign --force --sign "$identity" "$app/Contents/Resources/node/node" >/dev/null 2>&1
codesign --force --sign "$identity" "$app" >/dev/null 2>&1
echo "$app"
