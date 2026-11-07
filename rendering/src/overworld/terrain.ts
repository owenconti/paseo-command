// Island shape: a union of rounded boxes with a noisy coastline. Units are concept pixels.
import type { Box, Island } from "./layout.ts";

function hash2(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [-1, 1]. */
export function noise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf) * 2 - 1;
}

export function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x, y, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}

function boxSdf(px: number, py: number, b: Box): number {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const hx = (b.x1 - b.x0) / 2 - b.r;
  const hy = (b.y1 - b.y0) / 2 - b.r;
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - b.r;
}

/** Signed distance (concept px) to the island's coast: negative inside. */
export function islandField(island: Island, x: number, y: number): number {
  let d = Infinity;
  for (const b of island.boxes) d = Math.min(d, boxSdf(x, y, b));
  for (const b of island.bites ?? []) d = Math.max(d, -boxSdf(x, y, b));
  if (d > 50) return d;
  const n = fbm(x / 110, y / 110, island.seed + 31, 2) * 26 + fbm(x / 30, y / 30, island.seed, 3) * 14 + noise(x / 8, y / 8, island.seed + 7) * 3;
  // The noise fades out toward 50 px rather than stopping there, so the field offshore has no step.
  return d + (d > 35 ? n * (1 - smooth((d - 35) / 15)) : n);
}

export function islandBounds(island: Island): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of island.boxes) {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  }
  return { x0: x0 - 22 - island.cliff * 0.4, y0: y0 - 22, x1: x1 + 22 + island.cliff * 0.4, y1: y1 + 22 + island.cliff * 1.3 };
}

/** An island's coast field sampled once on a grid (concept px), for fast repeated lookups. */
export interface FieldGrid {
  x0: number;
  y0: number;
  step: number;
  w: number;
  h: number;
  data: Float32Array;
}

const grids = new WeakMap<Island, FieldGrid>();

export function fieldGrid(island: Island): FieldGrid {
  let g = grids.get(island);
  if (g) return g;
  if (island.boxes.length === 0) {
    g = { x0: 0, y0: 0, step: 1, w: 0, h: 0, data: new Float32Array(0) };
    grids.set(island, g);
    return g;
  }
  const b = islandBounds(island);
  const step = 1;
  const w = Math.ceil((b.x1 - b.x0) / step) + 2;
  const h = Math.ceil((b.y1 - b.y0) / step) + 2;
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = islandField(island, b.x0 + i * step, b.y0 + j * step);
  g = { x0: b.x0, y0: b.y0, step, w, h, data };
  grids.set(island, g);
  return g;
}

/** How far past an island's bounds the sea's own field reaches (concept px), and its coarser step. */
export const SEA_PAD = 56;
const SEA_STEP = 2;
const seaGrids = new WeakMap<Island, FieldGrid>();

/** The coast field over the sea round an island, wide enough for its shallows and surf. */
function seaGrid(island: Island): FieldGrid {
  let g = seaGrids.get(island);
  if (g) return g;
  if (island.boxes.length === 0) {
    g = { x0: 0, y0: 0, step: 1, w: 0, h: 0, data: new Float32Array(0) };
    seaGrids.set(island, g);
    return g;
  }
  const b = islandBounds(island);
  const x0 = b.x0 - SEA_PAD;
  const y0 = b.y0 - SEA_PAD;
  const w = Math.ceil((b.x1 - b.x0 + 2 * SEA_PAD) / SEA_STEP) + 2;
  const h = Math.ceil((b.y1 - b.y0 + 2 * SEA_PAD) / SEA_STEP) + 2;
  const data = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = islandField(island, x0 + i * SEA_STEP, y0 + j * SEA_STEP);
  g = { x0, y0, step: SEA_STEP, w, h, data };
  seaGrids.set(island, g);
  return g;
}

/** `islandField` for the sea (shallows, surf): from the wider grid; far outside it, a large distance. */
export function seaFieldAt(island: Island, x: number, y: number): number {
  return sample(seaGrid(island), x, y);
}

/** `islandField` from the cached grid (bilinear); far outside the grid, a large distance. */
export function fieldAt(island: Island, x: number, y: number): number {
  return sample(fieldGrid(island), x, y);
}

function sample(g: FieldGrid, x: number, y: number): number {
  const gx = (x - g.x0) / g.step;
  const gy = (y - g.y0) / g.step;
  if (gx < 0 || gy < 0 || gx >= g.w - 1 || gy >= g.h - 1) return 1e3;
  const i = Math.floor(gx);
  const j = Math.floor(gy);
  const fx = gx - i;
  const fy = gy - j;
  const o = j * g.w + i;
  const d = g.data;
  return (d[o] * (1 - fx) + d[o + 1] * fx) * (1 - fy) + (d[o + g.w] * (1 - fx) + d[o + g.w + 1] * fx) * fy;
}
