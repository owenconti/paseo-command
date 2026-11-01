import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { writeSettings } from "../settings";
import { onSlackEvent, noteSlackDemand } from "./events";
import { FAKE_IDS as I, installFakeSlack, nextTs, type FakeSlack } from "./fake";
import { readHistory, readWorkspace } from "./reads";
import {
  UNREADS,
  ensureLastRead,
  noteMarked,
  noteMessage,
  noteDeleted,
  slackUnreads,
  tickSlackUnreads,
  unreadsRunning,
  unreadMessages,
} from "./unreads";
import type { SlackEvent } from "../../src/slack/types";

let fake: FakeSlack;
const interval = UNREADS.intervalMs;
beforeEach(() => {
  fake = installFakeSlack(undefined, { appToken: false });
});
afterEach(() => {
  UNREADS.intervalMs = interval;
  fake.restore();
});

const T = I.ts;
const state = (id: string) => slackUnreads().conversations.find((c) => c.id === id);

async function checkAll() {
  const order: string[] = [];
  for (let i = 0; i < 10; i++) {
    const id = await tickSlackUnreads();
    if (!id || order.includes(id)) break;
    order.push(id);
  }
  return order;
}

test("the pace stays well inside Slack's Tier 3 limit", () => {
  // Two Tier 3 calls per check (info, then history): each method at most 30 a minute, of Slack's 50.
  assert.ok(60_000 / UNREADS.intervalMs <= 30);
});

test("counts unread messages from others and mentions of you, DMs and channels in turn", async () => {
  await readWorkspace();
  assert.equal(slackUnreads().pending, 5);
  assert.deepEqual(slackUnreads().conversations, []);
  const order = await checkAll();
  // The DM first, then a channel, the group DM, and the other channels.
  const dms = [I.dm, I.group];
  assert.deepEqual(order.map((id) => dms.includes(id)), [true, false, true, false, false]);
  assert.equal(order[0], I.dm);
  assert.equal(order.length, 5);
  assert.equal(slackUnreads().pending, 0);
  // #general: Sam's mention and CI's message (the channel join and the thread replies don't count).
  assert.deepEqual(state(I.general), { id: I.general, lastRead: T.image, latest: T.bot, unread: 2, mentions: 1 });
  assert.deepEqual(state(I.random), { id: I.random, lastRead: T.lunch, latest: T.lunch, unread: 0, mentions: 0 });
  assert.deepEqual(state(I.secret), { id: I.secret, lastRead: "0000000000.000000", latest: T.secret, unread: 1, mentions: 0 });
  // In DMs every unread message counts as a mention; your own never count.
  assert.deepEqual(state(I.dm), { id: I.dm, lastRead: T.dmOld, latest: T.dm2, unread: 2, mentions: 2 });
  assert.deepEqual(state(I.group), { id: I.group, lastRead: T.group2, latest: T.group2, unread: 0, mentions: 0 });
  const history = fake.calls.find((c) => c.method === "conversations.history" && c.params.channel === I.general)!.params;
  assert.deepEqual([history.oldest, history.limit, history.inclusive], [T.image, "100", "false"]);
  // Never read: no `oldest` (Slack refuses all zeros), every message counted.
  const never = fake.calls.find((c) => c.method === "conversations.history" && c.params.channel === I.secret)!.params;
  assert.deepEqual([never.oldest, never.inclusive], [undefined, undefined]);
  // The workspace now carries the counts.
  const ws = await readWorkspace();
  assert.equal(ws.conversations.find((c) => c.id === I.dm)!.unread, 2);
  assert.deepEqual(unreadMessages(I.dm)!.messages!.map((m) => m.text), ["hey", "are you there?"]);
});

test("past 100 unread messages, the count says there are more", async () => {
  for (let i = 0; i < 105; i++) fake.ws.messages.push({ channel: I.random, ts: nextTs(), user: I.sam, text: `m${i}` });
  await readWorkspace();
  await checkAll();
  assert.equal(state(I.random)!.unread, 100);
  assert.equal(state(I.random)!.unreadMore, true);
});

test("marks, live messages and deletions change the counts at once", async () => {
  await readWorkspace();
  await checkAll();
  const events: SlackEvent[] = [];
  onSlackEvent((e) => events.push(e));
  noteMarked(I.general, T.mention);
  assert.equal(state(I.general)!.unread, 1);
  assert.equal(state(I.general)!.mentions, 0);
  const ts = nextTs();
  noteMessage({ ts, conversationId: I.general, userId: I.sam, text: `hi <@${I.owen}>` });
  assert.deepEqual([state(I.general)!.unread, state(I.general)!.mentions, state(I.general)!.latest], [2, 1, ts]);
  // Your own messages, thread replies and joins don't count.
  noteMessage({ ts: nextTs(), conversationId: I.general, userId: I.owen, text: "mine" });
  noteMessage({ ts: nextTs(), conversationId: I.general, userId: I.sam, text: "in thread", threadTs: T.parent });
  noteMessage({ ts: nextTs(), conversationId: I.general, userId: I.ria, text: "joined", subtype: "channel_join" });
  assert.equal(state(I.general)!.unread, 2);
  noteDeleted(I.general, ts);
  assert.equal(state(I.general)!.unread, 1);
  // Marked back (unread elsewhere): unknown until checked again, never a guess.
  fake.ws.conversations.find((c) => c.id === I.general)!.last_read = T.morning;
  noteMarked(I.general, T.morning);
  assert.equal(state(I.general)!.unread, undefined);
  assert.equal(await tickSlackUnreads(), I.general);
  // Ria's image, Sam's mention and CI's message (Owen's thread parent is his own).
  assert.equal(state(I.general)!.unread, 3);
  await new Promise((r) => setTimeout(r, UNREADS.emitDelayMs + 50));
  assert.ok(events.some((e) => e.type === "unreads"));
});

test("a conversation's newest history recounts when it reaches back to where you read", async () => {
  await readWorkspace();
  await checkAll();
  fake.ws.messages.push({ channel: I.dm, ts: nextTs(), user: I.sam, text: "third" });
  await readHistory(I.dm);
  assert.equal(state(I.dm)!.unread, 3);
});

test("a live message before the count is known leaves it unknown", async () => {
  await readWorkspace();
  noteMessage({ ts: nextTs(), conversationId: I.dm, userId: I.sam, text: "x" });
  assert.equal(state(I.dm)!.unread, undefined);
  assert.ok(state(I.dm)!.latest);
});

test("a rate limit pauses the queue until Slack's retry time", async () => {
  await readWorkspace();
  fake.fail("conversations.info", { error: "ratelimited", status: 429, retryAfter: 30 });
  await tickSlackUnreads();
  fake.clear("conversations.info");
  const calls = fake.count("conversations.info");
  assert.equal(await tickSlackUnreads(), undefined);
  assert.equal(fake.count("conversations.info"), calls);
});

test("the queue runs only on demand and while Slack is on", async () => {
  UNREADS.intervalMs = 5;
  // Reads are demand: the workspace wakes it.
  await readWorkspace();
  assert.equal(unreadsRunning(), true);
  await new Promise((r) => setTimeout(r, 120));
  assert.ok(fake.count("conversations.info") >= 5);
  writeSettings({ integrations: { slack: false } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(unreadsRunning(), false);
  const calls = fake.calls.length;
  noteSlackDemand();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fake.calls.length, calls);
});

test("Activity's checks keep the queue's lock and pause, go past a failing conversation and leave it alone a while", async () => {
  await readWorkspace();
  fake.fail("conversations.info", { error: "ratelimited", status: 429, retryAfter: 30 });
  await ensureLastRead([I.general, I.random]);
  // The limit paused the queue: the second wasn't asked, and neither queue nor Activity asks now.
  assert.equal(fake.count("conversations.info"), 1);
  fake.clear("conversations.info");
  await ensureLastRead([I.general, I.random]);
  assert.equal(await tickSlackUnreads(), undefined);
  assert.equal(fake.count("conversations.info"), 1);
  fake.restore();

  fake = installFakeSlack(undefined, { appToken: false });
  await readWorkspace();
  // #general is gone: Activity goes on to the next, and doesn't ask for #general again for a while.
  fake.ws.conversations = fake.ws.conversations.filter((c) => c.id !== I.general);
  await ensureLastRead([I.general, I.random]);
  assert.equal(state(I.random)!.lastRead, T.lunch);
  const asked = fake.count("conversations.info");
  await ensureLastRead([I.general]);
  assert.equal(fake.count("conversations.info"), asked);
  // The queue leaves it alone too.
  for (let i = 0; i < 6; i++) assert.notEqual(await tickSlackUnreads(), I.general);

  // One check at a time: Activity waits for the queue's.
  fake.restore();
  fake = installFakeSlack(undefined, { appToken: false });
  await readWorkspace();
  let inFlight = 0;
  let most = 0;
  const { SLACK } = await import("./client");
  const real = SLACK.fetch;
  SLACK.fetch = (async (url: unknown, init?: RequestInit) => {
    if (!String(url).endsWith("conversations.info")) return real(url as string, init);
    most = Math.max(most, ++inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    return real(url as string, init);
  }) as typeof fetch;
  await Promise.all([tickSlackUnreads(), ensureLastRead([I.general, I.random, I.secret])]);
  assert.equal(most, 1);
});

test("a never-read DM Slack keeps closed has nothing unread; a failing check stops counting as pending", async () => {
  const sam = fake.ws.conversations.find((c) => c.id === I.dm)!;
  sam.last_read = "0000000000.000000";
  sam.is_open = false;
  await readWorkspace();
  fake.ws.conversations = fake.ws.conversations.filter((c) => c.id !== I.general);
  await checkAll();
  assert.deepEqual(state(I.dm), { id: I.dm, lastRead: "0000000000.000000", latest: T.dm2, unread: 0, mentions: 0 });
  assert.equal(fake.calls.filter((c) => c.method === "conversations.history" && c.params.channel === I.dm).length, 0);
  // #general's check failed (channel_not_found): it's left alone, and the sidebar stops waiting on it.
  assert.equal(state(I.general), undefined);
  assert.equal(slackUnreads().pending, 0);
});
