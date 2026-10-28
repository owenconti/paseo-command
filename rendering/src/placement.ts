/** Where the Atlas's painted structures, banners and robots stand, for any
 * renderer: pure geometry over a layout, with no drawing. */
import {
  HEX_RADIUS,
  ROBOT_SIZE,
  STATE_TILE,
  cellBounds,
  fittedWidth,
  footprint,
  insideFootprint,
  point,
  random,
  seedOf,
  structureCentre,
  tileState,
  type AtlasLayout,
  type Axial,
  type Entity,
  type State,
} from "./world.ts";

type P = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };

/** Each kind's hover border, so what the pointer is over reads at a glance. */
export const HOVER_COLOR: Record<Entity["kind"], number> = {
  host: 0xffffff,
  project: 0xffc83d,
  workspace: 0xff7f32,
  agent: 0x4fe6dc,
};
/** Widest a cottage is drawn, across its workspace's three cells. */
export const COTTAGE_SIZE = 220;
/** How far a cottage stands above the middle of its three cells. */
export const COTTAGE_LIFT = 12;
/** How far landmark art sits above the middle of its cells. */
export const LANDMARK_LIFT = 30;
/** Landmark art as a share of the largest size that fits its cells. */
export const LANDMARK_SCALE: Record<string, number> = {
  manor: 0.78,
  observatory: 0.8,
  conservatory: 0.92,
};
/** How far a garden plant sits beyond its cell's centre, away from the cottage
 * (as a share of the distance between them). */
export const GARDEN_OUT = 0.32;
/** A subagent's drone, and how long it takes to circle its agent (ms). */
export const DRONE_SIZE = 24;
export const DRONE_ORBIT = 7000;
/** The widest a landmark is tried at before it is fitted to its cells. */
const LANDMARK_SIZE = 420;
/** Depths of the painted structures: landmarks, then plants, then cottages. */
const DEPTH = { landmark: 15, plant: 15.5, cottage: 16 };
const STALE_ALPHA = 0.6;

/** A painted structure: `x, y` is the sprite's centre and `width` its display
 * width; its height follows the frame's aspect. Landmarks and cottages carry
 * their `footprint`; garden plants each keep inside one cell of theirs.
 * `entity` is the project or workspace it belongs to. */
export type Placed = {
  frame: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  alpha: number;
  flipX: boolean;
  footprint?: Axial[];
  entity: string;
};

/**
 * Each project's landmark, then each workspace's cottage followed by its
 * garden, in layout order. `sizeOf` gives a frame's natural size; only its
 * proportions decide the fit. Camps have no cottage (see `campFlags`).
 */
export function placeStructures(
  layout: AtlasLayout,
  sizeOf: (frame: string) => { width: number; height: number },
): Placed[] {
  const placed: Placed[] = [];
  for (const p of layout.projects) {
    const at = structureCentre(p),
      cells = footprint(p),
      art = p.art!;
    // Size the building for the courtyard's middle, then lift it toward the
    // top as far as that size still fits inside its cells.
    const frame = sizeOf(art);
    const aspect = frame.width / frame.height;
    const size = fittedWidth(at.x, at.y, aspect, LANDMARK_SIZE, cells) * (LANDMARK_SCALE[art] ?? 0.9);
    let lift = LANDMARK_LIFT;
    while (lift > 0 && fittedWidth(at.x, at.y - lift, aspect, LANDMARK_SIZE, cells) < size) lift -= 2;
    placed.push({
      frame: art,
      x: at.x,
      y: at.y - lift,
      width: size,
      depth: DEPTH.landmark,
      alpha: p.stale ? STALE_ALPHA : 1,
      flipX: false,
      footprint: cells,
      entity: p.id,
    });
  }
  for (const ws of layout.workspaces) {
    if (ws.camp) continue;
    const cells = footprint(ws);
    // The cottage stands in the middle of its three cells, raised a little,
    // so its porch and shrubs don't read as sitting low.
    const middle = structureCentre(ws);
    const y = middle.y - COTTAGE_LIFT;
    const frame = sizeOf(ws.art!);
    placed.push({
      frame: ws.art!,
      x: middle.x,
      y,
      width: fittedWidth(middle.x, y, frame.width / frame.height, COTTAGE_SIZE, cells),
      depth: DEPTH.cottage,
      alpha: ws.stale ? STALE_ALPHA : 1,
      flipX: false,
      footprint: cells,
      entity: ws.id,
    });
    // A tree and shrubs around it: one in each cell, toward the cell's outer
    // side, each kept inside its own cell.
    const rng = random(seedOf(ws.id + "garden"));
    const tree = Math.floor(rng() * cells.length);
    cells.forEach((cell, i) => {
      const c = point(cell);
      const x = c.x + (c.x - middle.x) * GARDEN_OUT,
        y = c.y + (c.y - middle.y) * GARDEN_OUT;
      const name = i === tree ? "trees" : "shrub";
      const size = sizeOf(name);
      // As a sprite scaled to its natural width reports it.
      const natural = ((i === tree ? 56 : 38) / size.width) * size.width;
      placed.push({
        frame: name,
        x,
        y,
        width: Math.min(natural, fittedWidth(x, y, size.width / size.height, 60, [cell])),
        depth: DEPTH.plant,
        alpha: ws.stale ? STALE_ALPHA : 1,
        // Mirrored at random for variety; never rotated, so it stays inside its cell.
        flipX: rng() < 0.5,
        entity: ws.id,
      });
    });
  }
  return placed;
}

/** Where each camp's flag stands: the daemon reports its agents without a workspace. */
export function campFlags(layout: AtlasLayout): P[] {
  return layout.workspaces.filter((ws) => ws.camp).map((ws) => structureCentre(ws));
}

export type Label = { kind: "host" | "project"; x: number; y: number; text: string; maxWidth: number; faded: boolean };

/** The world's banners: each project's below its landmark, in layout order,
 * then each host's on its landmass's northern shore. */
export function labels(layout: AtlasLayout): Label[] {
  const projects = layout.projects.map((p): Label => {
    const at = structureCentre(p);
    return { kind: "project", x: at.x, y: at.y + 112, text: p.name, maxWidth: 250, faded: !!p.stale };
  });
  const hosts = layout.hosts.map((h): Label => {
    const islands = layout.islands.filter((i) => i.host === h.id);
    const online = islands.every((i) => i.online);
    const bounds = cellBounds(islands.flatMap((i) => i.cells));
    return {
      kind: "host",
      x: bounds.x + bounds.width / 2,
      y: bounds.y - HEX_RADIUS * 0.75,
      text: h.name.toUpperCase() + (online ? "" : " · OFFLINE"),
      maxWidth: Math.max(260, bounds.width - 80),
      faded: !online,
    };
  });
  return [...projects, ...hosts];
}

/** Each entity's box, centred on (x, y): where it is focused, and where its
 * hover card points (its top). A project's covers its ten cells, a
 * workspace's its three, a host's its landmass and banner, an agent's its robot. */
export function locations(layout: AtlasLayout): Map<string, Box> {
  const result = new Map<string, Box>();
  for (const p of layout.projects) {
    const at = structureCentre(p);
    result.set(p.id, { x: at.x, y: at.y, width: HEX_RADIUS * Math.sqrt(3) * 4, height: HEX_RADIUS * 5 });
  }
  for (const ws of layout.workspaces) {
    const area = cellBounds(footprint(ws));
    result.set(ws.id, {
      x: area.x + area.width / 2,
      y: area.y + area.height / 2,
      width: area.width,
      height: area.height,
    });
  }
  for (const h of layout.hosts) {
    const bounds = cellBounds(layout.islands.filter((i) => i.host === h.id).flatMap((i) => i.cells));
    result.set(h.id, {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2 - 20,
      width: bounds.width,
      height: bounds.height + 80,
    });
  }
  for (const a of layout.agents) {
    const { x, y } = point(a.position);
    result.set(a.id, { x, y, width: ROBOT_SIZE + 10, height: ROBOT_SIZE + 10 });
  }
  return result;
}

/** Each agent's robot, centred on its own cell: working ones potter about,
 * and running subagents circle it as drones (up to four; none when offline). */
export function robots(
  layout: AtlasLayout,
): { id: string; x: number; y: number; art: string; offline: boolean; busy: boolean; drones: number }[] {
  return layout.agents.map((a) => {
    const { x, y } = point(a.position);
    const offline = a.state === "offline";
    return {
      id: a.id,
      x,
      y,
      art: a.art!,
      offline,
      busy: a.state === "running",
      drones: !a.subagents || offline ? 0 : Math.min(4, a.subagents),
    };
  });
}

/** Props scattered on a landmark's paving: how wide each is drawn, and how
 * many of the scenery kinds a plaza takes (its lamps and beacon always come). */
export const PROP_WIDTH: Record<string, number> = {
  planter: 52,
  topiary: 48,
  flowerbed: 68,
  citrus: 52,
  crates: 54,
  barrels: 52,
  spool: 50,
  workbench: 56,
  lamp: 38,
  beacon: 42,
};
const SCENERY = ["planter", "topiary", "flowerbed", "citrus", "crates", "barrels", "spool", "workbench"];
const PLAZA_SCENERY = 6;
/** States that light a plaza's beacon: an agent there needs you. */
const BEACON_STATES: State[] = ["failed", "approval", "question"];

/** A plaza's lamp or beacon, lit by its project's agents (see `lights`). */
export type Signal = { kind: "lamp" | "beacon"; x: number; y: number; stale: boolean };

/** Whether a world point lands on the opaque art of a sprite placed at
 * `at` (its centre and display width), given its frame's pixels. */
export function artMask(
  pixels: { data: Uint8ClampedArray; width: number; height: number },
  at: { x: number; y: number; width: number },
): (x: number, y: number) => boolean {
  const { data, width, height } = pixels;
  const scale = at.width / width;
  return (x, y) => {
    const fx = Math.floor((x - at.x) / scale + width / 2),
      fy = Math.floor((y - at.y) / scale + height / 2);
    return fx >= 0 && fy >= 0 && fx < width && fy < height && data[(fy * width + fx) * 4 + 3]! > 40;
  };
}

/** Props on a landmark's paving, a stable mix for each project: its lamps
 * and beacon first, then scenery. Each keeps inside the plaza's cells, off
 * the landmark's art (`solid`) and its name (`label`, the banner's reach),
 * and as far from the others as it can. Scenery comes back as sprites to
 * place; the lamps and beacon as signals, drawn lit or not with the agents. */
export function plaza(
  p: Entity,
  solid: (x: number, y: number) => boolean,
  label: Box,
  sizeOf: (frame: string) => { width: number; height: number },
): { props: Placed[]; signals: Signal[] } {
  const cells = footprint(p);
  const rng = random(seedOf(p.id + "plaza"));
  const scenery = [...SCENERY];
  for (let i = scenery.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [scenery[i], scenery[j]] = [scenery[j]!, scenery[i]!];
  }
  const kinds = ["lamp", "lamp", "beacon", ...scenery.slice(0, PLAZA_SCENERY)];
  const area = cellBounds(cells);
  const spots: P[] = [];
  for (let y = area.y; y <= area.y + area.height; y += 8)
    for (let x = area.x; x <= area.x + area.width; x += 8) spots.push({ x, y });
  const placed: { x: number; y: number; hw: number; hh: number }[] = [];
  const props: Placed[] = [];
  const signals: Signal[] = [];
  for (const kind of kinds) {
    const frame = sizeOf(kind);
    const hw = PROP_WIDTH[kind]! / 2,
      hh = (hw * frame.height) / frame.width;
    const free = (x: number, y: number) => {
      // Clear of the plaza's kerb, the landmark, its name and the other props.
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        for (const [px, py] of [
          [x - hw - 10 + (2 * hw + 20) * t, y - hh - 10],
          [x - hw - 10 + (2 * hw + 20) * t, y + hh + 10],
          [x - hw - 10, y - hh - 10 + (2 * hh + 20) * t],
          [x + hw + 10, y - hh - 10 + (2 * hh + 20) * t],
        ] as const)
          if (!insideFootprint(px, py, cells)) return false;
        for (let j = 0; j <= 6; j++)
          if (solid(x - hw - 6 + (2 * hw + 12) * t, y - hh - 6 + (2 * hh + 12) * (j / 6))) return false;
      }
      if (
        x + hw + 6 > label.x &&
        x - hw - 6 < label.x + label.width &&
        y + hh + 6 > label.y &&
        y - hh - 6 < label.y + label.height
      )
        return false;
      return placed.every((o) => Math.abs(o.x - x) > o.hw + hw + 8 || Math.abs(o.y - y) > o.hh + hh + 8);
    };
    // The first goes anywhere it fits; each after it as far from the rest as it can.
    let best: P | undefined,
      bestGap = -1;
    const start = Math.floor(rng() * spots.length);
    for (let k = 0; k < spots.length; k++) {
      const s = spots[(start + k) % spots.length]!;
      const gap = placed.length ? Math.min(...placed.map((o) => Math.hypot(o.x - s.x, o.y - s.y))) : 0;
      if (gap <= bestGap || !free(s.x, s.y)) continue;
      best = s;
      bestGap = gap;
      if (!placed.length) break;
    }
    if (!best) continue;
    placed.push({ ...best, hw, hh });
    if (kind === "lamp" || kind === "beacon") {
      signals.push({ kind, ...best, stale: !!p.stale });
      continue;
    }
    props.push({
      frame: kind,
      x: best.x,
      y: best.y,
      width: hw * 2,
      depth: DEPTH.plant,
      alpha: p.stale ? STALE_ALPHA : 1,
      // Mirrored at random for variety; never rotated, so it keeps its place.
      flipX: rng() < 0.5,
      entity: p.id,
    });
  }
  return { props, signals };
}

/** A plaza signal as the agents light it: lamps burn while any of the
 * project's agents is working; the beacon flares, in the colour of the most
 * urgent, when one needs you. A lit one glows (`reach` world px), breathing
 * over `period` ms from its own `phase`; a beacon also flickers. */
export type Light = Signal & {
  frame: string;
  lit: boolean;
  color: number;
  reach: number;
  period: number;
  phase: number;
  flicker: boolean;
};
export function lights(layout: AtlasLayout, signals: Map<string, Signal[]>): Light[] {
  const out: Light[] = [];
  for (const p of layout.projects) {
    const states = layout.agents.filter((a) => a.project === p.id).map((a) => a.state!);
    const working = states.includes("running");
    const alarm = tileState(states.filter((s) => BEACON_STATES.includes(s)));
    for (const [i, s] of (signals.get(p.id) ?? []).entries()) {
      const lamp = s.kind === "lamp";
      const lit = lamp ? working : !!alarm;
      out.push({
        ...s,
        frame: lit ? `${s.kind}-lit` : s.kind,
        lit,
        color: lamp ? 0xffc35a : alarm ? STATE_TILE[alarm]! : 0,
        reach: lamp ? 38 : 46,
        period: lamp ? 3200 : alarm === "failed" ? 1200 : 1800,
        phase: random(seedOf(`${p.id}${i}flame`))(),
        flicker: !lamp,
      });
    }
  }
  return out;
}
/** A lit signal's glow alpha at `clock` ms; steady with reduced motion. */
export function glowAlpha(l: Pick<Light, "period" | "phase" | "flicker">, clock: number, reduced: boolean): number {
  if (reduced) return 0.8;
  const t = clock / l.period + l.phase;
  const pulse = 0.5 + 0.5 * Math.cos(t * Math.PI * 2);
  const flicker = l.flicker ? 0.15 * Math.sin(clock / 70 + l.phase * 40) * Math.sin(clock / 113) : 0;
  return (l.flicker ? 0.45 + 0.55 * pulse : 0.7 + 0.3 * pulse) + flicker;
}

/** How an agent's state shows on its sand tile: the tile's colour, its
 * border's colour, and how the border moves. Running borders carry a light
 * round them (`running`, ms per lap); states that need you pulse (`pulse`,
 * ms per beat; failures fastest). Idle tiles stay plain sand (no entry). */
export type Tile = {
  id: string;
  x: number;
  y: number;
  state: State;
  color: number;
  fillAlpha: number;
  borderAlpha: number;
  pulse?: number;
  running?: number;
  /** Each tile starts at its own point in the cycle, so they never move together. */
  phase: number;
};
export const PULSE_MS: Partial<Record<State, number>> = { failed: 1200, approval: 1800, question: 1800, done: 3200 };
export const RUNNING_LAP_MS = 2200;
export function tiles(layout: AtlasLayout): Tile[] {
  const out: Tile[] = [];
  for (const a of layout.agents) {
    const state = a.state!;
    const color = STATE_TILE[state];
    if (color === undefined) continue;
    const offline = state === "offline";
    out.push({
      id: a.id,
      ...point(a.position),
      state,
      color,
      fillAlpha: offline ? 0.25 : 0.42,
      borderAlpha: offline ? 0.6 : 0.95,
      pulse: PULSE_MS[state],
      running: state === "running" ? RUNNING_LAP_MS : undefined,
      phase: random(seedOf(a.id + "pulse"))(),
    });
  }
  return out;
}
/** A pulsing border's alpha at `clock` ms; solid with reduced motion. */
export function pulseAlpha(period: number, phase: number, clock: number, reduced: boolean): number {
  if (reduced) return 1;
  const t = clock / period + phase;
  return 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(t * Math.PI * 2));
}
