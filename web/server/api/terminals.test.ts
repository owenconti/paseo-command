import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { fleet, get, install, post, register, serve, until } from "../fake-daemon";
import { snapshotBytes } from "./terminals";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
let server: Awaited<ReturnType<typeof serve>>;
before(async () => {
  uninstall = install(network);
  local.addProject({ projectId: "prj_app", path: "/home/review/code" });
  local.addWorkspace({ id: "wks_app", projectId: "prj_app", cwd: "/home/review/code" });
  remote.addProject({ projectId: "prj_far", path: "/srv/far" });
  remote.addWorkspace({ id: "wks_far", projectId: "prj_far", cwd: "/srv/far" });
  server = await serve();
});
after(async () => {
  await server?.close();
  uninstall();
  // The API keeps live connections and timers; nothing else runs here.
  setTimeout(() => process.exit(0), 50).unref();
});

/** A terminal's socket, as the macOS app opens it: same-origin, binary out. */
async function attach(terminalId: string, host = "") {
  const origin = server.url;
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/api/terminal?id=${terminalId}${host ? `&host=${host}` : ""}`, {
    headers: { origin },
  });
  let received = "";
  let closed: string | null = null;
  ws.on("message", (data, binary) => binary && (received += Buffer.from(data as Buffer).toString("utf8")));
  ws.on("close", (_code, reason) => (closed = String(reason)));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  return { ws, text: () => received, closed: () => closed };
}

test("a workspace's terminals: listed, created in its folder, ended", async () => {
  const empty = await get("terminals?workspace=wks_app");
  assert.equal(empty.status, 200, JSON.stringify(empty.data));
  assert.deepEqual(empty.data, { cwd: "/home/review/code", terminals: [] });
  const made = await post("terminals/create", { workspace: "wks_app", rows: 30, cols: 100 });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const created = local.calls.find((c) => c.method === "createTerminal")!;
  assert.deepEqual(created.args, ["/home/review/code", { workspaceId: "wks_app", size: { rows: 30, cols: 100 } }]);
  const listed = await get("terminals?workspace=wks_app");
  assert.deepEqual(listed.data.terminals.map((t: { id: string }) => t.id), [made.data.terminal.id]);
  const ended = await post("terminals/kill", { id: made.data.terminal.id });
  assert.equal(ended.status, 200, JSON.stringify(ended.data));
  assert.deepEqual((await get("terminals?workspace=wks_app")).data.terminals, []);
});

test("only a workspace the fleet lists is opened, on its own host", async () => {
  assert.equal((await get("terminals?workspace=wks_none")).status, 400);
  // The remote's workspace isn't the local daemon's.
  assert.equal((await get("terminals?workspace=wks_far")).status, 400);
  const far = await get("terminals?workspace=wks_far&host=srv_remote");
  assert.equal(far.status, 200, JSON.stringify(far.data));
  assert.equal(far.data.cwd, "/srv/far");
  assert.equal((await post("terminals/create", { workspace: "wks_far", host: "srv_remote" })).status, 200);
  assert.ok(remote.calls.some((c) => c.method === "createTerminal"));
});

test("the relay replays the screen, then carries output, keys and resizes", async () => {
  const { data } = await post("terminals/create", { workspace: "wks_app" });
  const terminalId = data.terminal.id;
  local.print(terminalId, "hello\r\n$ ");
  const t = await attach(terminalId);
  await until(() => t.text().includes("hello"), 3000, "the replayed screen");
  t.ws.send(JSON.stringify({ type: "input", data: "ls\r" }));
  await until(() => t.text().endsWith("ls\r"), 3000, "the echoed keys");
  t.ws.send(JSON.stringify({ type: "resize", rows: 40, cols: 120 }));
  await until(
    () => local.terminals.get(terminalId)!.input.some((m) => m.type === "resize" && m.rows === 40 && m.cols === 120),
    3000,
    "the resize",
  );
  // Malformed messages go nowhere.
  t.ws.send("not json");
  t.ws.send(JSON.stringify({ type: "resize", rows: -1, cols: 5 }));
  // The terminal ends: its socket closes.
  await post("terminals/kill", { id: terminalId });
  await until(() => t.closed() !== null, 3000, "the socket to close");
  assert.equal(local.terminals.get(terminalId), undefined);
});

test("an editor terminal: Settings → Files' command on the file, in the workspace, quoted", async () => {
  const saved = await post("settings", { files: { openIn: "editor", editorCommand: "nvim +{line} {file}" } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.deepEqual(saved.data.files, { openIn: "editor", editorCommand: "nvim +{line} {file}" });
  assert.deepEqual((await get("settings")).data.files, { openIn: "editor", editorCommand: "nvim +{line} {file}" });
  local.calls.length = 0;
  const made = await post("terminals/editor", { workspace: "wks_app", path: "src/it's $(x).ts", line: 12, rows: 30, cols: 90 });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  const created = local.calls.find((c) => c.method === "createTerminal")!;
  assert.deepEqual(created.args, [
    "/home/review/code",
    {
      workspaceId: "wks_app",
      command: "/bin/sh",
      args: ["-c", 'exec "${SHELL:-/bin/sh}" -l -i -c "$1"', "paseo-editor", "nvim +12 'src/it'\\''s $(x).ts'"],
      size: { rows: 30, cols: 90 },
    },
  ]);
  assert.equal(made.data.terminal.name, "nvim · it's $(x).ts");
  // Listed with the workspace's terminals; it ends when the editor quits (":q" in the fake).
  const id = made.data.terminal.id;
  // Listed as an editor's, which the terminal panel leaves out of its tabs.
  assert.ok((await get("terminals?workspace=wks_app")).data.terminals.some((t: { id: string; editor?: boolean }) => t.id === id && t.editor === true));
  const t = await attach(id);
  await until(() => t.text().includes("nvim +12"), 3000, "the editor's screen");
  t.ws.send(JSON.stringify({ type: "input", data: ":q\r" }));
  await until(() => t.closed() !== null, 3000, "the socket to close as the editor quits");
  assert.equal(t.closed(), "The terminal ended");
  assert.equal(local.terminals.get(id), undefined);
});

test("an editor terminal: never a path out of the workspace, nor a command from the request", async () => {
  for (const path of ["/etc/passwd", "../up", "a/../../b", "~/x", "a\\b", "", "a\u0000b"]) {
    const r = await post("terminals/editor", { workspace: "wks_app", path });
    assert.equal(r.status, 400, `${path}: ${JSON.stringify(r.data)}`);
  }
  assert.equal((await post("terminals/editor", { workspace: "wks_app", path: "a", line: "1; rm" })).status, 400);
  assert.equal((await post("terminals/editor", { workspace: "wks_none", path: "a" })).status, 400);
  // The request's own command is ignored: only the settings file's runs.
  local.calls.length = 0;
  const r = await post("terminals/editor", { workspace: "wks_app", path: "a.ts", command: "rm -rf ~", editorCommand: "rm {file}" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(local.calls.find((c) => c.method === "createTerminal")!.args[1].args[3], "nvim +1 'a.ts'");
  // A bad command is never saved.
  for (const editorCommand of ["nvim", 'nvim "{file}"', "nvim {file}\nrm x", 5]) {
    assert.equal((await post("settings", { files: { editorCommand } })).status, 400, String(editorCommand));
  }
  assert.equal((await post("settings", { files: { openIn: "emacs" } })).status, 400);
  // Saving one key keeps the other.
  assert.equal((await post("settings", { files: { openIn: "viewer" } })).data.files.editorCommand, "nvim +{line} {file}");
});

test("the relay refuses another origin", async () => {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}/api/terminal?id=term-1`, {
    headers: { origin: "http://evil.example" },
  });
  const status = await new Promise<number>((resolve) => ws.once("unexpected-response", (_req, res) => resolve(res.statusCode!)));
  assert.equal(status, 403);
});

test("a cell snapshot becomes the bytes that draw it", () => {
  const bytes = snapshotBytes({
    scrollback: [[{ char: "a" }]],
    grid: [[{ char: "b", fg: 1, bold: true }, { char: "c", bg: 200, bgMode: 1 }]],
    cursor: { row: 0, col: 2 },
  }).toString("utf8");
  assert.ok(bytes.startsWith("\x1b[0m\x1b[2J"));
  assert.ok(bytes.includes("\x1b[0;1;31mb"), JSON.stringify(bytes));
  assert.ok(bytes.includes("\x1b[0;48;5;200mc"), JSON.stringify(bytes));
  assert.ok(bytes.endsWith("\x1b[1;3H"));
});
