/**
 * Renderer-neutral painters for the Atlas's building, foliage and robot
 * artwork: plain canvas work. The native bridge sends these frames to
 * SpriteKit as textures.
 */

/** A cropped, padded sprite: `canvas` holds it at `(x, y)`, sized `width` by
 * `height`. */
export type Frame = {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArtSources = {
  buildings: HTMLImageElement;
  robots: HTMLImageElement;
  foliage: HTMLImageElement;
  /** The later landmarks and cottages, each in its own 512px cell. */
  structures: HTMLImageElement;
};

import STRUCTURES from "./assets/structures.json";

type Rect = [number, number, number, number];

// Regions are atlas frames, not a flattened map. This module owns their cropping.
const BUILDING_FRAMES: Record<string, Rect> = {
  manor: [0, 0, 575, 550],
  observatory: [585, 0, 470, 550],
  conservatory: [1060, 0, 476, 550],
  "cottage-slate": [65, 560, 455, 464],
  "cottage-brown": [600, 560, 430, 464],
  rocks: [1422, 852, 86, 71],
  // The grove's flowering shrub, below the big tree (whose canopy ends at y 839).
  shrub: [1104, 840, 140, 133],
};

const ROBOT_BASES = ["teal", "violet", "lime", "blue"];

/** Separate power-of-two GPU textures allow proper mip filtering at overview
 * zoom. Each sprite keeps transparent gutters so neighboring atlas artwork
 * cannot bleed in. */
const GUTTER = 8;

/** `tree-small` draws as the same sprite as `trees`; nothing else renames. */
export function frameName(art: string): string {
  return art === "tree-small" ? "trees" : art;
}

/** Trim transparent margins from `[x, y, w, h]` on `img`, keeping `padding`
 * px of gutter around whatever is left above `alphaThreshold`. */
function trimRect(
  img: HTMLImageElement,
  [x, y, w, h]: Rect,
  alphaThreshold = 90,
  padding = 5,
): Rect {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++)
      if (data[(py * w + px) * 4 + 3]! > alphaThreshold) {
        left = Math.min(left, px);
        top = Math.min(top, py);
        right = Math.max(right, px);
        bottom = Math.max(bottom, py);
      }
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(w, right + padding + 1);
  bottom = Math.min(h, bottom + padding + 1);
  return [x + left, y + top, Math.max(1, right - left), Math.max(1, bottom - top)];
}

/** The trimmed rects on the source sheets (buildings, foliage, robots):
 * what `buildFrames` crops into its padded canvases. */
export function sourceRects(src: ArtSources): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  for (const [name, rect] of Object.entries(BUILDING_FRAMES))
    rects.set(name, trimRect(src.buildings, rect));
  // Foliage has its own source image so atlas neighbors cannot enter its frame.
  for (const [name, rect] of Object.entries(STRUCTURES))
    rects.set(name, trimRect(src.structures, rect as Rect, 0, 0));
  rects.set(
    "trees",
    trimRect(src.foliage, [0, 0, src.foliage.width, src.foliage.height], 4, 20),
  );
  ROBOT_BASES.forEach((name, i) => {
    const w = src.robots.width / 2,
      h = src.robots.height / 2;
    rects.set(`robot-${name}`, trimRect(src.robots, [(i % 2) * w, Math.floor(i / 2) * h, w, h]));
  });
  return rects;
}

/** Crop `rect` off `img` into a fresh power-of-two canvas with `GUTTER` px
 * of transparent padding, at the same position every `filtered-<name>`
 * texture places its frame. */
function paddedFrame(img: HTMLImageElement, [x, y, w, h]: Rect): Frame {
  const side = 2 ** Math.ceil(Math.log2(Math.max(w, h) + GUTTER * 2));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, x, y, w, h, GUTTER, GUTTER, w, h);
  return { canvas, x: GUTTER, y: GUTTER, width: w, height: h };
}

/** New enamel for the teal robot: hue (degrees), saturation scale, and how
 * lightness maps (`l * scale + offset`). Brass, ink and highlights keep. */
type Paint = { hue: number; saturation: number; scale: number; offset: number };
const ROBOT_PAINT: [string, Paint][] = [
  ["orange", { hue: 18, saturation: 0.62, scale: 1, offset: 0.12 }],
  ["white", { hue: 40, saturation: 0.06, scale: 0.4, offset: 0.6 }],
];

/** Recolour the teal enamel's pixels (teal hues with some colour), in place. */
function repaint(data: Uint8ClampedArray, paint: Paint): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]! / 255,
      g = data[i + 1]! / 255,
      b = data[i + 2]! / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      l = (max + min) / 2,
      d = max - min;
    if (d < 0.06) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h < 150 || h > 220 || s < 0.15) continue;
    const nl = Math.min(1, l * paint.scale + paint.offset),
      ns = Math.min(1, s * paint.saturation);
    const c = (1 - Math.abs(2 * nl - 1)) * ns,
      x = c * (1 - Math.abs(((paint.hue / 60) % 2) - 1)),
      m = nl - c / 2;
    const [r1, g1, b1] =
      paint.hue < 60 ? [c, x, 0] : paint.hue < 120 ? [x, c, 0] : [0, c, x];
    data[i] = Math.round((r1 + m) * 255);
    data[i + 1] = Math.round((g1 + m) * 255);
    data[i + 2] = Math.round((b1 + m) * 255);
  }
}

/** The teal robot re-enamelled: Claude's orange and ChatGPT's white. */
function recolor(teal: Frame, paint: Paint): Frame {
  const canvas = document.createElement("canvas");
  canvas.width = teal.canvas.width;
  canvas.height = teal.canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(teal.canvas, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  repaint(image.data, paint);
  ctx.putImageData(image, 0, 0);
  return { canvas, x: teal.x, y: teal.y, width: teal.width, height: teal.height };
}

/** Where a robot's hands sit in its frame (px from the frame's top left), and
 * their reach. Every robot in the atlas shares one drawing, so one measure
 * serves all; the frame's trim leaves 5px around the silhouette. */
const HAND = { x: 5 + 44, y: 5 + 237, rx: 47, ry: 50 };
const SILHOUETTE_WIDTH = 488;

function toFrame(data: Uint8ClampedArray, width: number, height: number): Frame {
  const canvas = document.createElement("canvas");
  canvas.width = width + GUTTER * 2;
  canvas.height = height + GUTTER * 2;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.createImageData(width, height);
  image.data.set(data);
  ctx.putImageData(image, GUTTER, GUTTER);
  return { canvas, x: GUTTER, y: GUTTER, width, height };
}

/** Cut a robot's hands into their own frames, so they can move, and mend the
 * shoulders they covered by carrying the brass down from just above. */
function splitRobot(frame: Frame): { body: Frame; handL: Frame; handR: Frame } {
  const fw = frame.width,
    fh = frame.height;
  const whole = document.createElement("canvas");
  whole.width = fw;
  whole.height = fh;
  const wctx = whole.getContext("2d", { willReadFrequently: true })!;
  wctx.drawImage(frame.canvas, frame.x, frame.y, fw, fh, 0, 0, fw, fh);
  const pixels = wctx.getImageData(0, 0, fw, fh);
  const body = new Uint8ClampedArray(pixels.data);
  const centres = [
    { side: "l" as const, x: HAND.x, shoulder: [5 + 48, 5 + 100] as [number, number] },
    {
      side: "r" as const,
      x: 5 + SILHOUETTE_WIDTH - (HAND.x - 5),
      shoulder: [5 + SILHOUETTE_WIDTH - 100, 5 + SILHOUETTE_WIDTH - 48] as [number, number],
    },
  ];
  const inside = (px: number, py: number, cx: number) =>
    ((px - cx) / HAND.rx) ** 2 + ((py - HAND.y) / HAND.ry) ** 2 <= 1;
  const hands: Record<"l" | "r", Uint8ClampedArray> = { l: new Uint8ClampedArray(), r: new Uint8ClampedArray() };
  for (const c of centres) {
    const hand = new Uint8ClampedArray(fw * fh * 4);
    for (let py = Math.floor(HAND.y - HAND.ry); py <= HAND.y + HAND.ry; py++)
      for (let px = Math.floor(c.x - HAND.rx); px <= c.x + HAND.rx; px++) {
        if (px < 0 || py < 0 || px >= fw || py >= fh || !inside(px, py, c.x)) continue;
        const i = (py * fw + px) * 4;
        for (let k = 0; k < 4; k++) hand[i + k] = pixels.data[i + k]!;
        // The shoulder ring runs on under the hand; elsewhere the hand leaves air.
        const [from, to] = c.shoulder;
        const above = ((5 + 186) * fw + px) * 4;
        if (px >= from && px <= to && py <= 5 + 232 && pixels.data[above + 3]! > 200)
          for (let k = 0; k < 4; k++) body[i + k] = pixels.data[above + k]!;
        else body[i + 3] = 0;
      }
    hands[c.side] = hand;
  }
  return {
    body: toFrame(body, fw, fh),
    handL: toFrame(hands.l, fw, fh),
    handR: toFrame(hands.r, fw, fh),
  };
}

/** Every building, tree, and robot (plus its body and hands, each colour)
 * the Atlas draws, cropped and padded, ready to become a texture. Plaza
 * props and PR flags come from `propFrames` and `flagFrames`. */
export function buildFrames(src: ArtSources): Map<string, Frame> {
  const frames = new Map<string, Frame>();
  for (const [name, rect] of sourceRects(src)) {
    const img = name in STRUCTURES
      ? src.structures
      : name.startsWith("robot-")
        ? src.robots
        : name === "trees"
          ? src.foliage
          : src.buildings;
    frames.set(name, paddedFrame(img, rect));
  }
  const teal = frames.get("robot-teal")!;
  for (const [name, paint] of ROBOT_PAINT) frames.set(`robot-${name}`, recolor(teal, paint));
  for (const name of [...ROBOT_BASES, ...ROBOT_PAINT.map(([n]) => n)]) {
    const key = `robot-${name}`;
    const { body, handL, handR } = splitRobot(frames.get(key)!);
    frames.set(`${key}-body`, body);
    frames.set(`${key}-hand-l`, handL);
    frames.set(`${key}-hand-r`, handR);
  }
  return frames;
}

/** Plaza props (greenery, workshop gear, lamps and beacon in both states),
 * cropped and padded as `buildFrames` does. */
export function propFrames(img: HTMLImageElement, rects: Record<string, { rect: number[] }>): Map<string, Frame> {
  const frames = new Map<string, Frame>();
  for (const [name, { rect }] of Object.entries(rects))
    frames.set(name, paddedFrame(img, trimRect(img, rect as Rect)));
  return frames;
}

/** PR flags: a grid of 512 px cells three across, CI along the top, review
 * below, then merge conflicts (in `names`' order). A low threshold keeps the brass poles' soft edges. */
export function flagFrames(img: HTMLImageElement, names: string[]): Map<string, Frame> {
  const frames = new Map<string, Frame>();
  names.forEach((name, i) =>
    frames.set(name, paddedFrame(img, trimRect(img, [(i % 3) * 512, Math.floor(i / 3) * 512, 512, 512], 4, 8))),
  );
  return frames;
}
