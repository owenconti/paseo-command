/**
 * The PR's CI and merge queue facts: from Paseo's `githubRuntime` and from
 * GitHub's GraphQL answers; the GitHub lookups over the fake GitHub API.
 * Nothing reaches GitHub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { installGithubApi } from "./githubFake";
import {
  MAX_CHECKS,
  ciFromRollup,
  ciFromRuntime,
  githubMergeQueue,
  githubPullRequest,
  prFromGraphql,
  repoCoordinates,
  resetLinks,
  prCoordinates,
  prFromRuntime,
  prStateFromGraphql,
  queueFromGraphql,
  queueFromRuntime,
} from "./links";

const URL_ = "https://github.com/acme/app/pull/42";
const runtimePr = (extra: Record<string, unknown> = {}) => ({
  featuresEnabled: true,
  pullRequest: {
    url: URL_,
    title: "Add the thing",
    state: "open",
    baseRefName: "main",
    headRefName: "feat/thing",
    isMerged: false,
    ...extra,
  },
});

test("Paseo's checks and rollup are carried through", () => {
  const pr = prFromRuntime(
    runtimePr({
      checksStatus: "failure",
      checks: [
        { name: "build", status: "success", url: "https://ci.example/1" },
        { name: "lint", status: "failure", url: "https://ci.example/2" },
        { name: "e2e", status: "pending", url: null, workflow: "CI" },
        { name: "docs", status: "skipped", url: "javascript:alert(1)" },
      ],
    }),
  );
  assert.deepEqual(pr?.ci, {
    state: "failing",
    // Failing first, then pending; unsafe links dropped.
    checks: [
      { name: "lint", status: "failure", url: "https://ci.example/2" },
      { name: "e2e", status: "pending" },
      { name: "build", status: "success", url: "https://ci.example/1" },
      { name: "docs", status: "skipped" },
    ],
  });
});

test("Paseo's rollup maps to the small state set", () => {
  for (const [from, to] of [
    ["success", "passing"],
    ["failure", "failing"],
    ["pending", "pending"],
    ["none", "none"],
  ])
    assert.equal(ciFromRuntime({ checksStatus: from })?.state, to);
});

test("without a rollup, listed checks are rolled up as Paseo does", () => {
  const ci = (statuses: string[]) =>
    ciFromRuntime({
      checks: statuses.map((status, i) => ({
        name: `c${i}`,
        status,
        url: null,
      })),
    })?.state;
  assert.equal(ci([]), "none");
  assert.equal(ci(["success", "skipped", "cancelled"]), "passing");
  assert.equal(ci(["success", "pending"]), "pending");
  assert.equal(ci(["pending", "failure"]), "failing");
  // Unknown statuses are dropped, not guessed at.
  assert.deepEqual(
    ciFromRuntime({ checks: [{ name: "x", status: "weird", url: null }] }),
    { state: "none", checks: [] },
  );
});

test("no CI facts from Paseo is unknown, not passing", () => {
  assert.equal(prFromRuntime(runtimePr())?.ci, undefined);
  assert.equal(ciFromRuntime({ checksStatus: "maybe" }), undefined);
});

test("checks are capped, failing ones kept", () => {
  const checks = Array.from({ length: MAX_CHECKS + 10 }, (_, i) => ({
    name: `c${i}`,
    status: i === MAX_CHECKS + 5 ? "failure" : "success",
    url: null,
  }));
  const ci = ciFromRuntime({ checks });
  assert.equal(ci?.checks.length, MAX_CHECKS);
  assert.equal(ci?.checks[0].name, `c${MAX_CHECKS + 5}`);
  assert.equal(ci?.state, "failing");
});

test("Paseo's merge queue flags come from its GitHub facts", () => {
  const pr = prFromRuntime(
    runtimePr({
      forgeSpecific: {
        forge: "github",
        mergeStateStatus: "BLOCKED",
        isMergeQueueEnabled: true,
        isInMergeQueue: true,
      },
    }),
  );
  assert.deepEqual(pr?.queue, { enabled: true, queued: true });
  // Older daemons mirror the facts as `github`.
  assert.deepEqual(
    queueFromRuntime({
      github: { isMergeQueueEnabled: true, isInMergeQueue: false },
    }),
    { enabled: true, queued: false },
  );
  // Another forge's facts, or none, say nothing about a GitHub queue.
  assert.equal(
    queueFromRuntime({
      forgeSpecific: { forge: "gitlab", isInMergeQueue: true },
    }),
    undefined,
  );
  assert.equal(prFromRuntime(runtimePr())?.queue, undefined);
});

test("auto-merge comes from Paseo's GitHub facts, else GitHub's autoMergeRequest", () => {
  const on = prFromRuntime(
    runtimePr({
      forgeSpecific: {
        forge: "github",
        autoMergeRequest: { enabledAt: "2026-10-29T00:00:00Z", mergeMethod: "SQUASH", enabledBy: "owen" },
      },
    }),
  );
  assert.deepEqual(on?.autoMerge, { method: "squash", by: "owen" });
  assert.equal(
    prFromRuntime(runtimePr({ forgeSpecific: { forge: "github", autoMergeRequest: null } }))?.autoMerge,
    undefined,
  );
  assert.equal(prFromRuntime(runtimePr())?.autoMerge, undefined);
  assert.deepEqual(
    prFromGraphql({ url: URL_, number: 1, title: "t", state: "OPEN", autoMergeRequest: { mergeMethod: "REBASE", enabledBy: { login: "bot" } } })
      ?.autoMerge,
    { method: "rebase", by: "bot" },
  );
  assert.equal(prFromGraphql({ url: URL_, number: 1, title: "t", state: "OPEN", autoMergeRequest: null })?.autoMerge, undefined);
});

test("GitHub's statusCheckRollup folds check runs and status contexts", () => {
  const ci = ciFromRollup([
    {
      __typename: "CheckRun",
      name: "test",
      status: "COMPLETED",
      conclusion: "FAILURE",
      detailsUrl: "https://github.com/acme/app/actions/runs/1/job/1",
      startedAt: "2026-10-27T01:00:00Z",
    },
    // A re-run of the same check, later: it wins.
    {
      __typename: "CheckRun",
      name: "test",
      status: "IN_PROGRESS",
      conclusion: "",
      detailsUrl: "https://github.com/acme/app/actions/runs/1/job/2",
      startedAt: "2026-10-27T02:00:00Z",
    },
    {
      __typename: "CheckRun",
      name: "lint",
      status: "COMPLETED",
      conclusion: "NEUTRAL",
      detailsUrl: "",
    },
    {
      __typename: "StatusContext",
      context: "ci/legacy",
      state: "SUCCESS",
      targetUrl: "https://ci.example/legacy",
    },
    {
      __typename: "CheckRun",
      name: "timeout",
      status: "COMPLETED",
      conclusion: "TIMED_OUT",
      detailsUrl: null,
    },
  ]);
  assert.deepEqual(ci, {
    state: "failing",
    checks: [
      { name: "timeout", status: "failure" },
      {
        name: "test",
        status: "pending",
        url: "https://github.com/acme/app/actions/runs/1/job/2",
      },
      {
        name: "ci/legacy",
        status: "success",
        url: "https://ci.example/legacy",
      },
      { name: "lint", status: "skipped" },
    ],
  });
  assert.deepEqual(ciFromRollup([]), { state: "none", checks: [] });
  assert.equal(ciFromRollup(undefined), undefined);
});

test("GitHub's PR carries its head's checks", () => {
  const pr = prFromGraphql({
    number: 42,
    title: "Add the thing",
    state: "OPEN",
    isDraft: false,
    url: URL_,
    body: "",
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "build",
                    status: "QUEUED",
                    conclusion: "",
                  },
                ],
              },
            },
          },
        },
      ],
    },
  });
  assert.deepEqual(pr?.ci, {
    state: "pending",
    checks: [{ name: "build", status: "pending" }],
  });
});

test("GitHub's merge queue entry is read in full", () => {
  assert.deepEqual(
    queueFromGraphql({
      data: {
        repository: {
          pullRequest: {
            isMergeQueueEnabled: true,
            isInMergeQueue: true,
            mergeQueueEntry: {
              state: "AWAITING_CHECKS",
              position: 2,
              estimatedTimeToMerge: 312.4,
              enqueuedAt: "2026-10-27T03:00:00Z",
            },
          },
        },
      },
    }),
    {
      enabled: true,
      queued: true,
      state: "awaiting_checks",
      position: 2,
      etaSeconds: 312,
      enqueuedAt: "2026-10-27T03:00:00Z",
    },
  );
  assert.deepEqual(
    queueFromGraphql({
      data: {
        repository: {
          pullRequest: {
            isMergeQueueEnabled: true,
            isInMergeQueue: false,
            mergeQueueEntry: null,
          },
        },
      },
    }),
    { enabled: true, queued: false },
  );
  // Unknown states and junk are left out rather than guessed.
  assert.deepEqual(
    queueFromGraphql({
      data: {
        repository: {
          pullRequest: {
            mergeQueueEntry: { state: "TELEPORTING", position: "1" },
          },
        },
      },
    }),
    { enabled: true, queued: true },
  );
  assert.equal(
    queueFromGraphql({ data: { repository: { pullRequest: null } } }),
    null,
  );
  assert.equal(queueFromGraphql(null), null);
});

test("GitHub's current PR state, for when Paseo's lags a merge", () => {
  const answer = (pr: Record<string, unknown> | null) => ({
    data: { repository: { pullRequest: pr } },
  });
  assert.equal(prStateFromGraphql(answer({ state: "MERGED" })), "merged");
  assert.equal(prStateFromGraphql(answer({ state: "CLOSED" })), "closed");
  assert.equal(
    prStateFromGraphql(answer({ state: "OPEN", isDraft: true })),
    "draft",
  );
  assert.equal(prStateFromGraphql(answer({ state: "OPEN" })), "open");
  assert.equal(prStateFromGraphql(answer({})), undefined);
  assert.equal(prStateFromGraphql(answer(null)), undefined);
});

test("only github.com PR URLs are asked about", async () => {
  assert.deepEqual(prCoordinates(URL_), {
    owner: "acme",
    name: "app",
    number: 42,
  });
  assert.equal(prCoordinates("https://github.example.com/a/b/pull/1"), null);
  assert.equal(prCoordinates("https://github.com/a/b/issues/1"), null);
  assert.equal(prCoordinates("https://github.com/-x/b/pull/1;rm"), null);
  // Without a usable URL, or without GitHub on and a token, GitHub is never asked.
  assert.deepEqual(
    await githubMergeQueue("https://gitlab.com/a/b/-/merge_requests/1"),
    {
      available: false,
      queue: null,
    },
  );
  assert.deepEqual(await githubMergeQueue(URL_), {
    available: false,
    queue: null,
  });
});

test("repositories are read from their GitHub page or owner/name", () => {
  assert.deepEqual(repoCoordinates("https://github.com/acme/app"), { owner: "acme", name: "app" });
  assert.deepEqual(repoCoordinates("acme/app.js"), { owner: "acme", name: "app.js" });
  for (const bad of [undefined, "", "https://gitlab.com/a/b", "acme/..", "-x/b;rm", "a/b/c"])
    assert.equal(repoCoordinates(bad), null, String(bad));
});

test("a branch's PR is asked of GitHub with the token, cached, and quiet when it can't be", async () => {
  resetLinks();
  // Off, or no token: nothing is asked.
  for (const opts of [{ enabled: false }, { token: null }]) {
    const fake = installGithubApi(() => ({ json: {} }), opts);
    try {
      assert.deepEqual(await githubPullRequest("https://github.com/acme/app", "feature"), { available: false, pr: null });
      assert.equal(fake.calls.length, 0);
    } finally {
      fake.restore();
    }
  }
  let nodes: unknown[] = [{ number: 42, title: "Add it", state: "OPEN", isDraft: false, url: URL_, reviewDecision: "APPROVED", mergeable: "MERGEABLE" }];
  const fake = installGithubApi((req) =>
    req.path === "graphql" ? { json: { data: { repository: { pullRequests: { nodes } } } } } : { status: 404 },
  );
  try {
    const t = 1_000_000;
    const answer = await githubPullRequest("https://github.com/acme/app", "feature", t);
    assert.equal(answer.available, true);
    assert.equal(answer.pr?.number, 42);
    assert.equal(answer.pr?.review, "approved");
    assert.equal(answer.pr?.conflicts, false);
    assert.deepEqual((fake.calls[0]!.body as { variables: unknown }).variables, { owner: "acme", name: "app", branch: "feature" });
    await githubPullRequest("https://github.com/acme/app", "feature", t + 1000);
    assert.equal(fake.calls.length, 1, "cached");
    // A base branch never has its own PR, and isn't asked about.
    assert.deepEqual(await githubPullRequest("acme/app", "main"), { available: true, pr: null });
    // No PR for the branch.
    nodes = [];
    assert.deepEqual(await githubPullRequest("acme/app", "other", t), { available: true, pr: null });
    // A merge queue entry, by the PR's URL.
    resetLinks();
    const queue = installGithubApi(() => ({
      json: { data: { repository: { pullRequest: { state: "OPEN", isDraft: false, isMergeQueueEnabled: true, isInMergeQueue: true, mergeQueueEntry: { state: "QUEUED", position: 2 } } } } },
    }));
    try {
      assert.deepEqual(await githubMergeQueue(URL_), {
        available: true,
        queue: { enabled: true, queued: true, state: "queued", position: 2 },
        state: "open",
      });
      assert.deepEqual((queue.calls[0]!.body as { variables: unknown }).variables, { owner: "acme", name: "app", number: 42 });
    } finally {
      queue.restore();
    }
  } finally {
    fake.restore();
    resetLinks();
  }
});

test("runtime and GitHub distinguish PR lifecycle states, with terminal states taking precedence", () => {
  for (const [facts, expected] of [
    [{ state: "closed", isDraft: true }, "closed"],
    [{ state: "draft" }, "draft"],
    [{ state: "OPEN", isDraft: true }, "draft"],
    [{ state: "open", isDraft: false }, "open"],
    [{ state: "MERGED", isDraft: true }, "merged"],
  ] as const) {
    assert.equal(prFromRuntime(runtimePr(facts))?.state, expected);
    assert.equal(prFromGraphql({ url: URL_, ...facts })?.state, expected);
  }
  assert.equal(
    prFromRuntime(runtimePr({ state: "closed", isMerged: true }))?.state,
    "merged",
  );
});

test("Paseo's review decision is carried through", () => {
  for (const decision of ["approved", "changes_requested", "pending"] as const)
    assert.equal(
      prFromRuntime(runtimePr({ reviewDecision: decision }))?.review,
      decision,
    );
  assert.equal(prFromRuntime(runtimePr({ reviewDecision: null }))?.review, undefined);
  assert.equal(prFromRuntime(runtimePr())?.review, undefined);
  assert.equal("review" in prFromRuntime(runtimePr())!, false);
});

test("GitHub's review decision is read", () => {
  const pr = (reviewDecision: string) =>
    prFromGraphql({ url: URL_, number: 42, title: "t", state: "OPEN", reviewDecision });
  assert.equal(pr("APPROVED")?.review, "approved");
  assert.equal(pr("CHANGES_REQUESTED")?.review, "changes_requested");
  assert.equal(pr("REVIEW_REQUIRED")?.review, "pending");
  assert.equal(pr("")?.review, undefined);
});

test("merge conflicts are read from Paseo and GitHub; unknown stays unknown", () => {
  assert.equal(prFromRuntime(runtimePr({ mergeable: "CONFLICTING" }))?.conflicts, true);
  assert.equal(prFromRuntime(runtimePr({ mergeable: "MERGEABLE" }))?.conflicts, false);
  assert.equal("conflicts" in prFromRuntime(runtimePr({ mergeable: "UNKNOWN" }))!, false);
  assert.equal("conflicts" in prFromRuntime(runtimePr())!, false);
  const github = (mergeable: string) =>
    prFromGraphql({ url: URL_, number: 42, title: "t", state: "OPEN", mergeable });
  assert.equal(github("CONFLICTING")?.conflicts, true);
  assert.equal(github("MERGEABLE")?.conflicts, false);
  assert.equal(github("UNKNOWN")?.conflicts, undefined);
});
