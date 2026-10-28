/**
 * The app's real server (its API, live socket and terminal relay) in front of
 * a fake daemon (`web/server/fake-daemon.ts`), serving the built page: for
 * checking the macOS app end to end without any real daemon. A terminal
 * opened here echoes what it is typed, with a prompt.
 *
 *   web/node_modules/.bin/tsx --import ./web/server/test-setup.ts native/scripts/fake-server.ts [--port 4332]
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { fleet, install } from "../../web/server/fake-daemon.ts";
import { handleApi, handleUpgrade } from "../../web/server/api.ts";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1] || 4332);
const dist = fileURLToPath(new URL("../../web/dist/", import.meta.url));

const { network, local } = fleet();
install(network);
local.addProject({ projectId: "prj_atlas", path: "/home/review/atlas", name: "atlas" });
local.addWorkspace({ id: "wks_main", projectId: "prj_atlas", cwd: "/home/review/atlas", name: "main" });
local.addWorkspace({ id: "wks_map", projectId: "prj_atlas", cwd: "/home/review/atlas-map", name: "map-polish" });
local.addAgent({ id: "a-1", cwd: "/home/review/atlas", workspaceId: "wks_main", provider: "claude", model: "claude-opus-5-5", status: "running" } as never);
local.addAgent({ id: "a-2", cwd: "/home/review/atlas-map", workspaceId: "wks_map", provider: "codex", status: "idle" } as never);
// A terminal already open in the first workspace, with something on screen.
local.terminals.set("term-pre", {
  id: "term-pre",
  name: "Terminal 1",
  cwd: "/home/review/atlas",
  workspaceId: "wks_main",
  printed: "\x1b[1;32mreview@atlas\x1b[0m:\x1b[34m~/atlas\x1b[0m$ npm test\r\n\x1b[32m✔\x1b[0m 41 passing\r\n\x1b[1;32mreview@atlas\x1b[0m:\x1b[34m~/atlas\x1b[0m$ ",
  input: [],
  watchers: new Set(),
});

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
};
const server = createServer((req, res) => {
  void handleApi(req, res, () => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let file = normalize(join(dist, decodeURIComponent(url.pathname)));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
    res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
    createReadStream(file).pipe(res);
  });
});
server.on("upgrade", (req, socket, head) => {
  if (!handleUpgrade(req, socket, head)) socket.destroy();
});
server.listen(port, "127.0.0.1", () => console.log(`Fake-daemon app server at http://127.0.0.1:${port}/`));
