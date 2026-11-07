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
  byAge,
  type AtlasData,
  type Cottage,
  type DashboardCounts,
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
  pitch: 100,
  /** A building's natural width; it widens (its height keeping its shape) for bays holding several robots, to `buildingMax`. */
  building: 585,
  buildingMax: 1000,
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
  plateH: 30,
  /** The porch: a shallow stone ledge along the hall's front (about a third of a robot's height deep), and the robots'
   * feet on it; a hall without agents has only its foundation steps (`steps` deep). */
  porchY: -2,
  porchH: 50,
  feetY: 46,
  steps: 24,
  /** Further rows: of workspace bays under the dome, and of robots on the workshop's ledges. */
  bayRow: 150,
  robotRow: 150,
  /** Between blocks in a row, and between rows (a cobbled walk). */
  blockGap: 34,
  band: 70,
  /** Between the first upper row's porches and the first lower row's banners. */
  plazaGap: 24,
  fountainW: 286,
  ringW: 300,
  hostPlaqueH: 64,
  hostLineH: 38,
  hostPlaqueMin: 190,
  /** The central road's width and a walk's depth; blocks start `inner` either side of the middle (the first lower row clear of the fountain). */
  road: 140,
  walk: 86,
  pond: 400,
  inner: 64,
  /** Margins round a square: woods above and to the left (the HUD lies there), the river to the right; the foot's
   * moat, wall and bridge below the last walk. */
  marginTop: 420,
  marginLeft: 300,
  marginRight: 420,
  riverW: 330,
  moatH: 110,
  wallH: 165,
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
  /** The plaque's lines: each host's name (offline says so) and its load. */
  hosts: { id: string; title: string; stats: { text: string; alert: boolean }[]; online: boolean; plaqueW: number; lineW: number }[];
  /** Cobbled roads (with organic edges): north from the square's edge, the walks in front of each row's
   * porches, south to the bridge; and the round plaza's paving under the fountain's ring. */
  roads: Rect[];
  plaza: Rect;
  /** Lamps along the central road and flanking the fountain (feet), lit while any of the square's agents runs. */
  lamps: Pt[];
  /** Lanterns on the bridge's posts (feet), lit as the lamps are. */
  bridgeLamps: Pt[];
  /** Banners hung on the front wall (their tops). */
  wallBanners: Pt[];
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
  /** Which hall: the dashboards (PRs, issues), the workspaces' dome or the agents' workshop. */
  hall: Hall;
  entity?: Entity;
  name: string;
  icon: Icon;
  /** Its banner's emblem: a frame, or a painted mark (`mark-github`, `mark-linear`). */
  emblem: string;
  /** Its ledges (one per row of robots). */
  porches: Rect[];
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
/** A dashboard tile: a group of your PRs or issues, its count on its plate. */
export type VTile = { id: string; hall: "prs" | "issues"; key: string; tile: TileKind; frame: Rect; tileAt: Pt; tileSize: number; plate: Rect; rect: Rect };
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
  /** Its name on the plate (cut short past PLATE_CHARS), and its state's dot. */
  label: string;
  status: "running" | "needs" | "failed" | "idle" | "offline";
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
  /** The four halls. */
  projects: VProject[];
  /** The dashboard halls' tiles (PRs, issues). */
  tiles: VTile[];
  workspaces: VWorkspace[];
  agents: VAgent[];
  decor: VDecor[];
  entities: Entity[];
  counts: VillageCounts;
  /** Changes whenever anything's place changes. */
  signature: string;
};
/** A dashboard hall's counts: whether known, the total, each group's, and why not when not. */
export type DashCount = { known: boolean; total: number; by: Record<string, number>; atLeast: string[]; why: string };
/** A dashboard count as shown: "—" while unknown, "N+" when a lower bound. */
export const dashText = (d: DashCount, key?: string) =>
  !d.known ? "—" : key === undefined ? `${d.total}${d.atLeast.length ? "+" : ""}` : `${d.by[key] ?? 0}${d.atLeast.includes(key) ? "+" : ""}`;
export type VillageCounts = {
  hosts: number;
  hostsOffline: number;
  prs: DashCount;
  issues: DashCount;
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

/** The village's four halls, as the concept: your pull requests and your Linear issues above, workspaces and agents below. */
export type Hall = "prs" | "issues" | "workspaces" | "agents";
export const HALLS: { hall: Hall; name: string; building: string; emblem: string }[] = [
  { hall: "prs", name: "GitHub PRs", building: "hall-blue", emblem: "mark-github" },
  { hall: "issues", name: "Linear Issues", building: "hall-purple", emblem: "mark-linear" },
  { hall: "workspaces", name: "Workspaces", building: "dome-teal", emblem: "icon-layers" },
  { hall: "agents", name: "Agents", building: "workshop-rust", emblem: "icon-agents" },
];
/** The dashboard halls' four tiles each: the group's key, its tile and its name. */
export const DASH_TILES: Record<"prs" | "issues", { key: string; tile: TileKind; name: string }[]> = {
  prs: [
    { key: "merged", tile: "merged", name: "Merged" },
    { key: "review", tile: "review", name: "Review" },
    { key: "draft", tile: "draft", name: "Draft" },
    { key: "conflicts", tile: "failing", name: "Conflicts" },
  ],
  issues: [
    { key: "done", tile: "merged", name: "Done" },
    { key: "inProgress", tile: "review", name: "In Progress" },
    { key: "todo", tile: "draft", name: "Todo" },
    { key: "blocked", tile: "failing", name: "Blocked" },
  ],
};
/** Workspace names on plates are cut short past this many characters (the hover card gives the whole). */
export const PLATE_CHARS = 14;
export const plateLabel = (name: string) => (name.length > PLATE_CHARS ? `${name.slice(0, PLATE_CHARS - 1)}…` : name);

type Bay =
  | { kind: "tile"; id: string; hall: "prs" | "issues"; tile: TileKind; key: string }
  | { kind: "workspace"; c: Cottage; host: string; project?: string };
type Block = {
  hall: Hall;
  name: string;
  emblem: string;
  building: string;
  /** Drawn width and height of its building. */
  w: number;
  h: number;
  /** The bays' pitch (its arches'), and each bay's slot on that lattice (0–3 are the building's own arches) and row. */
  pitch: number;
  bays: { bay: Bay; slot: number; row: number }[];
  /** The agents hall's robots: how many, and how many to a ledge row. */
  robots: number;
  perRow: number;
  rows: number;
  plaqueW: number;
  /** Its whole width, and its reach above and below its building's feet. */
  width: number;
  above: number;
  below: number;
};

/** The step between rows of bays: a tile frame's height at this pitch, its plate's overhang and a gap. */
const bayStep = (pitch: number) => {
  const fw = pitch * V.frameW, f = FRAMES["tile-frame"]!;
  return Math.max(V.bayRow, (f.h * fw) / f.w + V.plateH * 0.4 + 24);
};

/** The width a hall asks for: room for its robots shoulder to shoulder, or its plates' names. */
function hallWidth(spec: (typeof HALLS)[number], bays: Bay[], robots: number, measure: Measure): number {
  if (spec.hall === "agents") {
    const perRow = Math.max(4, Math.min(robots, Math.max(8, Math.ceil(Math.sqrt(robots * 1.5)))));
    return clamp((Math.min(robots, perRow) * V.pitch) / 0.98, V.building, V.buildingMax);
  }
  if (spec.hall === "workspaces") {
    // Names past what fits step their type down on the plate (to 14 px) before they're cut short.
    const widest = Math.max(0, ...bays.map((b) => (b.kind === "workspace" ? measure(plateLabel(b.c.name), "workspace") : 0)));
    return clamp((widest + 34) / V.archPitch, V.building, 700);
  }
  return V.building;
}

function blockOf(spec: (typeof HALLS)[number], bays: Bay[], robots: number, measure: Measure, width: number): Block {
  const sheet = FRAMES[spec.building]!;
  let w = width, perRow = 0, rows = 1;
  // The workshop is wider than the others, as the concept's (its gear wheel at its right).
  if (spec.hall === "agents") w = Math.min(V.buildingMax * 1.1, w * 1.08);
  if (spec.hall === "agents") {
    // Robots shoulder to shoulder on its platform; past a hall's width, more rows.
    perRow = Math.max(4, Math.min(robots, Math.max(8, Math.ceil(Math.sqrt(robots * 1.5)))));
    rows = Math.max(1, Math.ceil(robots / perRow));
  }
  const pitch = w * V.archPitch;
  const h = (sheet.h * w) / sheet.w;
  // Oldest first, left to right: the building's own four arches; more spill out either side under arches of their own,
  // then wrap into further rows beneath.
  const n = bays.length;
  rows = spec.hall === "workspaces" ? Math.max(1, Math.ceil(n / 8)) : rows;
  const perBayRow = spec.hall === "workspaces" ? Math.max(4, Math.ceil(n / rows)) : 4;
  const start = -Math.floor((perBayRow - 4) / 2);
  const placed = bays.map((bay, i) => ({ bay, slot: start + (i % perBayRow), row: Math.floor(i / perBayRow) }));
  const lo = Math.min(0, start), hi = Math.max(3, start + perBayRow - 1);
  const span = Math.max((hi - lo + 1) * pitch, spec.hall === "agents" ? Math.min(robots, perRow) * V.pitch + 40 : 0);
  const plaqueW = clamp(Math.ceil(measure(spec.name, "project") + V.labelPad * 2), V.plaqueMin, Math.min(V.plaqueMax, w * 0.8));
  const extra = spec.hall === "agents" ? (rows - 1) * V.robotRow : spec.hall === "workspaces" ? (rows - 1) * bayStep(pitch) : 0;
  return {
    hall: spec.hall,
    name: spec.name,
    emblem: spec.emblem,
    building: spec.building,
    w,
    h,
    pitch,
    bays: placed,
    robots,
    perRow,
    rows,
    plaqueW,
    width: Math.max(w, span + 40) + 12,
    above: h + V.bannerLift + 8,
    below: V.porchY + V.porchH + extra + (spec.hall === "agents" ? 22 : 0),
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

/** The four halls round the fountain: the dashboards above, workspaces and agents below. */
type Slot = { block: Block; side: -1 | 1; half: -1 | 1; row: number };
type Arranged = { rows: number; slots: Slot[] };
function arrange(blocks: Block[]): Arranged {
  const slots: Slot[] = blocks.map((block, i) => ({ block, half: i < 2 ? -1 : 1, side: i % 2 === 0 ? -1 : 1, row: 0 }));
  return { rows: 1, slots };
}
const rowOf = (a: Arranged, half: -1 | 1, row: number, side?: -1 | 1) => a.slots.filter((s) => s.half === half && s.row === row && (side === undefined || s.side === side));

/** The gap either side of the middle a row keeps: the first lower row's room for the fountain and the host's plaque. */
// (The lower halls stand close beside the fountain's ring; its plaque may reach under their roofs' slanted inner corners.)
const innerOf = (half: -1 | 1, row: number, plaqueW: number) => (half === 1 && row === 0 ? Math.max(V.inner, V.ringW / 2 + 6, plaqueW / 2 + 6) : V.inner);

/** The reach above its feet of the outermost upper row's tallest hall (its banner). */
const maxAbove = (a: Arranged) => Math.max(0, ...rowOf(a, -1, a.rows - 1).map((s) => s.block.above));

/** A block's left edge in its row. */
function blockX(s: Slot, cx: number, plaqueW: number, a: Arranged) {
  const before = rowOf(a, s.half, s.row, s.side).filter((o) => a.slots.indexOf(o) < a.slots.indexOf(s));
  const offset = innerOf(s.half, s.row, plaqueW) + before.reduce((sum, o) => sum + o.block.width + V.blockGap, 0);
  return s.side === 1 ? cx + offset : cx - offset - s.block.width;
}

/** A workspace's state on its plate's dot: an agent running, one needing you, one failed, all offline, else idle. */
export function workspaceStatus(states: State[], online: boolean): VWorkspace["status"] {
  if (!online) return "offline";
  if (states.some((s) => NEEDS_YOU.includes(s))) return "needs";
  if (states.includes("failed")) return "failed";
  if (states.includes("running")) return "running";
  return "idle";
}

/**
 * Lay the fleet out as the Village: one village square for the whole fleet, as the concept's dashboard, whatever
 * its size. `aspect` is kept for the map styles' common call; `measure` gives label text widths (the bridge's real font).
 */
export function layoutVillage(data: AtlasData, _aspect = 1.6, measure: Measure = approxMeasure): VillageLayout {
  const allHosts = sortedHosts(data);
  const groupsOf = allHosts.map((h) => ({ host: h, groups: hostGroups(h, data) }));
  // The plaque names hosts with workspaces (every host when none has any).
  const shownHosts = groupsOf.some((g) => g.groups.length) ? groupsOf.filter((g) => g.groups.length).map((g) => g.host) : allHosts;
  const onlineOf = new Map(allHosts.map((h) => [h.key, h.online]));
  const hostOrder = new Map(allHosts.map((h, i) => [h.key, i]));
  const squares: VSquare[] = [];
  const projects: VProject[] = [];
  const workspaces: VWorkspace[] = [];
  const agents: VAgent[] = [];
  const tiles: VTile[] = [];
  // Workspaces across the fleet: by host, then project, oldest first (agents without one wait in the workshop only).
  const cottages = groupsOf.flatMap(({ host, groups }) =>
    groups.flatMap((g) => g.cottages.filter((c) => !c.camp).map((c): Bay => ({ kind: "workspace", c, host: host.key, project: g.project?.key }))),
  );
  const workspaceKeys = new Set(cottages.map((b) => (b.kind === "workspace" ? b.c.key : "")));
  const projectOf = new Map(data.workspaces.map((w) => [w.key, w.project]));
  const agentRows = new Map(data.agents.map((a) => [a.key, a]));
  const fleetAgents = [...data.agents].sort((a, b) => (hostOrder.get(a.host) ?? 99) - (hostOrder.get(b.host) ?? 99) || byAge(a, b));
  const dashBays = (hall: "prs" | "issues"): Bay[] => DASH_TILES[hall].map((t) => ({ kind: "tile", id: `tile:${hall}:${t.key}`, hall, tile: t.tile, key: t.key }));
  const baysOf = (hall: Hall) => (hall === "prs" || hall === "issues" ? dashBays(hall) : hall === "workspaces" ? cottages : []);
  // The four halls share one width, as the concept's do: the widest any of them asks for.
  const hallW = Math.max(...HALLS.map((spec) => hallWidth(spec, baysOf(spec.hall), spec.hall === "agents" ? fleetAgents.length : 0, measure)));
  const blocks = HALLS.map((spec) => blockOf(spec, baysOf(spec.hall), spec.hall === "agents" ? fleetAgents.length : 0, measure, hallW));
  const hostLines = shownHosts.map((h) => hostPlaque(h));
  const plaqueW = Math.max(V.hostPlaqueMin, ...hostLines.map((l) => (hostLines.length > 1 ? l.lineW : l.plaqueW)));
  const a = arrange(blocks);
  const fleet: Entity = { id: "village", kind: "host", name: "Fleet", host: "village", position: { q: 0, r: 0 }, stale: !allHosts.some((h) => h.online) };
  buildSquare(fleet, a, hostLines, plaqueW, 0, 0, 0);

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
    const statsW = measure(stats.length ? stats.map((s) => s.text).join(" · ") : "No load reading", "stats");
    // Alone, its name over its load; with others, both on one line.
    const plaqueW = Math.max(V.hostPlaqueMin, Math.ceil(measure(title, "host") + 80), Math.ceil(statsW + 90));
    const lineW = Math.ceil(measure(title, "host") * 0.85 + statsW + 110);
    return { id: host.key, title, stats, online: host.online, plaqueW, lineW };
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

  function buildSquare(entity: Entity, a: Arranged, hosts: VSquare["hosts"], plaqueW: number, ox: number, oy: number, index: number) {
    const m = measureSquare(a, plaqueW);
    const cx = ox + V.marginLeft + m.left;
    const baseOf = (half: -1 | 1, row: number) => oy + m.feet.find((f) => f.half === half && f.row === row)!.base;
    const online = !entity.stale;
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
    // One line per host beneath the first's (name, then its load).
    const plaqueH = V.hostPlaqueH + (Math.max(1, hosts.length) - 1) * V.hostLineH;
    const plaque = { x: cx - plaqueW / 2, y: ring.y + ring.h - V.hostPlaqueH * 0.8, w: plaqueW, h: plaqueH };
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
    // (Its near bank tucked under the right-hand halls' eaves.)
    const riverX = cx + m.right - 170;
    const cropRight = riverX + V.riverW * 0.35;
    // The cliff at the river's head: its top at the square's edge, a middle, then its foot into the river.
    const cliffW = V.riverW + 16, ck = cliffW / FRAMES["cliff-top"]!.w;
    const cliffTop = { x: riverX + V.riverW / 2 - cliffW / 2, y: Math.max(oy - 6, topBase - maxAbove(a) - 20), w: cliffW, h: FRAMES["cliff-top"]!.h * ck };
    const cliffMid = { ...cliffTop, y: cliffTop.y + cliffTop.h - 1, h: FRAMES["cliff-mid"]!.h * ck * 0.6 };
    const cliff = { top: cliffTop, mid: cliffMid, foot: { ...cliffTop, y: cliffMid.y + cliffMid.h - 1, h: FRAMES["cliff-foot"]!.h * ck } };
    const moatY = footY + 4;
    // The foreground: a big near wall, its moat and a wide bridge (the concept's foreground scale).
    const wallY = footY + V.moatH - 24;
    const bridgeW = V.road + 120;
    const bridgeSpec = FRAMES.bridge!;
    const bridgeH = (bridgeSpec.h * bridgeW) / bridgeSpec.w;
    const bridge = { x: cx - bridgeW / 2, y: wallY + V.wallH + 6 - bridgeH, w: bridgeW, h: bridgeH };
    const gap = bridgeW / 2 + 60;
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
      hosts,
      roads,
      plaza,
      lamps,
      pennants: [{ x: cx - V.ringW / 2 - 4, y: ringC + 40 }, { x: cx + V.ringW / 2 + 4, y: ringC + 40 }],
      // Lanterns on the bridge's front posts.
      bridgeLamps: [{ x: cx - bridgeW * 0.42, y: bridge.y + bridge.h * 0.3 }, { x: cx + bridgeW * 0.42, y: bridge.y + bridge.h * 0.3 }],
      // Navy banners hung on the wall either side of the bridge, the host's emblem on them.
      wallBanners: [{ x: cx - gap - 230, y: wallY + 12 }, { x: cx + gap + 230, y: wallY + 12 }],
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
      // (from just inside the plaza's left edge, which the panel may cover, to the gorge's near half at the right)
      // (the panel may lie over the top-left hall's left eave, as the concept's does; `keep` is filled in once the halls are)
      // (a strip of canopy above the top banners, the wall cut through below the bridge, the gorge's near half at the right)
      keep: { x: px0 + 40, y: topBase - maxAbove(a) - 110, w: riverX + V.riverW * 0.75 - (px0 + 40), h: wallY + V.wallH * 0.3 - (topBase - maxAbove(a) - 110) },
      heart: { x: px0 - 150, y: topBase - maxAbove(a) - 24, w: cropRight - (px0 - 150), h: wallY + V.wallH * 0.75 - (topBase - maxAbove(a) - 24) },
      bridge,
      walls: [
        { x: ox, y: wallY, w: cx - gap - ox, h: V.wallH },
        { x: cx + gap, y: wallY, w: riverX + 10 - (cx + gap), h: V.wallH },
      ],
      towers: [
        { x: cx - gap, y: wallY + V.wallH + 8 },
        { x: cx + gap, y: wallY + V.wallH + 8 },
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
      // The agents hall's robots: shoulder to shoulder in ledge rows, oldest first, centred on the hall.
      const robotRows: Pt[][] = [];
      for (let r = 0; r < b.rows && b.hall === "agents"; r++) {
        const count = Math.min(b.perRow, b.robots - r * b.perRow);
        robotRows.push(Array.from({ length: count }, (_, k) => ({ x: mid + (k - (count - 1) / 2) * V.pitch, y: base + V.feetY + r * V.robotRow })));
      }
      // A ledge along its front (and one per further row of robots or bays).
      const ledgeL = Math.min(body.x + b.w * 0.06, x0 + 20), ledgeR = Math.max(body.x + b.w * 0.94, x0 + b.width - 20);
      const porches: Rect[] = [];
      const rowsBelow = b.hall === "agents" ? b.rows : 1;
      for (let r = 0; r < rowsBelow; r++) {
        const pts = robotRows[r] ?? [];
        const l = pts.length ? Math.min(ledgeL, pts[0]!.x - V.pitch / 2 - 6) : ledgeL;
        const rr = pts.length ? Math.max(ledgeR, pts[pts.length - 1]!.x + V.pitch / 2 + 6) : ledgeR;
        // The workshop's robots stand on a raised stone platform as wide as the building; the other halls have a ledge.
        if (b.hall === "agents") porches.push({ x: Math.min(l, body.x + 8), y: base + V.porchY - 14 + r * V.robotRow, w: Math.max(rr, body.x + body.w - 8) - Math.min(l, body.x + 8), h: V.porchH + 34 });
        else porches.push({ x: l, y: base + V.porchY + r * V.robotRow, w: rr - l, h: V.porchH });
      }
      const porch = union(porches);
      projects.push({
        key: `hall:${b.hall}`,
        host: "village",
        hall: b.hall,
        name: b.name,
        icon: "layers",
        emblem: b.emblem,
        building: b.building,
        square: index,
        block: { x: x0, y: base - b.above, w: b.width, h: b.above + b.below },
        body,
        base,
        banner,
        plaque: plaqueRect,
        porch,
        porches,
        ledge: true,
        lamps: [
          { x: porches[0]!.x - 14, y: porches[0]!.y + V.porchH - 4 },
          { x: porches[0]!.x + porches[0]!.w + 14, y: porches[0]!.y + V.porchH - 4 },
        ],
        rect: union([banner, body]),
        stale: false,
      });
      for (const { bay, slot: k, row } of b.bays) {
        const bcx = slotX(k);
        const rowBase = base + row * bayStep(b.pitch);
        const fw = b.pitch * V.frameW;
        const frame = boxOf("tile-frame", bcx, rowBase + V.frameFeet, fw);
        const tileSize = frame.w * 0.8;
        const tileAt = { x: bcx, y: frame.y + frame.h * 0.42 };
        const plateW = b.pitch - 6;
        // Under its tile, across the frame's foot (robots stand only in the workshop, whose arches hold no tiles).
        const plate = { x: bcx - plateW / 2, y: frame.y + frame.h - V.plateH * 0.6, w: plateW, h: V.plateH };
        const arch = k < 0 || k > 3 || row > 0 ? boxOf("bay-arch", bcx, rowBase, b.pitch) : undefined;
        const top = arch ? Math.min(arch.y, frame.y) : frame.y - 12;
        const rect = { x: bcx - b.pitch / 2 + 2, y: top, w: b.pitch - 4, h: frame.y + frame.h - top };
        if (bay.kind === "tile") {
          tiles.push({ id: bay.id, hall: bay.hall, key: bay.key, tile: bay.tile, frame, tileAt, tileSize, plate, rect });
          continue;
        }
        const c = bay.c;
        const online = onlineOf.get(bay.host) ?? false;
        const wsEntity: Entity = {
          id: c.key,
          kind: "workspace",
          name: c.name,
          host: bay.host,
          project: bay.project,
          position: { q: 0, r: 0 },
          stale: !!c.stale || !online,
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
        const states = c.agents.map((key) => agentRows.get(key)?.state).filter((x): x is State => !!x);
        workspaces.push({
          entity: wsEntity,
          project: `hall:${b.hall}`,
          square: index,
          rect,
          ...(arch ? { arch } : {}),
          frame,
          tile: "none",
          tileAt,
          tileSize,
          plate,
          label: plateLabel(c.name),
          status: workspaceStatus(states, online),
          flags,
          ...(sealOn ? { seal: { x: sealOn.x + 7, y: sealOn.y - 7, size: 10 } } : {}),
          agents: c.agents,
        });
      }
      // Every agent of the fleet, as a robot on the workshop's ledge.
      if (b.hall === "agents") {
        const pts = robotRows.flat();
        fleetAgents.forEach((row, i) => {
          const feet = pts[i]!;
          const ws = row.workspace && workspaceKeys.has(row.workspace) ? row.workspace : "";
          agents.push({
            robot: robotColor(row.model),
            drones: (row.subagentModels ?? []).map(robotColor),
            entity: agentEntity(row, { workspace: ws, project: row.project ?? (ws ? projectOf.get(ws) : undefined) }, onlineOf.get(row.host) ?? false),
            feet,
            rect: { x: feet.x - V.pitch / 2 + 2, y: feet.y - V.robotH + 2, w: V.pitch - 4, h: V.robotH + 4 },
            square: index,
          });
        });
      }
    }
  }

  const sq0 = squares[0]!;
  const bounds = { ...sq0.rect };

  // A square's `keep` starts at the leftmost thing its top-left hall says (its first tile, plaque or banner); the panel may
  // lie over the eave beyond it.
  for (const [i, sq] of squares.entries()) {
    const top = projects.filter((p) => p.square === i && p.base < sq.ring.y);
    if (!top.length) continue;
    const said = top.flatMap((p) => [p.plaque, p.banner, ...workspaces.filter((w) => w.project === p.key && w.square === i).map((w) => w.frame), ...tiles.filter((t) => `hall:${t.hall}` === p.key).map((t) => t.frame)]);
    const x = Math.min(...said.map((r) => r.x)) - 12;
    if (x > sq.keep.x) sq.keep = { ...sq.keep, x, w: sq.keep.x + sq.keep.w - x };
  }
  const decor = sceneryOf(squares, projects, workspaces, agents, tiles);

  const entities = [...workspaces.map((w) => w.entity), ...agents.map((a) => a.entity)];
  const states = agents.map((a) => a.entity.state!);
  const dash = (d: DashboardCounts | null | undefined, keys: string[]) => {
    const ok = d?.state === "ok" && d.counts;
    const by = Object.fromEntries(keys.map((k) => [k, ok ? (d!.counts![k] ?? 0) : 0]));
    const atLeast = ok ? (d!.atLeast ?? []).filter((k) => keys.includes(k)) : [];
    return { known: !!ok, total: keys.reduce((n, k) => n + (by[k] ?? 0), 0), by, atLeast, why: ok ? "" : (d?.message ?? (d === undefined || d === null ? "" : "Not available")) };
  };
  const counts: VillageCounts = {
    hosts: shownHosts.length,
    hostsOffline: shownHosts.filter((h) => !h.online).length,
    prs: dash(data.dashboard?.prs, DASH_TILES.prs.map((t) => t.key)),
    issues: dash(data.dashboard?.issues, DASH_TILES.issues.map((t) => t.key)),
    workspaces: workspaces.length,
    active: workspaces.filter((w) => w.status === "running").length,
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
    squares.map((s) => [s.hosts.map((h) => [h.id, h.title, h.online, h.stats.map((x) => x.text)]), round(s.rect)]),
    projects.map((p) => [p.key, p.building, round(p.block)]),
    tiles.map((t) => [t.id, round(t.rect)]),
    [counts.prs, counts.issues],
    workspaces.map((w) => [w.entity.id, w.entity.name, w.status, round(w.rect), w.flags.map((f) => f.frame), w.entity.probe ? probeGlyph(w.entity.probe) : 0, w.seal ? 1 : 0, w.entity.stale ? 1 : 0]),
    agents.map((a) => [a.entity.id, a.feet.x, a.feet.y]),
  ]);
  const core = sq0.heart;
  const keep = sq0.keep;
  return { bounds, core, keep, squares, projects, tiles, workspaces, agents, decor, entities, counts, signature };
}

const LAMP = { color: 0xffc46a, reach: 70, dy: 14 };
/** Seeded scenery for each square: the river with its banks' rocks and the waterfall's cliff, the foot's moat,
 * wall, towers and pennants, flower beds and grass tufts along the roads, bushes, crates and barrels by the
 * halls, a tent, and woods all round. Never on what the village says, nor (for trees) on its roads. */
function sceneryOf(squares: VSquare[], projects: VProject[], workspaces: VWorkspace[], agents: VAgent[], tiles: VTile[]): VDecor[] {
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
      ...tiles.flatMap((t) => [t.rect, t.plate]),
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
    // A large ruined wall the waterfall pours from, along the gorge's top, and a second stretch running down its near side.
    place({ frame: ruin, x: sq.cliff.top.x + sq.cliff.top.w * 0.32, y: sq.cliff.top.y + sq.cliff.top.h * 1.25, w: 330, layer: "stand" }, false);
    place({ frame: ruin === "ruin-0" ? "ruin-1" : "ruin-0", x: sq.cliff.top.x - 40, y: sq.cliff.top.y + sq.cliff.top.h + 120, w: 300, layer: "stand" });
    // The gorge's near bank: rocks and bushes down its left side.
    for (let y = sq.river.y + 40; y < sq.river.y + sq.river.h - 60; y += 70 + rng() * 40)
      place({ frame: rng() < 0.55 ? `rocks-${Math.floor(rng() * 3)}` : `bush-${Math.floor(rng() * 4)}`, x: sq.river.x + 18 + rng() * 20, y, w: 70 + rng() * 30, layer: "stand" });
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
    for (const t of sq.towers) place({ frame: "wall-tower", x: t.x, y: t.y, w: 190, layer: "stand" }, false);
    // Purple pennants on the wall, and banners on poles either side of the fountain.
    for (const w of sq.walls)
    reserved.push(...decor.filter((d) => d.square === si).map((d) => d.rect));
    // The market tent at the plaza's lower left, fully on it if there's room.
    const wall0 = sq.walls[0]!;
    // At the concept's size, at the plaza's lower left above the wall; it may tuck behind the lower-left hall's corner
    // and the corner tree, but never covers what the village says.
    const stall = boxOf("tent", pave.x + 70, wall0.y + 24, 220);
    const says = [...mine.flatMap((p) => [p.rect, p.plaque, p.porch]), ...workspaces.filter((w) => w.square === si).flatMap((w) => [w.rect, w.plate]), ...agents.filter((a) => a.square === si).map((a) => a.rect)];
    if (!says.some((r) => overlaps(r, stall, 2))) {
      place({ frame: "tent", x: pave.x + 70, y: wall0.y + 24, w: 220, layer: "stand" }, false);
      reserved.push(stall);
      for (const [x2, f] of [[pave.x + 70 - 140, "crates-1"], [pave.x + 70 + 132, "barrel"]] as const) place({ frame: f, x: x2, y: wall0.y + 20, layer: "stand" });
    } else place({ frame: "tent", x: pave.x - 40, y: pave.y + pave.h + 30, w: 200, layer: "stand" });
    // Big lush trees framing the bottom corners in front of the wall: yellow-green at the left, a pink blossom at the right.
    place({ frame: "tree-2", x: pave.x - 90, y: sq.walls[0]!.y + V.wallH + 60, w: 340, layer: "stand" });
    place({ frame: "blossom-0", x: sq.river.x - 40, y: sq.walls[0]!.y + V.wallH + 70, w: 340, layer: "stand" });
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
    // Planters at the halls' front corners.
    for (const p of mine)
      for (const fx of [0.05, 0.95]) place({ frame: "flowerbed", x: p.body.x + p.body.w * fx, y: p.porch.y + p.porch.h + 34, w: 74, layer: "stand" });
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
    // A dense canopy along the top, overlapping, the north road disappearing into it (crowns may spread over each other and
    // the road's far end, never over what the village says or the falls).
    const canopyEnd = pave.y + 60;
    for (let y = R.y + 70; y < canopyEnd; y += 46)
      for (let x = R.x + ((y / 46) % 2) * 40; x < sq.cliff.top.x - 20; x += 82) {
        const w = 170 + rng() * 60;
        const rect = boxOf("tree-0", x, y, w);
        const foot = { x: rect.x + rect.w * 0.2, y: rect.y + rect.h * 0.55, w: rect.w * 0.6, h: rect.h * 0.45 };
        // (Standing behind the halls, which are drawn over them; clear of the lamps and the falls, and off the plaza.)
        if ([sq.waterfall, ...sq.lamps.map((l) => boxOf("lamp-on", l.x, l.y))].some((r) => overlaps(r, rect, 0))) continue;
        if (foot.y + foot.h > pave.y - 10 || mine.some((p) => overlaps(p.rect, foot, 0) && foot.y + foot.h > p.base - 20)) continue;
        if ([...mine.flatMap((p) => [p.plaque, p.porch]), ...workspaces.filter((w) => w.square === si).flatMap((w) => [w.rect, w.frame, w.plate]), ...tiles.flatMap((t) => [t.rect, t.plate])].some((r) => overlaps(r, foot, 0))) continue;
        decor.push({ frame: rng() < 0.15 ? `blossom-${Math.floor(rng() * 3)}` : `tree-${Math.floor(rng() * 6)}`, x, y, rect: boxOf("tree-0", x, y, w), square: si, layer: "stand" });
      }
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
