import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fleet, get, install, post, register } from "../fake-daemon";
import { folderName, folderPath } from "./projects";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
const remote = register(local, network, "srv_remote", "10.0.0.9:6767");
let uninstall: () => void;
before(() => {
  uninstall = install(network);
});
after(() => {
  uninstall();
  // The API keeps live connections and timers; nothing else runs here.
  setTimeout(() => process.exit(0), 50).unref();
});

test("folders: home by default, subfolders only, sorted", async () => {
  local.folders.add("/home/review/.config");
  local.folders.add("/home/review/Apps");
  const r = await get("folders");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.path, "/home/review");
  assert.equal(r.data.home, "/home/review");
  assert.equal(r.data.parent, "/home");
  assert.deepEqual(
    r.data.folders.map((f: { name: string }) => f.name),
    ["Apps", "code", ".config"],
  );
  assert.equal(r.data.folders[0].path, "/home/review/Apps");
  const root = await get("folders?path=%2F");
  assert.equal(root.data.parent, null);
  assert.deepEqual(root.data.folders, [{ name: "home", path: "/home" }]);
});

test("folders: a missing folder is an error", async () => {
  const r = await get("folders?path=%2Fnowhere");
  assert.equal(r.status, 400);
  assert.match(r.data.error, /no such file/);
  assert.equal((await get("folders?path=relative")).status, 400);
});

test("add: registers an existing folder and lists it", async () => {
  const r = await post("projects/add", { path: "/home/review/code/" });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.path, "/home/review/code");
  assert.equal(r.data.name, "code");
  const projects = await get("projects");
  assert.ok(
    projects.data.some(
      (p: { projectId: string }) => p.projectId === r.data.projectId,
    ),
  );
  const missing = await post("projects/add", { path: "/home/review/gone" });
  assert.equal(missing.status, 400);
  assert.match(missing.data.error, /not found/i);
});

test("create-folder: makes the folder in its parent, refuses duplicates", async () => {
  const r = await post("projects/create-folder", {
    parent: "/home/review",
    name: "fresh",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.path, "/home/review/fresh");
  assert.ok(local.folders.has("/home/review/fresh"));
  const again = await post("projects/create-folder", {
    parent: "/home/review",
    name: "fresh",
  });
  assert.equal(again.status, 400);
  assert.match(again.data.error, /already exists/);
  const bad = await post("projects/create-folder", {
    parent: "/home/review",
    name: "a/b",
  });
  assert.equal(bad.status, 400);
  assert.equal(local.callsOf("createProjectDirectory").length, 2);
});

test("clone: into a new folder in the destination, on the chosen host", async () => {
  const r = await post("projects/clone", {
    host: "srv_remote",
    repo: "https://github.com/acme/rocket.git",
    parent: "/home/review/code",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.path, "/home/review/code/rocket");
  assert.ok(remote.folders.has("/home/review/code/rocket"));
  assert.ok(!local.folders.has("/home/review/code/rocket"));
  const again = await post("projects/clone", {
    host: "srv_remote",
    repo: "acme/rocket",
    parent: "/home/review/code",
  });
  assert.equal(again.status, 400);
  assert.match(again.data.error, /already exists/);
  const unknown = await post("projects/clone", {
    host: "srv_nowhere",
    repo: "acme/rocket",
    parent: "/home/review/code",
  });
  assert.equal(unknown.status, 400);
});

test("rename: sets the project's title, its workspaces follow", async () => {
  local.addProject({ projectId: "prj_named", path: "/home/review/named" });
  local.addWorkspace({ id: "ws_named", projectId: "prj_named", cwd: "/home/review/named" });
  const r = await post("projects/prj_named/rename", { name: "  Mission   Control " });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { projectId: "prj_named", name: "Mission Control" });
  const projects = await get("projects");
  assert.equal(
    projects.data.find((p: { projectId: string }) => p.projectId === "prj_named")?.name,
    "Mission Control",
  );
  const workspaces = await get("workspaces");
  assert.equal(
    workspaces.data.find((w: { workspaceId: string }) => w.workspaceId === "ws_named")?.project,
    "Mission Control",
  );
  assert.equal((await post("projects/prj_named/rename", { name: " " })).status, 400);
  const gone = await post("projects/prj_nowhere/rename", { name: "X" });
  assert.equal(gone.status, 400);
  assert.match(gone.data.error, /no longer registered/);
  assert.equal(local.callsOf("renameProject").length, 1);
});

test("remove: needs confirming, archives its workspaces, keeps the folder", async () => {
  local.addProject({ projectId: "prj_old", path: "/home/review/old" });
  local.folders.add("/home/review/old");
  local.addWorkspace({ id: "ws_old", projectId: "prj_old", cwd: "/home/review/old" });
  local.addAgent({ id: "a-old", cwd: "/home/review/old", workspaceId: "ws_old" } as never);
  const unconfirmed = await post("projects/prj_old/remove", {});
  assert.equal(unconfirmed.status, 400);
  assert.equal(local.callsOf("removeProject").length, 0);
  const r = await post("projects/prj_old/remove", { confirm: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, { projectId: "prj_old", removedWorkspaceIds: ["ws_old"] });
  const projects = await get("projects");
  assert.ok(!projects.data.some((p: { projectId: string }) => p.projectId === "prj_old"));
  assert.ok(local.folders.has("/home/review/old"));
  assert.ok(local.agents.get("a-old")?.archivedAt);
  assert.equal((await post("projects/prj_old/remove", { confirm: true })).status, 400);
  assert.equal((await post("projects/prj_old/delete", { confirm: true })).status, 404);
});

test("validation", () => {
  assert.equal(folderPath("/a/b/../c/"), "/a/c");
  assert.equal(folderPath("/"), "/");
  assert.throws(() => folderPath("a/b"));
  assert.throws(() => folderName(".."));
  assert.throws(() => folderName("  "));
  assert.equal(folderName(" new app "), "new app");
});
