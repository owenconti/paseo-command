/**
 * The GitHub tab's server over a fake GitHub API (`fake.ts`): nothing here reaches GitHub.
 */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, test } from "node:test";
import { writeSettings } from "../settings";
import { FAKE_GITHUB_TOKEN } from "../githubFake";
import { NO_KEY, OFF, REFUSED, SCOPES } from "../githubApi";
import { FAKE_DIFF, fakePr, installFakeGithub, SHA, type FakeGithub } from "./fake";
import { avatarOf, checkOf, filesFromPatches, reviewersOf, rowOf, SCOPE_QUERY } from "./reads";
import { githubRoute } from "./route";
import { checkWrite } from "./writes";

let fake: FakeGithub;
beforeEach(() => {
  fake = installFakeGithub();
  fake.prs.set("owen/app#7", fakePr({ number: 7 }));
  fake.diffs.set("owen/app#7", FAKE_DIFF);
  fake.search[SCOPE_QUERY.review] = [fakePr({ number: 7 }), fakePr({ number: 8, repo: "owen/lib", updatedAt: "2026-10-31T00:00:00Z" }), { nope: true }];
});
afterEach(() => fake.restore());

async function ask(path: string, method = "GET", body?: unknown, type = "application/json") {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]), {
    method,
    headers: { "content-type": type },
  }) as unknown as IncomingMessage;
  let answer: { status: number; body: any } | undefined;
  await githubRoute(req, new URL(path, "http://localhost"), (status, b) => (answer = { status, body: b }));
  return answer!;
}

test("lists come newest first, shaped, and skip what isn't a PR", async () => {
  const r = await ask("/api/github/q/prs?scope=review");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.rows.map((p: { repo: string; number: number }) => `${p.repo}#${p.number}`), ["owen/lib#8", "owen/app#7"]);
  const row = r.body.rows[1];
  assert.equal(row.state, "open");
  assert.equal(row.checks, "passing");
  assert.equal(row.reviewDecision, "review");
  assert.deepEqual(row.author, { login: "ada", name: "Ada", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" });
  assert.equal(r.body.viewer.login, "me");
  const graphql = fake.calls.find((c) => c.path === "graphql")!;
  assert.equal((graphql.body as { variables: { q: string } }).variables.q, SCOPE_QUERY.review);
  assert.equal(graphql.authorization, `Bearer ${FAKE_GITHUB_TOKEN}`);
  // Cached: asked again only with fresh=1.
  const before = fake.calls.length;
  await ask("/api/github/q/prs?scope=review");
  assert.equal(fake.calls.length, before);
  await ask("/api/github/q/prs?scope=review&fresh=1");
  assert.equal(fake.calls.length, before + 1);
});

test("a PR's detail: files, conversation, threads, commits, checks and reviewers", async () => {
  const r = await ask("/api/github/q/pr?repo=owen/app&number=7");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pr = r.body;
  assert.equal(pr.headSha, SHA);
  assert.equal(pr.mergeable, "mergeable");
  assert.deepEqual(pr.files, [{ path: "src/app.ts", additions: 3, deletions: 1, changeType: "modified", viewed: "unviewed" }]);
  assert.deepEqual(pr.timeline.map((t: { kind: string }) => t.kind), ["comment"]);
  assert.equal(pr.threads[0].comments[0].databaseId, 101);
  assert.equal(pr.threads[0].canResolve, true);
  assert.equal(pr.commits[0].sha, SHA);
  assert.deepEqual(pr.checkRuns, [{ name: "test", state: "passing", url: "https://github.com/x", summary: "All good" }]);
  assert.deepEqual(pr.reviewers, [{ name: "me", state: "requested" }]);
  assert.deepEqual((fake.calls[0]!.body as { variables: unknown }).variables, { owner: "owen", name: "app", number: 7 });
});

test("a PR's further files are paged in", async () => {
  fake.prs.set(
    "owen/app#9",
    fakePr({
      number: 9,
      files: { nodes: [{ path: "a", changeType: "ADDED" }], pageInfo: { hasNextPage: true, endCursor: "c1" } },
      morefiles: { nodes: [{ path: "b", changeType: "DELETED", viewerViewedState: "VIEWED" }], pageInfo: { hasNextPage: false } },
    }),
  );
  const r = await ask("/api/github/q/pr?repo=owen/app&number=9");
  assert.deepEqual(r.body.files.map((f: { path: string; changeType: string; viewed: string }) => [f.path, f.changeType, f.viewed]), [
    ["a", "added", "unviewed"],
    ["b", "deleted", "viewed"],
  ]);
});

test("a PR's diff is parsed; too large for GitHub, its file patches stand in", async () => {
  const r = await ask("/api/github/q/diff?repo=owen/app&number=7");
  assert.equal(r.status, 200);
  assert.equal(r.body.tooLarge, false);
  assert.equal(r.body.files[0].additions, 3);
  assert.equal(fake.calls.at(-1)!.path, "repos/owen/app/pulls/7");
  assert.equal(fake.calls.at(-1)!.accept, "application/vnd.github.diff");
  fake.diffs.set("owen/app#7", { status: 406, json: { message: "Sorry, the diff exceeded the maximum number of files (300)." } });
  fake.prs.set("owen/app#7", fakePr({ number: 7, restFiles: [{ filename: "x.ts", status: "added", additions: 1, deletions: 0, patch: "@@ -0,0 +1 @@\n+hi" }, { filename: "big.bin", status: "modified", changes: 0 }] }));
  const big = await ask("/api/github/q/diff?repo=owen/app&number=7&fresh=1");
  assert.equal(big.body.tooLarge, true);
  assert.deepEqual(big.body.files.map((f: { path: string; isNew: boolean; status: string }) => [f.path, f.isNew, f.status]), [
    ["x.ts", true, "ok"],
    ["big.bin", false, "binary"],
  ]);
});

test("reads are checked and gated, and say why GitHub can't answer", async () => {
  for (const bad of [
    "/api/github/q/prs",
    "/api/github/q/prs?scope=all",
    "/api/github/q/prs?scope=review&x=1",
    "/api/github/q/pr?repo=owen&number=1",
    "/api/github/q/pr?repo=../x&number=1",
    "/api/github/q/pr?repo=owen/app&number=0",
    "/api/github/q/pr?repo=owen/app&number=1e3",
    "/api/github/q/diff?repo=owen/app&number=1&fresh=2",
    "/api/github/q/viewer?x=1",
  ])
    assert.equal((await ask(bad)).status, 400, bad);
  assert.equal((await ask("/api/github/q/nope")).status, 404);
  assert.equal((await ask("/api/github/q/viewer", "POST")).status, 405);
  fake.fail = { status: 401, json: { message: "Bad credentials" } };
  assert.deepEqual((await ask("/api/github/q/viewer")).body, { available: false, reason: REFUSED });
  assert.equal((await ask("/api/github/m/comment", "POST", { repo: "owen/app", number: 7, body: "hi" })).status, 401);
  fake.fail = { status: 403, json: { message: "Resource not accessible" }, headers: { "x-oauth-scopes": "repo" } };
  assert.deepEqual((await ask("/api/github/q/prs?scope=mine&fresh=1")).body, { available: false, reason: SCOPES });
  fake.fail = { status: 403, json: { message: "API rate limit exceeded" }, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2000000000" } };
  assert.equal((await ask("/api/github/m/comment", "POST", { repo: "owen/app", number: 7, body: "hi" })).status, 429);
  fake.fail = undefined;
  writeSettings({ integrations: { github: false } });
  const calls = fake.calls.length;
  assert.deepEqual((await ask("/api/github/q/prs?scope=mine")).body, { available: false, reason: OFF });
  assert.equal((await ask("/api/github/m/comment", "POST", { repo: "owen/app", number: 7, body: "hi" })).status, 503);
  assert.equal(fake.calls.length, calls, "nothing runs while GitHub is off");
});

test("writes send exactly what was asked, and clear the PR's cached read", async () => {
  await ask("/api/github/q/pr?repo=owen/app&number=7");
  const comment = await ask("/api/github/m/comment", "POST", { repo: "owen/app", number: 7, body: "Thanks!" });
  assert.equal(comment.status, 200, JSON.stringify(comment.body));
  assert.deepEqual(fake.writes.at(-1), { path: "repos/owen/app/issues/7/comments", input: { body: "Thanks!" } });
  assert.equal(comment.body.url, "https://github.com/repos/owen/app/issues/7/comments/1");
  const review = await ask("/api/github/m/review", "POST", {
    repo: "owen/app",
    number: 7,
    event: "REQUEST_CHANGES",
    body: "",
    commitId: SHA,
    comments: [
      { path: "src/app.ts", line: 3, side: "RIGHT", body: "Not 4." },
      { path: "src/app.ts", line: 4, side: "RIGHT", startLine: 2, body: "These three." },
    ],
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.deepEqual(fake.writes.at(-1), {
    path: "repos/owen/app/pulls/7/reviews",
    input: {
      event: "REQUEST_CHANGES",
      body: "",
      commit_id: SHA,
      comments: [
        { path: "src/app.ts", line: 3, side: "RIGHT", body: "Not 4." },
        { path: "src/app.ts", line: 4, side: "RIGHT", start_line: 2, start_side: "RIGHT", body: "These three." },
      ],
    },
  });
  await ask("/api/github/m/reply", "POST", { repo: "owen/app", number: 7, commentId: 101, body: "Because." });
  assert.equal(fake.writes.at(-1)!.path, "repos/owen/app/pulls/7/comments/101/replies");
  await ask("/api/github/m/resolve", "POST", { threadId: "RT_1", resolved: true });
  assert.deepEqual(fake.writes.at(-1), { mutation: "resolveReviewThread", vars: { id: "RT_1" } });
  await ask("/api/github/m/viewed", "POST", { prId: "PR_7", path: "src/app.ts", viewed: false });
  assert.deepEqual(fake.writes.at(-1), { mutation: "unmarkFileAsViewed", vars: { id: "PR_7", path: "src/app.ts" } });
  // The PR is read again after a write.
  const before = fake.calls.length;
  await ask("/api/github/q/pr?repo=owen/app&number=7");
  assert.equal(fake.calls.length, before + 1);
});

test("write inputs are checked field by field", async () => {
  const review = { repo: "owen/app", number: 7, event: "COMMENT", body: "ok", commitId: SHA, comments: [] };
  assert.doesNotThrow(() => checkWrite("review", review));
  assert.doesNotThrow(() => checkWrite("review", { ...review, event: "APPROVE", body: "" }));
  for (const bad of [
    { ...review, extra: 1 },
    { ...review, event: "MERGE" },
    { ...review, commitId: "abc" },
    { ...review, body: "" },
    { ...review, repo: "owen/../x" },
    { ...review, number: -1 },
    { ...review, comments: [{ path: "a", line: 1, side: "MIDDLE", body: "x" }] },
    { ...review, comments: [{ path: "/etc/passwd", line: 1, side: "RIGHT", body: "x" }] },
    { ...review, comments: [{ path: "a", line: 1, side: "RIGHT", body: "x", startLine: 3 }] },
    { ...review, comments: [{ path: "a", line: 1, side: "RIGHT", body: "x", startSide: "LEFT" }] },
    { ...review, comments: Array.from({ length: 101 }, () => ({ path: "a", line: 1, side: "RIGHT", body: "x" })) },
  ])
    assert.throws(() => checkWrite("review", bad), JSON.stringify(bad).slice(0, 80));
  assert.throws(() => checkWrite("comment", { repo: "owen/app", number: 7, body: "  " }));
  assert.throws(() => checkWrite("comment", { repo: "owen/app", number: 7, body: "x".repeat(70_000) }));
  assert.throws(() => checkWrite("resolve", { threadId: "RT 1", resolved: true }));
  assert.throws(() => checkWrite("viewed", { prId: "PR_1", path: "a", viewed: "yes" }));
  assert.throws(() => checkWrite("reply", { repo: "owen/app", number: 7, commentId: 1.5, body: "x" }));
  assert.equal((await ask("/api/github/m/review", "POST", { ...review, event: "MERGE" })).status, 400);
  assert.equal((await ask("/api/github/m/merge", "POST", review)).status, 404);
  assert.equal((await ask("/api/github/m/comment")).status, 405);
  assert.equal((await ask("/api/github/m/comment", "POST", review, "text/plain")).status, 415);
  assert.equal((await ask("/api/github/m/comment?x=1", "POST", review)).status, 400);
  assert.equal((await ask("/api/github/m/comment", "POST", "not json")).status, 400);
  assert.equal(fake.writes.length, 0);
});

test("a refused write says GitHub's words", async () => {
  fake.fail = { status: 422, json: { message: "Validation Failed", errors: ["line must be part of the diff"] } };
  const r = await ask("/api/github/m/comment", "POST", { repo: "owen/app", number: 7, body: "x" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "Validation Failed: line must be part of the diff");
});

test("the viewer says whose the token is and the scopes it lacks", async () => {
  const r = await ask("/api/github/q/viewer");
  assert.deepEqual(r.body, { viewer: { login: "me", name: "Me", avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4" } });
  fake.scopes = "repo";
  const lacking = await ask("/api/github/q/viewer?fresh=1");
  assert.deepEqual(lacking.body.missingScopes, ["notifications", "read:org"]);
});

test("without a token nothing is asked, and the view says to add one", async () => {
  fake.restore();
  fake = installFakeGithub({ token: null });
  assert.deepEqual((await ask("/api/github/q/prs?scope=review")).body, { available: false, reason: NO_KEY });
  assert.equal((await ask("/api/github/m/comment", "POST", { repo: "owen/app", number: 7, body: "hi" })).status, 503);
  assert.equal(fake.calls.length, 0);
});

test("shaping keeps to GitHub's own addresses and known states", () => {
  assert.equal(avatarOf("https://avatars.githubusercontent.com/u/1"), "https://avatars.githubusercontent.com/u/1");
  assert.equal(avatarOf("https://evil.example/a.png"), undefined);
  assert.equal(rowOf({ ...fakePr({ number: 1 }), url: "javascript:alert(1)" }), null);
  assert.equal(rowOf({ ...fakePr({ number: 1 }), state: "MERGED" })!.state, "merged");
  assert.equal(rowOf({ ...fakePr({ number: 1 }), isDraft: true })!.state, "draft");
  assert.equal(checkOf({ __typename: "CheckRun", name: "lint", status: "IN_PROGRESS" })!.state, "pending");
  assert.equal(checkOf({ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "TIMED_OUT" })!.state, "failing");
  assert.equal(checkOf({ __typename: "StatusContext", context: "ci", state: "SUCCESS", targetUrl: "http://x" })!.url, undefined);
  assert.deepEqual(
    reviewersOf([{ requestedReviewer: { __typename: "Team", name: "core" } }], [{ author: { login: "bob" }, state: "APPROVED" }, { author: { login: "ada" }, state: "COMMENTED" }], "ada"),
    [{ name: "bob", state: "approved" }, { name: "core", state: "requested" }],
  );
  assert.deepEqual(filesFromPatches([{ filename: "r.ts", previous_filename: "q.ts", status: "renamed", additions: 0, deletions: 0 }, "not a file"]), [
    { path: "r.ts", oldPath: "q.ts", isNew: false, isDeleted: false, additions: 0, deletions: 0, hunks: [], status: "ok" },
  ]);
});
