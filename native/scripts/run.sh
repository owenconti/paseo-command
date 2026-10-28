#!/bin/sh
# Open the native app without taking focus. Arguments go to the app, e.g.
#   npm run native:run -- --url http://127.0.0.1:4331/
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
app="$here/build/Paseo Command.app"
[ -d "$app" ] || sh "$here/scripts/bundle.sh"
open -g -n "$app" --args "$@"
