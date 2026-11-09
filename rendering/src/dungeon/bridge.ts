/**
 * The Dungeon Board drawn by the native macOS app (SpriteKit), as the Atlas
 * is: the page lays the board out (`layout.ts`), paints its text (labels, the
 * hosts' plaques, the HUD) and posts the result to Swift (`DungeonScene.swift`),
 * which draws, animates, owns the camera, hover and picking, and answers
 * through `paseo:world` events. Nothing here sends daemon actions.
 */
import { STATE_TILE, seedOf, random, type AtlasData, type Entity } from "../world";
import { HOVER_COLOR, PULSE_MS } from "../placement";
import type { MapFlag } from "../prStatus";
import { MAX_ZOOM } from "../camera";
import type { AtlasHandlers, AtlasWorld } from "../atlas";
import { WORLD_WATCH, applied, behind, newWatch, post as postRevision } from "../native/watch";
import { nativeSurface } from "../native/surface";
import { FRAMES, ANIMATIONS, anchorShare, applySheet, framesOf, sliceOf, type SheetJson } from "./frames";
import { paintPlaceholder } from "./placeholder";
import { DASH_TILES, dashCard, dashText, type DashCount } from "../dashboard";
import {
  D,
  cutawaySpans,
  ROBOT_OF,
  STATE_GLOW,
  STATE_MARK,
  hudSubtitle,
  layoutDungeon,
  projectAlarm,
  projectWorking,
  type DTile,
  type DungeonLayout,
  type Measure,
  type Rect,
} from "./layout";

type Channel = { postMessage(message: unknown): void };
const channel = (): Channel | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: Channel } } }).webkit?.messageHandlers?.paseoWorld;

/** The art agent's sheets, when they are in: `<sheet>.json` beside `<sheet>.png`; and the Village's stained glass and HUD
 * icons, for the vault and the At a Glance panel. */
const SHEET_JSON = import.meta.glob(["../assets/dungeon/*.json", "../assets/village/tiles.json", "../assets/village/hud.json"], { eager: true, import: "default" }) as Record<string, unknown>;
const SHEET_PNG = import.meta.glob(["../assets/dungeon/*.png", "../assets/village/tiles.png", "../assets/village/hud.png"], { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** Labels and the HUD are painted at this many pixels per board unit (crisp when zoomed in). */
const TEXT_SCALE = 4;
/** How dark the far wall is drawn (a share of black over its tile), for the light pools to warm. */
const WALL_SHADE = 0;
/** The state glows' rims: a lighter tone of each state's colour. */
const RIM: Partial<Record<string, number>> = {
  running: 0x8affc4, failed: 0xff8a70, approval: 0xffd060, question: 0x8cc4ff, asking: 0xd4b0ff, done: 0xfff0a0, offline: 0xb0aca0,
};
/** The alcoves' interiors, a little darker than their sheet, so the robots read against them. */
const INTERIOR_SHADE = 0.2;
/** How strongly the warm torchlight wash lights the stone. */
/** Gold light: its colour (multiplied, doubled, over the stone) and each kind of pool's strength. */
const GOLD = 0xc87c00;
const GOLD_DEEP = 0x7a4c00;
/** Gold that darkens as it warms: for surfaces already lit (the stairs' treads), gold without brightening. */
const GOLD_DIM = 0x5e3a00;
/** The stairs' tread pitch (board units), for their lit noses. */
const TREAD = 12;
/** Warm bounce on the alcoves' inner jambs (off: next to the robots it competed with them). */
const JAMBS = false;
const GOLD_K = { alcove: 0.35, stairs: 0.9, walk: 0.9, rim: 0.9, front: 0.35, torch: 0.7, candle: 0.85 };
/** The concept's chunky, wide, rounded heavy type: SF Pro Rounded where WebKit has it. */
const FONT = 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Paseo Barlow", sans-serif';
/** Its weights: labels and plaques heavy, the HUD's lighter lines bold. */
const HEAVY = 800;
const BOLD = 700;
const INK = "#2a1a0e";
/** How much the flames move, as a share of their old speed (0: still). Their light pools never flicker. */
export const FLAME_FLICKER = 1 / 3;
const FLAMES = new Set(["torch", "candle", "brazier", "forge", "candelabra", "wall-candles"]);
/** Props that stand on a floor (contact shadows at their feet). */
const STANDING = new Set(["barrel", "barrels", "crate", "crates", "armor", "bookcase-ladder", "alchemy-tank", "crystal", "forge", "anvil", "table", "scroll-desk", "brazier", "candelabra"]);
/** The host sign's lettering: an old-style serif painted on wood (the HUD keeps its own face). */
const SIGN_FONT = '"Iowan Old Style", Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif';
const SIGN_PAINT = "#f1dfb2";
const SIGN_PAINT_DULL = "#9c9184";
const SIGN_ALERT = "#ff7a5c";
/** The sign's caps and rails, at this share of their sheet size. */
const SIGN_K = 0.64;
/** A project's name board's corners and chains, as a share of the sheet's (the host's sign's are `SIGN_K`). */
const PROJECT_SIGN_K = 0.36;
const ALERT = "#b0301c";
/** The vault's stained glass: its saturation (the Village's is 1), and how much light it gives the stone round it. */
const VAULT_GLASS_SATURATION = 0.82;
const VAULT_GLOW = 0.22;
/** The At a Glance panel's dots: each group's pane colour, then the agents' states'. */
const PANE_DOT: Record<string, string> = { merged: "#4cc35a", review: "#3d8fe8", draft: "#f0b42a", failing: "#e2493a" };
const PANE_LIGHT: Record<string, number> = { merged: 0x5fd06a, review: 0x4f9cf0, draft: 0xf0b42a, failing: 0xe2493a };

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
/** `shadow`/`mid`: red-violet tints (the concept's stone, not a blue violet). `stoneStrength`: the stone's tint, stronger; `stoneWarmth`: its colour balance, a little warmer; `stoneSaturation`: its colour held against the neutral lift.
 * `stoneLift`: the walls' and floors' ambient, a notch above the props' and alcoves' so the lavender stone reads as bright as the concept's. */
export const GRADE = { lift: 1.19, stoneLift: 1.38, stoneSaturation: 1.3, warmth: [1, 1, 1], saturation: 1.05, shadow: [0x34, 0x1f, 0x42], mid: [0x5a, 0x3c, 0x6c], strength: 0.1, stoneStrength: 0.2, stoneWarmth: [1.055, 1, 0.915] };
function grade(image: HTMLImageElement, opts: { saturation?: number; strength?: number; lift?: number; warmth?: number[] } = {}): HTMLCanvasElement {
  const saturation = opts.saturation ?? GRADE.saturation, strength = opts.strength ?? GRADE.strength, lift = opts.lift ?? GRADE.lift, warmth = opts.warmth ?? GRADE.warmth;
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
    // Coloured occlusion only: the purple tint, by how dark a pixel is, never on warm highlights (flames, gold, lamp
    // light), so deep purple stays in real recesses and undersides.
    const warm = r > b + 25 && r > 120;
    if (!warm && strength > 0) {
      const t = strength * Math.pow(1 - l, 1.3);
      const tint = l < 0.35 ? shadow : mid;
      r *= 1 - t + t * tint[0]!;
      g *= 1 - t + t * tint[1]!;
      b *= 1 - t + t * tint[2]!;
    }
    // Exposure, separately and for every pixel: the same amount added to each channel, so the art's a*/b* (its warm
    // fronts, its lavender floors) survive the lift, rather than RGB scaling that pushes chroma and cools the stone.
    const add = (lift - 1) * l * 255;
    r = (r + add) * warmth[0]!;
    g = (g + add) * warmth[1]!;
    b = (b + add) * warmth[2]!;
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
    // The vault's glass a notch quieter than the Village's (less saturated, its darks toward the stone's purple), so
    // the robots stay the brightest colour on the board.
    const source = stem === "tiles" || stem === "vault" ? grade(image, { saturation: VAULT_GLASS_SATURATION, strength: 0.25, lift: 1 }) : GRADED.has(stem) ? grade(image, stem === "stone" ? { lift: GRADE.stoneLift, strength: GRADE.stoneStrength, warmth: GRADE.stoneWarmth, saturation: GRADE.stoneSaturation } : {}) : stem === "robots" ? grade(image, { saturation: 1.15, strength: 0, lift: 1 }) : image;
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
  /** The robot the page's dialogue box is talking to, and how much of the map's bottom the box covers (CSS px). */
  let talking: { id: string | null; inset: number } = { id: null, inset: 0 };
  let hovered: string | null = null;
  let hoverAt: { x: number; y: number; bottom?: number } | undefined;
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
  const fontOf = (kind: keyof typeof D.font) => `${BOLD} ${D.font[kind]}px ${SIGN_FONT}`;
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
  /** The host's sign: the wooden board on its chains, the name painted on it in cream with a status gem on its left, its
   * load in a smaller line beneath (≥ 90% painted red), or "OFFLINE" on a dull, unlit board with a dark gem. */
  const paintSign = (r: Rect, name: string, stats: { text: string; alert: boolean }[], online: boolean) => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    const board = FRAMES["sign-board"]?.real ? "sign-board" : "plaque";
    if (!online) ctx.filter = "brightness(0.55) saturate(0.55)";
    nineSlice(ctx, frame(board), board, 0, 0, r.w, r.h, SIGN_K);
    ctx.filter = "none";
    // The board's face, below the chains and its top rail, above its bottom rail.
    const ins = sliceOf(FRAMES[board]!);
    const faceTop = ins.top * SIGN_K, faceBottom = r.h - ins.bottom * SIGN_K;
    const nameY = faceTop + (faceBottom - faceTop) * 0.36, statsY = faceTop + (faceBottom - faceTop) * 0.8;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    // Paint on wood: a dark inset below and right, the colour, a faint highlight above and left, then worn speckles.
    const paint = (text: string, x: number, y: number, colour: string) => {
      ctx.fillStyle = "rgba(20, 8, 2, 0.75)";
      ctx.fillText(text, x + 0.9, y + 1.2);
      ctx.fillStyle = "rgba(255, 244, 214, 0.28)";
      ctx.fillText(text, x - 0.5, y - 0.6);
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
    };
    const cream = online ? SIGN_PAINT : SIGN_PAINT_DULL;
    // The name, with the gem beside it.
    ctx.font = fontOf("host");
    const shown = fitText(name, "host", r.w - 93);
    const nameW = ctx.measureText(shown).width, gem = 15, gap = 7;
    let x = r.w / 2 - (nameW + gem + gap) / 2;
    const anyAlert = stats.some((st) => st.alert);
    const gemFrame = !online ? "gem-offline" : anyAlert ? "gem-warning" : "gem-online";
    if (FRAMES[gemFrame]?.real) ctx.drawImage(frame(gemFrame), x, nameY - gem / 2, gem, gem);
    else ctx.drawImage(frame(online ? "dot-online" : "dot-offline"), x + 2, nameY - 5.5, 11, 11);
    paint(shown, x + gem + gap, nameY + 1, cream);
    // The load: CPU · MEM · DISK, or that it's offline.
    const parts = online
      ? stats.length ? stats.flatMap((st, i) => (i ? [{ text: " · ", alert: false }, st] : [st])) : [{ text: "No load reading", alert: false }]
      : [{ text: "OFFLINE", alert: false }];
    ctx.font = fontOf("stats");
    const widths = parts.map((pt) => ctx.measureText(pt.text).width);
    x = r.w / 2 - widths.reduce((sum, w) => sum + w, 0) / 2;
    parts.forEach((pt, i) => {
      paint(pt.text, x, statsY, pt.alert ? SIGN_ALERT : cream);
      x += widths[i]!;
    });
    // Worn: fine speckles taken out of the paint (seeded by the name, so the image stays the same).
    const rng = random(seedOf(name + "wear"));
    ctx.globalCompositeOperation = "destination-out";
    for (let i = 0; i < r.w * 0.5; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.12 + rng() * 0.2})`;
      ctx.fillRect(28 + rng() * (r.w - 56), faceTop + rng() * (faceBottom - faceTop), 0.6 + rng() * 0.9, 0.6 + rng() * 0.7);
    }
    ctx.globalCompositeOperation = "source-over";
    return canvas;
  };
  /** A project's name board: the host sign's board, smaller (its chains, rails and iron corners scaled with it), on
   * short chains from its hall's lintel, the name painted in cream as the host's is; dull and unlit on an offline floor. */
  const paintProjectSign = (r: Rect, label: string, online: boolean) => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    const board = FRAMES["sign-board"]?.real ? "sign-board" : "plaque";
    if (!online) ctx.filter = "brightness(0.55) saturate(0.55)";
    nineSlice(ctx, frame(board), board, 0, 0, r.w, r.h, PROJECT_SIGN_K);
    ctx.filter = "none";
    const ins = sliceOf(FRAMES[board]!);
    const faceTop = ins.top * PROJECT_SIGN_K, faceBottom = r.h - ins.bottom * PROJECT_SIGN_K;
    const y = (faceTop + faceBottom) / 2 + 0.6;
    ctx.font = fontOf("project");
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    // Paint on wood, as the host's sign: a dark inset, a faint highlight, the colour.
    ctx.fillStyle = "rgba(20, 8, 2, 0.75)";
    ctx.fillText(label, r.w / 2 + 0.6, y + 0.8);
    ctx.fillStyle = "rgba(255, 244, 214, 0.22)";
    ctx.fillText(label, r.w / 2 - 0.4, y - 0.4);
    ctx.fillStyle = online ? SIGN_PAINT : SIGN_PAINT_DULL;
    ctx.fillText(label, r.w / 2, y);
    return canvas;
  };
  /** The HUD's count bar: navy panels with gold borders, in screen points. */
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

  /** The HUD's "At a Glance" panel (the Village's, in the board's HUD look: the title's navy panel and gold rules, its
   * rounded type): your PRs and issues by group, as the vault's panes colour them, then workspaces and agents. */
  const paintGlance = (c: DungeonLayout["counts"]) => {
    type Row = { dot: string; name: string; n: number | string };
    const dashRows = (d: DashCount, hall: "prs" | "issues"): Row[] =>
      DASH_TILES[hall].map((t) => ({ dot: PANE_DOT[t.tile]!, name: t.name, n: dashText(d, t.key) }));
    const sections: { icon: string; title: string; n: number | string; rows: Row[]; why?: string }[] = [
      { icon: "icon-pr", title: "PRs", n: dashText(c.prs), rows: dashRows(c.prs, "prs"), why: c.prs.known ? undefined : c.prs.why },
      { icon: "icon-issue", title: "Issues", n: dashText(c.issues), rows: dashRows(c.issues, "issues"), why: c.issues.known ? undefined : c.issues.why },
      { icon: "icon-workspaces", title: "Workspaces", n: c.workspaces, rows: [{ dot: "#4cc35a", name: "Active", n: c.active }] },
      {
        icon: "icon-agents", title: "Agents", n: c.agents,
        rows: [
          { dot: "#4cc35a", name: "Running", n: c.running },
          // Finished agents whose reply you haven't read are idle too.
          { dot: "#9a96b4", name: "Idle", n: c.idle + c.unread },
          ...(c.needYou ? [{ dot: "#ef9b1b", name: "Need you", n: c.needYou }] : []),
          ...(c.failed ? [{ dot: "#e2493a", name: "Failed", n: c.failed }] : []),
          ...(c.offline ? [{ dot: "#6a6670", name: "Offline", n: c.offline }] : []),
        ],
      },
    ];
    const w = 220, pad = 22, head = 40, secHead = 30, rowH = 20, gap = 12;
    const h = Math.ceil(pad + head + sections.reduce((sum, x) => sum + secHead + x.rows.length * rowH + gap, 0) - gap + pad - 4);
    const { canvas, ctx } = canvasFor(w, h);
    nineSlice(ctx, frame("panel"), "panel", 0, 0, w, h);
    ctx.textBaseline = "middle";
    let y = pad + 12;
    ctx.drawImage(frame("icon-chart"), pad - 2, y - 12, 26, 22);
    ctx.fillStyle = "#f4ead2";
    ctx.font = `${HEAVY} 19px ${FONT}`;
    ctx.fillText("At a Glance", pad + 32, y + 1);
    y += 22;
    const rule = (at: number) => {
      const g = ctx.createLinearGradient(pad, 0, w - pad, 0);
      g.addColorStop(0, "rgba(216,168,64,0)");
      g.addColorStop(0.5, "rgba(216,168,64,0.85)");
      g.addColorStop(1, "rgba(216,168,64,0)");
      ctx.fillStyle = g;
      ctx.fillRect(pad - 4, at, w - 2 * pad + 8, 1.5);
    };
    rule(y);
    y += gap - 2;
    sections.forEach((sec, i) => {
      if (i) rule(y - gap / 2 - 1);
      y += secHead / 2;
      ctx.drawImage(frame(sec.icon), pad - 1, y - 10, 20, 20);
      ctx.font = `${HEAVY} 17px ${FONT}`;
      ctx.fillStyle = "#f4ead2";
      ctx.textAlign = "left";
      ctx.fillText(sec.title, pad + 26, y + 1);
      ctx.textAlign = "right";
      ctx.fillStyle = "#b9e34a";
      ctx.fillText(String(sec.n), w - pad, y + 1);
      y += secHead / 2;
      ctx.font = `${BOLD} 14px ${FONT}`;
      for (const r of sec.rows) {
        y += rowH / 2;
        ctx.globalAlpha = sec.why === undefined ? 1 : 0.45;
        ctx.fillStyle = r.dot;
        ctx.beginPath();
        ctx.arc(pad + 9, y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#cfc6e6";
        ctx.textAlign = "left";
        ctx.fillText(r.name, pad + 22, y + 0.5);
        ctx.textAlign = "right";
        ctx.fillStyle = "#f2ead6";
        ctx.fillText(String(r.n), w - pad, y + 0.5);
        ctx.globalAlpha = 1;
        y += rowH / 2;
      }
      y += gap;
    });
    ctx.textAlign = "left";
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
    // The background holds still so the agents draw the eye (the user's call): props show one frame; flames alone flicker,
    // slowly and faintly (`FLAME_FLICKER`), between their two nearest frames.
    const animated = ANIMATIONS[name] !== undefined;
    const flame = animated && FLAMES.has(name) && FLAME_FLICKER > 0;
    return {
      f: animated ? `${name}-0` : name,
      ...(flame ? { anim: framesOf(name).slice(0, 2), fps: (name.startsWith("torch") || name.startsWith("candle") || name.startsWith("brazier") ? 8 : 6) * FLAME_FLICKER } : {}),
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
  const paintShade = (kind: "upper" | "edges" | "warm" | "under" | "patch" | "contact" | "pocket") => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    // A muted deep purple: it darkens without over-saturating (the grade already deepens the hue).
    const shadow = (a: number) => `rgba(36, 20, 38, ${a})`;
    if (kind === "under") {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, "rgba(14, 10, 34, 0.7)");
      g.addColorStop(1, "rgba(14, 10, 34, 0)");
      ctx.fillStyle = g;
    } else if (kind === "contact") {
      const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      g.addColorStop(0, "rgba(10, 6, 20, 0.62)");
      g.addColorStop(0.55, "rgba(10, 6, 20, 0.34)");
      g.addColorStop(1, "rgba(10, 6, 20, 0)");
      ctx.fillStyle = g;
    } else if (kind === "pocket") {
      // A deep pocket where masses meet: darkest at its middle, fading either side.
      const g = ctx.createLinearGradient(0, 0, 256, 0);
      g.addColorStop(0, "rgba(12, 8, 26, 0)");
      g.addColorStop(0.5, "rgba(12, 8, 26, 0.6)");
      g.addColorStop(1, "rgba(12, 8, 26, 0)");
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

  /** The board's stone, gates, alcoves, signs and decorations: what changes only when places do. */
  const sceneOf = (l: DungeonLayout) => {
    const sprites: Sprite[] = [];
    const images: Sprite[] = [];
    const lights: Sprite[] = [];
    const dimOf = (floor: number) => (l.floors[floor]?.online ? {} : { dim: 1 });
    const fill = (name: string, r: Rect, z: number, extra: Sprite = {}) => sprites.push(tile(name, r, z, extra));
    const put = (name: string, x: number, y: number, w: number, h: number, z: number, extra: Sprite = {}) => sprites.push(sprite(name, { x, y, w, h }, z, extra));
    // The wall above the first floor, with its pillars; the HUD's title lies over it.
    {
      const r = l.topBand.rect, L = r.x, R = r.x + r.w;
      fill("wall-brick-dark", r, -60, { shade: WALL_SHADE });
      fill("wall-brick", { x: L + 22, y: r.y + 4, w: R - L - 49, h: r.h - 4 }, -55, { shade: WALL_SHADE, ox: 37, oy: 11 });
      for (const p of l.topBand.piers) {
        fill("pillar", p, -45);
        if (FRAMES["pillar-capital"]?.real) put("pillar-capital", p.x - 8, p.y - 4, p.w + 16, 24, -44.8);
      }
      // The vault: a stone niche per group of your PRs and issues, its stained glass inside, dim while its hall can't
      // count; each glows with its tile (`e`) for its hover card. Under the upper wall's shading, as the wall's windows are.
      for (const t of l.vault) {
        const known = (t.hall === "prs" ? l.counts.prs : l.counts.issues).known;
        const dim = known && l.floors[0]!.online ? {} : { dim: 1 };
        put("niche-arch", t.rect.x, t.rect.y, t.rect.w, t.rect.h, -44.6, { ...dim, e: t.id });
        put(t.frame, t.glass.x, t.glass.y, t.glass.w, t.glass.h, -44.55, { ...dim, e: t.id });
        // A little of the glass's colour on the stone round it (steady, as the building's light is).
        if (!("dim" in dim)) lights.push({ x: t.glass.x + t.glass.w / 2, y: t.glass.y + t.glass.h / 2, c: PANE_LIGHT[t.pane], r: t.rect.w * 0.8, k: VAULT_GLOW, flicker: false, period: 4000, z: -44.5 });
      }
      images.push({ ...image("shade:upper", () => paintShade("upper")), x: r.x, y: r.y, w: r.w, h: r.h, z: -43.5 });
      // Each row's name board, hanging from the wall's top over its niches (the projects' board, dull while its hall
      // can't count), over the wall's shading so it reads as theirs do.
      for (const v of l.vaultSigns) {
        const lit = (v.hall === "prs" ? l.counts.prs : l.counts.issues).known && l.floors[0]!.online;
        images.push({ ...image(`vault-sign:${v.label}:${v.rect.w}:${lit}`, () => paintProjectSign(v.rect, v.label, lit)), x: v.rect.x, y: v.rect.y, w: v.rect.w, h: v.rect.h, z: -43.4 });
      }
    }
    l.floors.forEach((fl, f) => {
      const dim = dimOf(f);
      // The floor's two ends: its sides may reach differently from the gate's line.
      const T = fl.top, L = fl.rect.x, R = fl.rect.x + fl.rect.w;
      const rng = random(seedOf(fl.host.id + "wall"));
      // The far wall: the darker stone round the edge, the hall's brick inset, its tiling offset per floor.
      fill("wall-brick-dark", fl.rect, -60, { ...dim, shade: WALL_SHADE });
      const brick = FRAMES["wall-brick"]!;
      const floorEnd = fl.tierTops[fl.tiers - 1]! + D.frontY;
      fill("wall-brick", { x: L + 22, y: T + 5, w: R - L - 49, h: floorEnd + 2 - (T + 5) }, -55, { ...dim, shade: WALL_SHADE, ox: Math.floor(rng() * brick.w), oy: Math.floor(rng() * brick.h) });
      // The upper back wall: a thick rampart either side of the gate's surround, returning at the floor's ends.
      // (Below the first floor, the floor above's front wall closes the top instead.)
      if (f === 0) {
        for (const sd of [-1, 1]) {
          const x0 = sd === -1 ? L + 55 : D.surroundW / 2 - 2, x1 = sd === -1 ? -D.surroundW / 2 + 2 : R - 52;
          fill("rampart-x", { x: x0, y: T + 25, w: x1 - x0, h: 24 }, -44, dim);
        }
        put("rampart-return-left", L, T + 25, 72, 70, -43.9, dim);
        put("rampart-return-right", R - 69, T + 25, 69, 70, -43.9, dim);
      }
      // The stepped mass: its wall face down to the tier, the lower run's lit cap and face, a return at its open end,
      // a shadow beneath and a dark pocket where it meets the wall behind.
      if (fl.step) {
        // A projecting wall section standing on the terrace below: its lit face from the cap down to the terrace cap,
        // a block pillar at its open end, its lit top, a shadow cast on the wall beside its open end and a contact
        // shadow at its foot.
        const st = fl.step, end = st.side === -1 ? st.x + st.w : st.x, foot = fl.tierTops[0]! + 33;
        fill("wall-brick", { x: st.x, y: st.y + st.h - 4, w: st.w, h: foot - (st.y + st.h - 4) }, -44.25, { ...dim, shade: 0, ox: 19, oy: 7 });
        fill("rampart-x", { x: st.x, y: st.y, w: st.w, h: st.h }, -44.2, dim);
        images.push({ ...image("shade:under", () => paintShade("under")), x: st.x, y: st.y + st.h - 4, w: st.w, h: 14, z: -44.22, ...dim });
        fill("pillar", { x: st.side === -1 ? end - 20 : end - 4, y: st.y + 6, w: 24, h: foot - st.y - 6 }, -44.15, dim);
        images.push({ ...image("shade:pocket", () => paintShade("pocket")), x: st.side === -1 ? end + 2 : end - 34, y: st.y + 4, w: 32, h: foot - st.y - 4, z: -44.3, ...dim });
        images.push({ ...image("shade:contact", () => paintShade("contact")), x: st.x - 6, y: foot - 7, w: st.w + 12, h: 14, z: -44.1, ...dim });
      }
      // Deep pockets where the masses meet: either side of each pier, down the wall.
      for (const r of fl.piers)
        for (const side of [-1, 1])
          images.push({ ...image("shade:pocket", () => paintShade("pocket")), x: side === -1 ? r.x - 26 : r.x + r.w - 6, y: T + 46, w: 32, h: floorEnd - T - 60, z: -46, ...dim });
      // Block pillars with caps and bases.
      for (const r of fl.piers) {
        fill("pillar", r, -45, dim);
        if (FRAMES["pillar-capital"]?.real) put("pillar-capital", r.x - 8, T + 21, r.w + 16, 26, -43.8, dim);
        else put("pillar-cap", r.x - 4, T + 23, r.w + 8, 27, -43.8, dim);
        put("pillar-base", r.x - 4, r.y + r.h - 15, r.w + 8, 29, -44.8, dim);
      }
      // Each tier: the terrace floor under its walkway, and the thick front wall that closes it (lit top, returns, ends).
      for (const y0 of fl.tierTops) {
        fill("terrace-floor", { x: L + 20, y: y0 + D.floorY - 48, w: R - L - 40, h: 74 }, -40, { ...dim, shade: 0.22 });
        // The last tier's front wall opens round the next floor's gate; any other's round the stairs.
        const open = !fl.last && y0 === fl.tierTops[fl.tiers - 1] ? D.surroundW / 2 - 4 : D.stairsW / 2 + 2;
        for (const sd of [-1, 1]) {
          const x0 = sd === -1 ? L + 113 : open, x1 = sd === -1 ? -open : R - 111;
          // A light purple shade, so v5's warmed blocks read as stone with warm highlights.
          fill("rampart-x", { x: x0, y: y0 + D.frontY, w: x1 - x0, h: 28 }, -9, { ...dim, shade: 0 });
        }
        put("rampart-return-right", L + 30, y0 + D.frontY - 16, 92, 43, -8.9, dim);
        put("rampart-return-left", R - 118, y0 + D.frontY - 16, 88, 43, -8.9, dim);
        put("rampart-end-left", L + 12, y0 + D.frontY - 24, 31, 30, -8.8, dim);
        put("rampart-end-right", R - 38, y0 + D.frontY - 24, 31, 30, -8.8, dim);
        // Returns where the wall opens for the stairs: its ends capped, so the stairs come down through a built opening.
        if (open === D.stairsW / 2 + 2) {
          put("rampart-end-right", -open - 27, y0 + D.frontY - 24, 31, 30, -8.8, dim);
          put("rampart-end-left", open - 4, y0 + D.frontY - 24, 31, 30, -8.8, dim);
        }
        // The cutaway's thickness under the rampart's lip: the ledge's face, a few substantial corbels and a cool
        // shadow beneath. All of it opens round the next floor's gate, as the rampart does, so the arch reads whole.
        for (const [x0, x1] of cutawaySpans(fl, y0)) {
          fill("ledge-face", { x: x0, y: y0 + D.frontY + 26, w: x1 - x0, h: 14 }, -9.2, { ...dim, shade: 0.28 });
          images.push({ ...image("shade:under", () => paintShade("under")), x: x0, y: y0 + D.frontY + 38, w: x1 - x0, h: 22, z: -9.3 });
        }
        // Corbels in irregular pairs at the bays' boundaries, in the underside's shade.
        const crng = random(seedOf(`${fl.host.id}${y0}corbels`));
        const bounds = l.workspaces.filter((w) => w.floor === l.floors.indexOf(fl) && w.rect.y < y0 + D.tierH && w.rect.y >= y0)
          .flatMap((w) => [w.rect.x - D.alcoveGap / 2, w.rect.x + w.rect.w + D.alcoveGap / 2]);
        // (The last floor's front wall steps down onto the foot's landing: a riser and its shadow, no corbels.)
        const ontoFoot = fl.last && y0 === fl.tierTops[fl.tiers - 1];
        for (const bx of ontoFoot ? [] : [...new Set(bounds.map((x) => Math.round(x)))]) {
          if (crng() < 0.35 || !cutawaySpans(fl, y0).some(([a, b]) => bx - 20 > a && bx + 20 < b)) continue;
          const pair = crng() < 0.5;
          for (const [dx, frame] of (pair ? [[-15, "corbel-left"], [15, "corbel-right"]] : [[0, crng() < 0.5 ? "corbel-left" : "corbel-right"]]) as [number, string][])
            put(frame, bx + dx - 14.5, y0 + D.frontY + 38, 29, 31, -9.25, { ...dim, shade: 0.35 });
        }
      }
      // The enclosure's edges, excavated: irregular masses of dark stone biting in at the floor's ends.
      for (const sd of [-1, 1])
        for (let y = T + 10; y < T + fl.height - 30; y += 40 + rng() * 50) {
          const bite = 10 + rng() * 22, h = 30 + rng() * 60;
          fill("wall-brick-dark", { x: sd === -1 ? L : R - bite, y, w: bite, h }, -54, { ...dim, shade: 0.35 });
        }
      // Dark breaks on the upper wall: soft shadow patches, so it never reads as wallpaper.
      for (let i = 0; i < 4; i++) {
        const w = 70 + rng() * 80, x = L + D.sideRoom + rng() * (R - L - 2 * D.sideRoom - w);
        if (Math.abs(x + w / 2) < D.surroundW / 2 + w / 2) continue;
        images.push({ ...image("shade:patch", () => paintShade("patch")), x, y: T + 18 + rng() * 50, w, h: 50 + rng() * 40, z: -50 });
      }
      if (fl.last) fill("terrace-floor", { x: L + 20, y: floorEnd + 28, w: R - L - 40, h: fl.top + fl.height - floorEnd - 34 }, -40, { ...dim, shade: 0.26 });
      if (fl.last) {
        // The foot's front enclosure, as the concept's bottom: a low parapet with lit tops either side of the stair
        // opening, capped at the opening and the ends, its face and a shadow beneath; the stairs run on down through it.
        // (The count bar lies over its lower edge; its top and the opening read above it.)
        const py = fl.top + fl.height - D.footPad + 2, open = D.stairsW / 2 + 2;
        fill("stairs-mid", { x: fl.stairs.x, y: fl.stairs.y + fl.stairs.h - 30, w: fl.stairs.w, h: py + 40 - (fl.stairs.y + fl.stairs.h - 30) }, -26, { ...dim, shade: dim.dim ? 0.55 : 0.22 });
        for (const [x0, x1] of [[L + 26, -open], [open, R - 26]] as const) {
          fill("rampart-x", { x: x0, y: py, w: x1 - x0, h: 30 }, -3.5, { ...dim, shade: 0 });
          fill("ledge-face", { x: x0 + 2, y: py + 28, w: x1 - x0 - 4, h: 12 }, -3.55, { ...dim, shade: 0.28 });
        }
        put("rampart-end-right", -open - 27, py - 6, 31, 30, -3.4, dim);
        put("rampart-end-left", open - 4, py - 6, 31, 30, -3.4, dim);
        put("rampart-end-left", L + 14, py - 6, 31, 30, -3.4, dim);
        put("rampart-end-right", R - 45, py - 6, 31, 30, -3.4, dim);
      }
      // The gate column: the big round surround (its top a plain dark keystone opening: no icon), the plaque, the
      // portcullis behind its arch, and the stairs down between block side walls.
      put("gate-surround", fl.surround.x, fl.surround.y, fl.surround.w, fl.surround.h, -36, dim);
      // The stairs, a shade down from the sheet's, so their lit steps don't outshine the robots.
      // The treads at their own warm exposure (the sheet already lights them); the side walls stay shaded below.
      const steps = { ...dim, shade: dim.dim ? 0.55 : 0.22 };
      fill("stairs-mid", { x: fl.stairs.x, y: fl.stairs.y + 36, w: fl.stairs.w, h: Math.max(0, fl.stairs.h - 36) }, -26, steps);
      // Bright gold where the gate's light catches the treads' noses: thin lines, not a fill.
      if (fl.online)
        for (let ty = fl.stairs.y + 14; ty < fl.stairs.y + fl.stairs.h - 6; ty += TREAD)
          lights.push({ x: 0, y: ty, rx: fl.stairs.w * 0.42, ry: 3.4, c: 0xffc24a, r: 1, k: 1, z: -25.4, period: 4000, flicker: false });
      put("stairs-top", fl.stairs.x, fl.stairs.y, fl.stairs.w, 36, -25.9, steps);
      if (fl.last) put("stairs-bottom", fl.stairs.x, fl.stairs.y + fl.stairs.h - 29, fl.stairs.w, 29, -25.8, steps);
      sprites.push(
        fl.online
          ? sprite("gate-portcullis-lit", fl.portcullis, -25, { a: 0.62, shade: 0.3 })
          : sprite("gate-portcullis-dark", fl.portcullis, -25, dim),
      );
      put("gate-arch", fl.arch.x, fl.arch.y, fl.arch.w, fl.arch.h, -24, dim);
      if (fl.online) {
        // The gate's light, turned down so the robots draw the eye first.
        lights.push({ x: 0, y: fl.portcullis.y + fl.portcullis.h / 2, c: 0xffb640, r: 72, period: 2600, flicker: false, k: 0.28 });
        // The stairs catch the gate's light.
        lights.push({ x: 0, y: fl.stairs.y + 40, c: 0xff9a3a, r: 50, period: 3400, flicker: false, ph: 0.4, k: 0.3 });
      }
      // The host's sign, hung on its chains from a bracket either side (an offline floor's is painted dull itself, so
      // it isn't dimmed again and stays legible).
      images.push({
        ...image(`sign:${fl.name}:${JSON.stringify(fl.stats)}:${fl.online}:${fl.plaque.w}`, () => paintSign(fl.plaque, fl.name, fl.stats, fl.online)),
        x: fl.plaque.x, y: fl.plaque.y, w: fl.plaque.w, h: fl.plaque.h, z: 3,
      });
      if (FRAMES["sign-bracket"]?.real) {
        const board = FRAMES["sign-board"]!, inset = (74 / 829) * board.w * SIGN_K;
        for (const cx of [fl.plaque.x + inset, fl.plaque.x + fl.plaque.w - inset])
          sprites.push(sprite("sign-bracket", at("sign-bracket", cx, fl.plaque.y + 2, 17), 3.1, dim));
      }
      // Lit wood: a soft warm wash on the sign from the gate's torches.
      if (fl.online)
        lights.push({ x: 0, y: fl.plaque.y + fl.plaque.h * 0.62, rx: fl.plaque.w * 0.62, ry: fl.plaque.h * 0.62, c: GOLD, blend: "gold", k: 0.45, z: 3.05, period: 5200, flicker: false });
    });
    for (const p of l.projects) {
      const dim = dimOf(p.floor);
      const y0 = p.span.y;
      // The project's hall (its mark, with its candles and its cloth: no medallion or icon; the user's choice, A and B):
      // a dark back wall behind its alcoves, thick end piers, one lintel across their tops, a floor strip before them;
      // a valance in its colour under the lintel and a runner along the floor. Its stone is tagged with the project,
      // so its glow follows the hall's own silhouette.
      // The hall's stone a notch down, so the robots stay brighter than their surround.
      const lit = l.floors[p.floor]!.online;
      const h = p.hall, stone = { ...dim, ...(dim.dim ? {} : { shade: 0.22 }), ...(p.entity ? { e: p.entity.id } : {}) };
      const lintelY = h.y, lintelB = h.y + D.lintelH, floorY = h.y + h.h - D.hallFloorH;
      /** A strip of `name` tiled across `w` in whole modules (the sheet's swags and stones keep their phase): the strip's
       * height is eased so the module's width divides it, as the art asks. */
      const whole = (name: string, x: number, y: number, w: number, h0: number, z: number, extra: Sprite) => {
        const f = FRAMES[name]!, module = (f.w * h0) / f.h, n = Math.max(1, Math.round(w / module));
        const hh = (f.h * w) / (n * f.w);
        sprites.push(tile(name, { x, y, w, h: hh }, z, extra));
        return hh;
      };
      fill(FRAMES["hall-back"]?.real ? "hall-back" : "wall-brick-dark", { x: h.x + 6, y: lintelB - 2, w: h.w - 12, h: floorY - lintelB + 4 }, -50, { ...dim, shade: 0.3 });
      // Thick end piers, standing on the floor strip, their tops under the lintel's ends.
      put("hall-pillar-left", h.x, lintelB - 4, D.hallPier, floorY - lintelB + 8, -10.6, stone);
      put("hall-pillar-right", h.x + h.w - D.hallPier, lintelB - 4, D.hallPier, floorY - lintelB + 8, -10.6, stone);
      // The lintel: its two fixed ends, whole stones between.
      const endW = 30;
      whole("hall-lintel", h.x + endW - 2, lintelY, h.w - 2 * endW + 4, D.lintelH, -10.5, stone);
      put("hall-lintel-end-left", h.x - 3, lintelY, endW, D.lintelH, -10.45, stone);
      put("hall-lintel-end-right", h.x + h.w - endW + 3, lintelY, endW, D.lintelH, -10.45, stone);
      images.push({ ...image("shade:under", () => paintShade("under")), x: h.x + D.hallPier, y: lintelB, w: h.w - 2 * D.hallPier, h: 12, z: -49, ...dim });
      whole("hall-floor", h.x, floorY - 2, h.w, D.hallFloorH + 4, -9.6, stone);
      // The project's cloth, muted: a valance of whole swags under the lintel between its ties, a runner along the floor.
      const cloth = p.cloth, tie = 14, valX = h.x + D.hallPier + tie / 2, valW = h.w - 2 * D.hallPier - tie;
      whole(`valance-${cloth}`, valX, lintelB - 1, valW, 17, -10.4, dim);
      put(`valance-${cloth}-end-left`, valX - tie / 2, lintelB - 2, tie, 17, -10.38, dim);
      put(`valance-${cloth}-end-right`, valX + valW - tie / 2, lintelB - 2, tie, 17, -10.38, dim);
      // Its name board over the valance's middle (an offline floor's is painted dull itself, as the host's sign is).
      images.push({
        ...image(`project-sign:${p.label}:${p.sign.w}:${lit}`, () => paintProjectSign(p.sign, p.label, lit)),
        x: p.sign.x, y: p.sign.y, w: p.sign.w, h: p.sign.h, z: -10.3,
        ...(p.entity ? { e: p.entity.id } : {}),
      });
      const runX = h.x + D.hallPier + 8, runW = h.w - 2 * D.hallPier - 16;
      whole(`runner-${cloth}`, runX, floorY + 2, runW, 9, -9.55, dim);
      put(`runner-${cloth}-end-left`, runX - 10, floorY + 2, 11, 9, -9.54, dim);
      put(`runner-${cloth}-end-right`, runX + runW - 1, floorY + 2, 11, 9, -9.54, dim);
      // Wall candles flanking its mark, with their warm spill on the wall.
      for (const t of p.torches) {
        // A notch down (shaded), so the pair over the hall never outshines its robots.
        sprites.push(sprite(lit ? "wall-candles" : "wall-candles-out", at("wall-candles", t.x, t.y, 30), 3.2, { ...dim, ...(lit ? { shade: 0.45 } : {}) }));
        if (lit) {
          lights.push({ x: t.x, y: t.y + 10, c: 0xffb840, r: 14, period: 1900, flicker: true, ph: random(seedOf(p.key + t.x))(), k: 0.35 });
          lights.push({ x: t.x, y: t.y + 16, c: 0xffb048, r: 36, period: 5200, flicker: false, k: 0.16, z: -29.1 });
          // Carried onto the hall's lintel top below the candles, flattened to that plane.
          lights.push({ x: t.x, y: p.hall.y + 2, rx: 30, ry: 4, c: 0xffa040, period: 5200, flicker: false, k: 0.22, z: -29.95 });
          lights.push({ x: t.x, y: t.y + 26, rx: 28, ry: 22, c: GOLD_DEEP, blend: "gold", tight: 1, k: 0.55, z: -29, period: 5200, flicker: false });
        }
      }
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
        // Dressing chosen per bay (stable by its key): a full two-ended computer setup, books and a screen,
        // a desk and a crate, or a quiet shelf; always at the ends, plain wall behind the robots.
        // By its place in its project, so neighbouring bays never repeat their ends.
        const order = l.workspaces.filter((o) => o.project === w.project).indexOf(w);
        const kind = ((seedOf(w.project) >>> 5) + order) % 4;
        const ends: [number, number] = wide ? [1, 1] : ([[1, 1], [2, 1], [1, 3], [2, 0]] as [number, number][])[kind]!;
        const v = w.entity.camp ? (left || right ? 3 : 0) : left ? ends[0] : right ? ends[1] : 0;
        put(`alcove-slot-${v}`, x + 20 + (i * inner) / count, y + 12, inner / count + 0.5, D.alcoveH - 22, -12,
          // The left desk turned in (or, seeded, facing out), so bays don't repeat evenly.
          { ...dim, e: w.entity.id, shade: dim.dim ? 0.55 : INTERIOR_SHADE, ...(left && v === 1 && (seedOf(w.entity.id + "turn") & 3) !== 0 ? { flip: 1 } : {}) });
      }
      // Its frame, tagged with the workspace so it glows when hovered.
      const frameOf = { ...dim, e: w.entity.id };
      // The upper interior falls into shadow; the baked candlelit floor and desks below keep their warmth.
      images.push({ ...image("shade:upper", () => paintShade("upper")), x: x + 20, y: y + 12, w: inner, h: (D.alcoveH - 22) * 0.55, z: -11.95, ...dim });
      put("alcove-left", x, y + 7, 24, D.alcoveH - 9, -11, frameOf);
      put("alcove-right", x + width - 24, y + 7, 24, D.alcoveH - 9, -11, frameOf);
      fill("alcove-top", { x: x + 20, y, w: inner, h: 22 }, -10.9, frameOf);
      put("rampart-return-left", x - 2, y - 5, 45, 43, -10.8, frameOf);
      put("rampart-return-right", x + width - 43, y - 5, 45, 43, -10.8, frameOf);
      fill("alcove-ledge", { x: x + 20, y: y + D.alcoveH - 15, w: inner, h: 15 }, -10, frameOf);
      // A short continuous occlusion strip right under the lintel.
      images.push({ ...image("shade:under", () => paintShade("under")), x: x + 20, y: y + 20, w: inner, h: 12, z: -11.9, ...dim });
      for (const c of w.candles) {
        sprites.push(sprite("candle", at("candle", c.x, c.y, 10), 4, dim));
        if (online) {
          // Its light carried onto the ledge top beside it and up the jamb, flattened to those planes.
          lights.push({ x: c.x + (c.x < x + width / 2 ? 14 : -14), y: c.y + 2, rx: 30, ry: 4, c: 0xffa040, k: 0.35, z: -9.6, period: 1900, flicker: false });
          lights.push({ x: c.x < x + width / 2 ? x + 14 : x + width - 14, y: c.y - 30, rx: 6, ry: 26, c: 0xff9a38, k: 0.22, z: -10.7, period: 1900, flicker: false });
          lights.push({ x: c.x, y: c.y - 30, c: 0xffc040, r: 24, period: 1900, flicker: true, ph: random(seedOf(w.entity.id + c.x))(), k: 1 });
          lights.push({ x: c.x, y: c.y - 6, rx: 26, ry: 12, c: GOLD, blend: "gold", k: GOLD_K.candle, z: -9.5, period: 1900, flicker: true, ph: random(seedOf(w.entity.id + c.x + "g"))() });
        }
      }
      // The ledge glows warm where the robots stand.
      // (The ledge is lit only where robots stand: their spotlights, with the agents.)
      // (No name label: the alcove's plain lintel; its name is on its hover card, as on the Islands.)
    }
    const flags = l.workspaces.flatMap((w) => [
      ...w.flags.map((f) => ({ ws: w.entity.id, flag: f.flag, ...sprite(f.frame, at(f.frame, f.x, f.y, f.size), 5, { ...dimOf(w.floor), ...(f.flag === "probe" && w.entity.probe?.state === "reviewing" ? { pulse: 1800 } : f.flag === "ci-running" ? { pulse: 1400 } : {}) }), cx: f.x, cy: f.y, s: f.size })),
      ...(w.seal ? [{ ...sprite("seal-automerge", at("seal-automerge", w.seal.x, w.seal.y, w.seal.size), 5.1, dimOf(w.floor)) }] : []),
    ]);
    for (const d of l.decor) {
      if (d.project) continue;
      // Rugs lie on the terrace floor; recesses stand on it; other back things hang on the far wall.
      // Cloth and its hanging rod sit in front of the upper wall's brick cap, beneath its pillars' capitals.
      const z = d.frame === "rug-red" ? -39.5 : d.recess ? -38 : d.frame.startsWith("banner-") && d.layer === "back" ? -43.85 : d.layer === "back" ? -48 : -4;
      // Side rooms' recesses a shade down, so their coloured light never outshines the robots.
      // Side rooms' recesses and the foot's red rugs a shade down, so neither outshines the robots.
      const glowing = /^(magic-circle|crystal|alchemy-tank)$/.test(d.frame);
      const quiet = (d.recess || glowing || d.frame === "rug-red") && l.floors[d.floor]?.online ? { shade: d.recess ? 0.45 : glowing ? 0.32 : 0.38 } : {};
      // Within a room, the smaller pieces stand in front of the larger (armour before the circle, anvil before the forge).
      const depth = z === -4 && d.group ? (1 - Math.min(1, d.rect.h / 160)) * 0.05 : 0;
      sprites.push(sprite(d.frame, d.rect, z + depth, { ...dimOf(d.floor), ...(d.flip ? { flip: 1 } : {}), ...quiet }));
      // A soft contact shadow at the feet of everything standing on a floor.
      if (STANDING.has(d.frame) && d.layer === "front") {
        const w = d.rect.w * 0.92, h = Math.max(5, Math.min(14, w * 0.2));
        images.push({ ...image("shade:contact", () => paintShade("contact")), x: d.rect.x + (d.rect.w - w) / 2, y: d.rect.y + d.rect.h - h * 0.6, w, h, z: z + depth - 0.02 });
      }
      // A brazier stands on a masonry pad of its own.
      if (d.frame === "brazier") put("pillar-base", d.rect.x + 4, d.rect.y + d.rect.h - 11, d.rect.w - 8, 15, z - 0.05, dimOf(d.floor));
      if (d.light && l.floors[d.floor]!.online)
        lights.push({
          x: d.rect.x + d.rect.w / 2,
          y: d.light.dy !== undefined ? d.rect.y + d.light.dy : d.frame === "torch" ? d.rect.y + 8 : d.rect.y + d.rect.h * 0.45,
          c: d.light.color, r: d.light.reach, period: 2400, flicker: d.frame === "torch" || d.frame === "brazier", ph: random(seedOf(`${d.frame}${d.x},${d.y}`))(),
          // Side rooms' glows stay below the robots'.
          // Side rooms' glows stay below the robots'; torches and braziers too, now the stone is warm-lit.
          // Torches' halos bright and warm (the concept's gold is light); side rooms' glows stay below the robots'.
          ...(d.recess || d.group ? { k: 0.28 } : { k: 0.45 }),
        });
    }
    // Contrast: the upper walls fall into purple shadow toward the top; the board darkens toward its edges.
    for (const fl of l.floors)
      // Over the back wall's ramparts, pillars and banners; under the gate's surround and the torches.
      images.push({ ...image("shade:upper", () => paintShade("upper")), x: fl.rect.x, y: fl.top, w: fl.rect.w, h: D.band + 20, z: -43.5 });
    images.push({ ...image("shade:edges", () => paintShade("edges")), x: l.bounds.x, y: l.bounds.y, w: l.bounds.w, h: l.bounds.h, z: 0.9 });
    // Gold light, where the concept has it: pools that multiply the purple stone toward saturated gold (never a
    // wash over everything, which greys it), in the alcoves, along the walkways, on the front walls' lit tops and
    // round the torches. Offline floors stay unlit; the gate's column keeps its own, quieter light.
    const gold = (x: number, y: number, rx: number, ry: number, k: number, z: number, c = GOLD) =>
      lights.push({ x, y, rx, ry, c, blend: "gold", k, z, period: 5200, flicker: false, ph: random(seedOf(`g${x},${y}`))() });
    for (const w of l.workspaces) {
      if (!l.floors[w.floor]!.online) continue;
      const r = w.rect;
      // A richer gold behind the robots, in the deep gold (saturated, at mid luminance) so their colours still win.
      // The back wall glowing warm and bright right behind the robots, as the concept's alcoves glow (added light,
      // under the alcove's sides and the robots).
      // Capped: the deep gold, so it stays saturated gold behind the robots, never blown to white.
      gold(r.x + r.w / 2, r.y + r.h * 0.5, r.w * 0.56, r.h * 0.56, GOLD_K.alcove + 0.25, -11.4, GOLD_DEEP);
      // Added candlelight in the bay, behind the robots: warmth that brightens, never browns.
      lights.push({ x: r.x + r.w / 2, y: r.y + r.h * 0.45, c: 0xffb048, r: Math.max(r.w * 0.55, 70), k: 0.18, z: -11.3, period: 5200, flicker: false });
      // The walkway before it, warmed wide and low by its candlelight (added, under the robots and the front wall).
      lights.push({ x: r.x + r.w / 2, y: r.y + r.h + 22, c: 0xff8a2c, r: Math.max(r.w * 0.7, 110), k: 0.16, z: -39.1, period: 5200, flicker: false });
      // Its mouth: candlelight spilling onto the ledge and the walkway before it (added).
      lights.push({ x: r.x + r.w / 2, y: r.y + r.h - 4, c: 0xff8a2c, r: Math.max(r.w * 0.55, 70), k: 0.38, z: -9.8, period: 5200, flicker: false });
    }
    // (The walkways stay purple-grey flagstones lit warm only at their lights; v5's own warm specks light the front walls' tops.)
    // Warm bounce in clusters, not rails: lit wall tops only near a fixture (a project's wall-candles, the gate's
    // flanking torches), and the inner jambs either side of each alcove.
    for (const p of l.projects) {
      if (!l.floors[p.floor]!.online) continue;
      for (const t of p.torches)
        lights.push({ x: t.x, y: p.span.y + 31, rx: 30, ry: 11, c: GOLD, blend: "gold", k: 0.45, z: -29.5, period: 5200, flicker: false });
    }
    for (const w of JAMBS ? l.workspaces : []) {
      if (!l.floors[w.floor]!.online) continue;
      for (const jx of [w.rect.x + 14, w.rect.x + w.rect.w - 14])
        lights.push({ x: jx, y: w.rect.y + w.rect.h * 0.55, rx: 12, ry: w.rect.h * 0.3, c: GOLD_DEEP, blend: "gold", k: 0.6, z: -10.5, period: 5200, flicker: false });
    }
    // Candlelit side rooms (not the magic or crystal rooms, which keep their own light).
    for (const d of l.decor)
      if (d.recess && (d.frame === "room-arch" || d.frame === "room-forge") && l.floors[d.floor]?.online)
        lights.push({ x: d.rect.x + d.rect.w / 2, y: d.rect.y + d.rect.h * 0.62, rx: d.rect.w * 0.46, ry: d.rect.h * 0.42, c: GOLD_DEEP, blend: "gold", k: 0.85, z: -37.5, period: 5200, flicker: false });
    // Every lit side room spills added warm light round its mouth (the magic and crystal rooms keep their own colour).
    for (const d of l.decor)
      if (d.recess && l.floors[d.floor]?.online && !/magic|cave/.test(d.frame))
        lights.push({ x: d.rect.x + d.rect.w / 2, y: d.rect.y + d.rect.h * 0.7, c: 0xff8a2c, r: 100, k: 0.46, z: -37.4, period: 5200, flicker: false });
    // Painted warm glazes on the floor at the braziers, forge and candelabra.
    if (FRAMES["light-spill-floor-0"]?.real)
      for (const d of l.decor)
        if (/^(brazier|forge|candelabra)$/.test(d.frame) && l.floors[d.floor]?.online)
          sprites.push(sprite(`light-spill-floor-${seedOf(`${d.x},${d.y}`) % 2}`, at("light-spill-floor-0", d.rect.x + d.rect.w / 2, d.rect.y + d.rect.h - 4, d.frame === "candelabra" ? 70 : 110), -39.2, { add: 1, a: 0.55 }));
    // The forecourt's floor lit by its braziers.
    for (const d of l.decor)
      if (d.frame === "brazier" && l.floors[d.floor]?.online)
        lights.push({ x: d.rect.x + d.rect.w / 2, y: d.rect.y + d.rect.h - 6, rx: 52, ry: 18, c: GOLD_DEEP, blend: "gold", tight: 1, k: 0.8, z: -39, period: 5200, flicker: false });
    // The braziers' fire carried onto the parapet's top in front of them (flattened to that plane).
    for (const d of l.decor)
      if (d.frame === "brazier" && l.floors[d.floor]?.online)
        lights.push({ x: d.rect.x + d.rect.w / 2, y: l.floors[d.floor]!.top + l.floors[d.floor]!.height - D.footPad + 4, rx: 54, ry: 5, c: 0xffa040, k: 0.45, z: -3.3, period: 2400, flicker: true });
    // The braziers' fire lights the landing round them (added).
    for (const d of l.decor)
      if (d.frame === "brazier" && l.floors[d.floor]?.online)
        lights.push({ x: d.rect.x + d.rect.w / 2, y: d.rect.y + d.rect.h * 0.4, c: 0xffa040, r: 95, k: 0.35, z: -38.9, period: 2400, flicker: true });
    // One pool per torch, or per pair of torches close together (stacked pools would outshine the robots).
    const pooled: { x: number; y: number }[] = [];
    for (const d of l.decor) {
      if ((d.frame !== "torch" && d.frame !== "wall-candles") || !l.floors[d.floor]?.online) continue;
      const x = d.rect.x + d.rect.w / 2, y = d.rect.y + 30;
      if (pooled.some((q) => Math.hypot(q.x - x, q.y - y) < 90)) continue;
      pooled.push({ x, y });
      // The flame, near the fixture's top.
      const fy = d.rect.y + 10;
      // Torchlight on stone: a small multiplied pool for the warm cast, close round the flame, and added golden light.
      lights.push({ x, y: fy + 18, rx: 40, ry: 36, c: GOLD, blend: "gold", tight: 1, k: 0.5, z: -43, period: 5200, flicker: false });
      lights.push({ x, y: fy + 10, c: 0xff922e, r: 92, k: 0.6, period: 5200, flicker: false, z: -43.1 });
      // The art's painted glaze round the flame (one of three, seeded), added as light: small and golden, never a multiplied stain.
      if (FRAMES["light-spill-wall-0"]?.real)
        sprites.push(sprite(`light-spill-wall-${seedOf(`${x},${y}`) % 3}`, at("light-spill-wall-0", x, fy + 8, 64), -43.3, { add: 1, a: 0.6 }));
    }
    // The building's light is steady: no breathing or flicker in its pools.
    for (const l of lights) l.still = 1;
    return {
      type: "scene",
      build: ++builds,
      bounds: l.bounds,
      // The vault's top, which Swift's fit keeps below the HUD's title.
      ...(l.vault.length ? { vaultTop: Math.min(...l.vault.map((t) => t.rect.y), ...l.vaultSigns.map((v) => v.rect.y)) } : {}),
      sprites,
      images,
      lights,
      flags,
      entities: [
        // The vault's tiles: hover cards and clicks the page answers (never a selection).
        ...l.vault.map((t) => ({ id: t.id, kind: "tile", ...t.rect })),
        ...l.entities
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
      ],
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
        dim: offline ? 1 : 0,
        ph: rng(),
        // The state's glow on the ledge beneath it, wide enough to show either side of its feet.
        // In the Atlas's state colours (idle a quiet grey-lavender), an ellipse on the ledge round its feet.
        // A clear ellipse in its state's colour with a crisp rim: running bright with a light travelling round it,
        // idle a dim quiet grey-lavender and still, the states that need you pulsing.
        glow: {
          c: STATE_TILE[state] ?? 0x8c88b0,
          rim: RIM[state] ?? 0xb8b4d8,
          fill: state === "idle" ? 0.4 : state === "offline" ? 0.35 : 0.72,
          rimWidth: state === "idle" ? 1.6 : 2.6,
          bloom: state === "running" ? 3 : 0,
          a: 1,
          x: a.feet.x, y: a.feet.y + 2, w: D.robot * 1.5, h: D.robot * 0.42,
          ...(state === "running" ? { runner: 1 } : {}),
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
        lights.push({ x: a.feet.x, y: a.feet.y - 18, c: 0xffe2b0, r: 50, flicker: false, still: 1, period: 4000, z: 8.8, k: 0.8 });
        // A brighter heart to the spotlight, so the robots stay brighter than the warmer stone.
        lights.push({ x: a.feet.x, y: a.feet.y - 24, c: 0xffecc8, r: 30, flicker: false, still: 1, period: 4000, z: 8.85, k: 0.55 });
      }
    for (const p of l.projects) {
      const online = l.floors[p.floor]!.online;
      const id = p.entity?.id ?? p.key;
      const lit = online && projectWorking(l, id);
      for (const t of p.torches) {
        sprites.push(sprite(lit ? "torch" : "torch-out", at("torch", t.x, t.y), -3.5, online ? {} : { dim: 1 }));
        if (lit) lights.push({ x: t.x, y: t.y + 8, c: 0xffa03a, r: 56, period: 2400, flicker: false, still: 1, k: 0.6 });
      }
      const alarm = online ? projectAlarm(l, id) : undefined;
      if (alarm) lights.push({ x: p.mark.x, y: p.mark.y, c: STATE_TILE[alarm]!, r: 54, period: alarm === "failed" ? 1200 : 1800, flicker: false, z: 1.9, ph: 0 });
    }
    const counts = paintCounts(l.counts);
    const countsKey = `hud:counts:${JSON.stringify([l.counts.hosts, l.counts.projects, l.counts.workspaces, l.counts.agents])}`;
    // The At a Glance panel, once the page passes the dashboard's counts (as the vault).
    const glance = l.vault.length ? paintGlance(l.counts) : null;
    const glanceKey = `hud:glance:${JSON.stringify(l.counts)}`;
    return {
      type: "agents",
      robots,
      sprites,
      lights,
      hud: {
        counts: { ...(sent.has(countsKey) ? { key: countsKey } : (sent.add(countsKey), { key: countsKey, png: png(counts.canvas) })), w: counts.w, h: counts.h },
        ...(glance ? { panel: { ...(sent.has(glanceKey) ? { key: glanceKey } : (sent.add(glanceKey), { key: glanceKey, png: png(glance.canvas) })), w: glance.w, h: glance.h } } : {}),
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
    // The robot talked to has gone: the conversation's camera ends (Swift's ends with its entity too).
    if (talking.id && !entity(talking.id)) {
      talking = { id: null, inset: 0 };
      if (ready) post({ type: "talk", id: null, inset: 0 });
    }
    if (hovered) setHover(entity(hovered) ? hovered : null, hoverAt, hoverFlag);
    // A vault tile's card follows its counts while it's hovered (and goes with the tile).
    if (cardTile) {
      const t = tileOf(cardTile.id);
      if (!t) cardTile = null;
      handlers.card?.(t ? dashCard(dashOf(t), t.hall, t.key) : null, t ? cardTile!.at : null);
    }
  };
  /** The vault tile whose card shows, and where. */
  let cardTile: { id: string; at: { x: number; y: number; bottom?: number } | null } | null = null;

  const setHover = (id: string | null, at?: { x: number; y: number; bottom?: number }, flag?: MapFlag) => {
    hovered = id;
    hoverAt = id ? at : undefined;
    hoverFlag = id ? flag : undefined;
    const e = entity(id);
    handlers.hover?.(e, e && at ? at : null, e ? hoverFlag : undefined);
  };
  const tileOf = (id: string) => layout?.vault.find((t) => t.id === id);
  const dashOf = (t: DTile) => data?.dashboard?.[t.hall] ?? null;
  type NativeEvent =
    | { type: "ready" }
    | { type: "pick"; id: string | null }
    | { type: "hover"; id: string | null; x?: number; y?: number; bottom?: number; flag?: MapFlag }
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
      // Always, as the selection is: a fresh scene frames the robot talked to, and one kept through a reload (the same
      // kind of scene) ends the conversation it still holds.
      post({ type: "talk", ...talking });
      handlers.ready?.();
    } else if (message.type === "pick") {
      if (!enabled) return;
      if (message.id?.startsWith("tile:")) {
        // A vault tile opens its first PR or issue, as the app opens such links (and as the Village's do).
        const t = tileOf(message.id);
        const url = t && dashOf(t)?.items?.[t.key]?.[0]?.url;
        if (url) handlers.open?.(url);
        return;
      }
      handlers.pick?.(entity(message.id));
    } else if (message.type === "hover") {
      parent.style.cursor = message.id ? "pointer" : "";
      // Where a card points: the hovered thing's top centre, and its bottom edge (`bottom`, where its card goes when
      // there's no room above it).
      const at = message.x === undefined ? null : { x: message.x, y: message.y!, bottom: message.bottom };
      if (message.id?.startsWith("tile:")) {
        if (hovered) setHover(null);
        const t = tileOf(message.id);
        cardTile = t ? { id: t.id, at } : null;
        handlers.card?.(t ? dashCard(dashOf(t), t.hall, t.key) : null, at);
        return;
      }
      cardTile = null;
      handlers.card?.(null, null);
      setHover(message.id, at ?? undefined, message.flag);
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
    talk: (id, inset = 0) => {
      const next = id && (!layout || entity(id)) ? { id, inset: Number.isFinite(inset) ? Math.max(0, Math.round(inset)) : 0 } : { id: null, inset: 0 };
      if (next.id === talking.id && next.inset === talking.inset) return;
      talking = next;
      if (ready) post({ type: "talk", ...talking });
    },
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
            talk: talking.id ? { ...talking } : null,
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
            projects: layout.projects.map((p) => ({ id: p.entity?.id ?? p.key, name: p.name, side: p.side, tier: p.tier, rect: p.rect })),
            workspaces: layout.workspaces.map((w) => ({
              id: w.entity.id, name: w.entity.name, camp: !!w.entity.camp, rect: w.rect,
              flags: w.flags.map((f) => f.flag), medallions: w.flags.map((f) => ({ flag: f.flag, x: f.x, y: f.y })), seal: !!w.seal,
            })),
            vault: layout.vault.map((t) => ({ id: t.id, pane: t.pane, frame: t.frame, rect: t.rect, glass: t.glass })),
            vaultSigns: layout.vaultSigns.map((v) => ({ hall: v.hall, label: v.label, rect: v.rect })),
            agents: layout.agents.map((a) => ({ id: a.entity.id, name: a.entity.name, state: a.entity.state, model: a.entity.model, robot: a.robot, workspace: a.entity.workspace, at: a.feet, rect: a.rect })),
          }
        : undefined,
    destroy: () => {
      destroyed = true;
      // A vault tile's card goes with the board.
      if (cardTile) handlers.card?.(null, null);
      ready = false;
      clearInterval(watchdog);
      surface.destroy();
      window.removeEventListener("paseo:world", receive);
      post({ type: "detach" });
    },
  };
}

export type { Entity };
