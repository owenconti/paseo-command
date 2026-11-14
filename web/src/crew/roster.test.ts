import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AtlasData } from "../model/fleet";
import { buildRoster } from "./roster";
import { SHEET_SIZE, droneColors, frameOf, medalsOf, robotColorOf, robotFrames } from "./sheets";

const data: AtlasData = {
  hosts: [
    { key: "local", name: "studio", online: true, local: true },
    { key: "srv", name: "build-box", online: false, local: false },
    { key: "empty", name: "spare", online: true, local: false },
  ],
  projects: [
    { key: "p-web", host: "local", name: "website" },
    { key: "p-app", host: "local", name: "App" },
    { key: "p-bare", host: "local", name: "bare" },
    { key: "p-srv", host: "srv", name: "api" },
  ],
  workspaces: [
    { key: "w-new", host: "local", project: "p-app", name: "newer", created: "2026-02-01" },
    { key: "w-old", host: "local", project: "p-app", name: "older", created: "2026-01-01", labels: ["CI green", "Approved"] },
    { key: "w-web", host: "local", project: "p-web", name: "main" },
    { key: "w-srv", host: "srv", project: "p-srv", name: "auth" },
  ],
  agents: [
    { key: "a3", host: "local", project: "p-app", workspace: "w-old", name: "Third", model: "claude/opus", state: "running", created: "2026-01-03" },
    { key: "a1", host: "local", project: "p-app", workspace: "w-old", name: "First", model: "codex/gpt", state: "idle", created: "2026-01-01" },
    { key: "a2", host: "local", project: "p-app", workspace: "w-new", name: "Second", model: "claude/opus", state: "approval", created: "2026-01-02" },
    { key: "a4", host: "local", project: "p-web", workspace: "w-web", name: "Fourth", model: "claude/opus", state: "failed", created: "2026-01-04" },
    { key: "a5", host: "local", project: "p-web", name: "Camp", model: "claude/opus", state: "done", created: "2026-01-05" },
    { key: "a6", host: "srv", project: "p-srv", workspace: "w-srv", name: "Remote", model: "gemini/pro", state: "offline" },
  ],
};

test("the map groups host, project and workspace, oldest first, and hides the empty", () => {
  const r = buildRoster(data);
  assert.deepEqual(r.hosts.map((h) => h.key), ["local", "srv"]);
  const local = r.hosts[0]!;
  assert.deepEqual(local.projects.map((p) => p.name), ["App", "website"]);
  assert.deepEqual(local.projects[0]!.workspaces.map((w) => w.key), ["w-old", "w-new"]);
  assert.deepEqual(local.projects[0]!.workspaces[0]!.agents.map((a) => a.key), ["a1", "a3"]);
  assert.deepEqual(local.projects[1]!.loose.map((a) => a.key), ["a5"]);
  assert.deepEqual(r.agents.map((a) => a.key), ["a1", "a3", "a2", "a4", "a5", "a6"]);
  assert.equal(r.counts.running, 1);
});

test("a filter keeps matching agents and workspaces", () => {
  const r = buildRoster(data, "remote");
  assert.deepEqual(r.agents.map((a) => a.key), ["a6"]);
  const byWorkspace = buildRoster(data, "older");
  assert.deepEqual(byWorkspace.agents.map((a) => a.key), ["a1", "a3"]);
  assert.deepEqual(buildRoster(data, "nothing like it").hosts, []);
});

test("sheets: sizes match the PNGs, every colour has its frames", () => {
  for (const [name, size] of Object.entries(SHEET_SIZE)) {
    const png = readFileSync(new URL(`../../../rendering/src/assets/dungeon/${name}.png`, import.meta.url));
    assert.deepEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) }, size, name);
  }
  assert.equal(robotColorOf("claude/opus"), "orange");
  for (const pose of ["idle", "work"] as const) for (const name of robotFrames(robotColorOf("gemini/pro"), pose)) assert.ok(frameOf("robots", name), name);
  assert.deepEqual(droneColors("claude/opus", 2, ["codex/gpt"]), ["white", "orange"]);
  const medals = medalsOf(["CI green", "Approved"], { state: "findings", findings: 2 });
  for (const m of medals) assert.ok(frameOf("status", m.frame), m.frame);
  assert.deepEqual(medals.map((m) => m.kind), ["ci", "review", "probe"]);
});

test("a host kept by key stays with nothing on it (a claimed pool box), unless the map is filtered", () => {
  const data = {
    hosts: [
      { key: "local", name: "Studio", online: true, local: true },
      { key: "srv_pool1", name: "pool-1", online: true, local: false },
      { key: "srv_mac", name: "macmini", online: true, local: false },
    ],
    projects: [],
    workspaces: [],
    agents: [],
  };
  assert.deepEqual(buildRoster(data).hosts, []);
  assert.deepEqual(buildRoster(data, "", new Set(["srv_pool1"])).hosts.map((h) => h.name), ["pool-1"]);
  assert.deepEqual(buildRoster(data, "fix", new Set(["srv_pool1"])).hosts, []);
});
