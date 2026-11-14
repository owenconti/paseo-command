import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_POOL,
  claimedBoxOf,
  claimedPool,
  jobText,
  poolBoxes,
  poolCheckoutProblem,
  poolDirProblem,
  poolSettings,
  poolSettingsProblem,
  progressLine,
  scriptError,
} from "./pool";

test("poolSettings keeps only usable paths", () => {
  assert.deepEqual(poolSettings(undefined), DEFAULT_POOL);
  assert.deepEqual(DEFAULT_POOL, { dir: "", checkout: "" });
  assert.match(poolSettingsProblem(DEFAULT_POOL), /paseo-boxes folder/);
  assert.match(poolSettingsProblem({ dir: "~/boxes", checkout: "" }), /checkout/);
  assert.equal(poolSettingsProblem({ dir: "~/boxes", checkout: "/srv/app" }), "");
  assert.deepEqual(poolSettings({ dir: "~/boxes", checkout: "/srv/app" }), { dir: "~/boxes", checkout: "/srv/app" });
  assert.deepEqual(poolSettings({ dir: "relative", checkout: "/a/../b" }), DEFAULT_POOL);
  assert.equal(poolDirProblem("/x\n"), "That folder name can't be used.");
  assert.match(poolDirProblem("boxes"), /absolute path/);
  assert.equal(poolDirProblem("~/development/paseo-boxes"), "");
  assert.match(poolCheckoutProblem("~/app"), /absolute path on the box/);
  assert.equal(poolCheckoutProblem("/srv/app"), "");
});

test("poolBoxes reads each box's id, label and state, and nothing else", () => {
  const boxes = poolBoxes({
    version: 1,
    boxes: {
      "pool-10": { label: "pool-10", status: "idle", tailnet_ipv4: "100.1.1.1" },
      "pool-2": { label: "pool-2", status: "claimed", claimed_at: "2026-11-13T22:56:41Z", secret: "x" },
      "not-a-box": { status: "claimed" },
      "pool-3": { label: "bad label!", status: "weird" },
    },
  });
  assert.deepEqual(boxes, [
    { id: "pool-2", label: "pool-2", status: "claimed", claimedAt: "2026-11-13T22:56:41Z" },
    { id: "pool-3", label: "pool-3", status: "idle" },
    { id: "pool-10", label: "pool-10", status: "idle" },
  ]);
  assert.deepEqual(poolBoxes(null), []);
  assert.equal(claimedBoxOf(boxes, "pool-2")?.id, "pool-2");
  assert.equal(claimedBoxOf(boxes, "pool-10"), undefined);
});

test("the scripts' output gives the box and its progress lines", () => {
  assert.equal(claimedPool("claiming pool-1 (paseo-pool-1)"), "pool-1");
  assert.equal(claimedPool("paseo host pool-1 is online"), undefined);
  assert.equal(progressLine("step: wake sprite..."), "Wake sprite");
  assert.equal(progressLine("ok: claimed pool-1 in 14s"), "Claimed pool-1 in 14s");
  assert.equal(progressLine("warning: no tailnet IPv4 reported after claim"), "Warning: no tailnet IPv4 reported after claim");
  assert.equal(progressLine("timing: wake sprite: 1.2s"), "");
  assert.equal(progressLine("tailnet_ipv4=100.119.235.13"), "");
  assert.equal(scriptError("claiming pool-1\nerror: no idle pool boxes\n"), "no idle pool boxes");
  assert.equal(scriptError("nothing"), "");
});

test("jobText says what a job is doing", () => {
  const job = { id: "j", kind: "claim" as const, steps: [], startedAt: 0 };
  assert.equal(jobText({ ...job, phase: "claiming" }), "Claiming a pool box…");
  assert.equal(jobText({ ...job, phase: "waiting", pool: "pool-1" }), "Waiting for pool-1 to come online…");
  assert.equal(jobText({ ...job, phase: "failed", pool: "pool-1", error: "boom" }), "Couldn't start the agent on pool-1: boom");
  assert.equal(jobText({ ...job, kind: "release", phase: "done", pool: "pool-1" }), "Released pool-1");
});
