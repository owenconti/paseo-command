import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agent, Project, Workspace } from "../types";
import { captureTargets, filterTargets } from "./targets";

const agent = (a: Partial<Agent> & { id: string }): Agent =>
  ({ shortId: a.id, name: a.id, provider: "claude", status: "idle", cwd: "/x", created: "2026-11-01T00:00:00Z", ...a }) as Agent;
const projects: Project[] = [
  { projectId: "p2", name: "web", kind: "git", path: "/code/web" },
  { projectId: "p1", name: "api", kind: "git", path: "/code/api", host: "srv_box", hostLabel: "pool-1" },
];
const workspaces = [{ workspaceId: "w1", name: "fix-menu", project: "web", isolation: "worktree", cwd: "/w", background: false, branch: "fix-menu" }] as Workspace[];

test("agents most recently active first, then each workspace, then each project; never archived agents or subagents", () => {
  const targets = captureTargets(
    [
      agent({ id: "old", title: "Old one", updatedAt: "2026-11-02T00:00:00Z", projectId: "p2" }),
      agent({ id: "new", title: "Fix the menu", status: "running", lastUserMessageAt: "2026-11-20T10:00:00Z", projectId: "p2", workspaceId: "w1" }),
      agent({ id: "gone", archived: true }),
      agent({ id: "sub", child: true }),
      agent({ id: "remote:srv_box:r", daemonId: "r", title: "Remote", host: "srv_box", hostLabel: "pool-1", projectId: "p1", updatedAt: "2026-11-10T00:00:00Z" }),
    ],
    projects,
    workspaces,
  );
  assert.deepEqual(
    targets.map((t) => [t.title, t.place]),
    [
      ["Fix the menu", "web · fix-menu"],
      ["Remote", "api · pool-1"],
      ["Old one", "web"],
      ["fix-menu", "web"],
      ["api", "pool-1"],
      ["web", ""],
    ],
  );
  assert.deepEqual(targets.map((t) => t.kind), ["agent", "agent", "agent", "workspace", "project", "project"]);
  assert.equal(targets[0].kind === "agent" && targets[0].running, true);
});

test("the search narrows by every word, anywhere in the name or place", () => {
  const targets = captureTargets([agent({ id: "a", title: "Fix the menu", projectId: "p2" }), agent({ id: "b", title: "Docs" })], projects, workspaces);
  assert.deepEqual(filterTargets(targets, "menu web").map((t) => t.title), ["Fix the menu", "fix-menu"]);
  assert.deepEqual(filterTargets(targets, "  ").length, targets.length);
  assert.deepEqual(filterTargets(targets, "pool").map((t) => t.title), ["api"]);
  assert.deepEqual(filterTargets(targets, "new workspace web").map((t) => t.kind), ["project"]);
  assert.deepEqual(filterTargets(targets, "nothing"), []);
});

test("workspaces by their agents' latest activity, else the newest; stale ones left out", () => {
  const ws = [
    { workspaceId: "w1", name: "quiet", project: "web", isolation: "worktree", cwd: "/a", background: false, branch: "quiet", createdAt: "2026-11-19T00:00:00Z" },
    { workspaceId: "w2", name: "busy", project: "web", isolation: "worktree", cwd: "/b", background: false, branch: "feat/busy", createdAt: "2026-11-01T00:00:00Z" },
    { workspaceId: "w3", name: "gone", project: "web", isolation: "worktree", cwd: "/c", background: false, branch: "gone", stale: true },
    { workspaceId: "w4", name: "box", project: "api", projectId: "p1", isolation: "local", cwd: "/d", background: false, branch: "main", host: "srv_box", hostLabel: "pool-1" },
  ] as Workspace[];
  const targets = captureTargets([agent({ id: "a", workspaceId: "w2", lastUserMessageAt: "2026-11-20T00:00:00Z" })], projects, ws);
  assert.deepEqual(
    targets.filter((t) => t.kind === "workspace").map((t) => [t.title, t.place]),
    [["busy", "web · feat/busy"], ["quiet", "web"], ["box", "api · main · pool-1"]],
  );
});
