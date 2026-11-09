import test from "node:test";
import assert from "node:assert/strict";
import { layoutDungeon, overlaps, approxMeasure, CLOTHS, hudSubtitle, dungeonNow, projectIcon, robotColor, cutawaySpans, D } from "../src/dungeon/layout.ts";
import { dungeonThresholds } from "../src/dungeon/thresholds.ts";
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
    ...layout.vault.map((t) => ({ what: `vault ${t.id}`, rect: t.rect })),
    ...(layout.vaultSigns ?? []).map((v) => ({ what: `vault board ${v.label}`, rect: v.rect })),
  ];
  for (let i = 0; i < things.length; i++)
    for (let j = i + 1; j < things.length; j++) {
      const a = things[i], b = things[j];
      // Robots stand in their own alcove.
      if (a.what.startsWith("alcove") && b.what.startsWith("robot")) continue;
      assert.ok(!overlaps(a.rect, b.rect), `${a.what} overlaps ${b.what}`);
    }
  // The hosts carry their plaques and the projects their name boards (the user's call); PR medallions sit on their alcove's lintel.
  const labels = [...layout.floors.map((f) => f.plaque), ...layout.projects.map((p) => p.sign)];
  for (const p of layout.projects) {
    assert.ok(p.label.length > 0, `${p.name}'s board names it`);
    // Over its valance: between its piers, hanging from its lintel, its bottom above its alcoves' lintels and medallions.
    const { sign, hall } = p;
    assert.ok(sign.x >= hall.x + D.hallPier && sign.x + sign.w <= hall.x + hall.w - D.hallPier, `${p.name}'s board is between its piers`);
    assert.ok(sign.y >= hall.y && sign.y <= hall.y + D.lintelH, `${p.name}'s board hangs from its lintel`);
    assert.ok(Math.abs(sign.x + sign.w / 2 - (hall.x + hall.w / 2)) < 0.5, `${p.name}'s board is centred on its hall`);
    for (const w of layout.workspaces.filter((w) => w.project === p.key)) {
      assert.ok(sign.y + sign.h <= w.rect.y + 0.01, `${p.name}'s board stays above ${w.entity.name}'s alcove`);
      for (const f of w.flags) assert.ok(sign.y + sign.h < f.y - f.size / 2, `${p.name}'s board clears ${w.entity.name}'s medallions`);
    }
    for (const a of layout.agents) assert.ok(!overlaps(sign, a.rect), `${p.name}'s board clears ${a.entity.id}`);
  }
  for (const w of layout.workspaces) {
    assert.equal(w.label, undefined, "a workspace carries no label");
    for (const f of w.flags) assert.ok(f.x >= w.rect.x && f.x <= w.rect.x + w.rect.w && f.y >= w.rect.y && f.y <= w.rect.y + 30, "a PR medallion sits on its alcove's lintel");
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
    assert.equal(layout.projects.filter((p) => p.floor === layout.floors.indexOf(f)).length, 2);
  }
  const { hosts, projects, workspaces, agents } = layout.counts;
  assert.deepEqual({ hosts, projects, workspaces, agents }, { hosts: 3, projects: 6, workspaces: 11, agents: 27 });
  assert.equal(layout.floors[0].stats.map((s) => s.text).join(" · "), "CPU 42% · MEM 58% · DISK 70%");
  // Wider bays leave breathing room between robots while retaining the board's bounded aspect.
  assert.ok(layout.bounds.w > 1100 && layout.bounds.w < 1900, `width ${layout.bounds.w}`);
  assert.ok(layout.bounds.h > 1050 && layout.bounds.h < 1450, `height ${layout.bounds.h}`);
  // Projects still wrap before the board becomes wider than its target aspect.
  assert.ok(layout.bounds.w / layout.bounds.h <= 1.6, `aspect ${layout.bounds.w / layout.bounds.h}`);
  for (const f of layout.floors) assert.equal(f.rect.h, f.last ? D.band + D.tierH + D.foot + D.footPad : D.band + D.tierH);
  // The first project stands left of the gate, the second right.
  const local = layout.projects.filter((p) => p.floor === 0);
  assert.ok(local[0].mark.x < 0 && local[1].mark.x > 0);
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

test("no icons or links: a project is its terrace, picked by its wall above its alcoves", () => {
  const layout = layoutDungeon(DUNGEON_SAMPLE, 1.4);
  // The user removed the gold pipes: the layout has no links, nodes or runs.
  assert.equal(layout.links, undefined);
  assert.equal(layout.nodes, undefined);
  assert.equal(layout.runs, undefined);
  for (const p of layout.projects) {
    assert.equal(p.icon, undefined, `${p.name} carries no icon`);
    assert.equal(p.node, undefined, `${p.name} has no junction`);
    // Its pick box is its terrace's back wall: above its alcoves, within its span, wide enough to hover.
    const alcoves = layout.workspaces.filter((w) => w.project === p.key);
    assert.ok(alcoves.every((w) => p.rect.y + p.rect.h <= w.rect.y + 0.01 && !overlaps(p.rect, w.rect)), `${p.name}'s box stays above its alcoves`);
    assert.ok(p.rect.x >= p.span.x && p.rect.x + p.rect.w <= p.span.x + p.span.w && p.rect.w > 80, `${p.name}'s box is its terrace`);
  }
});

test("a project's name board: in capitals, as wide as its name needs, a long name cut short to fit its hall", () => {
  const data = big(1, 2, 1, 1);
  data.projects[0].name = "api";
  data.projects[1].name = "a-very-long-project-name-that-cannot-possibly-fit-over-one-alcove";
  const layout = layoutDungeon(data, 1.4);
  const [short, long] = data.projects.map((d) => layout.projects.find((p) => p.key === d.key));
  assert.equal(short.label, "API");
  assert.equal(short.sign.w, D.projectSignMin);
  assert.ok(long.label.endsWith("…") && long.label.length < data.projects[1].name.length, "the long name is cut short");
  assert.ok(approxMeasure(long.label, "project") + 2 * D.projectSignPad <= long.sign.w + 0.5, "what's left fits its board");
  assert.ok(long.sign.w > short.sign.w);
  assertLegible(layout);
});

test("PR medallions: larger, in one row centred on their alcove's lintel bricks, clear of each other", () => {
  for (const layout of [layoutDungeon(DUNGEON_SAMPLE, 1.4), layoutDungeon(big(2, 3, 4, 2), 1.4)]) {
    let seen = 0;
    for (const w of layout.workspaces) {
      if (!w.flags.length) continue;
      seen++;
      const xs = w.flags.map((f) => f.x);
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      assert.ok(Math.abs(mid - (w.rect.x + w.rect.w / 2)) < 0.01, `${w.entity.id}'s medallions are centred on its lintel`);
      for (const f of w.flags) {
        assert.equal(f.size, D.flag);
        assert.equal(f.y, w.rect.y + D.lintelY, "in the middle of the lintel's bricks");
        // Within the brick band between its returns.
        assert.ok(f.x - f.size / 2 >= w.rect.x + 20 && f.x + f.size / 2 <= w.rect.x + w.rect.w - 20, `${w.entity.id}'s ${f.flag} is on its bricks`);
      }
      for (let i = 1; i < w.flags.length; i++) assert.ok(w.flags[i].x - w.flags[i - 1].x >= D.flag, "neighbours don't overlap");
    }
    assert.ok(seen > 0);
  }
});

test("each project's hall encloses its alcove row (1 to 8 alcoves), clear of its neighbours", () => {
  for (let n = 1; n <= 8; n++) {
    const layout = layoutDungeon(big(1, 3, n, 2), 1.4);
    for (const p of layout.projects) {
      const own = layout.workspaces.filter((w) => w.project === p.key);
      assert.equal(own.length, n);
      for (const w of own) {
        // Inside its hall, between its piers, below its lintel, above its floor strip.
        assert.ok(w.rect.x >= p.hall.x + D.hallPier - 0.01 && w.rect.x + w.rect.w <= p.hall.x + p.hall.w - D.hallPier + 0.01, `${n}: ${w.entity.name} between ${p.name}'s piers`);
        assert.ok(w.rect.y >= p.hall.y + D.lintelH && w.rect.y + w.rect.h <= p.hall.y + p.hall.h - D.hallFloorH + 0.01, `${n}: ${w.entity.name} under the lintel, above the floor`);
      }
      for (const q of layout.projects) if (q !== p && q.floor === p.floor) assert.ok(!overlaps(p.hall, q.hall), `${n}: ${p.name}'s hall overlaps ${q.name}'s`);
      // Its robots stand clear of its piers.
      for (const a of layout.agents.filter((a) => own.some((w) => w.entity.id === a.entity.workspace)))
        assert.ok(a.rect.x >= p.hall.x + D.hallPier - 4 && a.rect.x + a.rect.w <= p.hall.x + p.hall.w - D.hallPier + 4);
    }
    assertLegible(layout);
  }
});

test("project cloths: from the project, never shared by neighbours on a tier, the same each time", () => {
  for (const layout of [layoutDungeon(DUNGEON_SAMPLE, 1.4), layoutDungeon(big(2, 6, 2, 1), 1.4), layoutDungeon(big(1, 8, 1, 1), 2)]) {
    const rows = new Map();
    for (const p of layout.projects) rows.set(`${p.floor}:${p.tier}`, [...(rows.get(`${p.floor}:${p.tier}`) ?? []), p]);
    for (const row of rows.values()) {
      row.sort((a, b) => a.hall.x - b.hall.x);
      for (let i = 1; i < row.length; i++) assert.notEqual(row[i].cloth, row[i - 1].cloth, `${row[i].name} and ${row[i - 1].name} share ${row[i].cloth}`);
    }
    for (const p of layout.projects) assert.ok(CLOTHS.includes(p.cloth));
  }
  // The same fleet, the same colours.
  const a = layoutDungeon(DUNGEON_SAMPLE, 1.4), b = layoutDungeon(structuredClone(DUNGEON_SAMPLE), 1.4);
  assert.deepEqual(a.projects.map((p) => p.cloth), b.projects.map((p) => p.cloth));
});

/** The dashboard counts for the concept: PRs 7/3/1/1, issues 11/8/7/2. */
const DASHBOARD = {
  prs: { state: "ok", counts: { merged: 7, review: 3, draft: 1, conflicts: 1 }, items: { merged: [{ title: "Ship it", repo: "acme/core", number: 12, url: "https://github.com/acme/core/pull/12" }] }, atLeast: [] },
  issues: { state: "ok", counts: { done: 11, inProgress: 8, todo: 7, blocked: 2 }, items: {}, atLeast: ["done"] },
};

test("integration counts do not add a duplicate dashboard to the upper wall", () => {
  const layout=layoutDungeon({...DUNGEON_SAMPLE,dashboard:DASHBOARD},1.4);
  assert.deepEqual(layout.vault,[]);assert.deepEqual(layout.vaultSigns,[]);
  assertLegible(layout);
});

test("dashboard source counts: your PRs and issues by group (unknown while off), workspaces and agents", () => {
  const { counts } = layoutDungeon({ ...DUNGEON_SAMPLE, dashboard: DASHBOARD }, 1.4);
  assert.deepEqual([counts.prs.known, counts.prs.total, counts.prs.by], [true, 12, { merged: 7, review: 3, draft: 1, conflicts: 1 }]);
  assert.deepEqual([counts.issues.total, counts.issues.atLeast], [28, ["done"]]);
  assert.equal(counts.running + counts.idle + counts.needYou + counts.unread + counts.failed + counts.offline, counts.agents);
  assert.ok(counts.active > 0 && counts.active <= counts.workspaces);
  const off = layoutDungeon({ ...DUNGEON_SAMPLE, dashboard: { prs: { state: "off", message: "Enable GitHub in Settings to use GitHub." }, issues: null } }, 1.4).counts;
  assert.deepEqual([off.prs.known, off.prs.why, off.issues.known], [false, "Enable GitHub in Settings to use GitHub.", false]);
  // Integration availability and counts never change the world’s geometry.
  const a = layoutDungeon({ ...DUNGEON_SAMPLE, dashboard: DASHBOARD }, 1.4);
  const b = layoutDungeon({ ...DUNGEON_SAMPLE, dashboard: { ...DASHBOARD, prs: { ...DASHBOARD.prs, counts: { merged: 8, review: 3, draft: 1, conflicts: 1 } } } }, 1.4);
  const c = layoutDungeon({ ...DUNGEON_SAMPLE, dashboard: { ...DASHBOARD, prs: null } }, 1.4);
  assert.equal(a.signature, b.signature);
  assert.equal(a.signature, c.signature);
});

test("robots leave visible room between neighbours in every workspace", () => {
  const layout = layoutDungeon(big(1, 2, 2, 6));
  for (const w of layout.workspaces) {
    const agents = layout.agents.filter((a) => a.entity.workspace === w.entity.id).sort((a, b) => a.feet.x - b.feet.x);
    for (let i = 1; i < agents.length; i++) {
      const left = agents[i - 1], right = agents[i];
      const width = (a) => { const f = FRAMES[`robot-${a.robot}-idle-0`]; return D.robotH * f.w / f.h; };
      assert.ok(right.feet.x - left.feet.x - (width(left) + width(right)) / 2 >= 14, "at least 14 px between visible robot bodies");
    }
  }
});

test("Now prioritizes attention and keeps unread replies distinct from idle agents", () => {
  const c = layoutDungeon(DUNGEON_SAMPLE).counts;
  const now = dungeonNow({ ...c, needYou: 2, unread: 3, failed: 1, running: 4, idle: 20, offline: 5 });
  assert.deepEqual(now.map(({ label, n }) => [label, n]), [["waiting", 2], ["unread", 3], ["failed", 1], ["running", 4], ["offline", 5]]);
  assert.deepEqual(dungeonNow({ ...c, needYou: 0, unread: 0, failed: 0, running: 0, idle: 2, offline: 0 }).map(({ label, n }) => [label, n]), [["running", 0], ["idle", 2]]);
});


test("brass thresholds follow hall and workspace ledges, independently of project pick boxes", () => {
  for (const data of [DUNGEON_SAMPLE, big(2, 3, 5, 4)]) {
    const l = layoutDungeon(data, 1.4);
    const thresholds = dungeonThresholds(l);
    assert.equal(thresholds.length, l.projects.filter((p) => p.entity).length + l.workspaces.length);
    for (const p of l.projects.filter((p) => p.entity)) {
      const t = thresholds.find((t) => t.id === p.entity.id);
      assert.equal(t.y, p.hall.y + p.hall.h - 5);
      assert.equal(t.w, p.hall.w - 14);
      assert.ok(t.badge.x > p.sign.x && t.badge.x < p.sign.x + D.projectSignPad);
      for (const w of l.workspaces.filter((w) => w.project === p.key)) {
        const a = thresholds.find((t) => t.id === w.entity.id);
        assert.ok(a.x > t.x && a.x + a.w < t.x + t.w, "each alcove fits inside its project's marker");
        assert.ok(a.y < t.y, "workspace and project thresholds occupy different ledges");
      }
    }
    for (const w of l.workspaces) {
      const t = thresholds.find((t) => t.id === w.entity.id);
      assert.equal(t.w, w.rect.w - 2 * D.alcoveSide);
      assert.equal(t.y, w.rect.y + w.rect.h - 5);
      assert.equal(t.badge, undefined);
    }
  }
});
