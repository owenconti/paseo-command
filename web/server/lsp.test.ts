import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { fleet, install, register, serve } from "./fake-daemon";
import { LSP, LSP_DEPS, lspFailure } from "./lsp";

// Only fake daemons; the language-servers plugin is faked too (LSP_DEPS.invoke).
const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
let server: Awaited<ReturnType<typeof serve>>;
const real = LSP_DEPS.invoke;

type Call = { host: string; method: string; input: any };
const calls: Call[] = [];
/** A fake plugin: one session per start, echoing each message sent as a server message, ending on "exit". */
function fakePlugin(options: { refuse?: string } = {}) {
  const sessions = new Map<string, { out: { seq: number; text: string }[]; seq: number; alive: boolean; wake?: () => void; seen: Set<string> }>();
  let n = 0;
  LSP_DEPS.invoke = async (ws, method, input: any) => {
    calls.push({ host: ws.key.split("|")[0], method, input });
    if (options.refuse) throw new Error(options.refuse);
    if (method === "lsp.start") {
      const session = (++n).toString(16).padStart(24, "0");
      sessions.set(session, { out: [], seq: 0, alive: true, seen: new Set() });
      return { session, rootUri: `file://${input.cwd}`, server: { name: "fake-ls", path: "/bin/fake-ls" } };
    }
    const s = sessions.get(input.session);
    if (!s) throw new Error("That language server session has ended.");
    if (method === "lsp.send") {
      for (const text of input.messages) {
        const msg = JSON.parse(text);
        if (msg.method === "exit") s.alive = false;
        else {
          const reply = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { uri: "file:///lib/types.d.ts", echo: msg.method } });
          s.seen.add("file:///lib/types.d.ts");
          s.out.push({ seq: ++s.seq, text: reply });
        }
      }
      s.wake?.();
      return { ok: true };
    }
    if (method === "lsp.poll") {
      if (!s.out.some((m) => m.seq > input.after) && s.alive) await new Promise<void>((r) => ((s.wake = r), setTimeout(r, Math.min(input.waitMs, 200))));
      const messages = s.out.filter((m) => m.seq > input.after);
      return s.alive ? { messages, alive: true } : { messages, alive: false, exit: { code: 0, signal: null, stderr: "bye\n", reason: "The language server quit." } };
    }
    if (method === "lsp.read") {
      if (!s.seen.has(input.uri)) throw new Error("That file wasn't named by the language server.");
      return { text: "export type T = 1;\n" };
    }
    if (method === "lsp.stop") {
      s.alive = false;
      s.wake?.();
      return { ok: true };
    }
    throw new Error(`Unknown method ${method}`);
  };
}

before(async () => {
  uninstall = install(network);
  local.addProject({ projectId: "prj_app", path: "/home/review/code" });
  local.addWorkspace({ id: "wks_app", projectId: "prj_app", cwd: "/home/review/code/wt", branch: "feature" });
  remote.addProject({ projectId: "prj_far", path: "/srv/far" });
  remote.addWorkspace({ id: "wks_far", projectId: "prj_far", cwd: "/srv/far" });
  server = await serve();
});
after(async () => {
  LSP_DEPS.invoke = real;
  await server?.close();
  uninstall();
  setTimeout(() => process.exit(0), 50).unref();
});

/** The Files tab's socket, as the page opens it; its frames as they come. */
function open(query: string, origin = server.url) {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}${LSP.path}?${query}`, { headers: { origin } });
  const frames: any[] = [];
  const waiters: (() => void)[] = [];
  ws.on("message", (raw) => {
    frames.push(JSON.parse(String(raw)));
    waiters.splice(0).forEach((w) => w());
  });
  const next = async (type: string) => {
    for (let i = 0; i < 100; i++) {
      const at = frames.findIndex((f) => f.type === type);
      if (at >= 0) return frames.splice(at, 1)[0];
      await new Promise<void>((r) => (waiters.push(r), setTimeout(r, 50)));
    }
    throw new Error(`No ${type} frame: ${JSON.stringify(frames)}`);
  };
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  return { ws, next, closed, send: (frame: unknown) => ws.send(JSON.stringify(frame)) };
}

test("a workspace's language server, relayed both ways; messages sent before it starts are kept", async () => {
  fakePlugin();
  calls.length = 0;
  const s = open("workspace=wks_app&group=typescript");
  await new Promise((r) => s.ws.on("open", r));
  s.send({ type: "send", data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  assert.deepEqual(await s.next("ready"), { type: "ready", root: "/home/review/code/wt", server: "fake-ls" });
  const first = JSON.parse((await s.next("recv")).data);
  assert.deepEqual(first, { jsonrpc: "2.0", id: 1, result: { uri: "file:///lib/types.d.ts", echo: "initialize" } });
  s.send({ type: "send", data: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "textDocument/definition", params: {} }) });
  assert.equal(JSON.parse((await s.next("recv")).data).result.echo, "textDocument/definition");
  assert.deepEqual(calls.find((c) => c.method === "lsp.start")!.input, { cwd: "/home/review/code/wt", group: "typescript" });

  // A file outside the workspace that the server named, read through the plugin; one it didn't, refused.
  s.send({ type: "read", id: 7, uri: "file:///lib/types.d.ts" });
  assert.deepEqual(await s.next("read"), { type: "read", id: 7, text: "export type T = 1;\n" });
  s.send({ type: "read", id: 8, uri: "file:///etc/passwd" });
  assert.match((await s.next("read")).error, /wasn't named/);

  // The server quits: the page is told why, and the socket closes.
  s.send({ type: "send", data: JSON.stringify({ jsonrpc: "2.0", method: "exit" }) });
  assert.match((await s.next("ended")).reason, /quit\. bye/);
  await s.closed;
});

test("a remote host's workspace uses that host's plugin; closing the socket stops its server", async () => {
  fakePlugin();
  calls.length = 0;
  const s = open("workspace=wks_far&host=srv_remote&group=go");
  assert.equal((await s.next("ready")).root, "/srv/far");
  assert.equal(calls[0].host, "srv_remote");
  s.ws.close();
  for (let i = 0; i < 60 && !calls.some((c) => c.method === "lsp.stop"); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(calls.some((c) => c.method === "lsp.stop" && c.host === "srv_remote"));
});

test("no plugin, an unknown language or workspace: the page is told why", async () => {
  fakePlugin({ refuse: "Plugin not found: language-servers" });
  let s = open("workspace=wks_app&group=typescript");
  assert.match((await s.next("ended")).reason, /no language-servers plugin/);
  fakePlugin();
  s = open("workspace=wks_app&group=cobol");
  assert.match((await s.next("ended")).reason, /Unknown language/);
  s = open("workspace=wks_nope&group=typescript");
  assert.match((await s.next("ended")).reason, /Unknown workspace/);
});

test("the relay refuses another origin", async () => {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}${LSP.path}?workspace=wks_app&group=typescript`, { headers: { origin: "http://evil.example" } });
  const status = await new Promise<number | undefined>((r) => ws.on("unexpected-response", (_req, res) => r(res.statusCode)).on("error", () => r(undefined)));
  assert.equal(status, 403);
});

test("plugin failures read plainly", () => {
  assert.match(lspFailure(new Error("Plugin language-servers is not running")), /no language-servers plugin/);
  assert.equal(lspFailure(new Error("boom")), "boom");
});
