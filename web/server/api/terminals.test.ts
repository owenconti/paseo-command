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
