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
import {
  POOL,
  POOL_DEPS,
  afterArchive,
  beforeArchive,
  poolStatus,
  releaseRoute,
  resetPool,
  startClaim,
  startRelease,
} from "./pool";
import { appSettings, saveAppSettings, settingsFile, writeSettings } from "./settings";
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
  base_domain: `${id}.example.com`,
});
const config = (repo: string) =>
  writeFileSync(join(dir, "config.env"), `# Non-secret infrastructure\nBASE_DOMAIN=example.com\n\n# Absolute path of the app repo on the Sprite.\nBOX_REPO_PATH=${repo}\n`);
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
  writeSettings({ integrations: { pool: true }, pool: { dir } });
  config("/srv/work/app");
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
    { id: "pool-1", label: "pool-1", status: "claimed", claimedAt: "2026-11-13T22:56:41Z", baseDomain: "pool-1.example.com" },
    { id: "pool-2", label: "pool-2", status: "idle", baseDomain: "pool-2.example.com" },
  ]);
  // The checkout is config.env's BOX_REPO_PATH, an absolute path on the box.
  assert.equal(status.checkout, "/srv/work/app");
  config("~/work/app");
  assert.match(poolStatus().problem, /must be an absolute path on the box/);
  assert.equal(poolStatus().checkout, "");
  rmSync(join(dir, "config.env"));
  assert.match(poolStatus().problem, /config\.env in .* can't be read/);
  assert.throws(() => startClaim(body), /config\.env/);
  config("/srv/work/app");
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
  let told = "";
  POOL_DEPS.dispatch = async (b, host, checkout, mark, prompt) => {
    // The daemon isn't answering yet the first time: nothing was issued.
    if (++tries === 1) throw new Error("The Paseo daemon did not answer within 15s.");
    mark({ host, keys: ["agents"] });
    told = prompt;
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
  // The agent is told it's on the box, how to start the app and its URLs.
  assert.match(told, /You are on pool-2.*checkout is \/srv\/work\/app/);
  assert.match(told, /paseo-box-up/);
  assert.match(told, /https:\/\/control-panel\.pool-2\.example\.com\/login/);
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

test("Settings saves only the folder: the checkout is config.env's", () => {
  assert.deepEqual(saveAppSettings({ pool: { dir: "~/boxes" } }).pool, { dir: "~/boxes" });
  assert.throws(() => saveAppSettings({ pool: { dir: "~/boxes", checkout: "/srv/app" } }), /Invalid pool box settings/);
  assert.throws(() => saveAppSettings({ pool: { dir: "boxes" } }), /absolute path/);
  assert.deepEqual(appSettings().pool, { dir: "~/boxes" });
});

/** pool-1's host is srv_pool1; srv_mac is an ordinary host. */
function hostsFake() {
  POOL_DEPS.hostLabel = async (serverId) => ({ srv_pool1: "pool-1", srv_mac: "macmini" })[serverId];
}

test("before an archive, a pool box's checkout is read; other hosts aren't pool boxes", async () => {
  hostsFake();
  const read: string[] = [];
  POOL_DEPS.checkout = async (serverId, workspaceId) => {
    read.push(`${serverId} ${workspaceId}`);
    return { known: true, branch: "fix-login", dirty: true, unpushed: 0 };
  };
  const pooled = await beforeArchive({ host: "srv_pool1", workspace: "wks_1" });
  assert.equal(pooled.box?.id, "pool-1");
  assert.deepEqual(pooled.checkout, { known: true, branch: "fix-login", dirty: true, unpushed: 0 });
  assert.deepEqual(await beforeArchive({ host: "srv_mac", workspace: "wks_2" }), { box: null });
  // An idle box (not claimed) isn't one to release either.
  state({ "pool-1": box("pool-1", "idle") });
  assert.deepEqual(await beforeArchive({ host: "srv_pool1", workspace: "wks_1" }), { box: null });
  assert.deepEqual(read, ["srv_pool1 wks_1"]);
});

test("after an archive, what's left on the box's host is counted without the archived workspace", async () => {
  hostsFake();
  const asked: unknown[] = [];
  POOL_DEPS.remaining = async (serverId, except) => {
    asked.push({ serverId, except });
    return { workspaces: 0, agents: 0 };
  };
  const after = await afterArchive({ host: "srv_pool1", workspace: "wks_1", cwd: "/srv/work/app" });
  assert.deepEqual(after, { box: { id: "pool-1", label: "pool-1", status: "claimed", claimedAt: "2026-11-13T22:56:41Z", baseDomain: "pool-1.example.com" }, remaining: { workspaces: 0, agents: 0 } });
  assert.deepEqual(asked, [{ serverId: "srv_pool1", except: { workspaceId: "wks_1", cwd: "/srv/work/app" } }]);
  assert.deepEqual(await afterArchive({ host: "srv_mac", workspace: "wks_2" }), { box: null });
  assert.equal(asked.length, 1, "an ordinary host isn't asked");
});

test("after an archive, the last workspace's box is released; one with work left isn't", async () => {
  hostsFake();
  let left = { workspaces: 1, agents: 0 };
  POOL_DEPS.remaining = async () => left;
  await assert.rejects(
    releaseRoute({ pool: "pool-1", host: "srv_pool1", workspace: "wks_1" }),
    /pool-1 still has 1 active workspace and 0 agents; it stays claimed/,
  );
  left = { workspaces: 0, agents: 1 };
  await assert.rejects(releaseRoute({ pool: "pool-1", host: "srv_pool1", workspace: "wks_1" }), /stays claimed/);
  // Never another host's box, nor an ordinary host.
  await assert.rejects(releaseRoute({ pool: "pool-1", host: "srv_mac", workspace: "wks_1" }), /isn't pool-1's/);
  assert.equal(poolStatus().job, null, "release.sh never ran");
  left = { workspaces: 0, agents: 0 };
  const job = (await releaseRoute({ pool: "pool-1", host: "srv_pool1", workspace: "wks_1" }))!;
  assert.equal(job.kind, "release");
  const done = await finished();
  assert.equal(done.phase, "done");
  assert.equal(readFileSync(join(dir, "release-args"), "utf8").trim(), "pool-1");
});

test("a failed release says release.sh's error", async () => {
  script("release.sh", `echo "releasing $1 (paseo-$1)"\necho "error: sprite paseo-$1 does not exist" >&2\nexit 1`);
  startRelease({ pool: "pool-1" });
  const done = await finished();
  assert.equal(done.phase, "failed");
  assert.equal(done.error, "sprite paseo-pool-1 does not exist");
});

test("a named box is woken with claim.sh pool-N, even while claimed, then dispatched to", async () => {
  // pool-1 is claimed but its host is unreachable: claim.sh is idempotent, so it still runs.
  script("claim.sh", `echo "$@" > "${dir}/claim-args"\necho "claiming $1 (paseo-$1)"\necho "$1 is already claimed; confirming it is ready"\necho "ok: $1 already claimed; ready in 3s"`);
  state({ "pool-1": box("pool-1", "claimed") });
  const online: string[] = [];
  POOL_DEPS.online = async (label) => {
    online.push(label);
    return { serverId: "srv_pool1", label, target: "tcp://100.64.0.1:6767" };
  };
  const sent: any[] = [];
  POOL_DEPS.dispatch = async (b, host, _c, mark) => {
    mark({ host, keys: ["agents"] });
    sent.push({ b, host: host.serverId });
    return { agentId: "agt_woken" } as never;
  };
  const job = startClaim({ ...body, pool: "pool-1" })!;
  assert.equal(job.wake, true);
  assert.equal(job.pool, "pool-1");
  const done = await finished();
  assert.equal(done.phase, "done", done.error);
  assert.equal(readFileSync(join(dir, "claim-args"), "utf8").trim(), "pool-1");
  assert.deepEqual(online, ["pool-1"]);
  // Dispatched by the host's server id, without the box's name in the agent's body.
  assert.deepEqual(sent, [{ b: body, host: "srv_pool1" }]);
  assert.equal(done.agentId, "agt_woken");
});

test("waking refuses a box that isn't in pool-state.json, and a failed wake dispatches nothing", async () => {
  assert.throws(() => startClaim({ ...body, pool: "pool-9" }), /pool-9 isn't in pool-state/);
  assert.throws(() => startClaim({ ...body, pool: "paseo-daemon" }), /Invalid pool box/);
  state({ "pool-1": box("pool-1", "idle"), "pool-2": box("pool-2", "provisioning") });
  assert.throws(() => startClaim({ ...body, pool: "pool-2" }), /pool-2 is being provisioned; it can't be woken now/);
  // --any skips it too: only pool-1 counts as idle.
  assert.deepEqual(poolStatus().boxes.map((b) => b.status), ["idle", "provisioning"]);
  script("claim.sh", `echo "claiming $1 (paseo-$1)"\necho "error: pool-1 is marked claimed in pool-state.json, but the claim marker is absent." >&2\nexit 1`);
  let reached = false;
  POOL_DEPS.online = async () => {
    reached = true;
    throw new Error("not reached");
  };
  startClaim({ ...body, pool: "pool-1" });
  const done = await finished();
  assert.equal(done.phase, "failed");
  assert.match(done.error ?? "", /claim marker is absent/);
  assert.equal(reached, false);
});

test("a woken box whose host doesn't come online fails clearly", async () => {
  POOL_DEPS.online = async () => {
    throw new Error("pool-2 was claimed but its Paseo host didn't come online within 90 s. Check it with status.sh.");
  };
  let dispatched = false;
  POOL_DEPS.dispatch = async () => {
    dispatched = true;
    return {} as never;
  };
  startClaim({ ...body, pool: "pool-2" });
  const done = await finished();
  assert.equal(done.phase, "failed");
  assert.match(done.error ?? "", /didn't come online within 90 s/);
  assert.equal(dispatched, false);
});

test("a pool box takes a pull request: claimed, then its worktree is dispatched there", async () => {
  POOL_DEPS.online = async (label) => ({ serverId: "srv_pool2", label, target: "t" });
  const sent: any[] = [];
  POOL_DEPS.dispatch = async (b, host, checkout, mark) => {
    mark({ host, keys: ["agents"] });
    sent.push({ b, checkout });
    return { agentId: "agt_pr" } as never;
  };
  const withPr = { ...body, pr: 12, prHead: "feature-12" };
  startClaim(withPr);
  const done = await finished();
  assert.equal(done.phase, "done", done.error);
  assert.deepEqual(sent, [{ b: withPr, checkout: "/srv/work/app" }]);
  // A pull request's worktree takes its own branch.
  resetPool();
  assert.throws(() => startClaim({ ...withPr, branch: "mine" }), /takes its own branch/);
});
