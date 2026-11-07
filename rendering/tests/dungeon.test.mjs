import test from "node:test";
import assert from "node:assert/strict";
import { layoutDungeon, overlaps, segmentRect, hudSubtitle, projectIcon, robotColor, cutawaySpans, D } from "../src/dungeon/layout.ts";
import { FRAMES, applySheet } from "../src/dungeon/frames.ts";
import { readdirSync, readFileSync } from "node:fs";

// Lay out with the real sheets' sizes and anchors, as the app does.
const SHEETS = new URL("../src/assets/dungeon/", import.meta.url);
for (const f of readdirSync(SHEETS).filter((f) => f.endsWith(".json") && f !== "prompts.json"))
  applySheet(JSON.parse(readFileSync(new URL(f, SHEETS), "utf8")));
import { DUNGEON_SAMPLE, SAMPLE } from "../src/sample.ts";
import { crowded } from "./fixtures.mjs";

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

/** Nothing the board says or shows overlaps anything else it says or shows. */
function assertLegible(layout) {
  const things = [
    ...layout.floors.map((f) => ({ what: `plaque ${f.title}`, rect: f.plaque })),
    ...layout.projects.map((p) => ({ what: `project ${p.name}`, rect: p.rect })),
    ...layout.workspaces.map((w) => ({ what: `alcove ${w.entity.id}`, rect: w.rect })),
    ...layout.agents.map((a) => ({ what: `robot ${a.entity.id}`, rect: a.rect })),
  ];
  for (let i = 0; i < things.length; i++)
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i], b = things[j];
      // Robots stand in their own alcove.
      if (a.what.startsWith("alcove") && b.what.startsWith("robot")) continue;
      assert.ok(!overlaps(a.rect, b.rect), `${a.what} overlaps ${b.what}`);
    }
  // Only the hosts carry labels (their plaques), as on the Islands; PR medallions sit on their alcove's lintel.
  const labels = layout.floors.map((f) => f.plaque);
  for (const p of layout.projects) assert.equal(p.label, undefined, "a project carries no label");
  for (const w of layout.workspaces) {
    assert.equal(w.label, undefined, "a workspace carries no label");
    for (const f of w.flags) assert.ok(f.x >= w.rect.x && f.x <= w.rect.x + w.rect.w && f.y >= w.rect.y && f.y <= w.rect.y + 30, "a PR medallion sits on its alcove's lintel");
  }
  // Links cross no plaque, medallion or robot, but for a stub ending at its own medallion.
  const blockers = [...layout.projects.map((p) => p.rect), ...layout.agents.map((a) => a.rect), ...layout.floors.map((f) => f.plaque)];
  for (const link of layout.links)
    for (let i = 1; i < link.length; i++) {
      const seg = segmentRect(link[i - 1], link[i], 0);
      const r = { x: seg.x + 0.5, y: seg.y + 0.5, w: Math.max(0, seg.w - 1), h: Math.max(0, seg.h - 1) };
      const end = link[link.length - 1];
      for (const b of blockers) {
        const own = end.x >= b.x && end.x <= b.x + b.w && end.y >= b.y && end.y <= b.y + b.h;
        if (!own) assert.ok(!overlaps(r, b, -1), `a link crosses something at ${JSON.stringify(link[i])}`);
      }
    }
  // Decorations keep clear of everything the board says or shows, and of each other.
  const shown = [...things.map((t) => t.rect), ...labels, ...layout.agents.map((a) => ({ ...a.rect, y: a.rect.y - 8, h: a.rect.h + 8 }))];
  layout.decor.forEach((d, i) => {
    if (d.project) return;
    for (const r of shown) assert.ok(!overlaps(d.rect, r), `${d.frame} covers something`);
    for (const e of layout.decor.slice(i + 1)) if (!e.project && !d.recess && !e.recess && !(d.group && d.group === e.group) && d.frame !== "banner-crown") assert.ok(!overlaps(d.rect, e.rect), `${d.frame} overlaps ${e.frame}`);
    assert.ok(FRAMES[d.frame] || FRAMES[`${d.frame}-0`], `${d.frame} is in the frame contract`);
  });
  // Everything lies on the board.
  const b = layout.bounds;
  for (const t of things) assert.ok(t.rect.x >= b.x && t.rect.x + t.rect.w <= b.x + b.w && t.rect.y >= b.y && t.rect.y + t.rect.h <= b.y + b.h, `${t.what} is off the board`);
}

test("the concept's fleet: three floors, two projects each, one tier, gates central", () => {
  const layout = layoutDungeon(DUNGEON_SAMPLE, 1.4);
  assert.equal(layout.floors.length, 3);
  assert.deepEqual(layout.floors.map((f) => f.title), ["LOCAL", "PROD", "STAGING"]);
  for (const f of layout.floors) {
    assert.equal(f.tiers, 1);
    assert.equal(f.medallion.x, 0);
    assert.equal(f.plaque.x + f.plaque.w / 2, 0);
    assert.equal(f.node.x, 0);
    assert.equal(layout.projects.filter((p) => p.floor === layout.floors.indexOf(f)).length, 2);
  }
  assert.deepEqual(layout.counts, { hosts: 3, projects: 6, workspaces: 11, agents: 27 });
  assert.equal(layout.floors[0].stats.map((s) => s.text).join(" · "), "CPU 42% · MEM 58% · DISK 70%");
  // About the concept's proportions: a board some 1,200 wide and as tall.
  assert.ok(layout.bounds.w > 1100 && layout.bounds.w < 1600, `width ${layout.bounds.w}`);
  assert.ok(layout.bounds.h > 1050 && layout.bounds.h < 1450, `height ${layout.bounds.h}`);
  // Compact, as the concept's masses nearly interlock: no wider than 1.1 times (a foot of the concept's proportion) its height.
  assert.ok(layout.bounds.w / layout.bounds.h <= 1.1, `aspect ${layout.bounds.w / layout.bounds.h}`);
  for (const f of layout.floors) assert.equal(f.rect.h, f.last ? D.band + D.tierH + D.foot + D.footPad : D.band + D.tierH);
  // The first project stands left of the gate, the second right.
  const local = layout.projects.filter((p) => p.floor === 0);
  assert.ok(local[0].node.x < 0 && local[1].node.x > 0);
  // Workspaces read left to right oldest first: api then web.
  const [api, web] = ["api", "web"].map((n) => layout.workspaces.find((w) => w.entity.name === n));
  assert.ok(api.rect.x < web.rect.x);
  assertLegible(layout);
  // The foot of the last stairs: two rugs, two braziers, the crown banner, all above the count bar's strip.
  const foot = layout.floors.at(-1).rect;
  const strip = foot.y + foot.h - D.footPad;
  for (const frame of ["rug-red", "brazier"]) {
    const items = layout.decor.filter((d) => d.frame === frame && d.rect.y > foot.y + D.band);
    assert.equal(items.length, 2, `two ${frame}s at the foot`);
    for (const d of items) assert.ok(d.rect.y + d.rect.h <= strip, `${frame} above the count bar's strip`);
  }
});

test("the same fleet always makes the same board", () => {
  const a = layoutDungeon(DUNGEON_SAMPLE, 1.4), b = layoutDungeon(structuredClone(DUNGEON_SAMPLE), 1.4);
  assert.equal(a.signature, b.signature);
  assert.deepEqual(a.decor, b.decor);
  assert.deepEqual(a.links, b.links);
});

test("states change nothing's place; a renamed workspace keeps its alcove's place", () => {
  const a = layoutDungeon(DUNGEON_SAMPLE, 1.4);
  const busy = structuredClone(DUNGEON_SAMPLE);
  for (const agent of busy.agents) agent.state = "failed";
  assert.equal(layoutDungeon(busy, 1.4).signature, a.signature);
  const renamed = structuredClone(DUNGEON_SAMPLE);
  renamed.workspaces[0].name = "zzz";
  const r = layoutDungeon(renamed, 1.4);
  const id = DUNGEON_SAMPLE.workspaces[0].key;
  assert.equal(r.workspaces.find((w) => w.entity.id === id).rect.x, a.workspaces.find((w) => w.entity.id === id).rect.x);
});

test("one host with one workspace", () => {
  const data = {
    hosts: [{ key: "local", name: "Local", online: true, local: true }],
    projects: [{ key: "p", host: "local", name: "solo" }],
    workspaces: [{ key: "w", host: "local", project: "p", name: "main" }],
    agents: [{ key: "a", host: "local", project: "p", workspace: "w", name: "a", model: "claude/opus", state: "running" }],
  };
  const layout = layoutDungeon(data, 1.6);
  assert.equal(layout.floors.length, 1);
  assert.equal(layout.agents.length, 1);
  assert.equal(layout.runs.w.length, 5);
  assertLegible(layout);
});

test("Atlas's fleets: camps, projectless workspaces, offline hosts", () => {
  for (const data of [SAMPLE, crowded]) {
    const layout = layoutDungeon(data, 1.6);
    assertLegible(layout);
    for (const a of data.agents.filter((a) => layout.floors.some((f) => f.host.id === a.host)))
      assert.ok(layout.agents.some((x) => x.entity.id === a.key), `${a.key} is on the board`);
  }
  const layout = layoutDungeon(crowded, 1.6);
  assert.ok(layout.workspaces.some((w) => w.entity.camp), "a camp alcove");
  assert.ok(layout.projects.some((p) => !p.entity && p.name === "No project"));
  const offline = layout.floors.find((f) => !f.online);
  assert.match(offline.title, /OFFLINE/);
  // Its sign paints the bare name in capitals ("OFFLINE" is its own painted line).
  assert.equal(offline.name, offline.host.name.toUpperCase());
  assert.ok(layout.agents.filter((a) => a.entity.host === offline.host.id).every((a) => a.entity.state === "offline"));
});

test("a large fleet wraps onto tiers, stays legible and lays out quickly", () => {
  const data = big(6, 10, 8, 6);
  const start = performance.now();
  const layout = layoutDungeon(data, 1.6);
  const ms = performance.now() - start;
  assert.ok(ms < 3000, `took ${ms} ms`);
  assert.equal(layout.agents.length, 6 * 10 * 8 * 6);
  assert.ok(layout.floors.every((f) => f.tiers > 1));
  const ratio = layout.bounds.w / layout.bounds.h;
  assert.ok(ratio >= 0.6 && ratio <= 1.6, `aspect ${ratio}`);
  for (const f of layout.floors) assert.equal(f.medallion.x, 0);
  assertLegible(layout);
  const aspect = layout.bounds.w / layout.bounds.h;
  assert.ok(aspect > 0.3 && aspect < 4, `aspect ${aspect}`);
});

test("floors keep their natural width, wrapping only when the board would be far wider than tall", () => {
  // The concept's fleet: portrait, about the concept's size, no wrapping.
  const concept = layoutDungeon(DUNGEON_SAMPLE, 2.5);
  assert.ok(concept.floors.every((f) => f.tiers === 1));
  assert.equal(concept.bounds.w, layoutDungeon(DUNGEON_SAMPLE, 0.5).bounds.w, "the map's shape changes nothing");
  // One host with many projects wraps them toward an aspect between 0.8 and 1.6, taking whichever tiering
  // comes nearest (with labelless, shorter tiers, wide blocks may only get near it).
  const wide = layoutDungeon(big(1, 12, 2, 2), 1.6);
  assert.ok(wide.floors[0].tiers > 1);
  const ratio = wide.bounds.w / wide.bounds.h;
  assert.ok(ratio <= 1.9 && ratio >= 0.6, `aspect ${ratio}`);
  assertLegible(wide);
});

test("the HUD's subtitle is short and true", () => {
  assert.equal(hudSubtitle(layoutDungeon(DUNGEON_SAMPLE, 1.4)), "12 running · 7 need you");
  const quiet = structuredClone(DUNGEON_SAMPLE);
  for (const a of quiet.agents) a.state = "idle";
  assert.equal(hudSubtitle(layoutDungeon(quiet, 1.4)), "All quiet");
});

test("project icons come from their names, else a stable pick", () => {
  assert.equal(projectIcon("core-platform", "k"), "code");
  assert.equal(projectIcon("developer-tools", "k"), "cube");
  assert.equal(projectIcon("growth", "k"), "chart");
  assert.equal(projectIcon("experiments", "k"), "flask");
  assert.equal(projectIcon("customer", "k"), "person");
  assert.equal(projectIcon("platform", "k"), "layers");
  assert.equal(projectIcon("qwerty", "k1"), projectIcon("qwerty", "k1"));
  assert.ok(D.slot > D.robot);
});

test("robots: Claude orange, ChatGPT white, each other provider a stable colour of its own", () => {
  assert.equal(robotColor("claude/claude-opus-5-5"), "orange");
  assert.equal(robotColor("codex/gpt-6.1-sol"), "white");
  assert.equal(robotColor("opencode/a"), robotColor("opencode/b"), "by provider");
  assert.notEqual(robotColor("opencode/a"), "orange");
  const layout = layoutDungeon(DUNGEON_SAMPLE, 1.4);
  assert.ok(new Set(layout.agents.map((a) => a.robot)).size >= 7);
});

test("each floor's cutaway opens round the next host's gate, so its arch reads whole", () => {
  const layout = layoutDungeon(DUNGEON_SAMPLE, 1.4);
  layout.floors.forEach((fl, i) => {
    const next = layout.floors[i + 1];
    for (const y0 of fl.tierTops) {
      const spans = cutawaySpans(fl, y0);
      const band = { y: y0 + D.frontY + 26, h: 40 };
      if (next && y0 === fl.tierTops.at(-1)) {
        // The band reaches into the next floor's surround: no span may cross it.
        assert.ok(band.y + band.h > next.surround.y, "the cutaway would reach the next arch");
        for (const [a, b] of spans) assert.ok(b <= next.surround.x + 2 || a >= next.surround.x + next.surround.w - 2, `a span ${a}..${b} crosses the arch`);
      } else assert.equal(spans.length, 1);
    }
  });
});

test("no labels or icons on projects and workspaces; links run through each project's junction to each alcove's top", () => {
  const layout = layoutDungeon(DUNGEON_SAMPLE, 1.4);
  for (const p of layout.projects) {
    assert.equal(p.icon, undefined, `${p.name} carries no icon`);
    // Its junction is a node on a link (the tier's bus), and nothing rises from it to a medallion.
    assert.ok(layout.nodes.some((n) => n.x === p.node.x && n.y === p.node.y), `${p.name}'s junction is a node`);
    assert.ok(layout.links.some((l) => l.length >= 2 && l.some((q) => q.y === p.node.y)), `a link runs along ${p.name}'s bus`);
    assert.ok(!layout.links.some((l) => l.some((q) => q.x === p.node.x && q.y < p.node.y - 1)), `no link rises from ${p.name}'s junction`);
    // Its pick box is its terrace's back wall: above its alcoves, within its span, wide enough to hover.
    const alcoves = layout.workspaces.filter((w) => w.project === p.key);
    assert.ok(alcoves.every((w) => p.rect.y + p.rect.h <= w.rect.y + 0.01 && !overlaps(p.rect, w.rect)), `${p.name}'s box stays above its alcoves`);
    assert.ok(p.rect.x >= p.span.x && p.rect.x + p.rect.w <= p.span.x + p.span.w && p.rect.w > 80, `${p.name}'s box is its terrace`);
  }
  for (const w of layout.workspaces) {
    const cx = w.rect.x + w.rect.w / 2;
    assert.ok(layout.links.some((l) => l.some((q) => Math.abs(q.x - cx) < 0.01 && Math.abs(q.y - w.rect.y) < 0.01)), `a link reaches ${w.entity.name}'s alcove`);
  }
});
