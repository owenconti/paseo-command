// Paints an Overworld scene to a 2D canvas: sea, islands with cliffs and shore foam, rivers and
// falls, paths, scenery and buildings, gold links, labels. Units are concept pixels, drawn at K.
import { frameOf, framesWithPrefix, hasFrame, type Frame, type Sheets } from "./atlas.ts";
import { fbm, fieldAt, fieldGrid, islandBounds, noise } from "./terrain.ts";
import {
  BOOTH,
  boothSlots,
  rng,
  robotSpots,
  type BoothItem,
  type Island,
  type LabelItem,
  type PlaqueItem,
  type Scene,
  type SpriteItem,
  type Theme,
} from "./layout.ts";

type Ctx = CanvasRenderingContext2D;

const FONT = `ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", system-ui, sans-serif`;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function pixels(f: Frame, x = 0, y = 0, w = f.w, h = f.h): { data: Uint8ClampedArray; w: number; h: number } {
  const c = canvas(w, h);
  const g = c.getContext("2d")!;
  g.drawImage(f.img, f.x + x, f.y + y, w, h, 0, 0, w, h);
  return { data: g.getImageData(0, 0, w, h).data, w, h };
}

function frameCanvas(f: Frame): HTMLCanvasElement {
  const c = canvas(f.w, f.h);
  c.getContext("2d")!.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
  return c;
}

export function drawFrame(ctx: Ctx, f: Frame, x: number, y: number, s: number, flip = false, alpha = 1): void {
  ctx.save();
  if (alpha !== 1) ctx.globalAlpha *= alpha;
  if (flip) {
    ctx.translate(x, y);
    ctx.scale(-1, 1);
    ctx.drawImage(f.img, f.x, f.y, f.w, f.h, -f.ax * s, -f.ay * s, f.w * s, f.h * s);
  } else {
    ctx.drawImage(f.img, f.x, f.y, f.w, f.h, x - f.ax * s, y - f.ay * s, f.w * s, f.h * s);
  }
  ctx.restore();
}

const tintCache = new Map<string, HTMLCanvasElement>();
function tinted(f: Frame, colour: string, key: string): Frame {
  let c = tintCache.get(key);
  if (!c) {
    c = frameCanvas(f);
    const g = c.getContext("2d")!;
    g.globalCompositeOperation = "color";
    g.fillStyle = colour;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = "multiply";
    g.globalAlpha = 0.45;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    g.globalCompositeOperation = "destination-in";
    g.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    tintCache.set(key, c);
  }
  return { ...f, img: c, x: 0, y: 0 };
}

// Colour grading done per pixel: WebKit's canvas ignores ctx.filter.
export interface Grade {
  brightness?: number;
  contrast?: number;
  saturate?: number;
  /** Degrees. */
  hue?: number;
}

function gradeMatrix(gr: Grade): number[] {
  // 3x3 colour matrix for hue rotation then saturation (CSS filter definitions).
  const h = ((gr.hue ?? 0) * Math.PI) / 180;
  const c = Math.cos(h);
  const sn = Math.sin(h);
  const hm = [
    0.213 + c * 0.787 - sn * 0.213, 0.715 - c * 0.715 - sn * 0.715, 0.072 - c * 0.072 + sn * 0.928,
    0.213 - c * 0.213 + sn * 0.143, 0.715 + c * 0.285 + sn * 0.14, 0.072 - c * 0.072 - sn * 0.283,
    0.213 - c * 0.213 - sn * 0.787, 0.715 - c * 0.715 + sn * 0.715, 0.072 + c * 0.928 + sn * 0.072,
  ];
  const s = gr.saturate ?? 1;
  const sm = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
  const m: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) m.push(sm[i * 3] * hm[j] + sm[i * 3 + 1] * hm[3 + j] + sm[i * 3 + 2] * hm[6 + j]);
  return m;
}

export function gradePixels(data: Uint8ClampedArray, gr: Grade): void {
  const m = gradeMatrix(gr);
  const b = gr.brightness ?? 1;
  const k = gr.contrast ?? 1;
  const off = 128 * (1 - k);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i];
    const g = data[i + 1];
    const bl = data[i + 2];
    data[i] = (m[0] * r + m[1] * g + m[2] * bl) * b * k + off;
    data[i + 1] = (m[3] * r + m[4] * g + m[5] * bl) * b * k + off;
    data[i + 2] = (m[6] * r + m[7] * g + m[8] * bl) * b * k + off;
  }
}

export interface PaintOptions {
  K: number;
  t: number;
  /** Draw the robots (the preview); the app's map draws them natively over the painting. */
  robots?: boolean;
  /** Where the scene's origin is in the world (concept px), so neighbouring paintings' seas line up. */
  origin?: { x: number; y: number };
  /** Sea painted this far beyond the scene's left and right (concept px). */
  margin?: number;
}

/** Land is painted at this density (px per concept px) and drawn scaled: per-pixel work dominates. */
const LAND_K = 2;

const GRASS_GRADE: Grade = { hue: -13, saturate: 0.92, brightness: 1.04, contrast: 1.12 };

/** The concept's colours, as before the muting. */
const FINAL_GRADE: Grade = { contrast: 1.12, saturate: 1.18 };

/** Measured: our painting's brightness at the 5/25/50/75/95th percentiles against the concept's. */
const TONE = (() => {
  // The concept's brightness, then softened as a watercolour: shadows lifted, highlights eased.
  const points: Array<[number, number]> = [[0, 34], [25, 52], [59, 80], [87, 108], [152, 168], [227, 228], [255, 248]];
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    const k = points.findIndex(([x]) => x >= v);
    const [x1, y1] = points[Math.max(1, k)]!;
    const [x0, y0] = points[Math.max(0, k - 1)]!;
    lut[v] = x1 === x0 ? y1 : y0 + ((v - x0) * (y1 - y0)) / (x1 - x0);
  }
  return lut;
})();

export function paintScene(ctx: Ctx, scene: Scene, sheets: Sheets, opts: PaintOptions): void {
  const { K } = opts;
  ctx.save();
  ctx.scale(K, K);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  paintSea(ctx, scene, sheets, opts);
  const lands = scene.islands.filter((i) => i.boxes.length > 0).map((island) => ({ island, land: paintIsland(island, sheets, Math.min(K, LAND_K)) }));
  // Shore: foam and shallows round every island, then the islands in order.
  for (const rock of seaRocks(scene)) {
    ctx.save();
    ctx.shadowColor = "rgba(240, 252, 255, 1)";
    ctx.shadowBlur = 5 * K;
    paintSprite(ctx, rock, sheets);
    paintSprite(ctx, rock, sheets);
    ctx.restore();
  }
  const ordered = [...lands].sort((a, b) => a.island.z - b.island.z || a.land.y1 - b.land.y1);
  for (const { island, land } of ordered) {
    ctx.drawImage(land.c, land.x0, land.y0, land.w, land.h);
    paintCoast(ctx, island, sheets, (x, y) => scene.islands.some((o) => o !== island && o.boxes.length > 0 && fieldAt(o, x, y) < 2));
  }

  paintStrips(ctx, scene, sheets, opts);
  const items = [...scene.items, ...scatter(scene, sheets)];
  items.sort((a, b) => (a.z ?? a.y) - (b.z ?? b.y));
  for (const item of items) {
    if (item.kind === "booth") paintBooth(ctx, item, sheets, opts);
    else paintSprite(ctx, item, sheets);
  }
  for (const label of scene.labels) {
    if (label.kind === "label") paintLabel(ctx, label, sheets);
    else paintPlaque(ctx, label, sheets);
  }
  for (const cloud of clouds(scene)) paintSprite(ctx, cloud, sheets);
  ctx.restore();
  // Final grade: the concept's punchy contrast and saturation.
  const cv = ctx.canvas;
  const all = ctx.getImageData(0, 0, cv.width, cv.height);
  gradePixels(all.data, FINAL_GRADE);
  // Tone curve: the concept's deeper shadows and brighter highlights (its brightness percentiles).
  for (let i = 0; i < all.data.length; i += 4) {
    all.data[i] = TONE[all.data[i]!]!;
    all.data[i + 1] = TONE[all.data[i + 1]!]!;
    all.data[i + 2] = TONE[all.data[i + 2]!]!;
  }
  ctx.putImageData(all, 0, 0);
  watercolour(ctx.canvas);
  // Robots stay at full colour over the muted world (the app draws them natively; the preview here).
  if (opts.robots !== false) {
    ctx.save();
    ctx.scale(K, K);
    scene.robots.forEach((spot, i) => drawFrame(ctx, robotFrame(sheets, spot.colour, spot.working, opts.t, i * 0.37), spot.x, spot.y, ROBOT_SCALE));
    ctx.restore();
  }
}

// ---- Sea -----------------------------------------------------------------------------------

const SEA_TEXTURE_SCALE = 0.25;

const seaTiles = new Map<Frame, HTMLCanvasElement>();
/** The sea texture darkened in its mid-tones (the concept's deep blue) with its crests kept bright. */
function seaTile(f: Frame): HTMLCanvasElement {
  let c = seaTiles.get(f);
  if (c) return c;
  c = frameCanvas(f);
  const g = c.getContext("2d")!;
  const d = g.getImageData(0, 0, c.width, c.height);
  const curve = (v: number, gamma: number) => 255 * Math.pow(v / 255, gamma);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = curve(d.data[i], 2.4);
    d.data[i + 1] = curve(d.data[i + 1], 1.4);
    d.data[i + 2] = curve(d.data[i + 2], 1.32);
  }
  g.putImageData(d, 0, 0);
  seaTiles.set(f, c);
  return c;
}

function coastDistance(scene: Scene, x: number, y: number): number {
  let d = Infinity;
  for (const isl of scene.islands) {
    if (isl.boxes.length === 0) continue;
    // The visible shore is the cliff's foot: the coast shifted down by the cliff.
    d = Math.min(d, fieldAt(isl, x, y - isl.cliff * 0.85));
  }
  return d;
}

function paintSea(ctx: Ctx, scene: Scene, sheets: Sheets, opts: PaintOptions): void {
  const frame = Math.floor(opts.t / 300) % 4;
  const calm = framesWithPrefix(sheets, "sea2", "sea-calm-");
  const textured = calm.length > 0 || hasFrame(sheets, "textures", `sea-${frame}`) || hasFrame(sheets, "textures", "sea");
  if (textured) {
    const f = calm.length
      ? frameOf(sheets, "sea2", calm[frame % calm.length]!)
      : hasFrame(sheets, "textures", `sea-${frame}`)
        ? frameOf(sheets, "textures", `sea-${frame}`)
        : frameOf(sheets, "textures", "sea");
    // The calm sea is made to the concept's tones; the older texture is darkened toward them.
    const pattern = ctx.createPattern(calm.length ? frameCanvas(f) : seaTile(f), "repeat")!;
    const period = f.w * SEA_TEXTURE_SCALE;
    const ox = ((opts.origin?.x ?? 0) % period + period) % period;
    const oy = ((opts.origin?.y ?? 0) % period + period) % period;
    pattern.setTransform(new DOMMatrix().translate(-ox, -oy).scale(SEA_TEXTURE_SCALE, SEA_TEXTURE_SCALE));
    ctx.fillStyle = pattern;
    const m = opts.margin ?? 0;
    ctx.fillRect(-m, 0, scene.w + 2 * m, scene.h);
    if (calm.length) {
      // Lifted toward the concept's brighter royal blue.
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.fillStyle = "rgb(4, 34, 52)";
      ctx.fillRect(-m, 0, scene.w + 2 * m, scene.h);
      ctx.restore();
    }
  }
  const cw = Math.ceil(scene.w);
  const ch = Math.ceil(scene.h);
  const c = canvas(cw, ch);
  const g = c.getContext("2d")!;
  const img = g.createImageData(cw, ch);
  const phase = opts.t / 2600;
  for (let j = 0; j < ch; j++) {
    const y = j + 0.5;
    for (let i = 0; i < cw; i++) {
      const x = i + 0.5;
      const o = (j * cw + i) * 4;
      let r = 0;
      let gg = 0;
      let b = 0;
      let a = 0;
      if (!textured) {
        const band = fbm(x / 160, y / 26, 501, 3);
        r = 14 + band * 10;
        gg = 62 + band * 26;
        b = 150 + band * 30;
        a = 255;
      }
      // Surf at the cliffs' foot: a broken white band, then flecks of foam fading offshore.
      const d = coastDistance(scene, x, y);
      if (d > -1 && d < 16) {
        const n = noise(x / 3.2, y / 3.2, 504) * 0.5 + noise(x / 9, y / 9, 505) * 0.5;
        let k = 0;
        if (d < 2.2 + n * 1.5) k = 0.95;
        else if (d < 5 + n * 3) k = Math.max(0, n) * 0.85;
        else k = Math.max(0, n - 0.35) * 1.4 * (1 - d / 16);
        if (k > 0) {
          if (textured) {
            r = 225;
            gg = 248;
            b = 255;
            a = Math.max(a, Math.min(1, k) * 255);
          } else {
            r = lerp(r, 225, k);
            gg = lerp(gg, 248, k);
            b = lerp(b, 255, k);
          }
        }
      }
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  ctx.drawImage(c, 0, 0, scene.w, scene.h);
  if (textured) return;
  // Crests: short bright crescents in loose rows, as the concept's chop.
  const rr = rng(7);
  ctx.save();
  ctx.lineCap = "round";
  for (let y = 0; y < scene.h; y += 7) {
    for (let x = 0; x < scene.w; x += 11) {
      const px = x + (rr() - 0.5) * 10;
      const py = y + (rr() - 0.5) * 5;
      const n = fbm(px / 60, py / 30, 505, 2) + rr() * 0.5 - 0.25;
      if (n < 0.12) continue;
      if (coastDistance(scene, px, py) < 3) continue;
      const len = 5 + rr() * 9;
      ctx.strokeStyle = "rgba(4, 22, 85, 0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - len / 2, py + 1.4);
      ctx.quadraticCurveTo(px, py, px + len / 2, py + 1.4);
      ctx.stroke();
      ctx.strokeStyle = rr() < 0.3 ? "rgba(245, 255, 255, 0.95)" : "rgba(95, 205, 255, 0.95)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px - len / 2, py);
      ctx.quadraticCurveTo(px, py - 2, px + len / 2, py);
      ctx.stroke();
    }
  }
  ctx.restore();
  void sheets;
}

// ---- Islands -------------------------------------------------------------------------------

interface Land {
  c: HTMLCanvasElement;
  x0: number;
  y0: number;
  w: number;
  h: number;
  y1: number;
}

type Tex = { data: Uint8ClampedArray; w: number; h: number };
let grassTex: Tex | undefined;
const rockTexes = new Map<string, Tex>();
let newTextures = false;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function paintIsland(island: Island, sheets: Sheets, K: number): Land {
  newTextures = hasFrame(sheets, "textures", "grass") && hasFrame(sheets, "textures", "rock");
  if (!grassTex) {
    grassTex = newTextures ? pixels(frameOf(sheets, "textures", "grass")) : pixels(frameOf(sheets, "terrain", "grass-0"));
    // The concept's meadow is a yellower, softer green (measured: hue ~71°, saturation ~0.86).
    gradePixels(grassTex.data, GRASS_GRADE);
  }
  const rockName = island.rock === "volcanic" && hasFrame(sheets, "textures", "rock-volcanic") ? "rock-volcanic" : "rock";
  let rockTex = rockTexes.get(rockName);
  if (!rockTex) {
    if (newTextures) rockTex = pixels(frameOf(sheets, "textures", rockName));
    else {
      const cliffFrame = frameOf(sheets, "terrain", "cliff-face");
      rockTex = pixels(cliffFrame, 0, 64, cliffFrame.w, cliffFrame.h - 64);
    }
    rockTexes.set(rockName, rockTex);
  }
  const b = islandBounds(island);
  const W = Math.ceil((b.x1 - b.x0) * K);
  const H = Math.ceil((b.y1 - b.y0) * K);
  const c = canvas(W, H);
  const g = c.getContext("2d")!;
  const img = g.createImageData(W, H);
  const out = img.data;
  const top = new Float32Array(W * H);
  const dist = new Float32Array(W * H);
  // The coast field on a half-concept-pixel grid, interpolated per pixel (it is smooth at that scale).
  const fg = fieldGrid(island);
  const step = fg.step;
  const GW = fg.w;
  const GH = fg.h;
  const grid = fg.data;
  for (let j = 0; j < H; j++) {
    const gy = (j + 0.5) / K / step;
    const gj = Math.min(GH - 2, Math.floor(gy));
    const fy = gy - gj;
    for (let i = 0; i < W; i++) {
      const gx = (i + 0.5) / K / step;
      const gi = Math.min(GW - 2, Math.floor(gx));
      const fx = gx - gi;
      const o = gj * GW + gi;
      const d = (grid[o] * (1 - fx) + grid[o + 1] * fx) * (1 - fy) + (grid[o + GW] * (1 - fx) + grid[o + GW + 1] * fx) * fy;
      dist[j * W + i] = d;
      top[j * W + i] = Math.min(1, Math.max(0, 0.5 - d * K));
    }
  }
  const grass = grassTex;
  const rock = rockTex;
  const volcanic = island.rock === "volcanic";
  // Cliffs: the top extruded down and outward from a viewpoint high above the map's middle,
  // so fronts and the outer sides of islands show rock, as in the concept.
  const VPX = 600;
  const VPY = -2600;
  // Cliff height per column, and each grid point's depth below the coast along the view ray
  // (marched on the coarse grid, interpolated per pixel).
  const cliffCols = new Float32Array(W);
  for (let i = 0; i < W; i++) {
    const u = b.x0 + (i + 0.5) / K;
    cliffCols[i] = island.cliff * (1 + 0.22 * noise(u / 23, 0.5, island.seed + 3) + 0.08 * noise(u / 5, 0.5, island.seed + 5));
  }
  // Sunlit and shaded meadow patches vary slowly: a coarse grid.
  const PSTEP = 3;
  const PW = Math.ceil((b.x1 - b.x0) / PSTEP) + 2;
  const PH = Math.ceil((b.y1 - b.y0) / PSTEP) + 2;
  const patch = new Float32Array(PW * PH);
  for (let pj = 0; pj < PH; pj++) for (let pi = 0; pi < PW; pi++) patch[pj * PW + pi] = fbm((b.x0 + pi * PSTEP) / 55, (b.y0 + pj * PSTEP) / 55, island.seed + 21, 3);
  const depthGrid = new Float32Array(GW * GH).fill(-1);
  const maxCliff = island.cliff * 1.32;
  for (let gj = 0; gj < GH; gj++) {
    const v = b.y0 + gj * step;
    for (let gi = 0; gi < GW; gi++) {
      const d0 = grid[gj * GW + gi];
      if (d0 <= 0 || d0 > maxCliff) continue;
      const u = b.x0 + gi * step;
      const dx = u - VPX;
      const dy = v - VPY;
      const len = Math.hypot(dx, dy);
      const sx = (dx / len) * step;
      const sy = (dy / len) * step;
      const limit = maxCliff / step;
      for (let st = 1; st <= limit; st++) {
        const qi = Math.round(gi - (sx * st) / step);
        const qj = Math.round(gj - (sy * st) / step);
        if (qi < 0 || qj < 0 || qi >= GW || qj >= GH) break;
        if (grid[qj * GW + qi] < 0) {
          depthGrid[gj * GW + gi] = st * step;
          break;
        }
      }
    }
  }
  for (let j = 0; j < H; j++) {
    const v = b.y0 + (j + 0.5) / K;
    const gy = (j + 0.5) / K / step;
    const gj = Math.min(GH - 2, Math.floor(gy));
    const fy = gy - gj;
    for (let i = 0; i < W; i++) {
      const u = b.x0 + (i + 0.5) / K;
      const k = j * W + i;
      const a = top[k];
      const wx = Math.floor(u * 4);
      let r = 0;
      let gg = 0;
      let bb = 0;
      let alpha = 0;
      const cliffH = cliffCols[i];
      const dx = u - VPX;
      const ux = dx / Math.hypot(dx, v - VPY);
      if (a < 1 && dist[k] > -1 && dist[k] < cliffH * 1.05) {
        const gx = (i + 0.5) / K / step;
        const gi = Math.min(GW - 2, Math.floor(gx));
        const fx = gx - gi;
        const o = gj * GW + gi;
        const d00 = depthGrid[o];
        const d10 = depthGrid[o + 1];
        const d01 = depthGrid[o + GW];
        const d11 = depthGrid[o + GW + 1];
        let depth: number;
        if (d00 >= 0 && d10 >= 0 && d01 >= 0 && d11 >= 0) depth = (d00 * (1 - fx) + d10 * fx) * (1 - fy) + (d01 * (1 - fx) + d11 * fx) * fy;
        else depth = Math.max(fx < 0.5 ? (fy < 0.5 ? d00 : d01) : fy < 0.5 ? d10 : d11, a > 0 ? 0 : -1);
        if (depth > cliffH) depth = -1;
        if (depth >= 0) {
          const t = depth / cliffH;
          let ry: number;
          if (newTextures) ry = Math.min(rock.h - 1, Math.floor(t * (rock.h - 1)));
          else {
            const span = rock.h * 2 - 2;
            ry = Math.floor(depth * 4 * 0.9 + (wx % 37)) % span;
            if (ry >= rock.h) ry = span - ry;
          }
          const rx = ((wx % rock.w) + rock.w) % rock.w;
          const p = (ry * rock.w + rx) * 4;
          let rr = rock.data[p];
          let rg = rock.data[p + 1];
          let rb = rock.data[p + 2];
          if (!volcanic && !newTextures) {
            const l = 0.3 * rr + 0.59 * rg + 0.11 * rb;
            rr = lerp(rr, l, 0.72) * 1.02 + 6;
            rg = lerp(rg, l, 0.72) + 3;
            rb = lerp(rb, l, 0.72) * 0.97;
          }
          let shade = newTextures ? 1.25 - 0.3 * t : 1.08 - 0.55 * t;
          // Side faces (seen at an angle) a little darker than fronts.
          shade *= 1 - Math.min(0.25, Math.abs(ux) * 1.6);
          if (depth < 2.5) shade *= 0.45 + 0.22 * depth;
          const drip = 1.5 + 7 * Math.max(0, fbm(u / 4, v / 9, island.seed + 11, 2) + 0.2);
          if (depth < drip) {
            const m = 0.55 + 0.45 * noise(u / 1.5, v / 1.5, island.seed + 13);
            rr = 150 * m + 20;
            rg = 175 * m + 25;
            rb = 30 * m;
            shade = 1 - 0.35 * (depth / drip);
          }
          if (t > 0.93) shade *= 0.65;
          r = rr * shade;
          gg = rg * shade;
          bb = rb * shade;
          alpha = 1;
        }
      }
      if (a > 0) {
        const tx = ((wx % grass.w) + grass.w) % grass.w;
        const ty = ((Math.floor(v * 4) % grass.h) + grass.h) % grass.h;
        const p = (ty * grass.w + tx) * 4;
        let gr = grass.data[p];
        let gG = grass.data[p + 1];
        let gb = grass.data[p + 2];
        // Warm the texture toward the concept's yellow-green meadow.
        if (!newTextures) {
          gr = gr * 1.18 + 22;
          gG = gG * 1.02 + 8;
          gb = gb * 0.6;
        }
        // Large sunlit and shaded patches, as the concept's meadows.
        const pgx = (u - b.x0) / PSTEP;
        const pgy = (v - b.y0) / PSTEP;
        const pi0 = Math.min(PW - 2, Math.floor(pgx));
        const pj0 = Math.min(PH - 2, Math.floor(pgy));
        const pfx = pgx - pi0;
        const pfy = pgy - pj0;
        const po = pj0 * PW + pi0;
        const n = (patch[po] * (1 - pfx) + patch[po + 1] * pfx) * (1 - pfy) + (patch[po + PW] * (1 - pfx) + patch[po + PW + 1] * pfx) * pfy;
        if (n > 0) {
          const s = Math.min(1, n * 1.6) * 0.38;
          gr = lerp(gr, 214, s);
          gG = lerp(gG, 228, s);
          gb = lerp(gb, 80, s);
        } else {
          const s = Math.min(1, -n * 1.7) * 0.5;
          gr = lerp(gr, 52, s);
          gG = lerp(gG, 112, s);
          gb = lerp(gb, 34, s);
        }
        // Lip: a bright rim inside the coast, then a dark edge line.
        const inside = -dist[k];
        if (inside < 2.4) {
          const s = 1 - inside / 2.4;
          gr = lerp(gr, 205, s * 0.55);
          gG = lerp(gG, 236, s * 0.55);
          gb = lerp(gb, 88, s * 0.55);
        }
        if (inside < 0.55) {
          gr *= 0.5;
          gG *= 0.6;
          gb *= 0.4;
        }
        if (alpha > 0) {
          r = lerp(r, gr, a);
          gg = lerp(gg, gG, a);
          bb = lerp(bb, gb, a);
          alpha = Math.max(alpha, a);
        } else {
          r = gr;
          gg = gG;
          bb = gb;
          alpha = a;
        }
      }
      const o = (j * W + i) * 4;
      out[o] = r;
      out[o + 1] = gg;
      out[o + 2] = bb;
      out[o + 3] = alpha * 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { c, x0: b.x0, y0: b.y0, w: W / K, h: H / K, y1: b.y1 };
}

// ---- Coast decals ---------------------------------------------------------------------------

/** Concept px per coast-sheet pixel; the sheet's anchor is the waterline, its lip 156 px above. */
const COAST_SCALE = 0.25;
const COAST_LIP = (240 - 84) * COAST_SCALE;

/** The front lip under x: the lowest point of the island's top (concept px), or null off the island. */
function frontLip(island: Island, x: number, y0: number, y1: number): number | null {
  for (let y = y1; y > y0; y -= 1) if (fieldAt(island, x, y) < 0) return y;
  return null;
}

/** The concept's coast stamped along an island's front: cliff faces with mossy lips, headlands at the
 * ends, rocks and surf at the foot. Painted over the procedural cliff, under everything on the land. */
function paintCoast(ctx: Ctx, island: Island, sheets: Sheets, onLand: (x: number, y: number) => boolean): void {
  const suffix = island.rock === "volcanic" ? "-volcanic" : "";
  const fronts = framesWithPrefix(sheets, "coast", "cliff-front-").filter((n) => n.endsWith("-volcanic") === !!suffix);
  if (!fronts.length) return;
  const pick = (prefix: string, r: () => number) => {
    const list = framesWithPrefix(sheets, "coast", prefix).filter((n) => n.endsWith("-volcanic") === !!suffix);
    return list.length ? list[Math.floor(r() * list.length)]! : null;
  };
  const b = islandBounds(island);
  const r = rng(island.seed ^ 0xc0a5);
  const scale = (island.cliff / 39) * COAST_SCALE;
  const step = 78 * (scale / COAST_SCALE) * 0.92;
  // Sample the lip along the island's width; stamp where the front runs roughly level.
  const xs: number[] = [];
  for (let x = b.x0 + 4; x < b.x1 - 4; x += 2) xs.push(x);
  const lips = xs.map((x) => frontLip(island, x, b.y0, b.y1));
  const lipAt = (x: number) => lips[Math.max(0, Math.min(xs.length - 1, Math.round((x - b.x0 - 4) / 2)))] ?? null;
  const land = xs.filter((_, i) => lips[i] !== null);
  if (!land.length) return;
  const left = land[0]!;
  const right = land[land.length - 1]!;
  const lip = (island.cliff / 39) * COAST_LIP;
  const surfs: Array<() => void> = [];
  for (let x = left + step * 0.35; x < right - step * 0.2; x += step * (0.9 + r() * 0.15)) {
    const y = lipAt(x);
    const yl = lipAt(x - step * 0.4);
    const yr = lipAt(x + step * 0.4);
    if (y === null || yl === null || yr === null) continue;
    // Only where the front is level enough for a face; steep bits keep the procedural cliff.
    if (Math.abs(yl - yr) > lip * 0.9) continue;
    const name = fronts[Math.floor(r() * fronts.length)]!;
    const f = frameOf(sheets, "coast", name);
    const ly = Math.max(y, yl, yr) - 1;
    drawFrame(ctx, f, x, ly + lip, scale, r() < 0.5);
    const foot = ly + lip;
    // Rocks and surf only where the cliff's foot is in the sea (not on a ledge below).
    if (onLand(x, foot + 4)) continue;
    if (r() < 0.35) {
      const o = pick("outcrop-", r);
      if (o) surfs.push(() => drawFrame(ctx, frameOf(sheets, "coast", o), x + (r() - 0.5) * step * 0.6, foot + 4 + r() * 6, scale * (0.55 + r() * 0.3), r() < 0.5));
    }
    const surf = framesWithPrefix(sheets, "coast", `surf-${Math.floor(r() * 4)}-0`)[0];
    if (surf) surfs.push(() => drawFrame(ctx, frameOf(sheets, "coast", surf), x, foot + 1, scale, r() < 0.5));
  }
  // Headlands at the ends.
  for (const [side, x] of [["left", left + 8], ["right", right - 8]] as const) {
    const y = lipAt(x);
    const name = pick(`cliff-corner-${side}-`, r);
    if (y === null || !name) continue;
    drawFrame(ctx, frameOf(sheets, "coast", name), x, y + lip, scale);
  }
  for (const s of surfs) s();
}

// ---- Rivers, falls, paths, fields ----------------------------------------------------------

function strokePath(ctx: Ctx, pts: Array<[number, number]>): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

function paintStrips(ctx: Ctx, scene: Scene, sheets: Sheets, opts: PaintOptions): void {
  const cobble = ctx.createPattern(frameCanvas(frameOf(sheets, "terrain", "dirt-cobble")), "repeat")!;
  cobble.setTransform(new DOMMatrix().scale(0.12, 0.12));
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const p of scene.paths) {
    strokePath(ctx, p.pts);
    ctx.strokeStyle = "rgba(60, 50, 30, 0.45)";
    ctx.lineWidth = p.width + 3;
    ctx.stroke();
    ctx.strokeStyle = cobble;
    ctx.lineWidth = p.width;
    ctx.stroke();
  }
  const wheat = ctx.createPattern(frameCanvas(frameOf(sheets, "theme-farm", "wheat")), "repeat")!;
  wheat.setTransform(new DOMMatrix().scale(0.22, 0.22));
  for (const f of scene.fields) {
    const [a, b] = f.pts;
    ctx.fillStyle = wheat;
    ctx.beginPath();
    ctx.roundRect(a[0], a[1] - f.width / 2, b[0] - a[0], f.width, 6);
    ctx.fill();
  }
  // Rivers: bright water with foamy banks.
  const sea = frameCanvas(frameOf(sheets, "water", "sea-1"));
  const water = ctx.createPattern(sea, "repeat")!;
  water.setTransform(new DOMMatrix().scale(0.16, 0.16));
  for (const r of scene.rivers) {
    strokePath(ctx, r.pts);
    ctx.strokeStyle = "rgba(40, 70, 40, 0.55)";
    ctx.lineWidth = r.width + 5;
    ctx.stroke();
    ctx.strokeStyle = "#d9f7ff";
    ctx.lineWidth = r.width + 1.5;
    ctx.stroke();
    ctx.strokeStyle = "#2f9fe6";
    ctx.lineWidth = r.width - 3;
    ctx.stroke();
    ctx.save();
    strokePath(ctx, r.pts);
    ctx.lineWidth = r.width - 3;
    ctx.globalCompositeOperation = "source-atop";
    ctx.restore();
    // Ripples along the stream.
    const rr = rng(Math.floor(r.pts[0][0] * 31 + r.pts[0][1]));
    for (let i = 1; i < r.pts.length; i++) {
      const [ax, ay] = r.pts[i - 1];
      const [bx, by] = r.pts[i];
      const len = Math.hypot(bx - ax, by - ay);
      for (let d = 0; d < len; d += 2.2) {
        const t = d / len;
        const off = (rr() - 0.5) * (r.width - 8);
        const x = ax + (bx - ax) * t + off;
        const y = ay + (by - ay) * t;
        ctx.strokeStyle = rr() < 0.4 ? "rgba(255,255,255,0.85)" : "rgba(150,230,255,0.8)";
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(x - 2.5, y);
        ctx.quadraticCurveTo(x, y - 1, x + 2.5, y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
  // Falls.
  const t = Math.floor(opts.t / 120) % 4;
  for (const fall of scene.falls) {
    const f = frameOf(sheets, "water", `waterfall-${t}`);
    const s = fall.width / f.w;
    const tile = f.h * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(fall.x - fall.width / 2, fall.top, fall.width, fall.bottom - fall.top);
    ctx.clip();
    for (let y = fall.top; y < fall.bottom; y += tile - 0.5) {
      ctx.drawImage(f.img, f.x, f.y, f.w, f.h, fall.x - fall.width / 2, y, fall.width, tile);
    }
    ctx.restore();
    const base = frameOf(sheets, "water", `waterfall-base-${t}`);
    const bs = (fall.width * 1.7) / base.w;
    drawFrame(ctx, base, fall.x, fall.bottom + 4, bs);
  }
}

// ---- Sprites -------------------------------------------------------------------------------

function paintShadow(ctx: Ctx, x: number, y: number, w: number, alpha: number): void {
  ctx.save();
  const g = ctx.createRadialGradient(x, y, 0, x, y, w / 2);
  g.addColorStop(0, `rgba(10, 30, 5, ${alpha})`);
  g.addColorStop(1, "rgba(10, 30, 5, 0)");
  ctx.fillStyle = g;
  ctx.translate(x, y);
  ctx.scale(1, 0.38);
  ctx.translate(-x, -y);
  ctx.beginPath();
  ctx.arc(x, y, w / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

const gradeCache = new Map<string, HTMLCanvasElement>();
function graded(f: Frame, grade: Grade, key: string): Frame {
  let c = gradeCache.get(key);
  if (!c) {
    c = frameCanvas(f);
    const g = c.getContext("2d")!;
    const d = g.getImageData(0, 0, c.width, c.height);
    gradePixels(d.data, grade);
    g.putImageData(d, 0, 0);
    gradeCache.set(key, c);
  }
  return { ...f, img: c, x: 0, y: 0 };
}

function paintSprite(ctx: Ctx, item: SpriteItem, sheets: Sheets): void {
  if (item.scale <= 0 || !hasFrame(sheets, item.sheet, item.frame)) return;
  let f = frameOf(sheets, item.sheet, item.frame);
  if (item.grade) f = graded(f, item.grade, `${item.sheet}/${item.frame}/${JSON.stringify(item.grade)}`);
  if (item.tint) f = tinted(f, item.tint, `${item.sheet}/${item.frame}/${item.tint}`);
  const fp = (f.meta.footprint as { w?: number; width?: number } | undefined) ?? {};
  const fw = (fp.w ?? fp.width ?? f.w * 0.7) * item.scale;
  if (item.shadow) paintShadow(ctx, item.x, item.y, fw * 1.05, item.shadow);
  drawFrame(ctx, f, item.x, item.y, item.scale, item.flip, item.alpha ?? 1);
}

export const ROBOT_SCALE = 0.21;

export function robotFrame(sheets: Sheets, colour: string, working: boolean, t: number, phase: number): Frame {
  const sheetColour = colour === "orange" || colour === "pearl" ? colour : "neutral";
  const frame = working ? `${sheetColour}-working-${Math.floor(t / 140 + phase) % 4}` : `${sheetColour}-idle-${Math.floor(t / 700 + phase) % 2}`;
  const f = frameOf(sheets, "robots", frame);
  return sheetColour === "neutral" ? tinted(f, colour, `robots/${frame}/${colour}`) : f;
}

function paintCamp(ctx: Ctx, booth: BoothItem, sheets: Sheets, opts: PaintOptions): void {
  const x0 = booth.x - booth.w / 2;
  paintShadow(ctx, booth.x, booth.y + 6, booth.w, 0.3);
  drawFrame(ctx, frameOf(sheets, "stalls", "camp"), x0 + 62, booth.y + 2, 0.19);

}

function paintBooth(ctx: Ctx, booth: BoothItem, sheets: Sheets, opts: PaintOptions): void {
  if (booth.camp) return paintCamp(ctx, booth, sheets, opts);
  const n = Math.max(1, booth.agents.length);
  const slots = boothSlots(n);
  const s = BOOTH.scale;
  const left = frameOf(sheets, "stalls", "booth-left");
  const mid = frameOf(sheets, "stalls", "booth-middle");
  const right = frameOf(sheets, "stalls", "booth-right");
  const widthPx = BOOTH.end * 2 + BOOTH.slot * slots;
  const x0 = booth.x - (widthPx * s) / 2;
  const y0 = booth.y - BOOTH.floor * s;
  const seed = Math.floor(booth.x * 7 + booth.y * 13);
  paintShadow(ctx, booth.x, booth.y + 12, widthPx * s * 1.15, 0.4);
  // One corner canopy behind the booth.
  if (hasFrame(sheets, "stalls", `awning-corner-${booth.awning}-${booth.awningSide}`)) {
    const aw = frameOf(sheets, "stalls", `awning-corner-${booth.awning}-${booth.awningSide}`);
    const ax = booth.awningSide === "left" ? x0 + BOOTH.end * s : x0 + (widthPx - BOOTH.end) * s;
    drawFrame(ctx, aw, ax, y0 + 32 * s, s);
  }
  ctx.drawImage(left.img, left.x, left.y, left.w, left.h, x0, y0, left.w * s, left.h * s);
  for (let i = 0; i < slots; i++) {
    ctx.drawImage(mid.img, mid.x, mid.y, mid.w, mid.h, x0 + (BOOTH.end + i * BOOTH.slot) * s - 0.15, y0, mid.w * s + 0.3, mid.h * s);
  }
  ctx.drawImage(right.img, right.x, right.y, right.w, right.h, x0 + (BOOTH.end + slots * BOOTH.slot) * s - 0.15, y0, right.w * s, right.h * s);
  // Goods in empty slots, as the concept's single-robot booths.
  const first = (slots - n) / 2;
  if (slots > n) {
    const goods = ["market-goods-table", "potted-plant", "sack-0", "barrel-1"];
    for (let i = 0; i < slots; i++) {
      if (i >= first && i < first + n) continue;
      const gx = x0 + (BOOTH.end + i * BOOTH.slot + BOOTH.slot / 2) * s;
      const f = frameOf(sheets, "props", goods[(seed + i) % goods.length]);
      drawFrame(ctx, f, gx, booth.y + 1, 0.2);
    }
  }

  // Side props outside both ends.
  const lp = frameOf(sheets, "stalls", `booth-side-props-left-${1 + (seed % 2)}`);
  const rp = frameOf(sheets, "stalls", `booth-side-props-right-${1 + ((seed >> 1) % 2)}`);
  drawFrame(ctx, lp, x0 - 20 * s, y0 + BOOTH.height * s, s);
  drawFrame(ctx, rp, x0 + (widthPx + 20) * s, y0 + BOOTH.height * s, s);
}

// ---- Scatter -------------------------------------------------------------------------------

const TREES: Record<Theme, Array<[string, string, number, number]>> = {
  // sheet, frame, weight, scale
  forest: [
    ["theme-forest", "deciduous-0", 3, 0.145],
    ["theme-forest", "deciduous-1", 3, 0.145],
    ["theme-forest", "deciduous-2", 2, 0.145],
    ["theme-forest", "deciduous-3", 2, 0.145],
    ["theme-forest", "pine-0", 2, 0.17],
    ["theme-forest", "pine-1", 2, 0.17],
    ["theme-forest", "pine-3", 1, 0.17],
    ["theme-forest", "blossom-0", 1, 0.17],
  ],
  farm: [
    ["theme-forest", "deciduous-0", 3, 0.145],
    ["theme-forest", "deciduous-1", 3, 0.145],
    ["theme-forest", "deciduous-3", 2, 0.145],
    ["theme-farm", "autumn-tree-0", 2, 0.16],
    ["theme-farm", "autumn-tree-1", 1, 0.16],
    ["theme-forest", "blossom-1", 1, 0.17],
    ["theme-forest", "pine-1", 1, 0.17],
  ],
  volcanic: [
    ["theme-forest", "deciduous-0", 3, 0.18],
    ["theme-forest", "deciduous-2", 2, 0.18],
    ["theme-forest", "pine-2", 1, 0.16],
    ["theme-volcanic", "charred-tree-0", 1, 0.18],
    ["theme-volcanic", "dark-rock-1", 1, 0.17],
  ],
};

const PINES: Array<[string, string, number, number]> = [
  ["theme-forest", "pine-0", 2, 0.15],
  ["theme-forest", "pine-1", 2, 0.155],
  ["theme-forest", "pine-2", 1, 0.15],
  ["theme-forest", "pine-3", 2, 0.155],
];
const TREE_GRADE: Grade = { brightness: 0.7, saturate: 1.2, contrast: 1.12, hue: 16 };
const LEAF_GRADE: Grade = { brightness: 0.97, saturate: 1.35, contrast: 1.16, hue: -4 };

const SMALL: Record<Theme, Array<[string, string, number, number]>> = {
  forest: [
    ["theme-forest", "bush-0", 3, 0.17],
    ["theme-forest", "bush-1", 2, 0.17],
    ["theme-forest", "bush-2", 2, 0.17],
    ["theme-forest", "flowers-0", 2, 0.17],
    ["theme-forest", "flowers-1", 2, 0.17],
    ["theme-forest", "flowers-2", 1, 0.17],
    ["theme-forest", "boulder-1", 1, 0.14],
  ],
  farm: [
    ["theme-forest", "bush-0", 3, 0.17],
    ["theme-forest", "bush-2", 2, 0.17],
    ["theme-forest", "flowers-0", 2, 0.17],
    ["theme-forest", "flowers-2", 2, 0.17],
    ["theme-forest", "boulder-1", 1, 0.14],
  ],
  volcanic: [
    ["theme-forest", "bush-0", 2, 0.17],
    ["theme-forest", "flowers-0", 2, 0.17],
    ["theme-forest", "flowers-1", 2, 0.17],
    ["theme-volcanic", "dark-rock-0", 1, 0.15],
    ["theme-volcanic", "crystal-1", 1, 0.12],
  ],
};

function pick(list: Array<[string, string, number, number]>, r: number): [string, string, number, number] {
  const total = list.reduce((a, b) => a + b[2], 0);
  let x = r * total;
  for (const e of list) {
    x -= e[2];
    if (x <= 0) return e;
  }
  return list[list.length - 1];
}

function reservedAt(scene: Scene, x: number, y: number, pad: number): boolean {
  for (const r of scene.reserved) {
    if (x > r.x0 - pad && x < r.x1 + pad && y > r.y0 - pad && y < r.y1 + pad) return true;
  }
  return false;
}

function onStrip(scene: Scene, x: number, y: number, pad: number): boolean {
  for (const s of [...scene.paths, ...scene.rivers]) {
    for (let i = 1; i < s.pts.length; i++) {
      const [ax, ay] = s.pts[i - 1];
      const [bx, by] = s.pts[i];
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
      if (Math.hypot(ax + dx * t - x, ay + dy * t - y) < s.width / 2 + pad) return true;
    }
  }
  for (const f of scene.falls) if (Math.abs(x - f.x) < f.width / 2 + pad && y > f.top - 30 && y < f.bottom + 10) return true;
  return false;
}

function insideOther(scene: Scene, index: number, x: number, y: number): boolean {
  // A point covered by a later-drawn island (which would hide or cut the sprite).
  for (let i = 0; i < scene.islands.length; i++) {
    if (i === index) continue;
    const isl = scene.islands[i];
    if (isl.z > scene.islands[index].z && fieldAt(isl, x, y) < 4) return true;
  }
  return false;
}

let scattered: SpriteItem[] | undefined;
let scatteredFor: Scene | undefined;

/** Canopy masses (many trees as one sprite, as the concept's forests) for a theme, if the sheet has them. */
function massesFor(sheets: Sheets, theme: Theme, back: boolean): string[] {
  const own =
    theme === "farm"
      ? [...framesWithPrefix(sheets, "foliage", "autumn-mass-"), ...framesWithPrefix(sheets, "foliage", "forest-mass-")]
      : theme === "volcanic"
        ? [...framesWithPrefix(sheets, "foliage", "volcanic-mass-"), ...framesWithPrefix(sheets, "foliage", "forest-mass-")]
        : [...framesWithPrefix(sheets, "foliage", "forest-mass-"), ...framesWithPrefix(sheets, "foliage", "blossom-mass-")];
  return back && theme !== "farm" ? [...framesWithPrefix(sheets, "foliage", "forest-fir-"), ...own] : own;
}

/** Concept px per foliage-sheet pixel (the sheet is drawn at 4×). */
const MASS_SCALE = 0.25;

export function scatter(scene: Scene, sheets: Sheets): SpriteItem[] {
  if (scatteredFor === scene && scattered) return scattered;
  const out: SpriteItem[] = [];
  /** Ground the masses cover (ellipses), so single trees don't crowd them. */
  const covered: Array<{ x: number; y: number; rx: number; ry: number }> = [];
  const isCovered = (x: number, y: number) => covered.some((c) => ((x - c.x) / c.rx) ** 2 + ((y - c.y) / c.ry) ** 2 < 1);
  for (const area of scene.scatter) {
    const island = scene.islands[area.island];
    if (!island || island.boxes.length === 0) continue;
    const b = islandBounds(island);
    const r = rng(island.seed ^ 0x3a55);
    const step = 34;
    for (let y = Math.max(b.y0, area.area.y0); y < Math.min(b.y1, area.area.y1); y += step * 0.6) {
      for (let x = Math.max(b.x0, area.area.x0); x < Math.min(b.x1, area.area.x1); x += step) {
        const px = x + (r() - 0.5) * step;
        const py = y + (r() - 0.5) * step * 0.5;
        const back = py < area.area.y0 + 150;
        const list = massesFor(sheets, area.theme, back);
        const roll = r();
        if (!list.length || roll > 0.8) continue;
        const name = list[Math.floor(r() * list.length)]!;
        const f = frameOf(sheets, "foliage", name);
        const s = MASS_SCALE * (0.85 + r() * 0.25);
        const half = (f.w * s) / 2;
        const deep = f.h * s * 0.28;
        // Its whole ground on land, clear of buildings, paths and the coast's front.
        const ok = [-half, 0, half].every((dx) => {
          const gx = px + dx * 0.85;
          return (
            fieldAt(island, gx, py) < -6 &&
            fieldAt(island, gx, py + 26) < -1 &&
            fieldAt(island, gx, py - deep) < -2 &&
            !reservedAt(scene, gx, py, 6) &&
            !reservedAt(scene, gx, py - deep, 4) &&
            !onStrip(scene, gx, py, 10) &&
            !insideOther(scene, area.island, gx, py)
          );
        });
        if (!ok || isCovered(px, py)) continue;
        covered.push({ x: px, y: py - deep / 2, rx: half * 0.9, ry: deep * 0.9 + 6 });
        out.push({ kind: "sprite", sheet: "foliage", frame: name, x: px, y: py, scale: s, flip: r() < 0.5, shadow: 0.45 });
      }
    }
  }
  for (const area of scene.scatter) {
    const island = scene.islands[area.island];
    if (!island || island.boxes.length === 0) continue;
    const b = islandBounds(island);
    const r = rng(island.seed ^ 0x51ed);
    const step = 10.5;
    for (let y = Math.max(b.y0, area.area.y0); y < Math.min(b.y1, area.area.y1); y += step * 0.8) {
      for (let x = Math.max(b.x0, area.area.x0); x < Math.min(b.x1, area.area.x1); x += step) {
        const px = x + (r() - 0.5) * step;
        const py = y + (r() - 0.5) * step * 0.8;
        const d = fieldAt(island, px, py);
        const roll = r();
        const roll2 = r();
        if (d > -5) continue;
        if (insideOther(scene, area.island, px, py) || isCovered(px, py)) continue;
        const density = fbm(px / 70, py / 70, island.seed + 77, 2);
        const front = fieldAt(island, px, py + 28) > -2;
        const backZone = py < area.area.y0 + 150;
        const treeOdds = backZone ? 0.95 + density * 0.3 : 0.6 + density * 0.4;
        if (!front && !reservedAt(scene, px, py, 4) && !onStrip(scene, px, py, 9) && d < -8 && roll < treeOdds) {
          // Back rows (away from the viewer) lean to pines, as the concept's forests.
          const back = py < area.area.y0 + 150 && area.theme !== "farm";
          const pine = back && r() < (area.theme === "forest" ? 0.85 : 0.5);
          const list = pine ? PINES : TREES[area.theme];
          const [sheet, frame, , scale] = pick(list, roll2);
          out.push({ kind: "sprite", sheet, frame, x: px, y: py, scale: scale * (0.8 + r() * 0.35), flip: r() < 0.5, shadow: 0.55, grade: pine ? TREE_GRADE : LEAF_GRADE });
        } else if (!reservedAt(scene, px, py, -3) && !onStrip(scene, px, py, 2) && roll < (front ? 0.35 : 0.9)) {
          // Near the coast's front: fence runs and crates, as along the concept's ledges.
          if (front && r() < 0.18) {
            const prop = area.theme === "volcanic" ? ["props", "crate-0"] : r() < 0.7 ? ["props", "fence"] : ["props", "barrel-0"];
            out.push({ kind: "sprite", sheet: prop[0]!, frame: prop[1]!, x: px, y: py, scale: prop[1] === "fence" ? 0.26 : 0.2, flip: r() < 0.5, shadow: 0.25 });
            continue;
          }
          const beds = [...framesWithPrefix(sheets, "foliage", "flower-bed-"), ...framesWithPrefix(sheets, "foliage", "bush-row-")];
          if (beds.length && r() < 0.35) {
            const name = beds[Math.floor(r() * beds.length)]!;
            out.push({ kind: "sprite", sheet: "foliage", frame: name, x: px, y: py, scale: name.startsWith("bush") ? 0.16 : 0.2, flip: r() < 0.5, shadow: 0.2 });
            continue;
          }
          const [sheet, frame, , scale] = pick(SMALL[area.theme], roll2);
          out.push({ kind: "sprite", sheet, frame, x: px, y: py, scale: scale * (0.8 + r() * 0.35), flip: r() < 0.5, shadow: 0.15 });
        }
      }
    }
  }
  // Grass tufts and flower specks over open ground, under everything else.
  for (const area of scene.scatter) {
    const island = scene.islands[area.island];
    if (!island || island.boxes.length === 0) continue;
    const b = islandBounds(island);
    const r = rng(island.seed ^ 0x7a11);
    for (let y = Math.max(b.y0, area.area.y0); y < Math.min(b.y1, area.area.y1); y += 6) {
      for (let x = b.x0; x < b.x1; x += 7) {
        const px = x + (r() - 0.5) * 7;
        const py = y + (r() - 0.5) * 6;
        const roll = r();
        if (fieldAt(island, px, py) > -3 || insideOther(scene, area.island, px, py)) continue;
        if (reservedAt(scene, px, py, -6) || onStrip(scene, px, py, 1)) continue;
        if (roll < 0.45) out.push({ kind: "sprite", sheet: "terrain", frame: "grass-tuft", x: px, y: py, scale: 0.09 + r() * 0.05, flip: r() < 0.5, z: py - 400 });
        else if (roll < 0.53) out.push({ kind: "sprite", sheet: "terrain", frame: "flowers", x: px, y: py, scale: 0.08 + r() * 0.04, flip: r() < 0.5, z: py - 400 });
      }
    }
  }
  scattered = out;
  scatteredFor = scene;
  return out;
}

export function seaRocks(scene: Scene): SpriteItem[] {
  const out: SpriteItem[] = [];
  const r = rng(321);
  for (let i = 0; i < 1100; i++) {
    const x = r() * scene.w;
    const y = 120 + r() * (scene.h - 120);
    let near = Infinity;
    for (const isl of scene.islands) {
      if (isl.boxes.length === 0) continue;
      near = Math.min(near, fieldAt(isl, x, y - isl.cliff));
    }
    if (near < 10 || near > 34 || r() < 0.3) continue;
    out.push({ kind: "sprite", sheet: "terrain", frame: `sea-rock-${1 + Math.floor(r() * 3)}`, x, y, scale: 0.16 + r() * 0.16, flip: r() < 0.5 });
  }
  return out;
}

function clouds(scene: Scene): SpriteItem[] {
  const out: SpriteItem[] = [];
  const r = rng(99);
  for (let y = 120; y < scene.h - 300; y += 170) {
    out.push({ kind: "sprite", sheet: "terrain", frame: `cloud-${Math.floor(r() * 3)}`, x: 20 + r() * 30, y: y + r() * 40, scale: 0.2, alpha: 0.95 });
    out.push({ kind: "sprite", sheet: "terrain", frame: `cloud-${Math.floor(r() * 3)}`, x: scene.w - 20 - r() * 30, y: y + 60 + r() * 40, scale: 0.2, alpha: 0.95 });
  }
  return out;
}

// ---- Links, labels -------------------------------------------------------------------------

function nineSlice(ctx: Ctx, sheets: Sheets, prefix: string, cx: number, cy: number, w: number, h: number, inset: number): void {
  const l = frameOf(sheets, "ui-world", `${prefix}-left`);
  const m = frameOf(sheets, "ui-world", `${prefix}-middle`);
  const r = frameOf(sheets, "ui-world", `${prefix}-right`);
  const s = h / (l.h - inset * 2);
  const top = cy - h / 2 - inset * s;
  const fh = l.h * s;
  const x0 = cx - w / 2;
  const lw = l.w * s;
  const rw = r.w * s;
  ctx.save();
  ctx.shadowColor = "rgba(20, 10, 0, 0.45)";
  ctx.shadowBlur = 3 * 4;
  ctx.shadowOffsetY = 1.5 * 4;
  ctx.drawImage(l.img, l.x, l.y, l.w, l.h, x0, top, lw, fh);
  ctx.drawImage(m.img, m.x, m.y, m.w, m.h, x0 + lw - 0.4, top, w - lw - rw + 0.8, fh);
  ctx.drawImage(r.img, r.x, r.y, r.w, r.h, x0 + w - rw, top, rw, fh);
  ctx.restore();
}

function paintLabel(ctx: Ctx, label: LabelItem, sheets: Sheets): void {
  nineSlice(ctx, sheets, "label", label.x, label.y, label.w, label.h, 20);
  ctx.save();
  ctx.font = `800 ${label.size}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2a1d12";
  ctx.fillText(label.text, label.x, label.y + 0.5, label.w - 18);
  ctx.restore();
}

function paintPlaque(ctx: Ctx, plaque: PlaqueItem, sheets: Sheets): void {
  nineSlice(ctx, sheets, "host-plaque", plaque.x, plaque.y, plaque.w, plaque.h, 28);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2a1d12";
  ctx.font = `800 23px ${FONT}`;
  ctx.fillText(plaque.text, plaque.x, plaque.y - (plaque.stats ? 8 : 0), plaque.w - 24);
  if (plaque.stats) {
    ctx.font = `700 11.5px ${FONT}`;
    const tw = ctx.measureText(plaque.stats).width;
    const sx = plaque.x - tw / 2 + 7;
    ctx.fillText(plaque.stats, sx + tw / 2, plaque.y + 13);
    ctx.fillStyle = plaque.online ? "#3fd23a" : "#9a9a9a";
    ctx.strokeStyle = "#1d5a12";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.arc(sx - 9, plaque.y + 13, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** One period of the open sea exactly as a painting shows it (frame 0, lifted and graded the same),
 * `k` pixels per concept pixel, so the app can tile it past the painted hosts without a seam.
 * Its period in concept px is `seaPeriod(sheets)`; tiles line up with world (0, 0). */
export function overworldSeaTile(sheets: Sheets, k: number): HTMLCanvasElement | null {
  const calm = framesWithPrefix(sheets, "sea2", "sea-calm-");
  if (!calm.length) return null;
  const f = frameOf(sheets, "sea2", calm[0]!);
  const period = f.w * SEA_TEXTURE_SCALE;
  const c = canvas(period * k, period * k);
  const g = c.getContext("2d")!;
  g.imageSmoothingQuality = "high";
  g.drawImage(f.img, f.x, f.y, f.w, f.h, 0, 0, c.width, c.height);
  g.globalCompositeOperation = "screen";
  g.fillStyle = "rgb(4, 34, 52)";
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = "source-over";
  const d = g.getImageData(0, 0, c.width, c.height);
  gradePixels(d.data, FINAL_GRADE);
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = TONE[d.data[i]!]!;
    d.data[i + 1] = TONE[d.data[i + 1]!]!;
    d.data[i + 2] = TONE[d.data[i + 2]!]!;
  }
  g.putImageData(d, 0, 0);
  watercolour(c);
  return c;
}

/** A watercolour softening: a blurred wash laid over the painting, so edges bleed softly and colours
 * stay rich without the harsh contrast. (A downscale and smooth upscale stands in for a blur, which
 * WebKit's canvas filters don't do.) */
function watercolour(c: HTMLCanvasElement): void {
  const small = canvas(Math.max(1, c.width / 6), Math.max(1, c.height / 6));
  const sg = small.getContext("2d")!;
  sg.imageSmoothingQuality = "high";
  sg.drawImage(c, 0, 0, small.width, small.height);
  const g = c.getContext("2d")!;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = "high";
  // Colours bleed into each other a little.
  g.globalAlpha = 0.28;
  g.drawImage(small, 0, 0, c.width, c.height);
  // A soft luminous wash, as light through paper.
  g.globalCompositeOperation = "soft-light";
  g.globalAlpha = 0.35;
  g.drawImage(small, 0, 0, c.width, c.height);
  g.restore();
}

export function seaPeriod(sheets: Sheets): number {
  const calm = framesWithPrefix(sheets, "sea2", "sea-calm-");
  return calm.length ? frameOf(sheets, "sea2", calm[0]!).w * SEA_TEXTURE_SCALE : 0;
}
