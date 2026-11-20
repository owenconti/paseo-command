/**
 * What notified you on a GitHub thread, over the fake GitHub API: nothing here reaches GitHub.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { ActivityItem } from "../../src/activity/types";
import { forget } from "../github/client";
import { installGithubApi, type FakeAnswer, type FakeRequest } from "../githubFake";
import { addSaid, mentions, plainText, resetSaid, type ThreadRefs } from "./said";

let fake: ReturnType<typeof installGithubApi>;
let routes: Record<string, unknown> = {};
const API = "https://api.github.com/repos/o/r";

beforeEach(() => {
  resetSaid();
  forget("viewer");
  routes = { user: { login: "owen", name: "Owen", avatar_url: "https://avatars.githubusercontent.com/u/1" } };
  fake = installGithubApi((req: FakeRequest): FakeAnswer => {
    const json = routes[req.path];
    return json === undefined ? { status: 404, json: { message: "Not Found" } } : { json };
  });
});
afterEach(() => fake.restore());

const user = (login: string) => ({ login, avatar_url: `https://avatars.githubusercontent.com/u/${login.length}` });
const item = (o: Partial<ActivityItem> = {}): ActivityItem => ({
  key: "github:1",
  source: "github",
  id: "1",
  kind: "mention",
  title: "Add undo",
  subject: "pull",
  at: "2026-11-20T10:00:00Z",
  unread: true,
  ...o,
});
const refsOf = (r: ThreadRefs) => new Map([["1", r]]);

test("Markdown reads as one plain line", () => {
  assert.equal(
    plainText("> earlier words\n\n**Hey** [@owen](https://x) can you look?\n```ts\nx()\n```\n![s](u) <!-- hidden -->`done`"),
    "Hey @owen can you look? [code] done",
  );
  assert.equal(plainText("a".repeat(20), 10), `${"a".repeat(9)}…`);
});

test("a mention is of the login, not a longer one or an address", () => {
  assert.ok(mentions("cc @Owen, please", "owen"));
  assert.ok(!mentions("cc @owen-bot", "owen"));
  assert.ok(!mentions("mail owen@x.com", "owen"));
  assert.ok(!mentions("@org/owen", "owen"));
});

test("the latest comment, when it mentions you: who and what, its address", async () => {
  routes["repos/o/r/issues/comments/9"] = {
    body: "@owen can you check the redo stack?",
    user: user("sam"),
    html_url: "https://github.com/o/r/pull/1#issuecomment-9",
    created_at: "2026-11-20T09:59:00Z",
  };
  const i = item();
  await addSaid([i], refsOf({ latestCommentUrl: `${API}/issues/comments/9`, subjectUrl: `${API}/pulls/1` }));
  assert.deepEqual(i.said, {
    what: "comment",
    text: "@owen can you check the redo stack?",
    url: "https://github.com/o/r/pull/1#issuecomment-9",
  });
  assert.deepEqual(i.actor, { name: "sam", avatarUrl: "https://avatars.githubusercontent.com/u/3" });
});

test("else the newest comment since you read it that does, of comments, line comments and reviews", async () => {
  routes["repos/o/r/issues/comments/9"] = { body: "Thanks!", user: user("probe[bot]"), created_at: "2026-11-20T09:59:00Z" };
  routes["repos/o/r/issues/1/comments"] = [
    { body: "@owen first", user: user("sam"), created_at: "2026-11-20T08:00:00Z" },
  ];
  routes["repos/o/r/pulls/1/comments"] = [
    { body: "@owen is this right?", path: "src/undo.ts", user: user("ada"), created_at: "2026-11-20T09:00:00Z" },
  ];
  routes["repos/o/r/pulls/1/reviews"] = [];
  routes["repos/o/r/pulls/1"] = { body: "Fixes it", user: user("ada") };
  const i = item();
  await addSaid([i], refsOf({ latestCommentUrl: `${API}/issues/comments/9`, subjectUrl: `${API}/pulls/1`, lastReadAt: "2026-11-20T07:00:00Z" }));
  assert.equal(i.said?.what, "line comment");
  assert.equal(i.said?.path, "src/undo.ts");
  assert.equal(i.actor?.name, "ada");
  const since = fake.calls.find((c) => c.path === "repos/o/r/issues/1/comments")!.query.get("since");
  assert.equal(since, "2026-11-20T07:00:00.000Z");
});

test("activity on your thread: a review's verdict, never your own words", async () => {
  routes["repos/o/r/pulls/1"] = { body: "My PR", user: user("owen") };
  routes["repos/o/r/issues/1/comments"] = [{ body: "Me again", user: user("owen"), created_at: "2026-11-20T09:50:00Z" }];
  routes["repos/o/r/pulls/1/comments"] = [];
  routes["repos/o/r/pulls/1/reviews"] = [
    { body: "", state: "CHANGES_REQUESTED", user: user("sam"), submitted_at: "2026-11-20T09:40:00Z", html_url: "https://github.com/o/r/pull/1#pullrequestreview-5" },
  ];
  const i = item({ kind: "author" });
  await addSaid([i], refsOf({ latestCommentUrl: `${API}/pulls/1`, subjectUrl: `${API}/pulls/1`, lastReadAt: "2026-11-20T09:00:00Z" }));
  assert.deepEqual(i.said, { what: "review", text: "", verdict: "changes requested", url: "https://github.com/o/r/pull/1#pullrequestreview-5" });
  assert.equal(i.actor?.name, "sam");
});

test("kept per thread until it changes; a thread GitHub can't answer for is left without", async () => {
  routes["repos/o/r/issues/comments/9"] = { body: "@owen hi", user: user("sam") };
  const refs = refsOf({ latestCommentUrl: `${API}/issues/comments/9`, subjectUrl: `${API}/pulls/1` });
  await addSaid([item()], refs);
  const asked = fake.calls.length;
  const again = item();
  await addSaid([again], refs);
  assert.equal(fake.calls.length, asked);
  assert.equal(again.said?.text, "@owen hi");
  delete routes["repos/o/r/issues/comments/9"];
  const changed = item({ at: "2026-11-20T11:00:00Z" });
  await addSaid([changed], refs);
  assert.equal(changed.said, undefined);
});
