import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { SlackError } from "./client";
import { FAKE_IDS as I, installFakeSlack, type FakeSlack } from "./fake";
import { toMrkdwn } from "./mrkdwn";
import { readWorkspace } from "./reads";
import { slackUnreads, tickSlackUnreads } from "./unreads";
import { uploadToSlack } from "./upload";
import { WRITES, slackWrite } from "./writes";

let fake: FakeSlack;
beforeEach(() => {
  fake = installFakeSlack(undefined, { appToken: false });
});
afterEach(() => fake.restore());

const T = I.ts;
const invalid = (pattern?: RegExp) => (e: unknown) => e instanceof SlackError && e.kind === "invalid" && (!pattern || pattern.test(e.message));
const last = (method: string) => fake.calls.filter((c) => c.method === method).at(-1)!.params;

test("exactly the shared write names", () => {
  assert.deepEqual(Object.keys(WRITES).sort(), ["delete", "edit", "mark", "openDm", "post", "react", "share", "unreact"]);
});

test("every input is checked field by field before anything is sent", async () => {
  const bad: [string, unknown, RegExp][] = [
    ["nope", {}, /Unknown write/],
    ["post", null, /Expected an object/],
    ["post", [], /Expected an object/],
    ["post", { conversationId: I.general }, /Missing field markdown/],
    ["post", { conversationId: I.general, markdown: "hi", extra: 1 }, /Unexpected field extra/],
    ["post", { conversationId: "general", markdown: "hi" }, /conversation id/],
    ["post", { conversationId: I.general, markdown: "   " }, /characters/],
    ["post", { conversationId: I.general, markdown: "x".repeat(12_001) }, /characters/],
    ["post", { conversationId: I.general, markdown: "hi", threadTs: "1.2" }, /message ts/],
    ["post", { conversationId: I.general, markdown: "hi", broadcast: true }, /needs threadTs/],
    ["post", { conversationId: I.general, markdown: "hi", threadTs: T.parent, broadcast: "yes" }, /true or false/],
    ["edit", { conversationId: I.general, ts: T.parent }, /Missing field markdown/],
    ["delete", { conversationId: I.general, ts: "now" }, /message ts/],
    ["react", { conversationId: I.general, ts: T.image, name: "no spaces" }, /emoji name/],
    ["react", { conversationId: I.general, ts: T.image, name: "::" }, /emoji name/],
    ["mark", { conversationId: "U0SAM", ts: T.image }, /conversation id/],
    ["openDm", { userIds: [] }, /1 to 8/],
    ["openDm", { userIds: [I.sam, I.sam] }, /repeat/],
    ["openDm", { userIds: ["C0GENERAL"] }, /user ids/],
    ["openDm", { userIds: Array.from({ length: 9 }, (_, i) => `U0X${i}`) }, /1 to 8/],
    ["share", { conversationId: I.general, fileIds: ["nope"] }, /file ids/],
    ["share", { conversationId: I.general, fileIds: [] }, /file ids/],
  ];
  for (const [name, input, message] of bad) await assert.rejects(() => slackWrite(name, input), invalid(message), `${name} ${JSON.stringify(input)?.slice(0, 80)}`);
  assert.equal(fake.calls.length, 0);
});

test("post: Markdown as markdown_text, in threads and broadcast", async () => {
  const r = await slackWrite("post", { conversationId: I.general, markdown: "**hello**" });
  assert.equal(r.message!.text, "**hello**");
  assert.equal(r.message!.conversationId, I.general);
  assert.equal(r.message!.userId, I.owen);
  assert.deepEqual(last("chat.postMessage"), { channel: I.general, markdown_text: "**hello**" });
  const reply = await slackWrite("post", { conversationId: I.general, markdown: "also", threadTs: T.parent, broadcast: true });
  assert.equal(reply.message!.threadTs, T.parent);
  assert.equal(reply.message!.subtype, "thread_broadcast");
  assert.deepEqual(last("chat.postMessage"), { channel: I.general, markdown_text: "also", thread_ts: T.parent, reply_broadcast: true });
  fake.fail("chat.postMessage", { error: "not_in_channel" });
  await assert.rejects(() => slackWrite("post", { conversationId: I.general, markdown: "x" }), invalid(/not in that channel/));
});

test("edit: markdown_text, else mrkdwn text when Slack refuses it", async () => {
  const r = await slackWrite("edit", { conversationId: I.general, ts: T.parent, markdown: "ship **Monday**" });
  assert.equal(r.message!.text, "ship **Monday**");
  assert.ok(r.message!.edited);
  fake.ws.refuseMarkdownUpdate = true;
  const again = await slackWrite("edit", { conversationId: I.general, ts: T.parent, markdown: "ship **Tuesday**" });
  assert.equal(again.message!.text, "ship *Tuesday*");
  assert.deepEqual(last("chat.update"), { channel: I.general, ts: T.parent, text: "ship *Tuesday*" });
  await assert.rejects(
    () => slackWrite("edit", { conversationId: I.general, ts: T.morning, markdown: "not mine" }),
    invalid(/won't let you edit/),
  );
});

test("delete", async () => {
  assert.deepEqual(await slackWrite("delete", { conversationId: I.general, ts: T.parent }), { ok: true });
  assert.ok(!fake.ws.messages.some((m) => m.ts === T.parent));
});

test("react and unreact answer the message's reactions now; repeats are fine", async () => {
  const r = await slackWrite("react", { conversationId: I.general, ts: T.image, name: ":tada:" });
  assert.deepEqual(r.reactions, [
    { name: "thumbsup", count: 2, userIds: [I.sam, I.owen] },
    { name: "tada", count: 1, userIds: [I.owen] },
  ]);
  assert.equal(last("reactions.add").name, "tada");
  assert.deepEqual((await slackWrite("react", { conversationId: I.general, ts: T.image, name: "tada" })).reactions!.length, 2);
  const un = await slackWrite("unreact", { conversationId: I.general, ts: T.image, name: "thumbsup" });
  assert.deepEqual(un.reactions![0], { name: "thumbsup", count: 1, userIds: [I.sam] });
  assert.ok(await slackWrite("unreact", { conversationId: I.general, ts: T.image, name: "thumbsup" }));
  await assert.rejects(() => slackWrite("react", { conversationId: I.general, ts: T.image, name: "nonesuch" }), invalid(/emoji/));
  fake.fail("reactions.get", { error: "internal_error" });
  assert.deepEqual(await slackWrite("react", { conversationId: I.general, ts: T.image, name: "party-parrot" }), { ok: true });
});

test("mark: Slack's read point and the unread tracker", async () => {
  await readWorkspace();
  for (let i = 0; i < 5; i++) await tickSlackUnreads();
  assert.equal(slackUnreads().conversations.find((c) => c.id === I.dm)!.unread, 2);
  assert.deepEqual(await slackWrite("mark", { conversationId: I.dm, ts: T.dm2 }), { ok: true });
  assert.equal(fake.ws.conversations.find((c) => c.id === I.dm)!.last_read, T.dm2);
  assert.equal(slackUnreads().conversations.find((c) => c.id === I.dm)!.unread, 0);
});

test("openDm: a DM with one person, a group DM with several", async () => {
  const dm = await slackWrite("openDm", { userIds: [I.sam] });
  assert.deepEqual([dm.conversation!.id, dm.conversation!.kind, dm.conversation!.name], [I.dm, "im", "Sam"]);
  const group = await slackWrite("openDm", { userIds: [I.sam, I.ria] });
  assert.equal(group.conversation!.kind, "mpim");
  assert.deepEqual(group.conversation!.userIds, [I.sam, I.ria]);
  assert.equal(group.conversation!.name, "Sam, Ria Patel");
  // It's kept: the workspace now lists it.
  assert.ok((await readWorkspace()).conversations.some((c) => c.id === group.conversation!.id));
  await assert.rejects(() => slackWrite("openDm", { userIds: ["U0NOBODY"] }), invalid());
});

test("share: an uploaded file into a thread with a comment", async () => {
  const up = await uploadToSlack(Buffer.from("hello"), "notes.txt", "text/plain");
  await slackWrite("share", { conversationId: I.general, fileIds: [up.id], markdown: "see **this**", threadTs: T.parent });
  const p = last("files.completeUploadExternal");
  assert.deepEqual(JSON.parse(String(p.files)), [{ id: up.id }]);
  assert.deepEqual([p.channel_id, p.thread_ts, p.initial_comment], [I.general, T.parent, "see *this*"]);
  const posted = fake.ws.messages.at(-1)!;
  assert.equal(posted.thread_ts, T.parent);
  assert.equal((posted.files as { id: string }[])[0].id, up.id);
  await assert.rejects(() => slackWrite("share", { conversationId: I.general, fileIds: ["F0NOPE"] }), invalid(/can't find that file/));
});

test("writes go out while Slack has the method cooling down", async () => {
  fake.fail("chat.postMessage", { error: "ratelimited", status: 429, retryAfter: 30 });
  await assert.rejects(() => slackWrite("post", { conversationId: I.general, markdown: "a" }), (e: unknown) => e instanceof SlackError && e.kind === "limited");
  fake.clear("chat.postMessage");
  assert.ok((await slackWrite("post", { conversationId: I.general, markdown: "b" })).message);
});

test("Markdown to mrkdwn", () => {
  assert.equal(toMrkdwn("**bold** and *it* and _it_ and ~~gone~~"), "*bold* and _it_ and _it_ and ~gone~");
  assert.equal(toMrkdwn("__bold__"), "*bold*");
  assert.equal(toMrkdwn("[Paseo](https://paseo.dev/?a=1&b=2)"), "<https://paseo.dev/?a=1&b=2|Paseo>");
  assert.equal(toMrkdwn("a < b & c > d"), "a &lt; b &amp; c &gt; d");
  assert.equal(toMrkdwn("`**not bold**` and `<x>`"), "`**not bold**` and `&lt;x&gt;`");
  assert.equal(toMrkdwn("```js\nconst a = **b**;\n```"), "```\nconst a = **b**;\n```");
  assert.equal(toMrkdwn("- one\n* two\n  + nested\n1. first"), "• one\n• two\n  • nested\n1. first");
  assert.equal(toMrkdwn("- [ ] todo\n- [x] done"), "☐ todo\n☑ done");
  assert.equal(toMrkdwn("# Title\n> quoted"), "*Title*\n> quoted");
  assert.equal(toMrkdwn("snake_case_name stays"), "snake_case_name stays");
  assert.equal(toMrkdwn("2 * 3 * 4"), "2 * 3 * 4");
});
