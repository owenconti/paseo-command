/**
 * The macOS app as a Paseo browser host: registered on each followed daemon only
 * while the app's socket is open, agents' browser calls relayed to it and its
 * answers back to the daemon that asked. Fake daemons only.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { fleet, install, register, serve, until } from "./fake-daemon";
import { BROWSER_HOST, browserHostState } from "./browserHost";

const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
let server: Awaited<ReturnType<typeof serve>>;
before(async () => {
  uninstall = install(network);
  server = await serve();
});
after(async () => {
  await server?.close();
  uninstall();
  setTimeout(() => process.exit(0), 50).unref();
});

const COMMANDS = ["list_tabs", "new_tab", "navigate", "close_tab"];
/** The app's socket: what it was sent, and a way to answer. */
async function app(commands: string[] = COMMANDS, origin = server.url) {
  const ws = new WebSocket(`${server.url.replace("http", "ws")}${BROWSER_HOST.path}`, { headers: { origin } });
  const messages: any[] = [];
  let closed: string | null = null;
  ws.on("message", (data) => messages.push(JSON.parse(String(data))));
  ws.on("close", (_code, reason) => (closed = String(reason)));
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", commands }));
  return {
    ws,
    messages,
    closed: () => closed,
    requests: () => messages.filter((m) => m.type === "request"),
    hosts: () => messages.filter((m) => m.type === "hosts").at(-1)?.hosts as { host: string; state: string }[] | undefined,
    answer: (payload: unknown) => ws.send(JSON.stringify({ type: "response", payload })),
    close: () => new Promise<void>((resolve) => (ws.once("close", () => resolve()), ws.close())),
  };
}
const registered = (a: Awaited<ReturnType<typeof app>>, ...hosts: string[]) =>
  until(
    () => hosts.every((h) => a.hosts()?.some((x) => x.host === h && x.state === "registered")),
    5000,
    `registered on ${hosts.join(", ")}`,
  );

test("nothing is registered until the app's socket is open, and nothing after it closes", async () => {
  assert.equal(browserHostState().connected, false);
  assert.equal((await local.browserExecute({ command: "list_tabs" })).error.code, "browser_no_host");
  const a = await app();
  await registered(a, "local", "srv_remote");
  assert.equal(local.browserHosts().length, 1);
  assert.equal(remote.browserHosts().length, 1);
  assert.deepEqual(local.browserHosts()[0]!.query, { hostKind: "Paseo Command", supportedCommands: COMMANDS });
  await a.close();
  await until(() => !local.browserHosts().length && !remote.browserHosts().length, 5000, "released");
  assert.equal(browserHostState().connected, false);
  assert.equal((await local.browserExecute({ command: "list_tabs" })).error.code, "browser_no_host");
});

test("a daemon's request reaches the app with its host and agent, and the answer goes back to that daemon", async () => {
  const a = await app();
  await registered(a, "local", "srv_remote");
  const asked = local.browserExecute(
    { command: "new_tab", args: { url: "http://localhost:5173/" } },
    { agentId: "agt_1", cwd: "/home/review/code", workspaceId: "wks_app" },
  );
  await until(() => a.requests().length === 1, 5000, "the request");
  const sent = a.requests()[0];
  assert.equal(sent.host, "local");
  assert.deepEqual(sent.request.command, { command: "new_tab", args: { url: "http://localhost:5173/" } });
  assert.equal(sent.request.agentId, "agt_1");
  assert.equal(sent.request.workspaceId, "wks_app");
  const result = { command: "new_tab", browserId: "0f8b3c1e-52a7-4c9d-9b1e-2f6a7d8c9e10", workspaceId: "wks_app", url: "http://localhost:5173/" };
  a.answer({ requestId: sent.request.requestId, ok: true, result });
  assert.deepEqual(await asked, { requestId: sent.request.requestId, ok: true, result });

  // The other daemon's request says its own host, and only it gets the answer.
  const far = remote.browserExecute({ command: "list_tabs" }, { agentId: "agt_far", workspaceId: "wks_far" });
  await until(() => a.requests().length === 2, 5000, "the remote's request");
  assert.equal(a.requests()[1].host, "srv_remote");
  const before = local.callsOf("sendBrowserAutomationExecuteResponse").length;
  a.answer({ requestId: a.requests()[1].request.requestId, ok: true, result: { command: "list_tabs", tabs: [] } });
  assert.deepEqual((await far).result, { command: "list_tabs", tabs: [] });
  assert.equal(local.callsOf("sendBrowserAutomationExecuteResponse").length, before);
  // An answer to nothing asked is dropped, as is a second answer.
  a.answer({ requestId: "browser_unknown", ok: true, result: { command: "list_tabs", tabs: [] } });
  a.answer({ requestId: sent.request.requestId, ok: true, result });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(local.callsOf("sendBrowserAutomationExecuteResponse").length, before);
  assert.equal(browserHostState().pending, 0);
  await a.close();
});

test("the app says which commands it runs; the daemon refuses the rest itself", async () => {
  const a = await app(["list_tabs", "new_tab", "made_up"]);
  await registered(a, "local");
  assert.deepEqual(local.browserHosts()[0]!.query.supportedCommands, ["list_tabs", "new_tab"]);
  const refused = await local.browserExecute({ command: "snapshot", args: { browserId: "x" } });
  assert.equal(refused.error.code, "browser_unsupported");
  assert.match(refused.error.message, /Paseo Command/);
  assert.equal(a.requests().length, 0);
  await a.close();
});

test("a request the app still owes fails when its socket closes", async () => {
  const a = await app();
  await registered(a, "local");
  const asked = local.browserExecute({ command: "navigate", args: { url: "https://example.com/" } }, { agentId: "agt_1" });
  await until(() => a.requests().length === 1, 5000, "the request");
  await a.close();
  const failed = await asked;
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, "browser_no_host");
  assert.equal(failed.error.retryable, true);
});

test("a daemon that reconnects is registered on again; one without browser hosts is told apart", async () => {
  const a = await app();
  await registered(a, "local", "srv_remote");
  local.dropAll();
  await until(() => !local.browserHosts().length, 5000, "dropped");
  await until(() => local.browserHosts().length === 1, 15000, "registered again");
  await registered(a, "local");
  remote.features.browserHost = false;
  remote.dropAll();
  await until(() => a.hosts()?.some((h) => h.host === "srv_remote" && h.state === "refused"), 15000, "the remote refused");
  assert.equal(remote.browserHosts().length, 0);
  remote.features.browserHost = true;
  await a.close();
});

test("a second app socket takes the first one's place; another origin is refused", async () => {
  const first = await app();
  await registered(first, "local");
  const second = await app(["list_tabs"]);
  await until(() => first.closed() !== null, 5000, "the first closed");
  await registered(second, "local");
  assert.equal(local.browserHosts().length, 1);
  assert.deepEqual(local.browserHosts()[0]!.query.supportedCommands, ["list_tabs"]);
  await assert.rejects(app(COMMANDS, "http://evil.example"), /403/);
  await second.close();
});
