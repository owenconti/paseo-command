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

test("overworld: the world carries no names, emblems, banners or signs", () => {
  const fleet = overworldFleet(crowded);
  const scene = layout(fleet);
  // Nothing in the scene is text: no labels or plaques, and no name of a host, project or workspace.
  assert.equal(scene.labels, undefined);
  const names = new Set(fleet.flatMap((h) => [h.name, ...h.projects.flatMap((p) => [p.name, ...p.workspaces.map((w) => w.name)])]));
  const json = JSON.stringify({ ...scene, entities: [] });
  for (const name of names) if (name.length > 3) assert.ok(!json.includes(JSON.stringify(name)), `${name} is drawn`);
  // No emblem badges, banners, signboards or link nodes among the sprites.
  for (const item of scene.items) {
    if (item.kind !== "sprite") continue;
    assert.doesNotMatch(item.frame, /^(badge-|banner-|emblem|signboard|label-|host-plaque|path-)/, `${item.sheet}/${item.frame}`);
  }
  assert.equal(scene.links, undefined);
  assert.equal(scene.nodes, undefined);
});

test("overworld: a project keeps its roof on every host; a host's halls and neighbouring hosts differ", () => {
  const host = (key) => ({ key, name: key, online: true, local: key === "a" });
  const data = {
    hosts: [host("a"), host("b"), host("c")],
    projects: ["a", "b", "c"].flatMap((h) => ["paseo-command", "diagonal", "web", "api"].map((p) => ({ key: `${h}/${p}`, host: h, name: p }))),
    workspaces: ["a", "b", "c"].flatMap((h) => ["paseo-command", "diagonal", "web", "api"].map((p) => ({ key: `${h}/${p}/w`, host: h, project: `${h}/${p}`, name: "w" }))),
    agents: [],
  };
  const fleet = overworldFleet(data);
  const roof = (h, p) => fleet.find((x) => x.id === h).projects.find((x) => x.name === p).roof;
  // The same project has the same roof wherever it's checked out (its name seeds it, not its host).
  for (const p of ["paseo-command", "diagonal", "web", "api"]) assert.equal(roof("a", p), roof("b", p), p);
  for (const h of fleet) assert.equal(new Set(h.projects.map((p) => p.roof)).size, h.projects.length, `${h.id} repeats a roof`);
  for (let i = 1; i < fleet.length; i++) assert.notEqual(fleet[i].theme, fleet[i - 1].theme, `${fleet[i].id} looks like ${fleet[i - 1].id}`);
});
