import { test } from "node:test";
import assert from "node:assert/strict";
import { flagTip } from "./flagTip";
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
    probe: "",
    pr: "#7 · Split the tests",
  });
  const conflicts = flagTip("conflicts", pr);
  assert.equal(conflicts.title, "Merge conflicts");
  assert.match(conflicts.description, /conflicts with its base branch/);
  assert.equal(conflicts.facts, "");
  assert.equal(flagTip("review-approved", undefined).pr, "");
});

test("the review flag's card carries Probe's verdict", () => {
  assert.equal(
    flagTip("review-awaiting", pr, { state: "findings", findings: 2, head: "abcdef1234" }).probe,
    "Probe: 2 findings open (review of abcdef1).",
  );
  assert.equal(flagTip("review-approved", pr, { state: "stale", reason: "deferred" }).probe, "Probe: deferred its review; request it again.");
  assert.equal(flagTip("review-approved", pr).probe, "");
});
