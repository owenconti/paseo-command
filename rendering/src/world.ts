/** Atlas vocabulary, axial geometry and the deterministic world layout.
 * The layout is built from a host-qualified fleet description; it never talks to a daemon. */
export type State =
  | "running"
  | "idle"
  | "done"
  | "approval"
  | "question"
  | "failed"
  | "offline";
export type Model = "teal" | "violet" | "lime" | "blue";
export type Axial = { q: number; r: number };

/** The fleet as the Atlas draws it. Every key is unique across hosts. */
export type AtlasData = {
  hosts: { key: string; name: string; online: boolean; local: boolean }[];
  projects: { key: string; host: string; name: string; stale?: boolean }[];
  workspaces: {
    key: string;
    host: string;
    project?: string;
    name: string;
    stale?: boolean;
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
  /** Robot index within its workspace cell. */
  slot?: number;
  /** Robots beyond the drawn slots. */
  overflow?: number;
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
export const ROBOT_SLOTS = 4;
/** Robot sprite width in world pixels; state markers scale with it. */
export const ROBOT_SIZE = 46;

export const STATE_NAMES: Record<State, string> = {
  running: "Working",
  idle: "Idle",
  done: "Done · waiting for you",
  approval: "Needs approval",
  question: "Has a question",
  failed: "Failed · needs attention",
  offline: "Offline · last known",
};
/** Most urgent first: a workspace tile shows the first state any of its agents has. */
export const STATE_PRIORITY: State[] = [
  "failed",
  "approval",
  "question",
  "done",
  "running",
  "idle",
  "offline",
];
/** Workspace tile colours by state; idle tiles stay plain. */
export const STATE_TILE: Partial<Record<State, number>> = {
  failed: 0xd2452f,
  approval: 0xef9b1b,
  question: 0x3a86d8,
  done: 0xf2c94c,
  running: 0x3fbf86,
  offline: 0x8f8b80,
};
/** The state a workspace's tile shows, or undefined when it has no agents. */
export function tileState(states: State[]): State | undefined {
  return STATE_PRIORITY.find((s) => states.includes(s));
}
export const MODEL_COLORS: Record<Model, number> = {
  teal: 0x25b6b9,
  violet: 0x9962d7,
  lime: 0xa3d640,
  blue: 0x398cdb,
};
const PALETTE: Model[] = ["teal", "violet", "lime", "blue"];

/** Robot colour for a provider/model string. Unknown models keep a stable colour. */
export function modelColor(model: string): Model {
  const m = model.toLowerCase();
  if (/opus/.test(m)) return "teal";
  if (/sonnet|haiku|fable/.test(m)) return "lime";
  if (/sol\b|gpt-6\.1/.test(m)) return "violet";
  if (/gpt|codex|openai|astra/.test(m)) return "blue";
  if (/claude/.test(m)) return "teal";
  return PALETTE[seedOf(m) % PALETTE.length]!;
}
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
/** World structures own whole cells on the same lattice as the land. */
export function footprint(entity: Pick<Entity, "kind" | "position">): Axial[] {
  const offsets = entity.kind === "project" ? LANDMARK : [{ q: 0, r: 0 }];
  return offsets.map((offset) => add(entity.position, offset));
}
/** Where a structure's artwork, banner and hit area centre: the middle of its cells. */
export function structureCentre(entity: Pick<Entity, "kind" | "position">) {
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
/** Where a robot stands inside its shared workspace cell. */
export function robotOffset(slot: number) {
  return (
    [
      { x: -24, y: 18 },
      { x: 24, y: 18 },
      { x: -38, y: -8 },
      { x: 38, y: -8 },
    ][slot] ?? { x: 0, y: 22 }
  );
}

const LANDMARK_ART = ["manor", "observatory", "conservatory"];
const COTTAGE_ART = ["cottage-slate", "cottage-brown"];
/** Open cells between islands of one host, and between hosts (whose land
 * masses need a channel of sea between them). */
const ISLAND_GAP = 1;
const HOST_GAP = 4;
const byName = <T extends { name: string; key: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
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
/** Cottage slots in rows of up to four, from row `top` downward, each row
 * centred as nearly as the offset hex rows allow on x = `centre` (in cells). */
function slotsBelow(count: number, top: number, centre: number): Axial[] {
  const out: Axial[] = [];
  for (let row = 0; out.length < count; row++) {
    const r = top + row,
      n = Math.min(ROW, count - out.length);
    // Cell x positions on row r are integers (even r) or halves (odd r).
    const half = r % 2 === 0 ? 0 : 0.5;
    const start = Math.round(centre - (n - 1) / 2 - half) + half;
    for (let k = 0; k < n; k++) out.push({ q: Math.round(start + k - r / 2), r });
  }
  return out;
}
/** Workspaces per row beneath a landmark. */
const ROW = 4;

type Cottage = {
  key: string;
  name: string;
  stale?: boolean;
  camp?: boolean;
};
/** One island, in its own coordinates: a landmark at the centre (if any)
 * and its workspaces around it. */
type Plan = {
  key: string;
  project?: AtlasData["projects"][number];
  cottages: Cottage[];
  slots: Axial[];
  land: Axial[];
  /** Optional coast cells, outside `radius`. */
  bumps: Axial[];
  radius: number;
};
function plan(
  key: string,
  project: AtlasData["projects"][number] | undefined,
  cottages: Cottage[],
): Plan {
  // The landmark takes the top of the island; its workspaces stand in rows below.
  const core = footprint({ kind: "project", position: { q: 0, r: 0 } });
  const slots = project
    ? slotsBelow(cottages.length, 2, structureCentre({ kind: "project", position: { q: 0, r: 0 } }).x / (HEX_RADIUS * Math.sqrt(3)))
    : slotsBelow(cottages.length, 0, 0);
  const occupied = [
    ...(project ? core : []),
    ...slots,
  ];
  if (!occupied.length) occupied.push({ q: 0, r: 0 });
  const land = new Map<string, Axial>();
  const put = (a: Axial) => land.set(cellKey(a), a);
  // A landmark's rows are exactly its cells, with no spare tiles beside it;
  // land grows around the workspace cottages below.
  const landmarkRows = new Set(project ? core.map((c) => c.r) : []);
  for (const cell of project ? core : []) put(cell);
  for (const cell of project ? slots : occupied)
    for (const d of [{ q: 0, r: 0 }, ...NEIGHBORS]) {
      const a = add(cell, d);
      if (!landmarkRows.has(a.r)) put(a);
    }
  // Structures sit at the very top of their island: no empty coast row above.
  const top = Math.min(...occupied.map((c) => c.r));
  for (const [key, cell] of [...land]) if (cell.r < top) land.delete(key);
  // A seeded, gently irregular coast: some cells of the next ring may join the
  // land. They are added after packing, and only where they keep clear of
  // neighbours, so islands pack by their solid core.
  const inner = Math.max(...[...land.values()].map((c) => distance(c, { q: 0, r: 0 })));
  const rng = random(seedOf(key + "coast"));
  const bumps = ring(inner + 1).filter(
    (cell) =>
      cell.r >= top &&
      !landmarkRows.has(cell.r) &&
      NEIGHBORS.filter((d) => land.has(cellKey(add(cell, d)))).length >= 3 &&
      rng() < 0.35,
  );
  return { key, project, cottages, slots, land: [...land.values()], bumps, radius: inner };
}

/** Plans for one host: a project island each, plus one for unfiled workspaces. */
function hostPlans(host: AtlasData["hosts"][number], data: AtlasData): Plan[] {
  const projects = data.projects.filter((p) => p.host === host.key).sort(byName);
  const known = new Set(projects.map((p) => p.key));
  const workspaces = data.workspaces.filter((w) => w.host === host.key).sort(byName);
  const workspaceKeys = new Set(workspaces.map((w) => w.key));
  const groups = new Map<string, Cottage[]>(projects.map((p) => [p.key, []]));
  const unfiled: Cottage[] = [];
  const groupOf = (project?: string) =>
    project && known.has(project) ? groups.get(project)! : unfiled;
  for (const w of workspaces) groupOf(w.project).push(w);
  // Agents the daemon reports without a workspace wait at a camp on their project's island.
  const homeless = data.agents.filter(
    (a) => a.host === host.key && !(a.workspace && workspaceKeys.has(a.workspace)),
  );
  for (const project of [...new Set(homeless.map((a) => a.project ?? ""))].sort()) {
    const owner = project && known.has(project) ? project : "";
    const key = campKey(host.key, owner);
    const group = groupOf(owner || undefined);
    if (!group.some((c) => c.key === key))
      group.push({ key, name: "No workspace", camp: true });
  }
  const plans = projects.map((p) => plan(p.key, p, groups.get(p.key)!));
  if (unfiled.length || !plans.length)
    plans.push(plan(`unfiled\u001f${host.key}`, undefined, unfiled));
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
  const hostRows = [...data.hosts].sort(
    (a, b) => Number(b.local) - Number(a.local) || byName(a, b),
  );
  const target = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  const plans = hostRows.map((host) => hostPlans(host, data));
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
          art: LANDMARK_ART[seedOf(p.project.key) % LANDMARK_ART.length],
          stale: !!p.project.stale,
        });
      p.cottages.forEach((cottage, j) =>
        workspaces.push({
          id: cottage.key,
          kind: "workspace",
          name: cottage.name,
          host: host.key,
          project: p.project?.key,
          position: add(p.slots[j]!, centre),
          art: cottage.camp
            ? undefined
            : COTTAGE_ART[seedOf(cottage.key) % COTTAGE_ART.length],
          stale: !!cottage.stale,
          camp: cottage.camp,
        }),
      );
    });
    const highest = Math.min(...groupCells.map((c) => c.r));
    hosts.push({
      id: host.key,
      kind: "host",
      name: host.name,
      host: host.key,
      position: groupCells.find((c) => c.r === highest)!,
      stale: !host.online,
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
  const cellOf = new Map(workspaces.map((w) => [w.id, w]));
  const counts = new Map<string, number>();
  const agents: Entity[] = [];
  for (const a of [...data.agents].sort(byName)) {
    if (!online.has(a.host)) continue;
    const home =
      (a.workspace && cellOf.get(a.workspace)) ||
      cellOf.get(campKey(a.host, a.project ?? "")) ||
      cellOf.get(campKey(a.host, ""));
    if (!home) continue;
    const slot = counts.get(home.id) ?? 0;
    counts.set(home.id, slot + 1);
    agents.push({
      id: a.key,
      kind: "agent",
      name: a.name,
      host: a.host,
      project: home.project,
      workspace: home.id,
      position: home.position,
      model: modelColor(a.model),
      modelName: modelName(a.model),
      art: `robot-${modelColor(a.model)}`,
      state: online.get(a.host) ? a.state : "offline",
      subagents: a.subagents ?? 0,
      slot,
    });
  }
  // A cell draws a few robots; the rest are counted on the last visible one.
  for (const agent of agents) {
    const total = counts.get(agent.workspace!)!;
    if (total > ROBOT_SLOTS && agent.slot === ROBOT_SLOTS - 1)
      agent.overflow = total - ROBOT_SLOTS;
  }
  const signature = JSON.stringify([
    islands.map((i) => [i.key, i.name, i.online, i.cells.length]),
    [...projects, ...workspaces, ...agents].map((e) => [
      e.id,
      e.name,
      cellKey(e.position),
      e.slot ?? "",
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
