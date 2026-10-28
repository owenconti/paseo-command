import test from "node:test";
import assert from "node:assert/strict";
import { PR_LABELS, prFlags } from "../src/prStatus.ts";

test("the six PR labels, their colours and groups, in atlas order", () => {
  assert.deepEqual(
    PR_LABELS.map((l) => [l.flag, l.group, l.name, l.color]),
    [
      ["ci-running", "ci", "CI running", "amber"],
      ["ci-green", "ci", "CI green", "emerald"],
      ["ci-failing", "ci", "CI failing", "red"],
      ["review-awaiting", "review", "Awaiting review", "sky"],
      ["review-approved", "review", "Approved", "violet"],
      ["review-changes", "review", "Changes requested", "orange"],
    ],
  );
});

test("prFlags reads a workspace's labels, ignoring others", () => {
  assert.deepEqual(prFlags(["CI running", "Awaiting review", "bug"]), {
    ci: "ci-running",
    review: "review-awaiting",
  });
  assert.deepEqual(prFlags(undefined), {});
  assert.deepEqual(prFlags(["bug"]), {});
});

test("prFlags matches names as the daemon does: case and spacing aside", () => {
  assert.deepEqual(prFlags(["approved", " ci  green "]), {
    ci: "ci-green",
    review: "review-approved",
  });
  assert.deepEqual(prFlags(["CI-green"]), {});
});

test("prFlags picks one per group, the most urgent", () => {
  assert.equal(prFlags(["CI green", "CI failing"]).ci, "ci-failing");
  assert.equal(prFlags(["CI green", "CI running"]).ci, "ci-running");
  assert.equal(prFlags(["CI running", "CI failing"]).ci, "ci-failing");
  assert.equal(prFlags(["Approved", "Changes requested"]).review, "review-changes");
  assert.equal(prFlags(["Approved", "Awaiting review"]).review, "review-awaiting");
});
