/**
 * The Village drawn by the native macOS app (SpriteKit), as the Dungeon Board
 * is: the page lays the village out (`layout.ts`), paints its text (plaques,
 * plates, the HUD) and posts the result to Swift (`VillageScene.swift`), which
 * draws, animates, owns the camera, hover and picking, and answers through
 * `paseo:world` events. Nothing here sends daemon actions.
 */
import { STATE_TILE, seedOf, random, type AtlasData, type Entity } from "../world";
import { HOVER_COLOR, PULSE_MS } from "../placement";
import type { MapFlag } from "../prStatus";
import { MAX_ZOOM } from "../camera";
import type { AtlasHandlers, AtlasWorld } from "../atlas";
import { WORLD_WATCH, applied, behind, newWatch, post as postRevision } from "../native/watch";
import { nativeSurface } from "../native/surface";
import { FRAMES, ANIMATIONS, VILLAGE_PX, anchorShare, applySheet, framesOf, sharedFrame, sliceOf, type SheetJson } from "./frames";
import { paintPlaceholder } from "./placeholder";
import {
  NEEDS_YOU,
  STATE_MARK,
  TILE_NAMES,
  V,
  layoutVillage,
  projectAlarm,
  projectWorking,
  statusLine,
  type Measure,
  type Rect,
  type VillageLayout,
} from "./layout";

type Channel = { postMessage(message: unknown): void };
const channel = (): Channel | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: Channel } } }).webkit?.messageHandlers?.paseoWorld;

/** The art agent's sheets, when they are in: `<sheet>.json` beside `<sheet>.png`; and the Dungeon Board's status marks and icons. */
const SHEET_JSON = import.meta.glob(["../assets/village/*.json", "../assets/dungeon/status.json", "../assets/dungeon/ui.json"], { eager: true, import: "default" }) as Record<string, unknown>;
const SHEET_PNG = import.meta.glob(["../assets/village/*.png", "../assets/dungeon/status.png", "../assets/dungeon/ui.png"], { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** Plaques, plates and the HUD are painted at this many pixels per village unit (crisp when zoomed in). */
const TEXT_SCALE = 4;
/** The concept's plaques: a warm book serif. */
const FONT = '"Palatino", "Palatino Linotype", "Book Antiqua", Georgia, serif';
const BOLD = 700;
const INK = "#2e1d0e";
const ALERT = "#b0301c";
const CREAM = "#f3e6c4";
/** How far the paving is darkened (toward the scene's warm shadow) from the sheet's bright gold. */
const PAVE_SHADE = 0.2;
/** The HUD's dots for each tile, as the tiles' own colours. */
const TILE_DOT: Record<string, string> = { merged: "#4cc35a", review: "#3d8fe8", draft: "#f0b42a", failing: "#e2493a", none: "#7a8494" };

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}.`));
    image.src = url;
  });
const png = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");

/** Every frame of the contract: the sheets' where they have it, a placeholder where not. */
async function buildFrames(): Promise<{ canvases: Map<string, HTMLCanvasElement>; real: Set<string> }> {
  const canvases = new Map<string, HTMLCanvasElement>();
  const real = new Set<string>();
  // The Village's own sheets first; the Dungeon Board's give only the frames the Village borrows.
  const paths = Object.keys(SHEET_JSON).sort((a, b) => Number(a.includes("/dungeon/")) - Number(b.includes("/dungeon/")));
  for (const path of paths) {
    const sheet = SHEET_JSON[path] as SheetJson;
    if (!sheet || typeof sheet !== "object" || !sheet.frames) continue;
    const url = SHEET_PNG[path.replace(/\.json$/, ".png")];
    if (!url) continue;
    let image: HTMLImageElement;
    try {
      image = await load(url);
    } catch {
      continue;
    }
    const shared = path.includes("/dungeon/");
    const only = (name: string) => (shared ? sharedFrame(name) : !sharedFrame(name)) && !real.has(name);
    const taken = applySheet(sheet, only, shared ? undefined : VILLAGE_PX);
    for (const name of taken) {
      const f = sheet.frames[name]!;
      const canvas = document.createElement("canvas");
      canvas.width = f.w;
      canvas.height = f.h;
      canvas.getContext("2d")!.drawImage(image, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      canvases.set(name, canvas);
      real.add(name);
    }
  }
  for (const name of Object.keys(FRAMES)) if (!canvases.has(name)) canvases.set(name, paintPlaceholder(name));
  for (const [name, c] of canvases) if (name.startsWith("cobble-warm") && real.has(name)) gradePaving(c);
  trimRobots(canvases);
  bakeHalos(canvases);
  return { canvases, real };
}

/** The warm paving's grade, baked once: more contrast (darker mortar), more saturation, pulled a touch toward the
 * concept's tan-brown, so the stones read and the lamp pools stand out. */
const PAVING = { contrast: 1.32, pivot: 0.46, saturation: 1.18, warm: [1.03, 0.97, 0.9] };
function gradePaving(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    let r = d[i]! / 255, g = d[i + 1]! / 255, b = d[i + 2]! / 255;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    r = l + (r - l) * PAVING.saturation;
    g = l + (g - l) * PAVING.saturation;
    b = l + (b - l) * PAVING.saturation;
    r = (r - PAVING.pivot) * PAVING.contrast + PAVING.pivot;
    g = (g - PAVING.pivot) * PAVING.contrast + PAVING.pivot;
    b = (b - PAVING.pivot) * PAVING.contrast + PAVING.pivot;
    d[i] = Math.max(0, Math.min(255, r * PAVING.warm[0]! * 255));
    d[i + 1] = Math.max(0, Math.min(255, g * PAVING.warm[1]! * 255));
    d[i + 2] = Math.max(0, Math.min(255, b * PAVING.warm[2]! * 255));
  }
  ctx.putImageData(img, 0, 0);
}

/** Crop each robot's frames to the opaque pixels of all its frames together (so it keeps its place as
 * it animates), so the village sizes the visible robot, standing on its feet. */
function trimRobots(canvases: Map<string, HTMLCanvasElement>) {
  const groups = new Map<string, string[]>();
  for (const name of canvases.keys()) {
    const m = /^(robot-\w+)-(?:idle|work)-\d$/.exec(name);
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
      spec.anchor = "feet";
    }
  }
}

/** Each robot colour's halo: its idle silhouette in a light tint of its colour, blurred into a soft glow. */
const HALO = { pad: 0.2, tint: { orange: "#ffb27a", white: "#ffffff" } as Record<string, string> };
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
/** A strip from three pieces (`<base>-left`, a repeated `-mid`, `-right`) scaled to the strip's height. */
function threePieces(ctx: CanvasRenderingContext2D, frame: (n: string) => HTMLCanvasElement, base: string, x: number, y: number, w: number, h: number) {
  const l = FRAMES[`${base}-left`]!, r = FRAMES[`${base}-right`]!, m = FRAMES[`${base}-mid`]!;
  const lw = Math.min(w / 2, (l.w * h) / l.h), rw = Math.min(w / 2, (r.w * h) / r.h), mw = (m.w * h) / m.h;
  ctx.drawImage(frame(`${base}-left`), x, y, lw, h);
  ctx.drawImage(frame(`${base}-right`), x + w - rw, y, rw, h);
  const src = frame(`${base}-mid`);
  for (let at = x + lw; at < x + w - rw - 0.01; at += mw) {
    const part = Math.min(mw, x + w - rw - at);
    ctx.drawImage(src, 0, 0, (src.width * part) / mw, src.height, at, y, part + 0.3, h);
  }
}
/** A parchment plaque: the wide one's three pieces when the sheet has them, else the old scroll's, else the 9-sliced plaque. */
function threeSlice(ctx: CanvasRenderingContext2D, frame: (n: string) => HTMLCanvasElement, real: Set<string>, x: number, y: number, w: number, h: number) {
  if (["plaque-wide-left", "plaque-wide-mid", "plaque-wide-right"].every((n) => real.has(n))) return threePieces(ctx, frame, "plaque-wide", x, y, w, h);
  if (["plaque-left", "plaque-mid", "plaque-right"].every((n) => real.has(n))) return threePieces(ctx, frame, "plaque", x, y, w, h);
  return nineSlice(ctx, frame("plaque"), "plaque", x, y, w, h);
}

export function mountNativeVillage(parent: HTMLElement, handlers: AtlasHandlers = {}): AtlasWorld {
  const post = (message: Record<string, unknown> & { type: string }) => channel()?.postMessage(message);
  let destroyed = false;
  let ready = false;
  let frames: Map<string, HTMLCanvasElement> | null = null;
  let realFrames = new Set<string>();
  let data: AtlasData | null = null;
  let layout: VillageLayout | null = null;
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
  const fontOf = (kind: keyof typeof V.font) => `${BOLD} ${V.font[kind]}px ${FONT}`;
  const measure: Measure = (text, kind) => {
    measurer.font = fontOf(kind);
    return measurer.measureText(text).width;
  };
  const frame = (name: string) => frames!.get(name) ?? frames!.get(`${name}-0`)!;

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
  const fitText = (text: string, font: string, max: number) => {
    measurer.font = font;
    let shown = text;
    while (measurer.measureText(shown).width > max && shown.length > 1) shown = shown.slice(0, -2) + "…";
    return shown;
  };
  /** A project's parchment plaque: its name in the concept's serif. */
  const paintPlaque = (r: Rect, text: string) => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    threeSlice(ctx, frame, realFrames, 0, 0, r.w, r.h);
    ctx.font = fontOf("project");
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(text, fontOf("project"), r.w - 2 * V.labelPad), r.w / 2, r.h / 2 + 1);
    return canvas;
  };
  /** A bay's name plate: dark wood, its name in cream. */
  const paintPlate = (r: Rect, text: string) => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    if (["plate-left", "plate-mid", "plate-right"].every((n) => realFrames.has(n))) threePieces(ctx, frame, "plate", 0, 0, r.w, r.h);
    else {
      ctx.fillStyle = "#c69a44";
      ctx.beginPath();
      ctx.roundRect(0, 0, r.w, r.h, 5);
      ctx.fill();
      ctx.fillStyle = "#24170e";
      ctx.beginPath();
      ctx.roundRect(1.4, 1.4, r.w - 2.8, r.h - 2.8, 4);
      ctx.fill();
    }
    // The plate's own size first; a long name steps down to 12 px before it's cut short.
    let size = V.font.workspace;
    const font = (px: number) => `${BOLD} ${px}px ${FONT}`;
    measurer.font = font(size);
    while (size > 12 && measurer.measureText(text).width > r.w - 14) measurer.font = font(--size);
    ctx.font = font(size);
    ctx.fillStyle = CREAM;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(text, font(size), r.w - 14), r.w / 2, r.h / 2 + 1);
    return canvas;
  };
  /** The host's plaque under the fountain: its name, then a status dot and its machine's load. */
  const paintHostPlaque = (r: Rect, title: string, stats: { text: string; alert: boolean }[], online: boolean) => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    threeSlice(ctx, frame, realFrames, 0, 0, r.w, r.h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = fontOf("host");
    ctx.fillStyle = INK;
    ctx.fillText(fitText(title, fontOf("host"), r.w - 60), r.w / 2, r.h * 0.4);
    const parts = stats.length ? stats.flatMap((s, i) => (i ? [{ text: " · ", alert: false }, s] : [s])) : [{ text: online ? "No load reading" : "Offline", alert: false }];
    ctx.font = fontOf("stats");
    const widths = parts.map((p) => ctx.measureText(p.text).width);
    const dot = 9;
    let x = r.w / 2 - (widths.reduce((s, w) => s + w, 0) + dot + 6) / 2;
    const y = r.h * 0.66;
    ctx.fillStyle = online ? "#3fb44a" : "#8a8478";
    ctx.beginPath();
    ctx.arc(x + dot / 2, y, dot / 2, 0, Math.PI * 2);
    ctx.fill();
    x += dot + 6;
    ctx.textAlign = "left";
    parts.forEach((p, i) => {
      ctx.fillStyle = p.alert ? ALERT : INK;
      ctx.fillText(p.text, x, y + 0.5);
      x += widths[i]!;
    });
    return canvas;
  };

  /** The HUD's "At a Glance" panel: dark wood, gold corners, in screen points. */
  const paintGlance = (l: VillageLayout) => {
    const c = l.counts;
    type Row = { dot: string; name: string; n: number };
    const sections: { icon: string; title: string; n: number; rows: Row[] }[] = [
      {
        icon: "icon-pr", title: "PRs", n: c.prs,
        rows: (["merged", "review", "draft", "failing"] as const).map((k) => ({ dot: TILE_DOT[k]!, name: TILE_NAMES[k], n: c.pr[k] })),
      },
      { icon: "icon-workspaces", title: "Workspaces", n: c.workspaces, rows: [{ dot: "#4cc35a", name: "Active", n: c.active }] },
      {
        icon: "icon-agents", title: "Agents", n: c.agents,
        rows: [
          { dot: "#4cc35a", name: "Running", n: c.running },
          { dot: "#9a9aa8", name: "Idle", n: c.idle },
          { dot: "#ef9b1b", name: "Need you", n: c.needYou },
          ...(c.unread ? [{ dot: "#f2c94c", name: "Unread", n: c.unread }] : []),
          ...(c.failed ? [{ dot: "#e2493a", name: "Failed", n: c.failed }] : []),
          ...(c.offline ? [{ dot: "#6a6670", name: "Offline", n: c.offline }] : []),
        ],
      },
    ];
    const w = 250, pad = 30, head = 50, secHead = 34, rowH = 22, gap = 18;
    const h = Math.ceil(pad + head + sections.reduce((s, x) => s + secHead + x.rows.length * rowH + gap, 0) - gap + pad + 6);
    const { canvas, ctx } = canvasFor(w, h);
    nineSlice(ctx, frame("panel-9slice"), "panel-9slice", 0, 0, w, h, 0.62);
    ctx.textBaseline = "middle";
    // Title: a small bar chart, "At a Glance".
    let y = pad + 16;
    ctx.fillStyle = CREAM;
    for (let i = 0; i < 3; i++) ctx.fillRect(pad + i * 6, y + 6 - (i + 1) * 5, 4, (i + 1) * 5);
    ctx.font = `${BOLD} 21px ${FONT}`;
    ctx.fillText("At a Glance", pad + 28, y);
    y += 22;
    const divider = (at: number) => {
      if (realFrames.has("divider")) ctx.drawImage(frame("divider"), pad - 4, at - 3, w - 2 * pad + 8, 6);
      else {
        ctx.fillStyle = "rgba(201,160,64,0.55)";
        ctx.fillRect(pad, at, w - 2 * pad, 1.2);
      }
    };
    divider(y);
    y += 12;
    sections.forEach((s, i) => {
      if (i) {
        divider(y - gap / 2 - 2);
      }
      y += secHead / 2;
      ctx.drawImage(frame(s.icon), pad, y - 12, 24, 24);
      ctx.font = `${BOLD} 19px ${FONT}`;
      ctx.fillStyle = CREAM;
      ctx.textAlign = "left";
      ctx.fillText(s.title, pad + 32, y);
      ctx.textAlign = "right";
      ctx.fillText(String(s.n), w - pad, y);
      y += secHead / 2;
      ctx.font = `${BOLD} 15px ${FONT}`;
      for (const r of s.rows) {
        y += rowH / 2;
        ctx.fillStyle = r.dot;
        ctx.beginPath();
        ctx.arc(pad + 12, y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#e6dcc4";
        ctx.textAlign = "left";
        ctx.fillText(r.name, pad + 26, y + 0.5);
        ctx.textAlign = "right";
        ctx.fillText(String(r.n), w - pad, y + 0.5);
        y += rowH / 2;
      }
      y += gap;
    });
    return { canvas, w, h };
  };
  /** The status pill: "All systems operational", or what needs you. */
  const paintPill = (l: VillageLayout) => {
    const s = statusLine(l);
    const font = `${BOLD} 16px ${FONT}`;
    measurer.font = font;
    const w = Math.ceil(measurer.measureText(s.text).width + 84), h = 40;
    const { canvas, ctx } = canvasFor(w, h);
    nineSlice(ctx, frame("pill"), "pill", 0, 0, w, h, 0.8);
    // Green when all is well, amber when something needs you or a host is offline, red when an agent failed.
    ctx.fillStyle = s.tone === "ok" ? "#3fc24e" : s.tone === "alert" ? "#e2493a" : "#f0b42a";
    ctx.beginPath();
    ctx.arc(32, h / 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = font;
    ctx.fillStyle = CREAM;
    ctx.textBaseline = "middle";
    ctx.fillText(s.text, 48, h / 2 + 1);
    return { canvas, w, h, text: s.text };
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
      ...(animated ? { anim: framesOf(name), fps: name === "waterfall" ? 8 : 5 } : {}),
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      z,
      ...extra,
    };
  };
  const tile = (name: string, r: Rect, z: number, extra: Sprite = {}): Sprite => ({ f: name, x: r.x, y: r.y, w: r.w, h: r.h, z, tile: FRAMES[name]!.tile ?? "xy", ...extra });

  /** A cobbled road with organic edges: cobbles inside, ragged edge pieces round its border (grass bleeding over). */
  // The edge pieces are drawn at their own scale (their stones the cobbles' size), cut to strips of a road's
  // border: `e` deep along each side, `e` square at the corners.
  const paving = (r: Rect, z: number, extra: Sprite): Sprite[] => {
    // The warm paving where the sheets have it, else the first.
    const stone = realFrames.has("cobble-warm") && realFrames.has("cobble-warm-edge-n") ? "cobble-warm" : "cobble";
    const P = FRAMES[`${stone}-edge-n`]!.w;
    const e = Math.min(56, r.w / 2, r.h / 2);
    const k = e / P;
    // Toned down from the sheet's bright gold toward the concept's warm grey-brown; lamp pools and the vignette make the bright spots.
    // The warm paving, nudged toward the concept's tan-brown (a light warm tint, never darker).
    const tone = stone === "cobble" ? { shade: PAVE_SHADE, ...extra } : extra;
    const out: Sprite[] = [tile(stone, { x: r.x + e * 0.5, y: r.y + e * 0.5, w: r.w - e, h: r.h - e }, z, tone)];
    const cut = (name: string, x: number, y: number, w: number, h: number, uv: number[]) =>
      out.push({ f: `${stone}-edge-${name}`, x, y, w, h, uv, z: z + 0.01, ...tone });
    // Along the top and bottom, in runs of the piece's width (its middle, clear of its own corners).
    for (let x = r.x + e; x < r.x + r.w - e - 0.5; x += P * 0.6) {
      const w = Math.min(P * 0.6, r.x + r.w - e - x), u = 0.2, du = w / P;
      cut("n", x, r.y, w + 0.4, e, [u, 0, du, k]);
      cut("s", x, r.y + r.h - e, w + 0.4, e, [u, 1 - k, du, k]);
    }
    for (let y = r.y + e; y < r.y + r.h - e - 0.5; y += P * 0.6) {
      const h = Math.min(P * 0.6, r.y + r.h - e - y), v = 0.2, dv = h / P;
      cut("w", r.x, y, e, h + 0.4, [0, v, k, dv]);
      cut("e", r.x + r.w - e, y, e, h + 0.4, [1 - k, v, k, dv]);
    }
    cut("nw", r.x, r.y, e, e, [0, 0, k, k]);
    cut("ne", r.x + r.w - e, r.y, e, e, [1 - k, 0, k, k]);
    cut("sw", r.x, r.y + r.h - e, e, e, [0, 1 - k, k, k]);
    cut("se", r.x + r.w - e, r.y + r.h - e, e, e, [1 - k, 1 - k, k, k]);
    return out;
  };

  /** A soft dark ellipse: a hall's contact shadow on the paving. */
  const paintContact = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(1, 0.25);
    const g = ctx.createRadialGradient(128, 128, 20, 128, 128, 128);
    g.addColorStop(0, "rgba(28, 18, 6, 0.75)");
    g.addColorStop(0.6, "rgba(28, 18, 6, 0.4)");
    g.addColorStop(1, "rgba(28, 18, 6, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
    return canvas;
  };

  /** Standing things sort by their feet: further down the village is nearer the viewer. */
  const standZ = (l: VillageLayout, feetY: number) => -30 + (20 * (feetY - l.bounds.y)) / Math.max(1, l.bounds.h);

  /** The village's ground, buildings, bays, plaques, plates and scenery: what changes only when places do. */
  const sceneOf = (l: VillageLayout) => {
    const sprites: Sprite[] = [];
    const images: Sprite[] = [];
    const lights: Sprite[] = [];
    const dimOf = (square: number) => (l.squares[square]?.online ? {} : { dim: 1 });
    l.squares.forEach((sq, i) => {
      const dim = dimOf(i);
      // The grass is Swift's backdrop, on the world's grid; an offline square darkens its own, on the same grid.
      const grid = FRAMES.grass!.w * 6;
      const phase = (v: number) => ((v % grid) + grid) % grid;
      if (!sq.online) sprites.push(tile("grass", sq.rect, -60, { ...dim, ox: phase(sq.rect.x), oy: phase(sq.rect.y) }));
      for (const r of sq.roads) sprites.push(...paving(r, -57, dim));
      const warm = realFrames.has("cobble-warm-blob");
      sprites.push(sprite(warm ? "cobble-warm-blob" : "cobble-blob", sq.plaza, -56.9, { ...(warm ? {} : { shade: PAVE_SHADE }), ...dim }));
      sprites.push(sprite("plaza-ring", sq.ring, -56, { shade: PAVE_SHADE * 0.5, ...dim }));
      sprites.push(sprite(sq.online ? "fountain-on" : "fountain-off", sq.fountain, standZ(l, sq.fountain.y + sq.fountain.h), dim));
      if (sq.online) {
        const basin = at("water-ripple", sq.center.x, sq.fountain.y + sq.fountain.h * 0.74, sq.fountain.w * 0.7);
        sprites.push(sprite("water-ripple", basin, standZ(l, sq.fountain.y + sq.fountain.h) + 0.01, { a: 0.8 }));
      }
      images.push({
        ...image(`hostplaque:${sq.title}:${JSON.stringify(sq.stats)}:${sq.online}:${sq.plaque.w}`, () => paintHostPlaque(sq.plaque, sq.title, sq.stats, sq.online)),
        x: sq.plaque.x, y: sq.plaque.y, w: sq.plaque.w, h: sq.plaque.h, z: 3, ...dim,
      });
    });
    for (const p of l.projects) {
      const dim = { ...dimOf(p.square), ...(p.stale ? { a: 0.75 } : {}) };
      const z = standZ(l, p.base);
      sprites.push(sprite(p.building, p.body, z, dim));
      // Its contact shadow on the paving, and its lit windows (while its host is online).
      images.push({ ...image("shadow:contact", paintContact), x: p.body.x - p.body.w * 0.02, y: p.base - 46, w: p.body.w * 1.04, h: 92, z: z - 0.01, a: 0.75 });
      if (l.squares[p.square]!.online)
        for (let k = 0; k < 4; k++)
          lights.push({ x: p.body.x + p.body.w * (0.21 + 0.19 * k), y: p.body.y + p.body.h * 0.52, c: 0xffa63a, r: 52, period: 3800, flicker: false, ph: k / 4, z: z + 0.004, k: 0.8 });
      sprites.push(sprite("banner", p.banner, z + 0.002, dim));
      // The shared icon set: near-white glyphs with dark outlines, as the concept's banners carry.
      const icon = at(`icon-${p.icon}`, p.banner.x + p.banner.w / 2, p.banner.y + p.banner.h * 0.48, p.banner.w * 0.56);
      sprites.push(sprite(`icon-${p.icon}`, icon, z + 0.003, dim));
      // The porch, before the arcade: its ends and a tiled middle.
      if (p.ledge) {
        // A shallow stone ledge as wide as the hall, the robots' heads at its base.
        const piece = realFrames.has("porch-ledge-mid") ? "porch-ledge" : "porch";
        const ph = p.porch.h, lw = (FRAMES[`${piece}-left`]!.w * ph) / FRAMES[`${piece}-left`]!.h, rw = (FRAMES[`${piece}-right`]!.w * ph) / FRAMES[`${piece}-right`]!.h;
        sprites.push(sprite(`${piece}-left`, { x: p.porch.x, y: p.porch.y, w: lw, h: ph }, z + 0.0005, dim));
        sprites.push(tile(`${piece}-mid`, { x: p.porch.x + lw, y: p.porch.y, w: Math.max(0, p.porch.w - lw - rw), h: ph }, z + 0.0004, dim));
        sprites.push(sprite(`${piece}-right`, { x: p.porch.x + p.porch.w - rw, y: p.porch.y, w: rw, h: ph }, z + 0.0005, dim));
      } else {
        // Its foundation steps down onto the paving.
        sprites.push(sprite("foundation-steps", at("foundation-steps", p.body.x + p.body.w / 2, p.base + V.steps - 4, p.body.w * 0.9), z + 0.0005, dim));
      }
      images.push({
        ...image(`plaque:${p.name}:${Math.round(p.plaque.w)}`, () => paintPlaque(p.plaque, p.name)),
        x: p.plaque.x, y: p.plaque.y, w: p.plaque.w, h: p.plaque.h, z: z + 0.004, ...dim,
      });
    }
    for (const w of l.workspaces) {
      const dim = { ...dimOf(w.square), ...(w.entity.stale ? { a: 0.7 } : {}) };
      const z = standZ(l, w.frame.y + w.frame.h);
      // A bay beyond its building's four arches stands under an arch of its own.
      if (w.arch) sprites.push(sprite("bay-arch", w.arch, standZ(l, w.arch.y + w.arch.h) - 0.002, dim));
      if (w.entity.camp) {
        sprites.push(sprite("tent", at("tent", w.tileAt.x, w.frame.y + w.frame.h, Math.min(w.rect.w + 20, 130)), z, dim));
      } else {
        // Over every standing thing (no tree's crown hides what a tile says).
        sprites.push(sprite("tile-frame", w.frame, 2, dim));
        sprites.push(sprite(`tile-${w.tile}`, at(`tile-${w.tile}`, w.tileAt.x, w.tileAt.y, w.tileSize), 2.1, dim));
      }
      images.push({
        ...image(`plate:${w.entity.name}:${Math.round(w.plate.w)}`, () => paintPlate(w.plate, w.entity.name)),
        x: w.plate.x, y: w.plate.y, w: w.plate.w, h: w.plate.h, z: 3, ...dim,
      });
      // The arch's lamp-lit interior behind the tile.
      if (l.squares[w.square]!.online && !w.entity.camp) lights.push({ x: w.tileAt.x, y: w.frame.y + 6, c: 0xffb860, r: 44, period: 3200, flicker: false, ph: random(seedOf(w.entity.id))(), z: -0.5, k: 0.3 });
    }
    const flags = l.workspaces.flatMap((w) => [
      ...w.flags.map((f) => ({ ws: w.entity.id, flag: f.flag, ...sprite(f.frame, at(f.frame, f.x, f.y, f.size), 5, { ...dimOf(w.square), ...(f.flag === "probe" && w.entity.probe?.state === "reviewing" ? { pulse: 1800 } : f.flag === "ci-running" ? { pulse: 1400 } : {}) }), cx: f.x, cy: f.y, s: f.size })),
      ...(w.seal ? [{ ...sprite("seal-automerge", at("seal-automerge", w.seal.x, w.seal.y, w.seal.size), 5.1, dimOf(w.square)) }] : []),
    ]);
    for (const d of l.decor) {
      const z = d.layer === "ground" ? (d.frame === "river" || d.frame === "pond" || d.frame === "moat-pond" ? -55 : -52) : standZ(l, d.rect.y + d.rect.h);
      const extra: Sprite = { ...dimOf(d.square), ...(d.flip ? { flip: 1 } : {}) };
      if (d.frame === "river" || d.frame === "wall-h" || d.frame === "cliff-mid") sprites.push(tile(d.frame, d.rect, z, extra));
      else sprites.push(sprite(d.frame, d.rect, z, extra));
      if (d.light) lights.push({ x: d.rect.x + d.rect.w / 2, y: d.light.dy !== undefined ? d.rect.y + d.light.dy : d.rect.y + d.rect.h / 2, c: d.light.color, r: d.light.reach, period: 2600, flicker: true, ph: random(seedOf(`${d.frame}${d.x},${d.y}`))(), k: 0.55 });
      if (d.frame === "tent" || d.frame.startsWith("crates") || d.frame === "barrel")
        images.push({ ...image("shadow:contact", paintContact), x: d.rect.x, y: d.rect.y + d.rect.h - d.rect.w * 0.12, w: d.rect.w, h: d.rect.w * 0.24, z: z - 0.01, a: 0.6 });
    }
    return {
      type: "scene",
      build: ++builds,
      bounds: l.bounds,
      // The forest at the village's left the HUD's panel may lie over, and the heart the fit frames.
      hudClear: V.marginLeft - 40,
      core: l.core,
      keep: l.keep,
      sprites,
      images,
      lights,
      flags,
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

  /** What changes with the agents' states: robots, their floor lights and markers, the projects' lamps and flares, the crystal, the HUD. */
  const agentsOf = (l: VillageLayout) => {
    const robots = l.agents.map((a) => {
      const e = a.entity;
      const color = a.robot;
      const state = e.state!;
      const offline = state === "offline";
      const spec = FRAMES[`robot-${color}-idle-0`]!;
      const width = (V.robotH * spec.w) / spec.h;
      const box = { x: a.feet.x - width / 2, y: a.feet.y - V.robotH, w: width, h: V.robotH };
      const mark = STATE_MARK[state];
      const rng = random(seedOf(e.id + "bob"));
      return {
        id: e.id,
        ...box,
        // At rest a robot faces front (its first idle frame; it only breathes); at work it moves through its work frames.
        idle: [`robot-${color}-idle-0`],
        work: framesOf(`robot-${color}-work`),
        busy: state === "running",
        dim: offline ? 1 : 0,
        ph: rng(),
        // Its floor light: an ellipse in the Atlas's state colour on the porch round its feet, pulsing for states that need you.
        glow: {
          c: STATE_TILE[state] ?? 0x9aa0c8,
          a: state === "idle" ? 0.55 : 0.9,
          x: a.feet.x, y: a.feet.y + 2, w: V.pitch * 0.95, h: V.pitch * 0.3,
          ...(PULSE_MS[state] ? { pulse: PULSE_MS[state] } : {}),
        },
        ...(mark ? { mark: { f: mark, ...at(mark, a.feet.x + width * 0.36, a.feet.y - V.robotH + 4, 32), pulse: PULSE_MS[state] ?? 1800, scale: 0.12 } } : {}),
        ...(FRAMES[`halo-${color}`] && !offline ? { halo: { f: `halo-${color}`, w: width * (1 + 2 * HALO.pad), h: V.robotH * (1 + 2 * HALO.pad) } } : {}),
        ...(offline ? {} : { eyes: { x: width / 2, y: V.robotH * 0.44, w: width * 0.62, c: 0x8ff0ff } }),
        drones: offline ? [] : a.drones.slice(0, Math.min(4, e.subagents ?? 0)).map((c) => [`drone-${c}`]),
        droneDefault: [`drone-${color}`],
        droneSize: Math.round(V.robotH * 0.32),
        subagents: offline ? 0 : Math.min(4, e.subagents ?? 0),
      };
    });
    const sprites: Sprite[] = [];
    const lights: Sprite[] = [];
    // The square's lamps along the central road and by the fountain: lit while any of its agents runs.
    for (const [i, sq] of l.squares.entries()) {
      const lit = sq.online && l.agents.some((a) => a.square === i && a.entity.state === "running");
      for (const lamp of sq.lamps) {
        sprites.push(sprite(lit ? "lamp-on" : "lamp-off", at("lamp-on", lamp.x, lamp.y), standZ(l, lamp.y), sq.online ? {} : { dim: 1 }));
        if (lit) {
          // The lantern's glow, and its warm pool on the cobbles.
          lights.push({ x: lamp.x, y: lamp.y - (FRAMES["lamp-on"]!.h - 14), c: 0xffc46a, r: 64, period: 2600, flicker: true, ph: random(seedOf(`${sq.host.id}${lamp.x},${lamp.y}`))(), k: 0.95 });
          // Its pool on the cobbles: orange, about one and a half lamp heights across.
          lights.push({ x: lamp.x, y: lamp.y - 10, c: 0xff8c2a, r: FRAMES["lamp-on"]!.h * 0.8, period: 3400, flicker: false, ph: 0.3, z: -40, k: 0.62 });
        }
      }
      // Lanterns on the bridge's posts, over the bridge.
      const bridgeZ = standZ(l, sq.bridge.y + sq.bridge.h) + 0.01;
      for (const lamp of sq.bridgeLamps) {
        sprites.push(sprite(lit ? "lamp-on" : "lamp-off", at("lamp-on", lamp.x, lamp.y, 30), bridgeZ, sq.online ? {} : { dim: 1 }));
        if (lit) lights.push({ x: lamp.x, y: lamp.y - 50, c: 0xffb050, r: 80, period: 2600, flicker: true, ph: random(seedOf(`${sq.host.id}b${lamp.x}`))(), k: 0.9 });
      }
      // The navy banners on lamp posts either side of the fountain, as tall as its crystal, blank, as the sheet paints them.
      for (const p of sq.pennants) {
        const post = at("lamp-post-banner", p.x, p.y, 150);
        sprites.push(sprite("lamp-post-banner", post, standZ(l, p.y), sq.online ? {} : { dim: 1 }));
        // The host's emblem on the banner's cloth (its rect in the frame: x 50–86%, y 25–64%).
        const icon = at("icon-castle", post.x + post.w * 0.68, post.y + post.h * 0.43, post.w * 0.3);
        sprites.push(sprite("icon-castle", icon, standZ(l, p.y) + 0.001, sq.online ? {} : { dim: 1 }));
        if (lit) lights.push({ x: post.x + post.w * 0.25, y: post.y + post.h * 0.12, c: 0xffc46a, r: 50, period: 2600, flicker: true, ph: random(seedOf(`${sq.host.id}${p.x}`))(), k: 0.8 });
      }
    }
    // Each robot's floor light, in its state's colour, on the porch slab before it.
    for (const a of l.agents) {
      const c = STATE_TILE[a.entity.state!] ?? 0x9aa0c8;
      sprites.push({ ...sprite("floorlight", at("floorlight", a.feet.x, a.feet.y + 4, V.pitch * 1.1), 9.6), c, cf: 1, a: a.entity.state === "offline" ? 0.3 : 1 });
      // Its light pooled on the slab round it.
      if (a.entity.state !== "offline") lights.push({ x: a.feet.x, y: a.feet.y + 2, c, r: 56, period: PULSE_MS[a.entity.state!] ?? 4000, flicker: false, z: 9.55, k: 0.7 });
    }
    // A warm spotlight on the porch under each robot.
    for (const a of l.agents) if (a.entity.state !== "offline") lights.push({ x: a.feet.x, y: a.feet.y - 16, c: 0xfff1d6, r: 40, flicker: false, period: 4000, z: 8.8, k: 0.7 });
    for (const p of l.projects) {
      const online = l.squares[p.square]!.online;
      const id = p.entity?.id ?? p.key;
      const lit = online && projectWorking(l, id);
      for (const lamp of p.lamps) {
        sprites.push(sprite(lit ? "lamp-on" : "lamp-off", at("lamp-on", lamp.x, lamp.y), standZ(l, lamp.y), online ? {} : { dim: 1 }));
        if (lit) lights.push({ x: lamp.x, y: lamp.y - (FRAMES["lamp-on"]!.h - 10), c: 0xffc46a, r: 70, period: 2400, flicker: true, ph: random(seedOf(id + lamp.x))() });
      }
      const alarm = online ? projectAlarm(l, id) : undefined;
      if (alarm) lights.push({ x: p.banner.x + p.banner.w / 2, y: p.banner.y + p.banner.h * 0.45, c: STATE_TILE[alarm]!, r: 70, period: alarm === "failed" ? 1200 : 1800, flicker: false, z: -0.5, ph: 0 });
    }
    // The crystal: calm blue, flaring in the most urgent state's colour when something in its square needs you.
    for (const [i, sq] of l.squares.entries()) {
      if (!sq.online) continue;
      const states = l.agents.filter((a) => a.square === i).map((a) => a.entity.state!);
      const urgent = ["failed", "approval", "question", "asking", "done"].find((s) => states.includes(s as never));
      const cx = sq.center.x, cy = sq.fountain.y + sq.fountain.h * 0.36;
      lights.push({ x: cx, y: cy, c: 0x5fc8ff, r: 120, period: 3600, flicker: false, z: 4, k: 0.85 });
      // A cool blue glow spilling round the fountain onto the ring.
      lights.push({ x: cx, y: sq.fountain.y + sq.fountain.h * 0.8, c: 0x3fa8ff, r: 230, period: 5200, flicker: false, z: -40, k: 0.5 });
      if (urgent) lights.push({ x: cx, y: cy, c: STATE_TILE[urgent as keyof typeof STATE_TILE] ?? 0xffffff, r: 90, period: PULSE_MS[urgent as keyof typeof PULSE_MS] ?? 1800, flicker: false, z: 4.1, k: 0.9 });
    }
    const glance = paintGlance(l);
    const pill = paintPill(l);
    const glanceKey = `hud:glance:${JSON.stringify(l.counts)}`;
    const pillKey = `hud:pill:${pill.text}`;
    return {
      type: "agents",
      robots,
      sprites,
      lights,
      runners: [],
      hud: {
        panel: { ...(sent.has(glanceKey) ? { key: glanceKey } : (sent.add(glanceKey), { key: glanceKey, png: png(glance.canvas) })), w: glance.w, h: glance.h },
        pill: { ...(sent.has(pillKey) ? { key: pillKey } : (sent.add(pillKey), { key: pillKey, png: png(pill.canvas) })), w: pill.w, h: pill.h },
      },
    };
  };

  const relayout = () => {
    if (!data || !frames || destroyed) return;
    const next = layoutVillage(data, surface.aspect(), measure);
    const structural = layout?.signature !== next.signature;
    layout = next;
    try {
      const now = Date.now();
      if (structural) post({ ...sceneOf(next), rev: postRevision(watch, "scene", now) });
      post({ ...agentsOf(next), rev: postRevision(watch, "agents", now) });
      postedAt = now;
    } catch (error) {
      console.error(error);
      handlers.error?.("The Village could not be drawn. Reload to retry.");
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

  void (async () => {
    try {
      await document.fonts?.load(`${BOLD} 20px ${FONT}`).catch(() => undefined);
      const built = await buildFrames();
      if (destroyed) return;
      frames = built.canvases;
      realFrames = built.real;
      post({
        type: "art",
        scene: "village",
        frames: [...frames].map(([name, canvas]) => ({ name, png: png(canvas), w: FRAMES[name]!.w, h: FRAMES[name]!.h })),
        tiles: {},
        constants: {
          maxZoom: MAX_ZOOM * 1.4,
          hover: HOVER_COLOR,
          droneOrbit: 6000,
          sizes: Object.fromEntries(Object.entries(FRAMES).map(([n, f]) => [n, [f.w, f.h]])),
        },
        reduced,
      });
      surface.viewport();
      relayout();
    } catch (error) {
      handlers.error?.(error instanceof Error ? error.message : "Could not prepare the Village.");
    }
  })();

  return {
    kind: "village",
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
            scene: "village",
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
            status: statusLine(layout).text,
            realFrames: realFrames.size,
            squares: layout.squares.map((s) => ({ host: s.host.id, title: s.title, online: s.online, stats: s.stats.map((x) => x.text), rect: s.rect, fountain: s.fountain })),
            projects: layout.projects.map((p) => ({ id: p.entity?.id ?? p.key, name: p.name, icon: p.icon, building: p.building, rect: p.rect, lamps: p.lamps })),
            workspaces: layout.workspaces.map((w) => ({
              id: w.entity.id, name: w.entity.name, camp: !!w.entity.camp, rect: w.rect, tile: w.tile,
              flags: w.flags.map((f) => f.flag), medallions: w.flags.map((f) => ({ flag: f.flag, x: f.x, y: f.y })), seal: !!w.seal,
            })),
            agents: layout.agents.map((a) => ({ id: a.entity.id, name: a.entity.name, state: a.entity.state, model: a.entity.model, robot: a.robot, workspace: a.entity.workspace, at: a.feet, rect: a.rect, needsYou: NEEDS_YOU.includes(a.entity.state!) })),
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
