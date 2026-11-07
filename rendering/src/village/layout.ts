/**
 * The Village's deterministic layout, as the Islands map's hierarchy: hosts hold projects, projects hold workspaces,
 * workspaces hold agents. At the top of the town, either side of the north road, the two dashboard halls (your
 * GitHub pull requests and your Linear issues, four stained-glass tiles each). Below them a district per host (hosts
 * with workspaces, in the Atlas's order via `hostGroups`), districts packed in shelves to suit the map's shape: its own
 * hedged cobbled plaza with its crystal fountain and the host's plaque (the map's only text), a hall per project with
 * workspaces round the fountain (variants seeded per project, neighbours differing), each workspace a cottage in front
 * of its project's hall with a stained-glass pane for its pull request's state, and each agent a robot at its
 * cottage's doorstep (agents without a workspace wait at a camp's tent). Forest fills everything between and around;
 * the river and its falls, the front wall, its bridge and ponds frame the town.
 *
 * Units are the concept's pixels (y down). Pure: no DOM.
 */
import {
  agentEntity,
  byAge,
  hostGroups,
  modelColor,
  random,
  seedOf,
  sortedHosts,
  tileState,
  type AtlasData,
  type Cottage,
  type DashboardCounts,
  type Entity,
  type State,
} from "../world.ts";
import { BEACON_STATES } from "../placement.ts";
import { probeGlyph } from "../probe.ts";
import { projectIcon } from "../dungeon/layout.ts";
import { COTTAGES, FRAMES, anchorShare, type Icon, type TileKind } from "./frames.ts";

export { projectIcon };
export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Village geometry, in the concept's pixels. */
export const V = {
  /** The dashboard halls' width, and the share of it their arches' pitch takes; their tiles stand up in the arches. */
  dashHall: 560,
  archPitch: 0.19,
  frameFeet: -82,
  frameW: 0.84,
  /** A project's hall. */
  hall: 400,
  /** Workspaces' cottages: the widest one's width (about 45% of a hall's), and the robots at their doorstep. */
  cottage: 220,
  robotH: 104,
  pitch: 88,
  /** A cluster's stepping-stone lane's width, the yard between its hall's feet and its first row's roofs, the gap
   * between rows (their walkway), and a cell's room either side. */
  lane: 120,
  /** The street beside lawns below a fountain. */
  street: 90,
  rowGap: 84,
  /** The first row's feet in front of its hall's, and how far its cottages tuck in under the hall's eaves. */
  flank: 26,
  hallInset: 14,
  /** The yard between a hall's feet and its first row's roofs. */
  yard: 46,
  cellPad: 18,
  /** A cluster's lawn round its hall and cottages. */
  lawnPad: 34,
  /** The robots' feet below their cottage's. */
  doorstep: 16,
  /** Gaps: between blocks in a district's column, either side of the fountain, round a district, between districts. */
  blockGap: 96,
  fountainGap: 360,
  districtPad: 56,
  districtGap: 110,
  fountainW: 230,
  ringW: 300,
  hostPlaqueH: 64,
  hostPlaqueMin: 220,
  /** The north road's width, and the walk across the town under the dashboard halls. */
  road: 140,
  walk: 120,
  /** Margins: woods above (the canopy) and to the left (the HUD lies there), the river to the right, the foot below. */
  marginTop: 150,
  marginLeft: 320,
  marginRight: 140,
  riverW: 300,
  moatH: 110,
  wallH: 165,
  marginBottom: 420,
  font: { workspace: 19, project: 38, host: 27, stats: 16 },
  /** A PR medallion on a cottage's roof corners. */
  flag: 20,
};

export type TextKind = keyof typeof V.font;
/** Text width in village px for a kind's type; the bridge measures with the real font. */
export type Measure = (text: string, kind: TextKind) => number;
export const approxMeasure: Measure = (text, kind) => text.length * V.font[kind] * (kind === "stats" ? 0.56 : 0.54);

/** A host's district: its hedged plaza, its fountain and plaque. (`roads` are its paving: the plaza.) */
export type VSquare = {
  host: Entity;
  online: boolean;
  rect: Rect;
  center: Pt;
  fountain: Rect;
  ring: Rect;
  plaque: Rect;
  /** The plaque's lines (one host per district). */
  hosts: { id: string; title: string; stats: { text: string; alert: boolean }[]; online: boolean; plaqueW: number; lineW: number }[];
  roads: Rect[];
  /** The round paving under the fountain's ring. */
  plaza: Rect;
  /** Lamps by the fountain (feet), lit while the district's agents run; `pennants` the two flanking it. */
  lamps: Pt[];
  pennants: Pt[];
};
/** The town round the districts: its roads, the river and its falls, the foot's wall, bridge and ponds. */
export type VTown = {
  rect: Rect;
  roads: Rect[];
  river: Rect;
  waterfall: Rect;
  cliff: { top: Rect; mid: Rect; foot: Rect };
  moat: Rect[];
  bridge: Rect;
  bridgeLamps: Pt[];
  walls: Rect[];
  towers: Pt[];
  lamps: Pt[];
};
/** The two dashboard halls ("GitHub PRs", "Linear Issues"), and a hall per project. */
export type Hall = "prs" | "issues" | "project";
export const HALLS: { hall: "prs" | "issues"; name: string; building: string }[] = [
  { hall: "prs", name: "GitHub PRs", building: "hall-blue" },
  { hall: "issues", name: "Linear Issues", building: "hall-purple" },
];
/** Projects' hall variants: not the dashboards' blue and purple roofs. */
export const PROJECT_HALLS = ["dome-teal", "workshop-rust", "hall-green", "hall-red"] as const;
export type VProject = {
  key: string;
  host: string;
  hall: Hall;
  entity?: Entity;
  name: string;
  icon: Icon;
  building: string;
  square: number;
  /** The whole block: hall and its cottages and robots. */
  block: Rect;
  body: Rect;
  base: number;
  plaque: Rect;
  porch: Rect;
  porches: Rect[];
  ledge: boolean;
  /** Its two lamps (feet), lit while any of its agents runs. */
  lamps: Pt[];
  rect: Rect;
  stale: boolean;
};
/** A dashboard tile: a group of your PRs or issues. */
export type VTile = { id: string; hall: "prs" | "issues"; key: string; tile: TileKind; frame: Rect; tileAt: Pt; tileSize: number; plate: Rect; rect: Rect };
export type VFlag = { workspace: string; flag: string; frame: string; x: number; y: number; size: number };
export type VWorkspace = {
  entity: Entity;
  project: string;
  square: number;
  /** Its cottage (for picking), the cottage's frame name and its body. */
  rect: Rect;
  cottage: string;
  frame: Rect;
  arch?: Rect;
  /** The window's stained-glass pane: its state, its centre and size, and its box. */
  tile: TileKind;
  tileAt: Pt;
  tileSize: number;
  plate: Rect;
  label: string;
  status: "running" | "needs" | "failed" | "idle" | "offline";
  flags: VFlag[];
  seal?: { x: number; y: number; size: number };
  agents: string[];
  /** Its doorstep, where its robots stand: on its cluster's walkway. */
  door: Pt;
};
export type VAgent = { entity: Entity; feet: Pt; rect: Rect; square: number; robot: string; drones: string[] };
/** A cluster's lawn (a project's hall and its cottages, or a camp) and its stepping-stone lane and walkways. */
export type VLawn = { square: number; project: string; rect: Rect; paths: Rect[] };
export type VDecor = {
  frame: string;
  x: number;
  y: number;
  rect: Rect;
  square: number;
  flip?: boolean;
  light?: { color: number; reach: number; dy?: number };
  layer: "ground" | "stand";
  /** Along the paving's boundary (it may lean onto the paving). */
  hedge?: boolean;
};
export type VillageLayout = {
  bounds: Rect;
  /** The crop the camera's fit covers, and within it what it never cuts. */
  core: Rect;
  keep: Rect;
  town: VTown;
  /** A district per host. */
  squares: VSquare[];
  lawns: VLawn[];
  /** The dashboard halls, then the projects' halls. */
  projects: VProject[];
  tiles: VTile[];
  workspaces: VWorkspace[];
  agents: VAgent[];
  decor: VDecor[];
  entities: Entity[];
  counts: VillageCounts;
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

/** Workspace names are cut short past this many characters (the hover card gives the whole). */
export const PLATE_CHARS = 14;
export const plateLabel = (name: string) => (name.length > PLATE_CHARS ? `${name.slice(0, PLATE_CHARS - 1)}…` : name);

/** A workspace's state on its plate's dot: an agent running, one needing you, one failed, all offline, else idle. */
export function workspaceStatus(states: State[], online: boolean): VWorkspace["status"] {
  if (!online) return "offline";
  if (states.some((s) => NEEDS_YOU.includes(s))) return "needs";
  if (states.includes("failed")) return "failed";
  if (states.includes("running")) return "running";
  return "idle";
}

/** A project's (or camp's) block, one cluster on its own lawn, as the Islands map rings a landmark with its workspaces:
 * its hall at the back, its first workspaces' cottages either side of it (oldest left, then right), more in rows in
 * front either side of a stepping-stone lane from the hall's door (two a side), each row's
 * cottages on a walkway of stones along their feet, robots at their doorsteps. Positions are from the hall's door
 * (x the lane's middle, y the hall's feet). */
type Block = {
  key: string;
  host: string;
  project?: AtlasData["projects"][number];
  building?: string;
  cottages: Cottage[];
  /** Each cottage's cell: its width (room for its robots), its row, its left edge from the lane's middle, its frame's width. */
  cells: { w: number; row: number; x: number; frameW: number }[];
  rows: number;
  /** Its reach left and right of the lane's middle, and above and below the hall's feet. */
  left: number;
  right: number;
  width: number;
  above: number;
  below: number;
  /** Each row's feet below the hall's, and its walkway's reach either side of the lane. */
  rowFeet: number[];
  walks: { x0: number; x1: number }[];
};
/** A cottage's frame width: every cottage at one scale (the widest `V.cottage` wide), so none is shrunk to fit. */
const cottageW = (frame: string) => (FRAMES[frame]!.w * V.cottage) / FRAMES["cottage-0"]!.w;
const cottageFrame = (c: Cottage) => (c.camp ? "tent" : COTTAGES[seedOf(c.key) % COTTAGES.length]!);
const frameWOf = (c: Cottage) => (c.camp ? V.cottage * 0.95 : cottageW(cottageFrame(c)));
// The cottage, and its robots fanning out to the right of its doorstep.
const doorOf = (frame: string) => FRAMES[frame]?.doorstep ?? { x: 0.66, y: 0.91, w: 0.29, h: 0.07 };
const cellWidth = (c: Cottage, frameW: number) => {
  const door = doorOf(cottageFrame(c));
  const reach = c.agents.length ? Math.max(frameW, (door.x + door.w / 2) * frameW + V.pitch / 2) : frameW;
  return reach + V.cellPad * 2 + Math.max(0, c.agents.length - 1) * V.pitch * 0.9;
};
function blockOf(host: string, group: ReturnType<typeof hostGroups>[number], building: string | undefined): Block {
  const hallH = building ? (FRAMES[building]!.h * V.hall) / FRAMES[building]!.w : 0;
  // All its cottages in rows in front of the hall, never beside it: two a side of the lane from its door, oldest nearest.
  const perSide = 2;
  const cells: Block["cells"] = [];
  const sides: { l: number; r: number }[] = [];
  group.cottages.forEach((c, i) => {
    const row = Math.floor(i / (perSide * 2));
    const right = i % 2 === 1;
    const frameW = frameWOf(c);
    const w = cellWidth(c, frameW);
    const s = (sides[row] ??= { l: V.lane / 2, r: V.lane / 2 });
    if (right) {
      cells.push({ w, row, x: s.r, frameW });
      s.r += w;
    } else {
      s.l += w;
      cells.push({ w, row, x: -s.l, frameW });
    }
  });
  const rows = sides.length;
  const tall = Math.max(0, ...group.cottages.map((c) => (FRAMES[cottageFrame(c)]!.h * frameWOf(c)) / FRAMES[cottageFrame(c)]!.w));
  // The first row's roofs a yard in front of the hall's feet (a camp's first row at the top).
  const first = (building ? V.yard : 0) + tall;
  const rowFeet = Array.from({ length: rows }, (_, r) => first + r * (tall + V.rowGap));
  const left = Math.max(building ? V.hall / 2 : 0, V.lane / 2, ...sides.map((s) => s.l));
  const right = Math.max(building ? V.hall / 2 : 0, V.lane / 2, ...sides.map((s) => s.r));
  const above = building ? hallH + 10 : 40;
  return {
    key: group.key, host, project: group.project, building, cottages: group.cottages, cells, rows,
    left, right, width: left + right, above,
    below: rows ? rowFeet[rows - 1]! + V.doorstep + 40 : 60,
    rowFeet,
    walks: sides.map((s) => ({ x0: -s.l + V.cellPad, x1: s.r - V.cellPad })),
  };
}

/** A host's district: its fountain plaza at the top, under its gate, and its clusters in rows below it, oldest first,
 * `perRow` to a row, each row centred; a street of paving round every cluster, the district's own hedge ring round all. */
type District = {
  host: AtlasData["hosts"][number];
  perRow: number;
  /** Each cluster: its lawn's left edge and its hall's feet, from the district's top-left. */
  blocks: { block: Block; lx: number; y: number }[];
  width: number;
  height: number;
  /** The fountain's centre line and its top, from the district's top-left. */
  fountainX: number;
  fountainY: number;
  line: VSquare["hosts"][number];
  /** The area its clusters' yards and its fountain plaza cover. */
  built: number;
};
function districtOf(host: AtlasData["hosts"][number], blocks: Block[], line: VSquare["hosts"][number], perRow: number): District {
  const P = V.districtPad;
  const span = (b: Block) => b.width + V.lawnPad * 2;
  const tall = (b: Block) => b.above + b.below + V.lawnPad * 2;
  const fountainH = (FRAMES["fountain-on"]!.h * V.fountainW) / FRAMES["fountain-on"]!.w + V.hostPlaqueH + 60;
  const gap = Math.max(V.fountainGap, line.plaqueW + 30);
  // The fountain's plaza is a slot among its clusters (in the first row's middle), so the rows fill and the clusters stand
  // round it.
  type Item = Block | "fountain";
  const items: Item[] = [...blocks];
  items.splice(Math.min(Math.floor(perRow / 2), blocks.length), 0, "fountain");
  const w = (it: Item) => (it === "fountain" ? gap : span(it));
  const h = (it: Item) => (it === "fountain" ? fountainH : tall(it));
  const rows: Item[][] = [];
  items.forEach((it, i) => (i % perRow === 0 ? rows.push([it]) : rows[rows.length - 1]!.push(it)));
  const rowW = rows.map((r) => r.reduce((n, it) => n + w(it), 0) + V.blockGap * (r.length - 1));
  const width = P * 2 + Math.max(...rowW);
  const placed: District["blocks"] = [];
  let y = P, fountainX = width / 2, fountainY = P;
  rows.forEach((r, i) => {
    let x = (width - rowW[i]!) / 2;
    const rh = Math.max(...r.map(h));
    for (const it of r) {
      if (it === "fountain") {
        fountainX = x + gap / 2;
        fountainY = y + (rh - fountainH) / 2;
      } else placed.push({ block: it, lx: x, y: y + V.lawnPad + it.above });
      x += w(it) + V.blockGap;
    }
    y += rh + V.blockGap;
  });
  const height = y - V.blockGap + P;
  const built = blocks.reduce((n, b) => n + span(b) * tall(b), 0) + gap * fountainH;
  return { host, perRow, blocks: placed, width, height, fountainX, fountainY, line, built };
}

/**
 * Lay the fleet out as the Village. `aspect` is the map's width over its height: the districts are packed in shelves
 * to suit it; `measure` gives label text widths (the bridge's real font).
 */
export function layoutVillage(data: AtlasData, aspect = 1.6, measure: Measure = approxMeasure): VillageLayout {
  const planned = sortedHosts(data).map((host) => ({ host, groups: hostGroups(host, data) }));
  // Hosts without workspaces stay out, unless none has any: then each shows as an empty district.
  const shown = planned.some((h) => h.groups.length) ? planned.filter((h) => h.groups.length) : planned;
  const agentRows = new Map(data.agents.map((a) => [a.key, a]));
  const onlineOf = new Map(data.hosts.map((h) => [h.key, h.online]));

  const hostLine = (host: AtlasData["hosts"][number]): VSquare["hosts"][number] => {
    const title = host.name.toUpperCase() + (host.online ? "" : " · OFFLINE");
    const stats = host.online && host.stats
      ? ([["CPU", host.stats.cpu], ["MEM", host.stats.memory], ["DISK", host.stats.disk]] as const).flatMap(([n, v]) =>
          v === undefined ? [] : [{ text: `${n} ${Math.round(v)}%`, alert: v >= 90 }],
        )
      : [];
    const statsW = measure(stats.length ? stats.map((s) => s.text).join(" · ") : "No load reading", "stats");
    const plaqueW = Math.max(V.hostPlaqueMin, Math.ceil(measure(title, "host") + 80), Math.ceil(statsW + 90));
    return { id: host.key, title, stats, online: host.online, plaqueW, lineW: plaqueW };
  };
  const choices = shown.map(({ host, groups }) => {
    // Projects' halls dealt so neighbours in a district differ, seeded by the project.
    const used: string[] = [];
    const start = seedOf(host.key + "village") % PROJECT_HALLS.length;
    const blocks = groups.map((g) => {
      if (!g.project) return blockOf(host.key, g, undefined);
      let v = (start + seedOf(g.key)) % PROJECT_HALLS.length;
      for (let k = 0; k < PROJECT_HALLS.length && used.includes(PROJECT_HALLS[v]!); k++) v = (v + 1) % PROJECT_HALLS.length;
      used.push(PROJECT_HALLS[v]!);
      if (used.length >= PROJECT_HALLS.length) used.length = 0;
      return blockOf(host.key, g, PROJECT_HALLS[v]!);
    });
    const line = hostLine(host);
    const n = blocks.length + 1;
    return [...new Set([1, 2, 3, 4, n].filter((k) => k <= n))].map((k) => districtOf(host, blocks, line, k));
  });

  // The dashboard halls' row: either side of the north road.
  const dashH = (FRAMES["hall-blue"]!.h * V.dashHall) / FRAMES["hall-blue"]!.w;
  const dashRowW = V.dashHall * 2 + V.road + 120;
  const dashTop = V.marginTop;
  const dashBase = dashTop + dashH + 10;
  const districtsTop = dashBase + V.walk + 40;

  // Shelves: districts in rows, each in the shape and as many to a row as let the fit show the town largest with the
  // fewest gaps (woods only at the edges, as the concept's).
  const shelvesFor = (districts: District[], perRow: number) => {
    const rows: District[][] = [];
    districts.forEach((d, i) => (i % perRow === 0 ? rows.push([d]) : rows[rows.length - 1]!.push(d)));
    const w = Math.max(dashRowW, ...rows.map((r) => r.reduce((s, d) => s + d.width, 0) + V.districtGap * (r.length - 1)));
    const h = rows.reduce((s, r) => s + Math.max(...r.map((d) => d.height)), 0) + V.districtGap * Math.max(0, rows.length - 1);
    return { rows, w, h };
  };
  // Every combination of shapes while there are few, else one cluster count a row for all.
  const combos: District[][] = [];
  if (choices.reduce((n, c) => n * c.length, 1) <= 1500) {
    const walk = (i: number, acc: District[]) => (i === choices.length ? combos.push(acc) : choices[i]!.forEach((d) => walk(i + 1, [...acc, d])));
    walk(0, []);
  } else for (const k of [1, 2, 3, 4, Infinity]) combos.push(choices.map((c) => [...c].reverse().find((d) => d.perRow <= k) ?? c[0]!));
  let best: ReturnType<typeof shelvesFor> | null = null, bestScore = Infinity;
  const view = clamp(aspect * 0.85, 0.5, 2.6);
  for (const districts of combos)
    for (let perRow = 1; perRow <= Math.max(1, districts.length); perRow++) {
      const s = shelvesFor(districts, perRow);
      // What the fit frames: the dashboard halls' tops to the wall, the districts' width.
      const keepW = s.w + 60, keepH = districtsTop - dashTop + 90 + s.h + V.moatH + V.wallH * 0.3;
      const scale = Math.min(view / keepW, 1 / keepH);
      // How much of the town is built (yards and plazas, not bare paving or woods).
      const filled = districts.reduce((n, d) => n + d.built, 0) / (s.w * Math.max(1, s.h));
      // (The HUD's panel takes about a fifth of the view's width at the left: pack for what's left.)
      const score = -scale * (0.5 + 0.5 * filled);
      if (score < bestScore - 1e-12) {
        best = s;
        bestScore = score;
      }
    }
  const shelves = best!;
  const innerW = shelves.w;
  const cx = V.marginLeft + innerW / 2;
  const footY = districtsTop + shelves.h;

  const squares: VSquare[] = [];
  const projects: VProject[] = [];
  const tiles: VTile[] = [];
  const workspaces: VWorkspace[] = [];
  const agents: VAgent[] = [];
  const lawns: VLawn[] = [];

  // The dashboard halls and their tiles.
  HALLS.forEach((spec, i) => {
    const mid = cx + (i === 0 ? -1 : 1) * (V.road / 2 + 40 + V.dashHall / 2);
    const body = boxOf(spec.building, mid, dashBase - 10, V.dashHall);
    const pitch = V.dashHall * V.archPitch;
    projects.push({
      key: `hall:${spec.hall}`, host: "village", hall: spec.hall, name: spec.name, icon: "layers", building: spec.building, square: -1,
      block: { ...body, h: body.h + 20 }, body, base: dashBase - 10, plaque: { x: mid, y: body.y, w: 0, h: 0 },
      porch: { x: body.x, y: dashBase - 10, w: body.w, h: 0 }, porches: [], ledge: false,
      lamps: [{ x: body.x - 14, y: dashBase + 20 }, { x: body.x + body.w + 14, y: dashBase + 20 }], rect: body, stale: false,
    });
    DASH_TILES[spec.hall].forEach((t, k) => {
      const bcx = mid + (k - 1.5) * pitch;
      const frame = boxOf("tile-frame", bcx, dashBase - 10 + V.frameFeet, pitch * V.frameW);
      const tileAt = { x: bcx, y: frame.y + frame.h * 0.42 };
      tiles.push({ id: `tile:${spec.hall}:${t.key}`, hall: spec.hall, key: t.key, tile: t.tile, frame, tileAt, tileSize: frame.w * 0.8, plate: frame, rect: frame });
    });
  });

  // The districts.
  let y = districtsTop;
  for (const row of shelves.rows) {
    const rowW = row.reduce((s, d) => s + d.width, 0) + V.districtGap * (row.length - 1);
    let x = cx - rowW / 2;
    const rowH = Math.max(...row.map((d) => d.height));
    // Each district only as big as its contents (woods round a smaller one).
    for (const d of row) {
      const index = squares.length;
      const dw = d.width;
      const rect = { x, y, w: dw, h: d.height };
      const fcx = x + d.fountainX;
      const fountain = boxOf("fountain-on", fcx, y + d.fountainY + (FRAMES["fountain-on"]!.h * V.fountainW) / FRAMES["fountain-on"]!.w, V.fountainW);
      const ringH = (FRAMES["plaza-ring"]!.h * V.ringW) / FRAMES["plaza-ring"]!.w;
      const ring = { x: fcx - V.ringW / 2, y: fountain.y + fountain.h - ringH * 0.7, w: V.ringW, h: ringH };
      const plaque = { x: fcx - d.line.plaqueW / 2, y: ring.y + ring.h - 10, w: d.line.plaqueW, h: V.hostPlaqueH };
      const plaza = { x: fcx - V.ringW * 0.72, y: ring.y + ring.h / 2 - V.ringW * 0.44, w: V.ringW * 1.44, h: V.ringW * 0.88 };
      const host: Entity = {
        id: d.host.key, kind: "host", name: d.host.name, host: d.host.key, position: { q: 0, r: 0 }, stale: !d.host.online,
        ...(d.host.stats ? { stats: d.host.stats } : {}),
      };
      squares.push({
        host, online: d.host.online, rect, center: { x: fcx, y: fountain.y + fountain.h / 2 }, fountain, ring, plaque, hosts: [d.line],
        roads: [{ x: x + 30, y: y + 30, w: dw - 60, h: d.height - 60 }], plaza,
        lamps: [], pennants: [{ x: fcx - V.ringW / 2 - 6, y: ring.y + ring.h * 0.6 }, { x: fcx + V.ringW / 2 + 6, y: ring.y + ring.h * 0.6 }],
      });
      for (const { block: b, lx: blx, y: by } of d.blocks) {
        const lw = b.width + V.lawnPad * 2;
        const lx = x + blx;
        const mid = lx + V.lawnPad + b.left;
        const base = y + by;
        const online = d.host.online;
        const lawn = { x: lx, y: base - b.above - V.lawnPad, w: lw, h: b.above + b.below + V.lawnPad * 2 };
        // The lane from the hall's door (or the camp's top) down through every row and out through its fence's gate onto
        // the district's paving, and a walkway along each row's feet past every doorstep.
        const paths: Rect[] = [];
        if (b.rows) {
          const laneEnd = lawn.y + lawn.h + 24;
          paths.push({ x: mid - V.lane / 2, y: base, w: V.lane, h: laneEnd - base });
          b.walks.forEach((w, r) => {
            const x0 = Math.min(mid + w.x0, mid - V.lane / 2), x1 = Math.max(mid + w.x1, mid + V.lane / 2);
            paths.push({ x: x0, y: base + b.rowFeet[r]! - 24, w: x1 - x0, h: 82 });
          });
        }
        let body: Rect;
        if (b.building) {
          body = boxOf(b.building, mid, base, V.hall);
          const entity: Entity = { id: b.project!.key, kind: "project", name: b.project!.name, host: d.host.key, position: { q: 0, r: 0 }, stale: !!b.project!.stale || !online };
          projects.push({
            key: b.key, host: d.host.key, hall: "project", entity, name: b.project!.name, icon: projectIcon(b.project!.name, b.project!.key),
            building: b.building, square: index, block: lawn, body, base,
            plaque: { x: mid, y: body.y, w: 0, h: 0 }, porch: { x: body.x, y: base, w: body.w, h: 0 }, porches: [], ledge: false,
            lamps: [{ x: mid - V.lane / 2 - 18, y: base + 30 }, { x: mid + V.lane / 2 + 18, y: base + 30 }], rect: body, stale: entity.stale!,
          });
        } else body = { x: mid, y: base, w: 0, h: 0 };
        lawns.push({ square: index, project: b.key, rect: lawn, paths });
        b.cottages.forEach((c, i) => {
          const cell = b.cells[i]!;
          const ccx = mid + cell.x + V.cellPad + cell.frameW / 2;
          const feet = base + b.rowFeet[cell.row]!;
          const camp = !!c.camp;
          const cottage = cottageFrame(c);
          const spec = FRAMES[cottage]!;
          const frame = boxOf(cottage, ccx, feet, cell.frameW);
          const pane = spec.pane ?? { x: 0.36, y: 0.46, w: 0.28, h: 0.24 };
          const paneRect = { x: frame.x + frame.w * pane.x, y: frame.y + frame.h * pane.y, w: frame.w * pane.w, h: frame.h * pane.h };
          const states = c.agents.map((k) => agentRows.get(k)?.state).filter((s): s is State => !!s);
          const wsEntity: Entity = {
            id: c.key, kind: "workspace", name: c.name, host: d.host.key, project: b.project?.key, position: { q: 0, r: 0 },
            stale: !!c.stale || !online, camp: c.camp,
            ...(c.flags ? { flags: c.flags } : {}), ...(c.probe ? { probe: c.probe } : {}), ...(c.autoMerge ? { autoMerge: true } : {}),
          };
          // Medallions on the roof's corners: CI left, review (and Probe beneath it) right.
          const fy = frame.y + frame.h * 0.18;
          const left = { x: frame.x + 16, y: fy }, right = { x: frame.x + frame.w - 16, y: fy };
          const flags: VFlag[] = [];
          if (c.flags?.ci) flags.push({ workspace: c.key, flag: c.flags.ci, frame: `pr-${c.flags.ci}`, ...left, size: V.flag });
          if (c.flags?.review) flags.push({ workspace: c.key, flag: c.flags.review, frame: `pr-${c.flags.review}`, ...right, size: V.flag });
          if (c.probe) flags.push({ workspace: c.key, flag: "probe", frame: `probe-${c.probe.state}`, x: right.x, y: c.flags?.review ? fy + V.flag + 3 : fy, size: V.flag });
          const sealOn = c.autoMerge ? (flags.find((f) => f.flag === c.flags?.review) ?? flags.find((f) => f.flag === c.flags?.ci)) : undefined;
          workspaces.push({
            entity: wsEntity, project: b.key, square: index, rect: frame, cottage, frame, tile: camp ? "none" : tileOf(c),
            tileAt: { x: paneRect.x + paneRect.w / 2, y: paneRect.y + paneRect.h / 2 }, tileSize: Math.min(paneRect.w, paneRect.h), plate: paneRect,
            label: plateLabel(c.name), status: workspaceStatus(states, online), flags,
            ...(sealOn ? { seal: { x: sealOn.x + 7, y: sealOn.y - 7, size: 10 } } : {}), agents: c.agents,
            door: { x: frame.x + frame.w * (doorOf(cottage).x + doorOf(cottage).w / 2), y: feet + V.doorstep },
          });
          // Its agents on its doorstep, oldest first, more fanning out to its right.
          const door = doorOf(cottage);
          const doorX = frame.x + frame.w * (door.x + door.w / 2);
          c.agents.forEach((key, j) => {
            const row = agentRows.get(key);
            if (!row) return;
            const fx = doorX + j * V.pitch * 0.9;
            const ft = { x: fx, y: feet + V.doorstep };
            agents.push({
              robot: robotColor(row.model), drones: (row.subagentModels ?? []).map(robotColor),
              entity: agentEntity(row, { workspace: c.key, project: b.project?.key }, onlineOf.get(row.host) ?? false),
              feet: ft, rect: { x: fx - V.pitch / 2 + 3, y: ft.y - V.robotH + 2, w: V.pitch - 6, h: V.robotH + 4 }, square: index,
            });
          });
        });
      }
      x += dw + V.districtGap;
    }
    y += rowH + V.districtGap;
  }

  // The town round it all.
  const townW = V.marginLeft + innerW + V.marginRight + V.riverW;
  const riverX = V.marginLeft + innerW + V.marginRight;
  const wallY = footY + V.moatH;
  const bridgeW = V.road + 120;
  const bridgeH = (FRAMES.bridge!.h * bridgeW) / FRAMES.bridge!.w;
  const bridge = { x: cx - bridgeW / 2, y: wallY + V.wallH + 6 - bridgeH, w: bridgeW, h: bridgeH };
  const gap = bridgeW / 2 + 60;
  const cliffW = V.riverW + 16, ck = cliffW / FRAMES["cliff-top"]!.w;
  const cliffTop = { x: riverX + V.riverW / 2 - cliffW / 2, y: dashTop - 120, w: cliffW, h: FRAMES["cliff-top"]!.h * ck };
  const cliffMid = { ...cliffTop, y: cliffTop.y + cliffTop.h - 1, h: FRAMES["cliff-mid"]!.h * ck * 0.6 };
  const cliff = { top: cliffTop, mid: cliffMid, foot: { ...cliffTop, y: cliffMid.y + cliffMid.h - 1, h: FRAMES["cliff-foot"]!.h * ck } };
  const townH = wallY + V.wallH + V.marginBottom - V.moatH - V.wallH;
  const rect = { x: 0, y: 0, w: townW, h: Math.max(townH, wallY + V.wallH + 200) };
  const roads = [
    // The north road into the forest, the walk across under the dashboard halls, the south road to the bridge.
    { x: cx - V.road / 2, y: -20, w: V.road, h: dashBase + 20 },
    { x: V.marginLeft - 20, y: dashBase - 30, w: innerW + 40, h: V.walk },
    { x: cx - V.road / 2, y: footY - 40, w: V.road, h: wallY - footY + 60 },
  ];
  // Each district's gate opens onto a cobbled way up to the paving above it (the walk, or the district above), so every
  // plaza joins the town's roads.
  for (const sq of squares) {
    const r = sq.roads[0]!, gx = sq.center.x;
    const above = [roads[1]!, ...squares.map((o) => o.roads[0]!)].filter((p) => p !== r && p.y + p.h <= r.y + 1 && p.x <= gx - V.road / 2 && p.x + p.w >= gx + V.road / 2);
    const bottom = Math.max(...above.map((p) => p.y + p.h));
    if (Number.isFinite(bottom)) roads.push({ x: gx - V.road / 2, y: bottom - 20, w: V.road, h: r.y - bottom + 40 });
  }
  const town: VTown = {
    rect, roads,
    river: { x: riverX, y: cliff.foot.y + cliff.foot.h - 30, w: V.riverW, h: rect.h - (cliff.foot.y + cliff.foot.h - 30) },
    waterfall: { x: cliffTop.x, y: cliffTop.y, w: cliffTop.w, h: cliff.foot.y + cliff.foot.h - cliffTop.y },
    cliff,
    moat: [{ x: cx - gap - 380, y: footY + 4, w: 400, h: V.moatH }, { x: cx + gap - 20, y: footY + 4, w: 400, h: V.moatH }],
    bridge,
    bridgeLamps: [{ x: cx - bridgeW * 0.42, y: bridge.y + bridge.h * 0.3 }, { x: cx + bridgeW * 0.42, y: bridge.y + bridge.h * 0.3 }],
    walls: [{ x: 0, y: wallY, w: cx - gap, h: V.wallH }, { x: cx + gap, y: wallY, w: riverX + 10 - (cx + gap), h: V.wallH }],
    towers: [{ x: cx - gap, y: wallY + V.wallH + 8 }, { x: cx + gap, y: wallY + V.wallH + 8 }],
    lamps: [
      ...Array.from({ length: Math.max(1, Math.floor(dashBase / 200)) }, (_, k) => [{ x: cx - V.road / 2 - 18, y: 90 + k * 200 }, { x: cx + V.road / 2 + 18, y: 90 + k * 200 }]).flat(),
      { x: cx - gap - 6, y: footY + 34 }, { x: cx + gap + 6, y: footY + 34 },
    ],
  };
  const bounds = { ...rect };

  const decor = sceneryOf(town, squares, lawns, projects, workspaces, agents, tiles);

  // The crop: the dashboard halls' tops to the wall, the woods at the left, the river's near half at the right.
  const said = [...projects.map((p) => p.body), ...workspaces.map((w) => w.frame), ...agents.map((a) => a.rect), ...squares.map((s) => s.plaque)];
  const top = Math.min(...said.map((r) => r.y)) - 70;
  const keepX0 = Math.min(...said.map((r) => r.x)) - 20, keepX1 = Math.max(...said.map((r) => r.x + r.w)) + 20;
  const keep = { x: keepX0, y: top, w: keepX1 - keepX0, h: wallY + V.wallH * 0.3 - top };
  const core = { x: keepX0 - 150, y: top - 20, w: riverX + V.riverW * 0.4 - (keepX0 - 150), h: wallY + V.wallH * 0.75 - (top - 20) };

  const shownProjects = projects.filter((p) => p.entity).map((p) => p.entity!);
  const entities = [...squares.map((s) => s.host), ...shownProjects, ...workspaces.map((w) => w.entity), ...agents.map((a) => a.entity)];
  const states = agents.map((a) => a.entity.state!);
  const dash = (d: DashboardCounts | null | undefined, keys: string[]): DashCount => {
    const ok = d?.state === "ok" && d.counts;
    const by = Object.fromEntries(keys.map((k) => [k, ok ? (d!.counts![k] ?? 0) : 0]));
    const atLeast = ok ? (d!.atLeast ?? []).filter((k) => keys.includes(k)) : [];
    return { known: !!ok, total: keys.reduce((n, k) => n + (by[k] ?? 0), 0), by, atLeast, why: ok ? "" : (d?.message ?? (d === undefined || d === null ? "" : "Not available")) };
  };
  const real = workspaces.filter((w) => !w.entity.camp);
  const counts: VillageCounts = {
    hosts: squares.length,
    hostsOffline: squares.filter((s) => !s.online).length,
    prs: dash(data.dashboard?.prs, DASH_TILES.prs.map((t) => t.key)),
    issues: dash(data.dashboard?.issues, DASH_TILES.issues.map((t) => t.key)),
    workspaces: real.length,
    active: real.filter((w) => w.status === "running").length,
    agents: agents.length,
    running: states.filter((s) => s === "running").length,
    idle: states.filter((s) => s === "idle").length,
    needYou: states.filter((s) => NEEDS_YOU.includes(s)).length,
    unread: states.filter((s) => s === "done").length,
    failed: states.filter((s) => s === "failed").length,
    offline: states.filter((s) => s === "offline").length,
  };
  void byAge;
  const round = (r: Rect) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10);
  const signature = JSON.stringify([
    round(bounds),
    squares.map((s) => [s.hosts.map((h) => [h.id, h.title, h.online, h.stats.map((x) => x.text)]), round(s.rect)]),
    projects.map((p) => [p.key, p.building, round(p.block)]),
    tiles.map((t) => [t.id, round(t.rect)]),
    [counts.prs, counts.issues],
    workspaces.map((w) => [w.entity.id, w.entity.name, w.status, w.tile, round(w.rect), w.flags.map((f) => f.frame), w.entity.probe ? probeGlyph(w.entity.probe) : 0, w.seal ? 1 : 0, w.entity.stale ? 1 : 0]),
    agents.map((a) => [a.entity.id, a.feet.x, a.feet.y]),
  ]);
  return { bounds, core, keep, town, squares, lawns, projects, tiles, workspaces, agents, decor, entities, counts, signature };
}

/** Seeded scenery: the river and its falls with a ruin, the foot's ponds, wall, towers and bridge, corner trees, hedges along
 * every plaza's and road's boundary, planters, crates and barrels by the halls, a canopy above and woods everywhere else.
 * Never on what the village says; greenery never on paving. */
function sceneryOf(town: VTown, squares: VSquare[], lawns: VLawn[], projects: VProject[], workspaces: VWorkspace[], agents: VAgent[], tiles: VTile[]): VDecor[] {
  const decor: VDecor[] = [];
  const rng = random(seedOf(squares.map((s) => s.host.id).join("|") + "scenery"));
  const R = town.rect;
  const says: Rect[] = [
    ...projects.map((p) => p.body), ...tiles.flatMap((t) => [t.rect]), ...workspaces.map((w) => w.frame),
    ...agents.map((a) => ({ ...a.rect, y: a.rect.y - 16, h: a.rect.h + 30 })), ...squares.flatMap((s) => [s.fountain, s.plaque, s.ring]),
    ...squares.flatMap((s) => s.pennants.map((l) => boxOf("lamp-on", l.x, l.y, 34))), ...town.lamps.map((l) => boxOf("lamp-on", l.x, l.y)),
    ...projects.flatMap((p) => p.lamps.map((l) => boxOf("lamp-on", l.x, l.y))),
  ];
  const water = [{ ...town.river, x: town.river.x - 10, w: town.river.w + 20 }, town.waterfall, ...town.moat, ...town.walls.map((w) => ({ ...w, y: w.y - 30, h: w.h + 30 })), town.bridge];
  const paved = [...town.roads, ...squares.flatMap((s) => s.roads)];
  const placed: Rect[] = [];
  const big = (frame: string, w?: number) => /^(tree|blossom|tent)/.test(frame) && !(w !== undefined && w < 110);
  const footOf = (d: { layer: VDecor["layer"] }, rect: Rect) => (d.layer === "stand" && rect.h > 60 ? { x: rect.x + rect.w * 0.2, y: rect.y + rect.h * 0.55, w: rect.w * 0.6, h: rect.h * 0.45 } : rect);
  const place = (d: Omit<VDecor, "rect" | "square"> & { w?: number }, keepClear = true, square = 0) => {
    const rect = boxOf(d.frame, d.x, d.y, d.w);
    const foot = footOf(d, rect);
    if (keepClear) {
      if ([...says, ...water, ...lawns.flatMap((l) => l.paths)].some((r) => overlaps(r, foot, 2))) return false;
      if ((big(d.frame, d.w) || /^(bush|flowers|grass-tufts|rocks)/.test(d.frame)) && paved.some((r) => overlaps(r, foot, 4))) return false;
      if (placed.some((r) => overlaps(r, foot, big(d.frame, d.w) ? -34 : -4))) return false;
      if (foot.x < R.x - 30 || foot.x + foot.w > R.x + R.w + 30 || foot.y > R.y + R.h - 10) return false;
    }
    const { w: _w, ...rest } = d;
    decor.push({ ...rest, rect, square });
    placed.push(foot);
    return true;
  };
  const fixed = (frame: string, rect: Rect, layer: VDecor["layer"], extra: Partial<VDecor> = {}) => decor.push({ frame, x: rect.x, y: rect.y, rect, square: 0, layer, ...extra });
  // The river, its cliff and falls with a ruin beside them; rocks on its bank.
  fixed("river", town.river, "ground");
  fixed("cliff-mid", town.cliff.mid, "ground");
  fixed("cliff-top", town.cliff.top, "ground");
  fixed("cliff-foot", town.cliff.foot, "ground");
  place({ frame: rng() < 0.5 ? "ruin-0" : "ruin-1", x: town.cliff.top.x + town.cliff.top.w * 0.32, y: town.cliff.top.y + town.cliff.top.h * 1.25, w: 330, layer: "stand" }, false);
  for (let y = town.river.y + 40; y < town.river.y + town.river.h - 60; y += 80 + rng() * 40)
    place({ frame: rng() < 0.55 ? `rocks-${Math.floor(rng() * 3)}` : `bush-${Math.floor(rng() * 4)}`, x: town.river.x + 18 + rng() * 20, y, w: 70 + rng() * 30, layer: "stand" });
  // The foot: lily ponds either side of the bridge, the wall and its towers.
  for (const m of town.moat) fixed("moat-pond", m, "ground");
  for (const w of town.walls) fixed("wall-h", w, "stand");
  fixed("bridge", town.bridge, "stand");
  for (const t of town.towers) place({ frame: "wall-tower", x: t.x, y: t.y, w: 190, layer: "stand" }, false);
  for (const m of town.moat)
    for (const fx of [0.06, 0.94]) place({ frame: `rocks-${Math.floor(rng() * 3)}`, x: m.x + m.w * fx, y: m.y + m.h * (0.6 + rng() * 0.3), w: 60 + rng() * 20, layer: "stand" }, false);
  // Hedges along every paved area's boundary: jittered bushes, flowers and tufts, so no edge reads straight.
  const hedge = (r: Rect, open: string, square: number) => {
    const along = (x0: number, y0: number, x1: number, y1: number, inward: Pt) => {
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 40));
      for (let i = 0; i <= n; i++) {
        const t = i / n + (rng() - 0.5) * 0.02, j = (rng() - 0.3) * 22;
        const pt = { x: x0 + (x1 - x0) * t + inward.x * j, y: y0 + (y1 - y0) * t + inward.y * j + 16 };
        // Not where the paving runs on into another paved area.
        const out = { x: pt.x - inward.x * 30, y: pt.y - 16 - inward.y * 30 };
        if (paved.some((o) => o !== r && out.x > o.x && out.x < o.x + o.w && out.y > o.y && out.y < o.y + o.h)) continue;
        const roll = rng();
        const frame = roll < 0.6 ? `hedge-${Math.floor(rng() * 3)}` : roll < 0.85 ? `flowers-${Math.floor(rng() * 4)}` : `bush-${Math.floor(rng() * 4)}`;
        const rect = boxOf(frame, pt.x, pt.y, (frame.startsWith("hedge") ? 92 : frame.startsWith("bush") ? 70 : 54) + rng() * 24);
        if ([...says, ...water].some((s) => overlaps(s, rect, 2))) continue;
        decor.push({ frame, x: pt.x, y: pt.y, rect, square, layer: "stand", hedge: true });
      }
    };
    if (!open.includes("n")) along(r.x, r.y, r.x + r.w, r.y, { x: 0, y: 1 });
    if (!open.includes("s")) along(r.x, r.y + r.h, r.x + r.w, r.y + r.h, { x: 0, y: -1 });
    if (!open.includes("w")) along(r.x, r.y, r.x, r.y + r.h, { x: 1, y: 0 });
    if (!open.includes("e")) along(r.x + r.w, r.y, r.x + r.w, r.y + r.h, { x: -1, y: 0 });
  };
  hedge(town.roads[0]!, "ns", 0);
  hedge(town.roads[1]!, "", 0);
  hedge(town.roads[2]!, "ns", 0);
  for (const link of town.roads.slice(3)) hedge(link, "ns", 0);
  squares.forEach((s, i) => hedge(s.roads[0]!, "", i));
  // Each cluster's lawn: its stepping-stone lane and walkways, a low fence along its front (open where the lane leaves),
  // and greenery along its other edges so no straight edge of grass shows.
  for (const lawn of lawns) {
    const [lane, ...walks] = lawn.paths;
    // The lane and walkways are painted by the bridge (cobble in a wavy outline, grass creeping over its edges).
    const r = lawn.rect;
    // The front: a fence's rails along it, open at its gate where the lane leaves.
    const fy = r.y + r.h + 6;
    const fw = 118;

    const gate = lane ? { x0: lane.x - 14, x1: lane.x + lane.w + 14 } : { x0: r.x + r.w / 2, x1: r.x + r.w / 2 };
    for (const [x0, x1] of [[r.x + 6, gate.x0], [gate.x1, r.x + r.w - 6]] as const) {
      if (x1 - x0 < fw * 0.5) continue;
      const n = Math.max(1, Math.round((x1 - x0) / (fw * 0.92)));
      const step = (x1 - x0) / n;
      for (let k = 0; k < n; k++) {
        const rect = boxOf("fence-h", x0 + step * (k + 0.5), fy, step + 6);
        decor.push({ frame: "fence-h", x: x0 + step * (k + 0.5), y: fy, rect, square: lawn.square, layer: "stand", hedge: true });
      }
    }
    // Where a walkway leaves the lawn, its hedge opens.
    const exits = walks.filter((w) => w.x < r.x || w.x + w.w > r.x + r.w);
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
      const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 34));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const pt = { x: x0 + (x1 - x0) * t + (rng() - 0.5) * 10, y: y0 + (y1 - y0) * t + 18 + (rng() - 0.5) * 10 };
        const roll = rng();
        const frame = roll < 0.6 ? `hedge-${Math.floor(rng() * 3)}` : roll < 0.8 ? `flowers-${Math.floor(rng() * 4)}` : `bush-${Math.floor(rng() * 4)}`;
        const rect = boxOf(frame, pt.x, pt.y, (frame.startsWith("hedge") ? 80 : frame.startsWith("bush") ? 62 : 50) + rng() * 18);
        if ([...says, ...water].some((o) => overlaps(o, rect, 2)) || exits.some((o) => overlaps(o, rect, 6))) continue;
        decor.push({ frame, x: pt.x, y: pt.y, rect, square: lawn.square, layer: "stand", hedge: true });
      }
    };
    edge(r.x, r.y, r.x + r.w, r.y);
    edge(r.x, r.y, r.x, r.y + r.h);
    edge(r.x + r.w, r.y, r.x + r.w, r.y + r.h);
    // The lawn's free grass: a garden of flower beds, flowers, bushes and tufts, a few crates; never on its paths.
    for (let gy = r.y + 70; gy < r.y + r.h - 10; gy += 58 + rng() * 20)
      for (let gx = r.x + 40 + rng() * 30; gx < r.x + r.w - 30; gx += 66 + rng() * 30) {
        if (rng() < 0.2) continue;
        const roll = rng();
        const frame = roll < 0.12 ? (rng() < 0.4 ? `blossom-${Math.floor(rng() * 3)}` : `tree-${Math.floor(rng() * 6)}`) : roll < 0.3 ? "flowerbed" : roll < 0.5 ? `flowers-${Math.floor(rng() * 4)}` : roll < 0.7 ? `bush-${Math.floor(rng() * 4)}` : roll < 0.85 ? "grass-tufts" : "flower-box";
        const w = /^(tree|blossom)/.test(frame) ? 96 + rng() * 10 : frame === "flowerbed" ? 76 : frame.startsWith("bush") ? 60 + rng() * 16 : frame === "flower-box" ? 60 : 44 + rng() * 14;
        const x = gx + (rng() - 0.5) * 20, y = gy + (rng() - 0.5) * 20;
        const rect = boxOf(frame, x, y, w);
        if ([...says, ...lawn.paths].some((o) => overlaps(o, rect, 6)) || placed.some((o) => overlaps(o, rect, -4))) continue;
        if (rect.x < r.x + 8 || rect.x + rect.w > r.x + r.w - 8 || rect.y + rect.h > r.y + r.h - 4) continue;
        decor.push({ frame, x, y, rect, square: lawn.square, layer: "stand" });
        placed.push(rect);
      }
  }
  // Each district's gate at its top, facing the walk.
  squares.forEach((s, i) => {
    const r = s.roads[0]!;
    fixed("district-gate", boxOf("district-gate", s.center.x, r.y + 30, 190), "stand");
    decor[decor.length - 1]!.square = i;
  });
  // By each district's fountain: flower beds round its ring; by each hall: crates, a barrel and planters.
  squares.forEach((s, i) => {
    for (let k = 0; k < 8; k++) {
      const t = Math.PI * (0.1 + 0.8 * (k / 7)) + (k % 2 ? Math.PI : 0);
      place({ frame: "flowerbed", x: s.center.x + Math.cos(t) * (s.ring.w / 2 + 40), y: s.ring.y + s.ring.h / 2 + Math.sin(t) * (s.ring.h / 2 + 26), w: 76, layer: "stand" }, true, i);
    }
  });
  // Big trees framing the foot's corners.
  place({ frame: "tree-2", x: R.x + V.marginLeft - 90, y: town.walls[0]!.y + V.wallH + 60, w: 340, layer: "stand" });
  place({ frame: "blossom-0", x: town.river.x - 40, y: town.walls[0]!.y + V.wallH + 70, w: 340, layer: "stand" });
  // Woods: rows of trees everywhere not paved or said (the canopy tile lies under them all).
  for (let y = R.y + 60; y < R.y + R.h + 40; y += 62 + rng() * 24)
    for (let x = R.x + 10 + rng() * 40; x < R.x + R.w + 10; x += 70 + rng() * 34)
      place({ frame: rng() < 0.18 ? `blossom-${Math.floor(rng() * 3)}` : `tree-${Math.floor(rng() * 6)}`, x, y, w: 150 + rng() * 50, layer: "stand" });
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
