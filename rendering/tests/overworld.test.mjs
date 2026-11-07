import test from "node:test";
import assert from "node:assert/strict";
import { layout } from "../src/overworld/layout.ts";
import { overworldFleet, robotColour } from "../src/overworld/fleet.ts";
import { SAMPLE } from "../src/sample.ts";
import { crowded } from "./fixtures.mjs";

const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

for (const [name, data] of [["sample", SAMPLE], ["crowded", crowded]]) {
  test(`overworld (${name}): every shown agent stands once, on the map`, () => {
    const scene = layout(overworldFleet(data));
    const ids = scene.robots.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
    const hosts = new Set(overworldFleet(data).map((h) => h.id));
    for (const a of data.agents.filter((a) => hosts.has(a.host))) assert.ok(ids.includes(a.key), a.key);
    for (const r of scene.robots) assert.ok(r.x > 0 && r.x < scene.w && r.y > 0 && r.y < scene.h, r.id);
  });

  test(`overworld (${name}): workspaces, projects and agents never overlap their own kind`, () => {
    const scene = layout(overworldFleet(data));
    for (const kind of ["project", "workspace", "agent"]) {
      const list = scene.entities.filter((e) => e.kind === kind);
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++) assert.ok(!overlap(list[i], list[j]), `${list[i].id} overlaps ${list[j].id}`);
    }
  });

  test(`overworld (${name}): the layout is deterministic`, () => {
    assert.deepEqual(layout(overworldFleet(data)), layout(overworldFleet(data)));
  });
}

test("robot colours: Claude orange, ChatGPT pearl, others a stable tint", () => {
  assert.equal(robotColour("claude/claude-opus-5-5"), "orange");
  assert.equal(robotColour("codex/gpt-6.1-sol"), "pearl");
  assert.match(robotColour("gemini/gemini-3"), /^#[0-9a-f]{6}$/);
  assert.equal(robotColour("gemini/gemini-3"), robotColour("gemini/gemini-3"));
});
