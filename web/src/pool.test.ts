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
  poolBoxPrompt,
  envValue,
  progressLine,
  scriptError,
} from "./pool";

test("poolSettings keeps only usable paths", () => {
  assert.deepEqual(poolSettings(undefined), DEFAULT_POOL);
  assert.deepEqual(DEFAULT_POOL, { dir: "" });
  assert.match(poolSettingsProblem(DEFAULT_POOL), /paseo-boxes folder/);
  assert.equal(poolSettingsProblem({ dir: "~/boxes" }), "");
  // A checkout saved before it came from config.env is left out.
  assert.deepEqual(poolSettings({ dir: "~/boxes", checkout: "/srv/app" }), { dir: "~/boxes" });
  assert.deepEqual(poolSettings({ dir: "relative" }), DEFAULT_POOL);
  assert.equal(poolDirProblem("/x\n"), "That folder name can't be used.");
  assert.match(poolDirProblem("boxes"), /absolute path/);
  assert.equal(poolDirProblem("~/development/paseo-boxes"), "");
  assert.match(poolCheckoutProblem("~/app"), /absolute path on the box \(not ~/);
  assert.match(poolCheckoutProblem(""), /no BOX_REPO_PATH/);
  assert.equal(poolCheckoutProblem("/srv/app"), "");
});

test("envValue reads config.env's plain assignments", () => {
  const text = [
    "# Absolute path of the app repo on the Sprite.",
    "BOX_REPO_PATH=/srv/work/app",
    "BASE_DOMAIN=example.com # the parent domain",
    'QUOTED="/a b/c"',
    "export LATER=1",
    "LATER=2",
  ].join("\n");
  assert.equal(envValue(text, "BOX_REPO_PATH"), "/srv/work/app");
  assert.equal(envValue(text, "BASE_DOMAIN"), "example.com");
  assert.equal(envValue(text, "QUOTED"), "/a b/c");
  assert.equal(envValue(text, "LATER"), "2");
  assert.equal(envValue(text, "MISSING"), undefined);
});

test("poolBoxPrompt tells the agent where it is and how to start the app", () => {
  const prompt = poolBoxPrompt({ id: "pool-2", baseDomain: "pool-2.example.com" }, "/srv/work/app");
  assert.match(prompt, /^<paseo_pool_box>\nYou are on pool-2/);
  assert.match(prompt, /checkout is \/srv\/work\/app/);
  assert.match(prompt, /`paseo-box-up`/);
  assert.match(prompt, /https:\/\/control-panel\.pool-2\.example\.com\/login and https:\/\/e2e\.pool-2\.example\.com\/login/);
  assert.doesNotMatch(poolBoxPrompt({ id: "pool-2" }, "/srv/work/app"), /https:/);
});

test("poolBoxes reads each box's id, label and state, and nothing else", () => {
  const boxes = poolBoxes({
    version: 1,
    boxes: {
      "pool-10": { label: "pool-10", status: "idle", tailnet_ipv4: "100.1.1.1" },
      "pool-2": { label: "pool-2", status: "claimed", claimed_at: "2026-11-13T22:56:41Z", base_domain: "pool-2.Example.com", secret: "x" },
      "not-a-box": { status: "claimed" },
      "pool-3": { label: "bad label!", status: "weird" },
    },
  });
  assert.deepEqual(boxes, [
    { id: "pool-2", label: "pool-2", status: "claimed", claimedAt: "2026-11-13T22:56:41Z", baseDomain: "pool-2.example.com" },
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
