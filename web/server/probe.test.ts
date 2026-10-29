/**
 * Probe's verdict from GitHub's GraphQL answer, and which workspaces get one.
 * Pure parsing and fakes only; nothing runs gh or reaches GitHub.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openFindings, probeVerdict, probeVerdicts, type ProbeRow } from "./probe";

const HEAD = "cca82d2baa3fa7cb81359f75fc7f53b7fdde0505";
const marker = (head = HEAD) =>
  `<!-- probe-review:v1 request=request-1 head=${head} model=codex/gpt-6-luna -->`;
const answer = (o: {
  state?: string;
  head?: string;
  requested?: string[];
  reviews?: { state: string; body: string; submittedAt: string }[];
  runs?: { name: string; status: string; conclusion: string | null }[];
}) => ({
  data: {
    repository: {
      pullRequest: {
        state: o.state ?? "OPEN",
        headRefOid: o.head ?? HEAD,
        reviewRequests: { nodes: (o.requested ?? []).map((login) => ({ requestedReviewer: { login } })) },
        reviews: { nodes: o.reviews ?? [] },
        commits: { nodes: [{ commit: { checkSuites: { nodes: [{ checkRuns: { nodes: o.runs ?? [] } }] } } }] },
      },
    },
  },
});
const approved = { state: "APPROVED", body: `**Review: Approved**\n\nZero findings remain open.\n\n${marker()}`, submittedAt: "2026-10-29T16:47:32Z" };
const comment = (body: string, head = HEAD, at = "2026-10-29T17:00:00Z") => ({
  state: "COMMENTED",
  body: `**Review: Comment**\n\n${body}\n\n${marker(head)}`,
  submittedAt: at,
});

test("counts the findings a review leaves open", () => {
  assert.equal(openFindings("One finding remains open."), 1);
  assert.equal(openFindings("Two findings remain open for a human decision."), 2);
  assert.equal(openFindings("12 findings remain open"), 12);
  assert.equal(openFindings("zero findings remain open"), 0);
  assert.equal(openFindings("No fix commits were needed."), undefined);
});

test("no verdict when Probe was never asked, or the PR isn't open", () => {
  assert.equal(probeVerdict(answer({})), null);
  assert.equal(probeVerdict(answer({ state: "MERGED", reviews: [approved] })), null);
  assert.equal(probeVerdict(null), null);
});

test("an approval for the head is approved", () => {
  assert.deepEqual(probeVerdict(answer({ reviews: [approved] })), { state: "approved", head: HEAD });
});

test("a comment leaving findings open counts them", () => {
  assert.deepEqual(probeVerdict(answer({ reviews: [comment("Two findings remain open.")] })), {
    state: "findings",
    findings: 2,
    head: HEAD,
  });
  assert.deepEqual(probeVerdict(answer({ reviews: [comment("Something came up.")] })), { state: "findings", head: HEAD });
});

test("the latest review wins", () => {
  const later = comment("One finding remains open.", HEAD, "2026-10-29T18:00:00Z");
  assert.equal(probeVerdict(answer({ reviews: [later, approved] }))?.state, "findings");
  assert.equal(
    probeVerdict(answer({ reviews: [comment("One finding remains open.", HEAD, "2026-10-29T10:00:00Z"), approved] }))?.state,
    "approved",
  );
});

test("requested again or running is reviewing", () => {
  assert.deepEqual(probeVerdict(answer({ requested: ["someone", "diagonalprobe"], reviews: [approved] })), { state: "reviewing" });
  assert.deepEqual(
    probeVerdict(answer({ runs: [{ name: "probe / Codex review", status: "IN_PROGRESS", conclusion: null }] })),
    { state: "reviewing" },
  );
  // Other workflows' runs don't count.
  assert.equal(probeVerdict(answer({ runs: [{ name: "build", status: "IN_PROGRESS", conclusion: null }] })), null);
});

test("new commits since the review make it stale, and so does a deferral", () => {
  const older = "9b395ac5aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  assert.deepEqual(probeVerdict(answer({ reviews: [{ ...approved, body: `**Review: Approved**\n\n${marker(older)}` }] })), {
    state: "stale",
    reason: "head-changed",
    head: older,
  });
  const deferred = {
    state: "COMMENTED",
    body: "🤖 **Probe review:** Probe deferred the review (`head-changed`). Re-request a review from diagonalprobe to run it again.",
    submittedAt: "2026-10-29T19:00:00Z",
  };
  assert.deepEqual(probeVerdict(answer({ reviews: [approved, deferred] })), { state: "stale", reason: "deferred" });
});

test("a failed run without a review of the head is failed", () => {
  const failed = [{ name: "probe / Codex review", status: "COMPLETED", conclusion: "FAILURE" }];
  assert.deepEqual(probeVerdict(answer({ runs: failed })), { state: "failed" });
  // A review of the head stands: its run posted it.
  assert.equal(probeVerdict(answer({ runs: failed, reviews: [approved] }))?.state, "approved");
  // A skipped run is not a failure.
  assert.equal(probeVerdict(answer({ runs: [{ name: "probe", status: "COMPLETED", conclusion: "SKIPPED" }] })), null);
});

test("verdicts are keyed by host and workspace, for open PRs only", async () => {
  const pr = (url: string, state: "open" | "draft" | "merged" = "open") => ({ number: 1, title: "t", state, url });
  const rows: ProbeRow[] = [
    { workspaceId: "w1", branch: "feat/a", pr: pr("https://github.com/a/b/pull/1") },
    { workspaceId: "w2", host: "srv", branch: "feat/b", pr: pr("https://github.com/a/b/pull/2", "draft") },
    { workspaceId: "w3", branch: "feat/c", pr: pr("https://github.com/a/b/pull/3", "merged") },
    { workspaceId: "w4", branch: "main", pr: pr("https://github.com/a/b/pull/4") },
    { workspaceId: "w5", branch: "feat/e", cwd: "/repo" },
    { workspaceId: "w6", host: "srv", branch: "feat/f", cwd: "/repo" },
    { workspaceId: "w7", branch: "feat/g", pr: null },
  ];
  const asked: string[] = [];
  const out = await probeVerdicts({
    rows: async () => rows,
    pr: async (cwd, branch) => (asked.push(`${cwd} ${branch}`), pr("https://github.com/a/b/pull/5")),
    probe: async (url) => (url.endsWith("/1") ? null : { state: "approved" }),
  });
  assert.deepEqual(out, { "srv:w2": { state: "approved" }, "local:w5": { state: "approved" } });
  // gh is asked only for a local checkout Paseo can't tell about.
  assert.deepEqual(asked, ["/repo feat/e"]);
});
