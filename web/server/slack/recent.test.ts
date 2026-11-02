import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { noteSlackActivityMessage, readRecentThreads, readSlackActivity } from "../activity/slack";
import { readSettings, settingsFile, writeSettings } from "../settings";
import { SlackError } from "./client";
import { FAKE_IDS as I, installFakeSlack, nextTs, type FakeSlack } from "./fake";
import { readWorkspace } from "./reads";
import { readSlackSections } from "./sections";
import { slackWrite } from "./writes";

let fake: FakeSlack;
beforeEach(async () => {
  fake = installFakeSlack(undefined, { appToken: false });
  await readWorkspace();
});
afterEach(() => fake.restore());

const T = I.ts;
const invalid = (pattern: RegExp) => (e: unknown) => e instanceof SlackError && e.kind === "invalid" && pattern.test(e.message);

test("Recent's threads: those you're in, newest first, with their parent's first words, asked of Slack once", async () => {
  assert.deepEqual(await readRecentThreads(), []);
  // You reply in #general's thread: it's yours, read to your reply.
  await slackWrite("post", { conversationId: I.general, markdown: "On it", threadTs: T.parent });
  let [thread] = await readRecentThreads();
  assert.equal(thread.conversationId, I.general);
  assert.equal(thread.threadTs, T.parent);
  assert.equal(thread.text, "Shall we ship *Friday*?");
  assert.equal(thread.unread, false);
  const asked = fake.count("conversations.replies");
  assert.equal(asked, 1);

  // Sam replies, mentioning you: newest, unread, a mention; the words aren't asked for again.
  const ts = nextTs();
  noteSlackActivityMessage({ ts, conversationId: I.general, threadTs: T.parent, userId: I.sam, text: `<@${I.owen}> done` });
  [thread] = await readRecentThreads();
  assert.deepEqual([thread.latest, thread.unread, thread.mention], [ts, true, true]);
  assert.equal(fake.count("conversations.replies"), asked);
  const activity = (await readSlackActivity()).find((i) => i.id === `${I.general}:${ts}`)!;
  assert.equal(activity.unread, true);

  // Read in the Slack tab: read here and in Activity.
  await slackWrite("readThread", { conversationId: I.general, threadTs: T.parent, ts });
  [thread] = await readRecentThreads();
  assert.equal(thread.unread, false);
  assert.equal(thread.mention, undefined);
  assert.equal((await readSlackActivity()).find((i) => i.id === `${I.general}:${ts}`)!.unread, false);
});

test("a parent Slack won't give isn't asked for again soon; a limit stops the asking", async () => {
  noteSlackActivityMessage({ ts: nextTs(), conversationId: I.general, threadTs: T.parent, userId: I.owen, text: "mine" });
  fake.fail("conversations.replies", { error: "thread_not_found" });
  const [thread] = await readRecentThreads();
  assert.equal(thread.text, undefined);
  await readRecentThreads();
  assert.equal(fake.count("conversations.replies"), 1);
});

test("sections are kept per workspace in settings.json, checked, keeping the file's other keys", async () => {
  writeSettings({ presets: [{ name: "x", prompt: "y" }] });
  const sections = [
    { id: "sa1", name: " Team ", conversationIds: [I.general, I.dm] },
    { id: "sb2", name: "Later", conversationIds: [] },
  ];
  const saved = await slackWrite("sections", { sections });
  assert.deepEqual(saved.sections, [
    { id: "sa1", name: "Team", conversationIds: [I.general, I.dm] },
    { id: "sb2", name: "Later", conversationIds: [] },
  ]);
  const file = readSettings()!;
  assert.deepEqual(file.presets, [{ name: "x", prompt: "y" }]);
  assert.deepEqual(Object.keys(file.slackSections as object), [I.team]);
  assert.deepEqual(readSlackSections(I.team), saved.sections);
  assert.deepEqual((await readWorkspace()).sections, saved.sections);

  for (const [input, why] of [
    [{ sections: "no" }, /a list/],
    [{ sections: [{ id: "bad id", name: "x", conversationIds: [] }] }, /section id/],
    [{ sections: [{ id: "sa1", name: "", conversationIds: [] }] }, /name/],
    [{ sections: [{ id: "sa1", name: "x", conversationIds: ["general"] }] }, /conversation ids/],
    [{ sections: [{ id: "sa1", name: "x", conversationIds: [I.general] }, { id: "sb2", name: "y", conversationIds: [I.general] }] }, /one section/],
    [{ sections: [{ id: "sa1", name: "x", conversationIds: [], extra: 1 }] }, /Unexpected field/],
    [{ sections: [], more: 1 }, /Unexpected field/],
  ] as const)
    await assert.rejects(slackWrite("sections", input), invalid(why));

  // An unreadable settings file is never overwritten.
  writeFileSync(settingsFile(), "{ not json");
  // (Slack's on/off lives in that file too, so Slack is off until it's fixed.)
  await assert.rejects(slackWrite("sections", { sections: [] }), (e: unknown) => e instanceof SlackError);
  assert.equal(readFileSync(settingsFile(), "utf8"), "{ not json");
});
