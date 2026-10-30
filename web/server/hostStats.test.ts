/**
 * Each host's load from the host-stats plugin's snapshot, cached per host.
 * Fakes only; no daemon is reached.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { HOST_STATS, hostStats, hostStatsOf, resetHostStats } from "./hostStats";

const snapshot = {
  cpu: { usagePercent: 14.2 },
  memory: { usedPercent: 59.4 },
  disks: [{ usedPercent: 86.1 }, { usedPercent: 10 }],
};

test("hostStatsOf reads CPU, memory and the root disk, ignoring junk", () => {
  assert.deepEqual(hostStatsOf(snapshot), { cpu: 14.2, memory: 59.4, disk: 86.1 });
  assert.deepEqual(hostStatsOf({ cpu: { usagePercent: 140 }, memory: { usedPercent: "x" } }), { cpu: 100 });
  assert.equal(hostStatsOf(null), null);
  assert.equal(hostStatsOf({ disks: [] }), null);
});

test("hostStats asks each host once per ttl and leaves out hosts that fail", async () => {
  resetHostStats();
  let now = 1000;
  const calls: string[] = [];
  const deps = {
    hosts: async () => ["local", "srv_a", "srv_b"],
    invoke: async (host: string, plugin: string, method: string) => {
      calls.push(`${host} ${plugin} ${method}`);
      if (host === "srv_b") throw new Error("plugin not installed");
      return snapshot;
    },
    now: () => now,
  };
  const first = await hostStats(deps);
  assert.deepEqual(Object.keys(first).sort(), ["local", "srv_a"]);
  assert.equal(calls.length, 3);
  assert.ok(calls.includes("local host-stats stats.snapshot"));
  await hostStats(deps);
  assert.equal(calls.length, 3, "cached within the ttl");
  now += HOST_STATS.ttlMs;
  await hostStats(deps);
  assert.equal(calls.length, 5, "answering hosts are asked again; the failed one waits");
  now += HOST_STATS.retryMs;
  await hostStats(deps);
  assert.equal(calls.length, 8);
});
