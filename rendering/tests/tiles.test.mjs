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
import { SAMPLE } from "../src/sample.ts";

/** A larger fleet: many projects, a crowded workspace, an orphan workspace,
 * an agent without a workspace, an empty host and an offline host. */
const crowded = {
  hosts: [
    { key: "local", name: "local", online: true, local: true },
    { key: "a", name: "alpha", online: true, local: false },
    { key: "b", name: "bravo", online: false, local: false },
    { key: "c", name: "charlie", online: true, local: false },
  ],
  projects: Array.from({ length: 7 }, (_, i) => ({
    key: `p${i}`,
    host: i < 5 ? "local" : "a",
    name: `project-${i}`,
  })).concat([{ key: "pb", host: "b", name: "offline-project" }]),
  workspaces: [
    ...Array.from({ length: 11 }, (_, i) => ({
      key: `w${i}`,
      host: "local",
      project: i < 9 ? "p0" : "p3",
      name: `workspace ${i}`,
    })),
    { key: "orphan", host: "local", name: "orphan workspace" },
    { key: "wb", host: "b", project: "pb", name: "remote" },
  ],
  agents: [
    ...Array.from({ length: 6 }, (_, i) => ({
      key: `x${i}`,
      host: "local",
      workspace: "w0",
      project: "p0",
      name: `crowd ${i}`,
      model: "claude/claude-opus-5-5",
      state: "running",
    })),
    {
      key: "homeless",
      host: "local",
      project: "p3",
      name: "no workspace",
      model: "codex/gpt-6.1-sol",
      state: "idle",
    },
    {
      key: "far",
      host: "b",
      workspace: "wb",
      name: "far",
      model: "claude/claude-sonnet-5",
      state: "running",
    },
  ],
};

for (const [label, data] of [
  ["sample", SAMPLE],
  ["crowded", crowded],
]) {
  const layout = layoutAtlas(data);
  const land = new Map();
  for (const i of layout.islands)
    for (const c of i.cells) land.set(cellKey(c), i);

  test(`${label}: structures own whole, distinct land cells`, () => {
    const occupied = new Set();
    for (const entity of [...layout.projects, ...layout.workspaces]) {
      const cells = footprint(entity);
      assert.equal(cells.length, entity.kind === "project" ? 10 : 1);
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

  test(`${label}: every agent shares its workspace cell`, () => {
    for (const agent of layout.agents) {
      const home = layout.workspaces.find((w) => w.id === agent.workspace);
      assert.ok(home, `${agent.id} has no cell`);
      assert.equal(cellKey(agent.position), cellKey(home.position));
    }
    assert.equal(layout.agents.length, data.agents.length);
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

test("workspaces stand in rows below their landmark, which tops its island", () => {
  const layout = layoutAtlas(crowded);
  for (const p of layout.projects) {
    const core = footprint(p),
      bottom = Math.max(...core.map((c) => c.r)),
      top = Math.min(...core.map((c) => c.r));
    const island = layout.islands.find((i) => i.key === p.id);
    assert.equal(Math.min(...island.cells.map((c) => c.r)), top, `${p.name} is not at the top`);
    const below = layout.workspaces.filter((w) => w.project === p.id);
    for (const w of below) assert.ok(w.position.r > bottom, `${w.id} is not below ${p.name}`);
    // The landmark's rows hold only its own cells: no spare tiles beside it.
    for (const r of new Set(core.map((c) => c.r)))
      assert.equal(
        island.cells.filter((c) => c.r === r).length,
        core.filter((c) => c.r === r).length,
        `${p.name} has spare tiles beside it`,
      );
    // Rows of at most four.
    const rows = new Map();
    for (const w of below) rows.set(w.position.r, (rows.get(w.position.r) ?? 0) + 1);
    for (const n of rows.values()) assert.ok(n <= 4);
  }
  const p0 = layout.projects.find((p) => p.id === "p0");
  assert.equal(layout.workspaces.filter((w) => w.project === "p0").length, 9);
  // A few workspaces sit under the landmark's middle, not off to one side.
  const p3 = layout.projects.find((p) => p.id === "p3");
  const xs = layout.workspaces
    .filter((w) => w.project === "p3")
    .map((w) => point(w.position).x - structureCentre(p3).x);
  assert.ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2) < 70);
  assert.ok(p0);
});

test("footprint selection excludes shared interior edges", () => {
  const layout = layoutAtlas(SAMPLE);
  // Rows of 3, 4 and 3: 60 cell sides, 19 shared pairs.
  assert.equal(footprintEdges(footprint(layout.projects[0])).length, 22);
  assert.equal(footprintEdges(footprint(layout.workspaces[0])).length, 6);
});

test("crowded cells, homeless agents and offline hosts stay truthful", () => {
  const layout = layoutAtlas(crowded);
  const overflow = layout.agents.filter((a) => a.overflow);
  assert.deepEqual(
    overflow.map((a) => a.overflow),
    [2],
  );
  const camp = layout.workspaces.find((w) => w.camp);
  assert.equal(camp.project, "p3");
  assert.equal(layout.agents.find((a) => a.id === "homeless").workspace, camp.id);
  assert.equal(layout.workspaces.find((w) => w.id === "orphan").project, undefined);
  assert.equal(layout.agents.find((a) => a.id === "far").state, "offline");
  assert.ok(layout.islands.find((i) => i.host === "c"), "an empty host still has an island");
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
  assert.equal(modelColor("claude/claude-opus-5-5"), "teal");
  assert.equal(modelColor("claude/claude-sonnet-5"), "lime");
  assert.equal(modelColor("codex/gpt-6.1-sol"), "violet");
  assert.equal(modelColor("codex/gpt-6-astra"), "blue");
  assert.equal(modelName("claude/claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(modelName("codex/gpt-6.1-sol"), "GPT-6.1 Sol");
});
