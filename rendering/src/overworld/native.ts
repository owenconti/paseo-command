// The Overworld map style in the macOS app: the page paints the still world (land, sea, buildings,
// booths) into tiles once per layout, and posts the robots and the light their states cast on the
// booth floor, which Swift draws over it, with the areas it picks, hovers and selects. Nothing else is
// drawn over the world: names, PRs and verdicts are in the hover cards. Agents' states only re-post the
// robots and their light; the painting is redone only when the layout itself changes.
import { STATE_TILE, type AtlasData, type State } from "../world.ts";
import { loadSheetsFrom, type Sheets } from "./atlas.ts";
import { overworldFleet } from "./fleet.ts";
import { layout, hash, type OwHost, type Scene } from "./layout.ts";
import { litRobot, overworldSeaTile, paintScene, paintSilhouette, recolourSheets, robotFrame, ROBOT_SCALE, seaPeriod } from "./paint.ts";

/** World units (the native map's) per concept pixel: a robot about as large as the Islands'. */
export const WORLD = 2.5;
/** Painting density, pixels per concept pixel. */
const K = 3;
/** The hover glow's silhouettes: px per concept px. */
const SILHOUETTE_K = 1.5;
/** Tiles the painting is cut into, in pixels. */
const TILE = 1024;
/** Each host's painting reaches this far past its scene (concept px), so scenery at its edges isn't
 * cut: sideways with its sea (columns abut there), upward without (only its scenery overlaps the host above). */
const SIDE = 80;
const TOP = 120;
/** The painting is finite: zooming further only blurs it. */
export const OVERWORLD_MAX_ZOOM = 0.9;

/** States that need you: their light pulses. */
const NEEDS_YOU: State[] = ["approval", "question", "asking", "failed", "done"];

const sheetUrls = import.meta.glob("../assets/overworld/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const sheetJson = import.meta.glob("../assets/overworld/*.json", { eager: true, import: "default" }) as Record<string, Record<string, unknown>>;

let sheets: Promise<Sheets> | undefined;
/** The Overworld's sprite sheets, loaded once per page. */
export function overworldSheets(): Promise<Sheets> {
  sheets ??= loadSheetsFrom((name) => {
    const json = sheetJson[`../assets/overworld/${name}.json`];
    if (!json) return undefined;
    const url = sheetUrls[`../assets/overworld/${String(json.image ?? `${name}.png`)}`];
    return url ? { json, url } : undefined;
  }).then(recolourSheets);
  return sheets;
}

type Png = (canvas: HTMLCanvasElement) => string;
type Streamer = {
  key: string;
  png?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  alpha: number;
  pulse: boolean;
  frames?: string[];
  frameMs?: number;
  phase?: number;
};

/** A robot's frame `i` of its pose, as its own canvas. */
function robotCanvas(sheets: Sheets, colour: string, working: boolean, i: number, frameMs: number): HTMLCanvasElement {
  return litRobot(robotFrame(sheets, colour, working, i * frameMs, 0));
}

const w = (v: number) => v * WORLD;

/** What the painting depends on: the scene without its robots' looks. */
function signatureOf(scene: Scene): string {
  return JSON.stringify({
    ...scene,
    robots: [],
    entities: [],
    items: scene.items.map((i) => (i.kind === "booth" ? { ...i, agents: i.agents.length } : i)),
  });
}

/** The light a state casts round a robot, as a lamp's falls: a pool on the booth's floor at its feet
 * (`wall` false) or a soft wash on the booth's back wall behind it (`wall`), in the state's colour,
 * brightest at the middle and falling off steeply, with no ring or outline. */
export function stateLight(color: number, wall = false): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = wall ? 260 : 90;
  const g = c.getContext("2d")!;
  const [r, gg, b] = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
  const rgba = (a: number) => `rgba(${r}, ${gg}, ${b}, ${a})`;
  g.translate(100, c.height / 2);
  g.scale(1, c.height / 200);
  const light = g.createRadialGradient(0, 0, 0, 0, 0, 98);
  if (wall) {
    light.addColorStop(0, rgba(0.62));
    light.addColorStop(0.5, rgba(0.34));
    light.addColorStop(1, rgba(0));
  } else {
    light.addColorStop(0, rgba(1));
    light.addColorStop(0.5, rgba(0.9));
    light.addColorStop(0.8, rgba(0.35));
    light.addColorStop(1, rgba(0));
  }
  g.fillStyle = light;
  g.beginPath();
  g.arc(0, 0, 98, 0, Math.PI * 2);
  g.fill();
  return c;
}

/** A state light's size in concept px: the floor pool a booth slot wide (41 px), the wall wash behind a robot. */
const POOL = { w: 44, h: 20 };
const WASH = { w: 46, h: 58, above: 26 };

/** A host's own scene, painted on its own, and where it stands in the world (concept px). */
type Block = { id: string; scene: Scene; signature: string; ox: number; oy: number };
type Piece = { key: string; canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number };

/** Hosts side by side in columns, as many as suit the map's shape; each joins the shortest column. */
export function arrange(heights: number[], aspect: number, width: number): Array<{ ox: number; oy: number }> {
  const total = heights.reduce((a, b) => a + b, 0);
  let columns = 1;
  for (let c = 1; c <= heights.length; c++) {
    const fit = (c * width) / (total / c);
    if (Math.abs(Math.log(fit / aspect)) < Math.abs(Math.log((columns * width) / (total / columns) / aspect))) columns = c;
  }
  const tops = new Array(columns).fill(0);
  return heights.map((h) => {
    const col = tops.indexOf(Math.min(...tops));
    const at = { ox: col * width, oy: tops[col] };
    tops[col] += h;
    return at;
  });
}

export class OverworldMap {
  /** Painted hosts, by their scene's signature. */
  private painted = new Map<string, Piece[]>();
  /** Sea under short columns, by size. */
  private fillers = new Map<string, Piece[]>();
  private queue: Array<() => void> = [];
  private busy = false;
  /** Images Swift already holds, by key. */
  private sent = new Set<string>();
  blocks: Block[] = [];

  /** `changed` is called when a host finishes painting, to post the world again. */
  constructor(private readonly sheets: Sheets, private readonly png: Png, private readonly changed: () => void) {}

  /** Forget what Swift holds (a fresh mount, or the Islands drew in between). */
  reset(): void {
    this.sent.clear();
  }

  /** The scene message for `data`: each host's tiles (those painted so far) and the overlay. */
  message(data: AtlasData, build: number, aspect: number): Record<string, unknown> {
    const fleet = overworldFleet(data);
    const scenes = fleet.map((host: OwHost) => layout([host], { merged: () => hash(host.id) % 3 === 2 }));
    const places = arrange(scenes.map((sc) => sc.h), aspect, (scenes[0]?.w ?? 1200) + 2 * SIDE).map((p) => ({ ox: p.ox + SIDE, oy: p.oy }));
    this.blocks = scenes.map((scene, i) => ({ id: fleet[i]!.id, scene, signature: signatureOf(scene), ...places[i]! }));
    const width = Math.max(1200, ...this.blocks.map((b) => b.ox + b.scene.w + SIDE));
    const height = Math.max(400, ...this.blocks.map((b) => b.oy + b.scene.h));
    const pieces: Array<Record<string, unknown>> = [];
    const pieceOut = (p: Piece, ox: number, oy: number) => {
      pieces.push({ key: p.key, png: this.sent.has(p.key) ? undefined : this.png(p.canvas), x: w(p.x + ox), y: w(p.y + oy), width: w(p.width), height: w(p.height), depth: 0, alpha: 1 });
      this.sent.add(p.key);
    };
    for (const b of this.blocks) {
      // A host repaints when it changes or moves (its sea lines up with its neighbours').
      b.signature = `${b.signature}@${b.ox},${b.oy}`;
      const ready = this.painted.get(b.signature);
      if (ready) ready.forEach((p) => pieceOut(p, b.ox, b.oy));
      else this.schedule(b.signature, () => this.cut(b.scene, `ow:${hash(b.signature)}:${b.ox}:${b.oy}`, b.ox, b.oy));
    }
    // Columns shorter than the tallest end in open sea.
    for (const ox of new Set(this.blocks.map((b) => b.ox))) {
      const bottom = Math.max(...this.blocks.filter((b) => b.ox === ox).map((b) => b.oy + b.scene.h));
      const gap = Math.ceil(height - bottom);
      if (gap < 4) continue;
      const key = `fill:${ox}:${bottom}:${gap}`;
      const ready = this.fillers.get(key);
      if (ready) ready.forEach((p) => pieceOut(p, ox, bottom));
      else this.schedule(key, () => this.cut(emptyScene(1200, gap), `ow:sea:${ox}:${gap}`, ox, bottom), this.fillers);
    }
    // Forget paintings no host uses any more.
    const live = new Set(this.blocks.map((b) => b.signature));
    for (const k of [...this.painted.keys()]) if (!live.has(k)) this.painted.delete(k);
    const scene = {
      robots: this.blocks.flatMap((b) => b.scene.robots.map((r) => ({ ...r, x: r.x + b.ox, y: r.y + b.oy }))),
      entities: this.blocks.flatMap((b) => b.scene.entities.map((e) => ({ ...e, x0: e.x0 + b.ox, x1: e.x1 + b.ox, y0: e.y0 + b.oy, y1: e.y1 + b.oy }))),
      w: width,
      h: height,
    };
    const image = (key: string, make: () => HTMLCanvasElement) => {
      if (this.sent.has(key)) return undefined;
      this.sent.add(key);
      return this.png(make());
    };
    // Each hall's and booth's own silhouette (the item alone, no shadow), which the hover glow follows; robots use
    // their first frame. Painted once per look, at a modest density.
    const glows = new Map<string, { key: string; x: number; y: number; width: number; height: number }>();
    const silhouettes: Array<{ key: string; png: string }> = [];
    for (const b of this.blocks)
      for (const e of b.scene.entities) {
        if (!e.item) continue;
        const box = { x0: e.x0 - 40, y0: e.y0 - 70, x1: e.x1 + 40, y1: e.y1 + 24 };
        const key = `ow-sil:${hash(JSON.stringify({ ...e.item, agents: undefined, x: 0, y: 0 }))}:${box.x1 - box.x0}x${box.y1 - box.y0}:${e.item.x - box.x0},${e.item.y - box.y0}`;
        const png = image(key, () => paintSilhouette(e.item!, this.sheets, box, SILHOUETTE_K));
        if (png) silhouettes.push({ key, png });
        glows.set(e.id, { key, x: w(box.x0 + b.ox), y: w(box.y0 + b.oy), width: w(box.x1 - box.x0), height: w(box.y1 - box.y0) });
      }
    const states = new Map(data.agents.map((a) => [a.key, a.state]));
    const streamers: Streamer[] = [];
    /** Robots' other frames, which Swift keeps for cycling. */
    const extra: Array<{ key: string; png: string }> = [];
    // Robots and the light their states cast on the floor.
    for (const spot of scene.robots) {
      const state = states.get(spot.id) ?? "idle";
      const color = STATE_TILE[state];
      if (color !== undefined) {
        const pulse = NEEDS_YOU.includes(state);
        const wash = `streamer:ow-wash:${color}`;
        streamers.push({
          key: wash,
          png: image(wash, () => stateLight(color, true)),
          x: w(spot.x - WASH.w / 2),
          y: w(spot.y - WASH.above - WASH.h / 2),
          width: w(WASH.w),
          height: w(WASH.h),
          depth: 5.9,
          alpha: 1,
          pulse,
        });
        const pool = `streamer:ow-light:${color}`;
        streamers.push({
          key: pool,
          png: image(pool, () => stateLight(color)),
          x: w(spot.x - POOL.w / 2),
          y: w(spot.y - 1.5 - POOL.h / 2),
          width: w(POOL.w),
          height: w(POOL.h),
          depth: 6,
          alpha: 1,
          pulse,
        });
      }
      // Every frame of its pose (idle bobs, working works), cycled by Swift at the sheet's pace.
      const count = spot.working ? 4 : 2;
      const frameMs = spot.working ? 140 : 700;
      const keys = Array.from({ length: count }, (_, i) => `streamer:ow-robot2:${spot.colour}:${spot.working ? "working" : "idle"}-${i}`);
      keys.forEach((key, i) => {
        if (i === 0 || state === "offline") return;
        const png = image(key, () => robotCanvas(this.sheets, spot.colour, spot.working, i, frameMs));
        if (png) extra.push({ key, png });
      });
      const size = 256 * ROBOT_SCALE;
      glows.set(spot.id, { key: keys[0]!, x: w(spot.x - 128 * ROBOT_SCALE), y: w(spot.y - 224 * ROBOT_SCALE), width: w(size), height: w(size) });
      streamers.push({
        key: keys[0]!,
        png: image(keys[0]!, () => robotCanvas(this.sheets, spot.colour, spot.working, 0, frameMs)),
        x: w(spot.x - 128 * ROBOT_SCALE),
        y: w(spot.y - 224 * ROBOT_SCALE),
        width: w(size),
        height: w(size),
        depth: 7 + spot.y / 1e5,
        alpha: state === "offline" ? 0.55 : 1,
        pulse: false,
        // Offline robots stand still.
        frames: state === "offline" ? undefined : keys,
        frameMs,
        phase: (hash(spot.id) % 1000) / 1000 * count,
      });
    }
    // Swift drops what a scene leaves out, so anything not in this one is sent again when it returns.
    // The open sea beyond the painted hosts: the same tile, which Swift repeats over the whole view.
    const SEA_KEY = "ow-sea";
    if (!this.sent.has(SEA_KEY)) {
      const tile = overworldSeaTile(this.sheets, K);
      if (tile) {
        extra.push({ key: SEA_KEY, png: this.png(tile) });
        this.sent.add(SEA_KEY);
      }
    }
    const used = new Set<string>([
      SEA_KEY,
      ...pieces.map((p) => String(p.key)),
      ...streamers.flatMap((st) => [st.key, ...(st.frames ?? [])]),
      ...[...glows.values()].map((g) => g.key),
    ]);
    extra.push(...silhouettes);
    for (const key of [...this.sent]) if (!used.has(key)) this.sent.delete(key);
    return {
      type: "scene",
      style: "overworld",
      build,
      maxZoom: OVERWORLD_MAX_ZOOM,
      seaTile: { key: "ow-sea", width: w(seaPeriod(this.sheets)) },
      bounds: { x: 0, y: 0, width: w(scene.w), height: w(scene.h) },
      pieces,
      sprites: [],
      flags: [],
      prFlags: [],
      banners: [],
      streamers,
      images: extra,
      entities: scene.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        cells: [],
        at: { x: w((e.x0 + e.x1) / 2), y: w((e.y0 + e.y1) / 2), width: w(e.x1 - e.x0), height: w(e.y1 - e.y0) },
        rects: [[w(e.x0), w(e.y0), w(e.x1 - e.x0), w(e.y1 - e.y0)]],
        ...(glows.has(e.id) ? { glow: glows.get(e.id) } : {}),
      })),
    };
  }

  /** Paint later, one at a time, so the page stays responsive; post again once done. */
  private schedule(key: string, paint: () => Piece[], into: Map<string, Piece[]> = this.painted): void {
    if (into.has(key) || this.queue.some((q) => (q as { key?: string }).key === key)) return;
    const job = Object.assign(
      () => {
        into.set(key, paint());
        this.changed();
      },
      { key },
    );
    this.queue.push(job);
    if (!this.busy) this.next();
  }

  private next(): void {
    const job = this.queue.shift();
    if (!job) {
      this.busy = false;
      return;
    }
    this.busy = true;
    setTimeout(() => {
      try {
        job();
      } finally {
        this.next();
      }
    }, 16);
  }

  /** Paint a scene placed at (ox, oy) in the world, with its margins, and cut it into tiles
   * (positions relative to the scene's origin). */
  private cut(scene: Scene, id: string, ox: number, oy: number): Piece[] {
    const top = oy > 0 ? TOP : 0;
    const width = Math.ceil((scene.w + 2 * SIDE) * K);
    const height = Math.ceil((scene.h + top) * K);
    const full = document.createElement("canvas");
    full.width = width;
    full.height = height;
    const ctx = full.getContext("2d")!;
    ctx.translate(SIDE * K, top * K);
    paintScene(ctx, scene, this.sheets, { K, t: 0, robots: false, origin: { x: ox, y: oy }, margin: SIDE });
    const out: Piece[] = [];
    for (let y = 0; y < height; y += TILE) {
      for (let x = 0; x < width; x += TILE) {
        const tw = Math.min(TILE, width - x);
        const th = Math.min(TILE, height - y);
        const c = document.createElement("canvas");
        c.width = tw;
        c.height = th;
        c.getContext("2d")!.drawImage(full, x, y, tw, th, 0, 0, tw, th);
        out.push({ key: `${id}:${x}:${y}`, canvas: c, x: x / K - SIDE, y: y / K - top, width: tw / K, height: th / K });
      }
    }
    return out;
  }
}

/** Open sea of a size: a scene with nothing on it. */
function emptyScene(width: number, height: number): Scene {
  return { ...layout([]), w: width, h: height };
}
