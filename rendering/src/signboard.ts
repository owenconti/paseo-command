/**
 * The world's wooden signboards, used by the Overworld: planks lit from the upper left with grain,
 * seams and iron bolts, the name in cream capitals in an old-style serif with a carved inset. A host's board hangs on
 * two chains (`hangY`) or stands on two posts (`postY`); a project's is fixed on two short iron brackets.
 *
 * Sizes are in the board's own units (the Overworld's concept pixels: a host's board 21 tall, a project's 15).
 * `fitName` is pure (no DOM), so a layout sizes a
 * board exactly as its painter draws it.
 */
import { hash, rng } from "./overworld/layout.ts";

/** The boards' lettering: an old-style serif, as the Dungeon Board's signs. */
export const SIGN_FONT = '"Iowan Old Style", Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif';

export type SignBoard = {
  style: "host" | "project";
  text: string;
  /** Centre of the board. */
  x: number;
  /** Bottom of the board. */
  y: number;
  h: number;
  minW: number;
  maxW: number;
  /** Where its chains hang from (a host's board hung from a wall). */
  hangY?: number;
  /** Where its two posts stand (a host's board standing on the ground), below the board. */
  postY?: number;
  /** An offline host's: dull and unlit. */
  dim?: boolean;
};

/** The name as painted: its text (capitals, maybe cut short), lettering size, tracking and width. */
export type SignFit = { text: string; size: number; track: number; w: number };

/** The lettering's size on a board `h` tall. */
export const signSize = (style: SignBoard["style"], h: number) => h * (style === "host" ? 0.56 : 0.6);
/** The board's room either side of the name. */
export const signPad = (h: number) => h * 0.62;
/** The board's width for a fitted name. */
export const signWidth = (sign: Pick<SignBoard, "h" | "minW">, fit: SignFit) => Math.max(sign.minW, fit.w + signPad(sign.h) * 2);

/** The name in capitals, fitted to `maxW` at `size` (`width(text, size)` measures it untracked): tracking tightens
 * first, then (down to `minSize`) the lettering shrinks, then the name is cut short with "…". */
export function fitName(width: (text: string, size: number) => number, text: string, size: number, maxW: number, minSize = size): SignFit {
  const caps = text.toUpperCase();
  const at = (t: string, s: number, track: number) => width(t, s) + track * Math.max(0, t.length - 1);
  for (const k of [0.09, 0.04, 0]) if (at(caps, size, size * k) <= maxW) return { text: caps, size, track: size * k, w: at(caps, size, size * k) };
  // (Stepping down 5% at a time, the last step at `minSize` itself.)
  if (minSize < size)
    for (let s = Math.max(minSize, size * 0.95); ; s = Math.max(minSize, s * 0.95)) {
      if (at(caps, s, 0) <= maxW) return { text: caps, size: s, track: 0, w: at(caps, s, 0) };
      if (s <= minSize) break;
    }
  const s = Math.min(size, minSize);
  let cut = caps;
  while (cut.length > 1 && at(`${cut}…`, s, 0) > maxW) cut = cut.slice(0, -1);
  cut = `${cut.trimEnd()}…`;
  return { text: cut, size: s, track: 0, w: at(cut, s, 0) };
}

type Ctx = CanvasRenderingContext2D;

function spaced(ctx: Ctx, text: string, x: number, y: number, track: number): void {
  if (!track) return ctx.fillText(text, x, y);
  let cx = x - (ctx.measureText(text).width + track * (text.length - 1)) / 2;
  ctx.textAlign = "left";
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + track;
  }
  ctx.textAlign = "center";
}

/** A wooden signboard as the world's sprites are painted: dark outline, warm planks lit from the upper left with
 * their grain and seams, iron bolts, a soft shadow on the wall behind, and the name in cream capitals with a worn
 * inset. A host's hangs on two chains or stands on two posts; a project's stands on two short iron brackets.
 * `fit` is the name as a layout fitted it (`fitName`), else fitted here. */
export function paintSign(ctx: Ctx, sign: SignBoard, given?: SignFit): void {
  const pad = signPad(sign.h);
  const width = (t: string, s: number) => {
    ctx.font = `700 ${s}px ${SIGN_FONT}`;
    return ctx.measureText(t).width;
  };
  const fit = given ?? fitName(width, sign.text, signSize(sign.style, sign.h), sign.maxW - pad * 2);
  const w = signWidth(sign, fit);
  const x0 = sign.x - w / 2;
  const y0 = sign.y - sign.h;
  const h = sign.h;
  const r = Math.min(3, h * 0.18);
  const dim = !!sign.dim;
  const ol = 0.9;
  ctx.save();
  // Chains or posts (host) or brackets (project).
  if (sign.style === "host" && sign.hangY !== undefined) {
    for (const side of [-1, 1]) {
      const cx = sign.x + side * (w / 2 - h * 0.55);
      ctx.fillStyle = "rgba(20, 16, 24, 0.35)";
      ctx.fillRect(cx + 0.6, sign.hangY + 1, 1.6, y0 - sign.hangY + 1);
      for (let y = sign.hangY; y < y0 + 1; y += 2.6) {
        const odd = Math.round((y - sign.hangY) / 2.6) % 2 === 1;
        ctx.strokeStyle = "#1c1a1e";
        ctx.lineWidth = 0.9;
        ctx.fillStyle = dim ? "#6b6b70" : "#8d8a86";
        ctx.beginPath();
        if (odd) ctx.ellipse(cx, y + 1.3, 0.55, 1.5, 0, 0, Math.PI * 2);
        else ctx.ellipse(cx, y + 1.3, 1.05, 1.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (!odd) {
          ctx.strokeStyle = dim ? "#77777c" : "#a7a29a";
          ctx.lineWidth = 0.45;
          ctx.stroke();
        }
      }
      // The hook in the wall.
      ctx.fillStyle = "#1c1a1e";
      ctx.beginPath();
      ctx.arc(cx, sign.hangY, 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = dim ? "#77777c" : "#9a958e";
      ctx.beginPath();
      ctx.arc(cx - 0.3, sign.hangY - 0.3, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (sign.style === "host" && sign.postY !== undefined) {
    // Two square oak posts planted in the paving, behind the board, a little taller than it, with iron caps and a
    // band near the foot, each casting a small shadow where it stands.
    const pw = h * 0.17;
    const top = y0 - h * 0.2;
    for (const side of [-1, 1]) {
      const px = sign.x + side * (w / 2 - h * 0.55);
      ctx.fillStyle = "rgba(20, 12, 4, 0.32)";
      ctx.beginPath();
      ctx.ellipse(px + pw * 0.3, sign.postY, pw * 1.25, pw * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#24170f";
      ctx.beginPath();
      ctx.roundRect(px - pw / 2 - ol, top - ol, pw + ol * 2, sign.postY - top + ol, Math.min(pw * 0.3, 1.2));
      ctx.fill();
      const g = ctx.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
      if (dim) {
        g.addColorStop(0, "#6f6255");
        g.addColorStop(1, "#4a3f36");
      } else {
        g.addColorStop(0, "#a7703f");
        g.addColorStop(0.5, "#8c5a31");
        g.addColorStop(1, "#5a361c");
      }
      ctx.fillStyle = g;
      ctx.fillRect(px - pw / 2, top, pw, sign.postY - top - 0.3);
      // Its iron cap, lit along its top, and a band near its foot.
      ctx.fillStyle = "#1c1a1e";
      ctx.beginPath();
      ctx.roundRect(px - pw / 2 - 0.6, top - 1, pw + 1.2, 1.9, 0.7);
      ctx.fill();
      ctx.fillStyle = dim ? "#77777c" : "#a59f96";
      ctx.fillRect(px - pw / 2 - 0.2, top - 0.7, pw + 0.4, 0.4);
      const band = sign.postY - Math.max(2.4, (sign.postY - sign.y) * 0.45);
      ctx.fillStyle = "#1c1a1e";
      ctx.fillRect(px - pw / 2, band, pw, 1);
      ctx.fillStyle = dim ? "#77777c" : "#8d8a86";
      ctx.fillRect(px - pw / 2, band, pw, 0.35);
    }
  } else {
    for (const side of [-1, 1]) {
      const bx = sign.x + side * (w / 2 - h * 0.7);
      ctx.fillStyle = "#1c1a1e";
      ctx.fillRect(bx - 1.1, sign.y - 1, 2.2, h * 0.32);
      ctx.fillStyle = "#6f6a66";
      ctx.fillRect(bx - 0.5, sign.y - 1, 0.8, h * 0.28);
    }
  }
  // Its shadow on the wall or roof behind.
  ctx.fillStyle = "rgba(18, 14, 26, 0.38)";
  ctx.beginPath();
  ctx.roundRect(x0 + 1.4, y0 + 1.8, w, h, r);
  ctx.fill();
  // The board: outline, planks.
  ctx.fillStyle = "#24170f";
  ctx.beginPath();
  ctx.roundRect(x0 - ol, y0 - ol, w + ol * 2, h + ol * 2, r + ol);
  ctx.fill();
  const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
  if (dim) {
    g.addColorStop(0, "#6a5d50");
    g.addColorStop(1, "#4a3f36");
  } else {
    g.addColorStop(0, "#a7703f");
    g.addColorStop(0.45, "#8c5a31");
    g.addColorStop(1, "#5f3a1f");
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.roundRect(x0, y0, w, h, r);
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Grain: long faint streaks, seeded by the name so each board is its own.
  const rand = rng(hash(sign.text));
  const planks = sign.style === "host" ? 2 : 1;
  for (let p = 0; p < planks; p++) {
    const py0 = y0 + (h / planks) * p;
    const ph = h / planks;
    for (let k = 0; k < 7; k++) {
      const gy = py0 + ph * (0.15 + rand() * 0.7);
      const gx = x0 + rand() * w * 0.6;
      ctx.strokeStyle = rand() < 0.5 ? "rgba(48, 26, 12, 0.32)" : "rgba(214, 160, 100, 0.18)";
      ctx.lineWidth = 0.35 + rand() * 0.3;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.quadraticCurveTo(gx + w * 0.2, gy + (rand() - 0.5) * 0.8, gx + w * (0.25 + rand() * 0.4), gy + (rand() - 0.5) * 0.6);
      ctx.stroke();
    }
    if (p > 0) {
      ctx.fillStyle = "rgba(30, 16, 8, 0.75)";
      ctx.fillRect(x0, py0 - 0.4, w, 0.8);
      ctx.fillStyle = "rgba(220, 170, 110, 0.25)";
      ctx.fillRect(x0, py0 + 0.4, w, 0.4);
    }
  }
  // Light from the upper left: a bright top edge, a darker foot.
  ctx.fillStyle = dim ? "rgba(200, 190, 175, 0.18)" : "rgba(255, 214, 150, 0.4)";
  ctx.fillRect(x0, y0, w, 0.9);
  ctx.fillStyle = "rgba(25, 12, 4, 0.35)";
  ctx.fillRect(x0, y0 + h - 1.1, w, 1.1);
  ctx.restore();
  // Bolts at the corners (host) or ends (project).
  const bolt = (bx: number, by: number) => {
    ctx.fillStyle = "#1c1a1e";
    ctx.beginPath();
    ctx.arc(bx, by, 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = dim ? "#77777c" : "#a59f96";
    ctx.beginPath();
    ctx.arc(bx - 0.25, by - 0.25, 0.5, 0, Math.PI * 2);
    ctx.fill();
  };
  const inset = h * 0.26;
  if (sign.style === "host") {
    for (const bx of [x0 + inset, x0 + w - inset]) for (const by of [y0 + inset, y0 + h - inset]) bolt(bx, by);
  } else {
    for (const bx of [x0 + inset, x0 + w - inset]) bolt(bx, y0 + h / 2);
  }
  // The name: cream capitals with a worn, carved inset (dark above-left, a faint light below).
  ctx.font = `700 ${fit.size}px ${SIGN_FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const ty = y0 + h / 2 + fit.size * 0.06;
  ctx.fillStyle = "rgba(30, 14, 4, 0.75)";
  spaced(ctx, fit.text, sign.x - 0.35, ty - 0.35, fit.track);
  ctx.fillStyle = "rgba(255, 220, 160, 0.22)";
  spaced(ctx, fit.text, sign.x + 0.3, ty + 0.45, fit.track);
  ctx.fillStyle = dim ? "#b9b1a4" : "#f3e3bf";
  spaced(ctx, fit.text, sign.x, ty, fit.track);
  ctx.restore();
}
