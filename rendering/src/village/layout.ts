/**
 * The Village's deterministic layout: a warm 3/4 top-down village square per
 * host (in the Atlas's host order), squares tiled to fit the map's shape. The
 * host is the square's crystal fountain at the heart of a cobbled plaza, with
 * its plaque (name, status, load) beneath it. Each project with workspaces is
 * a building facing the viewer round the plaza (upper left, upper right, lower
 * left, lower right, then further out and further up or down), its banner
 * (the project's icon) over the roof and its name on a parchment plaque; each
 * workspace one arched bay along its front holding a status tile from its
 * pull request, its name on the plate below; and each agent a round robot on
 * the building's lit porch, in front of its workspace's bay, oldest first.
 * Paths join the plaza to every row; trees, blossoms, walls, a river, a
 * waterfall and a bridge are seeded per host and never cover what the
 * village says.
 *
 * Units are the concept's pixels (y down; each square in its own place). Pure: no DOM.
 */
import {
  agentEntity,
  hostGroups,
  modelColor,
  random,
  seedOf,
  sortedHosts,
  tileState,
  type AtlasData,
  type Cottage,
  type Entity,
  type State,
} from "../world.ts";
import { BEACON_STATES } from "../placement.ts";
import { probeGlyph } from "../probe.ts";
import { projectIcon } from "../dungeon/layout.ts";
import { BUILDINGS, FRAMES, anchorShare, type Icon, type TileKind } from "./frames.ts";

export { projectIcon };
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Village geometry, in the concept's pixels (a block's measures from its building's feet, `base`). */
export const V = {
  /** Robots: their visible height, and the pitch they stand at on a porch. */
  robotH: 122,
  pitch: 106,
  /** A building's natural width; it widens (its height keeping its shape) for bays holding several robots, to `buildingMax`. */
  building: 585,
  buildingMax: 900,
  /** The painted arches' pitch as a share of the building's width, and their middle's offset from its centre. */
  archPitch: 0.19,
  /** The plaque's middle, down from the building's top, as a share of its height. */
  plaqueAt: 0.43,
  plaqueH: 76,
  plaqueMin: 300,
  plaqueMax: 470,
  /** The banner's width as a share of the building's, hanging this far above its top. */
  banner: 0.3,
  bannerLift: 54,
  /** The tile frame stands up in its arch, its foot this far above the building's (robots' heads below it). */
  frameFeet: -82,
  frameW: 0.84,
  plateH: 26,
  /** The porch: a shallow stone ledge along the hall's front (about a third of a robot's height deep), and the robots'
   * feet on it; a hall without agents has only its foundation steps (`steps` deep). */
  porchY: -2,
  porchH: 50,
  feetY: 46,
  steps: 24,
  /** Between blocks in a row, and between rows (a cobbled walk). */
  blockGap: 34,
  band: 70,
  /** Between the first upper row's porches and the first lower row's banners. */
  plazaGap: 24,
  fountainW: 286,
  ringW: 344,
  hostPlaqueH: 64,
  hostPlaqueMin: 190,
  /** The central road's width and a walk's depth; blocks start `inner` either side of the middle (the first lower row clear of the fountain). */
  road: 180,
  walk: 86,
  pond: 380,
  inner: 100,
  /** Margins round a square: woods above and to the left (the HUD lies there), the river to the right; the foot's
   * moat, wall and bridge below the last walk. */
  marginTop: 70,
  marginLeft: 300,
  marginRight: 420,
  riverW: 330,
  moatH: 124,
  wallH: 92,
  marginBottom: 470,
  /** Type (village px): workspace plates, project plaques, the host plaque's name and stats line. */
  font: { workspace: 19, project: 38, host: 27, stats: 16 },
  labelPad: 26,
  /** A PR medallion on a tile frame's upper corners. */
  flag: 17,
};

export type TextKind = keyof typeof V.font;
/** Text width in village px for a kind's type; the bridge measures with the real font. */
export type Measure = (text: string, kind: TextKind) => number;
export const approxMeasure: Measure = (text, kind) => text.length * V.font[kind] * (kind === "stats" ? 0.56 : 0.54);

export type VSquare = {
  host: Entity;
  online: boolean;
  /** The whole square, margins included. */
  rect: Rect;
  /** The plaza's centre (the fountain's middle). */
  center: Pt;
  fountain: Rect;
  ring: Rect;
  plaque: Rect;
  /** The plaque's text: the host's name (offline says so) and its load. */
  title: string;
  stats: { text: string; alert: boolean }[];
  /** Cobbled roads (with organic edges): north from the square's edge, the walks in front of each row's
   * porches, south to the bridge; and the round plaza's paving under the fountain's ring. */
  roads: Rect[];
  plaza: Rect;
  /** Lamps along the central road and flanking the fountain (feet), lit while any of the square's agents runs. */
  lamps: Pt[];
  /** Lanterns on the bridge's posts (feet), lit as the lamps are. */
  bridgeLamps: Pt[];
  /** Lamp posts with banners either side of the fountain (feet): their lamps lit while the square's agents run. */
  pennants: Pt[];
  /** The river down the right margin (banks included), falling from a cliff at its head (top, repeated middle, foot). */
  river: Rect;
  waterfall: Rect;
  cliff: { top: Rect; mid: Rect; foot: Rect };
  /** What the camera's fit frames: the concept's crop round the square; and what it must always show (halls, plaza, bridge). */
  heart: Rect;
  keep: Rect;
  /** The foot: the moat's water either side of the bridge, the wall across the whole width broken for it, its towers. */
  moat: Rect[];
  bridge: Rect;
  walls: Rect[];
  towers: Pt[];
};
export type VProject = {
  key: string;
  host: string;
  entity?: Entity;
  name: string;
  icon: Icon;
  /** Its building's frame. */
  building: string;
  square: number;
  /** The whole block: banner to porch. */
  block: Rect;
  /** The building, standing on `base`. */
  body: Rect;
  base: number;
  banner: Rect;
  plaque: Rect;
  porch: Rect;
  /** A ledge porch for its robots (else `porch` is its foundation steps). */
  ledge: boolean;
  /** Its two lamps (feet), lit while any of its agents runs. */
  lamps: Pt[];
  /** Banner and building, for picking and the selection rim. */
  rect: Rect;
  stale: boolean;
};
export type VFlag = { workspace: string; flag: string; frame: string; x: number; y: number; size: number };
export type VWorkspace = {
  entity: Entity;
  project: string;
  square: number;
  /** The bay (its arch, tile frame and plate), for picking. */
  rect: Rect;
  /** A free-standing arch, for a bay beyond its building's four. */
  arch?: Rect;
  /** The tile frame (its window holds the tile, its foot the plate). */
  frame: Rect;
  tile: TileKind;
  tileAt: Pt;
  tileSize: number;
  plate: Rect;
  flags: VFlag[];
  seal?: { x: number; y: number; size: number };
  /** Agents' keys, oldest first. */
  agents: string[];
};
export type VAgent = {
  entity: Entity;
  feet: Pt;
  rect: Rect;
  square: number;
  /** Its robot's colour on the robots sheet: Claude's orange, ChatGPT's white, any other provider its own. */
  robot: string;
  /** Its running subagents' drones' colours, oldest first. */
  drones: string[];
};
export type VDecor = {
  frame: string;
  x: number;
  y: number;
  rect: Rect;
  square: number;
  flip?: boolean;
  /** A light it gives, from its top by `dy` (else its middle). */
  light?: { color: number; reach: number; dy?: number };
  /** Drawn on the ground (under everything standing) or standing (sorted by its feet). */
  layer: "ground" | "stand";
};
export type VillageLayout = {
  bounds: Rect;
  /** The heart the camera's fit frames: every square's halls, fountain, foot and river, without the woods round them. */
  core: Rect;
  /** Within the crop, what the fit never cuts. */
  keep: Rect;
  squares: VSquare[];
  projects: VProject[];
  workspaces: VWorkspace[];
  agents: VAgent[];
  decor: VDecor[];
  entities: Entity[];
  counts: VillageCounts;
  /** Changes whenever anything's place changes. */
  signature: string;
};
export type VillageCounts = {
  hosts: number;
  hostsOffline: number;
  projects: number;
  prs: number;
  pr: Record<Exclude<TileKind, "none">, number>;
  workspaces: number;
  /** Workspaces with an agent at work. */
  active: number;
  agents: number;
  running: number;
  idle: number;
  needYou: number;
  /** Finished with a reply you haven't read. */
  unread: number;
  failed: number;
  offline: number;
};

/** A workspace's status tile from its PR's labels: failing (CI failing, conflicts), draft (changes asked),
 * review (awaiting review or CI running), merged (approved, or CI green), none (no PR labels). */
export function tileOf(c: Pick<Cottage, "flags">): TileKind {
  const f = c.flags;
  if (!f || (!f.ci && !f.review)) return "none";
  if (f.ci === "ci-failing" || f.review === "conflicts") return "failing";
  if (f.review === "review-changes") return "draft";
  if (f.review === "review-awaiting" || f.ci === "ci-running") return "review";
  return "merged";
}
/** What each tile says, for the HUD and hover cards. */
export const TILE_NAMES: Record<TileKind, string> = {
  merged: "Ready",
  review: "In review",
  draft: "Changes asked",
  failing: "Failing",
  none: "No pull request",
};

/** Other providers' robot colours on the Village's robots sheet. */
const OTHER_ROBOTS = ["green", "blue", "cyan", "purple", "pink", "yellow"];
/** A robot's colour for its provider/model: Claude orange, ChatGPT white, and any other
 * provider a stable colour of its own (by the provider's name, so its models share it). */
export function robotColor(model: string): string {
  const atlas = modelColor(model);
  if (atlas === "orange" || atlas === "white") return atlas;
  const provider = (model.split("/")[0] || model).toLowerCase();
  return OTHER_ROBOTS[seedOf(provider) % OTHER_ROBOTS.length]!;
}

/** The states that need you, as the app's own count has them (an approval or a question waiting on you). */
export const NEEDS_YOU: State[] = ["approval", "question", "asking"];
/** The marker over a robot's head. */
export const STATE_MARK: Partial<Record<State, string>> = {
  approval: "mark-approval",
  question: "mark-question",
  asking: "mark-asking",
  failed: "mark-failure",
  done: "mark-done",
};

export const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const union = (rs: Rect[]): Rect => {
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** A frame's box with its anchor at (x, y), `w` wide (its height keeping its shape). */
export function boxOf(frame: string, x: number, y: number, w?: number): Rect {
  const base = FRAMES[frame] ?? FRAMES[`${frame}-0`]!;
  const width = w ?? base.w;
  const h = (base.h * width) / base.w;
  const a = anchorShare(base.anchor);
  return { x: x - a.x * width, y: y - a.y * h, w: width, h };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Block = {
  key: string;
  project?: AtlasData["projects"][number];
  cottages: Cottage[];
  building: string;
  /** Drawn width and height of its building. */
  w: number;
  h: number;
  /** The bays' pitch (its arches'), and each bay's slot on that lattice (0–3 are the building's own arches). */
  pitch: number;
  slots: number[];
  plaqueW: number;
  /** Its whole width, and its reach above and below its building's feet. */
  width: number;
  above: number;
  below: number;
};

function blockOf(group: ReturnType<typeof hostGroups>[number], building: string, measure: Measure): Block {
  // A building keeps its natural size until its porch can't hold its robots side by side.
  const robots = group.cottages.reduce((n, c) => n + c.agents.length, 0);
  const w = clamp((robots * V.pitch) / 0.86, V.building, V.buildingMax);
  const pitch = w * V.archPitch;
  const spec = FRAMES[building]!;
  const h = (spec.h * w) / spec.w;
  const n = group.cottages.length;
  // Oldest first, left to right: the building's own four arches, centred; more than four spill out either side under arches of their own.
  const start = n <= 4 ? Math.floor((4 - n) / 2) : -Math.floor((n - 4) / 2);
  const slots = group.cottages.map((_, i) => start + i);
  const span = (Math.max(3, slots[slots.length - 1] ?? 3) - Math.min(0, slots[0] ?? 0) + 1) * pitch;
  const name = group.project?.name ?? "No project";
  const plaqueW = clamp(Math.ceil(measure(name, "project") + V.labelPad * 2), V.plaqueMin, Math.min(V.plaqueMax, w * 0.8));
  return {
    key: group.key,
    project: group.project,
    cottages: group.cottages,
    building,
    w,
    h,
    pitch,
    slots,
    plaqueW,
    width: Math.max(w, span + 40) + 12,
    above: h + V.bannerLift + 8,
    below: V.porchY + V.porchH,
  };
}

/** Positions as near as they can be to those wanted (in order), each at least `gap` from the last. */
export function spread(wanted: number[], gap: number): number[] {
  // Clusters of touching positions move together, each to its members' mean wish. A cluster keeps the sum
  // of its members' wishes less their offsets from its first member, so its first member's place is its mean.
  const clusters: { n: number; sum: number }[] = [];
  for (const x of wanted) {
    clusters.push({ n: 1, sum: x });
    for (;;) {
      const c = clusters[clusters.length - 1]!, p = clusters[clusters.length - 2];
      if (!p || c.sum / c.n >= p.sum / p.n + p.n * gap - 1e-9) break;
      clusters.pop();
      p.sum += c.sum - gap * p.n * c.n;
      p.n += c.n;
    }
  }
  return clusters.flatMap((c) => Array.from({ length: c.n }, (_, k) => c.sum / c.n + k * gap));
}

/** Rows of blocks either side of the north–south path, above and below the plaza. */
type Slot = { block: Block; side: -1 | 1; half: -1 | 1; row: number };
type Arranged = { rows: number; slots: Slot[] };
function arrange(blocks: Block[], perRow: number): Arranged {
  // Innermost first: the plaza's four corners, then outward along the first rows, then the next rows out.
  const slots: Slot[] = blocks.map((block, i) => {
    const q = i % 4, k = Math.floor(i / 4);
    return { block, half: q < 2 ? -1 : 1, side: q % 2 === 0 ? -1 : 1, row: Math.floor(k / perRow) };
  });
  return { rows: Math.max(1, ...slots.map((s) => s.row + 1)), slots };
}
const rowOf = (a: Arranged, half: -1 | 1, row: number, side?: -1 | 1) => a.slots.filter((s) => s.half === half && s.row === row && (side === undefined || s.side === side));

/** The gap either side of the middle a row keeps: the first lower row's room for the fountain and the host's plaque. */
const innerOf = (half: -1 | 1, row: number, plaqueW: number) => (half === 1 && row === 0 ? Math.max(V.inner, V.ringW / 2 + 6, plaqueW / 2 + 24) : V.inner);

/** The reach above its feet of the outermost upper row's tallest hall (its banner). */
const maxAbove = (a: Arranged) => Math.max(0, ...rowOf(a, -1, a.rows - 1).map((s) => s.block.above));

/** A block's left edge in its row. */
function blockX(s: Slot, cx: number, plaqueW: number, a: Arranged) {
  const before = rowOf(a, s.half, s.row, s.side).filter((o) => a.slots.indexOf(o) < a.slots.indexOf(s));
  const offset = innerOf(s.half, s.row, plaqueW) + before.reduce((sum, o) => sum + o.block.width + V.blockGap, 0);
  return s.side === 1 ? cx + offset : cx - offset - s.block.width;
}

type Plan = { width: number; height: number; build: (ox: number, oy: number, index: number) => void };

/**
 * Lay the fleet out as the Village. `aspect` is the map's width over its height:
 * each square's rows, and the grid of squares, are chosen to suit it; `measure`
 * gives label text widths (the bridge's real font).
 */
export function layoutVillage(data: AtlasData, aspect = 1.6, measure: Measure = approxMeasure): VillageLayout {
  const planned = sortedHosts(data).map((host) => ({ host, groups: hostGroups(host, data) }));
  // Hosts without workspaces stay out of the village, unless none has any: then each shows as an empty square.
  const shown = planned.some((h) => h.groups.length) ? planned.filter((h) => h.groups.length) : planned;
  const agentRows = new Map(data.agents.map((a) => [a.key, a]));

  const squares: VSquare[] = [];
  const projects: VProject[] = [];
  const workspaces: VWorkspace[] = [];
  const agents: VAgent[] = [];
  const hostEntities: Entity[] = [];

  const plans: Plan[] = shown.map(({ host, groups }) => {
    // Buildings dealt so neighbours in a square differ: seeded by the project, stepping past ones already shown.
    const used: string[] = [];
    const start = seedOf(host.key + "village") % BUILDINGS.length;
    const blocks = groups.map((g) => {
      let v = (start + seedOf(g.key)) % BUILDINGS.length;
      for (let k = 0; k < BUILDINGS.length && used.includes(BUILDINGS[v]!); k++) v = (v + 1) % BUILDINGS.length;
      used.push(BUILDINGS[v]!);
      if (used.length >= BUILDINGS.length) used.length = 0;
      return blockOf(g, BUILDINGS[v]!, measure);
    });
    const { title, stats, plaqueW } = hostPlaque(host);
    // Blocks per row on each side: the square nearest the map's shape (a square's own aim is a little wider than tall).
    let best: { a: Arranged; score: number } | null = null;
    for (let perRow = 1; perRow <= Math.max(1, Math.ceil(blocks.length / 4)); perRow++) {
      const a = arrange(blocks, perRow);
      const { w, h } = measureSquare(a, plaqueW);
      const score = Math.abs(Math.log(w / h / clamp(aspect, 1, 2)));
      if (!best || score < best.score - 1e-9) best = { a, score };
    }
    const a = best!.a;
    const m = measureSquare(a, plaqueW);
    return { width: m.w, height: m.h, build: (ox, oy, index) => buildSquare(host, a, title, stats, plaqueW, ox, oy, index) };
  });

  function hostPlaque(host: AtlasData["hosts"][number]) {
    const title = host.name.toUpperCase() + (host.online ? "" : " · OFFLINE");
    const stats = host.online && host.stats
      ? (
          [
            ["CPU", host.stats.cpu],
            ["MEM", host.stats.memory],
            ["DISK", host.stats.disk],
          ] as const
        ).flatMap(([n, v]) => (v === undefined ? [] : [{ text: `${n} ${Math.round(v)}%`, alert: v >= 90 }]))
      : [];
    const plaqueW = Math.max(V.hostPlaqueMin, Math.ceil(measure(title, "host") + 80), Math.ceil(measure(stats.map((s) => s.text).join(" · "), "stats") + 90));
    return { title, stats, plaqueW };
  }

  /** Each row's reach above and below its buildings' feet; the rows' feet, top to bottom; the sides' widths. */
  function measureSquare(a: Arranged, plaqueW: number) {
    const reach = (half: -1 | 1, row: number) => {
      const bs = rowOf(a, half, row).map((s) => s.block);
      return { above: Math.max(300, ...bs.map((b) => b.above)), below: Math.max(V.steps, ...bs.map((b) => b.below)) };
    };
    const sideW = (side: -1 | 1) =>
      Math.max(
        300,
        ...([-1, 1] as const).flatMap((half) =>
          Array.from({ length: a.rows }, (_, row) => innerOf(half, row, plaqueW) + rowOf(a, half, row, side).reduce((sum, s) => sum + s.block.width + V.blockGap, -V.blockGap)),
        ),
      );
    // Feet of each row: upper rows from the outermost down, then the lower rows.
    const feet: { half: -1 | 1; row: number; base: number }[] = [];
    let y = V.marginTop;
    for (let row = a.rows - 1; row >= 0; row--) {
      const r = reach(-1, row);
      feet.push({ half: -1, row, base: y + r.above });
      y += r.above + r.below + (row === 0 ? V.plazaGap : V.band);
    }
    const plazaTop = y - V.plazaGap;
    for (let row = 0; row < a.rows; row++) {
      const r = reach(1, row);
      feet.push({ half: 1, row, base: y + r.above });
      y += r.above + r.below + V.band;
    }
    const left = sideW(-1), right = sideW(1);
    return { w: V.marginLeft + left + right + V.marginRight, h: y - V.band + V.marginBottom, left, right, feet, plazaTop, footY: y - V.band };
  }

  function buildSquare(host: AtlasData["hosts"][number], a: Arranged, title: string, stats: VSquare["stats"], plaqueW: number, ox: number, oy: number, index: number) {
    const m = measureSquare(a, plaqueW);
    const cx = ox + V.marginLeft + m.left;
    const baseOf = (half: -1 | 1, row: number) => oy + m.feet.find((f) => f.half === half && f.row === row)!.base;
    const online = host.online;
    const entity: Entity = {
      id: host.key,
      kind: "host",
      name: host.name,
      host: host.key,
      position: { q: 0, r: 0 },
      stale: !online,
      ...(host.stats ? { stats: host.stats } : {}),
    };
    hostEntities.push(entity);
    // The fountain stands in the middle of the first lower row, its plaque at its foot.
    // The fountain dead centre of the four halls: its ring just below the upper row's fronts, between the lower row's halls;
    // the host's plaque small on the ring's front step.
    const upFront = baseOf(-1, 0) + Math.max(V.steps, ...rowOf(a, -1, 0).map((sl) => sl.block.below));
    const ringH = (FRAMES["plaza-ring"]!.h * V.ringW) / FRAMES["plaza-ring"]!.w;
    const ringC = upFront + V.plazaGap + ringH / 2;
    const ring = boxOf("plaza-ring", cx, ringC, V.ringW);
    ring.x = cx - V.ringW / 2;
    ring.y = ringC - ringH / 2;
    const fountain = boxOf("fountain-on", cx, ringC + ringH * 0.2, V.fountainW);
    const plaque = { x: cx - plaqueW / 2, y: ring.y + ring.h - V.hostPlaqueH * 0.8, w: plaqueW, h: V.hostPlaqueH };
    const rect = { x: ox, y: oy, w: m.w, h: m.h };
    const topBase = baseOf(-1, a.rows - 1);
    const footY = oy + m.footY;
    const half = V.road / 2;
    // The plaza: one paved square under the halls, from behind the upper row to past the last row's porches, its outer
    // edge organic; the round paving under the fountain's ring; a wide road north to the edge and south to the bridge.
    const xs = a.slots.flatMap((sl) => [blockX(sl, cx, plaqueW, a), blockX(sl, cx, plaqueW, a) + sl.block.width]);
    const px0 = Math.min(cx - V.ringW / 2, ...xs) - 26, px1 = Math.max(cx + V.ringW / 2, ...xs) + 26;
    const pave = { x: px0, y: topBase - 170, w: px1 - px0, h: footY + 60 - (topBase - 170) };
    const plaza = { x: cx - V.ringW * 0.72, y: ringC - V.ringW * 0.44, w: V.ringW * 1.44, h: V.ringW * 0.88 };
    const bridgeTop = footY + 10;
    const roads = [
      pave,
      { x: cx - half, y: oy - 20, w: V.road, h: pave.y + 80 - (oy - 20) },
      { x: cx - half, y: pave.y + pave.h - 80, w: V.road, h: bridgeTop + 40 - (pave.y + pave.h - 80) },
    ];
    // The river just right of the right-hand halls, in the default view.
    // The river's gorge just right of the right-hand halls; the crop's right edge stays where it was (the fit ignores the river).
    // (Its near bank meets the plaza's edge, in the default view at the right.)
    const riverX = cx + m.right - 34;
    const cropRight = riverX + V.riverW * 0.6;
    // The cliff at the river's head: its top at the square's edge, a middle, then its foot into the river.
    const cliffW = V.riverW + 16, ck = cliffW / FRAMES["cliff-top"]!.w;
    const cliffTop = { x: riverX + V.riverW / 2 - cliffW / 2, y: Math.max(oy - 6, topBase - maxAbove(a) - 20), w: cliffW, h: FRAMES["cliff-top"]!.h * ck };
    const cliffMid = { ...cliffTop, y: cliffTop.y + cliffTop.h - 1, h: FRAMES["cliff-mid"]!.h * ck * 0.6 };
    const cliff = { top: cliffTop, mid: cliffMid, foot: { ...cliffTop, y: cliffMid.y + cliffMid.h - 1, h: FRAMES["cliff-foot"]!.h * ck } };
    const moatY = footY + 24;
    const wallY = footY + V.moatH + 6;
    const bridgeW = V.road + 40;
    const bridgeSpec = FRAMES.bridge!;
    const bridgeH = (bridgeSpec.h * bridgeW) / bridgeSpec.w;
    const bridge = { x: cx - bridgeW / 2, y: wallY + V.wallH + 6 - bridgeH, w: bridgeW, h: bridgeH };
    const gap = bridgeW / 2 + 34;
    // Lamps line the central road, both sides, and flank the fountain.
    const lamps: Pt[] = [];
    for (let y = oy + 90; y < pave.y + 20; y += 200) lamps.push({ x: cx - half - 18, y }, { x: cx + half + 18, y });
    // Lamps on posts at the ring's four quarters.
    for (const [dx, dy] of [[-0.36, -0.28], [0.36, -0.28], [-0.4, 0.42], [0.4, 0.42]] as const) lamps.push({ x: cx + dx * V.ringW, y: ringC + dy * ringH });
    squares.push({
      host: entity,
      online,
      rect,
      center: { x: cx, y: fountain.y + fountain.h / 2 },
      fountain,
      ring,
      plaque,
      title,
      stats,
      roads,
      plaza,
      lamps,
      pennants: [{ x: cx - V.ringW / 2 - 4, y: ringC + 40 }, { x: cx + V.ringW / 2 + 4, y: ringC + 40 }],
      // Lanterns on the bridge's front posts.
      bridgeLamps: [{ x: cx - bridgeW * 0.4, y: bridge.y + bridge.h * 0.2 }, { x: cx + bridgeW * 0.4, y: bridge.y + bridge.h * 0.2 }],
      river: { x: riverX, y: cliff.foot.y + cliff.foot.h - 30, w: V.riverW, h: oy + m.h - (cliff.foot.y + cliff.foot.h - 30) },
      waterfall: { x: cliff.top.x, y: cliff.top.y, w: cliff.top.w, h: cliff.foot.y + cliff.foot.h - cliff.top.y },
      cliff,
      // A pond with lilies either side of the bridge, in front of the wall.
      moat: [
        { x: cx - gap - V.pond + 40, y: moatY, w: V.pond, h: V.moatH },
        { x: cx + gap - 40, y: moatY, w: V.pond, h: V.moatH },
      ],
      // From the plaza's left edge to the river's middle beside the halls (the tent and the far bank as the view's width allows).
      // The concept's crop: a sliver above the top halls' banners, the front wall cut through with its bridge,
      // a strip of forest and the tent at the left, the river's gorge at the right.
      // (and the river's gorge, which the concept shows across the right of its view)
      keep: { x: px0 - 10, y: topBase - maxAbove(a) - 10, w: riverX + V.riverW * 0.5 - (px0 - 10), h: bridge.y + bridge.h * 0.5 - (topBase - maxAbove(a) - 10) },
      heart: { x: px0 - 150, y: topBase - maxAbove(a) - 24, w: cropRight - (px0 - 150), h: wallY + V.wallH * 0.6 - (topBase - maxAbove(a) - 24) },
      bridge,
      walls: [
        { x: ox, y: wallY, w: cx - gap - ox, h: V.wallH },
        { x: cx + gap, y: wallY, w: riverX + 10 - (cx + gap), h: V.wallH },
      ],
      towers: [
        { x: cx - gap, y: wallY + V.wallH + 8 },
        { x: cx + gap, y: wallY + V.wallH + 8 },
        { x: ox + 40, y: wallY + V.wallH + 8 },
        { x: riverX - 10, y: wallY + V.wallH + 8 },
      ],
    });

    for (const s of a.slots) {
      const b = s.block;
      const x0 = blockX(s, cx, plaqueW, a);
      const base = baseOf(s.half, s.row);
      const mid = x0 + b.width / 2;
      const body = boxOf(b.building, mid, base, b.w);
      const bw = b.w * V.banner;
      const bannerSpec = FRAMES.banner!;
      const banner = { x: mid - bw / 2, y: body.y - V.bannerLift, w: bw, h: (bannerSpec.h * bw) / bannerSpec.w };
      const plaqueRect = { x: mid - b.plaqueW / 2, y: body.y + body.h * V.plaqueAt - V.plaqueH / 2, w: b.plaqueW, h: V.plaqueH };
      const slotX = (k: number) => mid + (k - 1.5) * b.pitch;
      const xs = b.slots.map(slotX);
      // Robots stand in front of their bays, oldest first, spread along the porch where bays' crowds would touch.
      const wanted = b.cottages.flatMap((c, i) => c.agents.map((_, j) => xs[i]! + (j - (c.agents.length - 1) / 2) * V.pitch));
      const feetX = spread(wanted, V.pitch);
      const porchL = Math.min(body.x + b.w * 0.06, (xs[0] ?? mid) - b.pitch / 2 - 10, (feetX[0] ?? mid) - V.pitch / 2 - 6);
      const porchR = Math.max(body.x + b.w * 0.94, (xs[xs.length - 1] ?? mid) + b.pitch / 2 + 10, (feetX[feetX.length - 1] ?? mid) + V.pitch / 2 + 6);
      let robot = 0;
      // Every hall has its ledge, so the four read alike (an empty one without agents).
      const ledge = true;
      const porch = ledge ? { x: porchL, y: base + V.porchY, w: porchR - porchL, h: V.porchH } : { x: body.x + b.w * 0.04, y: base - 6, w: b.w * 0.92, h: V.steps + 6 };
      const projEntity: Entity | undefined = b.project
        ? { id: b.project.key, kind: "project", name: b.project.name, host: host.key, position: { q: 0, r: 0 }, stale: !!b.project.stale }
        : undefined;
      projects.push({
        key: b.key,
        host: host.key,
        entity: projEntity,
        name: b.project?.name ?? "No project",
        icon: b.project ? projectIcon(b.project.name, b.project.key) : "gear",
        building: b.building,
        square: index,
        block: { x: x0, y: base - b.above, w: b.width, h: b.above + b.below },
        body,
        base,
        banner,
        plaque: plaqueRect,
        porch,
        ledge,
        lamps: [
          { x: porch.x - 14, y: porch.y + porch.h - 4 },
          { x: porch.x + porch.w + 14, y: porch.y + porch.h - 4 },
        ],
        rect: union([banner, body]),
        stale: !!b.project?.stale,
      });
      b.cottages.forEach((c, i) => {
        const k = b.slots[i]!;
        const bcx = xs[i]!;
        const fw = b.pitch * V.frameW;
        const frame = boxOf("tile-frame", bcx, base + V.frameFeet, fw);
        const tileSize = frame.w * 0.8;
        const tileAt = { x: bcx, y: frame.y + frame.h * 0.42 };
        const textW = measure(c.name, "workspace") + 14;
        const pw = clamp(textW, frame.w * 0.8, b.pitch - 4);
        const plate = { x: bcx - pw / 2, y: frame.y + frame.h - V.plateH - 3, w: pw, h: V.plateH };
        const arch = k < 0 || k > 3 ? boxOf("bay-arch", bcx, base, b.pitch) : undefined;
        const wsEntity: Entity = {
          id: c.key,
          kind: "workspace",
          name: c.name,
          host: host.key,
          project: b.project?.key,
          position: { q: 0, r: 0 },
          stale: !!c.stale,
          camp: c.camp,
          ...(c.flags ? { flags: c.flags } : {}),
          ...(c.probe ? { probe: c.probe } : {}),
          ...(c.autoMerge ? { autoMerge: true } : {}),
        };
        // Medallions on the frame's upper corners: CI to the left, review (and Probe beneath it) to the right.
        const fy = frame.y + 4;
        const left = { x: frame.x + 4, y: fy }, right = { x: frame.x + frame.w - 4, y: fy };
        const flags: VFlag[] = [];
        if (c.flags?.ci) flags.push({ workspace: c.key, flag: c.flags.ci, frame: `pr-${c.flags.ci}`, ...left, size: V.flag });
        if (c.flags?.review) flags.push({ workspace: c.key, flag: c.flags.review, frame: `pr-${c.flags.review}`, ...right, size: V.flag });
        if (c.probe) flags.push({ workspace: c.key, flag: "probe", frame: `probe-${c.probe.state}`, x: right.x, y: c.flags?.review ? fy + V.flag + 3 : fy, size: V.flag });
        const sealOn = c.autoMerge ? (flags.find((f) => f.flag === c.flags?.review) ?? flags.find((f) => f.flag === c.flags?.ci)) : undefined;
        const top = arch ? Math.min(arch.y, frame.y) : frame.y - 12;
        workspaces.push({
          entity: wsEntity,
          project: b.key,
          square: index,
          rect: { x: bcx - b.pitch / 2 + 2, y: top, w: b.pitch - 4, h: frame.y + frame.h - top },
          ...(arch ? { arch } : {}),
          frame,
          tile: c.camp ? "none" : tileOf(c),
          tileAt,
          tileSize,
          plate,
          flags,
          ...(sealOn ? { seal: { x: sealOn.x + 7, y: sealOn.y - 7, size: 10 } } : {}),
          agents: c.agents,
        });
        c.agents.forEach((key) => {
          const row = agentRows.get(key);
          const x = feetX[robot++]!;
          if (!row) return;
          const feet = { x, y: base + V.feetY };
          agents.push({
            robot: robotColor(row.model),
            drones: (row.subagentModels ?? []).map(robotColor),
            entity: agentEntity(row, { workspace: c.key, project: b.project?.key }, online),
            feet,
            rect: { x: feet.x - V.pitch / 2 + 2, y: feet.y - V.robotH + 2, w: V.pitch - 4, h: V.robotH + 4 },
            square: index,
          });
        });
      });
    }
  }

  // The squares, in a grid of as many columns as best suits the map's shape (rows top-aligned).
  const order = plans.map((p, i) => ({ p, i }));
  let grid: { cols: number; score: number } = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= Math.max(1, plans.length); cols++) {
    const { w, h } = gridSize(cols);
    const score = Math.abs(Math.log(w / h / aspect));
    if (score < grid.score - 1e-9) grid = { cols, score };
  }
  function gridSize(cols: number) {
    let w = 0, h = 0;
    for (let r = 0; r * cols < plans.length; r++) {
      const row = plans.slice(r * cols, (r + 1) * cols);
      w = Math.max(w, row.reduce((s, p) => s + p.width, 0));
      h += Math.max(...row.map((p) => p.height));
    }
    return { w: Math.max(w, 1), h: Math.max(h, 1) };
  }
  let y = 0;
  for (let r = 0; r * grid.cols < plans.length; r++) {
    const row = order.slice(r * grid.cols, (r + 1) * grid.cols);
    let x = 0;
    for (const { p, i } of row) {
      p.build(x, y, i);
      x += p.width;
    }
    y += Math.max(...row.map(({ p }) => p.height));
  }
  const size = gridSize(grid.cols);
  const bounds = { x: 0, y: 0, w: size.w, h: size.h };
  // Squares narrower than their row's widest stretch their ground to the bounds' edge (their margins grow).
  for (const s of squares) {
    const right = squares.filter((o) => o.rect.y === s.rect.y).reduce((m, o) => Math.max(m, o.rect.x + o.rect.w), 0);
    if (s.rect.x + s.rect.w === right && right < bounds.w) s.rect = { ...s.rect, w: s.rect.w + bounds.w - right };
  }

  const decor = sceneryOf(squares, projects, workspaces, agents);

  const shownProjects = projects.filter((p) => p.entity).map((p) => p.entity!);
  const entities = [...hostEntities, ...shownProjects, ...workspaces.map((w) => w.entity), ...agents.map((a) => a.entity)];
  const states = agents.map((a) => a.entity.state!);
  const realWorkspaces = workspaces.filter((w) => !w.entity.camp);
  const pr = { merged: 0, review: 0, draft: 0, failing: 0 };
  for (const w of realWorkspaces) if (w.tile !== "none") pr[w.tile]++;
  const counts: VillageCounts = {
    hosts: squares.length,
    hostsOffline: squares.filter((s) => !s.online).length,
    projects: shownProjects.length,
    prs: pr.merged + pr.review + pr.draft + pr.failing,
    pr,
    workspaces: realWorkspaces.length,
    active: realWorkspaces.filter((w) => agents.some((a) => a.entity.workspace === w.entity.id && a.entity.state === "running")).length,
    agents: agents.length,
    running: states.filter((s) => s === "running").length,
    idle: states.filter((s) => s === "idle").length,
    needYou: states.filter((s) => NEEDS_YOU.includes(s)).length,
    unread: states.filter((s) => s === "done").length,
    failed: states.filter((s) => s === "failed").length,
    offline: states.filter((s) => s === "offline").length,
  };
  const round = (r: Rect) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10);
  const signature = JSON.stringify([
    round(bounds),
    squares.map((s) => [s.host.id, s.title, s.online, s.stats.map((x) => x.text), round(s.rect)]),
    projects.map((p) => [p.key, p.name, p.icon, p.building, round(p.block)]),
    workspaces.map((w) => [w.entity.id, w.entity.name, round(w.rect), w.tile, w.flags.map((f) => f.frame), w.entity.probe ? probeGlyph(w.entity.probe) : 0, w.seal ? 1 : 0]),
    agents.map((a) => [a.entity.id, a.feet.x, a.feet.y]),
  ]);
  // One host: the fit frames its heart, cropping the woods. Several: every square shows.
  const core = squares.length === 1 ? squares[0]!.heart : bounds;
  const keep = squares.length === 1 ? squares[0]!.keep : bounds;
  return { bounds, core, keep, squares, projects, workspaces, agents, decor, entities, counts, signature };
}

const LAMP = { color: 0xffc46a, reach: 70, dy: 14 };
/** Seeded scenery for each square: the river with its banks' rocks and the waterfall's cliff, the foot's moat,
 * wall, towers and pennants, flower beds and grass tufts along the roads, bushes, crates and barrels by the
 * halls, a tent, and woods all round. Never on what the village says, nor (for trees) on its roads. */
function sceneryOf(squares: VSquare[], projects: VProject[], workspaces: VWorkspace[], agents: VAgent[]): VDecor[] {
  const decor: VDecor[] = [];
  squares.forEach((sq, si) => {
    const rng = random(seedOf(sq.host.id + "scenery"));
    const pick = <T,>(list: T[]) => list[Math.floor(rng() * list.length)]!;
    const mine = projects.filter((p) => p.square === si);
    const R = sq.rect;
    const pave = sq.roads[0]!;
    // What carries information, and the water: scenery keeps off it.
    const reserved: Rect[] = [
      sq.fountain, sq.plaque, sq.ring, sq.bridge,
      ...sq.lamps.map((l) => boxOf("lamp-on", l.x, l.y)),
      ...sq.pennants.map((l) => boxOf("lamp-post-banner", l.x, l.y, 150)),
      ...mine.flatMap((p) => [p.rect, p.plaque, p.porch, ...p.lamps.map((l) => boxOf("lamp-on", l.x, l.y))]),
      ...workspaces.filter((w) => w.square === si).flatMap((w) => [w.rect, w.plate]),
      ...agents.filter((a) => a.square === si).map((a) => ({ ...a.rect, y: a.rect.y - 16, h: a.rect.h + 40 })),
      { ...sq.river, x: sq.river.x - 10, w: sq.river.w + 20 },
      sq.waterfall,
      ...sq.moat,
      ...sq.walls.map((w) => ({ ...w, y: w.y - 30, h: w.h + 30 })),
    ];
    // Trees, blossoms and the tent keep off the plaza and the roads; smaller things keep off the roads' middles.
    const ground = [...sq.roads.map((r) => ({ x: r.x + 14, y: r.y + 14, w: r.w - 28, h: r.h - 28 })), sq.plaza];
    for (const r of sq.roads.slice(1)) reserved.push({ x: r.x + 30, y: r.y, w: r.w - 60, h: r.h });
    // (A small tree, as one in a planter, may stand on the plaza.)
    const big = (frame: string, w?: number) => /^(tree|blossom|tent)/.test(frame) && !(w !== undefined && w < 110);
    const placed: Rect[] = [];
    const place = (d: Omit<VDecor, "rect" | "square"> & { w?: number }, keepClear = true) => {
      const rect = boxOf(d.frame, d.x, d.y, d.w);
      // Its footprint (the lower part, for tall things whose crowns may overhang).
      const foot = d.layer === "stand" && rect.h > 60 ? { x: rect.x + rect.w * 0.2, y: rect.y + rect.h * 0.55, w: rect.w * 0.6, h: rect.h * 0.45 } : rect;
      if (keepClear) {
        if (reserved.some((r) => overlaps(r, foot, 2))) return false;
        if (big(d.frame, d.w) && ground.some((r) => overlaps(r, foot, 6))) return false;
        // No crown hides the wall, its towers or the bridge, but at the square's corners.
        if (big(d.frame, d.w) && foot.x > R.x + 120 && foot.x + foot.w < sq.river.x - 40 && [...sq.walls, sq.bridge, ...sq.moat].some((w) => overlaps(w, rect, -4))) return false;
        if (placed.some((r) => overlaps(r, foot, big(d.frame, d.w) ? -34 : -4))) return false;
        if (foot.x < R.x - 30 || foot.x + foot.w > R.x + R.w + 30 || foot.y > R.y + R.h - 10) return false;
      }
      const { w: _w, ...rest } = d;
      decor.push({ ...rest, rect, square: si });
      placed.push(foot);
      return true;
    };
    const fixed = (frame: string, rect: Rect, layer: VDecor["layer"], extra: Partial<VDecor> = {}) => decor.push({ frame, x: rect.x, y: rect.y, rect, square: si, layer, ...extra });
    // The river (banks and all) down the right margin, the waterfall from its cliff at its head; rocks on its banks.
    fixed("river", sq.river, "ground");
    fixed("cliff-mid", sq.cliff.mid, "ground");
    fixed("cliff-top", sq.cliff.top, "ground");
    fixed("cliff-foot", sq.cliff.foot, "ground");
    // A ruined wall and tower beside the falls.
    const ruin = rng() < 0.5 ? "ruin-0" : "ruin-1";
    // The ruined wall the waterfall pours from, on the cliff's top; else beside it.
    place({ frame: ruin, x: sq.cliff.top.x + sq.cliff.top.w / 2, y: sq.cliff.top.y + sq.cliff.top.h * 0.45, w: sq.cliff.top.w * 0.95, layer: "stand" }, false);
    for (let y = sq.river.y + 120; y < sq.river.y + sq.river.h - 80; y += 110 + rng() * 90)
      if (rng() < 0.5) place({ frame: `rocks-${Math.floor(rng() * 3)}`, x: sq.river.x - 6 + rng() * 12, y, w: 40 + rng() * 16, layer: "stand" });
    // The foot: the moat with its lilies either side of the bridge, the wall across the whole width, its towers.
    for (const m of sq.moat) {
      const piece = FRAMES["moat-pond"]!, pw = (piece.w * m.h) / piece.h;
      const n = Math.max(1, Math.round(m.w / (pw * 0.82)));
      for (let k = 0; k < n; k++) {
        const x = m.x + (m.w - pw) * (n === 1 ? 0.5 : k / (n - 1));
        fixed("moat-pond", { x, y: m.y, w: Math.min(pw, m.w), h: m.h }, "ground", k % 2 ? { flip: true } : {});
      }
    }
    for (const w of sq.walls) fixed("wall-h", w, "stand");
    fixed("bridge", sq.bridge, "stand");
    for (const t of sq.towers) place({ frame: "wall-tower", x: t.x, y: t.y, w: 104, layer: "stand" }, false);
    // Purple pennants on the wall, and banners on poles either side of the fountain.
    for (const w of sq.walls)
      for (let x = w.x + 120; x < w.x + w.w - 80; x += 300) place({ frame: "pennant", x, y: w.y + w.h - 8, w: 46, layer: "stand" }, false);
    reserved.push(...decor.filter((d) => d.square === si).map((d) => d.rect));
    // The market tent at the plaza's lower left, fully on it if there's room.
    for (const [tx, ty] of [[pave.x + 110, pave.y + pave.h - 20], [pave.x + 110, pave.y + pave.h - 110], [pave.x - 40, pave.y + pave.h - 70]] as const)
      if (place({ frame: "tent", x: tx, y: ty, w: 180, layer: "stand" })) {
        reserved.push(decor[decor.length - 1]!.rect);
        for (const [cx2, f] of [[tx - 110, "crates-1"], [tx + 105, "barrel"]] as const) place({ frame: f, x: cx2, y: ty - 4, layer: "stand" });
        break;
      }
    // Bushes along the road to the bridge, and trees flanking the road north.
    const south = sq.roads[2]!, north = sq.roads[1]!;
    for (let y = south.y + 50; y < south.y + south.h - 10; y += 60)
      for (const sx of [south.x - 14, south.x + south.w + 14]) place({ frame: `bush-${Math.floor(rng() * 4)}`, x: sx, y, w: 70, layer: "stand" });
    for (let y = north.y + 120; y < north.y + north.h + 40; y += 110)
      for (const sx of [north.x - 90, north.x + north.w + 90]) place({ frame: `tree-${Math.floor(rng() * 6)}`, x: sx, y, w: 170, layer: "stand" });
    // The plaza's clutter: small trees in planters, flower beds, crates and barrels over its open paving.
    for (let k = 0; k < 90; k++) {
      const x = pave.x + 40 + rng() * (pave.w - 80), y = pave.y + 200 + rng() * (pave.h - 200);
      const roll = rng();
      const frame = roll < 0.35 ? "flowerbed" : roll < 0.6 ? `crates-${Math.floor(rng() * 3)}` : roll < 0.8 ? "barrel" : `flowers-${Math.floor(rng() * 4)}`;
      place({ frame, x, y, w: frame.startsWith("tree") ? 96 : undefined, layer: "stand" });
    }
    // Flower beds round the fountain's ring.
    for (let k = 0; k < 10; k++) {
      const t = Math.PI * (0.1 + 0.8 * (k / 9)) + (k % 2 ? Math.PI : 0);
      place({ frame: "flowerbed", x: sq.center.x + Math.cos(t) * (sq.ring.w / 2 + 34), y: sq.ring.y + sq.ring.h / 2 + Math.sin(t) * (sq.ring.h / 2 + 22), w: 80, layer: "stand" });
    }
    // Crates, barrels and flower boxes by the porches' ends, bushes beside the halls.
    for (const p of mine)
      for (const s of [-1, 1]) {
        const x = s === -1 ? p.porch.x - 34 : p.porch.x + p.porch.w + 34;
        // A crate stack and a barrel beside each hall's foundation.
        place({ frame: `crates-${Math.floor(rng() * 3)}`, x, y: p.porch.y + p.porch.h - 10, w: 64, layer: "stand" });
        place({ frame: "barrel", x: x + s * 46, y: p.porch.y + p.porch.h - 2, w: 30, layer: "stand" });
        const bx = s === -1 ? p.body.x - 6 : p.body.x + p.body.w + 6;
        place({ frame: `bush-${Math.floor(rng() * 4)}`, x: bx, y: p.base - 6, layer: "stand" });
      }
    // Flower beds and grass tufts along the roads' edges, so the grass bleeds over them.
    for (const r of sq.roads)
      for (const [x0, x1, y] of [[r.x, r.x + r.w, r.y + 6], [r.x, r.x + r.w, r.y + r.h + 6]] as const)
        for (let x = x0 + 30 + rng() * 60; x < x1 - 20; x += 90 + rng() * 120)
          place({ frame: rng() < 0.35 ? "flowerbed" : rng() < 0.6 ? `flowers-${Math.floor(rng() * 4)}` : "grass-tufts", x, y, w: undefined, layer: "ground" });
    // Rocks by the ponds; bushes and flowers along the wall's foot.
    for (const m of sq.moat)
      for (const fx of [0.06, 0.94]) place({ frame: `rocks-${Math.floor(rng() * 3)}`, x: m.x + m.w * fx, y: m.y + m.h * (0.6 + rng() * 0.3), w: 60 + rng() * 20, layer: "stand" }, false);
    for (const w of sq.walls)
      for (let x = w.x + 40 + rng() * 40; x < w.x + w.w - 30; x += 70 + rng() * 60)
        if (!sq.towers.some((t) => Math.abs(t.x - x) < 70))
          place({ frame: rng() < 0.5 ? `bush-${Math.floor(rng() * 4)}` : `flowers-${Math.floor(rng() * 4)}`, x, y: w.y + w.h + 18, w: 70 + rng() * 30, layer: "stand" }, false);
    // Woods: rows of trees through the margins and any grass left between the halls.
    const spots: Pt[] = [];
    for (let y = R.y + 40; y < R.y + R.h + 40; y += 64 + rng() * 26)
      for (let x = R.x + 10 + rng() * 40; x < R.x + R.w + 10; x += 72 + rng() * 36) spots.push({ x, y });
    for (const pt of spots) place({ frame: rng() < 0.22 ? `blossom-${Math.floor(rng() * 3)}` : `tree-${Math.floor(rng() * 6)}`, x: pt.x, y: pt.y, w: 150 + rng() * 50, layer: "stand" });
    for (let k = 0; k < 160; k++) {
      const pt = { x: R.x + rng() * R.w, y: R.y + rng() * R.h };
      const roll = rng();
      const frame = roll < 0.4 ? `bush-${Math.floor(rng() * 4)}` : roll < 0.75 ? `flowers-${Math.floor(rng() * 4)}` : roll < 0.9 ? "grass-tufts" : pick(["rocks-0", "rocks-1", "flowerbed"]);
      place({ frame, x: pt.x, y: pt.y, layer: frame.startsWith("bush") || frame.startsWith("rocks") ? "stand" : "ground" });
    }
  });
  return decor;
}

/** The most urgent state among a project's agents that its banner flares for. */
export function projectAlarm(layout: VillageLayout, project: string): State | undefined {
  const states = layout.agents.filter((a) => a.entity.project === project).map((a) => a.entity.state!);
  return tileState(states.filter((s) => BEACON_STATES.includes(s)));
}
/** Whether any of a project's agents is running. */
export const projectWorking = (layout: VillageLayout, project: string) =>
  layout.agents.some((a) => a.entity.project === project && a.entity.state === "running");

/** The status pill: short and true. */
export function statusLine(layout: VillageLayout): { text: string; tone: "ok" | "warn" | "alert" } {
  const c = layout.counts;
  if (c.needYou) return { text: `${c.needYou} need${c.needYou === 1 ? "s" : ""} you`, tone: "warn" };
  if (c.failed) return { text: `${c.failed} agent${c.failed === 1 ? "" : "s"} failed`, tone: "alert" };
  if (c.hosts && c.hostsOffline === c.hosts) return { text: "Every host offline", tone: "warn" };
  if (c.hostsOffline) return { text: `${c.hostsOffline} host${c.hostsOffline === 1 ? "" : "s"} offline`, tone: "warn" };
  return { text: "All systems operational", tone: "ok" };
}
