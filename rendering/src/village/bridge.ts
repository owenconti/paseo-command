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
  DASH_TILES,
  HALLS,
  dashText,
  NEEDS_YOU,
  STATE_MARK,
  V,
  layoutVillage,
  projectAlarm,
  projectWorking,
  statusLine,
  type DashCount,
  type Measure,
  type Rect,
  type VSquare,
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
/** A workspace plate's dot: green while an agent runs, amber when one needs you, red when one failed, grey idle or offline. */
const STATUS_DOT: Record<string, string> = { running: "#4cc35a", needs: "#f0a020", failed: "#e2493a", idle: "#a8a8b4", offline: "#6a6670" };
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
  paintCanopy(canvases);
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

/** The forest beyond the village, to every edge at any zoom: a seamless tile of overlapping crowns (the sheets' trees and
 * blossoms stamped with wrap-round on a dark understorey), which Swift repeats behind everything. */
function paintCanopy(canvases: Map<string, HTMLCanvasElement>) {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2c3f17";
  ctx.fillRect(0, 0, size, size);
  const crowns = ["tree-0", "tree-1", "tree-2", "tree-3", "tree-4", "tree-5", "tree-0", "tree-3", "blossom-0", "blossom-1"].map((n) => canvases.get(n)).filter((c): c is HTMLCanvasElement => !!c);
  if (!crowns.length) return;
  let seed = 7;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Rows of crowns, back to front, each shifted, so the canopy has depth and no gaps.
  for (let y = -120; y < size + 120; y += 70)
    for (let x = ((y / 70) % 2) * 60 - 60; x < size + 60; x += 110 + rnd() * 30) {
      const c = crowns[Math.floor(rnd() * crowns.length)]!;
      const w = 230 + rnd() * 90, h = (c.height * w) / c.width;
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) ctx.drawImage(c, x + dx - w / 2, y + dy - h * 0.7, w, h);
    }
  // A touch darker than the village's own trees, so the village reads in front.
  ctx.fillStyle = "rgba(14, 24, 6, 0.28)";
  ctx.fillRect(0, 0, size, size);
  canvases.set("forest-canopy", canvas);
  FRAMES["forest-canopy"] = { sheet: "generated", w: size / VILLAGE_PX, h: size / VILLAGE_PX, anchor: "top-left", tile: "xy" };
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
  /** The GitHub and Linear marks for the dashboard halls' banners, in the banner's cream (the app's own icons). */
  const paintMark = (mark: string) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(8, 8);
    ctx.fillStyle = ctx.strokeStyle = "#f6f0e2";
    if (mark === "mark-github") {
      // lucide's Github, as the app's Activity and GitHub pages draw it.
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D("M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"));
      ctx.stroke(new Path2D("M9 18c-4.51 2-5-2-7-2"));
    } else {
      // Linear's mark, as the session header's issue chip draws it.
      ctx.fill(new Path2D("M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"));
    }
    return canvas;
  };
  /** The fountain's plaque: a line per host (its name, a status dot, its machine's load; offline says so). */
  const paintHostPlaque = (r: Rect, hosts: VSquare["hosts"]) => {
    const { canvas, ctx } = canvasFor(r.w, r.h);
    threeSlice(ctx, frame, realFrames, 0, 0, r.w, r.h);
    // Each host a block: its name, then a status dot and its load (offline says so); stacked.
    const n = Math.max(1, hosts.length);
    // Clear of the scroll's rolled top and bottom edges.
    const pad = n > 1 ? r.h * 0.13 : 0;
    const blockH = (r.h - 2 * pad) / n;
    hosts.forEach((h, i) => {
      const top = pad + i * blockH;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.font = fontOf("host");
      ctx.fillStyle = INK;
      ctx.fillText(fitText(h.title, fontOf("host"), r.w - 60), r.w / 2, top + blockH * 0.38);
      const parts = h.stats.length ? h.stats.flatMap((s, k) => (k ? [{ text: " · ", alert: false }, s] : [s])) : [{ text: h.online ? "No load reading" : "Offline", alert: false }];
      ctx.font = fontOf("stats");
      const widths = parts.map((p) => ctx.measureText(p.text).width);
      const dot = 9;
      let x = r.w / 2 - (widths.reduce((s, w) => s + w, 0) + dot + 6) / 2;
      const y = top + blockH * 0.72;
      ctx.fillStyle = h.online ? "#3fb44a" : "#8a8478";
      ctx.beginPath();
      ctx.arc(x + dot / 2, y, dot / 2, 0, Math.PI * 2);
      ctx.fill();
      x += dot + 6;
      ctx.textAlign = "left";
      parts.forEach((p, k) => {
        ctx.fillStyle = p.alert ? ALERT : INK;
        ctx.fillText(p.text, x, y + 0.5);
        x += widths[k]!;
      });
    });
    return canvas;
  };

  /** The HUD's "At a Glance" panel: dark wood, gold corners, in screen points. */
  const paintGlance = (l: VillageLayout) => {
    const c = l.counts;
    type Row = { dot: string; name: string; n: number | string };
    const dashRows = (d: DashCount, hall: "prs" | "issues"): Row[] =>
      DASH_TILES[hall].map((t) => ({ dot: TILE_DOT[t.tile]!, name: t.name, n: dashText(d, t.key) }));
    const sections: { icon: string; title: string; n: number | string; rows: Row[] }[] = [
      { icon: "icon-pr", title: "PRs", n: dashText(c.prs), rows: dashRows(c.prs, "prs") },
      { icon: "icon-issue", title: "Issues", n: dashText(c.issues), rows: dashRows(c.issues, "issues") },
      { icon: "icon-workspaces", title: "Workspaces", n: c.workspaces, rows: [{ dot: "#4cc35a", name: "Active", n: c.active }] },
      {
        icon: "icon-agents", title: "Agents", n: c.agents,
        rows: [
          { dot: "#4cc35a", name: "Running", n: c.running },
          // Finished agents whose reply you haven't read are idle too.
          { dot: "#9a9aa8", name: "Idle", n: c.idle + c.unread },
          ...(c.needYou ? [{ dot: "#ef9b1b", name: "Need you", n: c.needYou }] : []),
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
  // `others` are the other paved areas: no edge is drawn where the paving runs on into them, and `open` sides (a road's end
  // into the forest or onto the bridge) get none either, so grass shows only on the paving's true outer boundary.
  const paving = (r: Rect, z: number, extra: Sprite, others: Rect[] = [], open: string[] = []): Sprite[] => {
    // The warm paving where the sheets have it, else the first.
    const stone = realFrames.has("cobble-warm") && realFrames.has("cobble-warm-edge-n") ? "cobble-warm" : "cobble";
    const P = FRAMES[`${stone}-edge-n`]!.w;
    const e = Math.min(56, r.w / 2, r.h / 2);
    const k = e / P;
    // Toned down from the sheet's bright gold toward the concept's warm grey-brown; lamp pools and the vignette make the bright spots.
    // The warm paving, nudged toward the concept's tan-brown (a light warm tint, never darker).
    const tone = stone === "cobble" ? { shade: PAVE_SHADE, ...extra } : extra;
    // The cobbles only: the paving's boundary is hidden under the greenery the layout crowds along it (`hedge`), so no
    // straight strip of edge pieces shows (their moss line read as a seam).
    const out: Sprite[] = [tile(stone, r, z, tone)];
    void others; void open; void P; void k; void e;
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
      // The plaza, then the north road (open into the forest at its top) and the south road (open onto the bridge).
      sq.roads.forEach((r, i) => sprites.push(...paving(r, -57, dim, sq.roads.filter((_, j) => j !== i), i === 1 ? ["n"] : i === 2 ? ["s"] : [])));
      const warm = realFrames.has("cobble-warm-blob");
      sprites.push(sprite(warm ? "cobble-warm-blob" : "cobble-blob", sq.plaza, -56.9, { ...(warm ? {} : { shade: PAVE_SHADE }), ...dim }));
      // A larger, lighter ring of radial stones round the fountain, under its own ring.
      const big = { x: sq.ring.x - sq.ring.w * 0.25, y: sq.ring.y - sq.ring.h * 0.25, w: sq.ring.w * 1.5, h: sq.ring.h * 1.5 };
      sprites.push(sprite("plaza-ring", big, -56.5, { c: 0xfff0d0, cf: 0.3, a: 0.9, ...dim }));
      sprites.push(sprite("plaza-ring", sq.ring, -56, dim));
      sprites.push(sprite(sq.online ? "fountain-on" : "fountain-off", sq.fountain, standZ(l, sq.fountain.y + sq.fountain.h), { ...dim, e: "vfountain" }));
      if (sq.online) {
        const basin = at("water-ripple", sq.center.x, sq.fountain.y + sq.fountain.h * 0.74, sq.fountain.w * 0.7);
        sprites.push(sprite("water-ripple", basin, standZ(l, sq.fountain.y + sq.fountain.h) + 0.01, { a: 0.8 }));
      }
      images.push({
        ...image(`hostplaque:${JSON.stringify(sq.hosts)}:${sq.plaque.w}:${sq.plaque.h}`, () => paintHostPlaque(sq.plaque, sq.hosts)),
        x: sq.plaque.x, y: sq.plaque.y, w: sq.plaque.w, h: sq.plaque.h, z: 3, ...dim,
      });
    });
    for (const p of l.projects) {
      const dim = { ...dimOf(p.square), ...(p.stale ? { a: 0.75 } : {}) };
      const z = standZ(l, p.base);
      // `e`: the entity whose hover or selection makes this sprite glow (Swift).
      sprites.push(sprite(p.building, p.body, z, { ...dim, e: `v${p.key}` }));
      // Its contact shadow on the paving, and its lit windows (while its host is online).
      images.push({ ...image("shadow:contact", paintContact), x: p.body.x - p.body.w * 0.02, y: p.base - 46, w: p.body.w * 1.04, h: 92, z: z - 0.01, a: 0.75 });
      if (l.squares[p.square]!.online)
        for (let k = 0; k < 4; k++)
          lights.push({ x: p.body.x + p.body.w * (0.21 + 0.19 * k), y: p.body.y + p.body.h * 0.52, c: 0xffa63a, r: 52, period: 3800, flicker: false, ph: k / 4, z: z + 0.004, k: 0.8 });
      // No banner: a hall says what it is in its hover card.
      // The porch, before the arcade: its ends and a tiled middle.
      if (p.ledge) {
        // A shallow stone ledge as wide as the hall, the robots' heads at its base.
        // The workshop's raised platform (the deep porch pieces), else the shallow ledge.
        const piece = p.hall !== "agents" && realFrames.has("porch-ledge-mid") ? "porch-ledge" : "porch";
        for (const [i, r] of p.porches.entries()) {
          const pz = i ? standZ(l, r.y + r.h) - 0.01 : z + 0.0005;
          const ph = r.h, lw = (FRAMES[`${piece}-left`]!.w * ph) / FRAMES[`${piece}-left`]!.h, rw = (FRAMES[`${piece}-right`]!.w * ph) / FRAMES[`${piece}-right`]!.h;
          sprites.push(sprite(`${piece}-left`, { x: r.x, y: r.y, w: lw, h: ph }, pz, dim));
          sprites.push(tile(`${piece}-mid`, { x: r.x + lw, y: r.y, w: Math.max(0, r.w - lw - rw), h: ph }, pz - 0.0001, dim));
          sprites.push(sprite(`${piece}-right`, { x: r.x + r.w - rw, y: r.y, w: rw, h: ph }, pz, dim));
        }
      } else {
        // Its foundation steps down onto the paving.
        sprites.push(sprite("foundation-steps", at("foundation-steps", p.body.x + p.body.w / 2, p.base + V.steps - 4, p.body.w * 0.9), z + 0.0005, dim));
      }
      // No name plaque: as on the Islands map, only hosts are labelled; a hall's name is in its hover card.
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
        sprites.push(sprite("tile-frame", w.frame, 2, { ...dim, e: w.entity.id }));
        sprites.push(sprite(`tile-${w.tile}`, at(`tile-${w.tile}`, w.tileAt.x, w.tileAt.y, w.tileSize), 2.1, { ...dim, e: w.entity.id }));
      }
      // Its agents' state as a small lit dot on the frame's carved sill (its name is in its hover card).
      const dot = parseInt(STATUS_DOT[w.status]!.slice(1), 16);
      const dotAt = { x: w.tileAt.x, y: w.frame.y + w.frame.h * 0.86 };
      sprites.push({ ...sprite("dot", at("dot", dotAt.x, dotAt.y, 14), 2.4, dim), c: dot, cf: 1 });
      if (w.status !== "idle" && w.status !== "offline") lights.push({ ...dotAt, c: dot, r: 16, period: 2400, flicker: false, ph: 0, z: 2.35, k: 0.8 });
      // The arch's lamp-lit interior behind the tile.
      if (l.squares[w.square]!.online && !w.entity.camp) lights.push({ x: w.tileAt.x, y: w.frame.y + 6, c: 0xffb860, r: 44, period: 3200, flicker: false, ph: random(seedOf(w.entity.id))(), z: -0.5, k: 0.3 });
    }
    // The dashboard halls' tiles: their counts on their plates, dim with "—" while the hall can't count.
    for (const t of l.tiles) {
      const d = t.hall === "prs" ? l.counts.prs : l.counts.issues;
      const shade = d.known ? {} : { a: 0.55 };
      sprites.push(sprite(`tile-${t.tile}`, at(`tile-${t.tile}`, t.tileAt.x, t.tileAt.y, t.tileSize), 2.1, { ...shade, e: t.id }));
      sprites.push(sprite("tile-frame", t.frame, 2, { ...shade, e: t.id }));
      // Its count is in its hover card (and the At a Glance panel), not on the map; the frame's sill closes it.
      lights.push({ x: t.tileAt.x, y: t.frame.y + 6, c: 0xffb860, r: 44, period: 3200, flicker: false, ph: random(seedOf(t.id))(), z: -0.5, k: d.known ? 0.3 : 0.1 });
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
      // What the HUD's panel must never cover: every tile.
      clear: [...l.tiles.map((t) => t.frame), ...l.workspaces.map((w) => w.frame)].map((r) => [r.x, r.y, r.w, r.h]),
      sprites,
      images,
      lights,
      flags,
      entities: [
        ...l.agents.map((a) => ({ id: a.entity.id, kind: "agent", ...a.rect })),
        ...l.workspaces.map((w) => ({ id: w.entity.id, kind: "workspace", ...w.rect })),
        // The dashboard tiles: hover cards and clicks the page answers (never a selection).
        ...l.tiles.map((t) => ({ id: t.id, kind: "tile", ...t.rect })),
        // The halls themselves, for their hover cards (picked after their tiles: "vhall" sorts after "tile").
        ...l.projects.map((p) => ({ id: `v${p.key}`, kind: "tile", ...p.rect })),
        // The fountain: the fleet, its card listing the hosts.
        ...l.squares.map((s) => ({ id: "vfountain", kind: "tile", ...s.fountain })),
      ],
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
        sprites.push(sprite(lit ? "lamp-on" : "lamp-off", at("lamp-on", lamp.x, lamp.y, 52), bridgeZ, sq.online ? {} : { dim: 1 }));
        if (lit) lights.push({ x: lamp.x, y: lamp.y - 50, c: 0xffb050, r: 80, period: 2600, flicker: true, ph: random(seedOf(`${sq.host.id}b${lamp.x}`))(), k: 0.9 });
      }
      // Lamps either side of the fountain (no banners).
      for (const p of sq.pennants) {
        sprites.push(sprite(lit ? "lamp-on" : "lamp-off", at("lamp-on", p.x, p.y, 34), standZ(l, p.y), sq.online ? {} : { dim: 1 }));
        if (lit) lights.push({ x: p.x, y: p.y - FRAMES["lamp-on"]!.h * (34 / FRAMES["lamp-on"]!.w) + 14, c: 0xffc46a, r: 60, period: 2600, flicker: true, ph: random(seedOf(`${sq.host.id}${p.x}`))(), k: 0.9 });
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
      if (alarm) lights.push({ x: p.body.x + p.body.w / 2, y: p.body.y + p.body.h * 0.2, c: STATE_TILE[alarm]!, r: 70, period: alarm === "failed" ? 1200 : 1800, flicker: false, z: -0.5, ph: 0 });
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

  const tileOf = (id: string) => layout?.tiles.find((t) => t.id === id);
  const dashOf = (hall: "prs" | "issues") => data?.dashboard?.[hall] ?? null;
  /** A dashboard tile's card: its group and count, then its PRs (title, repo#n) or issues (key, title), or why it can't count. */
  const cardOf = (t: NonNullable<ReturnType<typeof tileOf>>) => {
    const spec = DASH_TILES[t.hall].find((x) => x.key === t.key)!;
    const d = dashOf(t.hall);
    const what = t.hall === "prs" ? "Your pull requests" : "Your Linear issues";
    if (d?.state !== "ok") return { title: spec.name, detail: what, lines: [d?.message ?? (t.hall === "prs" ? "Turn on GitHub in Settings to count your pull requests." : "Turn on Linear in Settings to count your issues.")] };
    const n = d.counts?.[t.key] ?? 0;
    const plus = d.atLeast?.includes(t.key) ? "+" : "";
    const items = d.items?.[t.key] ?? [];
    const lines = items.map((i) => (t.hall === "prs" ? `${i.title} · ${i.repo}#${i.number}` : `${i.id} ${i.title}`));
    if (n > items.length) lines.push(`and ${n - items.length}${plus} more`);
    const span = t.hall === "prs" && t.key === "merged" ? " (last 14 days)" : t.hall === "issues" && t.key === "done" ? " (last 14 days)" : "";
    return { title: `${spec.name} · ${n}${plus}`, detail: `${what}${span}`, lines: lines.length ? lines : ["None"] };
  };
  /** A hall's card: its name and what it holds, as the At a Glance panel counts it. */
  const hallCard = (hall: string) => {
    const c = layout!.counts;
    const spec = HALLS.find((h) => h.hall === hall)!;
    const dash = (d: DashCount, which: "prs" | "issues") =>
      d.known ? DASH_TILES[which].map((t) => `${t.name}: ${dashText(d, t.key)}`) : [d.why || "Not counted"];
    if (hall === "prs") return { title: spec.name, detail: c.prs.known ? `Your pull requests · ${dashText(c.prs)}` : "Your pull requests", lines: dash(c.prs, "prs") };
    if (hall === "issues") return { title: spec.name, detail: c.issues.known ? `Your Linear issues · ${dashText(c.issues)}` : "Your Linear issues", lines: dash(c.issues, "issues") };
    if (hall === "workspaces") return { title: spec.name, detail: `${c.workspaces} workspace${c.workspaces === 1 ? "" : "s"} · ${c.active} active`, lines: layout!.workspaces.map((w) => w.entity.name) };
    return {
      title: spec.name,
      detail: `${c.agents} agent${c.agents === 1 ? "" : "s"}`,
      lines: [`Running: ${c.running}`, `Idle: ${c.idle + c.unread}`, ...(c.needYou ? [`Need you: ${c.needYou}`] : []), ...(c.failed ? [`Failed: ${c.failed}`] : []), ...(c.offline ? [`Offline: ${c.offline}`] : [])],
    };
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
      if (message.id?.startsWith("vhall:") || message.id === "vfountain") return;
      if (message.id?.startsWith("tile:")) {
        // A dashboard tile opens its first PR or issue, as the app opens such links.
        const t = tileOf(message.id);
        const url = t && dashOf(t.hall)?.items?.[t.key]?.[0]?.url;
        if (url) handlers.open?.(url);
        return;
      }
      handlers.pick?.(entity(message.id));
    } else if (message.type === "hover") {
      parent.style.cursor = message.id ? "pointer" : "";
      if (message.id?.startsWith("vhall:") || message.id === "vfountain") {
        if (hovered) setHover(null);
        const p = layout?.projects.find((x) => `v${x.key}` === message.id);
        const sq = layout?.squares[0];
        const card = p ? hallCard(p.hall) : sq ? { title: "The fleet", detail: `${sq.hosts.length} host${sq.hosts.length === 1 ? "" : "s"}`, lines: sq.hosts.map((h) => `${h.title}${h.stats.length ? ` · ${h.stats.map((x) => x.text).join(" · ")}` : ""}`) } : null;
        handlers.card?.(card, message.x === undefined ? null : { x: message.x, y: message.y! });
        return;
      }
      if (message.id?.startsWith("tile:")) {
        if (hovered) setHover(null);
        const t = tileOf(message.id);
        handlers.card?.(t ? cardOf(t) : null, message.x === undefined ? null : { x: message.x, y: message.y! });
        return;
      }
      handlers.card?.(null, null);
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
            squares: layout.squares.map((s) => ({ hosts: s.hosts.map((h) => ({ id: h.id, title: h.title, online: h.online, stats: h.stats.map((x) => x.text) })), rect: s.rect, fountain: s.fountain, river: s.river })),
            tiles: layout.tiles.map((t) => ({ id: t.id, rect: t.rect })),
            projects: layout.projects.map((p) => ({ id: p.entity?.id ?? p.key, name: p.name, icon: p.icon, building: p.building, rect: p.rect, lamps: p.lamps })),
            workspaces: layout.workspaces.map((w) => ({
              id: w.entity.id, name: w.entity.name, label: w.label, status: w.status, camp: !!w.entity.camp, rect: w.rect, tile: w.tile,
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
