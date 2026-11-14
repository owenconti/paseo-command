import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_LINGER_MS,
  claimTitle,
  dispatchFailure,
  pendingClaims,
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
  poolCheckoutOf,
  claimable,
  idleBoxes,
  unclaimableWhy,
  checkoutClean,
  releaseWarning,
  boxIdle,
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

test("poolCheckoutOf reads what releasing would lose", () => {
  const git = { isGit: true, error: null, currentBranch: "fix-login", isDirty: false, aheadBehind: { ahead: 3, behind: 0 } };
  // Pushed: nothing ahead of its upstream.
  const pushed = poolCheckoutOf({ ...git, aheadOfOrigin: 0 });
  assert.deepEqual(pushed, { known: true, branch: "fix-login", dirty: false, unpushed: 0 });
  assert.equal(checkoutClean(pushed), true);
  // Commits not pushed to its upstream.
  assert.equal(poolCheckoutOf({ ...git, aheadOfOrigin: 2 }).unpushed, 2);
  // No upstream: its commits past the base were never pushed.
  assert.equal(poolCheckoutOf({ ...git, aheadOfOrigin: null }).unpushed, 3);
  const dirty = poolCheckoutOf({ ...git, isDirty: true, aheadOfOrigin: 0 });
  assert.equal(checkoutClean(dirty), false);
  // Unknown is never clean.
  const failed = poolCheckoutOf({ error: { code: "UNKNOWN", message: "git failed" } }, "main");
  assert.deepEqual(failed, { known: false, branch: "main", error: "git failed" });
  assert.equal(checkoutClean(failed), false);
  assert.equal(checkoutClean(poolCheckoutOf({ isGit: false, error: null })), false);
  assert.equal(checkoutClean(poolCheckoutOf(null)), false);
});

test("releaseWarning says what releasing discards", () => {
  assert.equal(
    releaseWarning("pool-1", { known: true, branch: "fix-login", dirty: true, unpushed: 1 }),
    "Releasing pool-1 discards unpushed changes in fix-login (uncommitted changes and 1 unpushed commit).",
  );
  assert.equal(
    releaseWarning("pool-1", { known: true, branch: "fix-login", dirty: false, unpushed: 4 }),
    "Releasing pool-1 discards unpushed changes in fix-login (4 unpushed commits).",
  );
  assert.equal(
    releaseWarning("pool-1", { known: false, branch: "main", error: "its daemon didn't answer" }),
    "Releasing pool-1 discards anything unpushed in main: its changes couldn't be checked (its daemon didn't answer).",
  );
  assert.equal(boxIdle({ workspaces: 0, agents: 0 }), true);
  assert.equal(boxIdle({ workspaces: 0, agents: 1 }), false);
});

test("boxes being provisioned or failed are neither idle nor wakeable", () => {
  const boxes = poolBoxes({
    boxes: {
      "pool-1": { label: "pool-1", status: "idle" },
      "pool-2": { label: "pool-2", status: "provisioning" },
      "pool-3": { label: "pool-3", status: "failed" },
      "pool-4": { label: "pool-4", status: "claimed" },
    },
  });
  assert.deepEqual(boxes.map((b) => b.status), ["idle", "provisioning", "failed", "claimed"]);
  assert.deepEqual(idleBoxes(boxes).map((b) => b.id), ["pool-1"]);
  assert.deepEqual(boxes.filter(claimable).map((b) => b.id), ["pool-1", "pool-4"]);
  assert.equal(unclaimableWhy(boxes[1]), "pool-2 is being provisioned");
  assert.match(unclaimableWhy(boxes[2]), /failed its last provision/);
});

test("pending claims: running and failed ones show; a done one only until the fleet lists its agent", () => {
  const base = { kind: "claim" as const, steps: [], startedAt: 1 };
  const jobs = [
    { ...base, id: "a", phase: "waiting" as const },
    { ...base, id: "b", phase: "failed" as const, error: "x" },
    { ...base, id: "c", phase: "failed" as const, dismissed: true },
    { ...base, id: "d", phase: "done" as const, agentId: "ag-d", endedAt: 1000 },
    { ...base, id: "e", phase: "done" as const, agentId: "ag-e", endedAt: 1000 },
    { ...base, id: "f", kind: "release" as const, phase: "releasing" as const },
  ];
  const known = (id: string) => id === "ag-e";
  assert.deepEqual(pendingClaims(jobs, known, 2000).map((j) => j.id), ["a", "b", "d"]);
  // A done claim whose agent never shows isn't listed for ever.
  assert.deepEqual(pendingClaims(jobs, known, 1000 + CLAIM_LINGER_MS).map((j) => j.id), ["a", "b"]);
  assert.deepEqual(pendingClaims(undefined, known), []);
});

test("a dispatch failure says the box is fine and, for gh, where to look", () => {
  assert.equal(dispatchFailure("pool-2", "No such project"), "pool-2 is claimed and online, but its daemon refused the agent: No such project");
  assert.match(dispatchFailure("pool-2", "GitHub CLI authentication failed"), /gh auth status` on pool-2/);
  assert.equal(claimTitle("  Fix it\nmore"), "Fix it");
  assert.equal(claimTitle("x".repeat(100)).length, 80);
  assert.equal(claimTitle(undefined), "");
});
