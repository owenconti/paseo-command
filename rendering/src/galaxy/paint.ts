/** Galaxy artwork: textured planet spheres, rings, atmospheres, stations,
 * satellites, rocks, stars and nebulae, all painted to canvases at load. */
import { random, seedOf } from "../world";
import type { Family, Region } from "./layout";

const hex = (c: number) => `#${c.toString(16).padStart(6, "0")}`;
const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255] as const;

export function pixels(image: HTMLImageElement | HTMLCanvasElement): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

const CLOUDY: Partial<Record<Family, number>> = {
  ocean: 0.85,
  forest: 0.8,
  ice: 0.35,
  desert: 0.25,
};
export const ATMOSPHERE: Partial<Record<Family, number>> = {
  ocean: 0x74b8ff,
  forest: 0x8cc4ff,
  ice: 0xc8e6ff,
  desert: 0xf2c48c,
  storm: 0xa8c0dc,
  ringedgas: 0xf0d2a0,
  volcanic: 0xff8a4a,
};

/**
 * A planet seen from the camera: an orthographic sphere sampled bilinearly
 * from an equirectangular surface map, so it stays smooth when magnified. The
 * per-pixel mapping and lighting are computed once; turning the planet only
 * re-samples the surface.
 */
export class PlanetSurface {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private index: Int32Array;
  private row: Int32Array;
  private below: Int32Array;
  private fall: Float32Array;
  private col: Float32Array;
  private shade: Float32Array;
  private alpha: Uint8ClampedArray;
  private cloudAmount: number;
  /** Progress of an incremental repaint, in pixels painted. */
  private next = 0;
  constructor(
    readonly size: number,
    private surface: ImageData,
    private clouds: ImageData | null,
    readonly family: Family,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext("2d")!;
    this.image = this.ctx.createImageData(size, size);
    this.cloudAmount = clouds ? (CLOUDY[family] ?? 0) : 0;
    const index: number[] = [],
      row: number[] = [],
      below: number[] = [],
      fall: number[] = [],
      col: number[] = [],
      shade: number[] = [],
      alpha: number[] = [];
    const W = surface.width,
      H = surface.height;
    // Light from the upper left, a little towards the camera.
    const L = [-0.55, -0.48, 0.68];
    const n = Math.hypot(...L);
    const lx = L[0]! / n,
      ly = L[1]! / n,
      lz = L[2]! / n;
    const half = size / 2;
    // A slight axial tilt presents a broad face rather than a polar view.
    const tilt = 0.32,
      ct = Math.cos(tilt),
      st = Math.sin(tilt);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const nx = (x + 0.5 - half) / half,
          ny = (y + 0.5 - half) / half;
        const d = Math.hypot(nx, ny);
        if (d > 1) continue;
        const nz = Math.sqrt(Math.max(0, 1 - d * d));
        // Rotate the view about x to tilt the axis toward the camera.
        const ty = ny * ct - nz * st,
          tz = ny * st + nz * ct;
        const lat = Math.asin(Math.max(-1, Math.min(1, -ty)));
        const lon = Math.atan2(nx, tz);
        const lambert = Math.max(0, nx * lx + ny * ly + nz * lz);
        index.push((y * size + x) * 4);
        const v = Math.max(0, Math.min(H - 1, (0.5 - lat / Math.PI) * H - 0.5));
        const r0 = Math.floor(v);
        row.push(r0 * W);
        below.push(Math.min(H - 1, r0 + 1) * W);
        fall.push(v - r0);
        col.push((lon / (Math.PI * 2) + 0.5) * W - 0.5 + W);
        shade.push(0.07 + 1.08 * Math.pow(lambert, 0.85) * (0.75 + 0.25 * nz));
        alpha.push(Math.max(0, Math.min(1, (1 - d) * half * 1.4)) * 255);
      }
    this.index = Int32Array.from(index);
    this.row = Int32Array.from(row);
    this.below = Int32Array.from(below);
    this.fall = Float32Array.from(fall);
    this.col = Float32Array.from(col);
    this.shade = Float32Array.from(shade);
    this.alpha = Uint8ClampedArray.from(alpha);
  }
  /** Paint the planet turned by `turn` revolutions, its clouds by `drift`. */
  render(turn: number, drift: number) {
    this.paint(turn, drift, 0, this.index.length);
    this.next = 0;
    this.ctx.putImageData(this.image, 0, 0);
  }
  /** Continue a repaint spread over frames, painting up to `budget` pixels.
   * The canvas is updated only when the whole planet has been repainted, and
   * returns true then. Rotation is slow enough that the frames never tear. */
  step(turn: number, drift: number, budget: number): boolean {
    const end = Math.min(this.index.length, this.next + budget);
    this.paint(turn, drift, this.next, end);
    this.next = end;
    if (end < this.index.length) return false;
    this.next = 0;
    this.ctx.putImageData(this.image, 0, 0);
    return true;
  }
  private paint(turn: number, drift: number, from: number, to: number) {
    const W = this.surface.width;
    const src = this.surface.data,
      out = this.image.data,
      cloud = this.clouds?.data,
      amount = this.cloudAmount,
      volcanic = this.family === "volcanic";
    const offset = (((turn % 1) + 1) % 1) * W,
      cloudOffset = (((drift % 1) + 1) % 1) * W;
    for (let i = from; i < to; i++) {
      const top = this.row[i]!,
        bottom = this.below[i]!,
        fy = this.fall[i]!;
      const c = this.col[i]!;
      // Bilinear weights of the four surrounding texels (columns wrap).
      const u = (c + offset) % W,
        x0 = u | 0,
        x1 = (x0 + 1) % W,
        fx = u - x0;
      const w00 = (1 - fx) * (1 - fy),
        w01 = fx * (1 - fy),
        w10 = (1 - fx) * fy,
        w11 = fx * fy;
      const a00 = (top + x0) * 4,
        a01 = (top + x1) * 4,
        a10 = (bottom + x0) * 4,
        a11 = (bottom + x1) * 4;
      let r = src[a00]! * w00 + src[a01]! * w01 + src[a10]! * w10 + src[a11]! * w11,
        g = src[a00 + 1]! * w00 + src[a01 + 1]! * w01 + src[a10 + 1]! * w10 + src[a11 + 1]! * w11,
        b = src[a00 + 2]! * w00 + src[a01 + 2]! * w01 + src[a10 + 2]! * w10 + src[a11 + 2]! * w11;
      const shade = this.shade[i]!;
      if (cloud && amount) {
        const cu = (c + cloudOffset) % W,
          c0 = cu | 0,
          c1 = (c0 + 1) % W,
          cx = cu - c0;
        const lum =
          ((cloud[(top + c0) * 4]! * (1 - cx) + cloud[(top + c1) * 4]! * cx) * (1 - fy) +
            (cloud[(bottom + c0) * 4]! * (1 - cx) + cloud[(bottom + c1) * 4]! * cx) * fy) /
          255;
        const a = Math.min(1, Math.pow(lum, 1.6) * amount * 1.2);
        r += (235 - r) * a;
        g += (240 - g) * a;
        b += (246 - b) * a;
      }
      let lr = r * shade,
        lg = g * shade,
        lb = b * shade;
      // Lava glows on the night side.
      if (volcanic && r > 150 && r > g * 1.5) {
        const glow = Math.min(1, (r - g) / 160);
        lr = Math.max(lr, r * glow);
        lg = Math.max(lg, g * glow * 0.8);
        lb = Math.max(lb, b * glow * 0.5);
      }
      const o = this.index[i]!;
      out[o] = lr;
      out[o + 1] = lg;
      out[o + 2] = lb;
      out[o + 3] = this.alpha[i]!;
    }
  }
}

/** A soft glow just outside the planet's limb. Drawn for a unit planet at `size`. */
export function atmosphere(color: number, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2,
    R = size / 2 / 1.18;
  const [r, g, b] = rgb(color);
  const grad = ctx.createRadialGradient(c, c, R * 0.9, c, c, R * 1.18);
  grad.addColorStop(0, `rgba(${r},${g},${b},0)`);
  grad.addColorStop(0.42, `rgba(${r},${g},${b},.38)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},.22)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** A planetary ring as a flattened annulus; its upper half passes behind the planet. */
export function ring(family: Family, size: number, seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const c = size / 2,
    outer = size / 2,
    inner = outer * 0.62;
  const rng = random(seed);
  const storm = family === "storm";
  // Band spacing is tuned for a 512 px ring.
  const px = size / 512;
  ctx.save();
  ctx.translate(c, c);
  ctx.scale(1, 0.3);
  for (let rad = inner; rad < outer; rad += 1.2 * px) {
    const t = (rad - inner) / (outer - inner);
    const band = 0.45 + 0.55 * Math.sin(t * 38 + rng() * 0.4) * Math.sin(t * 9 + 1.3);
    const fade = Math.sin(t * Math.PI);
    const a = Math.max(0, (storm ? 0.32 : 0.55) * fade * (0.55 + 0.45 * band));
    ctx.strokeStyle = storm ? `rgba(196,212,226,${a})` : `rgba(${206 + t * 30},${180 + t * 20},${140 + t * 10},${a})`;
    ctx.lineWidth = 1.6 * px;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  return canvas;
}

/** The workspace space station, seen from above: habitat ring, hub, truss, solar arrays. */
export function station(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const k = size / 160;
  ctx.scale(k, k);
  const panel = (x: number, y: number, w: number, h: number) => {
    const grad = ctx.createLinearGradient(x, y, x + w, y + h);
    grad.addColorStop(0, "#22378c");
    grad.addColorStop(1, "#3a63cc");
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(170,196,255,.55)";
    ctx.lineWidth = 0.8;
    for (let gx = x; gx <= x + w + 0.1; gx += w / 4) {
      ctx.beginPath();
      ctx.moveTo(gx, y);
      ctx.lineTo(gx, y + h);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
    ctx.strokeStyle = "#cfd6e2";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(x, y, w, h);
  };
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 6;
  // Truss.
  ctx.fillStyle = "#9aa1ab";
  ctx.fillRect(77, 10, 6, 140);
  ctx.strokeStyle = "#5b616b";
  ctx.lineWidth = 1;
  for (let y = 14; y < 148; y += 8) {
    ctx.beginPath();
    ctx.moveTo(77, y);
    ctx.lineTo(83, y + 8);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Solar arrays.
  panel(40, 18, 34, 15);
  panel(86, 18, 34, 15);
  panel(40, 127, 34, 15);
  panel(86, 127, 34, 15);
  // Radiators.
  ctx.fillStyle = "#eef0f2";
  ctx.fillRect(52, 40, 22, 10);
  ctx.fillRect(86, 110, 22, 10);
  // Habitat ring.
  ctx.shadowColor = "rgba(0,0,0,.55)";
  ctx.shadowBlur = 5;
  ctx.strokeStyle = "#e8e6df";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(80, 80, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#e29a3a";
  ctx.lineWidth = 9;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + 0.2;
    ctx.beginPath();
    ctx.arc(80, 80, 30, a, a + 0.2);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(60,60,64,.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(80, 80, 25.5, 0, Math.PI * 2);
  ctx.arc(80, 80, 34.5, 0, Math.PI * 2);
  ctx.stroke();
  // Spokes and hub.
  ctx.strokeStyle = "#b9bec6";
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    ctx.beginPath();
    ctx.moveTo(80 + Math.cos(a) * 10, 80 + Math.sin(a) * 10);
    ctx.lineTo(80 + Math.cos(a) * 26, 80 + Math.sin(a) * 26);
    ctx.stroke();
  }
  const hub = ctx.createRadialGradient(77, 77, 2, 80, 80, 12);
  hub.addColorStop(0, "#f3f1ea");
  hub.addColorStop(1, "#8d9098");
  ctx.fillStyle = hub;
  ctx.beginPath();
  ctx.arc(80, 80, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#c9a14e";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  return canvas;
}

/** A small satellite: gold-foil bus with its provider's colour band and two solar wings. */
export function satellite(size: number, color: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const k = size / 96;
  ctx.scale(k, k);
  const wing = (x: number) => {
    const grad = ctx.createLinearGradient(x, 0, x + 30, 0);
    grad.addColorStop(0, "#23388e");
    grad.addColorStop(1, "#3d68d2");
    ctx.fillStyle = grad;
    ctx.fillRect(x, 42, 30, 12);
    ctx.strokeStyle = "rgba(176,200,255,.6)";
    ctx.lineWidth = 0.8;
    for (let gx = x + 7.5; gx < x + 30; gx += 7.5) {
      ctx.beginPath();
      ctx.moveTo(gx, 42);
      ctx.lineTo(gx, 54);
      ctx.stroke();
    }
    ctx.strokeStyle = "#d4d9e2";
    ctx.lineWidth = 1;
    ctx.strokeRect(x, 42, 30, 12);
  };
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 4;
  ctx.fillStyle = "#a4a9b2";
  ctx.fillRect(10, 47, 76, 2.4);
  ctx.shadowBlur = 0;
  wing(8);
  wing(58);
  const bus = ctx.createLinearGradient(38, 36, 58, 60);
  bus.addColorStop(0, "#f0d28a");
  bus.addColorStop(0.5, "#c08e3e");
  bus.addColorStop(1, "#7a5222");
  ctx.fillStyle = bus;
  ctx.fillRect(38, 37, 20, 22);
  ctx.fillStyle = hex(color);
  ctx.fillRect(38, 45, 20, 6);
  ctx.strokeStyle = "rgba(40,26,10,.7)";
  ctx.lineWidth = 1;
  ctx.strokeRect(38, 37, 20, 22);
  // Dish.
  ctx.fillStyle = "#e9ecef";
  ctx.beginPath();
  ctx.ellipse(48, 32, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = hex(color);
  ctx.lineWidth = 1.4;
  ctx.stroke();
  return canvas;
}

/** A small decorative rock: an irregular cratered body. */
export function rock(size: number, seed: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rng = random(seed);
  const c = size / 2,
    R = size * 0.42;
  ctx.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI * 2,
      r = R * (0.78 + rng() * 0.22);
    const x = c + Math.cos(a) * r,
      y = c + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const tone = 70 + rng() * 40;
  const grad = ctx.createRadialGradient(c - R * 0.4, c - R * 0.4, R * 0.1, c, c, R * 1.1);
  grad.addColorStop(0, `rgb(${tone + 70},${tone + 66},${tone + 60})`);
  grad.addColorStop(1, `rgb(${tone * 0.35},${tone * 0.33},${tone * 0.32})`);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.save();
  ctx.clip();
  for (let i = 0; i < 5; i++) {
    const x = c + (rng() - 0.5) * R * 1.4,
      y = c + (rng() - 0.5) * R * 1.4,
      r = R * (0.08 + rng() * 0.16);
    ctx.fillStyle = "rgba(20,18,16,.35)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,250,240,.12)";
    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return canvas;
}

/** A seamless tile of stars over transparency. */
export function stars(size: number, seed: string, count: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rng = random(seedOf(seed));
  for (let i = 0; i < count; i++) {
    const x = rng() * size,
      y = rng() * size,
      big = rng() > 0.96,
      r = big ? 1.4 + rng() * 1.6 : 0.4 + rng() * 0.9,
      warm = rng();
    const a = big ? 0.85 : 0.25 + rng() * 0.6;
    const color = warm > 0.7 ? `255,226,196` : warm < 0.2 ? `200,220,255` : `240,240,236`;
    for (const dx of [0, ...(x < 4 ? [size] : []), ...(x > size - 4 ? [-size] : [])])
      for (const dy of [0, ...(y < 4 ? [size] : []), ...(y > size - 4 ? [-size] : [])]) {
        if (big) {
          const g = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r * 3);
          g.addColorStop(0, `rgba(${color},${a})`);
          g.addColorStop(1, `rgba(${color},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(x + dx - r * 3, y + dy - r * 3, r * 6, r * 6);
        }
        ctx.fillStyle = `rgba(${color},${a})`;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
  }
  return canvas;
}

/** A host's nebula: one tinted cloud spanning the whole region. The grayscale
 * nebula map gives its structure (sampled bilinearly, so it stays smooth when
 * magnified) and a soft elliptical envelope with a ragged, map-driven edge
 * keeps it within the host. Painted at world scale, within GPU limits. */
export function nebula(region: Region, source: ImageData, margin: number) {
  const x0 = region.bounds.x - margin,
    y0 = region.bounds.y - margin,
    width = region.bounds.width + margin * 2,
    height = region.bounds.height + margin * 2;
  const k = Math.min(1, 4096 / width, 4096 / height);
  const w = Math.ceil(width * k),
    h = Math.ceil(height * k);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(w, h);
  const [tr, tg, tb] = rgb(region.tint);
  const S = source.width,
    T = source.height,
    data = source.data;
  const shift = seedOf(region.host) % S;
  // The source spans the region once, so the cloud never visibly repeats.
  const scale = Math.max(region.bounds.width, region.bounds.height * 2) / (S * 0.9);
  const lumAt = (wx: number, wy: number) => {
    const fx = (wx - x0) / scale + shift,
      fy = (wy - y0) / scale;
    const ix = Math.floor(fx),
      iy = Math.floor(fy),
      ax = fx - ix,
      ay = fy - iy;
    const at = (x: number, y: number) => data[((((y % T) + T) % T) * S + (((x % S) + S) % S)) * 4]!;
    const top = at(ix, iy) * (1 - ax) + at(ix + 1, iy) * ax;
    const bottom = at(ix, iy + 1) * (1 - ax) + at(ix + 1, iy + 1) * ax;
    return (top * (1 - ay) + bottom * ay) / 255;
  };
  const cx = region.bounds.x + region.bounds.width / 2,
    cy = region.bounds.y + region.bounds.height / 2,
    rx = region.bounds.width / 2 + margin * 0.55,
    ry = region.bounds.height / 2 + margin * 0.55;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const wx = x0 + i / k,
        wy = y0 + j / k;
      const lum = lumAt(wx, wy);
      const d = Math.hypot((wx - cx) / rx, (wy - cy) / ry);
      // A soft body that fades out toward the region's edge; the map's own
      // structure breaks up the rim so it never reads as an ellipse.
      const body = Math.max(0, Math.min(1, (1.08 - d + (lum - 0.45) * 0.35) / 0.4));
      const a = body * body * (3 - 2 * body) * (0.62 + 0.38 * Math.min(1, lum * 1.6));
      const o = (j * w + i) * 4;
      const bright = 0.42 + lum * 0.95;
      image.data[o] = tr * bright;
      image.data[o + 1] = tg * bright;
      image.data[o + 2] = tb * bright;
      image.data[o + 3] = a * (region.online ? 200 : 100);
    }
  ctx.putImageData(image, 0, 0);
  return { canvas, x: x0, y: y0, width, height };
}
