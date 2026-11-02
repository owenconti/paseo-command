import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LinearError, linearBudget, resetLinearClient } from "./client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "./fake";
import { readNotifications, readWorkspace, resetLinearReads } from "./reads";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
});
afterEach(() => fake.restore());

test("reads the workspace's address, people and teams", async () => {
  const ws = await readWorkspace();
  assert.equal(ws.viewerId, I.owen);
  assert.equal(ws.urlKey, "fake");
  assert.equal(ws.users.find((u) => u.id === I.owen)?.me, true);
  assert.equal(ws.users.find((u) => u.id === I.sam)?.me, undefined);
  assert.deepEqual(ws.teams.map((t) => [t.key, t.name]), [["DE", "Design Engineering"], ["ENG", "Engineering"]], "by name");
  assert.equal(linearBudget()?.requestsRemaining, 2500);
});

test("an address that isn't a workspace's is left out", async () => {
  fake.ws.urlKey = "not/a slug";
  assert.equal((await readWorkspace()).urlKey, "");
});

test("keeps the workspace for five minutes unless asked afresh", async () => {
  await readWorkspace();
  await readWorkspace();
  assert.equal(fake.requests.filter((r) => r.operation === "Workspace").length, 1);
  await readWorkspace(true);
  assert.equal(fake.requests.filter((r) => r.operation === "Workspace").length, 2);
});

test("reads your inbox: what each notification is about, newest first, nothing archived", async () => {
  fake.ws.notifications[2].archivedAt = new Date().toISOString();
  fake.ws.notifications[2].updatedAt = new Date().toISOString();
  const { notifications } = await readNotifications();
  assert.deepEqual(
    notifications.map((n) => [n.type, n.issueKey ?? n.projectId, !!n.readAt, !!n.snoozedUntilAt]),
    [
      ["issueNewComment", "ENG-1", false, false],
      ["issueCommentReaction", "ENG-1", false, false],
      ["projectUpdateCreated", I.projects.launch, false, false],
      ["issueSubscribed", "DE-2", false, true],
    ],
  );
  const [comment] = notifications;
  assert.equal(comment.commentBody, "Can we start with the list?");
  assert.equal(comment.actorId, I.sam);
  assert.equal(comment.issueId, I.issues["ENG-1"]);
  assert.equal(notifications[2].issueId, undefined);
  // Page by page: 250 at a time.
  const extra = Array.from({ length: 300 }, (_, n) => ({
    ...fake.ws.notifications[0],
    id: `fa4e0015-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`,
    updatedAt: new Date(Date.now() - (n + 10) * 86_400_000).toISOString(),
  }));
  fake.ws.notifications.push(...extra);
  const first = await readNotifications();
  assert.equal(first.notifications.length, 250);
  assert.ok(first.next);
  const second = await readNotifications(first.next);
  assert.equal(second.notifications.length, 304 - 250);
  assert.equal(second.next, undefined);
});

test("reads fail as LinearErrors", async () => {
  fake.fail("Workspace", { status: 429, message: "slow down" });
  await assert.rejects(readWorkspace(), (e) => e instanceof LinearError && e.kind === "limited" && typeof e.retryAt === "number");
  fake.clear("Workspace");
  assert.ok((await readWorkspace(true)).teams.length);
});
