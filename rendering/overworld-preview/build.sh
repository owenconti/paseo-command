#!/bin/sh
# Builds the Overworld preview bundle (uses the main checkout's esbuild). The app's module reads its sheets
# through Vite's import.meta.glob; the preview loads them itself, so the bundle stubs it.
cd "$(dirname "$0")" && "${ESBUILD:-../../web/node_modules/.bin/esbuild}" main.ts --bundle --format=esm --outfile=main.js --log-level=warning \
  --banner:js='import.meta.glob = () => ({});'
