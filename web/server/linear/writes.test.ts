import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { resetLinearClient } from "./client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "./fake";
import { resetLinearReads } from "./reads";
import { linearRoute } from "./route";
import { WRITES } from "./writes";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
});
afterEach(() => fake.restore());

async function post(name: string, body: unknown, type = "application/json") {
  let answer: { status: number; body: any } | undefined;
  const req = Object.assign(Readable.from([typeof body === "string" ? body : JSON.stringify(body)]), {
    method: "POST",
    headers: { "content-type": type },
  }) as unknown as IncomingMessage;
  await linearRoute(req, new URL(`/api/linear/m/${name}`, "http://localhost"), {} as ServerResponse, (status, b) => {
    answer = { status, body: b };
  });
  return answer!;
}
const issue = (key: string) => fake.ws.issues.find((i) => i.identifier === key)!;
const ok = async (name: string, body: unknown) => {
  const r = await post(name, body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
};

test("lists exactly the whitelisted writes", () => {
  assert.equal(Object.keys(WRITES).length, 16);
});

test("issueUpdate changes the issue as Linear would", async () => {
  const eng2 = issue("ENG-2");
  const before = eng2.updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  const { issue: out } = await ok("issueUpdate", {
    id: eng2.id,
    stateId: I.states.eng.Done,
    priority: 1,
    estimate: null,
    assigneeId: null,
    labelIds: [I.labels.bug],
    dueDate: "2026-12-01",
    projectMilestoneId: I.milestones.ga,
    title: "  Renamed  ",
    description: "text",
  });
  assert.equal(eng2.state.id, I.states.eng.Done);
  assert.equal(out.stateId, I.states.eng.Done);
  assert.equal(out.title, "Renamed");
  assert.equal(out.priority, 1);
  assert.equal(out.assigneeId, undefined);
  assert.deepEqual(out.labelIds, [I.labels.bug]);
  assert.equal(out.dueDate, "2026-12-01");
  assert.equal(eng2.description, "text");
  assert.ok(eng2.updatedAt > before);
});

test("issueUpdate moves a parent and keeps children in step", async () => {
  await ok("issueUpdate", { id: issue("ENG-2").id, parentId: null });
  assert.deepEqual(issue("ENG-1").children.nodes, []);
  await ok("issueUpdate", { id: issue("ENG-2").id, parentId: issue("ENG-3").id });
  assert.deepEqual(issue("ENG-3").children.nodes, [{ id: issue("ENG-2").id }]);
});

test("issueCreate adds an issue", async () => {
  const { issue: out } = await ok("issueCreate", { teamId: I.eng, title: "New thing", priority: 2, labelIds: [I.labels.feature] });
  assert.match(out.key, /^ENG-\d+$/);
  assert.equal(out.teamId, I.eng);
  assert.equal(out.creatorId, I.owen);
  const made = fake.ws.issues.find((i) => i.id === out.id)!;
  assert.equal(made.title, "New thing");
  assert.ok(made.updatedAt);
});

test("archive, unarchive, delete, subscribe, unsubscribe", async () => {
  const eng3 = issue("ENG-3");
  const a = await ok("issueArchive", { id: eng3.id });
  assert.ok(a.issue.archivedAt);
  assert.ok(eng3.archivedAt);
  const u = await ok("issueUnarchive", { id: eng3.id });
  assert.equal(u.issue.archivedAt, undefined);
  assert.equal(eng3.archivedAt, null);

  const un = await ok("issueUnsubscribe", { id: issue("ENG-1").id });
  assert.deepEqual(un.issue.subscriberIds, []);
  const sub = await ok("issueSubscribe", { id: issue("ENG-3").id });
  assert.deepEqual(sub.issue.subscriberIds, [I.owen]);

  const before = issue("ENG-4").updatedAt;
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await ok("issueDelete", { id: issue("ENG-4").id }), { ok: true });
  assert.ok(issue("ENG-4").archivedAt);
  assert.ok(issue("ENG-4").updatedAt > before);
});

test("relations", async () => {
  const { ok: created } = await ok("issueRelationCreate", { issueId: issue("ENG-1").id, relatedIssueId: issue("ENG-5").id, type: "related" });
  assert.equal(created, true);
  assert.equal(issue("ENG-1").relations.nodes.length, 1);
  assert.deepEqual(await ok("issueRelationDelete", { id: I.relations.eng3blocks4 }), { ok: true });
  assert.equal(issue("ENG-3").relations.nodes.length, 0);
  assert.equal(issue("ENG-4").inverseRelations.nodes.length, 0);
  assert.equal((await post("issueRelationCreate", { issueId: I.owen, relatedIssueId: I.sam, type: "friends" })).status, 400);
});

test("comments and reactions", async () => {
  const { comment } = await ok("commentCreate", { issueId: issue("ENG-2").id, body: "Hello", parentId: undefined });
  assert.equal(comment.authorId, I.owen);
  const stored = fake.ws.comments.find((c) => c.id === comment.id)!;
  assert.equal(stored.body, "Hello");

  const edited = await ok("commentUpdate", { id: comment.id, body: "Hello again" });
  assert.equal(edited.comment.body, "Hello again");
  assert.ok(edited.comment.editedAt);

  const resolved = await ok("commentResolve", { id: comment.id });
  assert.ok(resolved.comment.resolvedAt);
  assert.equal(resolved.ok, true);
  const open = await ok("commentUnresolve", { id: comment.id });
  assert.equal(open.comment.resolvedAt, undefined);

  await ok("reactionCreate", { commentId: comment.id, emoji: "🎉" });
  assert.deepEqual(stored.reactions.map((r) => r.emoji), ["🎉"]);
  assert.deepEqual(await ok("reactionDelete", { id: stored.reactions[0].id }), { ok: true });
  assert.deepEqual(stored.reactions, []);

  assert.deepEqual(await ok("commentDelete", { id: comment.id }), { ok: true });
  assert.ok(!fake.ws.comments.some((c) => c.id === comment.id));
});

test("refuses unknown writes and fields", async () => {
  assert.equal((await post("issueNope", {})).status, 404);
  const r = await post("issueUpdate", { id: issue("ENG-1").id, foo: 1 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Unexpected field foo");
  assert.equal((await post("issueUpdate", { id: "../x" })).status, 400);
  assert.equal((await post("issueUpdate", { id: issue("ENG-1").id })).status, 400);
  assert.equal((await post("issueUpdate", "{nope")).status, 400);
  assert.equal((await post("issueUpdate", {}, "text/plain")).status, 415);
  assert.equal((await post("issueUpdate", { id: issue("ENG-1").id, description: "x".repeat(2 * 1024 * 1024) })).status, 413);
  assert.equal(fake.requests.length, 0);
});

test("refuses bad values", async () => {
  const id = issue("ENG-1").id;
  for (const bad of [
    { priority: 7 },
    { priority: 1.5 },
    { title: "x".repeat(256) },
    { title: "   " },
    { dueDate: "tomorrow" },
    { dueDate: "2026-02-31" },
    { estimate: "3" },
    { labelIds: Array(51).fill(I.labels.bug) },
    { labelIds: ["nope!"] },
    { stateId: null },
    { assigneeId: 5 },
  ]) {
    assert.equal((await post("issueUpdate", { id, ...bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await post("issueCreate", { teamId: I.eng, title: "" })).status, 400);
  assert.equal((await post("commentCreate", { issueId: id, body: "" })).status, 400);
  assert.equal((await post("reactionCreate", { commentId: I.comments.first, emoji: "x".repeat(51) })).status, 400);
  assert.equal(fake.requests.length, 0);
});

test("passes Linear's refusal through", async () => {
  fake.fail("IssueUpdate", { message: "x", type: "InvalidInput" });
  const r = await post("issueUpdate", { id: issue("ENG-1").id, priority: 2 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "x");
  fake.clear("IssueUpdate");
  fake.fail("IssueUpdate", { message: "boom" });
  assert.equal((await post("issueUpdate", { id: issue("ENG-1").id, priority: 2 })).status, 502);
});

test("an unavailable Linear is an error status, never a success", async () => {
  fake.fail("IssueUpdate", { status: 429, message: "slow" });
  const limited = await post("issueUpdate", { id: issue("ENG-1").id, priority: 2 });
  assert.equal(limited.status, 409);
  assert.equal(typeof limited.body.retryAt, "number");
  assert.ok(limited.body.error);
  fake.clear("IssueUpdate");
  fake.fail("IssueUpdate", { status: 401, message: "no" });
  assert.equal((await post("issueUpdate", { id: issue("ENG-1").id, priority: 2 })).status, 401);
  delete process.env.LINEAR_API_KEY;
  const none = await post("issueUpdate", { id: issue("ENG-1").id, priority: 2 });
  assert.equal(none.status, 503);
  assert.match(none.body.error, /LINEAR_API_KEY/);
});
