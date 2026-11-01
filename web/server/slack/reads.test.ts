import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { SlackError } from "./client";
import { FAKE_AVATAR, FAKE_EMOJI, FAKE_IDS as I, FAKE_IMAGE, installFakeSlack, type FakeSlack } from "./fake";
import { slackAvatar } from "./files";
import { readConversation, readHistory, readReplies, readSearch, readWorkspace } from "./reads";

let fake: FakeSlack;
beforeEach(() => {
  fake = installFakeSlack(undefined, { appToken: false });
});
afterEach(() => fake.restore());

const T = I.ts;

test("the workspace: you, people, your conversations named, custom emoji", async () => {
  const ws = await readWorkspace();
  assert.equal(ws.selfId, I.owen);
  assert.equal(ws.teamName, "Acme");
  assert.equal(ws.url, "https://acme.slack.com/");
  const sam = ws.users.find((u) => u.id === I.sam)!;
  assert.deepEqual(sam, {
    id: I.sam,
    name: "Sam",
    realName: "Sam Rivera",
    avatarUrl: FAKE_AVATAR,
    isBot: false,
    deleted: false,
    statusEmoji: "coffee",
    statusText: "Brewing",
    color: "9f69e7",
    timezone: "America/Toronto",
  });
  assert.equal(ws.users.find((u) => u.id === I.ria)!.name, "Ria Patel");
  assert.equal(ws.users.find((u) => u.id === I.bot)!.isBot, true);
  assert.equal(ws.users.find((u) => u.id === "U0GONE")!.deleted, true);
  const byId = new Map(ws.conversations.map((c) => [c.id, c]));
  assert.deepEqual([...byId.keys()].sort(), [I.general, I.random, I.secret, I.dm, I.group].sort());
  assert.equal(byId.get(I.general)!.kind, "channel");
  assert.equal(byId.get(I.general)!.topic, "Company news");
  assert.equal(byId.get(I.secret)!.kind, "private");
  assert.deepEqual([byId.get(I.dm)!.kind, byId.get(I.dm)!.name, byId.get(I.dm)!.userId], ["im", "Sam", I.sam]);
  const group = byId.get(I.group)!;
  assert.equal(group.kind, "mpim");
  assert.deepEqual(group.userIds, [I.sam, I.ria]);
  assert.equal(group.name, "Sam, Ria Patel");
  // Read state isn't known yet: never shown as 0.
  assert.equal(byId.get(I.general)!.unread, undefined);
  assert.equal(byId.get(I.general)!.lastRead, undefined);
  assert.deepEqual(ws.emoji, { "party-parrot": FAKE_EMOJI, parrot: "alias:party-parrot", loop: "alias:loop", evil: "https://evil.example/evil.png" });
  assert.deepEqual(ws.live, { mode: "polling", reason: "Add a Slack app token in Settings for live updates; messages refresh every 20 s." });
});

test("the workspace is kept ten minutes; fresh asks again; emoji are optional", async () => {
  await readWorkspace();
  await readWorkspace();
  assert.equal(fake.count("users.list"), 1);
  await readWorkspace(true);
  assert.equal(fake.count("users.list"), 2);
  fake.fail("emoji.list", { error: "missing_scope", needed: "emoji:read" });
  assert.deepEqual((await readWorkspace(true)).emoji, {});
  fake.fail("users.list", { error: "invalid_auth" });
  await assert.rejects(() => readWorkspace(true), (e: unknown) => e instanceof SlackError && e.kind === "refused");
});

test("people and conversations are read page by page", async () => {
  for (let i = 0; i < 450; i++)
    fake.ws.users.push({ id: `U1${String(i).padStart(4, "0")}`, name: `p${i}`, real_name: `P ${i}`, profile: { display_name: "", real_name: `P ${i}` } });
  const ws = await readWorkspace();
  assert.equal(ws.users.length, 455);
  assert.equal(fake.count("users.list"), 3);
  assert.equal(fake.calls.find((c) => c.method === "users.list")!.params.limit, "200");
  const conv = fake.calls.find((c) => c.method === "users.conversations")!.params;
  assert.equal(conv.types, "public_channel,private_channel,mpim,im");
  assert.equal(conv.exclude_archived, "true");
});

test("history: oldest first, 50 a page, before is exclusive; the blocks the page draws are kept", async () => {
  const h = await readHistory(I.general);
  assert.deepEqual(
    h.messages.map((m) => m.ts),
    [T.join, T.morning, T.parent, T.image, T.mention, T.bot],
  );
  assert.equal(h.more, false);
  const call = fake.calls.find((c) => c.method === "conversations.history")!.params;
  assert.equal(call.limit, "50");
  const parent = h.messages.find((m) => m.ts === T.parent)!;
  assert.equal(parent.threadTs, T.parent);
  assert.equal(parent.replyCount, 2);
  assert.deepEqual(parent.replyUserIds, [I.sam, I.ria]);
  assert.equal(parent.latestReply, T.reply2);
  assert.equal(parent.blocks!.length, 2);
  // A button without an address only works in Slack: kept, as its label.
  assert.deepEqual(parent.blocks![1], { type: "actions", block_id: "b2", buttons: [{ text: "Click" }] });
  const section = parent.blocks![0].elements![0];
  assert.deepEqual(section.elements![1], { type: "text", text: "Friday", style: { bold: true } });
  assert.equal(parent.blocks![0].elements![1].list_style, "bullet");
  const bot = h.messages.find((m) => m.ts === T.bot)!;
  assert.deepEqual(bot.blocks, [{ type: "section", text: { type: "mrkdwn", text: "*Build* passed" } }, { type: "divider" }]);
  assert.equal(bot.botName, "CI");
  assert.equal(bot.subtype, "bot_message");
  assert.deepEqual(bot.attachments, [{ title: "Run 42", text: "All green", url: "https://ci.example/run/42", color: "#2eb886" }]);
  const image = h.messages.find((m) => m.ts === T.image)!;
  assert.deepEqual(image.files![0], {
    id: I.image,
    name: "chart.png",
    title: "chart.png",
    mimetype: "image/png",
    filetype: "png",
    size: 1234,
    url: FAKE_IMAGE,
    thumbUrl: FAKE_IMAGE.replace(".png", "_360.png"),
    width: 800,
    height: 600,
    permalink: `https://acme.slack.com/files/${I.sam}/${I.image}/chart.png`,
  });
  assert.deepEqual(image.reactions, [{ name: "thumbsup", count: 2, userIds: [I.sam, I.owen] }]);
  const older = await readHistory(I.general, T.image);
  assert.deepEqual(older.messages.map((m) => m.ts), [T.join, T.morning, T.parent]);
  await assert.rejects(() => readHistory("nope"), (e: unknown) => e instanceof SlackError && e.kind === "invalid");
  await assert.rejects(() => readHistory(I.general, "123"), (e: unknown) => e instanceof SlackError && e.kind === "invalid");
});

test("replies: the parent and replies oldest first, after exclusive", async () => {
  const t = await readReplies(I.general, T.parent);
  assert.equal(t.parent!.ts, T.parent);
  assert.deepEqual(t.replies.map((m) => m.ts), [T.reply1, T.reply2]);
  assert.equal(t.replies[0].threadTs, T.parent);
  const later = await readReplies(I.general, T.parent, T.reply1);
  assert.deepEqual(later.replies.map((m) => m.ts), [T.reply2]);
  fake.fail("conversations.replies", { error: "thread_not_found" });
  await assert.rejects(() => readReplies(I.general, T.parent), (e: unknown) => e instanceof SlackError && e.kind === "invalid");
});

test("one conversation, with where you've read to", async () => {
  const c = await readConversation(I.general);
  assert.equal(c.lastRead, T.image);
  assert.equal(c.latest, T.bot);
  assert.equal(c.name, "general");
  const dm = await readConversation(I.dm);
  assert.equal(dm.name, "Sam");
});

test("search: newest first, with permalinks and threads from them", async () => {
  const s = await readSearch("  you  ");
  assert.equal(s.term, "you");
  assert.deepEqual(s.messages.map((m) => m.ts), [T.dm2, T.mention, T.dmOld]);
  assert.equal(s.total, 3);
  assert.equal(s.messages[1].conversationId, I.general);
  assert.match(s.messages[1].permalink!, /^https:\/\/acme\.slack\.com\/archives\/C0GENERAL\/p/);
  const call = fake.calls.find((c) => c.method === "search.messages")!.params;
  assert.equal(call.sort, "timestamp");
  const reply = await readSearch("Yes");
  assert.equal(reply.messages[0].threadTs, T.parent);
  await assert.rejects(() => readSearch(" "), (e: unknown) => e instanceof SlackError && e.kind === "invalid");
});

test("everything users.conversations lists is yours (Slack leaves is_member out there); counts come from conversations.info", async () => {
  const listed = await readWorkspace();
  assert.ok(fake.calls.some((c) => c.method === "users.conversations"));
  assert.ok(listed.conversations.every((c) => c.isMember));
  assert.equal(listed.conversations.find((c) => c.id === I.general)!.memberCount, undefined);
  const general = await readConversation(I.general);
  assert.equal(general.isMember, true);
  assert.equal(general.memberCount, 4);
  assert.equal(fake.calls.filter((c) => c.method === "conversations.info").at(-1)!.params.include_num_members, "true");
});

test("reads at the same moment share one workspace sweep", async () => {
  const all = await Promise.all([readWorkspace(), readWorkspace(), readWorkspace(true)]);
  assert.equal(fake.count("users.list"), 1);
  assert.equal(fake.count("users.conversations"), 1);
  assert.equal(fake.count("auth.test"), 1);
  assert.ok(all.every((w) => w.users.length === all[0].users.length));
  // A failed sweep isn't kept: the next read asks again.
  fake.fail("users.list", { error: "internal_error" });
  await assert.rejects(() => readWorkspace(true));
  fake.clear("users.list");
  assert.ok(await readWorkspace(true));
});

test("people from elsewhere (a shared channel's): from a message's own profile, else users.info once each", async () => {
  const at = (n: number) => `17300000${n}0.000100`;
  fake.ws.messages.push(
    // Jo's message carries her profile; Kim's doesn't (users.info knows her); nobody's is unknown to Slack too.
    { channel: I.random, ts: at(1), user: "U0JO", text: "Has anyone got access?", user_profile: { name: "jo", display_name: "Jo", real_name: "Jo Lee", image_72: "https://avatars.slack-edge.com/fake/jo_72.png" }, reply_users: ["U0KIM"], reactions: [{ name: "eyes", count: 1, users: ["U0NOBODY"] }] },
    { channel: I.random, ts: at(2), user: "U0KIM", text: "Yes" },
  );
  const first = await readHistory(I.random);
  assert.deepEqual(first.users?.map((u) => [u.id, u.name, u.avatarUrl]).sort(), [
    ["U0JO", "Jo", "https://avatars.slack-edge.com/fake/jo_72.png"],
    ["U0KIM", "Kim Park", undefined],
  ]);
  // Asked about Kim and the unknown one, not Jo (her message said); members never.
  assert.deepEqual(fake.calls.filter((c) => c.method === "users.info").map((c) => c.params.user).sort(), ["U0KIM", "U0NOBODY"]);
  // Kept: read again, nobody is asked about again; the workspace's members are never in `users`.
  await readHistory(I.random);
  assert.equal(fake.count("users.info"), 2);
  const general = await readHistory(I.general);
  assert.equal(general.users, undefined);
  // Their avatars load too, from the address Slack gave.
  assert.equal((await slackAvatar("U0JO")).status, 200);
  assert.equal((await slackAvatar("U0KIM")).status, 404, "no avatar");
});

test("a bot that posts with only its bot_id is named from bots.info, once, with its avatar", async () => {
  const at = (n: number) => `17300000${n}0.000200`;
  fake.ws.messages.push(
    { channel: I.random, ts: at(1), subtype: "bot_message", bot_id: "B0ALERTS", text: "CI failed" },
    { channel: I.random, ts: at(2), subtype: "bot_message", bot_id: "B0ALERTS", text: "CI failed again" },
    { channel: I.random, ts: at(3), subtype: "bot_message", bot_id: "B0GONE", text: "From nowhere" },
  );
  const h = await readHistory(I.random);
  const named = h.messages.filter((m) => m.botId === "B0ALERTS");
  assert.deepEqual(named.map((m) => m.botName), ["Alerts", "Alerts"]);
  assert.equal(h.messages.find((m) => m.botId === "B0GONE")!.botName, undefined);
  assert.deepEqual(h.users?.map((u) => [u.id, u.name, u.isBot]), [["B0ALERTS", "Alerts", true]]);
  await readHistory(I.random);
  assert.deepEqual(fake.calls.filter((c) => c.method === "bots.info").map((c) => c.params.bot).sort(), ["B0ALERTS", "B0GONE"]);
  assert.equal((await slackAvatar("B0ALERTS")).status, 200);
});

test("a group DM with people from elsewhere: its members asked for, and named", async () => {
  // Slack names it by handles; jo and kim's aren't the workspace's.
  fake.ws.conversations.push({
    id: "G0SHARED",
    name: "mpdm-owen--sam--jo--kim-1",
    is_mpim: true,
    is_group: true,
    is_member: true,
    members: [I.owen, I.sam, "U0JO", "U0KIM"],
    last_read: "0000000000.000000",
  });
  const ws = await readWorkspace(true);
  const shared = ws.conversations.find((c) => c.id === "G0SHARED")!;
  assert.deepEqual(shared.userIds, [I.sam, "U0JO", "U0KIM"]);
  assert.equal(shared.name, "Sam, Jo, Kim Park");
  assert.deepEqual(ws.users.filter((u) => ["U0JO", "U0KIM"].includes(u.id)).map((u) => u.name).sort(), ["Jo", "Kim Park"]);
  // Only the group DM with a stranger's handle was asked about.
  assert.deepEqual(fake.calls.filter((c) => c.method === "conversations.members").map((c) => c.params.channel), ["G0SHARED"]);
  // The workspace's own group DM is named from its handles, as before.
  assert.deepEqual(ws.conversations.find((c) => c.id === I.group)!.userIds?.sort(), [I.ria, I.sam].sort());
});

test("a group DM whose members can't be asked for still names the handles it has", async () => {
  fake.ws.conversations.push({ id: "G0SHARED", name: "mpdm-owen--sam--jo-1", is_mpim: true, is_group: true, is_member: true, last_read: "0000000000.000000" });
  fake.fail("conversations.members", { error: "missing_scope" });
  const ws = await readWorkspace(true);
  assert.equal(ws.conversations.find((c) => c.id === "G0SHARED")!.name, "Sam, jo");
});
