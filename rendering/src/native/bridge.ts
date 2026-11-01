/**
 * The Atlas drawn by the native macOS app (`native/`, SpriteKit). Inside its
 * web view, this is the world the page mounts: it lays the fleet out and
 * paints the artwork with the shared Atlas modules, then posts the result to
 * Swift, which only draws. The map's pointer, wheel and keys
 * are forwarded to Swift, which owns the camera, hover and picking and
 * answers through `paseo:world` events. Nothing here sends daemon actions.
 */
import {
  footprint,
  insideFootprint,
  landBounds,
  point,
  layoutAtlas,
  seedOf,
  type AtlasData,
  type AtlasLayout,
  type Entity,
} from "../world";
import { buildFrames, flagFrames, frameName, propFrames, type Frame } from "../art";
import { AUTO_MERGE, PR_LABELS, type MapFlag } from "../prStatus";
import { probeGlyph, probeState, type ProbeVerdict } from "../probe";
import { cloudsTile, glintsTile, terrainParts, waterTile, type Piece, type Tiles } from "../terrain";
import {
  DRONE_ORBIT,
  FLAG_SWAY,
  placeFlags,
  placeProbes,
  placeSeals,
  MEDALLION,
  AUTO_MERGE_SEAL,
  DRONE_SIZE,
  HOVER_COLOR,
  PROP_WIDTH,
  artMask,
  campFlags,
  labels,
  lights,
  locations,
  placeStructures,
  plaza,
  robots,
  tiles,
  type Label,
  type Placed,
  type Signal,
} from "../placement";
import {
  LABEL_FONT,
  RIBBON_BODY_RADIUS,
  RIBBON_DETAIL,
  RIBBON_HIGHLIGHT,
  RIBBON_SHADOW,
  RIBBON_STROKE,
  fitCaption,
  ribbonFont,
  ribbonShape,
} from "../ribbon";
import { MAX_ZOOM, OVERLAY_BOTTOM, OVERLAY_TOP } from "../camera";
import { WALK_SPEED, TURN_SPEED, WANDER_X, WANDER_Y } from "../wander";
import { HEX_RADIUS, ROBOT_SIZE } from "../world";
import PROPS from "../assets/props.json";
import buildingsUrl from "../assets/buildings.png";
import structuresUrl from "../assets/structures.png";
import robotsUrl from "../assets/robots.png";
import foliageUrl from "../assets/tree-v2.png";
import sandUrl from "../assets/sand.png";
import dirtUrl from "../assets/dirt.png";
import propsUrl from "../assets/props.png";
import flagsUrl from "../assets/medallions.png";
import type { AtlasHandlers, AtlasWorld } from "../atlas";

type Channel = { postMessage(message: unknown): void };
const channel = (): Channel | undefined =>
  (window as unknown as { webkit?: { messageHandlers?: { paseoWorld?: Channel } } }).webkit
    ?.messageHandlers?.paseoWorld;
/** Whether this page runs inside the native app, which draws the Atlas itself. */
export const nativeWorldAvailable = () => typeof window !== "undefined" && !!channel();

/** Banners are painted at this many pixels per world pixel, so they stay
 * crisp at the closest zoom on a Retina display. */
const BANNER_SCALE = 5;
/** Sprite frames and the sea's tiles, sent once per page. */
type Art = { frames: Map<string, Frame>; tiles: Tiles; masks: Map<string, ImageData> };

const load = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}. Reload the world to retry.`));
    image.src = url;
  });

function crop(frame: Frame): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  canvas.getContext("2d")!.drawImage(frame.canvas, frame.x, frame.y, frame.width, frame.height, 0, 0, frame.width, frame.height);
  return canvas;
}
const png = (canvas: HTMLCanvasElement) => canvas.toDataURL("image/png");
/** A copy with its colour multiplied by `tint` (a multiplicative tint, which
 * SpriteKit has no exact equivalent for, so tints are baked in). */
function tinted(canvas: HTMLCanvasElement, tint: number): HTMLCanvasElement {
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0);
  const image = ctx.getImageData(0, 0, copy.width, copy.height);
  const [r, g, b] = [(tint >> 16) & 255, (tint >> 8) & 255, tint & 255];
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = (image.data[i]! * r) / 255;
    image.data[i + 1] = (image.data[i + 1]! * g) / 255;
    image.data[i + 2] = (image.data[i + 2]! * b) / 255;
  }
  ctx.putImageData(image, 0, 0);
  return copy;
}
/** An item's soft shadow under a noon sun: its silhouette, blurred by `blur`
 * and padded by `pad` (shares of its width) on every side, centred beneath it
 * and drawn `spread` world px wider all round, so it shows evenly on every
 * side and never turns as a robot does. */
const SHADOW = { pad: 0.1, blur: 0.04, alpha: 0.5, spread: 3 };
function shadowOf(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const pad = Math.ceil(canvas.width * SHADOW.pad);
  const silhouette = document.createElement("canvas");
  silhouette.width = canvas.width;
  silhouette.height = canvas.height;
  const s = silhouette.getContext("2d")!;
  s.drawImage(canvas, 0, 0);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = "rgb(24,18,10)";
  s.fillRect(0, 0, canvas.width, canvas.height);
  const copy = document.createElement("canvas");
  copy.width = canvas.width + pad * 2;
  copy.height = canvas.height + pad * 2;
  const ctx = copy.getContext("2d")!;
  // Blurred by stacking faint copies over a disc (WebKit's canvas has no
  // filter, and ignores shadowBlur here).
  const radius = canvas.width * SHADOW.blur,
    samples: [number, number][] = [[0, 0]];
  for (const ring of [0.5, 1])
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + ring;
      samples.push([Math.cos(a) * radius * ring, Math.sin(a) * radius * ring]);
    }
  ctx.globalAlpha = (SHADOW.alpha * 2.2) / samples.length;
  for (const [dx, dy] of samples) ctx.drawImage(silhouette, pad + dx, pad + dy);
  return copy;
}
/** Whether a frame casts a shadow: every item on the map, but not a robot's
 * separate parts (its whole frame casts it) or the unused garden art. */
const casts = (name: string) => !/(-body|-hand-l|-hand-r)$|^(trees|shrub|rocks)$/.test(name);

/** An offline robot's grey (see AtlasScene's `agent`). */
const OFFLINE_TINT = 0x9c9a92;

/** A banner painted from `ribbonShape`, on a canvas
 * `BANNER_SCALE` times its world size; `caption` is the caption's world box,
 * which the plaza's props keep clear of. */
function paintBanner(label: Label) {
  const font = ribbonFont(label.kind);
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `${font.weight} ${font.size}px ${LABEL_FONT}`;
  const widthOf = (s: string) =>
    [...s].reduce((w, c) => w + measure.measureText(c).width, 0) + font.letterSpacing * Math.max(0, [...s].length - 1);
  const text = fitCaption(label.text, label.maxWidth, (s) => (font.letterSpacing ? widthOf(s) : measure.measureText(s).width));
  const captionWidth = font.letterSpacing ? widthOf(text) : measure.measureText(text).width;
  const probe = measure.measureText("|MÉqgy");
  const ascent = probe.actualBoundingBoxAscent,
    descent = probe.actualBoundingBoxDescent;
  // A host's load, as a second line set smaller under its name.
  const detailFont = `${RIBBON_DETAIL.weight} ${RIBBON_DETAIL.size}px ${LABEL_FONT}`;
  const parts = label.detail?.flatMap((part, i) =>
    i ? [{ text: RIBBON_DETAIL.separator, alert: false }, part] : [part],
  );
  measure.font = detailFont;
  const detailWidth = parts?.reduce((w, part) => w + measure.measureText(part.text).width, 0);
  measure.font = `${font.weight} ${font.size}px ${LABEL_FONT}`;
  const shape = ribbonShape(label.kind, captionWidth, label.faded, detailWidth);
  // The name rises by half the second line, which sits below it.
  const lift = parts ? RIBBON_DETAIL.extra / 2 : 0;
  // World box around (0, 0): the tails reach 19 past the body, the shadow and tails' feet below.
  const left = -shape.width / 2 - 21,
    top = -shape.height / 2 - 2,
    width = shape.width + 42,
    height = shape.height + 14;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * BANNER_SCALE);
  canvas.height = Math.ceil(height * BANNER_SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(BANNER_SCALE, BANNER_SCALE);
  ctx.translate(-left, -top);
  const rgba = (color: number, alpha = 1) =>
    `rgba(${(color >> 16) & 255},${(color >> 8) & 255},${color & 255},${alpha})`;
  const rounded = (b: { x: number; y: number; width: number; height: number }, r: number) => {
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.width, b.height, r);
  };
  rounded(shape.shadow, RIBBON_SHADOW.radius);
  ctx.fillStyle = rgba(RIBBON_SHADOW.color, RIBBON_SHADOW.alpha);
  ctx.fill();
  ctx.lineJoin = "round";
  for (const tail of shape.tails) {
    ctx.beginPath();
    tail.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = rgba(shape.tailFill);
    ctx.fill();
    ctx.lineWidth = RIBBON_STROKE.tail;
    ctx.strokeStyle = rgba(shape.stroke);
    ctx.stroke();
  }
  rounded(shape.body, RIBBON_BODY_RADIUS);
  ctx.fillStyle = rgba(shape.fill);
  ctx.fill();
  ctx.lineWidth = RIBBON_STROKE.body;
  ctx.strokeStyle = rgba(shape.stroke);
  ctx.stroke();
  const inset = RIBBON_HIGHLIGHT.inset;
  ctx.beginPath();
  ctx.moveTo(shape.body.x + inset, shape.body.y + inset);
  ctx.lineTo(shape.body.x + shape.body.width - inset, shape.body.y + inset);
  ctx.lineWidth = RIBBON_HIGHLIGHT.width;
  ctx.strokeStyle = rgba(RIBBON_HIGHLIGHT.color, RIBBON_HIGHLIGHT.alpha);
  ctx.stroke();
  ctx.font = measure.font;
  ctx.fillStyle = shape.text;
  ctx.textBaseline = "alphabetic";
  const baseline = -(ascent + descent) / 2 + ascent - lift;
  if (font.letterSpacing) {
    let x = -captionWidth / 2;
    for (const c of text) {
      ctx.fillText(c, x, baseline);
      x += measure.measureText(c).width + font.letterSpacing;
    }
  } else {
    ctx.textAlign = "center";
    ctx.fillText(text, 0, baseline);
  }
  if (parts && detailWidth !== undefined) {
    ctx.font = detailFont;
    ctx.textAlign = "left";
    let x = -detailWidth / 2;
    const detailBaseline = shape.body.y + shape.body.height - 10;
    for (const part of parts) {
      ctx.fillStyle = label.faded ? shape.text : part.alert ? RIBBON_DETAIL.alert : RIBBON_DETAIL.text;
      ctx.fillText(part.text, x, detailBaseline);
      x += ctx.measureText(part.text).width;
    }
  }
  return {
    canvas,
    x: label.x + left,
    y: label.y + top,
    width,
    height,
    caption: {
      x: label.x - captionWidth / 2,
      y: label.y - (ascent + descent) / 2 - lift,
      width: captionWidth,
      height: ascent + descent,
    },
  };
}

/** Probe's medallion for a verdict, painted to sit beside the PR ones: a
 * riveted brass rim round enamel in the verdict's colour, Probe's mark in a
 * cream ring, and a cream badge on its lower-right rim carrying a glyph (or the
 * open findings' count). Its world box is `MEDALLION.size` square, centred,
 * plus `pad` all round for its soft shadow. */
function paintProbe(verdict: ProbeVerdict) {
  const size = MEDALLION.size;
  const pad = 4;
  const glyph = probeGlyph(verdict);
  const color = probeState(verdict.state).color;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil((size + pad * 2) * BANNER_SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(BANNER_SCALE, BANNER_SCALE);
  ctx.translate(pad, pad);
  const rgba = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
  const shade = (c: number, k: number) =>
    (Math.round(Math.min(255, ((c >> 16) & 255) * k)) << 16) |
    (Math.round(Math.min(255, ((c >> 8) & 255) * k)) << 8) |
    Math.round(Math.min(255, (c & 255) * k));
  const disc = (x: number, y: number, r: number) => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
  };
  const c = size / 2,
    r = size / 2 - 0.6;
  // Its shadow, centred beneath it under the noon sun.
  ctx.save();
  disc(c, c, r);
  ctx.shadowColor = rgba(RIBBON_SHADOW.color, 0.45);
  ctx.shadowBlur = 3 * BANNER_SCALE;
  ctx.fillStyle = rgba(RIBBON_SHADOW.color, 0.45);
  ctx.fill();
  ctx.restore();
  // The brass rim, its rivets, and a dark line where the enamel meets it.
  disc(c, c, r);
  const brass = ctx.createRadialGradient(c - r * 0.4, c - r * 0.45, r * 0.2, c, c, r);
  brass.addColorStop(0, rgba(0xf0cf7a));
  brass.addColorStop(1, rgba(0x9c7428));
  ctx.fillStyle = brass;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.strokeStyle = rgba(0x3b2a12);
  ctx.stroke();
  const rim = r * 0.17;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    disc(c + Math.cos(a) * (r - rim / 2), c + Math.sin(a) * (r - rim / 2), rim * 0.26);
    ctx.fillStyle = rgba(0xc89a3c);
    ctx.fill();
    ctx.lineWidth = 0.35;
    ctx.strokeStyle = rgba(0x5a4018);
    ctx.stroke();
  }
  const field = r - rim;
  disc(c, c, field);
  const enamel = ctx.createRadialGradient(c - field * 0.35, c - field * 0.4, field * 0.1, c, c, field);
  enamel.addColorStop(0, rgba(shade(color, 1.18)));
  enamel.addColorStop(1, rgba(shade(color, 0.85)));
  ctx.fillStyle = enamel;
  ctx.fill();
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = rgba(0x3b2a12);
  ctx.stroke();
  // An original magnifying glass signifies review without copying a bot avatar.
  const lensX = c - field * 0.12, lensY = c - field * 0.12;
  disc(lensX, lensY, field * 0.4);
  ctx.lineWidth = field * 0.15;
  ctx.strokeStyle = rgba(0xf6ecd2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(lensX + field * 0.29, lensY + field * 0.29);
  ctx.lineTo(c + field * 0.52, c + field * 0.52);
  ctx.lineCap = "round";
  ctx.stroke();
  // The verdict's badge, on the lower-right rim.
  const badgeR = size * 0.2,
    bx = c + (r - badgeR * 0.55) * Math.SQRT1_2,
    by = c + (r - badgeR * 0.55) * Math.SQRT1_2;
  disc(bx, by, badgeR);
  ctx.fillStyle = rgba(0xf6ecd2);
  ctx.fill();
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = rgba(0x3b2a12);
  ctx.stroke();
  ctx.font = `bold ${badgeR * (glyph.length > 1 ? 1.15 : 1.45)}px ${LABEL_FONT}`;
  ctx.fillStyle = rgba(shade(color, 0.8));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(glyph, bx, by + badgeR * 0.08);
  return { canvas, width: size + pad * 2, height: size + pad * 2, pad };
}
const probeKey = (v: ProbeVerdict) => `streamer:probe:${v.state}:${probeGlyph(v)}`;

/** The auto-merge seal crowning a flag's pole: a teal medallion in a gold
 * rim carrying a cream merge mark. Its world box is `AUTO_MERGE_SEAL.size`
 * square, plus room for its shadow. */
function paintSeal() {
  const size = AUTO_MERGE_SEAL.size;
  const pad = 1.5;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = Math.ceil((size + pad) * BANNER_SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(BANNER_SCALE, BANNER_SCALE);
  const rgba = (c: number, a = 1) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
  const r = size / 2 - 0.8,
    c = size / 2;
  ctx.beginPath();
  ctx.arc(c + 1, c + 1.2, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(RIBBON_SHADOW.color, 0.32);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  const fill = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r);
  fill.addColorStop(0, rgba(0x2fb3a6));
  fill.addColorStop(1, rgba(AUTO_MERGE.color));
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = rgba(0xd8a945);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, r - 1.5, 0, Math.PI * 2);
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = rgba(0xf6ecd2, 0.55);
  ctx.stroke();
  // The merge mark (two branches joining), on a 16-unit grid.
  const k = (r * 1.25) / 16;
  ctx.save();
  ctx.translate(c - 8 * k, c - 8 * k);
  ctx.scale(k, k);
  ctx.strokeStyle = rgba(0xf6ecd2);
  ctx.fillStyle = rgba(0xf6ecd2);
  ctx.lineWidth = 1.9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(4.5, 3);
  ctx.lineTo(4.5, 13);
  ctx.moveTo(4.5, 4);
  ctx.bezierCurveTo(4.5, 8.5, 8, 10, 11.5, 10);
  ctx.stroke();
  for (const [x, y] of [[4.5, 3], [4.5, 13], [11.5, 10]] as const) {
    ctx.beginPath();
    ctx.arc(x, y, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return { canvas, width: size + pad, height: size + pad };
}
const SEAL_KEY = "streamer:auto-merge";

type Message = Record<string, unknown> & { type: string };
type NativeEvent =
  | { type: "ready" }
  | { type: "pick"; id: string | null }
  | { type: "hover"; id: string | null; x?: number; y?: number; flag?: MapFlag }
  | { type: "zoom"; zoom: number }
  | { type: "state"; state: Record<string, unknown> }
  | { type: "error"; message: string };

/** Mount the native Atlas for `parent`, the React map surface. */
export function mountNativeAtlas(parent: HTMLElement, handlers: AtlasHandlers = {}): AtlasWorld {
  const post = (message: Message) => channel()?.postMessage(message);
  let destroyed = false;
  let ready = false;
  let art: Art | null = null;
  let data: AtlasData | null = null;
  let layout: AtlasLayout | null = null;
  let selection: string | null = null;
  let hovered: string | null = null;
  /** Where the hover card points, as Swift last reported it. */
  let hoverAt: { x: number; y: number } | undefined;
  /** The hovered workspace's PR flag under the pointer, as Swift last reported it. */
  let hoverFlag: MapFlag | undefined;
  let enabled = true;
  let reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let zoom = 1;
  /** What Swift last reported of itself, for `inspect`. */
  let nativeState: Record<string, unknown> = {};
  let builds = 0;
  /** Banner images Swift already holds, by content key. */
  const sent = new Set<string>();
  /** Terrain pieces Swift holds, by their `terrainParts` key. */
  const painted = new Map<string, Piece>();
  /** The PR flags last sent, for `inspect`. */
  let planted: ReturnType<typeof placeFlags> = [];
  /** Each project's lamps and beacon, placed with its plaza. */
  let signals = new Map<string, Signal[]>();
  const entity = (id: string | null) => (id && layout?.entities.find((e) => e.id === id)) || null;

  const aspect = () =>
    parent.clientWidth && parent.clientHeight ? parent.clientWidth / parent.clientHeight : 1.6;
  const sizeOf = (name: string) => {
    const frame = art!.frames.get(frameName(name))!;
    return { width: frame.width, height: frame.height };
  };
  const maskOf = (name: string) => {
    let mask = art!.masks.get(name);
    if (!mask) {
      const canvas = crop(art!.frames.get(name)!);
      mask = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, canvas.width, canvas.height);
      art!.masks.set(name, mask);
    }
    return mask;
  };

  /** Everything that only changes when cells change: terrain, buildings,
   * plaza props, camp flags, banners, and what each entity covers. */
  const sceneOf = (layout: AtlasLayout): Message => {
    // Terrain Swift already holds keeps its texture; only new pieces are painted.
    const pieces = terrainParts(layout, art!.tiles).map(({ key, paint }) => {
      let piece = painted.get(key);
      const fresh = !piece;
      if (!piece) painted.set(key, (piece = paint()));
      const canvas = piece.tint === undefined ? piece.canvas : tinted(piece.canvas, piece.tint);
      return { key, piece, png: fresh ? png(canvas) : undefined };
    });
    for (const key of [...painted.keys()]) if (!pieces.some((p) => p.key === key)) painted.delete(key);
    const placed = placeStructures(layout, sizeOf);
    const banners = labels(layout).map((label) => ({ label, art: paintBanner(label) }));
    planted = placeFlags(layout, sizeOf);
    const probes = placeProbes(layout);
    const seals = placeSeals(layout, planted);
    let seal: ReturnType<typeof paintSeal> | undefined;
    // Swift drops banners, Probe medallions and seals a scene leaves out, so one that returns is sent again.
    const shown = new Set([
      ...banners.map(({ label }) => `banner:${JSON.stringify(label)}`),
      ...probes.map((p) => probeKey(p.verdict)),
      ...(seals.length ? [SEAL_KEY] : []),
    ]);
    for (const key of [...sent]) if (!shown.has(key)) sent.delete(key);
    const sprites: Placed[] = [...placed];
    signals = new Map();
    layout.projects.forEach((p, i) => {
      const building = placed.find((s) => s.entity === p.id && s.footprint)!;
      const caption = banners[i]!.art.caption;
      const props = plaza(p, artMask(maskOf(building.frame), building), {
        // The ribbon's tails and shadow reach past its caption.
        x: caption.x - 34,
        y: caption.y - 8,
        width: caption.width + 68,
        height: caption.height + 20,
      }, sizeOf);
      sprites.push(...props.props);
      signals.set(p.id, props.signals);
    });
    const where = locations(layout);
    const landOf = (host: string) => layout.land.filter((m) => m.host === host).flatMap((m) => m.cells);
    const image = (key: string, canvas: HTMLCanvasElement) => {
      if (sent.has(key)) return undefined;
      sent.add(key);
      return png(canvas);
    };
    return {
      type: "scene",
      build: ++builds,
      bounds: landBounds(layout),
      pieces: pieces.map(({ piece, key, png }) => ({
        key,
        png,
        x: piece.x,
        y: piece.y,
        width: piece.width,
        height: piece.height,
        depth: piece.depth,
        alpha: piece.alpha ?? 1,
      })),
      sprites: sprites.flatMap((s) => {
        const sprite = {
          frame: frameName(s.frame),
          x: s.x,
          y: s.y,
          width: s.width,
          depth: s.depth,
          alpha: s.alpha,
          flipX: s.flipX,
        };
        if (!casts(sprite.frame)) return [sprite];
        // Its shadow, just beneath it, padded as `shadowOf` pads it.
        const shadow = {
          ...sprite,
          frame: `${sprite.frame}-shadow`,
          width: (s.width + 2 * SHADOW.spread) * (1 + 2 * SHADOW.pad),
          depth: s.depth - 0.4,
        };
        return [shadow, sprite];
      }),
      flags: campFlags(layout),
      // PR flags stand on their pole's foot, so the running CI one sways about it.
      prFlags: planted.map((f) => ({
        frame: f.frame,
        flag: f.flag,
        workspace: f.entity,
        x: f.x,
        y: f.y,
        width: f.width,
        depth: f.depth,
        alpha: f.alpha,
        sway: f.flag === "ci-running",
      })),
      banners: banners.map(({ label, art }) => {
        const key = `banner:${JSON.stringify(label)}`;
        return { key, png: image(key, art.canvas), x: art.x, y: art.y, width: art.width, height: art.height };
      }),
      // Probe's medallions, in their workspaces' first cells; one still reviewing
      // pulses. Swift draws them (and seals) from their top-left corner.
      streamers: [
        ...probes.map((p) => {
          const key = probeKey(p.verdict);
          const painted = paintProbe(p.verdict);
          return {
            key,
            png: image(key, painted.canvas),
            x: p.x - p.size / 2 - painted.pad,
            y: p.y - p.size / 2 - painted.pad,
            width: painted.width,
            height: painted.height,
            depth: p.depth,
            alpha: p.alpha,
            pulse: p.verdict.state === "reviewing",
            workspace: p.entity,
            // Its disc, for its hover card.
            probe: true,
            cx: p.x,
            cy: p.y,
            size: p.size,
          };
        }),
        // Auto-merge seals sit on their medallions' rims; Swift draws them as it does Probe's.
        ...seals.map((s) => {
          const painted = (seal ??= paintSeal());
          return {
            key: SEAL_KEY,
            png: image(SEAL_KEY, painted.canvas),
            x: s.x,
            y: s.y,
            width: painted.width,
            height: painted.height,
            depth: s.depth,
            alpha: s.alpha,
            pulse: false,
            workspace: s.entity,
          };
        }),
      ],
      entities: layout.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        cells: (e.kind === "host" ? landOf(e.id) : footprint(e)).map((c) => [c.q, c.r]),
        at: where.get(e.id),
      })),
    };
  };
  /** What changes with the agents' states: tiles, lit signals, robots. */
  const agentsOf = (layout: AtlasLayout): Message => ({
    type: "agents",
    tiles: tiles(layout),
    lights: lights(layout, signals).map((l) => ({ ...l, width: PROP_WIDTH[l.kind] })),
    robots: robots(layout).map((r) => ({ ...r, seed: seedOf(r.id + "walk"), droneSeed: seedOf(r.id + "drones") })),
  });
  const relayout = () => {
    if (!data || !art || destroyed) return;
    const next = layoutAtlas(data, aspect());
    const structural = layout?.signature !== next.signature;
    layout = next;
    try {
      if (structural) post(sceneOf(next));
      post(agentsOf(next));
    } catch (error) {
      console.error(error);
      handlers.error?.("The native world could not be drawn. Reload to retry.");
      return;
    }
    if (selection && !entity(selection)) selection = null;
    // A hover outlives an update: its card shows the entity's new state.
    if (hovered) setHover(entity(hovered) ? hovered : null, hoverAt, hoverFlag);
  };

  const setHover = (id: string | null, at?: { x: number; y: number }, flag?: MapFlag) => {
    hovered = id;
    hoverAt = id ? at : undefined;
    hoverFlag = id ? flag : undefined;
    const e = entity(id);
    handlers.hover?.(e, e && at ? at : null, e ? hoverFlag : undefined);
  };
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
    } else if (message.type === "error") handlers.error?.(message.message);
  };
  window.addEventListener("paseo:world", receive);

  // The map's rectangle in the page, so Swift can lay its view under it.
  let lastViewport = "";
  const viewport = () => {
    if (destroyed) return;
    const r = parent.getBoundingClientRect();
    lastViewport = `${r.x},${r.y},${r.width},${r.height}`;
    post({ type: "viewport", x: r.x, y: r.y, width: r.width, height: r.height });
  };
  // The map moves without resizing when the session panel changes sides: the root's
  // attributes say so (`data-panel-side`, `--unity-sidebar`). Only a real move is posted.
  const moved = new MutationObserver(() => {
    const r = parent.getBoundingClientRect();
    if (`${r.x},${r.y},${r.width},${r.height}` !== lastViewport) viewport();
  });
  moved.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "data-panel-side"] });
  let lastAspect = aspect();
  const resized = () => {
    viewport();
    // The layout follows the map's shape: tall maps stack hosts vertically.
    if (Math.abs(aspect() - lastAspect) > 1e-3) {
      lastAspect = aspect();
      relayout();
    }
  };
  const resize = new ResizeObserver(resized);
  resize.observe(parent);
  window.addEventListener("resize", resized);

  // Input on the map surface goes to Swift; React's overlays sit above it in
  // the page and keep their own.
  const local = (e: { clientX: number; clientY: number }) => {
    const r = parent.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pointer = (phase: string) => (e: PointerEvent) => {
    if (!enabled || e.pointerType === "touch") return;
    if (phase === "down") {
      if (e.button !== 0) return;
      parent.setPointerCapture(e.pointerId);
    }
    post({ type: "pointer", phase, ...local(e), buttons: e.buttons });
  };
  const listeners: [string, EventListener, AddEventListenerOptions?][] = [
    ["pointerdown", pointer("down") as EventListener],
    ["pointermove", pointer("move") as EventListener],
    ["pointerup", pointer("up") as EventListener],
    ["pointercancel", pointer("up") as EventListener],
    ["pointerleave", pointer("leave") as EventListener],
    ["contextmenu", ((e: Event) => e.preventDefault()) as EventListener],
    [
      "wheel",
      ((e: WheelEvent) => {
        e.preventDefault();
        if (!enabled) return;
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? parent.clientHeight : 1;
        post({ type: "wheel", ...local(e), dy: e.deltaY * unit });
      }) as EventListener,
      { passive: false },
    ],
    // Safari's trackpad pinch.
    [
      "gesturestart",
      ((e: Event) => {
        e.preventDefault();
        pinch = 1;
      }) as EventListener,
    ],
    [
      "gesturechange",
      ((e: Event & { scale: number; clientX: number; clientY: number }) => {
        e.preventDefault();
        if (!enabled) return;
        post({ type: "pinch", ...local(e), scale: e.scale / pinch });
        pinch = e.scale;
      }) as EventListener,
    ],
    [
      "keydown",
      ((e: KeyboardEvent) => {
        if (!enabled || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          post({ type: "key", key: e.key, down: true });
        } else if (e.key === "Home" || e.key.toLowerCase() === "f") post({ type: "command", name: "home" });
        else if (e.key === "Escape") handlers.pick?.(null);
      }) as EventListener,
    ],
    [
      "keyup",
      ((e: KeyboardEvent) => e.key.startsWith("Arrow") && post({ type: "key", key: e.key, down: false })) as EventListener,
    ],
    ["blur", (() => post({ type: "key", key: "all", down: false })) as EventListener],
  ];
  let pinch = 1;
  for (const [type, listener, options] of listeners) parent.addEventListener(type, listener, options);

  // The art is painted once per page; Swift keeps it as textures.
  void (async () => {
    try {
      const [buildings, robotSheet, foliage, sand, dirt, props, structures, flags] = await Promise.all(
        [buildingsUrl, robotsUrl, foliageUrl, sandUrl, dirtUrl, propsUrl, structuresUrl, flagsUrl].map(load),
      );
      const frames = buildFrames({ buildings: buildings!, robots: robotSheet!, foliage: foliage!, structures: structures! });
      for (const [name, frame] of propFrames(props!, PROPS)) frames.set(name, frame);
      for (const [name, frame] of flagFrames(flags!, PR_LABELS.map(({ flag }) => `flag-${flag}`))) frames.set(name, frame);
      const sent = [...frames].map(([name, frame]) => ({ name, png: png(crop(frame)) }));
      for (const [name, frame] of frames)
        if (casts(name)) sent.push({ name: `${name}-shadow`, png: png(shadowOf(crop(frame))) });
      // Offline robots stand greyed; their parts are sent pre-tinted.
      for (const [name, frame] of frames)
        if (/^robot-\w+-(body|hand-l|hand-r)$/.test(name))
          sent.push({ name: `${name}~offline`, png: png(tinted(crop(frame), OFFLINE_TINT)) });
      if (destroyed) return;
      art = { frames, tiles: { sand: sand!, dirt: dirt! }, masks: new Map() };
      post({
        type: "art",
        frames: sent,
        tiles: { water: png(waterTile()), glints: png(glintsTile()), clouds: png(cloudsTile()) },
        constants: {
          hexRadius: HEX_RADIUS,
          robotSize: ROBOT_SIZE,
          droneSize: DRONE_SIZE,
          droneOrbit: DRONE_ORBIT,
          maxZoom: MAX_ZOOM,
          overlayTop: OVERLAY_TOP,
          overlayBottom: OVERLAY_BOTTOM,
          wander: { x: WANDER_X, y: WANDER_Y, speed: WALK_SPEED, turn: TURN_SPEED },
          hover: HOVER_COLOR,
          // Swift places the shadows of lamps, robots and PR medallions itself.
          shadow: { pad: SHADOW.pad, spread: SHADOW.spread },
          flagSway: FLAG_SWAY,
        },
        reduced,
      });
      viewport();
      relayout();
    } catch (error) {
      handlers.error?.(error instanceof Error ? error.message : "Could not prepare the native world.");
    }
  })();

  return {
    kind: "atlas",
    native: true,
    update: (next) => {
      data = next;
      relayout();
    },
    select: (id) => {
      selection = id && (!layout || entity(id)) ? id : null;
      if (ready) post({ type: "select", id: selection });
      handlers.selection?.(entity(selection));
    },
    focus: (id, closer) => ready && post({ type: "focus", id, zoom: !!closer }),
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
            scene: "atlas",
            renderer: "SpriteKit",
            selected: selection,
            hovered,
            motion: !reduced,
            zoom,
            builds,
            native: nativeState,
            islands: layout.islands.map((i) => ({ key: i.key, host: i.host, name: i.name, online: i.online, cells: i.cells.length })),
            agents: layout.agents.map((a) => ({ id: a.id, name: a.name, state: a.state, model: a.model, workspace: a.workspace, at: point(a.position) })),
            tiles: Object.fromEntries(tiles(layout).map((t) => [t.id, t.state])),
            flags: Object.fromEntries(layout.workspaces.filter((w) => w.flags && !w.camp).map((w) => [w.id, w.flags])),
            probes: placeProbes(layout).map((p) => ({
              workspace: p.entity,
              state: p.verdict.state,
              glyph: probeGlyph(p.verdict),
              inCell: [0, 1, 2, 3, 4, 5, 6, 7].every((i) => {
                const a = (i / 8) * Math.PI * 2;
                return insideFootprint(p.x + (Math.cos(a) * p.size) / 2, p.y + (Math.sin(a) * p.size) / 2, [p.cell]);
              }),
            })),
            seals: placeSeals(layout, planted).map((s) => s.entity),
            workspaces: layout.workspaces.map((w) => ({ id: w.id, name: w.name, camp: !!w.camp })),
            planted: planted.map((f) => ({
              workspace: f.entity,
              flag: f.flag,
              sway: f.flag === "ci-running",
              // Whether the whole medallion lies inside its cell.
              inCell: [0, 1, 2, 3].every((i) => {
                const a = (i / 4) * Math.PI * 2;
                return insideFootprint(f.x + (Math.cos(a) * f.width) / 2, f.y + (Math.sin(a) * f.width) / 2, [f.cell]);
              }),
            })),
          }
        : undefined,
    destroy: () => {
      destroyed = true;
      ready = false;
      resize.disconnect();
      moved.disconnect();
      window.removeEventListener("resize", resized);
      window.removeEventListener("paseo:world", receive);
      for (const [type, listener, options] of listeners) parent.removeEventListener(type, listener, options);
      post({ type: "detach" });
    },
  };
}

export type { Entity };
