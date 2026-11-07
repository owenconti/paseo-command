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
  const plates = [...layout.workspaces.map((w) => ({ what: `plate ${w.entity.id}`, rect: w.plate })), ...layout.tiles.map((t) => ({ what: `plate ${t.id}`, rect: t.plate }))];
  const tiles = [...layout.workspaces.map((w) => ({ what: `tile ${w.entity.id}`, rect: w.frame })), ...layout.tiles.map((t) => ({ what: `tile ${t.id}`, rect: t.frame }))];
  const robots = layout.agents.map((a) => ({ what: `robot ${a.entity.id}`, rect: a.rect }));
  const plaques = [...layout.projects.map((p) => ({ what: `plaque ${p.name}`, rect: p.plaque })), ...layout.squares.map((s) => ({ what: "host plaque", rect: s.plaque }))];
  const basin = (s) => ({ ...s.fountain, y: s.fountain.y + s.fountain.h * 0.55, h: s.fountain.h * 0.45 });
  const things = [...plates, ...tiles, ...robots, ...plaques, ...layout.squares.map((s) => ({ what: "fountain", rect: basin(s) }))];
  for (let i = 0; i < things.length; i++)
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i], b = things[j];
      // A plate lies on its own tile frame; the host's plaque at its fountain's foot.
      if (a.what.replace(/^\w+ /, "") === b.what.replace(/^\w+ /, "") && /^(plate|tile)/.test(a.what)) continue;
      if (/fountain|host plaque/.test(a.what) && /fountain|host plaque/.test(b.what)) continue;
      assert.ok(!overlaps(a.rect, b.rect, -1), `${a.what} overlaps ${b.what}`);
    }
  const blocks = layout.projects.map((p) => p.block);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) assert.ok(!overlaps(blocks[i], blocks[j]), `${layout.projects[i].name}'s and ${layout.projects[j].name}'s blocks overlap`);
    for (const s of layout.squares) assert.ok(!overlaps(blocks[i], basin(s)) && !overlaps(blocks[i], s.plaque), `${layout.projects[i].name} covers the fountain`);
  }
  const said = [...things.map((t) => t.rect), ...layout.projects.flatMap((p) => p.porches)];
  for (const d of layout.decor) {
    assert.ok(FRAMES[d.frame] || FRAMES[`${d.frame}-0`], `${d.frame} is in the frame contract`);
    if (/^(river|waterfall|cliff|wall|pond|bridge|pennant)/.test(d.frame)) continue;
    const foot = d.layer === "stand" && d.rect.h > 60 ? { x: d.rect.x + d.rect.w * 0.2, y: d.rect.y + d.rect.h * 0.55, w: d.rect.w * 0.6, h: d.rect.h * 0.45 } : d.rect;
    for (const r of said) assert.ok(!overlaps(foot, r), `${d.frame} stands on something the village says`);
  }
  const b = layout.bounds;
  for (const t of [...things, ...layout.projects.map((p) => ({ what: p.name, rect: p.block }))])
    assert.ok(t.rect.x >= b.x && t.rect.x + t.rect.w <= b.x + b.w + 0.01 && t.rect.y >= b.y && t.rect.y + t.rect.h <= b.y + b.h + 0.01, `${t.what} is outside the village`);
}

test("the concept's fleet: one village, the four halls round the fountain, the dashboards' tiles", () => {
  const layout = layoutVillage(VILLAGE_SAMPLE, 1.7);
  assert.equal(layout.squares.length, 1);
  assert.deepEqual(layout.projects.map((p) => [p.hall, p.name, p.building]), HALLS.map((h) => [h.hall, h.name, h.building]));
  const [sq] = layout.squares;
  const [prs, issues, ws, ag] = layout.projects;
  const ringC = sq.ring.y + sq.ring.h / 2;
  assert.ok(prs.base < ringC && issues.base < ringC && ws.base > ringC && ag.base > ringC, "dashboards above, workspaces and agents below");
  assert.ok(prs.body.x + prs.body.w < sq.center.x && issues.body.x > sq.center.x && ws.body.x + ws.body.w < sq.center.x && ag.body.x > sq.center.x);
  assert.equal(layout.tiles.length, 8);
  assert.deepEqual(layout.workspaces.map((w) => w.label), ["Core", "Data", "Export", "Infra"]);
  assert.ok(layout.workspaces.every((w) => w.status === "running"), "every workspace has an agent at work");
  assert.equal(layout.agents.length, 6);
  for (const a of layout.agents) assert.ok(a.feet.x > ag.porch.x && a.feet.x < ag.porch.x + ag.porch.w, "every robot on the workshop's ledge");
  assert.equal(layout.counts.active, 4);
  assert.equal(layout.counts.running, 5);
  assertLegible(layout);
});

test("a sparse fleet still reads as the concept: one village, four halls, the hosts on the plaque", () => {
  const layout = layoutVillage(SPARSE, 1.3);
  assert.equal(layout.squares.length, 1, "one village for the whole fleet, never a square per host");
  assert.equal(layout.projects.length, 4);
  assert.deepEqual(layout.squares[0].hosts.map((h) => h.title), ["LOCAL", "DIAGONAL-LAB-1"]);
  assert.equal(layout.workspaces.length, 3);
  assert.deepEqual(layout.workspaces.map((w) => w.label), ["proud-breeze-…", "jolly-beacon-…", "main"]);
  assert.ok(layout.workspaces.every((w) => w.status === "needs"));
  assert.equal(layout.counts.needYou, 3);
  assert.equal(statusLine(layout).text, "3 need you");
  // The dashboards are drawn with no counts when the page hasn't any: dim with "—".
  assert.equal(layout.counts.prs.known, false);
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

test("many workspaces wrap into rows of bays under the dome; many agents into ledge rows", () => {
  const layout = layoutVillage(big(3, 4, 6, 2), 1.6);
  const rows = new Set(layout.workspaces.map((w) => Math.round(w.frame.y)));
  assert.ok(rows.size >= 2, "workspaces wrap");
  const ag = layout.projects.find((p) => p.hall === "agents");
  assert.ok(ag.porches.length >= 2, "robots take more ledge rows");
  const xs = layout.agents.map((a) => a.feet);
  for (let i = 1; i < xs.length; i++) if (xs[i].y === xs[i - 1].y) assert.ok(xs[i].x - xs[i - 1].x >= V.pitch - 0.01, "robots keep apart, in order");
  assertLegible(layout);
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
  const off = layout.squares[0].hosts.find((h) => !h.online);
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
