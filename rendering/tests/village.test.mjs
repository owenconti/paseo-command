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
  const plaques = layout.squares.flatMap((s) => [{ what: `plaque ${s.host.id}`, rect: s.plaque }, { what: `fountain ${s.host.id}`, rect: basin(s) }, { what: `keep ${s.host.id}`, rect: { ...s.keep.rect, y: s.keep.rect.y + s.keep.rect.h * 0.3, h: s.keep.rect.h * 0.7 } }]);
  const things = [...cottages, ...tiles, ...robots, ...halls, ...plaques];
  for (let i = 0; i < things.length; i++)
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i], b = things[j];
      // A robot stands at its own cottage's doorstep (in front of it); a tile in its hall's arch; a plaque at its fountain.
      if (a.ws && a.ws === b.ws) continue;
      if (/^(tile|hall)/.test(a.what) && /^(tile|hall)/.test(b.what)) continue;
      if (/^(plaque|fountain|keep)/.test(a.what) && /^(plaque|fountain|keep)/.test(b.what) && a.what.split(" ")[1] === b.what.split(" ")[1]) continue;
      assert.ok(!overlaps(a.rect, b.rect, -1), `${a.what} overlaps ${b.what}`);
    }
  for (const d of layout.decor) {
    assert.ok(FRAMES[d.frame] || FRAMES[`${d.frame}-0`], `${d.frame} is in the frame contract`);
    // Stepping stones are ground: they run under the halls' doors and the cottages' steps.
    if (/^(river|waterfall|cliff|wall|pond|moat|bridge|pennant|district-gate|path-stone)/.test(d.frame) || d.hedge) continue;
    const foot = d.layer === "stand" && d.rect.h > 60 ? { x: d.rect.x + d.rect.w * 0.2, y: d.rect.y + d.rect.h * 0.55, w: d.rect.w * 0.6, h: d.rect.h * 0.45 } : d.rect;
    for (const t of things) assert.ok(!overlaps(foot, t.rect), `${d.frame} stands on ${t.what}`);
  }
  const b = layout.bounds;
  for (const t of things) assert.ok(t.rect.x >= b.x && t.rect.x + t.rect.w <= b.x + b.w + 0.01 && t.rect.y >= b.y && t.rect.y + t.rect.h <= b.y + b.h + 0.01, `${t.what} is outside the village`);
}

/** Every door is on the town's paths: from the walk under the dashboard halls, the district gates' ways, each district's
 * plaza, and (through a lawn's fence only where a lane leaves it) each cluster's lane and walkways, reach every hall's door,
 * every cottage's doorstep and every robot's feet. A lawn blocks: its paths join the plaza only where they leave it. */
function assertConnected(layout) {
  const inside = (pt, r) => pt.x >= r.x - 0.5 && pt.x <= r.x + r.w + 0.5 && pt.y >= r.y - 0.5 && pt.y <= r.y + r.h + 0.5;
  const open = [...layout.town.roads, ...layout.squares.map((s) => s.roads[0])].map((rect) => ({ rect, lawn: null }));
  const onLawn = layout.lawns.flatMap((l) => l.paths.map((rect) => ({ rect, lawn: l.rect })));
  const nodes = [...open, ...onLawn];
  // The part of a lawn's path outside its lawn (where it can meet the plaza).
  const outside = (n) => {
    if (!n.lawn) return [n.rect];
    const r = n.rect, l = n.lawn, parts = [];
    if (r.y + r.h > l.y + l.h) parts.push({ x: r.x, y: l.y + l.h, w: r.w, h: r.y + r.h - (l.y + l.h) });
    if (r.y < l.y) parts.push({ x: r.x, y: r.y, w: r.w, h: l.y - r.y });
    if (r.x < l.x) parts.push({ x: r.x, y: r.y, w: l.x - r.x, h: r.h });
    if (r.x + r.w > l.x + l.w) parts.push({ x: l.x + l.w, y: r.y, w: r.x + r.w - (l.x + l.w), h: r.h });
    return parts;
  };
  const joined = (a, b) => {
    if (a.lawn && b.lawn) return a.lawn === b.lawn && overlaps(a.rect, b.rect, 0.5);
    if (!a.lawn && !b.lawn) return overlaps(a.rect, b.rect, 0.5);
    const [l, o] = a.lawn ? [a, b] : [b, a];
    return outside(l).some((part) => overlaps(part, o.rect, 0.5));
  };
  const seen = new Set([open[1]]);
  const queue = [open[1]];
  while (queue.length) {
    const n = queue.shift();
    for (const m of nodes) if (!seen.has(m) && joined(n, m)) (seen.add(m), queue.push(m));
  }
  // A point on a lawn is on a path only on one of that lawn's own (reached) paths; elsewhere, on reached paving.
  const onPath = (pt) => {
    const lawn = layout.lawns.find((l) => inside(pt, l.rect));
    return [...seen].some((n) => (lawn ? n.lawn === lawn.rect : !n.lawn) && inside(pt, n.rect));
  };
  for (const s of layout.squares) assert.ok(seen.has(open.find((n) => n.rect === s.roads[0])), `district ${s.host.id}'s plaza joins the town's roads`);
  for (const p of layout.projects) {
    const door = { x: p.body.x + p.body.w / 2, y: p.base + 1 };
    assert.ok(onPath(door), `${p.key}'s door is on a path`);
  }
  for (const w of layout.workspaces) assert.ok(onPath(w.door), `${w.entity.id}'s doorstep is on a path`);
  for (const s of layout.squares) assert.ok(onPath({ x: s.keep.rect.x + s.keep.rect.w / 2, y: s.keep.rect.y + s.keep.rect.h + 1 }), `${s.host.id}'s keep's door is on its plaza`);
  for (const a of layout.agents) assert.ok(onPath(a.feet), `robot ${a.entity.id} stands on a path`);
}

/** Grouping by containment, as the Islands map's: each cottage (and its robots) inside its own cluster's yard and no
 * other's, each hall at the back of its own yard with every cottage in front of it, each yard inside its own host's
 * district, districts apart, and nothing built inside a district that isn't a cluster's or its host's. */
function assertGrouped(layout) {
  const within = (a, b) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
  for (const w of layout.workspaces) {
    const own = layout.lawns.find((l) => l.project === w.project);
    assert.ok(own && within(w.frame, own.rect), `${w.entity.id} stands in its cluster's yard`);
    for (const l of layout.lawns) if (l !== own) assert.ok(!overlaps(w.frame, l.rect), `${w.entity.id} is in no other yard`);
    const hall = layout.projects.find((p) => p.key === w.project && p.hall === "project");
    if (hall) assert.ok(w.frame.y >= hall.base - 0.5, `${w.entity.id} stands in front of its hall, not beside it`);
  }
  for (const a of layout.agents) {
    const own = layout.lawns.find((l) => l.project === layout.workspaces.find((w) => w.entity.id === a.entity.workspace)?.project);
    assert.ok(own && within(a.rect, own.rect), `robot ${a.entity.id} stands in its cluster's yard`);
  }
  for (const p of layout.projects.filter((p) => p.hall === "project")) {
    const own = layout.lawns.find((l) => l.project === p.key);
    assert.ok(own && within(p.body, own.rect), `${p.key}'s hall is in its yard`);
  }
  for (const l of layout.lawns) {
    const sq = layout.squares[l.square];
    assert.ok(within(l.rect, sq.rect), `${l.project}'s yard lies inside ${sq.host.id}'s district`);
    for (const o of layout.lawns) if (o !== l) assert.ok(!overlaps(l.rect, o.rect, 20), `${l.project}'s yard stands apart from ${o.project}'s`);
  }
  for (const s of layout.squares) {
    assert.ok(within(s.keep.rect, s.rect), `${s.host.id}'s keep stands inside its district`);
    const mid = s.plaque.x + s.plaque.w / 2;
    assert.ok(mid > s.keep.rect.x && mid < s.keep.rect.x + s.keep.rect.w && s.plaque.y > s.keep.rect.y && s.plaque.y + s.plaque.h < s.keep.rect.y + s.keep.rect.h, `${s.host.id}'s name board hangs on its keep`);
    assert.ok(within(s.plaque, s.rect), `${s.host.id}'s name board stays in its district`);
    assert.ok(s.plaque.h >= 60, "the board is tall enough for lettering legible at the default zoom");
    for (const l of layout.lawns) assert.ok(!overlaps(s.keep.rect, l.rect), `${s.host.id}'s keep stands clear of ${l.project}'s yard`);
  }
  for (let i = 0; i < layout.squares.length; i++)
    for (let j = i + 1; j < layout.squares.length; j++)
      assert.ok(!overlaps(layout.squares[i].rect, layout.squares[j].rect, 40), `districts ${layout.squares[i].host.id} and ${layout.squares[j].host.id} stand apart`);
  // Nothing built (stalls, crates, barrels, tents) loose in a district.
  for (const d of layout.decor) if (/^(tent|crates|barrel)/.test(d.frame)) assert.ok(!layout.squares.some((s) => overlaps(d.rect, s.rect)), `no loose ${d.frame} in a district`);
}

test("structures group by containment: cottages in their cluster's yard, yards in their host's district", () => {
  assertGrouped(layoutVillage(VILLAGE_SAMPLE, 1.7));
  assertGrouped(layoutVillage(SPARSE, 1.3));
  assertGrouped(layoutVillage(SPARSE, 2.4));
  for (const [h, p, w, a] of [[3, 4, 6, 2], [1, 9, 2, 1], [4, 1, 1, 4], [8, 5, 3, 3], [2, 3, 3, 1], [1, 2, 9, 2]]) assertGrouped(layoutVillage(big(h, p, w, a), 1.6));
});

test("every structure's door is on the town's paths", () => {
  assertConnected(layoutVillage(VILLAGE_SAMPLE, 1.7));
  assertConnected(layoutVillage(SPARSE, 1.3));
  assertConnected(layoutVillage(SPARSE, 2.4));
  for (const [h, p, w, a] of [[3, 4, 6, 2], [1, 9, 2, 1], [4, 1, 1, 4], [8, 5, 3, 3], [2, 3, 3, 1]]) assertConnected(layoutVillage(big(h, p, w, a), 1.6));
  const camp = structuredClone(SPARSE);
  camp.agents.push({ key: "a4", host: "local", name: "loose", model: "claude/x", state: "idle" });
  assertConnected(layoutVillage(camp, 1.3));
});

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
    assert.ok(w.frame.y + w.frame.h >= halls[0].base, "cottages stand beside or in front of their hall");
    assert.ok(overlaps(w.frame, layout.lawns.find((l) => l.square === w.square && overlaps(l.rect, halls[0].body)).rect), "on their hall's lawn");
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
