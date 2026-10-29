import assert from "node:assert/strict";
import { test } from "node:test";
import { hostOrder, projectOrder, workspaceOrder } from "./fleetView";
import type { Host, Project, Workspace } from "./types";

test("hosts list this Mac first, then A–Z whatever their state", () => {
  const hosts = [
    { serverId: "s2", label: "zeta", local: false },
    { serverId: "s3", label: "Alpha", local: false },
    { serverId: "s1", label: "This Mac", local: true },
  ] as unknown as Host[];
  assert.deepEqual(
    [...hosts].sort(hostOrder).map((h) => h.serverId),
    ["s1", "s3", "s2"],
  );
});

test("projects sort A–Z ignoring case, reading numbers whole", () => {
  const projects = [
    { name: "web10" },
    { name: "Web2" },
    { name: "api" },
  ] as unknown as Project[];
  assert.deepEqual(
    [...projects].sort(projectOrder).map((p) => p.name),
    ["api", "Web2", "web10"],
  );
});

test("workspaces sort by their shown name, falling back to the branch", () => {
  const workspaces = [
    { name: "", branch: "main", project: "a" },
    { name: "fix-login", branch: "x", project: "a" },
    { name: "Add-tabs", branch: "y", project: "a" },
  ] as unknown as Workspace[];
  assert.deepEqual(
    [...workspaces].sort(workspaceOrder).map((w) => w.name || w.branch),
    ["Add-tabs", "fix-login", "main"],
  );
});
