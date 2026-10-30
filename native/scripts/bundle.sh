#!/bin/sh
# Build the native app with its own Node, server and page.
#   sh native/scripts/bundle.sh             native/build/Paseo Command Dev.app (port 4321, ad-hoc signed)
#   sh native/scripts/bundle.sh --release   native/release/Paseo Command.app (port 4310, signed as
#                                           "Paseo Command Release", updating itself with Sparkle)
# The release goes to its own folder so it never replaces the old checkout app, which some
# checkouts still have at native/build/Paseo Command.app.
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
  # Sparkle installs only updates signed by the key whose public half is here.
  if [ -z "$(/usr/libexec/PlistBuddy -c "Print :SUPublicEDKey" "$here/Info.plist" 2>/dev/null)" ]; then
    echo "No SUPublicEDKey in native/Info.plist. Run npm run release:setup first." >&2
    exit 1
  fi
  if ! security find-identity -p codesigning | grep -q "\"$identity\""; then
    echo "No \"$identity\" signing identity in the login keychain. Run npm run release:setup first." >&2
    exit 1
  fi
  name="Paseo Command"; id=io.github.owenconti.paseo-command; port=4310; out=release
else
  identity=-
  name="Paseo Command Dev"; id=io.github.owenconti.paseo-command.dev; port=4321; out=build
fi
cd "$here"
[ -f "$root/web/dist/index.html" ] || { echo "Missing web/dist: run npm run app:build first." >&2; exit 1; }
[ -f "$root/web/dist-server/server.mjs" ] || { echo "Missing web/dist-server/server.mjs: run npm run app:bundle-server first." >&2; exit 1; }
node scripts/theme.mjs --check
swift build -c "$config"
bin=$(swift build -c "$config" --show-bin-path)
node_bin=$(node scripts/fetch-node.mjs)
app="$here/$out/$name.app"
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
if [ "$flavour" = release ]; then
  buddy "Add :SUFeedURL string https://github.com/owenconti/paseo-command/releases/latest/download/appcast.xml"
  buddy "Add :SUEnableAutomaticChecks bool true"
  buddy "Add :SUAutomaticallyUpdate bool true"
  buddy "Add :SUScheduledCheckInterval integer 3600"
else
  # Dev copies never update themselves (Updater.shared is nil).
  buddy "Delete :SUPublicEDKey"
fi
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
# Sparkle's framework, its symlinks kept (ditto), where the executable's rpath looks.
mkdir -p "$app/Contents/Frameworks"
rm -rf "$app/Contents/Frameworks/Sparkle.framework"
ditto "$bin/Sparkle.framework" "$app/Contents/Frameworks/Sparkle.framework"
# Signed inside out, without --deep: Node, Sparkle's helpers then Sparkle (as Sparkle's
# docs sign it outside Xcode), then the app. codesign's own output is kept for a failure.
sign() {
  target=$1; shift
  if ! log=$(codesign --force --sign "$identity" "$@" "$target" 2>&1); then
    echo "codesign failed for $target:" >&2
    echo "$log" >&2
    exit 1
  fi
}
sign "$app/Contents/Resources/node/node"
sparkle="$app/Contents/Frameworks/Sparkle.framework/Versions/B"
sign "$sparkle/XPCServices/Installer.xpc" -o runtime
sign "$sparkle/XPCServices/Downloader.xpc" -o runtime --preserve-metadata=entitlements
sign "$sparkle/Autoupdate" -o runtime
sign "$sparkle/Updater.app" -o runtime
sign "$app/Contents/Frameworks/Sparkle.framework" -o runtime
sign "$app"
echo "$app"
