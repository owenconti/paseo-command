/** The PR chip's tooltip: its title, CI and merge queue lines. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ciSummary, prTip, queueSummary } from "./links";
import type { PullRequest } from "./types";

const pr = (extra: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: "Fix the header",
  state: "open",
  url: "https://github.com/acme/app/pull/7",
  ...extra,
});

test("CI lines name failing, then pending checks", () => {
  assert.equal(
    ciSummary(
      pr({
        ci: {
          state: "failing",
          checks: [
            { name: "lint", status: "failure" },
            { name: "test", status: "failure" },
            { name: "e2e", status: "failure" },
            { name: "types", status: "failure" },
            { name: "build", status: "pending" },
          ],
        },
      }),
    ),
    "Checks failing: lint, test, e2e +1 more",
  );
  assert.equal(
    ciSummary(
      pr({
        ci: {
          state: "pending",
          checks: [{ name: "build", status: "pending" }],
        },
      }),
    ),
    "Check pending: build",
  );
  assert.equal(
    ciSummary(pr({ ci: { state: "passing", checks: [] } })),
    "Checks passing",
  );
  assert.equal(
    ciSummary(pr({ ci: { state: "none", checks: [] } })),
    "No checks",
  );
});

test("unknown or moot CI says nothing", () => {
  assert.equal(ciSummary(pr()), null);
  assert.equal(
    ciSummary(pr({ state: "merged", ci: { state: "failing", checks: [] } })),
    null,
  );
});

test("merge queue lines say what is known", () => {
  assert.equal(queueSummary(pr()), null);
  assert.equal(
    queueSummary(pr({ queue: { enabled: false, queued: false } })),
    null,
  );
  assert.equal(
    queueSummary(pr({ queue: { enabled: true, queued: false } })),
    "Merge queue required; not queued",
  );
  // Paseo's flag alone (a remote checkout): no invented position.
  assert.equal(
    queueSummary(pr({ queue: { enabled: true, queued: true } })),
    "In merge queue",
  );
  assert.equal(
    queueSummary(
      pr({
        queue: {
          enabled: true,
          queued: true,
          state: "awaiting_checks",
          position: 3,
          etaSeconds: 600,
        },
      }),
    ),
    "In merge queue: position 3, awaiting checks, merges in about 10 min",
  );
  assert.equal(
    queueSummary(
      pr({ state: "closed", queue: { enabled: true, queued: true } }),
    ),
    null,
  );
});

test("the tooltip stacks title, CI and queue", () => {
  assert.equal(
    prTip(pr({ ci: { state: "passing", checks: [] } }), {
      enabled: true,
      queued: true,
      position: 1,
    }),
    "Fix the header\nChecks passing\nIn merge queue: position 1",
  );
  assert.equal(prTip(pr({ title: "" })), "Pull request #7");
});
