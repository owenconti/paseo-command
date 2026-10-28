import test from "node:test";
import assert from "node:assert/strict";
import {
  layoutAtlas,
  cellKey,
  footprint,
  footprintEdges,
  insideFootprint,
  fittedWidth,
  point,
  distance,
  NEIGHBORS,
  modelColor,
  modelName,
  structureCentre,
} from "../src/world.ts";
import { SAMPLE, STRUCTURE_SAMPLE } from "../src/sample.ts";
import { crowded } from "./fixtures.mjs";

for (const [label, data] of [
  ["sample", SAMPLE],
  ["crowded", crowded],
]) {
  const layout = layoutAtlas(data);
  const land = new Map();
  for (const i of layout.islands)
    for (const c of i.cells) land.set(cellKey(c), i);

  test(`${label}: structures and agents own whole, distinct land cells`, () => {
    const occupied = new Set();
    for (const entity of [...layout.projects, ...layout.workspaces, ...layout.agents]) {
      const cells = footprint(entity);
      assert.equal(cells.length, { project: 10, workspace: 3, agent: 1 }[entity.kind]);
      for (const cell of cells) {
        assert.ok(Number.isInteger(cell.q) && Number.isInteger(cell.r));
        const island = land.get(cellKey(cell));
        assert.ok(island, `${entity.id} occupies water`);
        assert.equal(island.host, entity.host, `${entity.id} is on another host's island`);
        if (entity.project || entity.kind === "project")
          assert.equal(island.key, entity.project ?? entity.id, `${entity.id} left its project's island`);
        assert.ok(!occupied.has(cellKey(cell)), `${entity.id} overlaps another structure`);
        occupied.add(cellKey(cell));
      }
    }
  });

  test(`${label}: one whole island per project, never touching another`, () => {
    for (const p of layout.projects)
      assert.equal(layout.islands.filter((i) => i.key === p.id).length, 1);
    const all = layout.islands.map((i) => i.cells);
    for (let a = 0; a < all.length; a++)
      for (let b = a + 1; b < all.length; b++)
        for (const x of all[a])
          for (const y of all[b])
            assert.ok(distance(x, y) > 1, "two islands touch");
    for (const island of layout.islands) {
      const keys = new Set(island.cells.map(cellKey));
      const seen = new Set([cellKey(island.cells[0])]);
      const queue = [island.cells[0]];
      while (queue.length) {
        const c = queue.pop();
        for (const d of NEIGHBORS) {
          const n = { q: c.q + d.q, r: c.r + d.r };
          if (keys.has(cellKey(n)) && !seen.has(cellKey(n))) {
            seen.add(cellKey(n));
            queue.push(n);
          }
        }
      }
      assert.equal(seen.size, keys.size, `${island.key} is split`);
    }
  });

  test(`${label}: every agent stands on its own cell beside its workspace`, () => {
    for (const agent of layout.agents) {
      const home = layout.workspaces.find((w) => w.id === agent.workspace);
      assert.ok(home, `${agent.id} has no workspace`);
      const near = Math.min(...footprint(home).map((c) => distance(c, agent.position)));
      assert.ok(near >= 1 && near <= 2, `${agent.id} strays from its workspace`);
    }
    assert.equal(layout.agents.length, data.agents.length);
  });

  test(`${label}: workspaces around a landmark keep a cell apart`, () => {
    // The first six of each project ring the landmark; later ones stand against them.
    const ringed = layout.workspaces.filter(
      (w) => layout.workspaces.filter((o) => o.project === w.project).indexOf(w) < 6,
    );
    const groups = ringed.map((w) => [
      ...footprint(w),
      ...layout.agents.filter((a) => a.workspace === w.id).map((a) => a.position),
    ]);
    for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++)
        for (const x of groups[a])
          for (const y of groups[b]) assert.ok(distance(x, y) >= 2, "two workspaces touch");
  });

  test(`${label}: sprite bounds fit inside their footprints`, () => {
    for (const entity of [...layout.projects, ...layout.workspaces])
      for (const aspect of [0.9, 1, 1.15]) {
        const p = structureCentre(entity),
          cells = footprint(entity),
          width = fittedWidth(p.x, p.y, aspect, 420, cells),
          height = width / aspect;
        for (let i = 0; i <= 50; i++) {
          const t = i / 50;
          for (const [x, y] of [
            [p.x - width / 2 + width * t, p.y - height / 2],
            [p.x - width / 2 + width * t, p.y + height / 2],
            [p.x - width / 2, p.y - height / 2 + height * t],
            [p.x + width / 2, p.y - height / 2 + height * t],
          ])
            assert.ok(insideFootprint(x, y, cells), `${entity.id} spills from its cells`);
        }
      }
  });
}

const touches = (cells, others) =>
  cells.some((c) => others.some((o) => distance(c, o) === 1));
const centreOf = (cells) => ({
  x: cells.reduce((s, c) => s + point(c).x, 0) / cells.length,
  y: cells.reduce((s, c) => s + point(c).y, 0) / cells.length,
});

test("workspaces ring their landmark: below, lower left, lower right, then above", () => {
  const layout = layoutAtlas(crowded);
  const p0 = layout.projects.find((p) => p.id === "p0");
  const core = footprint(p0),
    middle = centreOf(core);
  const around = layout.workspaces.filter((w) => w.project === "p0");
  assert.equal(around.length, 9);
  // The first ring touches the landmark, the cottage on the cell facing it.
  for (const w of around.slice(0, 6)) {
    assert.ok(touches(footprint(w), core), `${w.id} doesn't touch its landmark`);
    const nearest = Math.min(...footprint(w).map((c) => Math.min(...core.map((o) => distance(c, o)))));
    assert.equal(Math.min(...core.map((o) => distance(w.position, o))), nearest);
  }
  const at = around.map((w) => centreOf(footprint(w)));
  // Below, then lower left and lower right, then upper left and upper right.
  assert.ok(at[0].y > middle.y && Math.abs(at[0].x - middle.x) < 70, "the first isn't below");
  assert.ok(at[1].x < middle.x && at[1].y > middle.y, "the second isn't lower left");
  assert.ok(at[2].x > middle.x && at[2].y > middle.y, "the third isn't lower right");
  assert.ok(at[3].x < middle.x && at[3].y < middle.y, "the fourth isn't upper left");
  assert.ok(at[4].x > middle.x && at[4].y < middle.y, "the fifth isn't upper right");
  assert.ok(at[5].y < middle.y && Math.abs(at[5].x - middle.x) < 70, "the sixth isn't above");
});

test("agents grow away from the landmark, oldest first, bottom then alternating sides", () => {
  const data = structuredClone(crowded);
  // Created newest first in the data; the oldest still takes the first cell.
  data.agents.forEach((a, i) => (a.created = new Date(Date.UTC(2026, 0, 1, 0, 60 - i)).toISOString()));
  const layout = layoutAtlas(data);
  const w0 = layout.workspaces.find((w) => w.id === "w0");
  const yard = centreOf(footprint(w0));
  const crowd = ["x5", "x4", "x3", "x2", "x1", "x0"].map((id) =>
    point(layout.agents.find((a) => a.id === id).position),
  );
  // The first stands straight below the yard, the next two below it on the
  // left and then the right.
  assert.ok(Math.abs(crowd[0].x - yard.x) < 1 && crowd[0].y > yard.y);
  assert.ok(crowd[1].x < yard.x && crowd[1].y === crowd[0].y);
  assert.ok(crowd[2].x > yard.x && crowd[2].y === crowd[0].y);
  assert.ok(crowd[3].x < yard.x && crowd[4].x > yard.x);
  // Every agent is farther from the landmark than the cottage.
  const core = centreOf(footprint(layout.projects.find((p) => p.id === "p0")));
  const reach = (p) => Math.hypot(p.x - core.x, p.y - core.y);
  for (const p of crowd) assert.ok(reach(p) > reach(point(w0.position)));
});

test("projects without workspaces stay off the map", () => {
  const layout = layoutAtlas(crowded);
  // p0 and p3 have workspaces (p3 also a camp) and the offline pb one; the rest have none.
  assert.deepEqual(layout.projects.map((p) => p.id).sort(), ["p0", "p3", "pb"]);
  assert.ok(!layout.islands.some((i) => ["p1", "p2", "p4", "p5", "p6"].includes(i.key)));
});

test("footprint selection excludes shared interior edges", () => {
  const layout = layoutAtlas(SAMPLE);
  // Rows of 3, 4 and 3: 60 cell sides, 19 shared pairs.
  assert.equal(footprintEdges(footprint(layout.projects[0])).length, 22);
  // Three cells that all touch: 18 sides, 3 shared pairs.
  assert.equal(footprintEdges(footprint(layout.workspaces[0])).length, 12);
  assert.equal(footprintEdges(footprint(layout.agents[0])).length, 6);
});

test("homeless agents and offline hosts stay truthful", () => {
  const layout = layoutAtlas(crowded);
  const camp = layout.workspaces.find((w) => w.camp);
  assert.equal(camp.project, "p3");
  assert.equal(layout.agents.find((a) => a.id === "homeless").workspace, camp.id);
  assert.equal(layout.workspaces.find((w) => w.id === "orphan").project, undefined);
  assert.equal(layout.agents.find((a) => a.id === "far").state, "offline");
  assert.ok(!layout.islands.some((i) => i.host === "c"), "a host without workspaces is hidden");
  assert.ok(!layout.hosts.some((h) => h.id === "c"));
  assert.ok(!layout.land.some((m) => m.host === "c"));
});

test("layout is deterministic and changes signature with structure only", () => {
  const a = layoutAtlas(crowded), b = layoutAtlas(structuredClone(crowded));
  assert.equal(a.signature, b.signature);
  const moved = structuredClone(crowded);
  moved.agents[0].state = "failed";
  assert.equal(layoutAtlas(moved).signature, a.signature);
  moved.workspaces.push({ key: "new", host: "local", project: "p1", name: "new" });
  assert.notEqual(layoutAtlas(moved).signature, a.signature);
});

test("the layout follows the map's shape", () => {
  const shape = (aspect) => {
    const cells = layoutAtlas(crowded, aspect).islands.flatMap((i) => i.cells);
    const xs = cells.map((c) => point(c).x),
      ys = cells.map((c) => point(c).y);
    return (Math.max(...xs) - Math.min(...xs)) / (Math.max(...ys) - Math.min(...ys));
  };
  const tall = shape(0.6),
    wide = shape(2.4);
  assert.ok(tall < 1, `a tall map is still ${tall.toFixed(2)} wide per unit height`);
  assert.ok(wide > tall * 1.8, "a wide map should spread out");
});

test("each host's land is whole hexes holding its islands, apart from other hosts", () => {
  const layout = layoutAtlas(crowded);
  for (const mass of layout.land) {
    const own = new Set(mass.cells.map(cellKey));
    for (const island of layout.islands.filter((i) => i.host === mass.host))
      for (const c of island.cells) assert.ok(own.has(cellKey(c)), `${island.key} is off its host's land`);
    for (const other of layout.land)
      if (other !== mass)
        for (const a of mass.cells)
          for (const b of other.cells) assert.ok(distance(a, b) > 1, "two hosts' land touches");
  }
});

test("model colours and names follow the provider", () => {
  assert.equal(modelColor("claude/claude-opus-5-5"), "orange");
  assert.equal(modelColor("claude/claude-sonnet-5"), "orange");
  assert.equal(modelColor("codex/gpt-6.1-sol"), "white");
  assert.equal(modelColor("codex/gpt-6-astra"), "white");
  assert.ok(!["orange", "white"].includes(modelColor("gemini/gemini-3-pro")));
  assert.equal(modelName("claude/claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(modelName("codex/gpt-6.1-sol"), "GPT-6.1 Sol");
});

test("structure art spreads across the available sprites", () => {
  const world = layoutAtlas(crowded, 1.6);
  const counts = (arts) => {
    const n = new Map();
    for (const art of arts) n.set(art, (n.get(art) ?? 0) + 1);
    return [...n.values()];
  };
  const landmarks = counts(world.projects.map((e) => e.art));
  assert.ok(Math.max(...landmarks) - Math.min(...landmarks) <= 1, `landmarks ${landmarks}`);
  const byProject = Map.groupBy(
    world.workspaces.filter((e) => e.art),
    (e) => e.project,
  );
  for (const [project, cottages] of byProject) {
    const n = counts(cottages.map((e) => e.art));
    assert.ok(Math.max(...n) - Math.min(...n) <= 1 && n.length === Math.min(7, cottages.length), `${project} cottages ${n}`);
  }
});

test("structure review fleet exercises all eight landmarks and seven cottage silhouettes", () => {
  const world = layoutAtlas(STRUCTURE_SAMPLE);
  assert.equal(new Set(world.projects.map((p) => p.art)).size, 8);
  const cottages = world.workspaces.filter((w) => w.project === "structure-0");
  assert.equal(new Set(cottages.map((w) => w.art)).size, 7);
  assert.deepEqual(world.projects.map((p) => p.art), layoutAtlas(STRUCTURE_SAMPLE).projects.map((p) => p.art));
});

test("labelled workspaces carry their PR flags; camps and others don't", () => {
  const data = structuredClone(crowded);
  data.workspaces.find((w) => w.key === "w0").labels = ["CI running", "Approved", "bug"];
  data.workspaces.find((w) => w.key === "w1").labels = ["bug"];
  const layout = layoutAtlas(data);
  const ws = (id) => layout.workspaces.find((w) => w.id === id);
  assert.deepEqual(ws("w0").flags, { ci: "ci-running", review: "review-approved" });
  assert.equal("flags" in ws("w1"), false);
  assert.equal("flags" in ws("w2"), false);
  for (const camp of layout.workspaces.filter((w) => w.camp)) assert.equal("flags" in camp, false);
});

test("a change of PR labels changes the layout's signature", () => {
  const data = structuredClone(crowded);
  const before = layoutAtlas(data).signature;
  data.workspaces.find((w) => w.key === "w0").labels = ["CI green"];
  const after = layoutAtlas(data).signature;
  assert.notEqual(before, after);
  data.workspaces.find((w) => w.key === "w1").labels = ["bug"];
  assert.equal(layoutAtlas(data).signature, after);
});
