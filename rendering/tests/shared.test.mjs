import test from "node:test";
import assert from "node:assert/strict";
import {
  layoutAtlas,
  cellKey,
  footprint,
  footprintEdges,
  insideFootprint,
  structureCentre,
} from "../src/world.ts";
import { SAMPLE } from "../src/sample.ts";
import { crowded } from "./fixtures.mjs";
import { perimeter } from "../src/outline.ts";
import { mapExtent, minimumZoom, clampCamera, MAX_ZOOM } from "../src/camera.ts";
import { placeStructures, placeFlags, placeSeals, placeProbes, MEDALLION } from "../src/placement.ts";
import { fitCaption } from "../src/ribbon.ts";
import { entityAt, cellAt } from "../src/pick.ts";
import { point } from "../src/world.ts";

const DENSITY = 2;
const VIEW = { width: 2880, height: 1800 };

test("perimeter of a 10-cell landmark has 22 edges and no interior segments", () => {
  const layout = layoutAtlas(SAMPLE);
  const cells = footprint(layout.projects[0]);
  assert.equal(cells.length, 10);
  const width = 6;
  const p = perimeter(cells, width);
  // Rows of 3, 4 and 3: 60 cell sides less 19 shared pairs.
  assert.equal(p.edgeCount, 22);
  // Each side lies just inside an exposed edge, never across the interior.
  const exposed = footprintEdges(cells).map(({ a, b }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  for (const [a, b] of p.segments.slice(0, p.edgeCount)) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const near = Math.min(...exposed.map((e) => Math.hypot(e.x - mid.x, e.y - mid.y)));
    assert.ok(near < width, `side at ${mid.x},${mid.y} is ${near} px from any exposed edge`);
  }
  assert.ok(p.caps.length >= p.edgeCount, "every side has its inset ends capped");
});

test("perimeter of one agent cell has 6 edges", () => {
  const layout = layoutAtlas(SAMPLE);
  const p = perimeter(footprint(layout.agents[0]), 4);
  assert.equal(p.edgeCount, 6);
  assert.equal(p.segments.length, 6, "a lone convex hex needs no bridges");
});

for (const [label, data] of [
  ["sample", SAMPLE],
  ["crowded", crowded],
]) {
  test(`${label}: minimumZoom fits land plus margins in a 2880x1800 view`, () => {
    const layout = layoutAtlas(data, VIEW.width / VIEW.height);
    const extent = mapExtent(layout, VIEW, DENSITY);
    const zoom = minimumZoom(layout, VIEW, DENSITY);
    assert.ok(extent.width * zoom <= VIEW.width + 1e-6);
    assert.ok(extent.height * zoom <= VIEW.height + 1e-6);
    assert.ok(
      Math.abs(extent.width * zoom - VIEW.width) < 1e-6 ||
        Math.abs(extent.height * zoom - VIEW.height) < 1e-6,
      "the extent fills the view along one axis",
    );
  });

  test(`${label}: clampCamera keeps the view inside the extent`, () => {
    const layout = layoutAtlas(data, VIEW.width / VIEW.height);
    const extent = mapExtent(layout, VIEW, DENSITY);
    const min = minimumZoom(layout, VIEW, DENSITY);
    for (const zoom of [0.001, min * 1.3, 2, 100])
      for (const [centerX, centerY] of [
        [-1e5, -1e5],
        [1e5, 1e5],
        [extent.x, extent.y + extent.height],
      ]) {
        const c = clampCamera({ centerX, centerY, zoom }, layout, VIEW, DENSITY);
        assert.ok(c.zoom >= min - 1e-9 && c.zoom <= MAX_ZOOM * DENSITY + 1e-9);
        const w = VIEW.width / c.zoom,
          h = VIEW.height / c.zoom;
        if (w < extent.width) {
          assert.ok(c.centerX - w / 2 >= extent.x - 1e-6);
          assert.ok(c.centerX + w / 2 <= extent.x + extent.width + 1e-6);
        } else assert.ok(Math.abs(c.centerX - (extent.x + extent.width / 2)) < 1e-6);
        if (h < extent.height) {
          assert.ok(c.centerY - h / 2 >= extent.y - 1e-6);
          assert.ok(c.centerY + h / 2 <= extent.y + extent.height + 1e-6);
        } else assert.ok(Math.abs(c.centerY - (extent.y + extent.height / 2)) < 1e-6);
      }
  });

  test(`${label}: placeStructures keeps every structure inside its footprint`, () => {
    const layout = layoutAtlas(data);
    // Any frame proportions will do: placement fits whatever art it is given.
    const sizeOf = () => ({ width: 400, height: 330 });
    const placed = placeStructures(layout, sizeOf);
    assert.equal(placed.length, layout.projects.length + layout.workspaces.filter((w) => !w.camp).length);
    assert.ok(placed.every((s) => s.footprint), "only landmarks and cottages: workspace yards stay clear for flags");
    for (const s of placed) {
      const size = sizeOf(s.frame);
      const hw = s.width / 2 - 2,
        hh = (s.width * size.height) / size.width / 2 - 2;
      assert.ok(hw > 10, `${s.frame} is drawn at a visible size`);
      for (const [x, y] of [
        [s.x - hw, s.y - hh],
        [s.x + hw, s.y - hh],
        [s.x - hw, s.y + hh],
        [s.x + hw, s.y + hh],
      ])
        assert.ok(insideFootprint(x, y, s.footprint), `${s.frame} corner ${x},${y} leaves its cells`);
    }
  });
}

test("entityAt returns the agent on its cell, the workspace on each of its three cells, the project on all ten, and null on a host's grass", () => {
  const layout = layoutAtlas(SAMPLE);
  const at = (cell) => {
    const p = point(cell);
    assert.deepEqual(cellAt(p.x + 7, p.y - 5), cell);
    return entityAt(layout, p.x + 7, p.y - 5);
  };
  for (const a of layout.agents) assert.equal(at(a.position)?.id, a.id);
  for (const w of layout.workspaces) {
    assert.equal(footprint(w).length, 3);
    for (const c of footprint(w)) assert.equal(at(c)?.id, w.id);
  }
  for (const p of layout.projects) for (const c of footprint(p)) assert.equal(at(c)?.id, p.id);
  const owned = new Set(
    layout.entities.filter((e) => e.kind !== "host").flatMap((e) => footprint(e).map(cellKey)),
  );
  const grass = layout.land.flatMap((m) => m.cells).filter((c) => !owned.has(cellKey(c)));
  assert.ok(grass.length > 0, "the sample has open grass");
  for (const c of grass) assert.equal(at(c), null);
  assert.equal(entityAt(layout, 1e6, 1e6), null, "open sea");
});

test("fitCaption ellipsizes to maxWidth", () => {
  const measure = (s) => s.length * 10;
  assert.equal(fitCaption("short", 100, measure), "short");
  const fitted = fitCaption("a much longer project name", 100, measure);
  assert.ok(measure(fitted) <= 100);
  assert.ok(fitted.endsWith("…"));
  assert.equal(fitted, "a much lo…");
  assert.equal(fitCaption("a much longer", 0, measure), "a…", "never shorter than one letter");
});

test("PR medallions lie in their workspace's yard cells, beyond the cottage", () => {
  const layout = layoutAtlas(SAMPLE);
  const sizeOf = () => ({ width: 300, height: 300 });
  const flagged = layout.workspaces.filter((w) => w.flags);
  assert.ok(flagged.length >= 3, "the study fleet flies flags");
  const flags = placeFlags(layout, sizeOf);
  const expected = flagged.flatMap((w) => [
    ...(w.flags.ci ? [[w.id, w.flags.ci, cellKey(footprint(w)[1])]] : []),
    ...(w.flags.review ? [[w.id, w.flags.review, cellKey(footprint(w)[2])]] : []),
  ]);
  assert.deepEqual(flags.map((f) => [f.entity, f.flag, cellKey(f.cell)]), expected);
  for (const f of flags) {
    assert.equal(f.frame, `flag-${f.flag}`);
    assert.equal(f.width, MEDALLION.size, `${f.flag} is drawn at full size`);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      assert.ok(insideFootprint(f.x + (Math.cos(a) * f.width) / 2, f.y + (Math.sin(a) * f.width) / 2, [f.cell]), `${f.flag} lies inside its cell`);
    }
    // Pushed out from the cell's centre, away from the cottage.
    const ws = layout.workspaces.find((w) => w.id === f.entity);
    const c = point(f.cell),
      middle = structureCentre(ws);
    assert.ok(Math.hypot(f.x - middle.x, f.y - middle.y) > Math.hypot(c.x - middle.x, c.y - middle.y), `${f.flag} sits beyond its cell's centre`);
  }
});

test("Probe's medallion lies in its workspace's first cell, beyond the cottage, above every structure", () => {
  const sizeOf = () => ({ width: 300, height: 300 });
  const data = {
    hosts: [{ key: "h", name: "Host", online: true }],
    projects: [{ key: "p", host: "h", name: "P" }],
    workspaces: [
      { key: "flagged", host: "h", project: "p", name: "a", labels: ["CI green"], probe: { state: "approved" } },
      { key: "bare", host: "h", project: "p", name: "b", probe: { state: "reviewing" } },
      { key: "none", host: "h", project: "p", name: "c", labels: ["Approved"] },
    ],
    agents: [],
  };
  const layout = layoutAtlas(data);
  const probes = placeProbes(layout);
  assert.deepEqual(probes.map((p) => p.entity).sort(), ["bare", "flagged"], "with or without PR flags");
  const structures = placeStructures(layout, sizeOf);
  const flags = placeFlags(layout, sizeOf);
  for (const p of probes) {
    const ws = layout.workspaces.find((w) => w.id === p.entity);
    assert.equal(cellKey(p.cell), cellKey(footprint(ws)[0]));
    assert.equal(p.size, MEDALLION.size);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      assert.ok(insideFootprint(p.x + (Math.cos(a) * p.size) / 2, p.y + (Math.sin(a) * p.size) / 2, [p.cell]), "lies inside its cell");
    }
    const c = point(p.cell),
      middle = structureCentre(ws);
    assert.ok(Math.hypot(p.x - middle.x, p.y - middle.y) > Math.hypot(c.x - middle.x, c.y - middle.y), "beyond its cell's centre");
  }
  for (const m of [...flags, ...probes])
    for (const s of structures) assert.ok(m.depth > s.depth, "medallions sit above structures");
});

test("the auto-merge seal sits on the review medallion's rim, else the CI medallion's", () => {
  const sizeOf = () => ({ width: 300, height: 300 });
  const data = {
    hosts: [{ key: "h", name: "Host", online: true }],
    projects: [{ key: "p", host: "h", name: "P" }],
    workspaces: [
      { key: "both", host: "h", project: "p", name: "a", labels: ["CI green", "Approved"], autoMerge: true },
      { key: "ci", host: "h", project: "p", name: "b", labels: ["CI running"], autoMerge: true },
      { key: "off", host: "h", project: "p", name: "c", labels: ["CI green", "Approved"] },
      { key: "bare", host: "h", project: "p", name: "d", autoMerge: true },
    ],
    agents: [],
  };
  const layout = layoutAtlas(data);
  const flags = placeFlags(layout, sizeOf);
  const seals = placeSeals(layout, flags);
  assert.deepEqual(seals.map((s) => s.entity).sort(), ["both", "ci"], "only a PR medallion wears it");
  for (const s of seals) {
    const ws = layout.workspaces.find((w) => w.id === s.entity);
    const f = flags.find((f) => f.entity === s.entity && f.flag === (ws.flags.review ?? ws.flags.ci));
    const cx = s.x + s.size / 2,
      cy = s.y + s.size / 2;
    assert.ok(Math.abs(Math.hypot(cx - f.x, cy - f.y) - f.width / 2) < 1e-6, "centred on the rim");
    assert.ok(cx > f.x && cy < f.y, "up and to the right");
  }
});

test("a host's load reads on its banner's second line, its foot where it was", async () => {
  const { labels, statParts } = await import("../src/placement.ts");
  const { RIBBON_DETAIL } = await import("../src/ribbon.ts");
  const plain = layoutAtlas(SAMPLE);
  const data = structuredClone(SAMPLE);
  data.hosts[0].stats = { cpu: 13.6, memory: 59, disk: 93 };
  const loaded = layoutAtlas(data);
  const before = labels(plain).find((l) => l.kind === "host");
  const after = labels(loaded).find((l) => l.kind === "host");
  assert.equal(before.detail, undefined);
  assert.deepEqual(after.detail, [
    { text: "CPU 14%", alert: false },
    { text: "MEM 59%", alert: false },
    { text: "DISK 93%", alert: true },
  ]);
  assert.equal(after.y, before.y - RIBBON_DETAIL.extra / 2);
  assert.notEqual(plain.signature, loaded.signature, "a new load repaints the banner");
  assert.deepEqual(statParts({ memory: 12 }), [{ text: "MEM 12%", alert: false }]);
});

test("each subagent's drone takes its own model's colour, not its agent's", async () => {
  const { robots } = await import("../src/placement.ts");
  const data = structuredClone(SAMPLE);
  const agent = data.agents.find((a) => (a.subagents ?? 0) > 0);
  agent.model = "claude/claude-opus-5-5";
  agent.subagents = 2;
  agent.subagentModels = ["codex/gpt-6.1-sol", "claude/claude-sonnet-5-5"];
  const robot = robots(layoutAtlas(data)).find((r) => r.drones === 2);
  assert.equal(robot.art, "robot-orange");
  assert.deepEqual(robot.droneArts, ["robot-white", "robot-orange"]);
});
