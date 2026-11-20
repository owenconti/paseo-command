import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fleet, get as call, install, register, serve } from "./fake-daemon";

const get = async (path: string) => {
  const r = await call(path);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
import { isDiagonalRepo, parseWorktreeStatus, resetWorkspaceUrls, WORKTREE_TERMINAL } from "./worktreeUrl";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
let server: Awaited<ReturnType<typeof serve>>;
const STATUS = "Slot: diagonal-17\nLink: /srv/slots/diagonal-17\nSetup: complete\nURL: https://chamber.17.diagonal.test/admin";
before(async () => {
  uninstall = install(network);
  local.addProject({ projectId: "prj_diag", path: "/code/diagonal" });
  local.addWorkspace({ id: "wks_diag", projectId: "prj_diag", cwd: "/code/diagonal-wt", remoteUrl: "git@github.com:Diagonal-HQ/diagonal.git" });
  local.addWorkspace({ id: "wks_bare", projectId: "prj_diag", cwd: "/code/diagonal-bare", remoteUrl: "git@github.com:Diagonal-HQ/diagonal.git" });
  local.addProject({ projectId: "prj_app", path: "/code/app" });
  local.addWorkspace({ id: "wks_app", projectId: "prj_app", cwd: "/code/app", remoteUrl: "git@github.com:acme/app.git" });
  remote.addProject({ projectId: "prj_far", path: "/srv/diagonal" });
  remote.addWorkspace({ id: "wks_far", projectId: "prj_far", cwd: "/srv/diagonal", remoteUrl: "https://github.com/Diagonal-HQ/diagonal" });
  local.worktreeStatus.set("/code/diagonal-wt", STATUS);
  remote.worktreeStatus.set("/srv/diagonal", STATUS.replace(/17/g, "23"));
  server = await serve();
});
after(async () => {
  await server?.close();
  uninstall();
  setTimeout(() => process.exit(0), 50).unref();
});

test("Diagonal's repositories, by their GitHub remote", () => {
  assert.ok(isDiagonalRepo("https://github.com/Diagonal-HQ/diagonal"));
  assert.ok(isDiagonalRepo("git@github.com:Diagonal-HQ/diagonal-marketing.git"));
  for (const no of ["https://github.com/acme/diagonal", "https://github.com/Diagonal-HQ", "https://gitlab.com/Diagonal-HQ/diagonal", "", undefined])
    assert.equal(isDiagonalRepo(no), false, String(no));
});

test("bin/worktree status's lines: its URL (https only), slot and setup", () => {
  assert.deepEqual(parseWorktreeStatus(STATUS), { url: "https://chamber.17.diagonal.test/admin", slot: "diagonal-17", setup: "complete" });
  assert.deepEqual(parseWorktreeStatus("error: this worktree has no durable instance claim; run bin/worktree setup"), { url: null, why: "no-url" });
  assert.equal(parseWorktreeStatus("URL: http://chamber.17.diagonal.test/admin").url, null, "https only");
  assert.equal(parseWorktreeStatus("URL: javascript:alert(1)").url, null);
  assert.deepEqual(parseWorktreeStatus("no bin/worktree"), { url: null, why: "no-script" });
});

test("a Diagonal workspace's URL comes from bin/worktree status in its folder, on its host; the terminal goes", async () => {
  resetWorkspaceUrls();
  const status = await get("workspace-url?workspace=wks_diag");
  assert.deepEqual(status, { url: "https://chamber.17.diagonal.test/admin", slot: "diagonal-17", setup: "complete" });
  const created = local.calls.filter((c) => c.method === "createTerminal");
  assert.equal(created.length, 1);
  assert.equal(created[0]!.args[0], "/code/diagonal-wt", "in the workspace's folder, from the fleet's row");
  assert.equal(created[0]!.args[1].command, "/bin/sh");
  assert.match(created[0]!.args[1].args[1], /bin\/worktree status/);
  assert.equal(local.terminals.size, 0, "the terminal is ended once read");
  // Kept: asked again, nothing runs.
  await get("workspace-url?workspace=wks_diag");
  assert.equal(local.calls.filter((c) => c.method === "createTerminal").length, 1);
  // A remote host's workspace runs on that host.
  const far = await get("workspace-url?workspace=wks_far&host=srv_remote");
  assert.equal(far.url, "https://chamber.23.diagonal.test/admin");
  assert.ok(remote.calls.some((c) => c.method === "createTerminal"));
  // A Diagonal checkout without the script says so; other repositories run nothing.
  assert.deepEqual(await get("workspace-url?workspace=wks_bare"), { url: null, why: "no-script" });
  const before = local.calls.filter((c) => c.method === "createTerminal").length;
  assert.deepEqual(await get("workspace-url?workspace=wks_app"), { url: null, why: "not-diagonal" });
  assert.equal(local.calls.filter((c) => c.method === "createTerminal").length, before);
  assert.ok(WORKTREE_TERMINAL.startsWith("paseo"));
});
