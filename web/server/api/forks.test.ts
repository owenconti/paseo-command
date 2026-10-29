import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { fleet, get, install, post } from "../fake-daemon";
import { CONCLUDE_PROMPT, firstPrompt, forksFile, sendBackText } from "../forks";
import { FORK_LABEL, type Quote } from "../../src/forks/types";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
let uninstall: () => void;
before(() => {
  uninstall = install(network);
});
after(() => {
  uninstall();
  // The API keeps live connections and timers; nothing else runs here.
  setTimeout(() => process.exit(0), 50).unref();
});

let n = 0;
/** A main agent in a workspace, with a conversation of two replies. */
function mainAgent() {
  const id = `main-${++n}`;
  local.addAgent({
    id,
    provider: "claude",
    model: "opus",
    cwd: "/repo",
    workspaceId: "ws-1",
    currentModeId: "plan",
    runtimeInfo: { model: "opus", modeId: "plan" },
  });
  local.pushTimeline(id, { type: "user_message", text: "Inventory", messageId: "u1" });
  local.pushTimeline(id, { type: "assistant_message", text: "Each bundle lives in two places.", messageId: "r1" });
  local.pushTimeline(id, { type: "user_message", text: "More", messageId: "u2" });
  local.pushTimeline(id, { type: "assistant_message", text: "Later reply.", messageId: "r2" });
  return id;
}
const quotes: Quote[] = [
  { replyKey: "assistant:Each#1", messageId: "r1", text: "Each bundle lives in two places.", start: 0, end: 32 },
];
const created = (helperId: string) => local.agents.get(helperId)!;

test("create: forks the conversation up to the reply, with the main agent's settings", async () => {
  rmSync(forksFile(), { force: true });
  const main = mainAgent();
  const r = await post(`agents/${main}/forks`, {
    question: "Why two places?",
    quotes,
    boundary: { messageId: "r1" },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const fork = r.data;
  assert.equal(fork.agentId, main);
  assert.equal(fork.colour, 0);
  const ctx = local.calls.find((c) => c.method === "buildAgentForkContext");
  assert.deepEqual(ctx?.args, [main, { boundaryMessageId: "r1" }]);
  const helper = created(fork.helperId);
  assert.equal(helper.provider, "claude");
  assert.equal(helper.model, "opus");
  assert.equal(helper.currentModeId, "plan");
  assert.equal(helper.cwd, "/repo");
  assert.equal(helper.workspaceId, "ws-1");
  assert.equal(helper.callerAgentId, main);
  assert.deepEqual(helper.labels, { [FORK_LABEL]: fork.id });
  assert.equal(helper.initialPrompt, firstPrompt(quotes, "Why two places?"));
  assert.equal(helper.attachments.length, 1);
  assert.equal(helper.attachments[0].contextKind, "chat_history");
  assert.match(helper.attachments[0].text, /Each bundle lives in two places/);
  assert.doesNotMatch(helper.attachments[0].text, /Later reply/);
  const listed = await get(`agents/${main}/forks`);
  assert.equal(listed.status, 200);
  assert.equal(listed.data.supported, true);
  assert.deepEqual(
    listed.data.forks.map((f: { id: string }) => f.id),
    [fork.id],
  );
  // A second open fork takes the next colour.
  const second = await post(`agents/${main}/forks`, { question: "And?", quotes, boundary: { messageId: "r1" } });
  assert.equal(second.data.colour, 1);
});

test("create: without a message id the boundary is a timeline position", async () => {
  const main = mainAgent();
  local.calls.length = 0;
  const r = await post(`agents/${main}/forks`, {
    question: "Q",
    quotes,
    boundary: { epoch: "epoch-1", seq: 2 },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ctx = local.calls.find((c) => c.method === "buildAgentForkContext");
  assert.deepEqual(ctx?.args, [main, { boundaryCursor: { epoch: "epoch-1", seq: 2 } }]);
});

test("a host without fork context can't fork", async () => {
  const main = mainAgent();
  local.features = { agentForkContext: false };
  try {
    const listed = await get(`agents/${main}/forks`);
    assert.equal(listed.data.supported, false);
    const r = await post(`agents/${main}/forks`, { question: "Q", quotes, boundary: { messageId: "r1" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "Forks aren't supported on this host.");
  } finally {
    local.features = { agentForkContext: true, agentForkContextCursor: true };
  }
});

test("create: refuses a bad question or quotes", async () => {
  const main = mainAgent();
  const bad = [
    { question: "  ", quotes, boundary: { messageId: "r1" } },
    { question: "Q", quotes: [], boundary: { messageId: "r1" } },
    { question: "Q", quotes: Array(21).fill(quotes[0]), boundary: { messageId: "r1" } },
    { question: "Q", quotes: [{ ...quotes[0], text: "x".repeat(4001) }], boundary: { messageId: "r1" } },
    { question: "x".repeat(100001), quotes, boundary: { messageId: "r1" } },
    { question: "Q", quotes, boundary: {} },
  ];
  for (const body of bad) {
    const r = await post(`agents/${main}/forks`, body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
});

test("close and reopen keep the helper; conclude asks it and returns the send-back text", async () => {
  const main = mainAgent();
  const fork = (await post(`agents/${main}/forks`, { question: "Q", quotes, boundary: { messageId: "r1" } })).data;
  const closed = await post(`forks/${fork.id}/close`, {});
  assert.equal(closed.status, 200);
  assert.ok(closed.data.closedAt);
  assert.equal(created(fork.helperId).archivedAt, null);
  const reopened = await post(`forks/${fork.id}/reopen`, {});
  assert.equal(reopened.data.closedAt, undefined);

  // Still answering: no conclusion yet.
  const early = await post(`forks/${fork.id}/conclude`, {});
  assert.equal(early.status, 400);
  assert.equal(early.data.error, "The fork is still answering.");

  local.touch(fork.helperId, { status: "idle" });
  local.replies.set(fork.helperId, "Two checks call build:*.");
  local.calls.length = 0;
  const r = await post(`forks/${fork.id}/conclude`, {});
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.text, sendBackText(quotes, "Two checks call build:*."));
  const sends = local.calls.filter((c) => c.method === "sendMessage");
  assert.deepEqual(
    sends.map((c) => [c.args[0], c.args[1]]),
    [[fork.helperId, CONCLUDE_PROMPT]],
  );
  const sent = await post(`forks/${fork.id}/sent`, {});
  assert.ok(sent.data.sentBackAt);
});

test("an unknown fork is refused", async () => {
  const r = await post("forks/fork_nope/close", {});
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "No such fork.");
});

test("archiving the main agent archives its fork helpers", async () => {
  const main = mainAgent();
  const fork = (await post(`agents/${main}/forks`, { question: "Q", quotes, boundary: { messageId: "r1" } })).data;
  const r = await post(`agents/${main}/archive`, { confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(created(fork.helperId).archivedAt);
});

test("create: a position without an epoch is cut in the conversation's current epoch", async () => {
  const main = mainAgent();
  local.calls.length = 0;
  const r = await post(`agents/${main}/forks`, { question: "Q", quotes, boundary: { seq: 2 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ctx = local.calls.find((c) => c.method === "buildAgentForkContext");
  assert.deepEqual(ctx?.args, [main, { boundaryCursor: { epoch: local.epoch, seq: 2 } }]);
});

test("list: each fork says whether its helper is answering or waiting on a request", async () => {
  const main = mainAgent();
  const fork = (await post(`agents/${main}/forks`, { question: "Q", quotes, boundary: { messageId: "r1" } })).data;
  let listed = await get(`agents/${main}/forks`);
  assert.equal(listed.data.forks[0].running, true);
  assert.equal(listed.data.forks[0].waiting, false);
  local.touch(fork.helperId, {
    status: "idle",
    pendingPermissions: [{ id: "p1", name: "Bash", kind: "tool" }],
  });
  await new Promise((r) => setTimeout(r, 1100));
  listed = await get(`agents/${main}/forks`);
  assert.equal(listed.data.forks[0].running, false);
  assert.equal(listed.data.forks[0].waiting, true);
});
