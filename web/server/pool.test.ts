/**
 * Pool boxes: claiming runs the paseo-boxes claim script (a fake one, in a
 * temporary folder), waits for the box's host and dispatches into its
 * checkout; releasing runs the release script. No daemon or Sprite is reached:
 * `POOL_DEPS.online`, `dispatch` and `settle` are fakes.
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POOL, POOL_DEPS, poolStatus, resetPool, startClaim, startRelease } from "./pool";
import { settingsFile, writeSettings } from "./settings";
import { jobRunning } from "../src/pool";

const real = { ...POOL_DEPS };
const pollMs = POOL.pollMs;
let dir: string;

function script(name: string, body: string) {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
}
function state(boxes: Record<string, unknown>) {
  writeFileSync(join(dir, "pool-state.json"), JSON.stringify({ version: 1, boxes }));
}
const box = (id: string, status: string) => ({
  sprite: `paseo-${id}`,
  label: id,
  status,
  claimed_at: status === "claimed" ? "2026-11-13T22:56:41Z" : null,
  tailnet_ipv4: "100.64.0.1",
});
async function finished() {
  for (let i = 0; i < 400; i++) {
    const job = poolStatus().job;
    if (!jobRunning(job)) return job!;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the job didn't finish");
}
const body = { prompt: "Fix the flaky login test", provider: "claude", mode: "bypassPermissions" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paseo-pool-"));
  writeSettings({ integrations: { pool: true }, pool: { dir, checkout: "/srv/work/app" } });
  state({ "pool-1": box("pool-1", "claimed"), "pool-2": box("pool-2", "idle") });
  script("claim.sh", `echo "$@" > "${dir}/claim-args"\necho "claiming pool-2 (paseo-pool-2)"\necho "step: wake sprite..."\necho "timing: wake sprite: 1.2s"\necho "CLAIM_OK"\necho "step: inject secrets + marker + docker + paseo..."\necho "ok: claimed pool-2 in 14s"`);
  script("release.sh", `echo "$@" > "${dir}/release-args"\necho "releasing $1 (paseo-$1)"\necho "restoring default checkpoint v11"\necho "ok: released $1 in 40s (idle, default checkpoint v11)"`);
  POOL.pollMs = 1;
  POOL_DEPS.settle = async () => {};
});
afterEach(() => {
  Object.assign(POOL_DEPS, real);
  POOL.pollMs = pollMs;
  resetPool();
  rmSync(dir, { recursive: true, force: true });
  rmSync(settingsFile(), { force: true });
});

test("off by default: nothing is read, and claims and releases are refused", () => {
  rmSync(settingsFile(), { force: true });
  assert.deepEqual(poolStatus().enabled, false);
  assert.deepEqual(poolStatus().boxes, []);
  assert.throws(() => startClaim(body), /Turn on Pool boxes/);
  assert.throws(() => startRelease({ pool: "pool-1" }), /Turn on Pool boxes/);
});

test("the status lists the boxes from pool-state.json, and says when the scripts are missing", () => {
  const status = poolStatus();
  assert.equal(status.problem, "");
  assert.deepEqual(status.boxes, [
    { id: "pool-1", label: "pool-1", status: "claimed", claimedAt: "2026-11-13T22:56:41Z" },
    { id: "pool-2", label: "pool-2", status: "idle" },
  ]);
  assert.equal(status.settings.checkout, "/srv/work/app");
  writeSettings({ pool: { dir, checkout: "" } });
  assert.match(poolStatus().problem, /checkout on the box/);
  writeSettings({ pool: { dir, checkout: "/srv/work/app" } });
  rmSync(join(dir, "release.sh"));
  assert.match(poolStatus().problem, /release\.sh isn't in/);
  assert.throws(() => startClaim(body), /release\.sh isn't in/);
});

test("a claim runs claim.sh --any, waits for the box's host, then dispatches into its checkout", async () => {
  const online: string[] = [];
  POOL_DEPS.online = async (label) => {
    online.push(label);
    return { serverId: "srv_pool2", label, target: "pool2.example:443" };
  };
  const sent: unknown[] = [];
  let tries = 0;
  POOL_DEPS.dispatch = async (b, host, checkout, mark) => {
    // The daemon isn't answering yet the first time: nothing was issued.
    if (++tries === 1) throw new Error("The Paseo daemon did not answer within 15s.");
    mark({ host, keys: ["agents"] });
    sent.push({ b, host: host.serverId, checkout });
    return { agentId: "agt_new", status: "running", workspaceId: "wks_1" } as never;
  };
  const job = startClaim(body)!;
  assert.equal(job.kind, "claim");
  assert.equal(job.phase, "claiming");
  assert.throws(() => startClaim(body), /being claimed already/);
  const done = await finished();
  assert.equal(done.phase, "done", done.error);
  assert.equal(done.pool, "pool-2");
  assert.equal(done.agentId, "agt_new");
  assert.equal(done.host, "srv_pool2");
  assert.deepEqual(done.steps, [
    "Claiming pool-2 (paseo-pool-2)",
    "Wake sprite",
    "Inject secrets + marker + docker + paseo",
    "Claimed pool-2 in 14s",
  ]);
  assert.equal(readFileSync(join(dir, "claim-args"), "utf8").trim(), "--any");
  assert.deepEqual(online, ["pool-2"]);
  assert.equal(tries, 2);
  assert.deepEqual(sent, [{ b: body, host: "srv_pool2", checkout: "/srv/work/app" }]);
});

test("a dispatch that was issued is never sent again", async () => {
  POOL_DEPS.online = async (label) => ({ serverId: "srv_pool2", label, target: "t" });
  let tries = 0;
  POOL_DEPS.dispatch = async (_b, host, _c, mark) => {
    tries++;
    mark({ host, keys: ["agents"] });
    throw new Error("Couldn't create the workspace.");
  };
  startClaim(body);
  const done = await finished();
  assert.equal(done.phase, "failed");
  assert.equal(done.error, "Couldn't create the workspace.");
  assert.equal(tries, 1);
});

test("a claim is checked before anything runs, and refused with no idle box", () => {
  assert.throws(() => startClaim({ prompt: "x" }), /Select a provider/);
  assert.throws(() => startClaim({ ...body, projectId: "prj_1" }), /runs in its checkout/);
  assert.throws(() => startClaim({ ...body, host: "srv_other" }), /runs in its checkout/);
  state({ "pool-1": box("pool-1", "claimed") });
  assert.throws(() => startClaim(body), /Every pool box is claimed/);
  assert.equal(poolStatus().job, null);
});

test("a failed claim says the script's error and dispatches nothing", async () => {
  script("claim.sh", `echo "claiming pool-2 (paseo-pool-2)"\necho "error: sprite paseo-pool-2 did not become ready" >&2\nexit 1`);
  let dispatched = false;
  POOL_DEPS.online = async () => {
    dispatched = true;
    throw new Error("not reached");
  };
  startClaim(body);
  const done = await finished();
  assert.equal(done.phase, "failed");
  assert.equal(done.error, "sprite paseo-pool-2 did not become ready");
  assert.equal(dispatched, false);
});

test("a release runs release.sh for a claimed box only", async () => {
  assert.throws(() => startRelease({ pool: "pool-2" }), /isn't claimed/);
  assert.throws(() => startRelease({ pool: "pool-9" }), /isn't in pool-state/);
  assert.throws(() => startRelease({ pool: "../x" }), /Invalid pool box/);
  const job = startRelease({ pool: "pool-1" })!;
  assert.equal(job.phase, "releasing");
  assert.equal(job.pool, "pool-1");
  const done = await finished();
  assert.equal(done.phase, "done");
  assert.equal(readFileSync(join(dir, "release-args"), "utf8").trim(), "pool-1");
  assert.deepEqual(done.steps, [
    "Releasing pool-1 (paseo-pool-1)",
    "Restoring default checkpoint v11",
    "Released pool-1 in 40s (idle, default checkpoint v11)",
  ]);
});
