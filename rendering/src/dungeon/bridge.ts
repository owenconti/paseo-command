/**
 * The Dungeon Board drawn by the native macOS app (SpriteKit), as the Atlas
 * is: the page lays the board out (`layout.ts`), paints its text (labels, the
 * hosts' plaques, the HUD) and posts the result to Swift (`DungeonScene.swift`),
 * which draws, animates, owns the camera, hover and picking, and answers
 * through `paseo:world` events. Nothing here sends daemon actions.
 */
import { STATE_TILE, seedOf, random, type AtlasData, type Entity } from "../world";
import { HOVER_COLOR, PULSE_MS, RUNNING_LAP_MS } from "../placement";
import type { MapFlag } from "../prStatus";
import { MAX_ZOOM } from "../camera";
import type { AtlasHandlers, AtlasWorld } from "../atlas";
import { WORLD_WATCH, applied, behind, newWatch, post as postRevision } from "../native/watch";
import { nativeSurface } from "../native/surface";
import { FRAMES, ANIMATIONS, anchorShare, applySheet, framesOf, sliceOf, type SheetJson } from "./frames";
import { paintPlaceholder } from "./placeholder";
import {
  D,
  ROBOT_OF,
  STATE_GLOW,
  STATE_MARK,
  hudSubtitle,
  layoutDungeon,
  projectAlarm,
  projectWorking,
  type DungeonLayout,
  type Measure,
  type Rect,
} from "./layout";

type Channel = { postMessage(message: unknown): void };
const channel = (): Channel | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: Channel } } }).webkit?.messageHandlers?.paseoWorld;

/** The art agent's sheets, when they are in: `<sheet>.json` beside `<sheet>.png`. */
const SHEET_JSON = import.meta.glob("../assets/dungeon/*.json", { eager: true, import: "default" }) as Record<string, unknown>;
const SHEET_PNG = import.meta.glob("../assets/dungeon/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** Labels and the HUD are painted at this many pixels per board unit (crisp when zoomed in). */
const TEXT_SCALE = 4;
/** How dark the far wall is drawn (a share of black over its tile), for the light pools to warm. */
const WALL_SHADE = 0;
/** The alcoves' interiors, a little darker than their sheet, so the robots read against them. */
const INTERIOR_SHADE = 0.28;
/** How strongly the warm torchlight wash lights the stone. */
/** Gold light: its colour (multiplied, doubled, over the stone) and each kind of pool's strength. */
const GOLD = 0xc87c00;
const GOLD_DEEP = 0x7a4c00;
const GOLD_K = { alcove: 0.5, walk: 0.62, rim: 0.9, front: 0.95, torch: 0.95, candle: 0.4 };
/** The concept's chunky, wide, rounded heavy type: SF Pro Rounded where WebKit has it. */
const FONT = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Paseo Barlow", sans-serif';
/** Its weights: labels and plaques heavy, the HUD's lighter lines bold. */
const HEAVY = 800;
const BOLD = 700;
const INK = "#2a1a0e";
const ALERT = "#b0301c";

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}.`));
    image.src = url;
  });
const png = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");

/** The sheets graded at load (the robots, labels and status marks keep their own colours). */
const GRADED = new Set(["stone", "gate", "alcoves", "props"]);
/** The concept's grade: a fifth more saturation, shadows and mids pushed toward its purples
 * (#2a1f4a, #4a3a7a) by how dark they are, warm highlights (torch light, gold) left warm. */
export const GRADE = { lift: 1.19, warmth: [1, 1, 1], saturation: 1.05, shadow: [0x2a, 0x1f, 0x4a], mid: [0x4a, 0x3a, 0x7a], strength: 0.1 };
function grade(image: HTMLImageElement, opts: { saturation?: number; strength?: number } = {}): HTMLCanvasElement {
  const saturation = opts.saturation ?? GRADE.saturation, strength = opts.strength ?? GRADE.strength;
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const norm = (c: number[]) => {
    const m = Math.max(...c);
    return c.map((v) => v / m);
  };
  const shadow = norm(GRADE.shadow), mid = norm(GRADE.mid);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    r = l * 255 + (r - l * 255) * saturation;
    g = l * 255 + (g - l * 255) * saturation;
    b = l * 255 + (b - l * 255) * saturation;
    // Warm highlights (flames, gold, lamp light) stay as they are.
    const warm = r > b + 25 && r > 120;
    if (!warm && strength > 0) {
      const t = strength * Math.pow(1 - l, 1.3);
      const tint = l < 0.35 ? shadow : mid;
      r *= (1 - t + t * tint[0]!) * GRADE.warmth[0]! * GRADE.lift;
      g *= (1 - t + t * tint[1]!) * GRADE.warmth[1]! * GRADE.lift;
      b *= (1 - t + t * tint[2]!) * GRADE.warmth[2]! * GRADE.lift;
    }
    d[i] = Math.max(0, Math.min(255, r));
    d[i + 1] = Math.max(0, Math.min(255, g));
    d[i + 2] = Math.max(0, Math.min(255, b));
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Every frame of the contract: the sheets' where they have it, a placeholder where not. */
async function buildFrames(): Promise<{ canvases: Map<string, HTMLCanvasElement>; real: Set<string> }> {
  const canvases = new Map<string, HTMLCanvasElement>();
  const real = new Set<string>();
  for (const [path, json] of Object.entries(SHEET_JSON)) {
    const sheet = json as SheetJson;
    if (!sheet || typeof sheet !== "object" || !sheet.frames) continue;
    const pngPath = path.replace(/\.json$/, ".png");
    const url = SHEET_PNG[pngPath];
    if (!url) continue;
    let image: HTMLImageElement;
    try {
      image = await load(url);
    } catch {
      continue;
    }
    // The board lays out with the sheet's own sizes and anchors.
    applySheet(sheet);
    // The stone, gate, alcoves and props are graded once toward the concept's deeper purple.
    const stem = path.replace(/^.*\//, "").replace(/\.json$/, "");
    // The robots keep their colours vivid: only a saturation lift, never the purple grade.
    const source = GRADED.has(stem) ? grade(image) : stem === "robots" ? grade(image, { saturation: 1.15, strength: 0 }) : image;
    for (const [name, f] of Object.entries(sheet.frames)) {
      if (!FRAMES[name]) continue;
      const canvas = document.createElement("canvas");
      canvas.width = f.w;
      canvas.height = f.h;
      canvas.getContext("2d")!.drawImage(source, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      canvases.set(name, canvas);
      real.add(name);
    }
  }
  for (const name of Object.keys(FRAMES)) if (!canvases.has(name)) canvases.set(name, paintPlaceholder(name));
  trimRobots(canvases);
  bakeHalos(canvases);
  return { canvases, real };
}

/** Crop each robot's and drone's frames to the opaque pixels of all its frames together (so it
 * keeps its place as it animates), so the board sizes the visible robot, standing on its feet. */
function trimRobots(canvases: Map<string, HTMLCanvasElement>) {
  const groups = new Map<string, string[]>();
  for (const name of canvases.keys()) {
    const m = /^(robot-\w+|drone-\w+)-(?:idle|work)?-?\d$/.exec(name);
    if (m) groups.set(m[1]!, [...(groups.get(m[1]!) ?? []), name]);
  }
  for (const names of groups.values()) {
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    for (const name of names) {
      const c = canvases.get(name)!;
      const data = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++)
          if (data[(y * c.width + x) * 4 + 3]! > 24) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
    }
    if (x1 < x0) continue;
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    for (const name of names) {
      const src = canvases.get(name)!;
      const spec = FRAMES[name]!;
      const scale = src.width / spec.w;
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      out.getContext("2d")!.drawImage(src, x0, y0, w, h, 0, 0, w, h);
      canvases.set(name, out);
      spec.w = w / scale;
      spec.h = h / scale;
      spec.anchor = name.startsWith("drone") ? "center" : "feet";
    }
  }
}

/** Each robot colour's halo: its idle silhouette, in a light tint of its colour, blurred into a soft
 * outer glow (`halo-<colour>`, drawn behind the robot, added over the scene). Baked once. */
const HALO = {
  pad: 0.2,
  // Each in its robot's own saturated colour, so the glow says "this robot" rather than washing it white.
  tint: { orange: "#ff8a3a", white: "#ffffff", blue: "#4aa8ff", purple: "#b47aff", green: "#5aff6a", yellow: "#ffd83a",
    red: "#ff5a5a", grey: "#c8c8e0", teal: "#3affe0", pink: "#ff7ac8" } as Record<string, string>,
};
function bakeHalos(canvases: Map<string, HTMLCanvasElement>) {
  for (const [name, src] of [...canvases]) {
    const m = /^robot-(\w+)-idle-0$/.exec(name);
    if (!m) continue;
    const color = m[1]!;
    const pad = Math.round(src.width * HALO.pad);
    const out = document.createElement("canvas");
    out.width = src.width + 2 * pad;
    out.height = src.height + 2 * pad;
    const sil = document.createElement("canvas");
    sil.width = src.width;
    sil.height = src.height;
    const s = sil.getContext("2d")!;
    s.drawImage(src, 0, 0);
    s.globalCompositeOperation = "source-in";
    s.fillStyle = HALO.tint[color] ?? "#fff6e0";
    s.fillRect(0, 0, sil.width, sil.height);
    // Blurred by stacking faint copies round a disc (WebKit's canvas has no reliable filter).
    const ctx = out.getContext("2d")!;
    ctx.globalAlpha = 0.07;
    for (let ring = 1; ring <= 3; ring++)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2, d = (pad * ring) / 3.4;
        ctx.drawImage(sil, pad + Math.cos(a) * d, pad + Math.sin(a) * d);
      }
    const spec = FRAMES[name]!;
    const scale = src.width / spec.w;
    canvases.set(`halo-${color}`, out);
    FRAMES[`halo-${color}`] = { sheet: "robots", w: out.width / scale, h: out.height / scale, anchor: "center" };
  }
}

/** Draw a frame 9-sliced into a box: its corners at their size (times `k`), its edges and middle stretched. */
function nineSlice(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, name: string, x: number, y: number, w: number, h: number, k = 1) {
  const spec = FRAMES[name]!;
  const ins = sliceOf(spec);
  const px = src.width / spec.w;
  // Corners never take more than half the box.
  const fit = Math.min(k, w / 2 / Math.max(ins.left, ins.right, 0.01), h / 2 / Math.max(ins.top, ins.bottom, 0.01));
  const xs = [0, ins.left * px, src.width - ins.right * px, src.width], ys = [0, ins.top * px, src.height - ins.bottom * px, src.height];
  const dx = [x, x + ins.left * fit, x + w - ins.right * fit, x + w], dy = [y, y + ins.top * fit, y + h - ins.bottom * fit, y + h];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      const s = { x: xs[c]!, y: ys[r]!, w: xs[c + 1]! - xs[c]!, h: ys[r + 1]! - ys[r]! };
      const t = { x: dx[c]!, y: dy[r]!, w: dx[c + 1]! - dx[c]!, h: dy[r + 1]! - dy[r]! };
      if (s.w > 0 && s.h > 0 && t.w > 0 && t.h > 0) ctx.drawImage(src, s.x, s.y, s.w, s.h, t.x, t.y, t.w, t.h);
    }
}

export function mountNativeDungeon(parent: HTMLElement, handlers: AtlasHandlers = {}): AtlasWorld {
  const post = (message: Record<string, unknown> & { type: string }) => channel()?.postMessage(message);
  let destroyed = false;
  let ready = false;
  let frames: Map<string, HTMLCanvasElement> | null = null;
  let realFrames = new Set<string>();
  let data: AtlasData | null = null;
  let layout: DungeonLayout | null = null;
  let selection: string | null = null;
  let hovered: string | null = null;
  let hoverAt: { x: number; y: number } | undefined;
  let hoverFlag: MapFlag | undefined;
  let enabled = true;
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let zoom = 1;
  let nativeState: Record<string, unknown> = {};
  let builds = 0;
  const watch = newWatch();
  let updatedAt = 0;
  let postedAt = 0;
  let reposts = 0;
  /** Painted images Swift already holds, by content key. */
  const sent = new Set<string>();
  const entity = (id: string | null) => (id && layout?.entities.find((e) => e.id === id)) || null;

  const measurer = document.createElement("canvas").getContext("2d")!;
  const fontOf = (kind: keyof typeof D.font) => `${kind === "stats" ? BOLD : HEAVY} ${D.font[kind]}px ${FONT}`;
  const measure: Measure = (text, kind) => {
    measurer.font = fontOf(kind);
    return measurer.measureText(text).width;
  };
  const frame = (name: string) => frames!.get(name) ?? frames!.get(`${name}-0`)!;

  /** A painted image, sent once per content key. */
  const image = (key: string, paint: () => HTMLCanvasElement) => {
    if (sent.has(key)) return { key };
    sent.add(key);
    return { key, png: png(paint()) };
  };
  const canvasFor = (w: number, h: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(w * TEXT_SCALE);
    canvas.height = Math.ceil(h * TEXT_SCALE);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(TEXT_SCALE, TEXT_SCALE);
    return { canvas, ctx };
  };
  const fitText = (text: string, kind: keyof typeof D.font, max: number) => {
    let shown = text;
    while (measure(shown, kind) > max && shown.length > 1) shown = shown.slice(0, -2) + "…";
    return shown;
  };
  /** A parchment label with its text centred, bold dark brown. */
  const paintLabel = (r: Rect, text: string, kind: "workspace" | "project") => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    // The sheet's own cream, undimmed.
    nineSlice(ctx, frame("label"), "label", 0, 0, r.w, r.h);
    ctx.font = fontOf(kind);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(text, kind, r.w - 20), r.w / 2, r.h / 2 + 1);
    return canvas;
  };
  /** The host's plaque: its name, then a status dot and its machine's load. */
  const paintPlaque = (r: Rect, title: string, stats: { text: string; alert: boolean }[], online: boolean) => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    nineSlice(ctx, frame("plaque"), "plaque", 0, 0, r.w, r.h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = fontOf("host");
    ctx.fillStyle = INK;
    ctx.fillText(fitText(title, "host", r.w - 30), r.w / 2, r.h * 0.36);
    // The second line: a status dot, then CPU · MEM · DISK (≥ 90% in red), or that it's offline.
    const parts = stats.length ? stats.flatMap((s, i) => (i ? [{ text: " · ", alert: false }, s] : [s])) : [{ text: online ? "No load reading" : "Offline", alert: false }];
    ctx.font = fontOf("stats");
    const widths = parts.map((p) => ctx.measureText(p.text).width);
    const dot = 11;
    let x = r.w / 2 - (widths.reduce((s, w) => s + w, 0) + dot + 5) / 2;
    const y = r.h * 0.7;
    const dotFrame = frame(online ? "dot-online" : "dot-offline");
    ctx.drawImage(dotFrame, x, y - dot / 2, dot, dot);
    x += dot + 5;
    ctx.textAlign = "left";
    parts.forEach((p, i) => {
      ctx.fillStyle = p.alert ? ALERT : INK;
      ctx.fillText(p.text, x, y + 0.5);
      x += widths[i]!;
    });
    return canvas;
  };
  /** The HUD's title plaque and count bar: navy panels with gold borders, in screen points. */
  const paintTitle = (subtitle: string) => {
    const title = "Dungeon Board — Command Center";
    measurer.font = `${HEAVY} 22px ${FONT}`;
    const tw = measurer.measureText(title).width;
    measurer.font = `${BOLD} 15px ${FONT}`;
    const sw = measurer.measureText(subtitle).width;
    const w = Math.ceil(Math.max(tw, sw) + 92), h = 66;
    const { canvas, ctx } = canvasFor(w, h);
    nineSlice(ctx, frame("panel"), "panel", 0, 0, w, h);
    ctx.drawImage(frame("icon-castle"), 18, h / 2 - 17, 34, 34);
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4ead2";
    ctx.font = `${HEAVY} 22px ${FONT}`;
    ctx.fillText(title, 66, 25);
    ctx.fillStyle = "#cfc6e6";
    ctx.font = `${BOLD} 15px ${FONT}`;
    ctx.fillText(subtitle, 66, 47);
    return { canvas, w, h };
  };
  const paintCounts = (counts: DungeonLayout["counts"]) => {
    const items = [
      ["hosts", counts.hosts, counts.hosts === 1 ? "Host" : "Hosts"],
      ["projects", counts.projects, counts.projects === 1 ? "Project" : "Projects"],
      ["workspaces", counts.workspaces, counts.workspaces === 1 ? "Workspace" : "Workspaces"],
      ["agents", counts.agents, counts.agents === 1 ? "Agent" : "Agents"],
    ] as const;
    const num = `${HEAVY} 24px ${FONT}`, word = `${BOLD} 19px ${FONT}`;
    const widths = items.map(([, n, label]) => {
      measurer.font = num;
      const a = measurer.measureText(String(n)).width;
      measurer.font = word;
      return 30 + 10 + a + 8 + measurer.measureText(label).width;
    });
    const gap = 46;
    const w = Math.ceil(widths.reduce((s, x) => s + x, 0) + gap * (items.length - 1) + 56), h = 56;
    const { canvas, ctx } = canvasFor(w, h);
    nineSlice(ctx, frame("panel"), "panel", 0, 0, w, h);
    ctx.textBaseline = "middle";
    let x = 28;
    items.forEach(([icon, n, label], i) => {
      ctx.drawImage(frame(`count-${icon}`), x, h / 2 - 15, 30, 30);
      x += 40;
      ctx.font = num;
      ctx.fillStyle = "#b9e34a";
      ctx.fillText(String(n), x, h / 2 + 1);
      x += ctx.measureText(String(n)).width + 8;
      ctx.font = word;
      ctx.fillStyle = "#f2ead6";
      ctx.fillText(label, x, h / 2 + 1);
      x += ctx.measureText(label).width;
      if (i < items.length - 1) {
        ctx.fillStyle = "#d8a840";
        ctx.fillRect(x + gap / 2 - 1, h / 2 - 12, 2, 24);
        x += gap;
      }
    });
    return { canvas, w, h };
  };

  /** A frame drawn with its anchor at (x, y), `w` wide (its height keeping its shape), as a top-left box. */
  const at = (name: string, x: number, y: number, w?: number) => {
    const spec = FRAMES[name] ?? FRAMES[`${name}-0`]!;
    const width = w ?? spec.w;
    const height = (spec.h * width) / spec.w;
    const a = anchorShare(spec.anchor);
    return { x: x - a.x * width, y: y - a.y * height, w: width, h: height };
  };
  type Sprite = Record<string, unknown>;
  const sprite = (name: string, box: { x: number; y: number; w: number; h: number }, z: number, extra: Sprite = {}): Sprite => {
    const animated = ANIMATIONS[name] !== undefined;
    return {
      f: animated ? `${name}-0` : name,
      ...(animated ? { anim: framesOf(name), fps: name.startsWith("torch") || name.startsWith("candle") || name.startsWith("brazier") ? 8 : 6 } : {}),
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      z,
      ...extra,
    };
  };
  const tile = (name: string, r: Rect, z: number, extra: Sprite = {}): Sprite => ({ f: name, x: r.x, y: r.y, w: r.w, h: r.h, z, tile: FRAMES[name]!.tile ?? "xy", ...extra });

  /** A shading overlay, stretched over the board: a purple shadow falling from the top of a floor's upper wall,
   * or a vignette darkening the board toward its edges. */
  const paintShade = (kind: "upper" | "edges" | "warm" | "under" | "patch") => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    // A muted deep purple: it darkens without over-saturating (the grade already deepens the hue).
    const shadow = (a: number) => `rgba(30, 22, 44, ${a})`;
    if (kind === "under") {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, "rgba(14, 10, 34, 0.7)");
      g.addColorStop(1, "rgba(14, 10, 34, 0)");
      ctx.fillStyle = g;
    } else if (kind === "patch") {
      const g = ctx.createRadialGradient(128, 128, 10, 128, 128, 128);
      g.addColorStop(0, "rgba(20, 12, 40, 0.45)");
      g.addColorStop(1, "rgba(20, 12, 40, 0)");
      ctx.fillStyle = g;
    } else if (kind === "warm") {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      // Golden, not grey: the purple stays in the shadows, the light is warm and saturated.
      g.addColorStop(0, "rgba(255, 150, 40, 0.45)");
      g.addColorStop(0.6, "rgba(255, 158, 46, 0.8)");
      g.addColorStop(1, "rgba(255, 150, 40, 1)");
      ctx.fillStyle = g;
    } else if (kind === "upper") {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, shadow(0.4));
      g.addColorStop(0.55, shadow(0.24));
      g.addColorStop(1, shadow(0));
      ctx.fillStyle = g;
    } else {
      const g = ctx.createRadialGradient(128, 128, 70, 128, 128, 182);
      g.addColorStop(0, shadow(0));
      g.addColorStop(0.7, shadow(0.08));
      g.addColorStop(1, shadow(0.3));
      ctx.fillStyle = g;
    }
    ctx.fillRect(0, 0, 256, 256);
    return canvas;
  };

  /** The board's stone, gates, alcoves, labels, links and decorations: what changes only when places do. */
  const sceneOf = (l: DungeonLayout) => {
    const sprites: Sprite[] = [];
    const images: Sprite[] = [];
    const lights: Sprite[] = [];
    const dimOf = (floor: number) => (l.floors[floor]?.online ? {} : { dim: 1 });
    const fill = (name: string, r: Rect, z: number, extra: Sprite = {}) => sprites.push(tile(name, r, z, extra));
    const put = (name: string, x: number, y: number, w: number, h: number, z: number, extra: Sprite = {}) => sprites.push(sprite(name, { x, y, w, h }, z, extra));
    // The wall above the first floor, with its pillars; the HUD's title lies over it.
    {
      const r = l.topBand.rect, H = r.w / 2;
      fill("wall-brick-dark", r, -60, { shade: WALL_SHADE });
      fill("wall-brick", { x: -H + 22, y: r.y + 4, w: 2 * H - 49, h: r.h - 4 }, -55, { shade: WALL_SHADE, ox: 37, oy: 11 });
      for (const p of l.topBand.piers) {
        fill("pillar", p, -45);
        if (FRAMES["pillar-capital"]?.real) put("pillar-capital", p.x - 8, p.y - 4, p.w + 16, 24, -44.8);
      }
      images.push({ ...image("shade:upper", () => paintShade("upper")), x: r.x, y: r.y, w: r.w, h: r.h, z: -43.5 });
    }
    l.floors.forEach((fl, f) => {
      const dim = dimOf(f);
      const T = fl.top, H = fl.rect.w / 2;
      const rng = random(seedOf(fl.host.id + "wall"));
      // The far wall: the darker stone round the edge, the hall's brick inset, its tiling offset per floor.
      fill("wall-brick-dark", fl.rect, -60, { ...dim, shade: WALL_SHADE });
      const brick = FRAMES["wall-brick"]!;
      const floorEnd = fl.tierTops[fl.tiers - 1]! + D.frontY;
      fill("wall-brick", { x: -H + 22, y: T + 5, w: 2 * H - 49, h: floorEnd + 2 - (T + 5) }, -55, { ...dim, shade: WALL_SHADE, ox: Math.floor(rng() * brick.w), oy: Math.floor(rng() * brick.h) });
      // The upper back wall: a thick rampart either side of the gate's surround, returning at the floor's ends.
      // (Below the first floor, the floor above's front wall closes the top instead.)
      if (f === 0) {
        for (const sd of [-1, 1]) {
          const x0 = sd === -1 ? -H + 55 : D.surroundW / 2 - 2, x1 = sd === -1 ? -D.surroundW / 2 + 2 : H - 52;
          fill("rampart-x", { x: x0, y: T + 25, w: x1 - x0, h: 24 }, -44, dim);
        }
        put("rampart-return-left", -H, T + 25, 72, 70, -43.9, dim);
        put("rampart-return-right", H - 69, T + 25, 69, 70, -43.9, dim);
      }
      // Block pillars with caps and bases.
      for (const r of fl.piers) {
        fill("pillar", r, -45, dim);
        if (FRAMES["pillar-capital"]?.real) put("pillar-capital", r.x - 8, T + 21, r.w + 16, 26, -44.8, dim);
        else put("pillar-cap", r.x - 4, T + 23, r.w + 8, 27, -44.8, dim);
        put("pillar-base", r.x - 4, r.y + r.h - 15, r.w + 8, 29, -44.8, dim);
      }
      // Each tier: the terrace floor under its walkway, and the thick front wall that closes it (lit top, returns, ends).
      for (const y0 of fl.tierTops) {
        fill("terrace-floor", { x: -H + 20, y: y0 + D.floorY - 48, w: 2 * H - 40, h: 74 }, -40, { ...dim, shade: 0.12 });
        // The last tier's front wall opens round the next floor's gate; any other's round the stairs.
        const open = !fl.last && y0 === fl.tierTops[fl.tiers - 1] ? D.surroundW / 2 - 4 : D.stairsW / 2 + 2;
        for (const sd of [-1, 1]) {
          const x0 = sd === -1 ? -H + 113 : open, x1 = sd === -1 ? -open : H - 111;
          fill("rampart-x", { x: x0, y: y0 + D.frontY, w: x1 - x0, h: 28 }, -9, dim);
        }
        put("rampart-return-right", -H + 30, y0 + D.frontY - 16, 92, 43, -8.9, dim);
        put("rampart-return-left", H - 118, y0 + D.frontY - 16, 88, 43, -8.9, dim);
        put("rampart-end-left", -H + 12, y0 + D.frontY - 24, 31, 30, -8.8, dim);
        put("rampart-end-right", H - 38, y0 + D.frontY - 24, 31, 30, -8.8, dim);
        // The cutaway's thickness under the rampart's lip: the ledge's face, corbels carrying it, and a cool
        // shadow beneath, so the floor reads as a slab with the next floor's wall in its shade.
        fill("ledge-face", { x: -H + 26, y: y0 + D.frontY + 26, w: 2 * H - 52, h: 14 }, -9.2, { ...dim, shade: 0.5, neutral: 1 });
        for (let cx = -H + 70; cx < H - 60; cx += 118) {
          if (Math.abs(cx) < D.surroundW / 2 + 10 && !fl.last && y0 === fl.tierTops[fl.tiers - 1]) continue;
          put("pillar-base", cx - 12, y0 + D.frontY + 36, 24, 18, -9.25, dim);
        }
        images.push({ ...image("shade:under", () => paintShade("under")), x: -H + 20, y: y0 + D.frontY + 38, w: 2 * H - 40, h: 22, z: -9.3 });
      }
      // The enclosure's edges, excavated: irregular masses of dark stone biting in at the floor's ends.
      for (const sd of [-1, 1])
        for (let y = T + 10; y < T + fl.height - 30; y += 40 + rng() * 50) {
          const bite = 10 + rng() * 22, h = 30 + rng() * 60;
          fill("wall-brick-dark", { x: sd === -1 ? -H : H - bite, y, w: bite, h }, -54, { ...dim, shade: 0.35 });
        }
      // Dark breaks on the upper wall: soft shadow patches, so it never reads as wallpaper.
      for (let i = 0; i < 4; i++) {
        const w = 70 + rng() * 80, x = -H + D.sideRoom + rng() * (2 * H - 2 * D.sideRoom - w);
        if (Math.abs(x + w / 2) < D.surroundW / 2 + w / 2) continue;
        images.push({ ...image("shade:patch", () => paintShade("patch")), x, y: T + 18 + rng() * 50, w, h: 50 + rng() * 40, z: -50 });
      }
      if (fl.last) fill("terrace-floor", { x: -H + 20, y: floorEnd + 28, w: 2 * H - 40, h: fl.top + fl.height - floorEnd - 34 }, -40, { ...dim, shade: 0.1 });
      // The gate column: the big round surround with the host's icon in its dark top, the plaque, the portcullis
      // behind its arch, and the stairs down between block side walls.
      put("gate-surround", fl.surround.x, fl.surround.y, fl.surround.w, fl.surround.h, -36, dim);
      sprites.push(sprite("icon-layers", at("icon-layers", 0, fl.medallion.y, 47), -35.9, dim));
      // The stairs, a shade down from the sheet's, so their lit steps don't outshine the robots.
      const steps = { ...dim, shade: dim.dim ? 0.55 : 0.28 };
      fill("stairs-mid", { x: fl.stairs.x, y: fl.stairs.y + 36, w: fl.stairs.w, h: Math.max(0, fl.stairs.h - 36) }, -26, steps);
      put("stairs-top", fl.stairs.x, fl.stairs.y, fl.stairs.w, 36, -25.9, steps);
      if (fl.last) put("stairs-bottom", fl.stairs.x, fl.stairs.y + fl.stairs.h - 29, fl.stairs.w, 29, -25.8, steps);
      sprites.push(
        fl.online
          ? sprite("gate-portcullis-lit", fl.portcullis, -25, { pulse: 2600, a: 0.62, shade: 0.3 })
          : sprite("gate-portcullis-dark", fl.portcullis, -25, dim),
      );
      put("gate-arch", fl.arch.x, fl.arch.y, fl.arch.w, fl.arch.h, -24, dim);
      if (fl.online) {
        // The gate's light, turned down so the robots draw the eye first.
        lights.push({ x: 0, y: fl.portcullis.y + fl.portcullis.h / 2, c: 0xffb640, r: 72, period: 2600, flicker: false, k: 0.28 });
        // The stairs catch the gate's light.
        lights.push({ x: 0, y: fl.stairs.y + 40, c: 0xff9a3a, r: 50, period: 3400, flicker: false, ph: 0.4, k: 0.3 });
      }
      images.push({
        ...image(`plaque:${fl.title}:${JSON.stringify(fl.stats)}:${fl.online}:${fl.plaque.w}`, () => paintPlaque(fl.plaque, fl.title, fl.stats, fl.online)),
        x: fl.plaque.x, y: fl.plaque.y, w: fl.plaque.w, h: fl.plaque.h, z: 3, ...dim,
      });
    });
    for (const p of l.projects) {
      const dim = dimOf(p.floor);
      const y0 = p.span.y;
      // The project's terrace: a recess of darker stone behind its medallion and label, under a rampart that returns at its outer end.
      fill("wall-brick-dark", { x: p.span.x + 30, y: y0 + 34, w: Math.max(0, p.span.w - 60), h: 83 }, -50, { ...dim, shade: 0.3 });
      fill("rampart-x", { x: p.span.x + (p.side === -1 ? 36 : 0), y: y0 + 23, w: p.span.w - 36, h: 25 }, -30, dim);
      if (p.side === -1) put("rampart-return-left", p.span.x, y0 + 23, 50, 75, -29.9, dim);
      else put("rampart-return-right", p.span.x + p.span.w - 50, y0 + 23, 50, 75, -29.9, dim);
      sprites.push(sprite("medallion", at("medallion", p.medallion.x, p.medallion.y, D.medallionR * 2), 2, dim));
      sprites.push(sprite(`icon-${p.icon}`, at(`icon-${p.icon}`, p.medallion.x, p.medallion.y, 30), 2.1, dim));
      images.push({
        ...image(`label:p:${p.name}:${p.label.w}`, () => paintLabel(p.label, p.name, "project")),
        x: p.label.x, y: p.label.y, w: p.label.w, h: p.label.h, z: 3, ...dim,
      });
    }
    for (const w of l.workspaces) {
      const dim = { ...dimOf(w.floor), ...(w.entity.stale ? { a: 0.7 } : {}) };
      const online = l.floors[w.floor]!.online;
      const { x, y, w: width } = w.rect;
      const inner = width - 40;
      // The alcove, as the art's own assembly: dark interiors between chunky sides, a lintel with low-wall returns, a ledge in front.
      const count = Math.max(1, Math.round(inner / FRAMES["alcove-slot-0"]!.w));
      // Workstations at the bay's ends, outside the robots' silhouettes: a monitor desk at the left (turned to face
      // in), a book shelf at the right, or a second monitor desk in a wide bay; plain wall behind the robots.
      const wide = w.agents.length >= 4;
      for (let i = 0; i < count; i++) {
        const left = i === 0, right = i === count - 1 && count > 1;
        const v = w.entity.camp ? (left || right ? 3 : 0) : left ? 1 : right ? (wide ? 1 : 2) : 0;
        put(`alcove-slot-${v}`, x + 20 + (i * inner) / count, y + 12, inner / count + 0.5, D.alcoveH - 22, -12,
          { ...dim, shade: dim.dim ? 0.55 : INTERIOR_SHADE, ...(left && v === 1 ? { flip: 1 } : {}) });
      }
      put("alcove-left", x, y + 7, 24, D.alcoveH - 9, -11, dim);
      put("alcove-right", x + width - 24, y + 7, 24, D.alcoveH - 9, -11, dim);
      fill("alcove-top", { x: x + 20, y, w: inner, h: 22 }, -10.9, dim);
      put("rampart-return-left", x - 2, y - 5, 45, 43, -10.8, dim);
      put("rampart-return-right", x + width - 43, y - 5, 45, 43, -10.8, dim);
      fill("alcove-ledge", { x: x + 20, y: y + D.alcoveH - 15, w: inner, h: 15 }, -10, dim);
      for (const c of w.candles) {
        sprites.push(sprite("candle", at("candle", c.x, c.y, 10), 4, dim));
        if (online) {
          lights.push({ x: c.x, y: c.y - 30, c: 0xffb050, r: 34, period: 1900, flicker: true, ph: random(seedOf(w.entity.id + c.x))(), k: 0.7 });
          lights.push({ x: c.x, y: c.y - 6, rx: 26, ry: 12, c: GOLD, blend: "gold", k: GOLD_K.candle, z: -9.5, period: 1900, flicker: true, ph: random(seedOf(w.entity.id + c.x + "g"))() });
        }
      }
      // The ledge glows warm where the robots stand.
      // (The ledge is lit only where robots stand: their spotlights, with the agents.)
      images.push({
        ...image(`label:w:${w.entity.name}:${w.label.w}`, () => paintLabel(w.label, w.entity.name, "workspace")),
        x: w.label.x, y: w.label.y, w: w.label.w, h: w.label.h, z: 3, ...dim,
      });
    }
    const flags = l.workspaces.flatMap((w) => [
      ...w.flags.map((f) => ({ ws: w.entity.id, flag: f.flag, ...sprite(f.frame, at(f.frame, f.x, f.y, f.size), 5, { ...dimOf(w.floor), ...(f.flag === "probe" && w.entity.probe?.state === "reviewing" ? { pulse: 1800 } : f.flag === "ci-running" ? { pulse: 1400 } : {}) }), cx: f.x, cy: f.y, s: f.size })),
      ...(w.seal ? [{ ...sprite("seal-automerge", at("seal-automerge", w.seal.x, w.seal.y, w.seal.size), 5.1, dimOf(w.floor)) }] : []),
    ]);
    for (const d of l.decor) {
      if (d.project) continue;
      // Rugs lie on the terrace floor; recesses stand on it; other back things hang on the far wall.
      const z = d.frame === "rug-red" ? -39.5 : d.recess ? -38 : d.layer === "back" ? -48 : -4;
      // Side rooms' recesses a shade down, so their coloured light never outshines the robots.
      // Side rooms' recesses and the foot's red rugs a shade down, so neither outshines the robots.
      const glowing = /^(magic-circle|crystal|alchemy-tank|forge)$/.test(d.frame);
      const quiet = (d.recess || glowing || d.frame === "rug-red") && l.floors[d.floor]?.online ? { shade: d.recess ? 0.45 : glowing ? 0.32 : 0.38 } : {};
      sprites.push(sprite(d.frame, d.rect, z, { ...dimOf(d.floor), ...(d.flip ? { flip: 1 } : {}), ...quiet }));
      if (d.light && l.floors[d.floor]!.online)
        lights.push({
          x: d.rect.x + d.rect.w / 2,
          y: d.light.dy !== undefined ? d.rect.y + d.light.dy : d.frame === "torch" ? d.rect.y + 8 : d.rect.y + d.rect.h * 0.45,
          c: d.light.color, r: d.light.reach, period: 2400, flicker: d.frame === "torch" || d.frame === "brazier", ph: random(seedOf(`${d.frame}${d.x},${d.y}`))(),
          // Side rooms' glows stay below the robots'.
          // Side rooms' glows stay below the robots'; torches and braziers too, now the stone is warm-lit.
          ...(d.recess || d.group ? { k: 0.28 } : { k: 0.45 }),
        });
    }
    // The links' joints: bigger gold nodes, each with a soft halo.
    for (const n of l.nodes) {
      sprites.push(sprite("node", at("node", n.x, n.y, 14), 1.5));
      lights.push({ x: n.x, y: n.y, c: 0xffc44a, r: 20, period: 2800, flicker: false, ph: random(seedOf(`node${n.x},${n.y}`))(), z: 1.4, k: 0.7 });
    }
    // Contrast: the upper walls fall into purple shadow toward the top; the board darkens toward its edges.
    for (const fl of l.floors)
      // Over the back wall's ramparts, pillars and banners; under the gate's surround and the torches.
      images.push({ ...image("shade:upper", () => paintShade("upper")), x: fl.rect.x, y: fl.top, w: fl.rect.w, h: D.band + 20, z: -43.5 });
    images.push({ ...image("shade:edges", () => paintShade("edges")), x: l.bounds.x, y: l.bounds.y, w: l.bounds.w, h: l.bounds.h, z: 0.9 });
    // Gold light, where the concept has it: pools that multiply the purple stone toward saturated gold (never a
    // wash over everything, which greys it), in the alcoves, along the walkways, on the front walls' lit tops and
    // round the torches. Offline floors stay unlit; the gate's column keeps its own, quieter light.
    const gold = (x: number, y: number, rx: number, ry: number, k: number, z: number) =>
      lights.push({ x, y, rx, ry, c: GOLD, blend: "gold", k, z, period: 5200, flicker: false, ph: random(seedOf(`g${x},${y}`))() });
    for (const w of l.workspaces) {
      if (!l.floors[w.floor]!.online) continue;
      const r = w.rect;
      // (Since art v5 the alcoves' interiors carry their own gold light; a pool over them outshone the robots.)
      void r;
    }
    for (const fl of l.floors) {
      if (!fl.online) continue;
      for (const y0 of fl.tierTops) {
        for (const sd of [-1, 1])
          for (let x = D.stairsW / 2 + 70; x < fl.rect.w / 2 - 40; x += 120) {
            // (The walkways' terrace floor carries its own warm light since art v5.)
            // A deeper gold here: saturated, but not brighter than the robots above it.
            for (const dx of [0, 60]) lights.push({ x: sd * (x + dx), y: y0 + D.frontY + 9, rx: 70, ry: 15, c: GOLD_DEEP, blend: "gold", k: GOLD_K.front, z: -8.5, period: 5200, flicker: false });
          }
      }
    }
    // Gold rim light along the lit tops of each project terrace's wall and each floor's back wall.
    for (const p of l.projects) {
      if (!l.floors[p.floor]!.online) continue;
      for (let x = p.span.x + 30; x < p.span.x + p.span.w - 10; x += 52)
        lights.push({ x, y: p.span.y + 31, rx: 46, ry: 14, c: GOLD_DEEP, blend: "gold", k: GOLD_K.rim, z: -29.5, period: 5200, flicker: false });
    }
    for (const fl of l.floors) {
      if (!fl.online) continue;
      for (const sd of [-1, 1])
        for (let x = D.surroundW / 2 + 30; x < fl.rect.w / 2 - 50; x += 52)
          lights.push({ x: sd * x, y: fl.top + 33, rx: 46, ry: 14, c: GOLD_DEEP, blend: "gold", k: GOLD_K.rim, z: -43.5, period: 5200, flicker: false });
    }
    // The project terraces' recess walls, lit warm from the alcoves below.
    for (const p of l.projects) {
      if (!l.floors[p.floor]!.online) continue;
      for (let x = p.span.x + 50; x < p.span.x + p.span.w - 30; x += 64)
        lights.push({ x, y: p.span.y + 86, rx: 50, ry: 30, c: GOLD_DEEP, blend: "gold", k: 0.95, z: -49.5, period: 5200, flicker: false });
    }
    // One pool per torch, or per pair of torches close together (stacked pools would outshine the robots).
    const pooled: { x: number; y: number }[] = [];
    for (const d of l.decor) {
      if (d.frame !== "torch" || !l.floors[d.floor]?.online) continue;
      const x = d.rect.x + d.rect.w / 2, y = d.rect.y + 30;
      if (pooled.some((q) => Math.hypot(q.x - x, q.y - y) < 90)) continue;
      pooled.push({ x, y });
      // Tight: a small bright heart and a quick falloff, torchlight on stone rather than a smudge.
      lights.push({ x, y, rx: 42, ry: 40, c: GOLD, blend: "gold", tight: 1, k: GOLD_K.torch, z: -43, period: 5200, flicker: false });
      // Its light falling on the wall below: wide and deep (warm, not bright).
      lights.push({ x, y: y + 30, rx: 60, ry: 40, c: GOLD_DEEP, blend: "gold", tight: 1, k: 0.95, z: -43.2, period: 5200, flicker: false });
    }
    return {
      type: "scene",
      build: ++builds,
      bounds: l.bounds,
      sprites,
      images,
      lights,
      flags,
      links: l.links.map((pts) => pts.flatMap((p) => [p.x, p.y])),
      linkDim: l.links.map((pts) => {
        const fl = l.floors.find((f) => pts[0]!.y >= f.top && pts[0]!.y < f.top + f.height);
        return fl && !fl.online ? 1 : 0;
      }),
      entities: l.entities
        .filter((e) => e.kind !== "host")
        .map((e) => {
          const r =
            e.kind === "agent"
              ? l.agents.find((a) => a.entity.id === e.id)!.rect
              : e.kind === "workspace"
                ? l.workspaces.find((w) => w.entity.id === e.id)!.rect
                : l.projects.find((p) => p.entity?.id === e.id)!.rect;
          return { id: e.id, kind: e.kind, x: r.x, y: r.y, w: r.w, h: r.h };
        }),
    };
  };
  /** What changes with the agents' states: robots, their glows and markers, the projects' torches and flares, the runs of light, the HUD. */
  const agentsOf = (l: DungeonLayout) => {
    const robots = l.agents.map((a) => {
      const e = a.entity;
      const color = a.robot;
      const state = e.state!;
      const offline = state === "offline";
      // The concept's robots: about 1.2 times a workspace label's height.
      // Its height the board's, its width the frames' own shape (their union, arms and bob included).
      const spec = FRAMES[`robot-${color}-idle-0`]!;
      const width = (D.robotH * spec.w) / spec.h;
      const box = { x: a.feet.x - width / 2, y: a.feet.y - D.robotH, w: width, h: D.robotH };
      const glow = STATE_GLOW[state];
      const mark = STATE_MARK[state];
      const rng = random(seedOf(e.id + "bob"));
      return {
        id: e.id,
        ...box,
        idle: framesOf(`robot-${color}-idle`),
        work: framesOf(`robot-${color}-work`),
        busy: state === "running",
        dim: offline ? 1 : 0,
        ph: rng(),
        // The state's glow on the ledge beneath it, wide enough to show either side of its feet.
        // In the Atlas's state colours (idle a quiet grey-lavender), an ellipse on the ledge round its feet.
        glow: {
          c: STATE_TILE[state] ?? 0x9aa0c8,
          a: state === "idle" ? 0.5 : 0.9,
          x: a.feet.x, y: a.feet.y + 1, w: D.robot * 1.6, h: D.robot * 0.46,
          ...(PULSE_MS[state] ? { pulse: PULSE_MS[state] } : {}),
        },
        // Over its head's upper right, clear of the workspace's label above.
        // Over its head's upper right, about 60% of the head's width, pulsing.
        // Pulsing by scale (1.0 to 1.12), never fading, over the drones.
        ...(mark ? { mark: { f: mark, ...at(mark, a.feet.x + D.robot * 0.32, a.feet.y - D.robotH + 4, D.robot * 0.6), pulse: PULSE_MS[state] ?? 1800, scale: 0.12 } } : {}),
        // Its halo (in its colour, behind it) and its visor's glow, which move with it.
        ...(FRAMES[`halo-${color}`] && !offline
          ? { halo: { f: `halo-${color}`, w: width * (1 + 2 * HALO.pad), h: D.robotH * (1 + 2 * HALO.pad) } }
          : {}),
        ...(offline ? {} : { eyes: { x: width / 2, y: D.robotH * 0.4, w: width * 0.7, c: 0x8ff0ff } }),
        drones: offline ? [] : a.drones.slice(0, Math.min(4, e.subagents ?? 0)).map((c) => framesOf(`drone-${c}`)),
        droneDefault: framesOf(`drone-${color}`),
        // Drones read at about 55% of a robot's visible height.
        // Drones are small helpers: a third of a robot's height, orbiting above its head.
        droneSize: Math.round(D.robotH * 0.33),
        subagents: offline ? 0 : Math.min(4, e.subagents ?? 0),
      };
    });
    const sprites: Sprite[] = [];
    const lights: Sprite[] = [];
    // A warm white spotlight on the ledge under each robot, brighter than its surroundings.
    for (const a of l.agents)
      if (a.entity.state !== "offline") {
        lights.push({ x: a.feet.x, y: a.feet.y - 18, c: 0xfff4e2, r: 50, flicker: false, period: 4000, z: 8.8, k: 1 });
        // A brighter heart to the spotlight, so the robots stay brighter than the warmer stone.
        lights.push({ x: a.feet.x, y: a.feet.y - 24, c: 0xfffaf0, r: 34, flicker: false, period: 4000, z: 8.85, k: 1 });
      }
    for (const p of l.projects) {
      const online = l.floors[p.floor]!.online;
      const id = p.entity?.id ?? p.key;
      const lit = online && projectWorking(l, id);
      for (const t of p.torches) {
        sprites.push(sprite(lit ? "torch" : "torch-out", at("torch", t.x, t.y), -3.5, online ? {} : { dim: 1 }));
        if (lit) lights.push({ x: t.x, y: t.y + 8, c: 0xffa03a, r: 56, period: 2400, flicker: true, ph: random(seedOf(id + t.x))(), k: 0.6 });
      }
      const alarm = online ? projectAlarm(l, id) : undefined;
      if (alarm) lights.push({ x: p.medallion.x, y: p.medallion.y, c: STATE_TILE[alarm]!, r: 54, period: alarm === "failed" ? 1200 : 1800, flicker: false, z: 1.9, ph: 0 });
    }
    // Light runs along the links to each workspace with an agent at work.
    const runners = l.workspaces
      .filter((w) => l.agents.some((a) => a.entity.workspace === w.entity.id && a.entity.state === "running"))
      .map((w) => ({ pts: (l.runs[w.entity.id] ?? []).flatMap((p) => [p.x, p.y]), period: RUNNING_LAP_MS, ph: random(seedOf(w.entity.id + "run"))() }))
      .filter((r) => r.pts.length >= 4);
    const subtitle = hudSubtitle(l);
    const title = paintTitle(subtitle);
    const counts = paintCounts(l.counts);
    const titleKey = `hud:title:${subtitle}`;
    const countsKey = `hud:counts:${JSON.stringify(l.counts)}`;
    return {
      type: "agents",
      robots,
      sprites,
      lights,
      runners,
      hud: {
        title: { ...(sent.has(titleKey) ? { key: titleKey } : (sent.add(titleKey), { key: titleKey, png: png(title.canvas) })), w: title.w, h: title.h },
        counts: { ...(sent.has(countsKey) ? { key: countsKey } : (sent.add(countsKey), { key: countsKey, png: png(counts.canvas) })), w: counts.w, h: counts.h },
      },
    };
  };

  const relayout = () => {
    if (!data || !frames || destroyed) return;
    const next = layoutDungeon(data, surface.aspect(), measure);
    const structural = layout?.signature !== next.signature;
    layout = next;
    try {
      const now = Date.now();
      // Swift keeps every painted image it has had from this page, by key.
      if (structural) post({ ...sceneOf(next), rev: postRevision(watch, "scene", now) });
      post({ ...agentsOf(next), rev: postRevision(watch, "agents", now) });
      postedAt = now;
    } catch (error) {
      console.error(error);
      handlers.error?.("The Dungeon Board could not be drawn. Reload to retry.");
      return;
    }
    if (selection && !entity(selection)) selection = null;
    if (hovered) setHover(entity(hovered) ? hovered : null, hoverAt, hoverFlag);
  };

  const setHover = (id: string | null, at?: { x: number; y: number }, flag?: MapFlag) => {
    hovered = id;
    hoverAt = id ? at : undefined;
    hoverFlag = id ? flag : undefined;
    const e = entity(id);
    handlers.hover?.(e, e && at ? at : null, e ? hoverFlag : undefined);
  };
  type NativeEvent =
    | { type: "ready" }
    | { type: "pick"; id: string | null }
    | { type: "hover"; id: string | null; x?: number; y?: number; flag?: MapFlag }
    | { type: "zoom"; zoom: number }
    | { type: "state"; state: Record<string, unknown> }
    | { type: "stalled"; why: string }
    | { type: "error"; message: string };
  const receive = (event: Event) => {
    const message = (event as CustomEvent<NativeEvent>).detail;
    if (destroyed || !message) return;
    if (message.type === "ready") {
      if (ready) return;
      ready = true;
      post({ type: "select", id: selection });
      handlers.ready?.();
    } else if (message.type === "pick") {
      if (!enabled) return;
      handlers.pick?.(entity(message.id));
    } else if (message.type === "hover") {
      parent.style.cursor = message.id ? "pointer" : "";
      setHover(message.id, message.x === undefined ? undefined : { x: message.x, y: message.y! }, message.flag);
    } else if (message.type === "zoom") {
      zoom = message.zoom;
      handlers.zoom?.(zoom);
    } else if (message.type === "state") {
      nativeState = message.state;
      applied(watch, nativeState);
    } else if (message.type === "stalled") {
      repost(`Swift's map loop stalled (${message.why})`);
    } else if (message.type === "error") handlers.error?.(message.message);
  };
  window.addEventListener("paseo:world", receive);
  const repost = (why: string) => {
    if (destroyed || !ready || !data || !frames) return;
    reposts++;
    post({ type: "log", text: `map: ${why}; posting the world again` });
    watch.waitingSince = null;
    layout = null;
    sent.clear();
    relayout();
  };
  const watchdog = setInterval(() => {
    if (destroyed || !ready) return;
    const now = Date.now();
    if (behind(watch, now))
      repost(`Swift is behind the page (posted ${watch.scene}/${watch.agents}, applied ${String(nativeState.sceneRevision)}/${String(nativeState.agentsRevision)})`);
    post({
      type: "pageStatus",
      sinceUpdate: updatedAt ? now - updatedAt : -1,
      sincePost: postedAt ? now - postedAt : -1,
      posted: { scene: watch.scene, agents: watch.agents },
      waiting: watch.waitingSince === null ? 0 : now - watch.waitingSince,
      reposts,
      hidden: document.hidden,
      ...handlers.status?.(),
    });
  }, WORLD_WATCH.everyMs);

  const surface = nativeSurface(parent, post, {
    enabled: () => enabled,
    reshaped: () => relayout(),
    escape: () => handlers.pick?.(null),
  });

  // The art is prepared once per page; Swift keeps it as textures.
  void (async () => {
    try {
      await Promise.all([document.fonts?.load(`${HEAVY} 20px ${FONT}`), document.fonts?.load(`${BOLD} 20px ${FONT}`)].filter(Boolean)).catch(() => undefined);
      const built = await buildFrames();
      if (destroyed) return;
      frames = built.canvases;
      realFrames = built.real;
      post({
        type: "art",
        scene: "dungeon",
        frames: [...frames].map(([name, canvas]) => ({ name, png: png(canvas), w: FRAMES[name]!.w, h: FRAMES[name]!.h })),
        tiles: {},
        constants: {
          maxZoom: MAX_ZOOM * 1.4,
          hover: HOVER_COLOR,
          robotSize: D.robot,
          droneOrbit: 6000,
          // Each frame's size in board units (tiles repeat at it).
          sizes: Object.fromEntries(Object.entries(FRAMES).map(([n, f]) => [n, [f.w, f.h]])),
        },
        reduced,
      });
      surface.viewport();
      relayout();
    } catch (error) {
      handlers.error?.(error instanceof Error ? error.message : "Could not prepare the Dungeon Board.");
    }
  })();

  return {
    kind: "dungeon",
    native: true,
    update: (next) => {
      data = next;
      updatedAt = Date.now();
      relayout();
    },
    select: (id) => {
      selection = id && (!layout || entity(id)) ? id : null;
      if (ready) post({ type: "select", id: selection });
      handlers.selection?.(entity(selection));
    },
    focus: (id, closer) => ready && post({ type: "focus", id, zoom: !!closer }),
    // The board has one style; the Islands and Overworld are the Atlas's.
    style: () => {},
    command: (name) => ready && post({ type: "command", name }),
    workspace: (info) => post({ type: "workspace", workspace: info }),
    input: (on) => {
      enabled = on;
      post({ type: "input", enabled: on });
      if (!on && hovered) setHover(null);
    },
    motion: (next = !reduced) => {
      reduced = next;
      post({ type: "motion", reduced });
      return reduced;
    },
    inspect: () =>
      ready && layout
        ? {
            scene: "dungeon",
            renderer: "SpriteKit",
            selected: selection,
            hovered,
            motion: !reduced,
            zoom,
            builds,
            native: nativeState,
            watch: { ...watch, reposts },
            bounds: layout.bounds,
            counts: layout.counts,
            subtitle: hudSubtitle(layout),
            realFrames: realFrames.size,
            floors: layout.floors.map((f) => ({ host: f.host.id, title: f.title, online: f.online, tiers: f.tiers, stats: f.stats.map((s) => s.text), portcullis: f.portcullis, stairs: f.stairs })),
            rooms: layout.decor.filter((d) => d.recess).map((d) => d.rect),
            projects: layout.projects.map((p) => ({ id: p.entity?.id ?? p.key, name: p.name, icon: p.icon, side: p.side, tier: p.tier, rect: p.rect })),
            workspaces: layout.workspaces.map((w) => ({
              id: w.entity.id, name: w.entity.name, camp: !!w.entity.camp, rect: w.rect,
              flags: w.flags.map((f) => f.flag), medallions: w.flags.map((f) => ({ flag: f.flag, x: f.x, y: f.y })), seal: !!w.seal,
            })),
            agents: layout.agents.map((a) => ({ id: a.entity.id, name: a.entity.name, state: a.entity.state, model: a.entity.model, robot: a.robot, workspace: a.entity.workspace, at: a.feet, rect: a.rect })),
          }
        : undefined,
    destroy: () => {
      destroyed = true;
      ready = false;
      clearInterval(watchdog);
      surface.destroy();
      window.removeEventListener("paseo:world", receive);
      post({ type: "detach" });
    },
  };
}

export type { Entity };
