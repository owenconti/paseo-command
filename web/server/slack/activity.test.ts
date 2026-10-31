import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import type { ActivityItem } from "../../src/activity/types";
import { readSlackActivity, resetSlackActivity, slackActivityFile, writeSlackActivity } from "../activity/slack";
import { writeSettings } from "../settings";
import { DISABLED, SlackError } from "./client";
import { FAKE_IDS as I, installFakeSlack, nextTs, type FakeSlack } from "./fake";
import { readConversation, readWorkspace } from "./reads";
import { tickSlackUnreads } from "./unreads";

let fake: FakeSlack;
beforeEach(async () => {
  fake = installFakeSlack();
  await readWorkspace();
  for (let i = 0; i < 5; i++) await tickSlackUnreads();
});
afterEach(() => fake.restore());

const T = I.ts;
const settle = () => new Promise((r) => setTimeout(r, 15));
const byKey = (items: ActivityItem[], key: string) => items.find((i) => i.key === key);

test("unread DMs, mentions of you and thread replies, newest first", async () => {
  const items = await readSlackActivity();
  assert.deepEqual(
    items.map((i) => Date.parse(i.at)),
    items.map((i) => Date.parse(i.at)).sort((a, b) => b - a),
  );
  assert.ok(items.every((i) => i.source === "slack" && i.subject === "message" && i.key === `slack:${i.id}`));

  const dm = byKey(items, `slack:${I.dm}:${T.dm2}`)!;
  assert.deepEqual(
    { kind: dm.kind, title: dm.title, subtitle: dm.subtitle, unread: dm.unread, open: dm.open, actor: dm.actor },
    {
      kind: "dm",
      title: "Sam",
      subtitle: "are you there?",
      unread: true,
      open: { kind: "slack", conversationId: I.dm, ts: T.dm2 },
      actor: { name: "Sam", avatarUrl: `/api/slack/avatar?user=${I.sam}` },
    },
  );
  assert.equal(dm.url, `https://acme.slack.com/archives/${I.dm}/p${T.dm2.replace(".", "")}`);
  // The group DM is read: nothing for it.
  assert.ok(!items.some((i) => i.id.startsWith(I.group)));

  const mention = byKey(items, `slack:${I.general}:${T.mention}`)!;
  assert.deepEqual([mention.kind, mention.title, mention.subtitle, mention.unread], ["mention", "#general", "@Owen can you look at the PR?", true]);
  assert.match(mention.url!, /^https:\/\/acme\.slack\.com\/archives\/C0GENERAL\//);
  // A mention in a thread, older than where #general is read to.
  const inThread = byKey(items, `slack:${I.general}:${T.reply1}`)!;
  assert.deepEqual([inThread.kind, inThread.title, inThread.unread], ["mention", "Thread in #general", false]);
  assert.deepEqual(inThread.open, { kind: "slack", conversationId: I.general, ts: T.reply1, threadTs: T.parent });
  // A channel you're not in: its name from search, unread as it's recent and its read state unknown.
  const outside = byKey(items, `slack:${I.outside}:${T.outside}`)!;
  assert.deepEqual([outside.title, outside.unread], ["#outside", true]);
  assert.equal(fake.calls.filter((c) => c.method === "search.messages").at(-1)!.params.query, `<@${I.owen}>`);

  // Search is kept a minute.
  await readSlackActivity();
  assert.equal(fake.count("search.messages"), 1);
  // The thread you were mentioned in is followed, in the data directory's record.
  assert.ok(existsSync(slackActivityFile()));
  assert.ok(JSON.parse(readFileSync(slackActivityFile(), "utf8")).threads[`${I.general}:${T.parent}`]);
});

test("live replies in your threads and live mentions come in", async () => {
  await readSlackActivity();
  const socket = fake.socket()!;
  const reply = nextTs();
  socket.event({ type: "message", channel: I.general, user: I.ria, text: "one more thing", ts: reply, thread_ts: T.parent, parent_user_id: I.owen });
  const mine = nextTs();
  socket.event({ type: "message", channel: I.random, user: I.owen, text: "my reply", ts: mine, thread_ts: T.lunch, parent_user_id: I.sam });
  const theirs = nextTs();
  socket.event({ type: "message", channel: I.random, user: I.sam, text: "thanks", ts: theirs, thread_ts: T.lunch, parent_user_id: I.sam });
  const live = nextTs();
  socket.event({ type: "message", channel: I.random, user: I.ria, text: `ping <@${I.owen}>`, ts: live });
  await settle();
  const items = await readSlackActivity();
  const thread = byKey(items, `slack:${I.general}:${reply}`)!;
  assert.deepEqual(
    [thread.kind, thread.title, thread.subtitle, thread.unread, thread.open],
    ["thread", "Thread in #general", "one more thing", true, { kind: "slack", conversationId: I.general, ts: reply, threadTs: T.parent }],
  );
  // You replied in Sam's thread: his next reply comes in.
  assert.equal(byKey(items, `slack:${I.random}:${theirs}`)!.kind, "thread");
  assert.ok(!byKey(items, `slack:${I.random}:${mine}`));
  assert.equal(byKey(items, `slack:${I.random}:${live}`)!.kind, "mention");
  assert.equal(byKey(items, `slack:${I.random}:${live}`)!.unread, true);
});

test("read moves Slack's read point for DMs and mentions, never backwards; threads are kept here", async () => {
  const items = await readSlackActivity();
  const dm = byKey(items, `slack:${I.dm}:${T.dm2}`)!;
  await writeSlackActivity("read", [dm]);
  assert.deepEqual(fake.calls.filter((c) => c.method === "conversations.mark").map((c) => c.params), [{ channel: I.dm, ts: T.dm2 }]);
  assert.equal(fake.ws.conversations.find((c) => c.id === I.dm)!.last_read, T.dm2);
  const after = await readSlackActivity();
  // A read DM stays a while, as read.
  assert.equal(byKey(after, dm.key)!.unread, false);

  // #general read further elsewhere: reading an older mention doesn't move it back.
  fake.ws.conversations.find((c) => c.id === I.general)!.last_read = T.bot;
  await readConversation(I.general);
  await writeSlackActivity("read", [byKey(after, `slack:${I.general}:${T.mention}`)!]);
  assert.equal(fake.count("conversations.mark"), 1);
  assert.equal(byKey(await readSlackActivity(), `slack:${I.general}:${T.mention}`)!.unread, false);

  // A thread mention: read here only.
  const inThread = { ...byKey(after, `slack:${I.general}:${T.reply1}`)! };
  await writeSlackActivity("unread", [inThread]);
  assert.equal(byKey(await readSlackActivity(), inThread.key)!.unread, true);
  await writeSlackActivity("read", [inThread]);
  assert.equal(byKey(await readSlackActivity(), inThread.key)!.unread, false);
  assert.equal(fake.count("conversations.mark"), 1);
});

test("unread is kept here (Slack can't be told); done leaves Activity", async () => {
  const items = await readSlackActivity();
  const dm = byKey(items, `slack:${I.dm}:${T.dm2}`)!;
  await writeSlackActivity("read", [dm]);
  await writeSlackActivity("unread", [dm]);
  assert.equal(fake.count("conversations.mark"), 1);
  assert.equal(byKey(await readSlackActivity(), dm.key)!.unread, true);
  const mention = byKey(items, `slack:${I.general}:${T.mention}`)!;
  await writeSlackActivity("done", [mention, dm]);
  const left = await readSlackActivity();
  assert.ok(!byKey(left, mention.key));
  assert.ok(!byKey(left, dm.key));
  // Done is read too: #general's read point moved to the mention.
  assert.equal(fake.ws.conversations.find((c) => c.id === I.general)!.last_read, T.mention);
});

test("Slack's refusals and Slack off are SlackErrors", async () => {
  const items = await readSlackActivity();
  fake.fail("conversations.mark", { error: "invalid_auth" });
  await assert.rejects(
    () => writeSlackActivity("read", [byKey(items, `slack:${I.dm}:${T.dm2}`)!]),
    (e: unknown) => e instanceof SlackError && e.kind === "refused",
  );
  fake.fail("search.messages", { error: "missing_scope", needed: "search:read" });
  resetSlackActivity();
  // Without search, the DMs still show (only search's mentions are missing).
  const withoutSearch = await readSlackActivity();
  assert.ok(withoutSearch.some((i) => i.kind === "dm"));
  writeSettings({ integrations: { slack: false } });
  const before = fake.calls.length;
  await assert.rejects(() => readSlackActivity(), (e: unknown) => e instanceof SlackError && e.kind === "no-key" && e.message === DISABLED);
  assert.equal(fake.calls.length, before);
});

test("Done while a read is waiting on Slack isn't undone by that read's save", async () => {
  const items = await readSlackActivity();
  const mention = byKey(items, `slack:${I.general}:${T.mention}`)!;
  resetSlackActivity();
  const { SLACK } = await import("./client");
  const real = SLACK.fetch;
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  SLACK.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("search.messages")) await held;
    return real(url as string, init);
  }) as typeof fetch;
  const reading = readSlackActivity();
  await settle();
  await writeSlackActivity("done", [mention]);
  const followed = nextTs();
  fake.socket()!.event({ type: "message", channel: I.random, user: I.owen, text: "mine", ts: followed, thread_ts: T.lunch });
  await settle();
  release();
  const during = await reading;
  assert.ok(!byKey(during, mention.key));
  const record = JSON.parse(readFileSync(slackActivityFile(), "utf8"));
  assert.ok(record.done.includes(mention.key));
  assert.ok(record.threads[`${I.random}:${T.lunch}`]);
  assert.ok(!byKey(await readSlackActivity(), mention.key));
});

test("reads at the same moment share one mention search", async () => {
  resetSlackActivity();
  await Promise.all([readSlackActivity(), readSlackActivity(), readSlackActivity()]);
  assert.equal(fake.count("search.messages"), 1);
});
