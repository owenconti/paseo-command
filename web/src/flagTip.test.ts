import { test } from "node:test";
import assert from "node:assert/strict";
import { flagTip, workspacePrLines } from "./flagTip";
import type { PullRequest } from "./types";

const pr: PullRequest = {
  number: 7,
  title: "Split the tests",
  state: "open",
  url: "https://github.com/o/r/pull/7",
  conflicts: true,
  ci: {
    state: "failing",
    checks: [
      { name: "lint", status: "failure" },
      { name: "unit", status: "success" },
      { name: "e2e", status: "pending" },
    ],
  },
};

test("a flag's card names it, says what it means, and gives its PR's facts", () => {
  assert.deepEqual(flagTip("ci-failing", pr), {
    title: "CI failing",
    description: "A check on the pull request failed.",
    facts: "1 of 3 checks failed.",
    autoMerge: "",
    pr: "#7 · Split the tests",
  });
  const conflicts = flagTip("conflicts", pr);
  assert.equal(conflicts.title, "Merge conflicts");
  assert.match(conflicts.description, /conflicts with its base branch/);
  assert.equal(conflicts.facts, "");
  assert.equal(flagTip("review-approved", undefined).pr, "");
});

test("Probe's medallion card names its verdict and its facts", () => {
  assert.deepEqual(flagTip("probe", pr, { state: "findings", findings: 2, head: "abcdef1234" }), {
    title: "Probe findings (their count)",
    description: "Probe's review left findings open.",
    facts: "Probe: 2 findings open (review of abcdef1).",
    autoMerge: "",
    pr: "#7 · Split the tests",
  });
  assert.equal(flagTip("probe", pr, { state: "stale", reason: "deferred" }).facts, "Probe: deferred its review; request it again.");
});

test("a flag's card says when auto-merge is on", () => {
  assert.equal(
    flagTip("review-approved", { ...pr, autoMerge: { method: "squash", by: "owen" } }).autoMerge,
    "Auto-merge on (squash), turned on by owen: merges once its checks and reviews pass.",
  );
  assert.equal(flagTip("ci-green", { ...pr, autoMerge: {} }).autoMerge, "Auto-merge on: merges once its checks and reviews pass.");
  assert.equal(flagTip("ci-green", { ...pr, state: "merged", autoMerge: {} }).autoMerge, "");
});

test("a workspace's card on the Overworld says its PR, flags, Probe and auto-merge in place of medallions", () => {
  assert.deepEqual(workspacePrLines(["CI failing", "Approved", "bug"], pr, { state: "approved" }), [
    "#7 · Split the tests",
    "CI failing · Approved · Probe approved",
  ]);
  assert.deepEqual(workspacePrLines(["Changes requested"], undefined, { state: "findings", findings: 3 }), [
    "Changes requested · Probe: 3 findings open",
  ]);
  assert.deepEqual(workspacePrLines(["CI green"], undefined, undefined, true), ["CI green", "Auto-merge on."]);
  // Probe's verdict is on the review, so it's said only beside a review flag, as its medallion is shown.
  assert.deepEqual(workspacePrLines(["CI running"], undefined, { state: "reviewing" }), ["CI running"]);
  assert.deepEqual(workspacePrLines(["Approved"], undefined, { state: "findings" }), ["Approved · Probe: findings open"]);
  assert.deepEqual(workspacePrLines(undefined, undefined), []);
  // A PR that isn't open says so.
  assert.deepEqual(workspacePrLines([], { ...pr, state: "merged" }), ["#7 · Split the tests · Merged"]);
  assert.deepEqual(workspacePrLines([], { ...pr, state: "closed" }), ["#7 · Split the tests · Closed"]);
  assert.deepEqual(workspacePrLines(["CI running"], { ...pr, state: "draft" }), ["#7 · Split the tests · Draft", "CI running"]);
});
