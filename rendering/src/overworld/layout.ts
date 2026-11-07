// Overworld layout: hosts, projects, workspaces and agents laid out as the user's concept
// rendering lays them out. Units are concept pixels (the concept is ~1200 px wide); the
// painter draws at SCALE world pixels per unit (the sprites are drawn at 4×).

export type Theme = "forest" | "farm" | "volcanic";
export type Roof = "red" | "purple" | "blue" | "green" | "amber" | "teal";
export type Awning = "blue" | "red" | "purple" | "yellow" | "green";

export interface OwAgent {
  id: string;
  /** Robot body colour: a sheet colour or a CSS colour that tints the neutral robot. */
  colour: "orange" | "pearl" | string;
  working: boolean;
}
export interface OwWorkspace {
  id: string;
  name: string;
  agents: OwAgent[];
  awning?: Awning;
  /** Agents the daemon reports without a workspace: a camp rather than a booth. */
  camp?: boolean;
}
export interface OwProject {
  id: string;
  name: string;
  icon: string;
  roof: Roof;
  workspaces: OwWorkspace[];
  /** Workspaces without a project: booths linked from the castle, no hall. */
  hall?: false;
}
export interface OwHost {
  id: string;
  name: string;
  stats?: { cpu: number; mem: number; disk: number };
  theme: Theme;
  offline?: boolean;
  projects: OwProject[];
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  r: number;
}
export interface Island {
  boxes: Box[];
  /** Bays cut out of the coast. */
  bites?: Box[];
  cliff: number;
  seed: number;
  rock: "grey" | "volcanic";
  /** Draw order: lower first. */
  z: number;
}
export interface SpriteItem {
  kind: "sprite";
  sheet: string;
  frame: string;
  x: number;
  y: number;
  scale: number;
  flip?: boolean;
  tint?: string;
  shadow?: number;
  /** Colour grading applied once to the frame. */
  grade?: { brightness?: number; contrast?: number; saturate?: number; hue?: number };
  /** Sort key override (defaults to y). */
  z?: number;
  /** Draw above labels and links (badges on halls, emblems). */
  layer?: "ground" | "world" | "top";
  alpha?: number;
}
export interface BoothItem {
  kind: "booth";
  x: number;
  /** Floor line (robots' feet). */
  y: number;
  w: number;
  awning: Awning;
  awningSide: "left" | "right";
  agents: OwAgent[];
  camp?: boolean;
  z?: number;
}
export interface LabelItem {
  kind: "label";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  size: number;
}
export interface PlaqueItem {
  kind: "plaque";
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  stats?: string;
  online: boolean;
}
export interface Link {
  pts: Array<[number, number]>;
}
export interface Node {
  x: number;
  y: number;
  r: number;
}
export interface River {
  pts: Array<[number, number]>;
  width: number;
}
export interface Fall {
  x: number;
  top: number;
  bottom: number;
  width: number;
}
export interface Strip {
  pts: Array<[number, number]>;
  width: number;
}
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What the map can pick, hover and select, in concept px. */
export interface OwEntity {
  id: string;
  kind: "host" | "project" | "workspace" | "agent";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** Where a robot stands (its feet), in concept px. */
export interface RobotSpot {
  id: string;
  x: number;
  y: number;
  colour: string;
  working: boolean;
}

export interface Scene {
  w: number;
  h: number;
  entities: OwEntity[];
  robots: RobotSpot[];
  islands: Island[];
  items: Array<SpriteItem | BoothItem>;
  labels: Array<LabelItem | PlaqueItem>;
  links: Link[];
  nodes: Node[];
  rivers: River[];
  falls: Fall[];
  paths: Strip[];
  fields: Strip[];
  reserved: Rect[];
  scatter: Array<{ island: number; theme: Theme; area: Rect }>;
  clouds: SpriteItem[];
}

export const SCALE = 4;

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const AWNINGS: Awning[] = ["blue", "red", "purple", "yellow", "red", "purple"];

/** Booth sprites (stalls.json v3): 80 px ends, 216 px per robot slot, floor at 372 of 448. */
export const BOOTH = { scale: 0.19, end: 80, slot: 216, floor: 372, height: 448, minSlots: 3 };

export function boothSlots(robots: number): number {
  return Math.max(BOOTH.minSlots, robots);
}

/** Booth width in concept px for a number of robots. */
export function boothWidth(robots: number): number {
  return (BOOTH.end * 2 + BOOTH.slot * boothSlots(robots)) * BOOTH.scale;
}

const BAND = 340;
const CX = 600;
const MAP_W = 1200;

export interface LayoutOptions {
  /** Whether a host's land is one landmass across its front with a grand stair (the concept's last host). */
  merged?: (host: OwHost, index: number) => boolean;
}

export function layout(hosts: OwHost[], opts: LayoutOptions = {}): Scene {
  const scene: Scene = {
    w: MAP_W,
    h: 0,
    entities: [],
    robots: [],
    islands: [],
    items: [],
    labels: [],
    links: [],
    nodes: [],
    rivers: [],
    falls: [],
    paths: [],
    fields: [],
    reserved: [],
    scatter: [],
    clouds: [],
  };
  let y0 = 0;
  hosts.forEach((host, index) => {
    const merged = opts.merged ? opts.merged(host, index) : index === hosts.length - 1;
    const extra = layoutHost(scene, host, y0, index, merged);
    // Measured from the concept: hosts 360 then 335 apart; taller hosts push the next down.
    y0 += BAND + extra + (index === 0 ? 20 : -5);
  });
  scene.h = y0 + 140;
  return scene;
}

function reserve(scene: Scene, x0: number, y0: number, x1: number, y1: number): void {
  scene.reserved.push({ x0, y0, x1, y1 });
}

/** Each project block's booth rows: workspaces packed left to right within the block's width. */
function boothRows(project: OwProject): OwWorkspace[][] {
  const rows: OwWorkspace[][] = [];
  let row: OwWorkspace[] = [];
  let width = 0;
  for (const ws of project.workspaces) {
    const w = ws.camp ? CAMP_W : boothWidth(ws.agents.length);
    if (row.length && (row.length >= 3 || width + BOOTH_GAP + w > BLOCK_W)) {
      rows.push(row);
      row = [];
      width = 0;
    }
    width += (row.length ? BOOTH_GAP : 0) + w;
    row.push(ws);
  }
  if (row.length) rows.push(row);
  return rows;
}

/** A project row's height past the concept's single row of booths. */
const ROW_H = 230;
const BOOTH_ROW_H = 100;
const BOOTH_GAP = 14;
const BLOCK_W = 500;
const CAMP_W = 190;

function layoutHost(scene: Scene, host: OwHost, y0: number, index: number, last: boolean): number {
  const seed = hash(host.id);
  // Project rows (two projects a row, left and right of the castle) and how far each reaches.
  const rowY: number[] = [];
  let extra = 0;
  for (let r = 0; r * 2 < Math.max(1, host.projects.length); r++) {
    rowY.push(extra);
    const pair = host.projects.slice(r * 2, r * 2 + 2);
    const deepest = Math.max(1, ...pair.map((p) => boothRows(p).length));
    extra += (deepest - 1) * BOOTH_ROW_H + ROW_H;
  }
  extra -= ROW_H;
  // Each side's island reaches only as deep as its own projects.
  const sideExtra = [0, 1].map((side) => {
    let deepest = 0;
    host.projects.forEach((p, i) => {
      if (i % 2 === side) deepest = Math.max(deepest, rowY[Math.floor(i / 2)]! + (boothRows(p).length - 1) * BOOTH_ROW_H);
    });
    return deepest;
  });
  const volcanic = host.theme === "volcanic";
  const rock = volcanic ? "volcanic" : "grey";
  const base = scene.islands.length;

  // Land: a castle island in the middle, a project island each side. Measured from the concept.
  const left: Island = {
    boxes: [
      { x0: 40, y0: y0 + 190, x1: 545, y1: y0 + 412, r: 44 },
      { x0: 100, y0: y0 + 150, x1: 465, y1: y0 + 300, r: 60 },
    ],
    cliff: 36,
    seed: seed ^ 1,
    rock,
    z: 2,
  };
  const right: Island = {
    boxes: [
      { x0: 665, y0: y0 + 185, x1: 1165, y1: y0 + 408, r: 44 },
      { x0: 710, y0: y0 + 148, x1: 1125, y1: y0 + 300, r: 60 },
    ],
    cliff: 36,
    seed: seed ^ 2,
    rock,
    z: 2,
  };
  const castle: Island = {
    boxes: [
      { x0: 455, y0: y0 + 95, x1: 748, y1: y0 + 300, r: 40 },
      { x0: 552, y0: y0 + 260, x1: 662, y1: y0 + 336, r: 22 },
    ],
    cliff: 34,
    seed: seed ^ 3,
    rock,
    z: 1,
  };
  left.boxes[0].y1 += sideExtra[0]!;
  right.boxes[0].y1 += sideExtra[1]!;
  if (last) {
    // The last host is one landmass across the bottom, as the concept's PROD.
    left.boxes = [
      { x0: 30, y0: y0 + 175, x1: 1170, y1: y0 + 425 + extra, r: 46 },
      { x0: 95, y0: y0 + 125, x1: 1105, y1: y0 + 300, r: 50 },
    ];
    right.boxes = [];
    castle.boxes = [{ x0: 450, y0: y0 + 70, x1: 752, y1: y0 + 300, r: 34 }];
  }
  // Coast detail: lobes and bays along the sides and the front, seeded per host.
  const rr = rng(seed ^ 0xc0a57);
  for (const island of [left, right]) {
    if (island.boxes.length === 0) continue;
    const m = island.boxes[0];
    island.bites = [];
    for (let k = 0; k < 7; k++) {
      const x = m.x0 + 30 + rr() * (m.x1 - m.x0 - 60);
      const w = 40 + rr() * 80;
      if (last && Math.abs(x - CX) < w / 2 + 90) continue;
      if (rr() < 0.55) island.boxes.push({ x0: x - w / 2, y0: m.y1 - 40, x1: x + w / 2, y1: m.y1 + 14 + rr() * 26, r: 20 });
      else island.bites.push({ x0: x - w / 2, y0: m.y1 - 2 - rr() * 10, x1: x + w / 2, y1: m.y1 + 40, r: 18 });
    }
    for (let k = 0; k < 3; k++) {
      const y = m.y0 + 20 + rr() * (m.y1 - m.y0 - 40);
      const h = 30 + rr() * 50;
      const sideX = island === left ? m.x0 : m.x1;
      island.bites.push({ x0: sideX - 30, y0: y - h / 2, x1: sideX + 6 + rr() * 12, y1: y + h / 2, r: 14 });
    }
  }
  scene.islands.push(castle, left, right);

  // Terraces: a lower ledge in front of each side island (its own cliff below), as the concept's
  // stepped coasts. Drawn under the island, so the island's cliff stands on the ledge.
  for (const island of [left, right]) {
    if (island.boxes.length === 0) continue;
    const rs = rng(island.seed ^ 0x7e7a);
    const ledges: Box[] = [];
    for (const b of island.boxes) {
      if (b.y1 - b.y0 < 60) continue;
      for (let k = 0; k < 4; k++) {
        const w = 70 + rs() * 140;
        const x = b.x0 + rs() * (b.x1 - b.x0 - w);
        if (last && Math.abs(x + w / 2 - CX) < w / 2 + 80) continue;
        ledges.push({ x0: x, y0: b.y1 - 30, x1: x + w, y1: b.y1 + 8 + rs() * 8, r: 14 });
      }
    }
    if (ledges.length) scene.islands.push({ boxes: ledges, cliff: island.cliff * 0.55, seed: island.seed ^ 0x1ed9e, rock, z: island.z - 0.5 });
  }

  // Castle, plaque, banners and the castle's link node.
  const castleFrame = host.offline ? "castle-offline" : "castle-online";
  scene.items.push({ kind: "sprite", sheet: "host", frame: castleFrame, x: CX, y: y0 + 292, scale: 0.29, shadow: 0.3 });
  scene.items.push({ kind: "sprite", sheet: "halls", frame: "badge-layers", x: CX - 0.3, y: y0 + 292 - 633 * 0.29, scale: 0.38, z: y0 + 292.5 });
  reserve(scene, CX - 145, y0 + 30, CX + 145, y0 + 296);
  for (const side of [-1, 1]) {
    const bx = CX + side * 192;
    scene.items.push({ kind: "sprite", sheet: "host", frame: "banner-0", x: bx, y: y0 + 222, scale: 0.23, flip: side > 0, z: y0 + 300 });
    scene.items.push({ kind: "sprite", sheet: "halls", frame: "badge-layers", x: bx + (side > 0 ? -25.1 : 25.1), y: y0 + 222 - 48.3, scale: 0.113, z: y0 + 300.5 });
    reserve(scene, bx - 30, y0 + 120, bx + 30, y0 + 225);
  }
  const stats = host.stats ? `CPU ${host.stats.cpu}%  •  MEM ${host.stats.mem}%  •  DISK ${host.stats.disk}%` : undefined;
  scene.labels.push({ kind: "plaque", x: CX + 2, y: y0 + 168, w: 246, h: 56, text: host.name, stats, online: !host.offline });
  const castleNode = { x: CX + 2, y: y0 + 210, r: 7.5 };
  scene.nodes.push(castleNode);

  // River from the castle gate down through the channel and over the cliff.
  if (!last) {
    scene.rivers.push({ pts: [[CX + 2, y0 + 284], [CX - 4, y0 + 306], [CX + 8, y0 + 336]], width: 40 });
    scene.falls.push({ x: CX + 8, top: y0 + 330, bottom: y0 + 330 + 50, width: 60 });
  }
  scene.paths.push({ pts: [[CX - 30, y0 + 286], [CX + 2, y0 + 279], [CX + 34, y0 + 286]], width: 16 });

  // Projects: alternating left and right of the castle.
  const sides: Array<{ x: number; dir: -1 | 1 }> = [
    { x: CX - 275, dir: -1 },
    { x: CX + 298, dir: 1 },
  ];
  host.projects.forEach((project, i) => {
    const side = sides[i % 2];
    layoutProject(scene, project, side.x, y0 + rowY[Math.floor(i / 2)], side.dir, castleNode, i);
  });

  // Theme scenery anchors and scatter areas.
  layoutTheme(scene, host.theme, y0, seed, last, index, extra);
  const area = { x0: 0, y0: y0 + 60, x1: MAP_W, y1: y0 + 460 + extra };
  scene.scatter.push({ island: base + 1, theme: host.theme, area });
  scene.scatter.push({ island: base + 2, theme: host.theme, area });
  scene.scatter.push({ island: base, theme: host.theme, area });
  // The host: its whole region (the map rings it when the Hosts tab picks it).
  scene.entities.push({ id: host.id, kind: "host", x0: 20, y0: y0 + 30, x1: MAP_W - 20, y1: y0 + 420 + extra + 40 });
  return extra;
}

function layoutProject(
  scene: Scene,
  project: OwProject,
  hx: number,
  y0: number,
  dir: -1 | 1,
  castleNode: Node,
  order: number,
): void {
  const hall = project.hall !== false;
  const labelW = Math.max(118, project.name.length * 10.6 + 42);
  const hallNode = { x: hx, y: y0 + 279, r: 7.5 };
  if (hall) {
    // Hall: roof badge at y0+200, label centred at y0+247, body down to y0+292.
    scene.items.push({ kind: "sprite", sheet: "halls", frame: `hall-${project.roof}`, x: hx, y: y0 + 296, scale: 0.248, shadow: 0.35 });
    scene.items.push({ kind: "sprite", sheet: "halls", frame: `badge-${project.icon}`, x: hx - 1.7, y: y0 + 296 - 101, scale: 0.248, z: y0 + 296.5 });
    reserve(scene, hx - 112, y0 + 160, hx + 112, y0 + 300);
    scene.labels.push({ kind: "label", x: hx, y: y0 + 247, w: labelW, h: 34, text: project.name, size: 21 });
    scene.entities.push({ id: project.id, kind: "project", x0: hx - 108, y0: y0 + 172, x1: hx + 108, y1: y0 + 298 });
    // Gold link from the castle node: out to a node by the hall, into the hall label's side.
    const nx = dir < 0 ? hx + 135 : hx - 152;
    const ny = y0 + 232;
    scene.links.push({
      pts: [
        [castleNode.x, castleNode.y],
        [castleNode.x + dir * 12, ny],
        [nx, ny],
        [hx - dir * (labelW / 2 - 6), y0 + 250],
      ],
    });
    scene.nodes.push({ x: nx, y: ny, r: 6.5 });
    scene.nodes.push(hallNode);
  } else {
    // No hall: the castle links straight to the booths' row.
    scene.links.push({ pts: [[castleNode.x, castleNode.y], [castleNode.x + dir * 12, hallNode.y], [hx, hallNode.y]] });
    scene.nodes.push(hallNode);
  }

  // Workspaces: rows of booths under the hall. Later rows' links run down the block's outer edge.
  const rows = boothRows(project);
  const rowTotal = (row: OwWorkspace[]) =>
    row.reduce((a, w) => a + (w.camp ? CAMP_W : boothWidth(w.agents.length)), 0) + BOOTH_GAP * (row.length - 1);
  const blockHalf = Math.max(...rows.map(rowTotal)) / 2;
  const edgeX = dir < 0 ? hx - blockHalf - 16 : hx + blockHalf + 16;
  rows.forEach((row, k) => {
    const widths = row.map((w) => (w.camp ? CAMP_W : boothWidth(w.agents.length)));
    const total = widths.reduce((a, b) => a + b, 0) + BOOTH_GAP * (row.length - 1);
    let x = hx - total / 2;
    const floor = y0 + 384 + k * BOOTH_ROW_H;
    const signTop = floor - (BOOTH.floor - 32 - 20) * BOOTH.scale;
    row.forEach((ws, i) => {
      const w = widths[i];
      const cx = x + w / 2;
      const awning = ws.awning ?? AWNINGS[(order * 2 + i + k) % AWNINGS.length];
      const awningSide = row.length === 1 ? (dir < 0 ? "left" : "right") : i === 0 ? "left" : "right";
      scene.items.push({ kind: "booth", x: cx, y: floor, w, awning, awningSide, agents: ws.agents, camp: ws.camp, z: floor });
      const top = floor - BOOTH.floor * BOOTH.scale;
      scene.labels.push({ kind: "label", x: cx, y: top + 19, w: Math.min(w - 8, Math.max(96, ws.name.length * 10.5 + 40)), h: 25, text: ws.name, size: 20 });
      reserve(scene, x - 26, top - 4, x + w + 26, floor + 14);
      scene.entities.push({ id: ws.id, kind: "workspace", x0: x - 4, y0: top + 4, x1: x + w + 4, y1: floor + 8 });
      for (const spot of robotSpots(ws, cx, floor, w)) {
        scene.robots.push(spot);
        scene.entities.push({ id: spot.id, kind: "agent", x0: spot.x - 15, y0: spot.y - 40, x1: spot.x + 15, y1: spot.y + 3 });
      }
      // Links: from the hall's node, along above the row, down to the sign.
      const via = k === 0 ? hallNode.y : signTop - 12;
      const from: [number, number] = k === 0 ? [hx, hallNode.y] : [edgeX, hallNode.y];
      if (k === 0 && row.length === 1) scene.links.push({ pts: [from, [cx, signTop]] });
      else if (k === 0) scene.links.push({ pts: [from, [cx, via], [cx, signTop]] });
      else scene.links.push({ pts: [[hx, hallNode.y], from, [from[0], via], [cx, via], [cx, signTop]] });
      scene.nodes.push({ x: cx, y: signTop, r: 6.5 });
      x += w + BOOTH_GAP;
    });
    // Cobbled path along the booths' fronts.
    scene.paths.push({ pts: [[hx - total / 2 - 10, floor + 14], [hx + total / 2 + 10, floor + 14]], width: 14 });
  });
}

/** Where each of a booth's (or camp's) robots stands. */
export function robotSpots(ws: OwWorkspace, cx: number, floor: number, w: number): RobotSpot[] {
  const n = ws.agents.length;
  if (ws.camp) {
    // Beside the camp's fire, in a row.
    const pitch = 34;
    return ws.agents.map((a, i) => ({ id: a.id, x: cx - w / 2 + 120 + (i % 3) * pitch, y: floor - 4 + Math.floor(i / 3) * 18, colour: a.colour, working: a.working }));
  }
  const slots = boothSlots(n);
  const s = BOOTH.scale;
  const x0 = cx - ((BOOTH.end * 2 + BOOTH.slot * slots) * s) / 2;
  const first = (slots - n) / 2;
  return ws.agents.map((a, i) => ({
    id: a.id,
    x: x0 + (BOOTH.end + (first + i) * BOOTH.slot + BOOTH.slot / 2) * s,
    y: floor - 1,
    colour: a.colour,
    working: a.working,
  }));
}

function sprite(sheet: string, frame: string, x: number, y: number, scale: number, extra: Partial<SpriteItem> = {}): SpriteItem {
  return { kind: "sprite", sheet, frame, x, y, scale, shadow: 0.25, ...extra };
}

function layoutTheme(scene: Scene, theme: Theme, y0: number, seed: number, last: boolean, index: number, extra = 0): void {
  const r = rng(seed);
  const add = (item: SpriteItem, pad = 0) => {
    scene.items.push(item);
    if (pad > 0) reserve(scene, item.x - pad, item.y - pad * 1.2, item.x + pad, item.y + pad * 0.4);
  };
  if (theme === "forest") {
    // Snowy peaks behind the island's back right; a waterfall off the left plateau; camp and target right.
    add(sprite("theme-forest", "mountain-2", 700, y0 + 150, 0.34, { shadow: 0, z: y0 - 230 }));
    add(sprite("theme-forest", "mountain-0", 930, y0 + 145, 0.46, { shadow: 0, z: y0 - 225 }));
    add(sprite("theme-forest", "mountain-2", 820, y0 + 175, 0.4, { shadow: 0, z: y0 - 215 }));
    add(sprite("theme-forest", "mountain-0", 1080, y0 + 190, 0.5, { shadow: 0, z: y0 - 205 }));
    add(sprite("theme-forest", "mountain-1", 1100, y0 + 245, 0.4, { shadow: 0, z: y0 - 195 }));
    for (const b of scene.islands[scene.islands.length - 2].boxes) b.x0 = Math.max(b.x0, 78);
    scene.islands.push({ boxes: [{ x0: -6, y0: y0 + 200, x1: 82, y1: y0 + 262, r: 24 }], cliff: 62, seed: seed ^ 9, rock: "grey", z: 3 });
    scene.rivers.push({ pts: [[70, y0 + 222], [55, y0 + 242], [50, y0 + 258]], width: 18 });
    scene.falls.push({ x: 50, top: y0 + 262, bottom: y0 + 322, width: 34 });
    add(sprite("props", "tent-small", 1050, y0 + 352, 0.62), 40);
    add(sprite("props", "campfire-0", 1050, y0 + 380, 0.33), 14);
    add(sprite("props", "archery-target", 800, y0 + 365, 0.3), 14);
    add(sprite("theme-forest", "ruins-wall", 1090, y0 + 300, 0.26), 30);
    add(sprite("props", "bench", 1102, y0 + 380, 0.25));
    add(sprite("props", "fence", 95, y0 + 372, 0.3));
    add(sprite("props", "fence", 130, y0 + 398, 0.3));
    add(sprite("props", "fence", 165, y0 + 412, 0.3));
  } else if (theme === "farm") {
    add(sprite("theme-farm", "windmill-0", 80, y0 + 260, 0.25), 55);
    scene.fields.push({ pts: [[40, y0 + 288], [150, y0 + 288]], width: 52 });
    scene.fields.push({ pts: [[92, y0 + 340], [222, y0 + 340]], width: 50 });
    reserve(scene, 40, y0 + 250, 225, y0 + 352);
    for (let i = 0; i < 4; i++) add(sprite("theme-farm", "fence", 52 + i * 34, y0 + 316, 0.2, { shadow: 0 }));
    for (let i = 0; i < 4; i++) add(sprite("theme-farm", "fence", 104 + i * 34, y0 + 368, 0.2, { shadow: 0 }));
    add(sprite("theme-farm", "fence-post", 230, y0 + 350, 0.24));
    for (let i = 0; i < 5; i++) {
      const t = `autumn-tree-${i % 4}`;
      add(sprite("theme-farm", t, 115 + i * 38 + r() * 10, y0 + 210 + (i % 2) * 14, 0.2 + r() * 0.04), 18);
    }
    add(sprite("theme-forest", "standing-arch", 1095, y0 + 210, 0.3), 40);
    add(sprite("theme-forest", "ruins-wall", 1060, y0 + 285, 0.24), 30);
    add(sprite("terrain", "stairs", 1090, y0 + 265, 0.2, { shadow: 0 }), 20);
    add(sprite("theme-forest", "boulder-0", 1130, y0 + 300, 0.2));
    add(sprite("theme-farm", "hay-round", 245, y0 + 300, 0.22));
  } else {
    // Volcanic: purple peaks behind both sides, lava down the right, crystals and the mine left.
    const back = { shadow: 0, z: y0 - 300 };
    add(sprite("theme-volcanic", "volcanic-mountain-2", 300, y0 + 225, 0.42, back));
    add(sprite("theme-volcanic", "volcanic-mountain-0", 170, y0 + 300, 0.52, back));
    add(sprite("theme-volcanic", "volcanic-mountain-1", 105, y0 + 350, 0.44, back));
    add(sprite("theme-volcanic", "volcanic-mountain-2", 870, y0 + 230, 0.42, back));
    add(sprite("theme-volcanic", "volcano-0", 1045, y0 + 315, 0.5, back));
    add(sprite("theme-volcanic", "volcanic-mountain-0", 1095, y0 + 350, 0.42, back));
    reserve(scene, 0, y0 + 120, 280, y0 + 330);
    reserve(scene, 880, y0 + 120, 1200, y0 + 335);
    add(sprite("theme-volcanic", "crystal-0", 70, y0 + 200, 0.3), 20);
    add(sprite("theme-volcanic", "crystal-2", 110, y0 + 215, 0.24), 20);
    add(sprite("theme-volcanic", "watchtower", 175, y0 + 250, 0.3), 30);
    add(sprite("theme-volcanic", "rail-curve", 40, y0 + 318, 0.3, { shadow: 0, z: y0 + 318 }), 0);
    for (const [x, y, f] of [[60, 405, 1], [1150, 400, 0], [1110, 418, 2], [95, 420, 0]] as const) add(sprite("theme-volcanic", `dark-rock-${f}`, x, y0 + y, 0.2), 12);
    for (const [x, y, f] of [[230, 300, 1], [1000, 330, 3], [520, 380, 0], [700, 395, 2]] as const) add(sprite("theme-volcanic", `crystal-${f}`, x, y0 + y, 0.17), 10);
    add(sprite("theme-volcanic", "mine-cart", 120, y0 + 370, 0.26), 20);
    add(sprite("theme-volcanic", "watchtower", 1070, y0 + 330, 0.3), 30);
    add(sprite("theme-volcanic", "crystal-3", 1150, y0 + 260, 0.24), 18);
    add(sprite("theme-volcanic", "mine-cart", 1125, y0 + 355, 0.24), 18);
    if (last) {
      // The gate's grand approach: a wide stair to a bridge over a fall at the coast, lamps on pillars.
      const coast = y0 + 425 + extra;
      for (let k = 0; k < 16 + Math.round(extra / 7.6); k++) add(sprite("terrain", "stairs-tread", CX + 1 - 128 * 0.19, y0 + 288 + k * 7.6, 0.19, { shadow: 0, z: y0 + 280 + k * 0.1 }));
      scene.falls.push({ x: CX + 1, top: coast - 6, bottom: coast + 50, width: 44 });
      add(sprite("terrain", "bridge", CX + 1, coast + 2, 0.27, { shadow: 0, z: coast + 4 }));
      for (const side of [-1, 1]) {
        add(sprite("props", "stone-lamp-lit", CX + side * 66, coast + 18, 0.36, { z: coast + 20 }));
        add(sprite("theme-forest", "flowers-0", CX + side * 42, y0 + 345, 0.2, { z: y0 + 345 }));
        add(sprite("theme-forest", "flowers-2", CX + side * 48, y0 + 375, 0.2, { z: y0 + 375 }));
        add(sprite("theme-forest", "flowers-1", CX + side * 40, y0 + 398, 0.2, { z: y0 + 398 }));
      }
      reserve(scene, CX - 80, y0 + 280, CX + 80, coast + 40);
      scene.paths.push({ pts: [[CX + 1, y0 + 300], [CX + 1, coast - 20]], width: 40 });
    }
  }
  void index;
}
