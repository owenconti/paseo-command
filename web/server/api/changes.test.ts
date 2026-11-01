import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fleet, get, install, register, serve } from "../fake-daemon";
import { capFiles, githubRepoOf } from "./changes";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
let server: Awaited<ReturnType<typeof serve>>;

const file = (path: string, lines = 2) => ({
  path,
  isNew: false,
  isDeleted: false,
  additions: lines - 1,
  deletions: 0,
  status: "ok",
  hunks: [
    {
      oldStart: 1,
      oldCount: 1,
      newStart: 1,
      newCount: lines - 1,
      lines: [{ type: "header", content: "@@ -1 +1 @@" }, ...Array.from({ length: lines - 1 }, () => ({ type: "add", content: "x", tokens: [{ text: "x", style: null }] }))],
    },
  ],
});

before(async () => {
  uninstall = install(network);
  local.addProject({ projectId: "prj_app", path: "/home/review/code" });
  local.addWorkspace({ id: "wks_app", projectId: "prj_app", cwd: "/home/review/code/wt", branch: "feature" });
  local.addWorkspace({ id: "wks_plain", projectId: "prj_app", cwd: "/home/review/plain" });
  local.checkouts.set("/home/review/code/wt", {
    diffs: { all: [file("a.ts"), file("b.ts")], base: [file("a.ts")] },
    status: { currentBranch: "feature", baseRef: "main", aheadBehind: { ahead: 2, behind: 1 }, isDirty: true, remoteUrl: "git@github.com:owen/app.git" },
  });
  remote.addProject({ projectId: "prj_far", path: "/srv/far" });
  remote.addWorkspace({ id: "wks_far", projectId: "prj_far", cwd: "/srv/far" });
  remote.checkouts.set("/srv/far", { diffs: { all: [file("far.ts")] }, status: { baseRef: "main" } });
  server = await serve();
});
after(async () => {
  await server?.close();
  uninstall();
  setTimeout(() => process.exit(0), 50).unref();
});

test("a workspace's branch against main, from its daemon", async () => {
  const r = await get("changes?workspace=wks_app");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.mode, "all");
  assert.deepEqual(r.data.files.map((f: { path: string }) => f.path), ["a.ts", "b.ts"]);
  assert.deepEqual(
    [r.data.branch, r.data.baseRef, r.data.ahead, r.data.behind, r.data.dirty, r.data.repo, r.data.tooLarge],
    ["feature", "main", 2, 1, true, "owen/app", false],
  );
  assert.deepEqual(r.data.files[0].hunks[0].lines[1].tokens, [{ text: "x", style: null }]);
  const base = await get("changes?workspace=wks_app&mode=base");
  assert.deepEqual(base.data.files.map((f: { path: string }) => f.path), ["a.ts"]);
  assert.deepEqual(local.calls.find((c) => c.method === "getCheckoutDiff")!.args, ["/home/review/code/wt", { mode: "all" }]);
});

test("a remote host's workspace is diffed by its own daemon", async () => {
  const r = await get("changes?workspace=wks_far&host=srv_remote");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.files.map((f: { path: string }) => f.path), ["far.ts"]);
  assert.ok(remote.calls.some((c) => c.method === "getCheckoutDiff"));
});

test("a folder that isn't a checkout says so; bad requests are refused", async () => {
  const r = await get("changes?workspace=wks_plain");
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { available: false, reason: "This workspace's folder isn't a git checkout." });
  assert.equal((await get("changes?workspace=wks_none")).status, 400);
  assert.equal((await get("changes?workspace=wks_app&mode=everything")).status, 400);
  assert.equal((await get("changes?workspace=wks_app&x=1")).status, 400);
  assert.equal((await get("changes?workspace=wks_far")).status, 400);
});

test("large diffs keep their files but not every hunk", () => {
  const { files, tooLarge } = capFiles([file("a", 5), file("b", 5), file("c", 2), { nope: 1 }], { maxLines: 8, maxFiles: 10 });
  assert.equal(tooLarge, true);
  assert.deepEqual(files.map((f) => [f.path, f.status, f.hunks.length]), [
    ["a", "ok", 1],
    ["b", "too_large", 0],
    ["c", "too_large", 0],
  ]);
  assert.equal(githubRepoOf("https://github.com/owen/app.git"), "owen/app");
  assert.equal(githubRepoOf("ssh://git@github.com/owen/app"), "owen/app");
  assert.equal(githubRepoOf("git@gitlab.com:owen/app.git"), undefined);
});
