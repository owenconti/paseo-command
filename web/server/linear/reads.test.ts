import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { saveSecret } from "../secrets";
import { readSettings, writeSettings } from "../settings";
import { DISABLED, LinearError, linearBudget, NO_KEY, resetLinearClient } from "./client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "./fake";
import { countIssues, isBlocked, readIssueCounts, readNotifications, readWorkspace, resetLinearReads } from "./reads";

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

test("counts your assigned issues: done in 14 days, in progress, todo, blocked", async () => {
  const answer = await readIssueCounts();
  assert.equal(answer.state, "ok");
  if (answer.state !== "ok") return;
  assert.deepEqual(answer.counts, { done: 11, inProgress: 8, todo: 8, blocked: 3 });
  assert.equal(answer.items.done.length, 11);
  assert.deepEqual(answer.items.done[0], { id: "DE-1", title: "Issue 1", url: "https://linear.app/fake/issue/DE-1/issue-1", status: "Done" }, "the newest completed first");
  assert.deepEqual(answer.items.blocked.map((i) => i.id), ["DE-28", "DE-29", "DE-30"], "a Blocked state, and blocked by an open issue");
  assert.ok(answer.items.inProgress.some((i) => i.id === "DE-19"), "blocked only by a completed issue: in progress");
  const asked = fake.requests.find((r) => r.operation === "AssignedIssues")!;
  assert.equal(asked.variables.first, 250);
  assert.ok(Math.abs(Date.parse(String(asked.variables.since)) - (Date.now() - 14 * 86_400_000)) < 5_000);
});

test("pages through every assigned issue; past 2,000 the counts are at least", async () => {
  const now = Date.now();
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      identifier: `ENG-${i + 1}`,
      title: `Issue ${i + 1}`,
      url: `https://linear.app/fake/issue/ENG-${i + 1}`,
      updatedAt: new Date(now - i * 1000).toISOString(),
      completedAt: null,
      state: { type: (i % 2 ? "started" : "unstarted") as "started" | "unstarted", name: "x" },
      labels: { nodes: [] },
      inverseRelations: { nodes: [] },
    }));
  fake.ws.assignedIssues = make(600);
  let answer = await readIssueCounts(true);
  assert.ok(answer.state === "ok");
  assert.deepEqual([answer.counts.inProgress, answer.counts.todo], [300, 300], "three pages, every issue");
  assert.equal(answer.atLeast, undefined);
  assert.deepEqual(fake.requests.filter((r) => r.operation === "AssignedIssues").map((r) => r.variables.after ?? null), [null, "250", "500"]);
  fake.ws.assignedIssues = make(2300);
  answer = await readIssueCounts(true);
  assert.ok(answer.state === "ok");
  assert.equal(answer.counts.inProgress + answer.counts.todo, 2000, "stops at the cap");
  assert.deepEqual(answer.atLeast, ["done", "inProgress", "todo", "blocked"]);
});

test("lists at most 12 of a group, titles clipped to 120; counts stay whole", async () => {
  const now = Date.now();
  fake.ws.assignedIssues = Array.from({ length: 30 }, (_, n) => ({
    identifier: `ENG-${n + 1}`,
    title: "x".repeat(200),
    url: `https://linear.app/fake/issue/ENG-${n + 1}`,
    updatedAt: new Date(now - n * 1000).toISOString(),
    completedAt: null,
    state: { type: "unstarted" as const, name: "Todo" },
    labels: { nodes: [] },
    inverseRelations: { nodes: [] },
  }));
  const answer = await readIssueCounts();
  assert.ok(answer.state === "ok");
  assert.equal(answer.counts.todo, 30);
  assert.equal(answer.items.todo.length, 12);
  assert.equal(answer.items.todo[0].id, "ENG-1");
  assert.equal(answer.items.todo[0].title.length, 120);
  assert.ok(answer.items.todo[0].title.endsWith("…"));
});

test("blocked: a Blocked state or label (any case), or an open issue blocking it; counted only as blocked", () => {
  const issue = (o: Record<string, unknown>) => ({ identifier: "DE-1", title: "T", url: "https://linear.app/fake/issue/DE-1", state: { type: "started", name: "In Progress" }, ...o });
  const by = (type: string, relation = "blocks") => ({ nodes: [{ type: relation, issue: { state: { type } } }] });
  assert.equal(isBlocked(issue({})), false);
  assert.equal(isBlocked(issue({ state: { type: "unstarted", name: "BLOCKED" } })), true);
  assert.equal(isBlocked(issue({ labels: { nodes: [{ name: "Bug" }, { name: "blocked" }] } })), true);
  assert.equal(isBlocked(issue({ labels: { nodes: [{ name: "Blocked by design" }] } })), false, "the whole name only");
  assert.equal(isBlocked(issue({ inverseRelations: by("unstarted") })), true);
  assert.equal(isBlocked(issue({ inverseRelations: by("backlog") })), true);
  assert.equal(isBlocked(issue({ inverseRelations: by("completed") })), false);
  assert.equal(isBlocked(issue({ inverseRelations: by("canceled") })), false);
  assert.equal(isBlocked(issue({ inverseRelations: by("started", "related") })), false);
  const counted = countIssues([issue({ labels: { nodes: [{ name: "Blocked" }] } }), issue({ state: { type: "unstarted", name: "Todo" }, inverseRelations: by("started") })], 0);
  assert.deepEqual(counted.counts, { done: 0, inProgress: 0, todo: 0, blocked: 2 });
  // Completed or canceled work is never counted as blocked.
  assert.deepEqual(countIssues([issue({ state: { type: "canceled", name: "Blocked" } })], 0).counts, { done: 0, inProgress: 0, todo: 0, blocked: 0 });
});

test("issue counts are kept a minute per key; fresh asks again; failures aren't kept", async () => {
  const asked = () => fake.requests.filter((r) => r.operation === "AssignedIssues").length;
  await readIssueCounts();
  await readIssueCounts();
  assert.equal(asked(), 1);
  await readIssueCounts(true);
  assert.equal(asked(), 2);
  saveSecret({ name: "linearApiKey", value: "lin_api_other" });
  await readIssueCounts();
  assert.equal(asked(), 3, "another key, another answer");
  fake.fail("AssignedIssues", { status: 401, message: "no" });
  assert.deepEqual(await readIssueCounts(true), { state: "error", message: "Linear refused the API key." });
  fake.clear("AssignedIssues");
  assert.equal((await readIssueCounts()).state, "ok", "the failure wasn't kept");
  assert.equal(asked(), 5);
});

test("issue counts say why there are none: Linear off, no key, or Linear's error", async () => {
  saveSecret({ name: "linearApiKey", value: null });
  assert.deepEqual(await readIssueCounts(), { state: "no-key", message: NO_KEY });
  writeSettings({ integrations: { ...(readSettings()?.integrations as object), linear: false } });
  assert.deepEqual(await readIssueCounts(), { state: "off", message: DISABLED });
  assert.equal(fake.requests.length, 0, "Linear isn't asked");
});

test("assigned work includes backlog and triage and preserves the actual workflow name", async () => {
  const answer=await readIssueCounts();
  assert.ok(answer.state === "ok");
  assert.ok(answer.items.todo.some(i=>i.status === "Triage"));
  assert.ok(answer.items.blocked.some(i=>i.status === "Backlog"));
});
