/** Atlas vocabulary, axial geometry and the deterministic world layout.
 * The layout is built from a host-qualified fleet description; it never talks to a daemon. */
import { prFlags, type PrFlag } from "./prStatus.ts";
import { probeGlyph, type ProbeVerdict } from "./probe.ts";
export type State =
  | "running"
  | "idle"
  | "done"
  | "approval"
  | "question"
  | "asking"
  | "failed"
  | "offline";
export type Model = "orange" | "white" | "teal" | "violet" | "lime" | "blue";
export type Axial = { q: number; r: number };

/** A host machine's load (the host-stats plugin), as whole-machine percents;
 * a figure it couldn't read is left out. */
export type HostStats = { cpu?: number; memory?: number; disk?: number };

/** The fleet as the Atlas draws it. Every key is unique across hosts. */
export type AtlasData = {
  hosts: { key: string; name: string; online: boolean; local: boolean; stats?: HostStats }[];
  projects: { key: string; host: string; name: string; stale?: boolean }[];
  workspaces: {
    key: string;
    host: string;
    project?: string;
    name: string;
    stale?: boolean;
    /** Its Paseo labels; the PR status ones plant flags. */
    labels?: string[];
    /** Probe's verdict on its PR: a medallion of its own. */
    probe?: ProbeVerdict;
    /** Its PR has auto-merge on: a medallion on a flag's pole. */
    autoMerge?: boolean;
  }[];
  agents: {
    key: string;
    host: string;
    project?: string;
    workspace?: string;
    name: string;
    /** Provider and model, for example `claude/claude-opus-5-5`. */
    model: string;
    state: State;
    /** Subagents running now. */
    subagents?: number;
    /** When it was created (ISO 8601): older agents take the nearer cells. */
    created?: string;
  }[];
};

export type Entity = {
  id: string;
  kind: "host" | "project" | "workspace" | "agent";
  name: string;
  host: string;
  project?: string;
  workspace?: string;
  position: Axial;
  art?: string;
  state?: State;
  model?: Model;
  modelName?: string;
  subagents?: number;
  stale?: boolean;
  /** A workspace standing in for agents the daemon reports without one. */
  camp?: boolean;
  /** The cells it owns when they aren't fixed by its kind: a workspace's
   * three (its cottage cell, `position`, first). */
  cells?: Axial[];
  /** A workspace's PR flags, from its labels: CI in its second cell, review in its third. */
  flags?: { ci?: PrFlag; review?: PrFlag };
  /** Probe's verdict, while its review flag stands. */
  probe?: ProbeVerdict;
  /** Its PR has auto-merge on, while a PR flag stands. */
  autoMerge?: boolean;
  /** A host's machine load, shown on its banner. */
  stats?: HostStats;
};

export type Island = {
  /** The project's key, or a host-level key for workspaces without a project. */
  key: string;
  host: string;
  name: string;
  online: boolean;
  local: boolean;
  cells: Axial[];
};

export type AtlasLayout = {
  hosts: Entity[];
  projects: Entity[];
  workspaces: Entity[];
  agents: Entity[];
  islands: Island[];
  /** Each host's landmass: the grass hexes its project islands sit on. */
  land: { host: string; online: boolean; cells: Axial[] }[];
  entities: Entity[];
  /** Changes whenever any cell assignment changes. */
  signature: string;
};

export const HEX_RADIUS = 68;
/** Robot sprite width in world pixels; state markers scale with it. */
export const ROBOT_SIZE = 84;

export const STATE_NAMES: Record<State, string> = {
  running: "Working",
  idle: "Idle",
  done: "Done · waiting for you",
  approval: "Needs approval",
  question: "Has a question",
  asking: "Reply waits on you",
  failed: "Failed · needs attention",
  offline: "Offline · last known",
};
/** Most urgent first. */
export const STATE_PRIORITY: State[] = [
  "failed",
  "approval",
  "question",
  "asking",
  "done",
  "running",
  "idle",
  "offline",
];
/** Agent tile colours by state; idle tiles stay plain. */
export const STATE_TILE: Partial<Record<State, number>> = {
  failed: 0xd2452f,
  approval: 0xef9b1b,
  question: 0x3a86d8,
  asking: 0xa070e0,
  done: 0xf2c94c,
  running: 0x3fbf86,
  offline: 0x8f8b80,
};
/** The state a workspace's tile shows, or undefined when it has no agents. */
export function tileState(states: State[]): State | undefined {
  return STATE_PRIORITY.find((s) => states.includes(s));
}
export const MODEL_COLORS: Record<Model, number> = {
  orange: 0xd97757,
  white: 0xeeeae2,
  teal: 0x25b6b9,
  violet: 0x9962d7,
  lime: 0xa3d640,
  blue: 0x398cdb,
};
const PALETTE: Model[] = ["teal", "violet", "lime", "blue"];

/** Robot colour for a provider/model string: Claude's orange, ChatGPT's white.
 * Other providers keep a stable colour of their own. */
export function modelColor(model: string): Model {
  const m = model.toLowerCase();
  if (/claude|opus|sonnet|haiku|fable|anthropic/.test(m)) return "orange";
  if (/gpt|codex|openai|chatgpt|astra|\bsol\b/.test(m)) return "white";
  return PALETTE[seedOf(m) % PALETTE.length]!;
}
/** The family a robot colour stands for, where it is one maker's. */
export const MODEL_FAMILY: Partial<Record<Model, string>> = {
  orange: "Claude",
  white: "ChatGPT",
};
/** `claude/claude-opus-5-5` → `Claude Opus 5.5`. */
export function modelName(model: string): string {
  const id = model.split("/").pop() || model || "Unknown model";
  return id
    .replace(/^claude-/, "claude ")
    .replace(/-(\d+)-(\d+)(?=$|-)/, " $1.$2")
    .replace(/-/g, " ")
    .replace(/\b(gpt) /i, "$1-")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^Gpt/, "GPT");
}

export const point = ({ q, r }: Axial) => ({
  x: HEX_RADIUS * Math.sqrt(3) * (q + r / 2),
  y: HEX_RADIUS * 1.5 * r,
});
export const cellKey = (a: Axial) => `${a.q},${a.r}`;
const add = (a: Axial, b: Axial) => ({ q: a.q + b.q, r: a.r + b.r });
export const distance = (a: Axial, b: Axial) =>
  Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(a.q + a.r - b.q - b.r),
  );
export const NEIGHBORS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];
export const seedOf = (key: string) => {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
export function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

/** A landmark's ten cells, in rows of 3, 4 and 3, around its anchor cell. */
const LANDMARK: Axial[] = [
  { q: -1, r: -1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -2, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: -2, r: 1 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];
/** World structures own whole cells on the same lattice as the land: a
 * landmark ten, a workspace three and an agent one. */
export function footprint(entity: Pick<Entity, "kind" | "position" | "cells">): Axial[] {
  if (entity.cells) return entity.cells;
  const offsets = entity.kind === "project" ? LANDMARK : [{ q: 0, r: 0 }];
  return offsets.map((offset) => add(entity.position, offset));
}
/** Where a structure's artwork, banner and hit area centre: the middle of its cells. */
export function structureCentre(entity: Pick<Entity, "kind" | "position" | "cells">) {
  const cells = footprint(entity).map(point);
  return {
    x: cells.reduce((sum, c) => sum + c.x, 0) / cells.length,
    y: cells.reduce((sum, c) => sum + c.y, 0) / cells.length,
  };
}
export function insideFootprint(x: number, y: number, cells: Axial[]): boolean {
  return cells.some((cell) => {
    const center = point(cell),
      dx = Math.abs(x - center.x),
      dy = Math.abs(y - center.y);
    return (
      dx <= (HEX_RADIUS * Math.sqrt(3)) / 2 + 0.001 &&
      dy + dx / Math.sqrt(3) <= HEX_RADIUS + 0.001
    );
  });
}
/** Includes the full sprite rectangle, rather than relying on a visual overlap. */
export function fittedWidth(
  x: number,
  y: number,
  aspect: number,
  maximum: number,
  cells: Axial[],
): number {
  const fits = (width: number) => {
    const halfW = width / 2 + 3,
      halfH = width / aspect / 2 + 3;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      if (
        !insideFootprint(x - halfW + 2 * halfW * t, y - halfH, cells) ||
        !insideFootprint(x - halfW + 2 * halfW * t, y + halfH, cells) ||
        !insideFootprint(x - halfW, y - halfH + 2 * halfH * t, cells) ||
        !insideFootprint(x + halfW, y - halfH + 2 * halfH * t, cells)
      )
        return false;
    }
    return true;
  };
  let low = 0,
    high = maximum;
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
}
export function cellBounds(cells: Axial[]) {
  if (!cells.length) return { x: 0, y: 0, width: 1, height: 1 };
  const centers = cells.map(point);
  const halfWidth = (HEX_RADIUS * Math.sqrt(3)) / 2;
  const left = Math.min(...centers.map((p) => p.x)) - halfWidth;
  const right = Math.max(...centers.map((p) => p.x)) + halfWidth;
  const top = Math.min(...centers.map((p) => p.y)) - HEX_RADIUS;
  const bottom = Math.max(...centers.map((p) => p.y)) + HEX_RADIUS;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function landBounds(layout: AtlasLayout) {
  return cellBounds(layout.land.flatMap((mass) => mass.cells));
}
/** Undirected exposed edges, shared by paving, selection and placement diagnostics. */
export function footprintEdges(cells: Axial[]) {
  const result = new Map<
    string,
    { a: { x: number; y: number }; b: { x: number; y: number } }
  >();
  const key = (p: { x: number; y: number }) =>
    `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  for (const cell of cells) {
    const c = point(cell);
    const v = Array.from({ length: 6 }, (_, i) => ({
      x: c.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * HEX_RADIUS,
      y: c.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * HEX_RADIUS,
    }));
    for (let i = 0; i < 6; i++) {
      const a = v[i]!,
        b = v[(i + 1) % 6]!,
        id = [key(a), key(b)].sort().join(":");
      if (result.has(id)) result.delete(id);
      else result.set(id, { a, b });
    }
  }
  return [...result.values()];
}
const LANDMARK_ART = ["manor", "observatory", "conservatory", "clockhall", "library", "lighthouse-workshop", "windmill", "foundry"];
const COTTAGE_ART = ["cottage-slate", "cottage-brown", "cottage-thatch", "cottage-tile", "cottage-turf", "cottage-stone", "cottage-aframe"];
/** Picks art for a key, preferring its seeded choice but taking the least used
 * so far, so neighbours vary rather than colliding on the same hash. */
function pickArt(arts: string[], key: string, used: Map<string, number>) {
  const start = seedOf(key) % arts.length;
  let best = arts[start]!;
  for (let i = 1; i < arts.length; i++) {
    const art = arts[(start + i) % arts.length]!;
    if ((used.get(art) ?? 0) < (used.get(best) ?? 0)) best = art;
  }
  used.set(best, (used.get(best) ?? 0) + 1);
  return best;
}
/** Open cells between islands of one host, and between hosts (whose land
 * masses need a channel of sea between them). */
const ISLAND_GAP = 1;
const HOST_GAP = 3;
/** A–Z, ignoring case and reading numbers whole, as the panel's lists do. */
const names = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const byName = <T extends { name: string; key: string }>(a: T, b: T) =>
  names.compare(a.name, b.name) || a.key.localeCompare(b.key);
const scale = (a: Axial, k: number) => ({ q: a.q * k, r: a.r * k });
const xOf = (a: Axial) => a.q + a.r / 2;
export const campKey = (host: string, project: string) =>
  `camp\u001f${host}\u001f${project}`;

/** The cells at distance `k`, walking from the east corner anticlockwise. */
export function ring(k: number): Axial[] {
  if (k === 0) return [{ q: 0, r: 0 }];
  const out: Axial[] = [];
  let cell = scale(NEIGHBORS[4]!, k);
  for (let side = 0; side < 6; side++)
    for (let step = 0; step < k; step++) {
      out.push(cell);
      cell = add(cell, NEIGHBORS[side]!);
    }
  return out;
}
/** A 60° turn of an axial offset, `k` times. */
function turn(a: Axial, k: number): Axial {
  let x = a.q,
    z = a.r,
    y = -a.q - a.r;
  for (let i = 0; i < ((k % 6) + 6) % 6; i++) [x, y, z] = [-z, -x, -y];
  return { q: x, r: z };
}
/** A workspace's three cells, as it stands below its landmark: a triangle
 * whose point (the cottage) faces up at the landmark, its yard below. */
const WORKSPACE: Axial[] = [
  { q: 0, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];
/** Cells for `count` agents around that workspace, nearest first; at each
 * distance the lowest row first, then outward from the middle, left before
 * right. None stand beside the cottage, toward the landmark. */
function agentCells(count: number): Axial[] {
  const own = new Set(WORKSPACE.map(cellKey));
  const out: Axial[] = [];
  for (let reach = 1; out.length < count; reach++) {
    const found: Axial[] = [];
    for (let r = 1; r <= 1 + reach; r++)
      for (let q = -reach - 2; q <= reach + 1; q++) {
        const cell = { q, r };
        const near = Math.min(...WORKSPACE.map((w) => distance(w, cell)));
        if (near === reach && !own.has(cellKey(cell))) found.push(cell);
      }
    found.sort((a, b) => b.r - a.r || Math.abs(xOf(a)) - Math.abs(xOf(b)) || xOf(a) - xOf(b));
    out.push(...found);
  }
  return out.slice(0, count);
}
/** Where a project's workspaces stand, in order: below its landmark, then
 * lower left, lower right, upper left, upper right and above (degrees, with
 * y down); a seventh starts round again, farther out. */
const SLOT_ANGLES = [90, 150, 30, 210, 330, 270];
/** The turn that points a workspace at its landmark from each slot. */
const SLOT_TURNS = SLOT_ANGLES.map((angle) => {
  let best = 0,
    off = Infinity;
  for (let k = 0; k < 6; k++) {
    const p = point(turn({ q: -1, r: 2 }, k)),
      d = Math.abs(((((Math.atan2(p.y, p.x) * 180) / Math.PI - angle) % 360) + 540) % 360 - 180);
    if (d < off) (off = d), (best = k);
  }
  return best;
});

/** Degrees off its slot's direction a workspace would rather stand than
 * have one of its cells beside another workspace's. */
const CROWDING = 20;

type Cottage = {
  key: string;
  name: string;
  stale?: boolean;
  camp?: boolean;
  /** Its agents' keys, oldest first. */
  agents: string[];
  flags?: { ci?: PrFlag; review?: PrFlag };
  probe?: ProbeVerdict;
  autoMerge?: boolean;
};
type Placed = { cells: Axial[]; agents: Axial[] };
/** One island, in its own coordinates: a landmark at the centre (if any)
 * and its workspaces around it. */
type Plan = {
  key: string;
  project?: AtlasData["projects"][number];
  cottages: Cottage[];
  placed: Placed[];
  land: Axial[];
  /** Optional coast cells, outside `radius`. */
  bumps: Axial[];
  radius: number;
};
/**
 * Workspaces ring their landmark, each touching it, pointing at it, with its
 * agents growing away from it. Each takes the free spot nearest its slot's
 * direction, a cell clear of every other workspace and its agents. If that
 * leaves any unable to touch the landmark, they are packed again side by side
 * so more of them do; any that still can't stand against the ring.
 */
function placeWorkspaces(core: Axial[], cottages: Cottage[]): Placed[] {
  const apart = packWorkspaces(core, cottages, true);
  if (apart.touching === cottages.length) return apart.placed;
  const tight = packWorkspaces(core, cottages, false);
  return (tight.touching > apart.touching ? tight : apart).placed;
}
/** Degrees between two directions. */
const turnOff = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
/** One packing of a landmark's workspaces: `apart` keeps a clear cell
 * between them; otherwise they may stand side by side, though a spot beside
 * fewer of the others is preferred. */
function packWorkspaces(core: Axial[], cottages: Cottage[], apart: boolean) {
  const coreKeys = new Set(core.map(cellKey));
  const middle = {
    x: core.map(point).reduce((s, p) => s + p.x, 0) / core.length,
    y: core.map(point).reduce((s, p) => s + p.y, 0) / core.length,
  };
  const taken = new Set<string>();
  const near = new Set<string>();
  const placed: Placed[] = [];
  let touching = 0;
  for (const [i, cottage] of cottages.entries()) {
    const angle = SLOT_ANGLES[i % 6]!;
    const all = [...core, ...[...taken].map((key) => {
      const [q, r] = key.split(",").map(Number);
      return { q: q!, r: r! };
    })];
    const rs = all.map((c) => c.r),
      qs = all.map((c) => c.q);
    let best: { anchor: Axial; own: Axial[]; agents: Axial[] } | null = null,
      score = Infinity;
    // Touch the landmark if there's room; otherwise the workspaces around it.
    for (const [touch, clear] of [
      [
        (c: Axial) => NEIGHBORS.some((d) => coreKeys.has(cellKey(add(c, d)))),
        (c: Axial) => !(apart ? near : taken).has(cellKey(c)),
      ],
      [
        (c: Axial) => all.some((o) => distance(o, c) === 1),
        (c: Axial) => !taken.has(cellKey(c)),
      ],
    ] as const) {
      // Apart, each faces its slot; packed tight, any way that still points
      // its cottage at the landmark.
      for (const k of apart ? [SLOT_TURNS[i % 6]!] : [0, 1, 2, 3, 4, 5]) {
        const own = WORKSPACE.map((c) => turn(c, k));
        const agents = agentCells(cottage.agents.length).map((c) => turn(c, k));
        const shape = [...own, ...agents];
        const reach = Math.max(...shape.map((c) => distance(c, { q: 0, r: 0 }))) + 2;
        const outward = point(turn({ q: -1, r: 2 }, k)),
          facing = (Math.atan2(outward.y, outward.x) * 180) / Math.PI;
        for (let r = Math.min(...rs) - reach; r <= Math.max(...rs) + reach; r++)
          for (let q = Math.min(...qs) - reach; q <= Math.max(...qs) + reach; q++) {
            const anchor = { q, r };
            const cells = shape.map((c) => add(anchor, c));
            if (cells.some((c) => coreKeys.has(cellKey(c)) || !clear(c))) continue;
            if (!(apart ? own : own.slice(0, 1)).some((c) => touch(add(anchor, c)))) continue;
            const home = point(anchor);
            const aim = apart ? 0 : turnOff((Math.atan2(home.y - middle.y, home.x - middle.x) * 180) / Math.PI, facing);
            if (aim > 60) continue;
            const at = own.map((c) => point(add(anchor, c)));
            const x = at.reduce((s, p) => s + p.x, 0) / 3 - middle.x,
              y = at.reduce((s, p) => s + p.y, 0) / 3 - middle.y;
            const off = turnOff((Math.atan2(y, x) * 180) / Math.PI, angle);
            const crowding = cells.filter((c) => near.has(cellKey(c))).length;
            const value = off + aim + Math.hypot(x, y) / HEX_RADIUS + crowding * CROWDING;
            if (value < score) (score = value), (best = { anchor, own, agents });
          }
      }
      if (best) break;
    }
    const { anchor, own, agents } = best!;
    const cells = own.map((c) => add(anchor, c)),
      cellsOfAgents = agents.map((c) => add(anchor, c));
    for (const c of [...cells, ...cellsOfAgents]) {
      taken.add(cellKey(c));
      for (const d of [{ q: 0, r: 0 }, ...NEIGHBORS]) near.add(cellKey(add(c, d)));
    }
    placed.push({ cells, agents: cellsOfAgents });
    if (cells.some((c) => NEIGHBORS.some((d) => coreKeys.has(cellKey(add(c, d)))))) touching++;
  }
  return { placed, touching };
}
function plan(
  key: string,
  project: AtlasData["projects"][number] | undefined,
  cottages: Cottage[],
): Plan {
  // The landmark stands in the middle; workspaces without a project gather
  // around a clearing.
  const core = project
    ? footprint({ kind: "project", position: { q: 0, r: 0 } })
    : [{ q: 0, r: 0 }];
  const placed = placeWorkspaces(core, cottages);
  // The island is exactly its built cells, with no open ground around them:
  // the landmark, its workspaces and their agents, on the host's grass.
  const land = [...core, ...placed.flatMap((p) => [...p.cells, ...p.agents])];
  const radius = Math.max(...land.map((c) => distance(c, { q: 0, r: 0 })));
  return { key, project, cottages, placed, land, bumps: [], radius };
}

/** Plans for one host: an island for each project with workspaces, plus one
 * for workspaces without a project. */
function hostPlans(host: AtlasData["hosts"][number], data: AtlasData): Plan[] {
  const projects = data.projects.filter((p) => p.host === host.key).sort(byName);
  const known = new Set(projects.map((p) => p.key));
  const workspaces = data.workspaces.filter((w) => w.host === host.key).sort(byName);
  const workspaceKeys = new Set(workspaces.map((w) => w.key));
  const groups = new Map<string, Cottage[]>(projects.map((p) => [p.key, []]));
  const unfiled: Cottage[] = [];
  const groupOf = (project?: string) =>
    project && known.has(project) ? groups.get(project)! : unfiled;
  const cottages = new Map<string, Cottage>();
  for (const w of workspaces) {
    const flags = prFlags(w.labels);
    const cottage = {
      key: w.key,
      name: w.name,
      stale: w.stale,
      agents: [],
      ...(flags.ci || flags.review ? { flags } : {}),
      ...(w.probe ? { probe: w.probe } : {}),
      ...((flags.ci || flags.review) && w.autoMerge ? { autoMerge: true } : {}),
    };
    cottages.set(w.key, cottage);
    groupOf(w.project).push(cottage);
  }
  // Oldest first, so a new agent never moves the others.
  const agents = data.agents
    .filter((a) => a.host === host.key)
    .sort((a, b) => (a.created ?? "\uffff").localeCompare(b.created ?? "\uffff") || byName(a, b));
  for (const a of agents) {
    let home = a.workspace && workspaceKeys.has(a.workspace) ? cottages.get(a.workspace) : undefined;
    if (!home) {
      // Agents the daemon reports without a workspace wait at a camp on their project's island.
      const owner = a.project && known.has(a.project) ? a.project : "";
      const key = campKey(host.key, owner);
      home = cottages.get(key);
      if (!home) {
        home = { key, name: "No workspace", camp: true, agents: [] };
        cottages.set(key, home);
        groupOf(owner || undefined).push(home);
      }
    }
    home.agents.push(a.key);
  }
  // Projects without workspaces stay off the map.
  const plans = projects
    .filter((p) => groups.get(p.key)!.length)
    .map((p) => plan(p.key, p, groups.get(p.key)!));
  if (unfiled.length) plans.push(plan(`unfiled\u001f${host.key}`, undefined, unfiled));
  return plans;
}

/**
 * Islands packed by their actual cells: each takes the highest, then leftmost,
 * spot within a row width of about `columns` islands where every cell keeps
 * `gap` clear cells from the islands already placed. Returns each centre.
 */
function pack(plans: Plan[], gap: number, columns: number): Axial[] {
  const widest = Math.max(...plans.map((p) => p.radius));
  const width = columns * (2 * widest + gap + 1) - gap - 1;
  const blocked = new Set<string>();
  const halo: Axial[] = [];
  for (let k = 0; k <= gap; k++) halo.push(...ring(k));
  const centres: Axial[] = [];
  for (const plan of plans) {
    const xs = plan.land.map(xOf),
      minX = Math.min(...xs),
      maxX = Math.max(...xs);
    let found: Axial | null = null;
    for (let r = 0; !found; r++)
      for (
        let q = Math.ceil(-minX - r / 2);
        q + r / 2 + maxX <= Math.max(width, maxX - minX);
        q++
      ) {
        const centre = { q, r };
        if (plan.land.every((c) => !blocked.has(cellKey(add(c, centre))))) {
          found = centre;
          break;
        }
      }
    centres.push(found);
    for (const c of plan.land) {
      const cell = add(c, found);
      for (const d of halo) blocked.add(cellKey(add(cell, d)));
    }
  }
  return centres;
}
type Box = { minX: number; maxX: number; minR: number; maxR: number };
function box(cells: Axial[]): Box {
  const xs = cells.map(xOf),
    rs = cells.map((c) => c.r);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minR: Math.min(...rs),
    maxR: Math.max(...rs),
  };
}
/** Width over height of the drawn cells, in world pixels. */
const aspectOf = (b: Box) =>
  ((b.maxX - b.minX + 1) * Math.sqrt(3)) / ((b.maxR - b.minR) * 1.5 + 2);
const misfit = (aspect: number, target: number) => Math.abs(Math.log(aspect / target));

type Group = {
  host: AtlasData["hosts"][number];
  plans: Plan[];
  centres: Axial[];
  cells: Axial[];
};
/** A host's islands in rows of at most `columns`. */
function group(
  host: AtlasData["hosts"][number],
  plans: Plan[],
  columns: number,
): Group {
  const centres = pack(plans, ISLAND_GAP, Math.max(1, Math.min(columns, plans.length)));
  const cells = plans.flatMap((p, i) => p.land.map((c) => add(c, centres[i]!)));
  return { host, plans, centres, cells };
}
/** Shelf-packs host groups: left to right, wrapping when a row would pass `capacity`. */
function arrange(groups: Group[], capacity: number): Axial[] {
  const moves: Axial[] = [];
  let rowTop = 0,
    cursor = 0,
    bottom = 0,
    used = 0;
  for (const g of groups) {
    const b = box(g.cells),
      width = b.maxX - b.minX + 1;
    if (used > 0 && cursor + width > capacity + 1e-9) {
      rowTop = bottom + HOST_GAP;
      cursor = 0;
      used = 0;
    }
    // Two rows of open ground above each group hold its host banner.
    const raw = rowTop + 2 - b.minR;
    const dr = raw % 2 === 0 ? raw : raw + 1;
    const dq = Math.ceil(cursor - (b.minX + dr / 2));
    moves.push({ q: dq, r: dr });
    cursor = b.maxX + dr / 2 + dq + HOST_GAP + 1;
    bottom = Math.max(bottom, b.maxR + dr);
    used++;
  }
  return moves;
}

/**
 * Deterministic layout: one island per project, grouped by host. `aspect` is
 * the viewport's width over height. Every host's islands use the same column
 * limit, and hosts shelf-pack into rows; the limit chosen best matches the
 * viewport's shape with the least empty ground, so a tall map stacks
 * vertically and a wide one spreads out.
 */
export function layoutAtlas(data: AtlasData, aspect = 1.6): AtlasLayout {
  const sorted = [...data.hosts].sort(
    (a, b) => Number(b.local) - Number(a.local) || byName(a, b),
  );
  const target = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  // Hosts without workspaces stay off the map, unless no host has any: then
  // each shows as an open clearing, so the map is never empty.
  const planned = sorted.map((host) => ({ host, plans: hostPlans(host, data) }));
  const shown = planned.some((h) => h.plans.length)
    ? planned.filter((h) => h.plans.length)
    : planned.map(({ host }) => ({
        host,
        plans: [plan(`unfiled\u001f${host.key}`, undefined, [])],
      }));
  const hostRows = shown.map((h) => h.host);
  const plans = shown.map((h) => h.plans);
  const most = Math.max(1, ...plans.map((p) => p.length));
  let groups: Group[] = [];
  let moves: Axial[] = [];
  let bestScore = Infinity;
  for (let columns = 1; columns <= most; columns++) {
    const candidate = hostRows.map((host, i) => group(host, plans[i]!, columns));
    const widest = Math.max(...candidate.map((g) => {
      const b = box(g.cells);
      return b.maxX - b.minX + 1;
    }));
    const total = candidate.reduce((sum, g) => {
      const b = box(g.cells);
      return sum + b.maxX - b.minX + 1 + HOST_GAP + 1;
    }, 0);
    // Try row widths from the widest single host up to everything in one row.
    for (const capacity of [widest, (widest + total) / 2, total]) {
      const placed = arrange(candidate, capacity);
      const cells = candidate.flatMap((g, i) => g.cells.map((c) => add(c, placed[i]!)));
      const b = box(cells);
      const area = (b.maxX - b.minX + 1) * (b.maxR - b.minR + 1);
      const fill = cells.length / area;
      // Hosts stay compact rather than stretching into long strips.
      const stretch = Math.max(...candidate.map((g) => misfit(aspectOf(box(g.cells)), 1.2)));
      const score = misfit(aspectOf(b), target) + 1.4 * (1 - fill) + 0.6 * stretch;
      if (score < bestScore - 1e-9) {
        bestScore = score;
        groups = candidate;
        moves = placed;
      }
    }
  }
  const islands: Island[] = [];
  const hosts: Entity[] = [];
  const projects: Entity[] = [];
  const workspaces: Entity[] = [];
  const bumpsOf = new Map<string, Axial[]>();
  const homes = new Map<string, { workspace: string; project?: string; cell: Axial }>();
  const landmarksUsed = new Map<string, number>();
  groups.forEach(({ host, plans, centres }, g) => {
    const groupCells: Axial[] = [];
    plans.forEach((p, i) => {
      const centre = add(centres[i]!, moves[g]!);
      const cells = p.land.map((c) => add(c, centre));
      bumpsOf.set(p.key, p.bumps.map((c) => add(c, centre)));
      groupCells.push(...cells);
      islands.push({
        key: p.key,
        host: host.key,
        name: p.project?.name ?? host.name,
        online: host.online,
        local: host.local,
        cells,
      });
      if (p.project)
        projects.push({
          id: p.project.key,
          kind: "project",
          name: p.project.name,
          host: host.key,
          position: centre,
          art: pickArt(LANDMARK_ART, p.project.key, landmarksUsed),
          stale: !!p.project.stale,
        });
      const cottagesUsed = new Map<string, number>();
      p.cottages.forEach((cottage, j) => {
        const cells = p.placed[j]!.cells.map((c) => add(c, centre));
        workspaces.push({
          id: cottage.key,
          kind: "workspace",
          name: cottage.name,
          host: host.key,
          project: p.project?.key,
          position: cells[0]!,
          cells,
          art: cottage.camp
            ? undefined
            : pickArt(COTTAGE_ART, cottage.key, cottagesUsed),
          stale: !!cottage.stale,
          camp: cottage.camp,
          ...(cottage.flags ? { flags: cottage.flags } : {}),
          ...(cottage.probe ? { probe: cottage.probe } : {}),
          ...(cottage.autoMerge ? { autoMerge: true } : {}),
        });
        cottage.agents.forEach((agent, n) =>
          homes.set(agent, { workspace: cottage.key, project: p.project?.key, cell: add(p.placed[j]!.agents[n]!, centre) }),
        );
      });
    });
    const highest = Math.min(...groupCells.map((c) => c.r));
    hosts.push({
      id: host.key,
      kind: "host",
      name: host.name,
      host: host.key,
      position: groupCells.find((c) => c.r === highest)!,
      stale: !host.online,
      ...(host.stats ? { stats: host.stats } : {}),
    });
  });
  // Grow each island's optional coast cells where they stay a clear cell from
  // every other island.
  const owner = new Map<string, string>();
  for (const island of islands)
    for (const c of island.cells) owner.set(cellKey(c), island.key);
  for (const island of islands) {
    const bumps = bumpsOf.get(island.key) ?? [];
    for (const cell of bumps) {
      const clear = [{ q: 0, r: 0 }, ...NEIGHBORS].every((d) => {
        const other = owner.get(cellKey(add(cell, d)));
        return !other || other === island.key;
      });
      if (!clear || owner.has(cellKey(cell))) continue;
      island.cells.push(cell);
      owner.set(cellKey(cell), island.key);
    }
  }
  // Each host's land: its islands, the gaps between them, one full ring of
  // grass around them, and any inlet cells (land on three or more sides) filled,
  // so the hex coast stays even with no lone cells sticking out.
  // Land never comes within a channel of another host's.
  const land: AtlasLayout["land"] = [];
  const hostOf = new Map<string, string>();
  for (const host of hostRows) {
    const grown = new Map<string, Axial>();
    for (const island of islands.filter((i) => i.host === host.key))
      for (const c of island.cells)
        for (const d of [{ q: 0, r: 0 }, ...NEIGHBORS]) grown.set(cellKey(add(c, d)), add(c, d));
    for (const c of grown.values()) hostOf.set(cellKey(c), host.key);
    land.push({ host: host.key, online: host.online, cells: [...grown.values()] });
  }
  for (const mass of land) {
    const own = new Set(mass.cells.map(cellKey));
    const extra: Axial[] = [];
    for (const c of mass.cells)
      for (const d of NEIGHBORS) {
        const n = add(c, d);
        if (own.has(cellKey(n)) || extra.some((e) => cellKey(e) === cellKey(n))) continue;
        const near = [{ q: 0, r: 0 }, ...NEIGHBORS, ...ring(2)].some((o) => {
          const h = hostOf.get(cellKey(add(n, o)));
          return h && h !== mass.host;
        });
        const touching = NEIGHBORS.filter((e) => own.has(cellKey(add(n, e)))).length;
        if (!near && touching >= 3) extra.push(n);
      }
    mass.cells.push(...extra);
    for (const c of extra) hostOf.set(cellKey(c), mass.host);
  }
  const online = new Map(hostRows.map((h) => [h.key, h.online]));
  const agents: Entity[] = [];
  // Each agent stands on its own cell beside its workspace.
  for (const a of [...data.agents].sort(byName)) {
    const home = homes.get(a.key);
    if (!home || !online.has(a.host)) continue;
    agents.push({
      id: a.key,
      kind: "agent",
      name: a.name,
      host: a.host,
      project: home.project,
      workspace: home.workspace,
      position: home.cell,
      model: modelColor(a.model),
      modelName: modelName(a.model),
      art: `robot-${modelColor(a.model)}`,
      state: online.get(a.host) ? a.state : "offline",
      subagents: a.subagents ?? 0,
    });
  }
  const signature = JSON.stringify([
    islands.map((i) => [i.key, i.name, i.online, i.cells.length]),
    // Banners repaint when a host's load reads differently.
    hosts.map((h) => [h.id, h.stats ? [h.stats.cpu, h.stats.memory, h.stats.disk].map((v) => (v === undefined ? "" : Math.round(v))) : 0]),
    [...projects, ...workspaces, ...agents].map((e) => [
      e.id,
      e.name,
      footprint(e).map(cellKey).join(" "),
      e.flags ? [e.flags.ci ?? "", e.flags.review ?? ""] : 0,
      e.probe ? [e.probe.state, probeGlyph(e.probe)] : 0,
      e.autoMerge ? 1 : 0,
    ]),
  ]);
  return {
    hosts,
    projects,
    workspaces,
    agents,
    islands,
    land,
    entities: [...hosts, ...projects, ...workspaces, ...agents],
    signature,
  };
}
