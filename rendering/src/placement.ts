/** Where the Atlas's painted structures, banners and robots stand, for any
 * renderer: pure geometry over a layout, with no drawing. */
import {
  HEX_RADIUS,
  ROBOT_SIZE,
  cellBounds,
  fittedWidth,
  footprint,
  point,
  random,
  seedOf,
  structureCentre,
  type AtlasLayout,
  type Axial,
  type Entity,
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
