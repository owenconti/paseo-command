import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { setSlackStream, setSlackTransport, type EventStream } from "./api";
import { slackContext } from "./context";
import { slackBlock, slackPrompt } from "./prompt";
import { fillPreset } from "../presets";
import {
  compareTs,
  keepSlackCurrent,
  loadHistory,
  loadOlder,
  loadThread,
  loadUnreads,
  loadWorkspace,
  needsYou,
  pollTick,
  setSlackNotice,
  slackStore,
  threadKey,
} from "./store";
import type { SlackConversation, SlackEvent, SlackMessage, SlackWorkspace } from "./types";

const ME = "U0";
const C1: SlackConversation = { id: "C1", kind: "channel", name: "eng", isMember: true, isArchived: false, lastRead: "100.000000", latest: "100.000000", unread: 0, mentions: 0 };
const D1: SlackConversation = { id: "D1", kind: "im", name: "ana", userId: "U1", isMember: true, isArchived: false, lastRead: "100.000000", unread: 0, mentions: 0 };
const WS: SlackWorkspace = {
  teamId: "T1",
  teamName: "Acme",
  url: "https://acme.slack.com/",
  selfId: ME,
  users: [
    { id: ME, name: "owen", realName: "Owen", isBot: false, deleted: false },
    { id: "U1", name: "ana", realName: "Ana", isBot: false, deleted: false },
  ],
  conversations: [C1, D1],
  emoji: {},
  live: { mode: "polling", reason: "No app token" },
};

const msg = (ts: number, patch: Partial<SlackMessage> = {}): SlackMessage => ({
  ts: `${ts}.000000`,
  conversationId: "C1",
  userId: "U1",
  text: `message ${ts}`,
  ...patch,
});

let calls: { path: string; body?: unknown }[];
let answers: Record<string, (path: string, body?: unknown) => unknown>;
let notices: string[];
beforeEach(() => {
  slackStore.reset();
  calls = [];
  answers = {};
  notices = [];
  setSlackNotice((m) => notices.push(m));
  setSlackTransport(async (path, body) => {
    calls.push({ path, body });
    const name = path.replace(/^slack\/(q|m)\//, "").split("?")[0];
    if (!answers[name]) throw new Error(`unexpected ${path}`);
    return answers[name](path, body);
  });
});
afterEach(() => {
  setSlackTransport(null);
  setSlackStream(null);
});

/** An answer the test releases by hand, to look at the store while a write is in flight. */
function held<T>() {
  let release!: (value: T) => void;
  let refuse!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    refuse = reject;
  });
  promise.catch(() => {});
  return { promise, release, refuse };
}
const settled = () => new Promise((resolve) => setImmediate(resolve));
const shown = (id = "C1") => slackStore.getState().history.get(id)?.messages.map((m) => m.ts) ?? [];
const conv = (id = "C1") => slackStore.getState().conversations.get(id)!;
const param = (path: string, key: string) => new URLSearchParams(path.split("?")[1]).get(key);

async function withHistory(messages: SlackMessage[], more = false) {
  slackStore.setWorkspace(WS);
  answers.history = () => ({ messages, more });
  await loadHistory("C1");
}

describe("slack store: reads", () => {
  it("the workspace brings people, conversations and the live mode; not now says why", async () => {
    answers.workspace = () => WS;
    await loadWorkspace();
    const d = slackStore.getState();
    assert.equal(d.users.get("U1")?.name, "ana");
    assert.equal(d.conversations.size, 2);
    assert.equal(d.live?.mode, "polling");
    answers.workspace = () => ({ available: false, reason: "Add slackUserToken to secrets.json to use Slack." });
    await loadWorkspace(true);
    assert.equal(slackStore.getState().unavailable?.reason, "Add slackUserToken to secrets.json to use Slack.");
    assert.equal(calls[1].path, "slack/q/workspace?fresh=1");
  });

  it("a reload of the workspace keeps read state it doesn't carry", async () => {
    slackStore.setWorkspace(WS);
    slackStore.applyEvent({ type: "unreads", unreads: { conversations: [{ id: "C1", lastRead: "100.000000", unread: 4, mentions: 1 }], pending: 0 } });
    const { unread: _, mentions: __, lastRead: ___, ...bare } = C1;
    answers.workspace = () => ({ ...WS, conversations: [bare, D1] });
    await loadWorkspace(true);
    assert.equal(conv().unread, 4);
    assert.equal(conv().mentions, 1);
  });

  it("history is ordered by ts, de-duplicated, without thread replies; older pages come before", async () => {
    await withHistory([msg(103), msg(101), msg(102, { threadTs: "101.000000" }), msg(104, { threadTs: "101.000000", subtype: "thread_broadcast" })], true);
    assert.deepEqual(shown(), ["101.000000", "103.000000", "104.000000"]);
    answers.history = (path) => {
      assert.equal(param(path, "before"), "101.000000");
      return { messages: [msg(100), msg(99), msg(101)], more: false };
    };
    await loadOlder("C1");
    assert.deepEqual(shown(), ["99.000000", "100.000000", "101.000000", "103.000000", "104.000000"]);
    assert.equal(slackStore.getState().history.get("C1")?.more, false);
    // Nothing more to ask for.
    await loadOlder("C1");
    assert.equal(calls.filter((c) => c.path.includes("before")).length, 1);
  });

  it("reading the newest again: a message Slack no longer lists was deleted; older and newer ones stay; a gap replaces", async () => {
    await withHistory([msg(100), msg(101), msg(102), msg(103)], true);
    // One arrives while the read is under way.
    const answer = held<unknown>();
    answers.history = () => answer.promise;
    const reading = loadHistory("C1", true);
    slackStore.applyEvent({ type: "message", message: msg(110) });
    answer.release({ messages: [msg(101), msg(103, { text: "edited" })], more: true });
    await reading;
    assert.deepEqual(shown(), ["100.000000", "101.000000", "103.000000", "110.000000"]);
    assert.equal(slackStore.getState().history.get("C1")?.messages[2].text, "edited");
    assert.equal(slackStore.getState().history.get("C1")?.more, true);
    // A page that doesn't reach what's shown: it takes the place of the old.
    answers.history = () => ({ messages: [msg(200), msg(201)], more: true });
    await loadHistory("C1", true);
    assert.deepEqual(shown(), ["200.000000", "201.000000"]);
  });

  it("a thread: its parent and replies; the parent as the conversation shows it too", async () => {
    await withHistory([msg(100, { threadTs: "100.000000", replyCount: 1 })]);
    answers.replies = () => ({
      parent: msg(100, { threadTs: "100.000000", replyCount: 2, replyUserIds: ["U1"] }),
      replies: [msg(102, { threadTs: "100.000000" }), msg(101, { threadTs: "100.000000" })],
      more: false,
    });
    await loadThread("C1", "100.000000");
    const t = slackStore.getState().threads.get(threadKey("C1", "100.000000"))!;
    assert.deepEqual(t.replies.map((m) => m.ts), ["101.000000", "102.000000"]);
    assert.equal(slackStore.getState().history.get("C1")?.messages[0].replyCount, 2);
    // A reply the thread read already counted isn't counted again by its event.
    slackStore.applyEvent({ type: "message", message: msg(102, { threadTs: "100.000000" }) });
    assert.equal(slackStore.getState().history.get("C1")?.messages[0].replyCount, 2);
    slackStore.applyEvent({ type: "message", message: msg(103, { threadTs: "100.000000", userId: "U9" }) });
    const parent = slackStore.getState().history.get("C1")!.messages[0];
    assert.equal(parent.replyCount, 3);
    assert.equal(parent.latestReply, "103.000000");
    assert.deepEqual(parent.replyUserIds, ["U1", "U9"]);
    assert.equal(slackStore.getState().threads.get(threadKey("C1", "100.000000"))!.replies.length, 3);
    // Not shown in the conversation itself.
    assert.deepEqual(shown(), ["100.000000"]);
  });

  it("unread counts come from the server; unknown stays unknown", async () => {
    const { unread: _, mentions: __, ...unknown } = C1;
    slackStore.setWorkspace({ ...WS, conversations: [unknown, D1] });
    assert.equal(conv().unread, undefined);
    answers.unreads = () => ({ conversations: [{ id: "D1", lastRead: "100.000000", unread: 2, mentions: 2 }], pending: 1 });
    await loadUnreads();
    assert.equal(conv().unread, undefined);
    assert.equal(conv("D1").unread, 2);
    assert.equal(slackStore.getState().unreadsPending, 1);
    // A message to a conversation whose count isn't known doesn't make one up.
    slackStore.applyEvent({ type: "message", message: msg(120) });
    assert.equal(conv().unread, undefined);
    assert.equal(conv().latest, "120.000000");
  });

  it("orders timestamps by their seconds and fraction, unsent last", () => {
    assert.ok(compareTs("99.9", "100.000001") < 0);
    assert.ok(compareTs("100.000010", "100.000002") > 0);
    assert.ok(compareTs("local:1", "999999999.0") > 0);
    assert.equal(compareTs("1.5", "1.500000"), 0);
  });
});

describe("slack store: writes", () => {
  it("a post shows at once, unsent, then as Slack has it", async () => {
    await withHistory([msg(100)]);
    const answer = held<unknown>();
    answers.post = () => answer.promise;
    const sending = slackStore.post({ conversationId: "C1", markdown: "**hi**" });
    const local = slackStore.getState().history.get("C1")!.messages[1];
    assert.equal(local.pending, true);
    assert.equal(local.text, "**hi**");
    assert.equal(local.userId, ME);
    // Its own event may come first: no doubles once the answer's in.
    slackStore.applyEvent({ type: "message", message: msg(130, { userId: ME, text: "*hi*" }) });
    answer.release({ message: msg(130, { userId: ME, text: "*hi*" }) });
    assert.equal(await sending, true);
    assert.deepEqual(shown(), ["100.000000", "130.000000"]);
    // Yours reads the conversation to it.
    assert.equal(conv().lastRead, "130.000000");
  });

  it("a refused post goes, with the notice", async () => {
    await withHistory([msg(100)]);
    answers.post = () => Promise.reject(new Error("not_in_channel"));
    assert.equal(await slackStore.post({ conversationId: "C1", markdown: "x" }), false);
    assert.deepEqual(shown(), ["100.000000"]);
    assert.deepEqual(notices, ["Slack didn't send that: not_in_channel"]);
  });

  it("a reply goes to its thread, unsent until Slack has it", async () => {
    await withHistory([msg(100, { threadTs: "100.000000" })]);
    answers.replies = () => ({ parent: msg(100, { threadTs: "100.000000" }), replies: [], more: false });
    await loadThread("C1", "100.000000");
    answers.post = () => ({ message: msg(140, { userId: ME, threadTs: "100.000000" }) });
    const sending = slackStore.post({ conversationId: "C1", markdown: "r", threadTs: "100.000000" });
    assert.equal(slackStore.getState().threads.get(threadKey("C1", "100.000000"))!.replies[0].pending, true);
    await sending;
    assert.deepEqual(slackStore.getState().threads.get(threadKey("C1", "100.000000"))!.replies.map((m) => m.ts), ["140.000000"]);
    assert.equal(slackStore.getState().history.get("C1")!.messages[0].replyCount, 1);
    assert.deepEqual(shown(), ["100.000000"]);
  });

  it("an edit shows at once and comes back if refused; a sync meanwhile keeps the edit", async () => {
    await withHistory([msg(100, { userId: ME, text: "old", blocks: [{ type: "rich_text", elements: [] }] })]);
    const answer = held<unknown>();
    answers.edit = () => answer.promise;
    const saving = slackStore.edit({ conversationId: "C1", ts: "100.000000", markdown: "new" });
    let m = slackStore.getState().history.get("C1")!.messages[0];
    assert.equal(m.text, "new");
    assert.equal(m.blocks, undefined);
    assert.ok(m.edited);
    slackStore.applyEvent({ type: "changed", message: msg(100, { userId: ME, text: "old", reactions: [{ name: "tada", count: 1, userIds: ["U1"] }] }) });
    m = slackStore.getState().history.get("C1")!.messages[0];
    assert.equal(m.text, "new");
    assert.equal(m.reactions?.length, 1);
    answer.refuse(new Error("cant_update_message"));
    assert.equal(await saving, false);
    m = slackStore.getState().history.get("C1")!.messages[0];
    assert.equal(m.text, "old");
    assert.equal(m.blocks?.length, 1);
    assert.equal(m.edited, undefined);
    assert.equal(notices.length, 1);
  });

  it("a delete takes the message at once and puts it back if refused", async () => {
    await withHistory([msg(100, { userId: ME }), msg(101)]);
    answers.delete = () => Promise.reject(new Error("cant_delete_message"));
    const deleting = slackStore.remove({ conversationId: "C1", ts: "100.000000" });
    assert.deepEqual(shown(), ["101.000000"]);
    assert.equal(await deleting, false);
    assert.deepEqual(shown(), ["100.000000", "101.000000"]);
  });

  it("reactions toggle yours at once, keep through an event meanwhile, and come back if refused", async () => {
    await withHistory([msg(100, { reactions: [{ name: "tada", count: 1, userIds: ["U1"] }] })]);
    answers.react = () => ({ reactions: [{ name: "tada", count: 2, userIds: ["U1", ME] }] });
    await slackStore.toggleReaction("C1", "100.000000", "tada");
    assert.deepEqual(slackStore.getState().history.get("C1")!.messages[0].reactions, [{ name: "tada", count: 2, userIds: ["U1", ME] }]);
    assert.deepEqual(calls.at(-1)?.body, { conversationId: "C1", ts: "100.000000", name: "tada" });
    const answer = held<unknown>();
    answers.unreact = () => answer.promise;
    const taking = slackStore.toggleReaction("C1", "100.000000", "tada");
    assert.deepEqual(slackStore.getState().history.get("C1")!.messages[0].reactions, [{ name: "tada", count: 1, userIds: ["U1"] }]);
    slackStore.applyEvent({ type: "reaction", conversationId: "C1", ts: "100.000000", reactions: [] });
    assert.equal(slackStore.getState().history.get("C1")!.messages[0].reactions?.length, 1);
    answer.refuse(new Error("no_reaction"));
    assert.equal(await taking, false);
    assert.deepEqual(slackStore.getState().history.get("C1")!.messages[0].reactions, [{ name: "tada", count: 2, userIds: ["U1", ME] }]);
    // A new one of yours.
    answers.react = () => ({});
    await slackStore.toggleReaction("C1", "100.000000", "eyes");
    assert.deepEqual(slackStore.getState().history.get("C1")!.messages[0].reactions?.at(-1), { name: "eyes", count: 1, userIds: [ME] });
  });

  it("marking read clears the count at once, holds through the tracker meanwhile, and comes back if refused", async () => {
    await withHistory([msg(100), msg(101), msg(102)]);
    slackStore.applyEvent({ type: "unreads", unreads: { conversations: [{ id: "C1", lastRead: "100.000000", latest: "102.000000", unread: 2, mentions: 0 }], pending: 0 } });
    assert.ok(needsYou(conv()));
    const answer = held<unknown>();
    answers.mark = () => answer.promise;
    const marking = slackStore.markRead("C1", "102.000000");
    assert.equal(conv().unread, 0);
    assert.equal(conv().lastRead, "102.000000");
    slackStore.applyEvent({ type: "unreads", unreads: { conversations: [{ id: "C1", lastRead: "100.000000", unread: 2 }], pending: 0 } });
    assert.equal(conv().unread, 0);
    answer.refuse(new Error("ratelimited"));
    assert.equal(await marking, false);
    assert.equal(conv().unread, 2);
    assert.equal(conv().lastRead, "100.000000");
    // Read part way: counted from what's shown.
    answers.mark = () => ({ ok: true });
    await slackStore.markRead("C1", "101.000000");
    assert.equal(conv().unread, 1);
    // Never back.
    calls = [];
    await slackStore.markRead("C1", "100.000000");
    assert.equal(calls.at(-1)?.body && (calls.at(-1)!.body as { ts: string }).ts, "101.000000");
  });
});

describe("slack store: events", () => {
  it("another's message is unread past where you've read (a DM's mentions you), yours reads to it", async () => {
    await withHistory([msg(100)]);
    slackStore.applyEvent({ type: "message", message: msg(101) });
    assert.equal(conv().unread, 1);
    assert.equal(conv().mentions, 0);
    slackStore.applyEvent({ type: "message", message: msg(102, { text: `hey <@${ME}>` }) });
    assert.equal(conv().unread, 2);
    assert.equal(conv().mentions, 1);
    slackStore.applyEvent({ type: "message", message: msg(103, { userId: ME }) });
    assert.equal(conv().unread, 0);
    assert.equal(conv().mentions, 0);
    slackStore.applyEvent({ type: "message", message: msg(104, { conversationId: "D1" }) });
    assert.equal(conv("D1").unread, 1);
    assert.equal(conv("D1").mentions, 1);
    // Not in a conversation read yet: nothing to add to, but the count moves.
    assert.equal(slackStore.getState().history.has("D1"), false);
  });

  it("changed, deleted, marked, conversation, user and live events", async () => {
    await withHistory([msg(100), msg(101)]);
    slackStore.applyEvent({ type: "changed", message: msg(101, { text: "edited", edited: "105.000000" }) });
    assert.equal(slackStore.getState().history.get("C1")!.messages[1].text, "edited");
    slackStore.applyEvent({ type: "deleted", conversationId: "C1", ts: "100.000000" });
    assert.deepEqual(shown(), ["101.000000"]);
    slackStore.applyEvent({ type: "unreads", unreads: { conversations: [{ id: "C1", lastRead: "99.000000", latest: "101.000000", unread: 1 }], pending: 0 } });
    slackStore.applyEvent({ type: "marked", conversationId: "C1", lastRead: "101.000000" });
    assert.equal(conv().unread, 0);
    slackStore.applyEvent({ type: "conversation", conversation: { ...C1, topic: "Ship it", unread: undefined } });
    assert.equal(conv().topic, "Ship it");
    assert.equal(conv().unread, 0);
    slackStore.applyEvent({ type: "user", user: { ...WS.users[1], name: "ana b" } });
    assert.equal(slackStore.getState().users.get("U1")?.name, "ana b");
    slackStore.applyEvent({ type: "live", live: { mode: "socket" } });
    assert.equal(slackStore.getState().live?.mode, "socket");
  });

  it("the stream: live once open; a reconnect or resync reads again what shows", async () => {
    await withHistory([msg(100)]);
    let stream!: EventStream;
    setSlackStream(() => (stream = { onopen: null, onmessage: null, onerror: null, close: () => {} }));
    const send = (e: SlackEvent) => stream.onmessage!({ data: JSON.stringify(e) } as MessageEvent);
    slackStore.setOpen({ conversationId: "C1" });
    const doc = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} } as unknown as Document;
    const stop = keepSlackCurrent(doc, 60_000);
    assert.equal(slackStore.getState().stream, "connecting");
    stream.onopen!(new Event("open"));
    send({ type: "live", live: { mode: "socket" } });
    send({ type: "message", message: msg(101) });
    assert.deepEqual(shown(), ["100.000000", "101.000000"]);
    // Live: polls stand down.
    calls = [];
    await pollTick();
    assert.equal(calls.length, 0);
    // Down, then back: what shows is read again.
    stream.onerror!(new Event("error"));
    assert.equal(slackStore.getState().stream, "down");
    answers.history = () => ({ messages: [msg(101), msg(102)], more: false });
    answers.unreads = () => ({ conversations: [], pending: 0 });
    stream.onopen!(new Event("open"));
    await settled();
    await settled();
    assert.deepEqual(shown(), ["100.000000", "101.000000", "102.000000"]);
    calls = [];
    send({ type: "resync" });
    await settled();
    assert.deepEqual(calls.map((c) => c.path.split("?")[0]).sort(), ["slack/q/history", "slack/q/unreads"]);
    stop();
    assert.equal(slackStore.getState().stream, "off");
  });

  it("polls only while not live, not while the page is hidden, and not while Slack is paused", async () => {
    await withHistory([msg(100)]);
    setSlackStream(() => ({ onopen: null, onmessage: null, onerror: null, close: () => {} }));
    answers.history = () => ({ messages: [msg(100)], more: false });
    answers.unreads = () => ({ conversations: [], pending: 0 });
    slackStore.setOpen({ conversationId: "C1" });
    const doc = { hidden: true, addEventListener: () => {}, removeEventListener: () => {} };
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const stop = keepSlackCurrent(doc as unknown as Document, 20_000);
      calls = [];
      mock.timers.tick(20_000);
      assert.equal(calls.length, 0);
      doc.hidden = false;
      mock.timers.tick(20_000);
      await settled();
      assert.deepEqual(calls.map((c) => c.path.split("?")[0]).sort(), ["slack/q/history", "slack/q/unreads"]);
      stop();
    } finally {
      mock.timers.reset();
    }
    slackStore.applyEvent({ type: "unreads", unreads: { conversations: [], pending: 0 } });
    answers.unreads = () => ({ available: false, reason: "Rate limited", retryAt: Date.now() + 60_000 });
    await loadUnreads();
    calls = [];
    await pollTick();
    assert.equal(calls.length, 0);
  });
});

describe("slack prompt", () => {
  it("a message and the few before it, or a thread, as a new agent's draft and a preset's {{slack}}", async () => {
    await withHistory([msg(100, { userId: "U1", text: "first" }), msg(101, { userId: ME, text: "see <@U1> *now*" })]);
    const ctx = slackContext(slackStore.getState(), "C1", "101.000000")!;
    assert.equal(ctx.conversationName, "#eng");
    assert.equal(ctx.permalink, "https://acme.slack.com/archives/C1/p101000000");
    assert.deepEqual(ctx.messages.map((m) => [m.author, m.text]), [
      ["ana", "first"],
      ["owen", "see @ana now"],
    ]);
    assert.equal(ctx.thread, false);
    assert.match(slackPrompt(ctx), /^Look into this[\s\S]*Slack messages in #eng\nhttps:\/\/acme\.slack\.com\/archives\/C1\/p101000000\n\nana \(1970-01-01 00:01 UTC\):\n> first/);
    assert.equal(
      fillPreset("Summarise {{ slack }}.", undefined, undefined, ctx),
      `Summarise a message in #eng.\n\n${slackBlock(ctx)}`,
    );
    answers.replies = () => ({ parent: msg(100, { threadTs: "100.000000" }), replies: [msg(102, { threadTs: "100.000000", text: "reply" })], more: false });
    await loadThread("C1", "100.000000");
    const thread = slackContext(slackStore.getState(), "C1", "100.000000", "100.000000")!;
    assert.equal(thread.thread, true);
    assert.deepEqual(thread.messages.map((m) => m.text), ["message 100", "reply"]);
  });
});
