import test from "node:test";
import assert from "node:assert/strict";
import { layoutVillage, overlaps, spread, statusLine, tileOf, robotColor, plateLabel, workspaceStatus, dashText, HALLS, V } from "../src/village/layout.ts";
import { FRAMES, VILLAGE_PX, applySheet, ROBOT_COLORS } from "../src/village/frames.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// Lay out with the real sheets' sizes and anchors, as the app does.
const SHEETS = new URL("../src/assets/village/", import.meta.url);
if (existsSync(SHEETS))
  for (const f of readdirSync(SHEETS).filter((f) => f.endsWith(".json")))
    applySheet(JSON.parse(readFileSync(new URL(f, SHEETS), "utf8")), () => true, VILLAGE_PX);
import { VILLAGE_SAMPLE, DUNGEON_SAMPLE, SAMPLE } from "../src/sample.ts";

/** A fleet of `hosts` × `projects` × `workspaces` × `agents`. */
function big(hosts, projects, workspaces, agents) {
  const data = { hosts: [], projects: [], workspaces: [], agents: [] };
  for (let h = 0; h < hosts; h++) {
    data.hosts.push({ key: `h${h}`, name: `host-${h}`, online: h !== 2, local: h === 0, stats: { cpu: 20 + h * 13, memory: 95, disk: 40 } });
    for (let p = 0; p < projects; p++) {
      data.projects.push({ key: `h${h}p${p}`, host: `h${h}`, name: `project-${p}` });
      for (let w = 0; w < workspaces; w++) {
        data.workspaces.push({
          key: `h${h}p${p}w${w}`, host: `h${h}`, project: `h${h}p${p}`, name: `workspace-name-long-${w}`,
          labels: w % 3 === 0 ? ["CI running", "Approved"] : [], autoMerge: w % 6 === 0,
          ...(w % 4 === 1 ? { probe: { state: "findings", findings: 2 } } : {}),
        });
        for (let a = 0; a < agents; a++)
          data.agents.push({
            key: `h${h}p${p}w${w}a${a}`, host: `h${h}`, project: `h${h}p${p}`, workspace: `h${h}p${p}w${w}`,
            name: `agent ${a}`, model: a % 2 ? "claude/claude-opus-5-5" : "codex/gpt-6.1-sol",
            state: ["running", "idle", "done", "approval", "question", "failed"][a % 6], subagents: a % 3,
          });
      }
    }
  }
  return data;
}
/** Shaped like a real small fleet: two hosts, three workspaces (one long name), three agents needing you. */
const SPARSE = {
  hosts: [{ key: "local", name: "LOCAL", online: true, local: true }, { key: "lab", name: "DIAGONAL-LAB-1", online: true, local: false, stats: { cpu: 71, memory: 58, disk: 40 } }],
  projects: [{ key: "pc", host: "local", name: "paseo-command" }, { key: "dg", host: "lab", name: "diagonal-hq/diagonal" }],
  workspaces: [
    { key: "w1", host: "local", project: "pc", name: "proud-breeze-21f6", created: "2026-11-01" },
    { key: "w2", host: "local", project: "pc", name: "jolly-beacon-fede", created: "2026-11-02" },
    { key: "w3", host: "lab", project: "dg", name: "main", created: "2026-11-03" },
  ],
  agents: [
    { key: "a1", host: "local", project: "pc", workspace: "w1", name: "one", model: "claude/claude-opus-5-5", state: "approval" },
    { key: "a2", host: "local", project: "pc", workspace: "w2", name: "two", model: "claude/claude-opus-5-5", state: "question" },
    { key: "a3", host: "lab", project: "dg", workspace: "w3", name: "three", model: "codex/gpt-6.1-sol", state: "approval" },
  ],
};

/** Nothing the village says overlaps anything else it says; scenery stands clear of it; all lies within the bounds. */
function assertLegible(layout) {
  const cottages = layout.workspaces.map((w) => ({ what: `cottage ${w.entity.id}`, rect: w.frame, ws: w.entity.id }));
  const tiles = layout.tiles.map((t) => ({ what: `tile ${t.id}`, rect: t.frame }));
  const robots = layout.agents.map((a) => ({ what: `robot ${a.entity.id}`, rect: a.rect, ws: a.entity.workspace }));
  const halls = layout.projects.map((p) => ({ what: `hall ${p.key}`, rect: { ...p.body, y: p.body.y + p.body.h * 0.25, h: p.body.h * 0.75 } }));
  const basin = (s) => ({ ...s.fountain, y: s.fountain.y + s.fountain.h * 0.55, h: s.fountain.h * 0.45 });
  const plaques = layout.squares.flatMap((s) => [{ what: `plaque ${s.host.id}`, rect: s.plaque }, { what: `fountain ${s.host.id}`, rect: basin(s) }]);
  const things = [...cottages, ...tiles, ...robots, ...halls, ...plaques];
  for (let i = 0; i < things.length; i++)
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i], b = things[j];
      // A robot stands at its own cottage's doorstep (in front of it); a tile in its hall's arch; a plaque at its fountain.
      if (a.ws && a.ws === b.ws) continue;
      if (/^(tile|hall)/.test(a.what) && /^(tile|hall)/.test(b.what)) continue;
      if (/^(plaque|fountain)/.test(a.what) && /^(plaque|fountain)/.test(b.what) && a.what.split(" ")[1] === b.what.split(" ")[1]) continue;
      assert.ok(!overlaps(a.rect, b.rect, -1), `${a.what} overlaps ${b.what}`);
    }
  for (const d of layout.decor) {
    assert.ok(FRAMES[d.frame] || FRAMES[`${d.frame}-0`], `${d.frame} is in the frame contract`);
    if (/^(river|waterfall|cliff|wall|pond|moat|bridge|pennant|district-gate)/.test(d.frame) || d.hedge) continue;
    const foot = d.layer === "stand" && d.rect.h > 60 ? { x: d.rect.x + d.rect.w * 0.2, y: d.rect.y + d.rect.h * 0.55, w: d.rect.w * 0.6, h: d.rect.h * 0.45 } : d.rect;
    for (const t of things) assert.ok(!overlaps(foot, t.rect), `${d.frame} stands on ${t.what}`);
  }
  const b = layout.bounds;
  for (const t of things) assert.ok(t.rect.x >= b.x && t.rect.x + t.rect.w <= b.x + b.w + 0.01 && t.rect.y >= b.y && t.rect.y + t.rect.h <= b.y + b.h + 0.01, `${t.what} is outside the village`);
}

test("the hierarchy: the dashboard halls, then a district per host, a hall per project, a cottage per workspace, robots at its door", () => {
  const layout = layoutVillage(VILLAGE_SAMPLE, 1.7);
  assert.deepEqual(layout.projects.slice(0, 2).map((p) => [p.hall, p.name, p.building]), HALLS.map((h) => [h.hall, h.name, h.building]));
  assert.equal(layout.squares.length, 1);
  const halls = layout.projects.filter((p) => p.hall === "project");
  assert.deepEqual(halls.map((p) => p.name), ["diagonal"]);
  assert.ok(!["hall-blue", "hall-purple"].includes(halls[0].building), "projects' halls don't wear the dashboards' roofs");
  assert.equal(layout.tiles.length, 8);
  assert.equal(layout.workspaces.length, 4);
  for (const w of layout.workspaces) {
    assert.ok(w.frame.y > halls[0].body.y + halls[0].body.h * 0.5, "cottages stand in front of their hall");
    for (const a of layout.agents.filter((a) => a.entity.workspace === w.entity.id))
      assert.ok(Math.abs(a.feet.y - (w.frame.y + w.frame.h)) < 40 && a.feet.x > w.frame.x, "its robots at its doorstep");
  }
  assert.equal(layout.agents.length, 6);
  assert.equal(layout.counts.active, 4);
  assertLegible(layout);
});

test("one host with one workspace and one agent", () => {
  const data = { hosts: [{ key: "h", name: "H", online: true, local: true }], projects: [{ key: "p", host: "h", name: "p" }], workspaces: [{ key: "w", host: "h", project: "p", name: "w" }], agents: [{ key: "a", host: "h", project: "p", workspace: "w", name: "a", model: "claude/x", state: "running" }] };
  const layout = layoutVillage(data, 1.6);
  assert.equal(layout.squares.length, 1);
  assert.equal(layout.workspaces.length, 1);
  assert.equal(layout.agents.length, 1);
  assertLegible(layout);
});

test("a sparse fleet like the user's: a district per host, the hosts' plaques, cottages and robots needing you", () => {
  const layout = layoutVillage(SPARSE, 1.3);
  assert.deepEqual(layout.squares.map((s) => s.hosts[0].title), ["LOCAL", "DIAGONAL-LAB-1"]);
  assert.equal(layout.projects.filter((p) => p.hall === "project").length, 2);
  assert.equal(layout.workspaces.length, 3);
  assert.ok(layout.workspaces.every((w) => w.status === "needs"));
  assert.equal(statusLine(layout).text, "3 need you");
  assert.equal(layout.counts.prs.known, false);
  // Each agent in its own host's district.
  for (const a of layout.agents) assert.equal(layout.squares[a.square].host.id, a.entity.host);
  assertLegible(layout);
});

test("dashboard counts come from the page's answers; their absence says why", () => {
  const data = { ...VILLAGE_SAMPLE, dashboard: { prs: { state: "ok", counts: { merged: 7, review: 3, draft: 1, conflicts: 1 } }, issues: { state: "off", message: "Enable Linear" } } };
  const c = layoutVillage(data, 1.6).counts;
  assert.deepEqual([c.prs.known, c.prs.total, c.prs.by.merged], [true, 12, 7]);
  assert.deepEqual([c.issues.known, c.issues.why], [false, "Enable Linear"]);
  const a = layoutVillage(data, 1.6), b = layoutVillage({ ...data, dashboard: { ...data.dashboard, prs: { ...data.dashboard.prs, counts: { ...data.dashboard.prs.counts, merged: 8 } } } }, 1.6);
  assert.notEqual(a.signature, b.signature, "a count's change repaints its plate");
});

test("capped counts read as at least: N+", () => {
  const data = { ...VILLAGE_SAMPLE, dashboard: { issues: { state: "ok", counts: { done: 900, inProgress: 600, todo: 500, blocked: 0 }, atLeast: ["done", "inProgress", "todo", "blocked"] }, prs: { state: "ok", counts: { merged: 3, review: 117, draft: 14, conflicts: 3 }, atLeast: ["conflicts"] } } };
  const c = layoutVillage(data, 1.6).counts;
  assert.equal(dashText(c.issues), "2000+");
  assert.equal(dashText(c.issues, "done"), "900+");
  assert.equal(dashText(c.prs, "merged"), "3");
  assert.equal(dashText(c.prs, "conflicts"), "3+");
  assert.equal(dashText(c.prs), "137+");
  assert.equal(dashText(layoutVillage(VILLAGE_SAMPLE, 1.6).counts.prs), "—");
});

test("plates cut names past 14 characters; a workspace's dot says its agents' state", () => {
  assert.equal(plateLabel("Core"), "Core");
  assert.equal(plateLabel("proud-breeze-21f6").length, 14);
  assert.equal(workspaceStatus(["running", "approval"], true), "needs");
  assert.equal(workspaceStatus(["running", "failed"], true), "failed");
  assert.equal(workspaceStatus(["idle", "running"], true), "running");
  assert.equal(workspaceStatus([], true), "idle");
  assert.equal(workspaceStatus(["running"], false), "offline");
  assert.equal(tileOf({ flags: { ci: "ci-failing" } }), "failing");
});

test("crowded fleets stay legible; agents without a workspace wait at a camp", () => {
  for (const [h, p, w, a] of [[3, 4, 6, 2], [1, 9, 2, 1], [4, 1, 1, 4], [8, 5, 3, 3]]) {
    const layout = layoutVillage(big(h, p, w, a), 1.6);
    assert.equal(layout.squares.length, h);
    assertLegible(layout);
  }
  const wide = layoutVillage(big(6, 2, 2, 1), 3), tall = layoutVillage(big(6, 2, 2, 1), 0.6);
  assert.ok(wide.bounds.w / wide.bounds.h > tall.bounds.w / tall.bounds.h, "districts pack to suit the map's shape");
  const camp = structuredClone(SPARSE);
  camp.agents.push({ key: "a4", host: "local", name: "loose", model: "claude/x", state: "idle" });
  const l = layoutVillage(camp, 1.3);
  assert.ok(l.workspaces.some((w) => w.entity.camp && w.cottage === "tent"), "a camp's tent");
  assertLegible(l);
  assertLegible(layoutVillage(DUNGEON_SAMPLE, 1.6));
  assertLegible(layoutVillage(SAMPLE, 1.6));
  assertLegible(layoutVillage({ hosts: [{ key: "h", name: "H", online: true, local: true }], projects: [], workspaces: [], agents: [] }, 1.6));
});

test("it's deterministic, and its signature changes only when places or counts do", () => {
  const a = layoutVillage(VILLAGE_SAMPLE, 1.6), b = layoutVillage(structuredClone(VILLAGE_SAMPLE), 1.6);
  assert.equal(a.signature, b.signature);
  assert.deepEqual(a.decor, b.decor);
  const renamed = structuredClone(VILLAGE_SAMPLE);
  renamed.workspaces[0].name = "renamed";
  assert.notEqual(layoutVillage(renamed, 1.6).signature, a.signature);
  assert.deepEqual(spread([0, 0, 0], 10), [-10, 0, 10]);
});

test("offline hosts say so; the status pill is true; robots keep provider colours", () => {
  const layout = layoutVillage(big(3, 1, 1, 6), 1.6);
  const off = layout.squares.flatMap((s) => s.hosts).find((h) => !h.online);
  assert.match(off.title, /OFFLINE$/);
  assert.ok(layout.workspaces.some((w) => w.status === "offline"));
  const c = layout.counts;
  assert.equal(c.running + c.idle + c.needYou + c.unread + c.failed + c.offline, c.agents);
  assert.equal(statusLine(layout).text, `${c.needYou} need you`);
  const calm = structuredClone(VILLAGE_SAMPLE);
  calm.agents.forEach((a) => (a.state = "idle"));
  assert.equal(statusLine(layoutVillage(calm, 1.6)).text, "All systems operational");
  assert.equal(robotColor("claude/claude-opus-5-5"), "orange");
  assert.equal(robotColor("codex/gpt-6.1-sol"), "white");
  for (const c2 of ROBOT_COLORS) for (const pose of ["idle", "work"]) assert.ok(FRAMES[`robot-${c2}-${pose}-0`]);
});
