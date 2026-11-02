/**
 * The GitHub tab's server over a fake GitHub API (`fake.ts`): nothing here reaches GitHub.
 */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, test } from "node:test";
import { readSettings, settingsFile, writeSettings } from "../settings";
import { readFileSync, writeFileSync } from "node:fs";
import { saveStar } from "./stars";
import { SEARCH_BUDGET } from "./client";
import { FAKE_GITHUB_TOKEN } from "../githubFake";
import { NO_KEY, OFF, REFUSED, SCOPES } from "../githubApi";
import { FAKE_DIFF, fakePr, fakeRepo, installFakeGithub, SHA, type FakeGithub } from "./fake";
import { avatarOf, checkOf, filesFromPatches, repoSearchQuery, reviewersOf, rowOf, SCOPE_QUERY, searchText } from "./reads";
import { checkFilters, filterQueries } from "../../src/github/filters";
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
  assert.equal(pr.headRepo, "owen/app");
  assert.equal(pr.mergeable, "mergeable");
  assert.deepEqual(pr.files, [{ path: "src/app.ts", additions: 3, deletions: 1, changeType: "modified", viewed: "unviewed" }]);
  assert.deepEqual(pr.timeline.map((t: { kind: string }) => t.kind), ["comment"]);
  assert.equal(pr.threads[0].comments[0].databaseId, 101);
  assert.equal(pr.threads[0].canResolve, true);
  assert.equal(pr.commits[0].sha, SHA);
  assert.deepEqual(pr.checkRuns, [
    {
      name: "test",
      state: "passing",
      url: "https://github.com/x",
      summary: "All good",
      source: "CI",
      startedAt: "2026-10-30T09:00:00Z",
      completedAt: "2026-10-30T09:02:05Z",
    },
  ]);
  assert.deepEqual(pr.reviewers, [{ kind: "user", login: "me", name: "Me", requested: true, verdict: null }]);
  assert.deepEqual(pr.assignees, [{ login: "ada", name: "Ada", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" }]);
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
  assert.deepEqual(fake.writes.at(-1), { method: "POST", path: "repos/owen/app/issues/7/comments", input: { body: "Thanks!" } });
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
    method: "POST",
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
  await ask("/api/github/m/reviewers", "POST", { repo: "owen/app", number: 7, action: "add", users: ["bob", "Bob"], teams: ["core"] });
  assert.deepEqual(fake.writes.at(-1), { method: "POST", path: "repos/owen/app/pulls/7/requested_reviewers", input: { reviewers: ["bob"], team_reviewers: ["core"] } });
  await ask("/api/github/m/reviewers", "POST", { repo: "owen/app", number: 7, action: "remove", users: ["me"], teams: [] });
  assert.deepEqual(fake.writes.at(-1), { method: "DELETE", path: "repos/owen/app/pulls/7/requested_reviewers", input: { reviewers: ["me"], team_reviewers: [] } });
  await ask("/api/github/m/assignees", "POST", { repo: "owen/app", number: 7, action: "add", users: ["me"] });
  assert.deepEqual(fake.writes.at(-1), { method: "POST", path: "repos/owen/app/issues/7/assignees", input: { assignees: ["me"] } });
  await ask("/api/github/m/assignees", "POST", { repo: "owen/app", number: 7, action: "remove", users: ["ada"] });
  assert.deepEqual(fake.writes.at(-1), { method: "DELETE", path: "repos/owen/app/issues/7/assignees", input: { assignees: ["ada"] } });
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
  const reviewers = { repo: "owen/app", number: 7, action: "add", users: ["bob"], teams: [] };
  assert.doesNotThrow(() => checkWrite("reviewers", reviewers));
  for (const bad of [
    { ...reviewers, action: "merge" },
    { ...reviewers, users: [], teams: [] },
    { ...reviewers, users: ["bob/../x"] },
    { ...reviewers, users: "bob" },
    { ...reviewers, teams: ["a team"] },
    { ...reviewers, users: Array.from({ length: 16 }, (_, i) => `u${i}`) },
    { ...reviewers, users: Array.from({ length: 10 }, (_, i) => `u${i}`), teams: Array.from({ length: 6 }, (_, i) => `t${i}`) },
    { ...reviewers, extra: 1 },
    { repo: "owen/app", number: 7, action: "add", users: ["bob"] },
  ])
    assert.throws(() => checkWrite("reviewers", bad), JSON.stringify(bad).slice(0, 80));
  assert.doesNotThrow(() => checkWrite("assignees", { repo: "owen/app", number: 7, action: "remove", users: ["ada"] }));
  assert.throws(() => checkWrite("assignees", { repo: "owen/app", number: 7, action: "add", users: [] }));
  assert.throws(() => checkWrite("assignees", { repo: "owen/app", number: 7, action: "add", users: Array.from({ length: 11 }, (_, i) => `u${i}`) }));
  assert.throws(() => checkWrite("assignees", { repo: "owen/app", number: 7, action: "add", users: ["ada"], teams: [] }));
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
    reviewersOf(
      [
        { requestedReviewer: { __typename: "Team", slug: "core", name: "Core" } },
        { requestedReviewer: { __typename: "User", login: "carl" } },
        { requestedReviewer: { __typename: "Team", slug: "no team" } },
      ],
      [
        { author: { login: "bob" }, state: "APPROVED" },
        { author: { login: "ada" }, state: "COMMENTED" },
        { author: { login: "carl" }, state: "CHANGES_REQUESTED" },
        { author: { login: "dee" }, state: "PENDING" },
      ],
      "ada",
    ),
    [
      { kind: "user", login: "bob", requested: false, verdict: "approved" },
      // Re-requested: the earlier verdict stays beside the request.
      { kind: "user", login: "carl", requested: true, verdict: "changes" },
      { kind: "team", login: "core", name: "Core", requested: true, verdict: null },
    ],
  );
  assert.deepEqual(checkOf({ __typename: "StatusContext", context: "deploy", state: "PENDING", createdAt: "2026-10-30T09:00:00Z", creator: { login: "vercel" } }), {
    name: "deploy",
    state: "pending",
    source: "vercel",
    startedAt: "2026-10-30T09:00:00Z",
  });
  assert.equal(checkOf({ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "yesterday", checkSuite: { app: { name: "Circle" } } })!.source, "Circle");
  assert.equal(checkOf({ __typename: "CheckRun", name: "lint", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "yesterday" })!.startedAt, undefined);
  assert.deepEqual(filesFromPatches([{ filename: "r.ts", previous_filename: "q.ts", status: "renamed", additions: 0, deletions: 0 }, "not a file"]), [
    { path: "r.ts", oldPath: "q.ts", isNew: false, isDeleted: false, additions: 0, deletions: 0, hunks: [], status: "ok" },
  ]);
});

// ── Repositories ─────────────────────────────────────────────────────────────
const star = (kind: "repo" | "org", name: string, starred = true) => ask("/api/github/m/star", "POST", { kind, name, starred });

test("repositories: favourites first, then the others with open PRs, each counted", async () => {
  writeSettings({ keep: "me" });
  fake.viewerRepos = [fakeRepo("owen/app", 2), fakeRepo("owen/quiet", 0), fakeRepo("owen/old", 3, { isArchived: true }), fakeRepo("acme/web", 1)];
  fake.repos.set("other/starred", fakeRepo("other/starred", 0));
  fake.owners.set("acme", [fakeRepo("acme/web", 1), fakeRepo("acme/api", 4), fakeRepo("acme/none", 0)]);
  fake.search[SCOPE_QUERY.involved] = [fakePr({ number: 3, repo: "far/lib" })];
  fake.repos.set("far/lib", fakeRepo("far/lib", 5));

  assert.equal((await star("repo", "other/starred")).status, 200);
  const r = await star("org", "acme");
  assert.deepEqual(r.body, { ok: true, stars: { repos: ["other/starred"], orgs: ["acme"] } });
  // Kept in settings.json beside the file's other keys.
  const saved = readSettings()!;
  assert.equal(saved.keep, "me");
  assert.deepEqual(saved.githubStars, { repos: ["other/starred"], orgs: ["acme"] });

  const list = await ask("/api/github/q/repos");
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.deepEqual(
    list.body.repos.map((x: { repo: string; open: number; starred: boolean; ownerStarred: boolean }) => [x.repo, x.open, x.starred, x.ownerStarred]),
    [
      ["other/starred", 0, true, false],
      ["acme/api", 4, false, true],
      ["acme/web", 1, false, true],
      ["far/lib", 5, false, false],
      ["owen/app", 2, false, false],
    ],
  );
  // One GraphQL query asks for them by name (variables, not spliced in).
  const q = fake.calls.filter((c) => c.path === "graphql").map((c) => c.body as { query: string; variables: Record<string, string> }).find((b) => b.query.includes("fragment R"))!;
  assert.deepEqual(q.variables, { r0o: "other", r0n: "starred", r1o: "far", r1n: "lib", o0: "acme" });

  // Unstarring takes it away; a starred repository GitHub doesn't know stays, marked missing.
  await star("org", "ACME", false);
  await star("repo", "gone/away");
  const again = await ask("/api/github/q/repos");
  const gone = again.body.repos.find((x: { repo: string }) => x.repo === "gone/away");
  assert.equal(gone.missing, true);
  assert.equal(again.body.repos.some((x: { repo: string }) => x.repo === "acme/api"), false);
  assert.deepEqual(again.body.stars, { repos: ["other/starred", "gone/away"], orgs: [] });
});

test("starring is checked, and never overwrites an unreadable settings file", async () => {
  for (const body of [
    { kind: "repo", name: "noslash", starred: true },
    { kind: "org", name: "a/b", starred: true },
    { kind: "team", name: "x", starred: true },
    { kind: "repo", name: "../etc", starred: true },
    { kind: "repo", name: "a/b", starred: "yes" },
    { kind: "repo", name: "a/b", starred: true, extra: 1 },
  ])
    assert.equal((await ask("/api/github/m/star", "POST", body)).status, 400, JSON.stringify(body));
  writeFileSync(settingsFile(), "{ not json");
  // Unreadable, GitHub reads as off; the stars themselves refuse too, and the file stays as it was.
  assert.equal((await star("repo", "a/b")).status, 503);
  assert.throws(() => saveStar("repo", "a/b", true), /can't be read/);
  assert.equal(readFileSync(settingsFile(), "utf8"), "{ not json");
});

test("a repository's PRs are asked of GitHub's search with its filters", async () => {
  const [q] = filterQueries("owen/app", { state: "merged", author: ["@me"], review: "approved", draft: "ready", checks: "failing" });
  assert.equal(q, "is:pr repo:owen/app is:merged review:approved draft:false status:failure author:@me sort:updated-desc");
  fake.search[q!] = [fakePr({ number: 4, state: "MERGED" }), fakePr({ number: 5, repo: "owen/other" })];
  const r = await ask("/api/github/q/prs?repo=owen/app&state=merged&author=@me&review=approved&draft=ready&checks=failing");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.repo, "owen/app");
  assert.deepEqual(r.body.rows.map((x: { number: number; state: string }) => [x.number, x.state]), [[4, "merged"]]);
  // Open by default.
  fake.search[filterQueries("owen/app", { state: "open" })[0]!] = [fakePr({ number: 6 })];
  assert.deepEqual((await ask("/api/github/q/prs?repo=owen/app")).body.rows.map((x: { number: number }) => x.number), [6]);
  for (const bad of [
    "repo=owen/app&state=all",
    "repo=owen/app&scope=review",
    "repo=nope",
    "repo=owen/app&author=@you",
    "repo=owen/app&author=a b",
    "repo=owen/app&author=a,b,c,d,e,f,g",
    "repo=owen/app&author=a,b,c,d&reviewer=x",
    "repo=owen/app&checks=1&checks=2",
  ])
    assert.equal((await ask(`/api/github/q/prs?${bad}`)).status, 400, bad);
});

test("people filters: any of several, a search for each, in one request and merged", async () => {
  const f = checkFilters({ author: ["ada", "@me"], reviewer: ["bob"], assignee: ["dependabot[bot]"] });
  const queries = filterQueries("owen/app", f);
  assert.deepEqual(queries, [
    "is:pr repo:owen/app is:open author:@me review-requested:bob assignee:app/dependabot sort:updated-desc",
    "is:pr repo:owen/app is:open author:@me reviewed-by:bob assignee:app/dependabot sort:updated-desc",
    "is:pr repo:owen/app is:open author:ada review-requested:bob assignee:app/dependabot sort:updated-desc",
    "is:pr repo:owen/app is:open author:ada reviewed-by:bob assignee:app/dependabot sort:updated-desc",
  ]);
  const ada = filterQueries("owen/app", { state: "open", author: ["ada", "bob"] });
  fake.search[ada[0]!] = [fakePr({ number: 1 }), fakePr({ number: 2, updatedAt: "2026-10-31T00:00:00Z" })];
  fake.search[ada[1]!] = [fakePr({ number: 2, updatedAt: "2026-10-31T00:00:00Z" }), fakePr({ number: 3 })];
  const r = await ask("/api/github/q/prs?repo=owen/app&author=bob,ada");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.rows.map((x: { number: number }) => x.number), [2, 3, 1]);
  assert.equal(r.body.total, 3);
  // One request, two searches, both taken from the minute's budget.
  const asked = fake.calls.filter((c) => c.path === "graphql");
  assert.equal(asked.length, 1);
  assert.deepEqual((asked[0]!.body as { variables: unknown }).variables, { q0: ada[0], q1: ada[1] });
  // Found more than it answered: their counts added.
  fake.counts[ada[0]!] = 120;
  assert.equal((await ask("/api/github/q/prs?repo=owen/app&author=ada,bob&fresh=1")).body.total, 122);
});

test("filters kept from before: the old author filter becomes you, unknown and surplus people go", () => {
  assert.deepEqual(checkFilters({ state: "open", author: "me" }), { state: "open", author: ["@me"] });
  assert.deepEqual(checkFilters({ author: ["ada", "ADA", "a b", 3], reviewer: [] }), { state: "open", author: ["ada"] });
  // Past six searches, the last filter with people loses some.
  assert.deepEqual(checkFilters({ author: ["a", "b", "c"], reviewer: ["x", "y"] }), { state: "open", author: ["a", "b", "c"], reviewer: ["x"] });
});

test("finding a repository: those known first, then GitHub's search, and the account typed", async () => {
  fake.viewerRepos = [fakeRepo("owen/app", 2), fakeRepo("owen/apple-tools", 0), fakeRepo("owen/quiet", 0)];
  fake.search[SCOPE_QUERY.involved] = [fakePr({ number: 3, repo: "far/applet" })];
  fake.repos.set("far/applet", fakeRepo("far/applet", 1));
  const sq = repoSearchQuery({ name: "app" });
  assert.equal(sq.variables.q, "app in:name fork:true");
  fake.repoSearch[sq.variables.q!] = [fakeRepo("world/app", 9), fakeRepo("owen/app", 2), fakeRepo("old/app", 1, { isArchived: true })];
  const r = await ask("/api/github/q/repoSearch?q=app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Involved first, then yours as pushed, then GitHub's (once each, not archived ones).
  assert.deepEqual(r.body.repos.map((x: { repo: string }) => x.repo), ["far/applet", "owen/app", "owen/apple-tools", "world/app"]);
  assert.equal(r.body.owner, undefined);
  // Kept a minute.
  const before = fake.calls.length;
  await ask("/api/github/q/repoSearch?q=APP");
  assert.equal(fake.calls.length, before);

  // An owner, and owner/name (from a github.com address too): within that owner, the exact one first.
  fake.owners.set("acme", [fakeRepo("acme/web", 1)]);
  fake.repos.set("acme/api", fakeRepo("acme/api", 4));
  const oq = repoSearchQuery({ owner: "acme", name: "api" });
  assert.deepEqual(oq.variables, { q: "api in:name user:acme fork:true", login: "acme", name: "api" });
  fake.repoSearch[oq.variables.q!] = [fakeRepo("acme/api-docs", 0), fakeRepo("acme/api", 4)];
  const o = await ask(`/api/github/q/repoSearch?q=${encodeURIComponent("https://github.com/acme/api")}`);
  assert.deepEqual(o.body.repos.map((x: { repo: string }) => x.repo), ["acme/api", "acme/api-docs"]);
  assert.deepEqual(o.body.owner, { login: "acme", starred: false });
  const byOwner = await ask("/api/github/q/repoSearch?q=acme");
  assert.deepEqual(byOwner.body.owner, { login: "acme", starred: false });

  // One character asks only those known; nothing GitHub's search can't take is asked.
  const n = fake.calls.length;
  assert.deepEqual((await ask("/api/github/q/repoSearch?q=q")).body.repos.map((x: { repo: string }) => x.repo), ["owen/quiet"]);
  assert.equal(fake.calls.length, n);
  assert.deepEqual(searchText("@acme/"), { text: "acme", name: "acme" });
  assert.equal(searchText("a/b/c"), null);
  for (const bad of ["", "q=", "q=a%3Ab", "q=x&repo=a/b"]) assert.equal((await ask(`/api/github/q/repoSearch?${bad}`)).status, 400, bad);
});

test("finding a repository while GitHub's search is spent answers those known, saying so", async () => {
  const was = SEARCH_BUDGET.perMinute;
  fake.viewerRepos = [fakeRepo("owen/app", 2)];
  await ask("/api/github/q/repos");
  SEARCH_BUDGET.perMinute = 1;
  try {
    const r = await ask("/api/github/q/repoSearch?q=app");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.repos.map((x: { repo: string }) => x.repo), ["owen/app"]);
    assert.match(r.body.note, /busy/);
  } finally {
    SEARCH_BUDGET.perMinute = was;
  }
});

test("a repository's people: you, recent authors, then its assignable users", async () => {
  fake.people.set("owen/app", {
    assignable: [{ login: "zed" }, { login: "me" }, { login: "bob", name: "Bob", avatarUrl: "https://avatars.githubusercontent.com/u/2" }, { login: "ada" }],
    authors: [{ login: "ada", name: "Ada" }, null as unknown as Record<string, unknown>, { login: "carl" }, { login: "ada" }],
  });
  const r = await ask("/api/github/q/people?repo=owen/app");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.viewer.login, "me");
  assert.deepEqual(r.body.people.map((p: { login: string }) => p.login), ["ada", "carl", "bob", "zed"]);
  assert.equal(r.body.people[2].avatarUrl, "https://avatars.githubusercontent.com/u/2");
  // Kept five minutes.
  const before = fake.calls.length;
  await ask("/api/github/q/people?repo=owen/app");
  assert.equal(fake.calls.length, before);
  assert.equal((await ask("/api/github/q/people?repo=no/where")).body.available, false);
  assert.equal((await ask("/api/github/q/people?repo=nope")).status, 400);
});

test("a repository's teams, for its reviewers: by name, none when the token can't list them", async () => {
  fake.teams.set("acme/web", [{ slug: "web-core", name: "Web core" }, { slug: "bad slug", name: "x" }, { slug: "api", name: "API" }]);
  const r = await ask("/api/github/q/teams?repo=acme/web");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { repo: "acme/web", teams: [{ slug: "api", name: "API" }, { slug: "web-core", name: "Web core" }] });
  assert.equal(fake.calls.at(-1)!.path, "repos/acme/web/teams");
  fake.teams.set("acme/secret", { status: 403, json: { message: "Must have admin rights" } });
  assert.deepEqual((await ask("/api/github/q/teams?repo=acme/secret")).body, { repo: "acme/secret", teams: [], note: "The token can't list this repository's teams." });
  assert.deepEqual((await ask("/api/github/q/teams?repo=owen/app")).body, { repo: "owen/app", teams: [] });
  assert.equal((await ask("/api/github/q/teams?repo=nope")).status, 400);
  assert.equal((await ask("/api/github/q/teams?repo=owen/app&x=1")).status, 400);
});

test("searches keep under GitHub's 30 a minute, answering the last answer meanwhile", async () => {
  const was = SEARCH_BUDGET.perMinute;
  SEARCH_BUDGET.perMinute = 2;
  try {
    assert.equal((await ask("/api/github/q/prs?scope=review")).body.rows.length, 2);
    await ask("/api/github/q/prs?scope=mine");
    const before = fake.calls.length;
    // Over the budget: the cached list answers again, and nothing is asked.
    assert.equal((await ask("/api/github/q/prs?scope=review&fresh=1")).body.rows.length, 2);
    // With no answer to fall back on, the view says why.
    const r = await ask("/api/github/q/prs?scope=involved");
    assert.equal(r.body.available, false);
    assert.match(r.body.reason, /30 requests a minute/);
    assert.equal(fake.calls.length, before);
  } finally {
    SEARCH_BUDGET.perMinute = was;
  }
});
