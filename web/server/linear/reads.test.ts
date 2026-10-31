import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LinearError, resetLinearClient } from "./client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "./fake";
import { readIssue, readIssues, readStatus, readSync, readWorkspace, resetLinearReads } from "./reads";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
});
afterEach(() => fake.restore());

const keys = (issues: { key: string }[]) => issues.map((i) => i.key).sort();

test("reads the workspace", async () => {
  const ws = await readWorkspace();
  assert.equal(ws.viewerId, I.owen);
  assert.equal(ws.users.find((u) => u.id === I.owen)?.me, true);
  assert.equal(ws.users.find((u) => u.id === I.sam)?.me, undefined);
  const eng = ws.teams.find((t) => t.key === "ENG")!;
  assert.deepEqual(eng.estimates, [0, 1, 2, 3, 5, 8]);
  assert.deepEqual(ws.teams.find((t) => t.key === "DE")!.estimates, []);
  const states = ws.states.filter((s) => s.teamId === eng.id);
  assert.equal(states.length, 7);
  assert.deepEqual(states.map((s) => s.position), [0, 1, 2, 3, 4, 5, 6]);
  const launch = ws.projects.find((p) => p.name === "Launch")!;
  assert.deepEqual(launch.milestones.map((m) => m.name), ["Beta", "GA"]);
  assert.deepEqual(launch.teamIds, [I.eng]);
  assert.equal(launch.health, "onTrack");
  assert.ok(ws.initiatives.find((i) => i.name === "Q4")!.projectIds.includes(launch.id));
  assert.equal(ws.cycles.length, 2);
  assert.equal(ws.labels.length, 2);
});

test("keeps the workspace for five minutes unless asked afresh", async () => {
  await readWorkspace();
  await readWorkspace();
  assert.equal(fake.requests.filter((r) => r.operation === "Workspace").length, 1);
  await readWorkspace(true);
  assert.equal(fake.requests.filter((r) => r.operation === "Workspace").length, 2);
});

test("reads scopes", async () => {
  const assigned = await readIssues("assigned");
  assert.deepEqual(keys(assigned.issues), ["ENG-1", "ENG-3"]);
  assert.equal(assigned.next, undefined);
  assert.deepEqual(keys((await readIssues("created")).issues), ["DE-1", "ENG-1", "ENG-2", "ENG-3"]);
  assert.deepEqual(keys((await readIssues("subscribed")).issues), ["DE-2", "ENG-1"]);

  const backlog = await readIssues(`team:${I.eng}:backlog`);
  assert.deepEqual(backlog.issues, []);
  assert.deepEqual(keys((await readIssues(`team:${I.de}:backlog`)).issues), ["DE-2"]);
  assert.deepEqual(keys((await readIssues(`team:${I.eng}:triage`)).issues), ["ENG-4"]);
  assert.deepEqual(keys((await readIssues(`team:${I.eng}:active`)).issues), ["ENG-1", "ENG-2", "ENG-3"]);

  const project = await readIssues(`project:${I.projects.launch}`);
  assert.ok(project.issues.some((i) => i.key === "ENG-5"), "done yesterday");
  assert.ok(!project.issues.some((i) => i.key === "ENG-6"), "done 20 days ago");
  const all = await readIssues(`team:${I.eng}:all`);
  assert.deepEqual(keys(all.issues), ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5"]);
  await assert.rejects(readIssues("team:nope:all" as never), (e) => e instanceof LinearError && e.kind === "invalid");
});

test("pages through a scope with a cursor", async () => {
  const first = await readIssues(`team:${I.eng}:all`, undefined, 2);
  assert.equal(first.issues.length, 2);
  assert.ok(first.next);
  const second = await readIssues(`team:${I.eng}:all`, first.next, 2);
  const third = await readIssues(`team:${I.eng}:all`, second.next, 2);
  assert.equal(third.next, undefined);
  assert.deepEqual(
    keys([...first.issues, ...second.issues, ...third.issues]),
    ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5"],
  );
});

test("reads an issue with comments, children and both sides of a relation", async () => {
  const eng4 = await readIssue("eng-4");
  assert.ok(eng4);
  assert.ok(eng4.issue.relations!.some((r) => r.type === "blocked_by" && r.issueId === I.issues["ENG-3"]));
  const eng3 = await readIssue("ENG-3");
  assert.ok(eng3!.issue.relations!.some((r) => r.type === "blocks" && r.issueId === I.issues["ENG-4"]));

  const eng1 = (await readIssue("ENG-1"))!;
  assert.deepEqual(eng1.issue.childIds, [I.issues["ENG-2"]]);
  assert.deepEqual(eng1.children.map((c) => c.key), ["ENG-2"]);
  assert.equal(eng1.comments.length, 3);
  assert.deepEqual(eng1.comments.filter((c) => c.parentId).map((c) => c.parentId), [I.comments.first]);
  assert.deepEqual(eng1.comments.find((c) => c.id === I.comments.reacted)!.reactions, [
    { emoji: "👍", userIds: [I.sam], ids: [fake.ws.comments.find((c) => c.id === I.comments.reacted)!.reactions[0].id] },
  ]);
  assert.match(eng1.issue.description!, /parent/);
  assert.deepEqual(eng1.issue.links, [{ title: "Design doc", url: "https://example.com/design" }]);

  // By id too: a parent or related issue the page knows only by id.
  assert.equal((await readIssue(I.issues["ENG-4"]))!.issue.key, "ENG-4");

  assert.equal(await readIssue("ENG-404"), null);
  // Real Linear answers a missing issue with an error, not null.
  fake.fail("Issue", { message: "Could not find referenced Issue.", type: "InvalidInput" });
  assert.equal(await readIssue("ENG-405"), null);
  await assert.rejects(readIssue("not a key"), (e) => e instanceof LinearError && e.kind === "invalid");
});

test("syncs what changed since a cursor", async () => {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const eng5 = fake.ws.issues.find((i) => i.identifier === "ENG-5")!;
  const empty = await readSync(since);
  assert.deepEqual(empty.issues, []);
  assert.equal(empty.cursor, since);

  eng5.updatedAt = new Date().toISOString();
  const synced = await readSync(since);
  assert.deepEqual(synced.issues.map((i) => i.key), ["ENG-5"]);
  assert.equal(synced.comments.length, 0);
  assert.equal(synced.more, false);
  assert.ok(synced.cursor > since);
  assert.equal(synced.cursor, eng5.updatedAt);
  assert.deepEqual((await readSync(synced.cursor)).issues, []);

  const eng6 = fake.ws.issues.find((i) => i.identifier === "ENG-6")!;
  eng6.archivedAt = new Date(Date.now() + 1000).toISOString();
  eng6.updatedAt = eng6.archivedAt;
  const archived = await readSync(synced.cursor);
  assert.equal(archived.issues[0].key, "ENG-6");
  assert.equal(archived.issues[0].archivedAt, eng6.archivedAt);
  assert.equal(fake.requests.filter((r) => r.operation === "Sync").length, 4);
  await assert.rejects(readSync("yesterday"), (e) => e instanceof LinearError && e.kind === "invalid");
});

test("says when a sync list is full", async () => {
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const template = fake.ws.issues[0];
  for (let i = 0; i < 100; i++) {
    fake.ws.issues.push({ ...template, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, identifier: `ENG-${100 + i}`, updatedAt: new Date().toISOString() });
  }
  assert.equal((await readSync(since)).more, true);
});

test("reports the key and the budget", async () => {
  assert.equal(readStatus().configured, true);
  assert.equal(readStatus().budget, null);
  await readWorkspace();
  assert.equal(readStatus().budget?.requestsRemaining, 2500);
});

test("reads fail as LinearErrors", async () => {
  fake.fail("Workspace", { status: 429, message: "slow down" });
  await assert.rejects(readWorkspace(), (e) => e instanceof LinearError && e.kind === "limited" && typeof e.retryAt === "number");
  fake.clear("Workspace");
  assert.ok((await readWorkspace(true)).teams.length);
});
