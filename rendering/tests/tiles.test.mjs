import test from "node:test";
import assert from "node:assert/strict";
import {
  projects,
  workspaces,
  landCells,
  cellKey,
  footprint,
  footprintEdges,
  insideFootprint,
  fittedWidth,
  point,
} from "../src/world.ts";

test("structure footprints contain whole, distinct, non-overlapping land cells", () => {
  const occupied = new Set();
  for (const entity of [...projects, ...workspaces]) {
    const cells = footprint(entity),
      land = new Set(landCells(entity.host).map(cellKey));
    assert.equal(cells.length, entity.kind === "project" ? 7 : 1);
    for (const cell of cells) {
      assert.ok(Number.isInteger(cell.q) && Number.isInteger(cell.r));
      assert.ok(land.has(cellKey(cell)), `${entity.id} occupies water`);
      const key = entity.host + ":" + cellKey(cell);
      assert.ok(!occupied.has(key), `${entity.id} overlaps another structure`);
      occupied.add(key);
    }
  }
});

test("footprint selection excludes shared interior edges", () => {
  assert.equal(footprintEdges(footprint(projects[0])).length, 18);
  assert.equal(footprintEdges(footprint(workspaces[0])).length, 6);
});

test("sprite bounds fit inside single-cell and seven-cell footprints", () => {
  for (const entity of [...projects, ...workspaces])
    for (const aspect of [0.9, 1, 1.15]) {
      const p = point(entity.position),
        cells = footprint(entity),
        width = fittedWidth(p.x, p.y, aspect, 335, cells),
        height = width / aspect;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        for (const [x, y] of [
          [p.x - width / 2 + width * t, p.y - height / 2],
          [p.x - width / 2 + width * t, p.y + height / 2],
          [p.x - width / 2, p.y - height / 2 + height * t],
          [p.x + width / 2, p.y - height / 2 + height * t],
        ])
          assert.ok(
            insideFootprint(x, y, cells),
            `${entity.id} sprite spills from its cells`,
          );
      }
    }
});
