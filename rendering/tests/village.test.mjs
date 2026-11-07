import test from "node:test";
import assert from "node:assert/strict";
import { layoutVillage, overlaps, spread, statusLine, tileOf, robotColor, V } from "../src/village/layout.ts";
import { FRAMES, VILLAGE_PX, applySheet, ROBOT_COLORS, BUILDINGS } from "../src/village/frames.ts";
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
      data.projects.push({ key: `h${h}p${p}`, host: `h${h}`, name: `project-${p}-${"x".repeat(p % 4)}` });
      for (let w = 0; w < workspaces; w++) {
        data.workspaces.push({
          key: `h${h}p${p}w${w}`, host: `h${h}`, project: `h${h}p${p}`, name: `workspace ${w}`,
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

/** Nothing the village says overlaps anything else it says; scenery stands clear of it; all lies within the bounds. */
function assertLegible(layout) {
  const plates = layout.workspaces.map((w) => ({ what: `plate ${w.entity.id}`, rect: w.plate }));
  const tiles = layout.workspaces.map((w) => ({ what: `tile ${w.entity.id}`, rect: w.frame }));
  const robots = layout.agents.map((a) => ({ what: `robot ${a.entity.id}`, rect: a.rect }));
  const plaques = [
    ...layout.projects.map((p) => ({ what: `plaque ${p.name}`, rect: p.plaque })),
    ...layout.squares.map((s) => ({ what: `host plaque ${s.title}`, rect: s.plaque })),
  ];
  // The fountain's basin (its crystal may rise behind the upper halls' robots and plates, which draw over it).
  const basin = (s) => ({ ...s.fountain, y: s.fountain.y + s.fountain.h * 0.55, h: s.fountain.h * 0.45 });
  const things = [...plates, ...tiles, ...robots, ...plaques, ...layout.squares.map((s) => ({ what: `fountain ${s.title}`, rect: basin(s) }))];
  for (let i = 0; i < things.length; i++)
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i], b = things[j];
      // A plate lies on its own tile frame; the host's plaque at its fountain's foot.
      if (a.what.replace(/^\w+ /, "") === b.what.replace(/^\w+ /, "") && /^(plate|tile)/.test(a.what)) continue;
      if (/fountain|host plaque/.test(a.what) && /fountain|host plaque/.test(b.what)) continue;
      assert.ok(!overlaps(a.rect, b.rect, -1), `${a.what} overlaps ${b.what}`);
    }
  // Buildings, their blocks and the fountain never overlap one another.
  const blocks = layout.projects.map((p) => p.block);
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) assert.ok(!overlaps(blocks[i], blocks[j]), `${layout.projects[i].name}'s and ${layout.projects[j].name}'s blocks overlap`);
    for (const s of layout.squares) assert.ok(!overlaps(blocks[i], basin(s)) && !overlaps(blocks[i], s.plaque), `${layout.projects[i].name} covers the fountain`);
  }
  // Scenery's footing keeps off what the village says.
  const said = [...things.map((t) => t.rect), ...layout.projects.map((p) => p.porch)];
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

test("the concept's fleet: one square, four buildings round the fountain, every tile", () => {
  const layout = layoutVillage(VILLAGE_SAMPLE, 1.7);
  assert.equal(layout.squares.length, 1);
  assert.equal(layout.projects.length, 4);
  assert.equal(layout.workspaces.length, 16);
  assert.equal(layout.agents.length, 6);
  const [sq] = layout.squares;
  // Two buildings above the plaza and two below, one either side of the middle.
  // The fountain dead centre: its ring below the upper halls' feet and above the lower halls'.
  const ringC = sq.ring.y + sq.ring.h / 2;
  const above = layout.projects.filter((p) => p.base < ringC), below = layout.projects.filter((p) => p.base > ringC);
  assert.equal(above.length, 2);
  assert.equal(below.length, 2);
  for (const row of [above, below]) assert.ok(row.some((p) => p.body.x + p.body.w < sq.center.x) && row.some((p) => p.body.x > sq.center.x));
  // Neighbours differ.
  assert.equal(new Set(layout.projects.map((p) => p.building)).size, 4);
  assert.deepEqual([...new Set(layout.workspaces.map((w) => w.tile))].sort(), ["draft", "failing", "merged", "none", "review"]);
  assert.equal(layout.squares[0].stats.find((s) => s.text.startsWith("DISK")).alert, true, "a disk past 90% is red");
  assertLegible(layout);
});

test("a workspace's tile is its PR's state", () => {
  assert.equal(tileOf({}), "none");
  assert.equal(tileOf({ flags: { ci: "ci-green", review: "review-approved" } }), "merged");
  assert.equal(tileOf({ flags: { ci: "ci-running", review: "review-approved" } }), "review");
  assert.equal(tileOf({ flags: { review: "review-awaiting" } }), "review");
  assert.equal(tileOf({ flags: { ci: "ci-green", review: "review-changes" } }), "draft");
  assert.equal(tileOf({ flags: { ci: "ci-failing", review: "review-approved" } }), "failing");
  assert.equal(tileOf({ flags: { review: "conflicts" } }), "failing");
});

test("robots stand on their building's porch in front of their own bay, oldest first, apart", () => {
  const layout = layoutVillage(VILLAGE_SAMPLE, 1.7);
  for (const p of layout.projects) {
    const mine = layout.agents.filter((a) => a.entity.project === p.entity.id);
    for (const a of mine) {
      assert.ok(a.feet.x > p.porch.x && a.feet.x < p.porch.x + p.porch.w && a.feet.y > p.porch.y && a.feet.y < p.porch.y + p.porch.h, `${a.entity.id} is on its porch`);
      const bay = layout.workspaces.find((w) => w.entity.id === a.entity.workspace);
      assert.ok(Math.abs(a.feet.x - bay.tileAt.x) <= V.pitch * 1.5, `${a.entity.id} stands near its bay`);
    }
    const xs = mine.map((a) => a.feet.x);
    for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= V.pitch - 0.01, "robots keep apart, in order");
  }
  assert.deepEqual(spread([0, 0, 0], 10), [-10, 0, 10]);
  assert.deepEqual(spread([0, 5, 100], 10), [-2.5, 7.5, 100]);
  // Robots keep provider colours: Claude orange, ChatGPT white, others one of their own.
  assert.equal(robotColor("claude/claude-opus-5-5"), "orange");
  assert.equal(robotColor("codex/gpt-6.1-sol"), "white");
  assert.ok(ROBOT_COLORS.includes(robotColor("opencode/kimi-k3")));
  assert.equal(robotColor("opencode/kimi-k3"), robotColor("opencode/other-model"), "a provider's models share a colour");
});

test("it's deterministic, and its signature changes only when places do", () => {
  const a = layoutVillage(VILLAGE_SAMPLE, 1.6), b = layoutVillage(structuredClone(VILLAGE_SAMPLE), 1.6);
  assert.equal(a.signature, b.signature);
  assert.deepEqual(a.decor, b.decor);
  const busy = structuredClone(VILLAGE_SAMPLE);
  busy.agents.forEach((x) => (x.state = "running"));
  assert.equal(layoutVillage(busy, 1.6).signature, a.signature, "states aren't places");
  const renamed = structuredClone(VILLAGE_SAMPLE);
  renamed.workspaces[0].name = "renamed";
  assert.notEqual(layoutVillage(renamed, 1.6).signature, a.signature);
});

test("more than four workspaces spill out under arches of their own; crowded porches widen their hall", () => {
  const layout = layoutVillage(big(1, 1, 7, 1), 1.6);
  const arches = layout.workspaces.filter((w) => w.arch);
  assert.equal(arches.length, 3);
  const xs = layout.workspaces.map((w) => w.tileAt.x);
  assert.deepEqual(xs, [...xs].sort((p, q) => p - q), "oldest first, left to right");
  assertLegible(layout);
  const crowd = layoutVillage(big(1, 1, 4, 3), 1.6);
  assert.ok(crowd.projects[0].body.w > FRAMES[crowd.projects[0].building].w, "a hall with twelve robots widens");
  assertLegible(crowd);
});

test("many hosts and projects stay legible, and squares tile to suit the map's shape", () => {
  for (const [hosts, projects, ws, agents] of [[3, 5, 3, 2], [1, 9, 2, 1], [2, 2, 1, 0], [4, 1, 1, 4]]) {
    const layout = layoutVillage(big(hosts, projects, ws, agents), 1.6);
    assert.equal(layout.squares.length, hosts);
    assertLegible(layout);
  }
  const wide = layoutVillage(big(4, 2, 2, 1), 3), tall = layoutVillage(big(4, 2, 2, 1), 0.5);
  assert.ok(wide.bounds.w / wide.bounds.h > tall.bounds.w / tall.bounds.h, "a wide map gets a wider village");
  assertLegible(layoutVillage(DUNGEON_SAMPLE, 1.6));
  assertLegible(layoutVillage(SAMPLE, 1.6));
});

test("offline hosts say so; the status pill and the HUD's counts are true", () => {
  const data = big(3, 2, 2, 6);
  const layout = layoutVillage(data, 1.6);
  const off = layout.squares.find((s) => !s.online);
  assert.match(off.title, /OFFLINE$/);
  assert.equal(off.stats.length, 0);
  const c = layout.counts;
  assert.equal(c.agents, data.agents.length);
  assert.equal(c.running + c.idle + c.needYou + c.unread + c.failed + c.offline, c.agents);
  assert.equal(statusLine(layout).text, `${c.needYou} need you`);
  const calm = structuredClone(VILLAGE_SAMPLE);
  calm.agents.forEach((a) => (a.state = "idle"));
  assert.equal(statusLine(layoutVillage(calm, 1.6)).text, "All systems operational");
  assert.equal(layoutVillage(VILLAGE_SAMPLE, 1.6).counts.prs, 8);
  assert.equal(layoutVillage(VILLAGE_SAMPLE, 1.6).agents.filter((a) => a.entity.project === "local/forge").length, 6, "the workshop has all six");
});

test("the frame contract covers every building variant and robot colour", () => {
  for (const b of BUILDINGS) assert.ok(FRAMES[b]);
  for (const c of ROBOT_COLORS) for (const pose of ["idle", "work"]) for (let i = 0; i < 4; i++) assert.ok(FRAMES[`robot-${c}-${pose}-${i}`]);
});
