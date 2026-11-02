import assert from "node:assert/strict";
import { test } from "node:test";
import { checkTime, sortChecks, span } from "./PrSide";
import type { PrCheck } from "./types";

test("a check's time: how long it took, or how long it has been running, in whole minutes", () => {
  const now = Date.parse("2026-11-02T10:00:00Z");
  assert.equal(span(12_000), "12s");
  assert.equal(span(125_000), "2m 5s");
  assert.equal(span(3_600_000 + 240_000), "1h 4m");
  assert.equal(checkTime({ name: "t", state: "passing", startedAt: "2026-11-02T09:00:00Z", completedAt: "2026-11-02T09:02:05Z" }, now), "2m 5s");
  assert.equal(checkTime({ name: "t", state: "pending", startedAt: "2026-11-02T09:56:50Z" }, now), "running for 3m");
  assert.equal(checkTime({ name: "t", state: "pending", startedAt: "2026-11-02T09:59:30Z" }, now), "running for under a minute");
  assert.equal(checkTime({ name: "t", state: "pending" }, now), undefined);
  assert.equal(checkTime({ name: "t", state: "failing", completedAt: "2026-11-02T09:00:00Z" }, now), undefined);
});

test("checks: failing, then pending, then passing and skipped, each by name", () => {
  const checks: PrCheck[] = [
    { name: "b", state: "passing" },
    { name: "z", state: "skipped" },
    { name: "a", state: "passing" },
    { name: "p", state: "pending" },
    { name: "f", state: "failing" },
  ];
  assert.deepEqual(sortChecks(checks).map((c) => c.name), ["f", "p", "a", "b", "z"]);
});
