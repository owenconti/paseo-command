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
// The idle agent's conversation, for the chat (the panel's, and the Dungeon Board's with `?map=dungeon`): a reply
// to pick pieces of, fork, answer and /clear.
local.pushTimeline("a-2", { type: "user_message", text: "Polish the map's shoreline", messageId: "u1" });
local.pushTimeline("a-2", {
  type: "assistant_message",
  messageId: "r1",
  text: "I redrew the shoreline with the hex-edged tiles.\n\nThe banks keep their soft shadow, and the glints drift as before.\n\nShall I open the pull request now?",
});
// The first workspace's files, for the Files tab (a .gitignore, an ignored folder, a long file, a binary one).
local.trees.set(
  "/home/review/atlas",
  new Map<string, string | Uint8Array | "dir" | "outside">([
    [".gitignore", "node_modules/\ndist/\n*.log\n"],
    [".git/HEAD", "ref: refs/heads/main\n"],
    ["README.md", "# Atlas\n\nThe fleet, drawn as islands.\n"],
    ["package.json", '{\n  "name": "atlas",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n'],
    ["src/index.ts", 'import { layout } from "./layout";\n\nexport function main(): void {\n  const world = layout({ hosts: 3 });\n  console.log(`${world.islands.length} islands`);\n}\n'],
    ["src/layout.ts", Array.from({ length: 4000 }, (_, i) => `export const cell${i} = { q: ${i % 40}, r: ${Math.floor(i / 40)} };`).join("\n") + "\n"],
    ["src/styles/world.css", ".world {\n  background: #2b6cb0;\n}\n"],
    ["debug.log", "noise\n"],
    ["node_modules/left-pad/index.js", "module.exports = (s) => s;\n"],
    ["art/logo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1])],
    ["art/tiles.bin", new Uint8Array([1, 0, 2, 0])],
  ]),
);
// The first workspace's branch against main, for the Files tab's Changes: one file committed, one not yet.
const hunk = (lines: [string, string][]) => ({
  oldStart: 1,
  oldCount: lines.filter(([t]) => t !== "add").length,
  newStart: 1,
  newCount: lines.filter(([t]) => t !== "remove").length,
  lines: [{ type: "header", content: "@@" }, ...lines.map(([type, content]) => ({ type, content, tokens: [{ text: content, style: null }] }))],
});
const diffOf = (path: string, lines: [string, string][]) => ({
  path,
  isNew: false,
  isDeleted: false,
  additions: lines.filter(([t]) => t === "add").length,
  deletions: lines.filter(([t]) => t === "remove").length,
  status: "ok",
  hunks: [hunk(lines)],
});
const indexDiff = diffOf("src/index.ts", [
  ["context", 'import { layout } from "./layout";'],
  ["context", ""],
  ["context", "export function main(): void {"],
  ["remove", "  const world = layout({ hosts: 2 });"],
  ["add", "  const world = layout({ hosts: 3 });"],
  ["context", "  console.log(`${world.islands.length} islands`);"],
]);
const cssDiff = diffOf("src/styles/world.css", [
  ["context", ".world {"],
  ["remove", "  background: #2c5282;"],
  ["add", "  background: #2b6cb0;"],
  ["context", "}"],
]);
local.checkouts.set("/home/review/atlas", {
  diffs: { all: [indexDiff, cssDiff], base: [indexDiff], uncommitted: [cssDiff] },
  status: { currentBranch: "main", baseRef: "origin/main", aheadBehind: { ahead: 1, behind: 0 }, isDirty: true },
});
// A terminal already open in the first workspace, with something on screen: a test's result, then Nerd Font
// icons (private use: a folder, Rust, JavaScript, a Material note, a git branch) beside a wide character and an emoji.
local.terminals.set("term-pre", {
  id: "term-pre",
  name: "Terminal 1",
  cwd: "/home/review/atlas",
  workspaceId: "wks_main",
  // Queries in what it replays (DA1, cursor position, background colour, DA2, XTVERSION), answered long ago:
  // the app answers none of them again. Typing `queries` asks them live; `nvim`, then `:q`, asks as it quits.
  printed: "\x1b[1;32mreview@atlas\x1b[0m:\x1b[34m~/atlas\x1b[0m$ npm test\r\n\x1b[32m✔\x1b[0m 41 passing\r\n\uf115 src  \ue7a8 main.rs  \ue718 app.js  \u{f0219} notes  \ue0a0 main  漢 😀\r\n\x1b[c\x1b[6n\x1b]11;?\x07\x1b[>c\x1b[>q\x1b[1;32mreview@atlas\x1b[0m:\x1b[34m~/atlas\x1b[0m$ ",
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
/** A page for the board's browser to open and an agent's tools to drive (`/__page`). */
const TEST_PAGE = `<!doctype html><html><head><title>Fake preview</title><style>body{font:16px system-ui;margin:32px}button,input{font:inherit;padding:6px 10px}</style></head>
<body><h1>Fake preview</h1><p>A page served by the fake server.</p>
<label for="name">Name</label> <input id="name" placeholder="Your name">
<button id="greet">Greet</button> <a href="/__page?next=1">Next page</a>
<p id="out" aria-live="polite"></p>
<script>document.getElementById('greet').addEventListener('click', () => { document.getElementById('out').textContent = 'Hello, ' + (document.getElementById('name').value || 'stranger') + '!'; console.log('greeted'); });</script>
</body></html>`;
const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/__page") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    return void res.end(TEST_PAGE);
  }
  // `POST /__browser {command, args?, agentId?, workspaceId?, cwd?}`: an agent's browser tool call, as the fake
  // daemon's broker sends it to the registered browser host (the app, with Settings → Map on); answers with the
  // host's response (checks of the board's browser end to end).
  if (path === "/__browser" && req.method === "POST") {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: { command?: string; args?: Record<string, unknown>; agentId?: string; workspaceId?: string; cwd?: string } = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        // Answered as an unknown command.
      }
      const { command = "", args, ...from } = body;
      void local.browserExecute({ command, args }, { agentId: "a-2", workspaceId: "wks_map", cwd: "/home/review/atlas-map", ...from }).then((answer) => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(answer));
      });
    });
    return;
  }
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
