import test from "node:test";
import assert from "node:assert/strict";
import { layoutGalaxy, providerColor } from "../src/galaxy/layout.ts";
import { SAMPLE } from "../src/sample.ts";

for (const aspect of [0.8, 1.6, 2.4]) {
  const layout = layoutGalaxy(SAMPLE, aspect);
  test(`aspect ${aspect}: every project is a planet, every agent a satellite`, () => {
    assert.deepEqual(
      layout.planets.filter((p) => !p.decorative).map((p) => p.id).sort(),
      SAMPLE.projects.map((p) => p.key).sort(),
    );
    assert.equal(layout.satellites.length, SAMPLE.agents.length);
    for (const s of layout.satellites) {
      const station = layout.stations.find((st) => st.id === s.station);
      assert.ok(station, `${s.id} has no station`);
      assert.equal(station.planet, s.planet);
    }
  });
  test(`aspect ${aspect}: planetary systems never overlap`, () => {
    const ps = layout.planets;
    for (let i = 0; i < ps.length; i++)
      for (let j = i + 1; j < ps.length; j++)
        assert.ok(Math.hypot(ps[i].x - ps[j].x, ps[i].y - ps[j].y) > ps[i].r + ps[j].r + 80, `${ps[i].id} crowds ${ps[j].id}`);
  });
}

test("stations show their most urgent agent; working stations orbit", () => {
  const layout = layoutGalaxy(SAMPLE);
  for (const st of layout.stations) {
    const own = layout.satellites.filter((s) => s.station === st.id);
    assert.equal(st.moving, own.some((s) => s.state === "running"));
  }
  const failed = layout.satellites.find((s) => s.state === "failed");
  assert.equal(layout.stations.find((s) => s.id === failed.station).state, "failed");
});

test("captions count what needs you before what is running", () => {
  const layout = layoutGalaxy(SAMPLE);
  const api = layout.planets.find((p) => p.name === "diagonal-api");
  assert.match(api.caption, /^2 NEED YOU · 1 RUNNING/);
});

test("satellites take their provider's colour", () => {
  assert.equal(providerColor("claude/claude-opus-5-5"), 0xda7454);
  assert.equal(providerColor("codex/gpt-6.1-sol"), 0x35c48f);
  assert.equal(providerColor(""), 0x9aa4b0);
});

test("layout is deterministic", () => {
  assert.equal(layoutGalaxy(SAMPLE).signature, layoutGalaxy(structuredClone(SAMPLE)).signature);
});
