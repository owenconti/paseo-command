#!/bin/sh
# Builds the Overworld preview bundle (uses the main checkout's esbuild).
cd "$(dirname "$0")" && "${ESBUILD:-../../web/node_modules/.bin/esbuild}" main.ts --bundle --format=esm --outfile=main.js --log-level=warning
