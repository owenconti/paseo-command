/**
 * The PR's CI and merge queue facts: from Paseo's `githubRuntime`, from
 * `gh pr view --json statusCheckRollup` and from GitHub's GraphQL answer.
 * Pure parsing only; nothing runs gh or reaches GitHub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CHECKS,
  ciFromRollup,
  ciFromRuntime,
  ghMergeQueue,
  ghPr,
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

test("gh's statusCheckRollup folds check runs and status contexts", () => {
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

test("gh's PR carries its checks", () => {
  const pr = ghPr({
    number: 42,
    title: "Add the thing",
    state: "OPEN",
    isDraft: false,
    url: URL_,
    body: "",
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "build",
        status: "QUEUED",
        conclusion: "",
      },
    ],
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
  // Without a usable URL or checkout, gh is never run.
  assert.deepEqual(
    await ghMergeQueue("/", "https://gitlab.com/a/b/-/merge_requests/1"),
    {
      available: false,
      queue: null,
    },
  );
  assert.deepEqual(await ghMergeQueue("relative/dir", URL_), {
    available: false,
    queue: null,
  });
});

test("runtime and gh distinguish PR lifecycle states, with terminal states taking precedence", () => {
  for (const [facts, expected] of [
    [{ state: "closed", isDraft: true }, "closed"],
    [{ state: "draft" }, "draft"],
    [{ state: "OPEN", isDraft: true }, "draft"],
    [{ state: "open", isDraft: false }, "open"],
    [{ state: "MERGED", isDraft: true }, "merged"],
  ] as const) {
    assert.equal(prFromRuntime(runtimePr(facts))?.state, expected);
    assert.equal(ghPr({ url: URL_, ...facts })?.state, expected);
  }
  assert.equal(
    prFromRuntime(runtimePr({ state: "closed", isMerged: true }))?.state,
    "merged",
  );
});
