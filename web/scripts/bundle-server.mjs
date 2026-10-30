// Bundles the app server (web/server/native.ts) into one file the packaged
// app runs with its own Node, so no checkout or node_modules is needed.
import { build } from "esbuild";
import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// ws's optional native add-ons; it falls back to JS when they're absent.
const optional = ["bufferutil", "utf-8-validate"];

const result = await build({
  entryPoints: [resolve(web, "server/native.ts")],
  outfile: resolve(web, "dist-server/server.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: optional,
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  logLevel: "warning",
  metafile: true,
});

// Anything left external beyond the optional add-ons and node builtins would
// fail at runtime in the packaged app.
const stray = Object.values(result.metafile.outputs)
  .flatMap((o) => o.imports)
  .filter((i) => i.external)
  .map((i) => i.path)
  .filter((p) => !isBuiltin(p) && !optional.includes(p));
if (stray.length) {
  console.error(`Unbundled imports: ${[...new Set(stray)].join(", ")}`);
  process.exit(1);
}
