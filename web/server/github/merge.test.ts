/**
 * A PR's merge box on the server over the fake GitHub (`fake.ts`): its read
 * (merge state, allowed methods, auto-merge, the queue) and its writes
 * (merge, auto-merge, queue, ready/draft, update branch, close/reopen,
 * delete branch), each checked field by field. Nothing reaches GitHub.
 */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, test } from "node:test";
import { fakePr, installFakeGithub, SHA, type FakeGithub } from "./fake";
import { mergeOf } from "./reads";
import { githubRoute } from "./route";
import { checkWrite } from "./writes";
import { githubPullRequest, GITHUB_LOOKUP } from "../links";

let fake: FakeGithub;
beforeEach(() => {
  fake = installFakeGithub();
  fake.prs.set("owen/app#7", fakePr({ number: 7 }));
});
afterEach(() => fake.restore());

async function ask(path: string, method = "GET", body?: unknown) {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method,
    headers: { "content-type": "application/json" },
  }) as unknown as IncomingMessage;
  let answer: { status: number; body: any } | undefined;
  await githubRoute(req, new URL(path, "http://localhost"), (status, b) => (answer = { status, body: b }));
  return answer!;
}
const read = async () => (await ask("/api/github/q/pr?repo=owen/app&number=7")).body;
const write = (name: string, body: unknown) => ask(`/api/github/m/${name}`, "POST", body);
const pr7 = { repo: "owen/app", number: 7, prId: "PR_7" };

test("a PR's merge box: its state, the repository's methods, what the token may do, GitHub's commit messages", async () => {
  const pr = await read();
  assert.deepEqual(pr.merge, {
    status: "clean",
    methods: ["merge", "squash", "rebase"],
    canMerge: true,
    canMergeAsAdmin: false,
    canUpdate: true,
    canClose: true,
    canReopen: true,
    canUpdateBranch: false,
    autoMergeAllowed: true,
    canEnableAutoMerge: true,
    canDisableAutoMerge: true,
    autoMerge: null,
    queueRequired: false,
    queue: null,
    deleteBranchOnMerge: false,
    headBranchExists: true,
    canDeleteBranch: true,
    messages: {
      merge: { title: "Merge pull request #7 from ada/feature-7", body: "PR 7" },
      squash: { title: "PR 7 (#7)", body: "* Change b" },
    },
  });
  const query = (fake.calls[0]!.body as { query: string }).query;
  for (const field of ["mergeStateStatus", "viewerCanMergeAsAdmin", "isMergeQueueEnabled", "autoMergeRequest", "squashMergeAllowed", "deleteBranchOnMerge", "viewerMergeHeadlineText(mergeType: SQUASH)"])
    assert.ok(query.includes(field), field);
});

test("merge box shaping: only allowed methods, known states, auto-merge with who and when, the queue", () => {
  const m = mergeOf({
    ...fakePr({ number: 3 }),
    mergeStateStatus: "BLOCKED",
    baseRepo: { viewerPermission: "READ", mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: false, autoMergeAllowed: false, deleteBranchOnMerge: true },
    autoMergeRequest: { mergeMethod: "SQUASH", enabledAt: "2026-10-31T10:00:00Z", enabledBy: { login: "ada", avatarUrl: "https://evil.example/a.png" } },
    isMergeQueueEnabled: true,
    mergeQueueEntry: { state: "AWAITING_CHECKS", position: 2 },
    headRef: null,
    mergeTitle: "",
  });
  assert.equal(m.status, "blocked");
  assert.deepEqual(m.methods, ["squash"]);
  assert.equal(m.canMerge, false);
  assert.deepEqual(m.autoMerge, { method: "squash", by: { login: "ada" }, at: "2026-10-31T10:00:00Z" });
  assert.deepEqual(m.queue, { state: "awaiting_checks", position: 2 });
  assert.equal(m.queueRequired, true);
  assert.equal(m.headBranchExists, false);
  assert.equal(m.canDeleteBranch, false, "a deleted branch can't be deleted");
  assert.equal(m.messages.merge, undefined);
  assert.equal(mergeOf({ mergeStateStatus: "SOMETHING_NEW" }).status, "unknown");
  assert.equal(mergeOf({ isInMergeQueue: true }).queue?.state, "queued");
});

test("merging sends the method, the head it was read at and the commit text; GitHub's answer says it merged", async () => {
  const r = await write("merge", { ...pr7, method: "squash", headSha: SHA, title: "Squash it (#7)", message: "Body" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, merged: true });
  assert.deepEqual(fake.writes.at(-1), {
    mutation: "mergePullRequest",
    vars: { id: "PR_7", method: "SQUASH", sha: SHA, title: "Squash it (#7)", body: "Body" },
  });
  const pr = await read();
  assert.equal(pr.state, "merged");
  assert.equal(pr.merge.mergedBy.login, "me");
});

test("a write clears the PR's cached read, its lists and the map's lookup of it", async () => {
  fake.search["is:pr is:open archived:false author:@me sort:updated-desc"] = [fakePr({ number: 7 })];
  await read();
  await ask("/api/github/q/prs?scope=mine");
  // The map's lookup (links.ts) of the branch's PR.
  const branchQuery = (q: string) => q.includes("BranchPullRequest");
  const before = fake.calls.length;
  await githubPullRequest("owen/app", "feature-7");
  await githubPullRequest("owen/app", "feature-7");
  assert.equal(fake.calls.slice(before).filter((c) => branchQuery(String((c.body as { query?: string })?.query))).length, 1, "cached");
  assert.ok(GITHUB_LOOKUP.ttlMs > 1000);
  await write("ready", { ...pr7, ready: false });
  const calls = fake.calls.length;
  await read();
  await ask("/api/github/q/prs?scope=mine");
  await githubPullRequest("owen/app", "feature-7");
  const asked = fake.calls.slice(calls).map((c) => String((c.body as { query?: string })?.query));
  assert.equal(asked.length, 3, "the PR, its list and the branch lookup are each asked again");
  assert.ok(asked.some(branchQuery));
});

test("auto-merge turns on with a method and off; the read says how and who", async () => {
  fake.prs.set("owen/app#7", fakePr({ number: 7, mergeStateStatus: "BLOCKED" }));
  assert.equal((await write("autoMerge", { ...pr7, enable: true, method: "rebase", headSha: SHA })).status, 200);
  assert.deepEqual(fake.writes.at(-1), { mutation: "enablePullRequestAutoMerge", vars: { id: "PR_7", method: "REBASE", sha: SHA } });
  assert.deepEqual((await read()).merge.autoMerge, { method: "rebase", by: { login: "me" }, at: "2026-10-31T12:00:00Z" });
  assert.equal((await write("autoMerge", { ...pr7, enable: false })).status, 200);
  assert.equal(fake.writes.at(-1)!.mutation, "disablePullRequestAutoMerge");
  assert.equal((await read()).merge.autoMerge, null);
});

test("the merge queue: added and removed", async () => {
  fake.prs.set("owen/app#7", fakePr({ number: 7, isMergeQueueEnabled: true }));
  await write("queue", { ...pr7, action: "add", headSha: SHA });
  assert.deepEqual(fake.writes.at(-1), { mutation: "enqueuePullRequest", vars: { id: "PR_7", sha: SHA } });
  assert.deepEqual((await read()).merge.queue, { state: "queued", position: 1 });
  await write("queue", { ...pr7, action: "remove" });
  assert.deepEqual(fake.writes.at(-1), { mutation: "dequeuePullRequest", vars: { id: "PR_7" } });
  assert.equal((await read()).merge.queue, null);
});

test("ready for review and back to a draft; updating the branch by merge or rebase", async () => {
  await write("ready", { ...pr7, ready: false });
  assert.equal(fake.writes.at(-1)!.mutation, "convertPullRequestToDraft");
  assert.equal((await read()).state, "draft");
  await write("ready", { ...pr7, ready: true });
  assert.equal(fake.writes.at(-1)!.mutation, "markPullRequestReadyForReview");
  assert.equal((await read()).state, "open");
  fake.prs.set("owen/app#7", fakePr({ number: 7, mergeStateStatus: "BEHIND", viewerCanUpdateBranch: true }));
  await write("updateBranch", { ...pr7, method: "rebase", headSha: SHA });
  assert.deepEqual(fake.writes.at(-1), { mutation: "updatePullRequestBranch", vars: { id: "PR_7", sha: SHA, method: "REBASE" } });
  assert.equal((await read()).merge.status, "clean");
});

test("closing posts its comment first, then closes; reopening opens", async () => {
  await write("state", { ...pr7, state: "closed", comment: "Superseded by #9." });
  assert.deepEqual(
    fake.writes.slice(-2).map((w) => w.path ?? w.mutation),
    ["repos/owen/app/issues/7/comments", "closePullRequest"],
  );
  assert.deepEqual(fake.writes.at(-2)!.input, { body: "Superseded by #9." });
  assert.equal((await read()).state, "closed");
  await write("state", { ...pr7, state: "open" });
  assert.equal(fake.writes.at(-1)!.mutation, "reopenPullRequest");
  assert.equal((await read()).state, "open");
  // A blank comment isn't posted.
  const n = fake.writes.length;
  await write("state", { ...pr7, state: "closed", comment: "  " });
  assert.deepEqual(fake.writes.slice(n).map((w) => w.mutation), ["closePullRequest"]);
});

test("deleting the branch: only the PR's own, once merged or closed, where the token may", async () => {
  // Open: refused before GitHub is asked to delete anything.
  let r = await write("deleteBranch", { repo: "owen/app", number: 7 });
  assert.equal(r.status, 400);
  assert.ok(!fake.writes.some((w) => w.method === "DELETE"));
  fake.prs.set("owen/app#7", fakePr({ number: 7, state: "MERGED", headRefName: "feat/merge-box" }));
  r = await write("deleteBranch", { repo: "owen/app", number: 7 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(fake.writes.at(-1), { method: "DELETE", path: "repos/owen/app/git/refs/heads/feat/merge-box", input: undefined });
  assert.equal((await read()).merge.headBranchExists, false);
  // A fork's branch the token can't push to.
  fake.prs.set("owen/app#7", fakePr({ number: 7, state: "CLOSED", headRepository: { nameWithOwner: "eve/app" }, viewerCanDeleteHeadRef: false }));
  r = await write("deleteBranch", { repo: "owen/app", number: 7 });
  assert.equal(r.status, 403);
});

test("GitHub refusing a merge says its words, and nothing is cached as merged", async () => {
  fake.refuse.mergePullRequest = "Pull request is not mergeable";
  const r = await write("merge", { ...pr7, method: "merge", headSha: SHA });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /not mergeable/);
  assert.equal((await read()).state, "open");
});

test("merge-box inputs are checked field by field", () => {
  const bad: [string, unknown][] = [
    ["merge", { ...pr7, method: "octopus", headSha: SHA }],
    ["merge", { ...pr7, method: "merge", headSha: "abc" }],
    ["merge", { ...pr7, method: "rebase", headSha: SHA, title: "A rebase has no title" }],
    ["merge", { ...pr7, method: "squash", headSha: SHA, title: "two\nlines" }],
    ["merge", { ...pr7, method: "merge", headSha: SHA, admin: true }],
    ["merge", { ...pr7, prId: "PR 7; drop", method: "merge", headSha: SHA }],
    ["merge", { repo: "../x", number: 7, prId: "PR_7", method: "merge", headSha: SHA }],
    ["autoMerge", { ...pr7, enable: true }],
    ["autoMerge", { ...pr7, enable: false, method: "merge" }],
    ["autoMerge", { ...pr7, enable: "yes", method: "merge" }],
    ["queue", { ...pr7, action: "jump" }],
    ["queue", { ...pr7, action: "remove", headSha: SHA }],
    ["ready", { ...pr7, ready: 1 }],
    ["updateBranch", { ...pr7, method: "squash", headSha: SHA }],
    ["updateBranch", { ...pr7, method: "merge" }],
    ["state", { ...pr7, state: "merged" }],
    ["state", { ...pr7, state: "open", comment: "Reopening" }],
    ["deleteBranch", { repo: "owen/app", number: 7, branch: "main" }],
  ];
  for (const [name, input] of bad) assert.throws(() => checkWrite(name as "merge", input), Error, `${name} ${JSON.stringify(input)}`);
  assert.deepEqual(checkWrite("merge", { ...pr7, method: "merge", headSha: SHA, title: "T", message: "" }), { ...pr7, method: "merge", headSha: SHA, title: "T", message: "" });
  assert.deepEqual(checkWrite("state", { ...pr7, state: "closed", comment: "" }), { ...pr7, state: "closed" });
});
