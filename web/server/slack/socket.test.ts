import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { SlackEvent } from "../../src/slack/types";
import { writeSettings } from "../settings";
import { NO_APP_TOKEN } from "./client";
import { SLACK_EVENTS, noteSlackDemand, onSlackEvent } from "./events";
import { FAKE_APP_TOKEN, FAKE_IDS as I, installFakeSlack, nextTs, type FakeSlack } from "./fake";
import { slackLive } from "./live";
import { keptWorkspace, readWorkspace } from "./reads";
import { SOCKET, ensureSlackSocket, slackSocketOpen } from "./socket";
import { slackUnreads, tickSlackUnreads } from "./unreads";

let fake: FakeSlack | undefined;
const backoff = SOCKET.minBackoffMs;
const demand = SLACK_EVENTS.demandMs;
afterEach(() => {
  SOCKET.minBackoffMs = backoff;
  SLACK_EVENTS.demandMs = demand;
  fake?.restore();
  fake = undefined;
});

const settle = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const T = I.ts;

async function connected() {
  fake = installFakeSlack();
  const events: SlackEvent[] = [];
  onSlackEvent((e) => events.push(e));
  await readWorkspace();
  await settle();
  assert.equal(fake.sockets.length, 1);
  assert.equal(slackSocketOpen(), true);
  return { fake, events, socket: fake.socket()! };
}

test("connects on demand with the app token, acks every envelope at once, and says it's live", async () => {
  const { fake, events, socket } = await connected();
  assert.equal(fake.calls.find((c) => c.method === "apps.connections.open")!.token, FAKE_APP_TOKEN);
  assert.match(socket.url, /^wss:\/\/wss\.fake\.slack\//);
  assert.deepEqual(slackLive(), { mode: "socket" });
  assert.deepEqual(events.find((e) => e.type === "live"), { type: "live", live: { mode: "socket" } });
  const id = socket.event({ type: "something_unknown" });
  assert.deepEqual(socket.acks, [id]);
  socket.push({ envelope_id: "e2", type: "slash_commands", payload: {} });
  assert.deepEqual(socket.acks, [id, "e2"]);
});

test("message events become SlackEvents and update the unread state", async () => {
  const { fake, events, socket } = await connected();
  for (let i = 0; i < 5; i++) await tickSlackUnreads();
  const ts = nextTs();
  socket.event({ type: "message", channel: I.dm, user: I.sam, text: "new one", ts, channel_type: "im" });
  await settle();
  const message = events.find((e) => e.type === "message");
  assert.deepEqual(message, { type: "message", message: { ts, conversationId: I.dm, userId: I.sam, text: "new one" } });
  assert.equal(slackUnreads().conversations.find((c) => c.id === I.dm)!.unread, 3);

  socket.event({
    type: "message",
    subtype: "message_changed",
    channel: I.general,
    message: { type: "message", user: I.sam, text: "edited", ts: T.mention, edited: { user: I.sam, ts: nextTs() } },
    previous_message: { ts: T.mention, text: "old" },
  });
  socket.event({ type: "message", subtype: "message_deleted", channel: I.general, deleted_ts: T.reply1, previous_message: { ts: T.reply1, thread_ts: T.parent } });
  socket.event({ type: "message", subtype: "message_replied", channel: I.general, message: { ts: T.parent, user: I.owen, text: "parent", thread_ts: T.parent, reply_count: 3 } });
  const broadcast = nextTs();
  socket.event({ type: "message", subtype: "thread_broadcast", channel: I.general, user: I.ria, text: "to all", ts: broadcast, thread_ts: T.parent });
  await settle();
  const changed = events.filter((e) => e.type === "changed");
  assert.equal(changed.length, 2);
  assert.equal(changed[0].type === "changed" && changed[0].message.text, "edited");
  assert.ok(changed[0].type === "changed" && changed[0].message.edited);
  assert.equal(changed[1].type === "changed" && changed[1].message.replyCount, 3);
  assert.deepEqual(events.find((e) => e.type === "deleted"), { type: "deleted", conversationId: I.general, ts: T.reply1, threadTs: T.parent });
  const b = events.filter((e) => e.type === "message").at(-1);
  assert.equal(b?.type === "message" && b.message.subtype, "thread_broadcast");
  // A broadcast counts as unread in the channel.
  assert.equal(slackUnreads().conversations.find((c) => c.id === I.general)!.unread, 3);
  assert.equal(fake.socket()!.acks.length, 5);
});

test("reactions, marks, people and channels", async () => {
  const { fake, events, socket } = await connected();
  for (let i = 0; i < 5; i++) await tickSlackUnreads();
  fake.ws.messages.find((m) => m.ts === T.image)!.reactions = [{ name: "tada", count: 1, users: [I.sam] }];
  socket.event({ type: "reaction_added", user: I.sam, reaction: "tada", item: { type: "message", channel: I.general, ts: T.image } });
  socket.event({ type: "im_marked", channel: I.dm, ts: T.dm2 });
  socket.event({ type: "user_change", user: { id: I.sam, name: "sam", profile: { display_name: "Samuel", real_name: "Sam Rivera" } } });
  socket.event({ type: "channel_rename", channel: { id: I.random, name: "watercooler", created: 1 } });
  await settle();
  assert.deepEqual(events.find((e) => e.type === "reaction"), {
    type: "reaction",
    conversationId: I.general,
    ts: T.image,
    reactions: [{ name: "tada", count: 1, userIds: [I.sam] }],
  });
  assert.deepEqual(events.find((e) => e.type === "marked"), { type: "marked", conversationId: I.dm, lastRead: T.dm2 });
  assert.equal(slackUnreads().conversations.find((c) => c.id === I.dm)!.unread, 0);
  assert.equal(keptWorkspace()!.users.find((u) => u.id === I.sam)!.name, "Samuel");
  const renamed = events.find((e) => e.type === "conversation");
  assert.equal(renamed?.type === "conversation" && renamed.conversation.name, "watercooler");
  assert.equal(keptWorkspace()!.conversations.find((c) => c.id === I.random)!.name, "watercooler");

  // Joining a channel: it's described and kept.
  fake.ws.conversations.find((c) => c.id === I.outside)!.is_member = true;
  socket.event({ type: "member_joined_channel", user: I.owen, channel: I.outside });
  socket.event({ type: "member_joined_channel", user: I.sam, channel: I.general });
  await settle();
  const joined = events.filter((e) => e.type === "conversation");
  assert.equal(joined.length, 2);
  assert.equal(joined[1].type === "conversation" && joined[1].conversation.id, I.outside);
  assert.ok(keptWorkspace()!.conversations.some((c) => c.id === I.outside));
});

test("a routine disconnect opens the new connection first, closes the old after its hello, and needs no resync", async () => {
  const { fake, events, socket } = await connected();
  fake.socket(); // the first
  socket.disconnect();
  await settle();
  assert.equal(fake.sockets.length, 2);
  assert.equal(socket.closed, true);
  assert.equal(fake.sockets[1].closed, false);
  assert.equal(slackSocketOpen(), true);
  assert.ok(!events.some((e) => e.type === "resync"));
  // Closing the old one later changes nothing.
  assert.equal(fake.sockets.length, 2);
});

test("the old connection stays until the new one says hello", async () => {
  fake = installFakeSlack(undefined, { autoHello: false });
  await readWorkspace();
  await settle();
  fake.socket()!.hello();
  const old = fake.socket()!;
  old.disconnect();
  await settle();
  assert.equal(fake.sockets.length, 2);
  assert.equal(old.closed, false);
  assert.equal(slackSocketOpen(), true);
  fake.socket()!.hello();
  assert.equal(old.closed, true);
  assert.deepEqual(slackLive(), { mode: "socket" });
});

test("after a real drop, the next hello asks the pages to read again", async () => {
  SOCKET.minBackoffMs = 5;
  const { fake, events, socket } = await connected();
  socket.drop();
  await settle(40);
  assert.equal(fake.sockets.length, 2);
  assert.ok(events.some((e) => e.type === "resync"));
});

test("a connection that never says hello, or stalls asking for one, is given up and tried again", async () => {
  const timeout = SOCKET.connectTimeoutMs;
  SOCKET.connectTimeoutMs = 20;
  SOCKET.minBackoffMs = 5;
  try {
    fake = installFakeSlack(undefined, { autoHello: false });
    noteSlackDemand();
    await settle(60);
    assert.ok(fake.sockets.length >= 2);
    assert.equal(fake.sockets[0].closed, true);
    assert.equal(slackLive().mode, "polling");
    fake.restore();

    // apps.connections.open never answers.
    fake = installFakeSlack();
    const { SLACK } = await import("./client");
    const real = SLACK.fetch;
    let hung = 0;
    SLACK.fetch = ((url: unknown, init?: RequestInit) => {
      if (String(url).endsWith("apps.connections.open") && hung++ === 0) return new Promise<Response>(() => {});
      return real(url as string, init);
    }) as typeof fetch;
    noteSlackDemand();
    await settle(80);
    assert.ok(hung >= 2);
    assert.equal(slackSocketOpen(), true);
  } finally {
    SOCKET.connectTimeoutMs = timeout;
  }
});

test("pings Slack, and a connection gone quiet is closed and reopened", async () => {
  const ping = SOCKET.pingMs;
  const stale = SOCKET.staleMs;
  SOCKET.pingMs = 10;
  SOCKET.staleMs = 40;
  SOCKET.minBackoffMs = 5;
  try {
    const { fake, socket } = await connected();
    await settle(80);
    // Pongs keep it alive.
    assert.ok(socket.pings >= 3);
    assert.equal(socket.closed, false);
    assert.equal(fake.sockets.length, 1);
    socket.answersPings = false;
    await settle(30);
    socket.serverPing();
    await settle(20);
    // Slack's own pings count too.
    assert.equal(socket.closed, false);
    await settle(80);
    assert.equal(socket.closed, true);
    assert.ok(fake.sockets.length >= 2);
    assert.equal(slackSocketOpen(), true);
  } finally {
    SOCKET.pingMs = ping;
    SOCKET.staleMs = stale;
  }
});

test("a dropped socket waits its backoff, says it's polling, then reconnects", async () => {
  SOCKET.minBackoffMs = 30;
  const { fake, socket } = await connected();
  socket.drop();
  assert.deepEqual(slackLive(), { mode: "polling", reason: "The live connection to Slack dropped; reconnecting." });
  await settle(5);
  assert.equal(fake.sockets.length, 1);
  await settle(60);
  assert.equal(fake.sockets.length, 2);
  assert.deepEqual(slackLive(), { mode: "socket" });
  // apps.connections.open failing also backs off, doubling.
  fake.fail("apps.connections.open", { error: "internal_error" });
  fake.socket()!.drop();
  await settle(150);
  assert.ok(fake.count("apps.connections.open") >= 2 && fake.count("apps.connections.open") <= 4);
  assert.equal(slackLive().mode, "polling");
});

test("without an app token, with Slack off, or without demand, there's no socket", async () => {
  fake = installFakeSlack(undefined, { appToken: false });
  await readWorkspace();
  await settle();
  assert.equal(fake.sockets.length, 0);
  assert.equal(fake.count("apps.connections.open"), 0);
  assert.deepEqual(slackLive(), { mode: "polling", reason: NO_APP_TOKEN });
  fake.restore();

  fake = installFakeSlack();
  writeSettings({ integrations: { slack: false } });
  noteSlackDemand();
  await settle();
  assert.equal(fake.sockets.length, 0);
  writeSettings({ integrations: { slack: true } });
  noteSlackDemand();
  await settle();
  assert.equal(fake.sockets.length, 1);
  // Nobody asked for a while and no page listens: it closes.
  SLACK_EVENTS.demandMs = 0;
  ensureSlackSocket();
  assert.equal(fake.socket()!.closed, true);
  assert.equal(slackSocketOpen(), false);
  assert.equal(slackLive().mode, "polling");
});
