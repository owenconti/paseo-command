/**
 * Plain stand-ins for the Dungeon Board's sprites, painted under the frame
 * contract's names and sizes (`frames.ts`) until the real sheets land in
 * `assets/dungeon/`. Procedural shapes only, enough to judge composition.
 */
import { FRAMES, SHEET_SCALE } from "./frames.ts";

type Ctx = CanvasRenderingContext2D;
const ROBOT_TINT: Record<string, string> = {
  orange: "#e0784a", white: "#eeeae2", blue: "#3d8fe0", purple: "#9c5fe0", green: "#5fc24a",
  yellow: "#f2c83a", red: "#e04a4a", grey: "#9a9aa4", teal: "#2ab6b0", pink: "#ec6fb2",
};
const STATE: Record<string, string> = {
  running: "#3fbf86", idle: "#7a7690", done: "#f2c94c", approval: "#ef9b1b", question: "#3a86d8",
  asking: "#a070e0", failure: "#d2452f", offline: "#8f8b80",
};
const PR: Record<string, string> = {
  "ci-running": "#e6a21a", "ci-green": "#2fa865", "ci-failing": "#d43b2e", "review-awaiting": "#3a9ad8",
  "review-approved": "#8a5fd8", "review-changes": "#e07a24", conflicts: "#e05aa0",
  reviewing: "#2c8fd0", approved: "#2a9d57", findings: "#e07412", stale: "#8c8c8c", failed: "#c43c2c",
};

function bricks(ctx: Ctx, w: number, h: number, base: string, mortar: string, bw = 16, bh = 8) {
  ctx.fillStyle = mortar;
  ctx.fillRect(0, 0, w, h);
  for (let row = 0; row * bh < h; row++)
    for (let col = -1; col * bw < w; col++) {
      const x = col * bw + (row % 2 ? bw / 2 : 0);
      const shade = ((row * 7 + col * 13) % 5) * 4;
      ctx.fillStyle = shift(base, shade - 8);
      ctx.fillRect(x + 0.6, row * bh + 0.6, bw - 1.2, bh - 1.2);
    }
}
function shift(hex: string, d: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v + d));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
function flame(ctx: Ctx, x: number, y: number, s: number, k: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, s * 1.6);
  g.addColorStop(0, "rgba(255,220,120,0.9)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, s * 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffb347";
  ctx.beginPath();
  ctx.ellipse(x + Math.sin(k * 1.7) * s * 0.12, y - s * 0.2, s * 0.45, s * (0.85 + 0.1 * Math.sin(k * 2.3)), 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff2b0";
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.22, s * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
}
function disc(ctx: Ctx, x: number, y: number, r: number, fill: string, stroke = "#2a1d10", lw = 1.5) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();
}
function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string, lw = 1.5) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}
function glyph(ctx: Ctx, icon: string, x: number, y: number, s: number, color = "#f4f0ff") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.12;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const d = (pts: number[][], close = true) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px! * s, y + py! * s) : ctx.moveTo(x + px! * s, y + py! * s)));
    if (close) ctx.closePath();
    ctx.stroke();
  };
  switch (icon) {
    case "layers":
    case "hosts":
    case "workspaces":
      for (const dy of [-0.22, 0, 0.22]) d([[-0.42, dy], [0, dy - 0.2], [0.42, dy], [0, dy + 0.2]]);
      break;
    case "code":
      d([[-0.2, -0.3], [-0.45, 0], [-0.2, 0.3]], false);
      d([[0.2, -0.3], [0.45, 0], [0.2, 0.3]], false);
      d([[0.08, -0.36], [-0.08, 0.36]], false);
      break;
    case "cube":
    case "projects":
      d([[0, -0.42], [0.38, -0.2], [0.38, 0.22], [0, 0.44], [-0.38, 0.22], [-0.38, -0.2]]);
      d([[-0.38, -0.2], [0, 0.02], [0.38, -0.2]], false);
      d([[0, 0.02], [0, 0.44]], false);
      break;
    case "chart":
      [-0.3, -0.1, 0.1, 0.3].forEach((bx, i) => ctx.fillRect(x + (bx - 0.07) * s, y + (0.38 - 0.18 * (i + 1)) * s, 0.14 * s, 0.18 * (i + 1) * s));
      break;
    case "flask":
      d([[-0.12, -0.42], [-0.12, -0.1], [-0.38, 0.38], [0.38, 0.38], [0.12, -0.1], [0.12, -0.42]]);
      break;
    case "person":
      ctx.beginPath();
      ctx.arc(x, y - 0.15 * s, 0.17 * s, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + 0.45 * s, 0.32 * s, Math.PI * 1.1, Math.PI * 1.9);
      ctx.stroke();
      break;
    case "agents":
      rr(ctx, x - 0.36 * s, y - 0.26 * s, 0.72 * s, 0.6 * s, 0.14 * s, "transparent", color, s * 0.12);
      ctx.fillRect(x - 0.18 * s, y - 0.04 * s, 0.1 * s, 0.1 * s);
      ctx.fillRect(x + 0.08 * s, y - 0.04 * s, 0.1 * s, 0.1 * s);
      d([[0, -0.26], [0, -0.42]], false);
      break;
    default: {
      ctx.font = `bold ${s * 0.62}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const map: Record<string, string> = { gear: "⚙", globe: "◍", book: "▤", terminal: ">_", database: "≡", rocket: "▲", shield: "⛉", bolt: "ϟ", leaf: "❦", castle: "♜" };
      ctx.fillText(map[icon] ?? "•", x, y);
    }
  }
  ctx.restore();
}

/** Paint one frame at the sheets' scale. */
export function paintPlaceholder(name: string): HTMLCanvasElement {
  const spec = FRAMES[name]!;
  const S = SHEET_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(spec.w * S);
  canvas.height = Math.round(spec.h * S);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(S, S);
  const { w, h } = spec;
  const frame = Number(/-(\d+)$/.exec(name)?.[1] ?? 0);
  let m: RegExpExecArray | null;
  if ((m = /^robot-(\w+)-(idle|work)-\d$/.exec(name))) {
    const tint = ROBOT_TINT[m[1]!]!;
    const work = m[2] === "work";
    const bob = work ? [0, -1.5, 0, -1][frame]! : [0, -0.8][frame]!;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(w / 2, h - 2, 12, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Arms.
    const arm = work ? [3, -3, 2, -2][frame]! : 0;
    rr(ctx, 2, 14 + bob + arm, 5, 9, 2, shift(tint, -40), "#1a1420", 1);
    rr(ctx, w - 7, 14 + bob - arm, 5, 9, 2, shift(tint, -40), "#1a1420", 1);
    rr(ctx, 6, 6 + bob, w - 12, h - 9, 9, tint, "#1a1420", 1.6);
    rr(ctx, 10, 11 + bob, w - 20, 9, 4, "#1c2440");
    ctx.fillStyle = "#9ff3ff";
    ctx.fillRect(13, 14 + bob, 3, 3);
    ctx.fillRect(w - 16, 14 + bob, 3, 3);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(10, 8 + bob, 6, 2);
    return canvas;
  }
  if ((m = /^drone-(\w+)-\d$/.exec(name))) {
    const tint = ROBOT_TINT[m[1]!]!;
    disc(ctx, w / 2, h / 2 + 1, 4.5, tint, "#1a1420", 1);
    ctx.strokeStyle = "#ddd";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const spin = frame ? 3 : 6;
    ctx.moveTo(w / 2 - spin, 2);
    ctx.lineTo(w / 2 + spin, 2);
    ctx.stroke();
    return canvas;
  }
  // A project's hall in plain stone, its cloth in its muted colour (until the projects sheet lands).
  if (name.startsWith("hall-")) {
    if (name === "hall-back") bricks(ctx, w, h, "#2a2238", "#17121f");
    else rr(ctx, 0, 0, w, h, 2, name.includes("floor") ? "#8a809c" : "#a49ab8", "#3a3048", 1);
    return canvas;
  }
  if ((m = /^(valance|runner)-([\w-]+?)(?:-end-(?:left|right))?$/.exec(name))) {
    const CLOTH: Record<string, string> = { teal: "#2f5d58", plum: "#5a3552", wine: "#5e2a33", moss: "#4a5532", "ochre-brown": "#6e5a2e", slate: "#3e4a5a", rust: "#6a3a26", indigo: "#33355e" };
    rr(ctx, 0, 0, w, h, 2, CLOTH[m[2]!] ?? "#555", "#c9a040", 0.8);
    return canvas;
  }
  if (name === "wall-brick" || name === "wall-brick-dark") {
    bricks(ctx, w, h, name === "wall-brick" ? "#4a3e6e" : "#272035", name === "wall-brick" ? "#2e2546" : "#16121f");
    return canvas;
  }
  if (name.startsWith("alcove-slot-")) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#2a1c18");
    g.addColorStop(0.7, "#5a3a22");
    g.addColorStop(1, "#7a5230");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const v = frame;
    if (v === 0) for (let y = 34; y < 84; y += 14) {
      ctx.fillStyle = "#4a2e18";
      ctx.fillRect(3, y, w - 6, 3);
      for (let x = 5; x < w - 6; x += 5) {
        ctx.fillStyle = ["#a33", "#36a", "#3a6", "#a83"][(x + y) % 4]!;
        ctx.fillRect(x, y - 9, 3.5, 9);
      }
    }
    if (v === 1) {
      rr(ctx, 6, 58, w - 12, 18, 2, "#2a3a5a", "#111");
      ctx.fillStyle = "#6fd3ff";
      ctx.fillRect(9, 61, w - 18, 12);
      ctx.fillStyle = "#4a2e18";
      ctx.fillRect(3, 78, w - 6, 4);
    }
    if (v === 2) {
      ctx.fillStyle = "#4a2e18";
      ctx.fillRect(3, 50, w - 6, 3);
      for (let x = 6; x < w - 8; x += 9) disc(ctx, x + 3, 45, 3, ["#c04ad0", "#4ad07a", "#d0a04a"][x % 3]!, "#222", 0.8);
    }
    return canvas;
  }
  if (name === "alcove-left" || name === "alcove-right") {
    bricks(ctx, w, h, "#6a5c8c", "#3a3052", 14, 9);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(name === "alcove-left" ? w - 3 : 0, 0, 3, h);
    return canvas;
  }
  if (name === "alcove-top") {
    bricks(ctx, w, h, "#76689a", "#3a3052", 19, 10);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0, h - 3, w, 3);
    return canvas;
  }
  if (name.startsWith("candle-")) {
    rr(ctx, w / 2 - 2.5, 8, 5, h - 8, 1, "#f2e6c8", "#7a6a50", 0.6);
    flame(ctx, w / 2, 5, 3, frame);
    return canvas;
  }
  if (name === "gate-arch") {
    bricks(ctx, w, h, "#7a6c9e", "#3a3052", 20, 12);
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.moveTo(42, h);
    ctx.lineTo(42, 112);
    ctx.arc(w / 2, 112, w / 2 - 42, Math.PI, 0);
    ctx.lineTo(w - 42, h);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(10,6,16,0.85)";
    ctx.beginPath();
    ctx.moveTo(42, h);
    ctx.lineTo(42, 112);
    ctx.arc(w / 2, 112, w / 2 - 42, Math.PI, 0);
    ctx.lineTo(w - 42, h);
    ctx.closePath();
    ctx.fill();
    return canvas;
  }
  if (name.startsWith("gate-portcullis")) {
    const lit = name.includes("lit");
    ctx.fillStyle = lit ? `rgba(255,190,70,${0.35 + 0.08 * frame})` : "rgba(20,16,28,0.9)";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = lit ? "#ffd27a" : "#4a4458";
    ctx.lineWidth = 3;
    for (let x = 8; x < w; x += 11) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 14; y < h; y += 18) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    return canvas;
  }
  if (name === "gate-medallion" || name === "medallion") {
    disc(ctx, w / 2, h / 2, w / 2 - 1, "#8a7ca8", "#2a2238", 2);
    disc(ctx, w / 2, h / 2, w / 2 - 7, "#1a1424", "#4a3e62", 2);
    if (name === "gate-medallion") glyph(ctx, "layers", w / 2, h / 2, 34);
    return canvas;
  }
  if (name.startsWith("stairs")) {
    const step = name === "stairs-mid" ? 8 : 6;
    for (let y = 0; y < h; y += step) {
      ctx.fillStyle = shift("#7a6c90", (y % (step * 2)) ? -10 : 6);
      ctx.fillRect(0, y, w, step - 1);
      ctx.fillStyle = "#3a3048";
      ctx.fillRect(0, y + step - 1, w, 1);
    }
    ctx.fillStyle = "#5a4c72";
    ctx.fillRect(0, 0, 5, h);
    ctx.fillRect(w - 5, 0, 5, h);
    return canvas;
  }
  if (name.startsWith("banner")) {
    const colors: Record<string, string> = { "banner-crown": "#6a2a9a", "banner-purple-layers": "#7a3ac8", "banner-purple": "#7a3ac8", "banner-navy-hammers": "#2a2f6a", "banner-blue-anvil": "#264a8a" };
    ctx.fillStyle = "#c9a040";
    ctx.fillRect(0, 0, w, 4);
    ctx.fillStyle = colors[name] ?? "#7a3ac8";
    ctx.beginPath();
    ctx.moveTo(3, 4);
    ctx.lineTo(w - 3, 4);
    ctx.lineTo(w - 3, h - 2);
    ctx.lineTo(w / 2, h - 14);
    ctx.lineTo(3, h - 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#e6c060";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    const icon = name === "banner-crown" ? "castle" : name.includes("layers") ? "layers" : name.includes("hammers") ? "terminal" : name.includes("anvil") ? "shield" : "";
    if (icon) glyph(ctx, icon, w / 2, h * 0.4, 20, "#f2d27a");
    return canvas;
  }
  if (name === "floor-flag" || name === "ledge-face" || name === "border" || name === "pillar" || name.startsWith("pillar-") || name.startsWith("ledge-end") || name === "border-corner") {
    const base = name === "floor-flag" ? "#6e5f86" : name === "ledge-face" ? "#4e4266" : name === "border" || name === "border-corner" ? "#5a4a2a" : "#7a6c9e";
    bricks(ctx, w, h, base, "#2a2238", name === "floor-flag" ? 16 : 12, name === "floor-flag" ? h / 2 : 8);
    if (name === "border" || name === "border-corner") {
      ctx.strokeStyle = "#e0b04a";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, w - 2, h - 2);
    }
    return canvas;
  }
  if (name === "niche-arch" || name === "window-barred") {
    ctx.fillStyle = "#3a3052";
    ctx.beginPath();
    ctx.moveTo(4, h);
    ctx.lineTo(4, w / 2);
    ctx.arc(w / 2, w / 2, w / 2 - 4, Math.PI, 0);
    ctx.lineTo(w - 4, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#120e1a";
    ctx.beginPath();
    ctx.moveTo(10, h - 4);
    ctx.lineTo(10, w / 2);
    ctx.arc(w / 2, w / 2, w / 2 - 10, Math.PI, 0);
    ctx.lineTo(w - 10, h - 4);
    ctx.closePath();
    ctx.fill();
    if (name === "window-barred") {
      ctx.strokeStyle = "#5a5468";
      ctx.lineWidth = 2;
      for (let x = 16; x < w - 10; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 10);
        ctx.lineTo(x, h - 4);
        ctx.stroke();
      }
    }
    return canvas;
  }
  if (name === "label" || name === "plaque") {
    rr(ctx, 1, 2, w - 2, h - 3, 8, "#3a2410");
    rr(ctx, 1, 1, w - 2, h - 4, 8, "#f1dcae", "#6a4a24", 2);
    rr(ctx, 4, 4, w - 8, h - 10, 6, "transparent", "rgba(150,110,60,0.5)", 1);
    return canvas;
  }
  if (name === "panel") {
    rr(ctx, 1, 1, w - 2, h - 2, 6, "#161a36", "#d8a840", 3);
    rr(ctx, 5, 5, w - 10, h - 10, 4, "transparent", "rgba(216,168,64,0.4)", 1);
    return canvas;
  }
  if ((m = /^icon-(\w+)$/.exec(name))) {
    glyph(ctx, m[1]!, w / 2, h / 2, w * 0.9);
    return canvas;
  }
  if ((m = /^count-(\w+)$/.exec(name))) {
    glyph(ctx, m[1]!, w / 2, h / 2, w * 0.9);
    return canvas;
  }
  if ((m = /^dot-(\w+)$/.exec(name))) {
    disc(ctx, w / 2, h / 2, w / 2 - 1, m[1] === "online" ? "#4ad04a" : m[1] === "offline" ? "#7a7a7a" : "#e0a020", "#1a2a10", 1);
    return canvas;
  }
  if (name === "node") {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "#fff6c8");
    g.addColorStop(0.5, "#ffc940");
    g.addColorStop(1, "rgba(255,180,40,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    disc(ctx, w / 2, h / 2, w * 0.24, "#ffd860", "#a06a10", 1);
    return canvas;
  }
  if (name.startsWith("torch")) {
    rr(ctx, w / 2 - 2, 14, 4, h - 14, 1, "#5a3a1a");
    rr(ctx, w / 2 - 5, 12, 10, 5, 2, "#7a6a5a");
    if (name !== "torch-out") flame(ctx, w / 2, 8, 5, frame);
    else disc(ctx, w / 2, 11, 3, "#2a2420", "#111", 0.5);
    return canvas;
  }
  if (name.startsWith("brazier")) {
    ctx.fillStyle = "#4a4458";
    ctx.fillRect(w / 2 - 4, h - 28, 8, 26);
    ctx.fillRect(w / 2 - 12, h - 4, 24, 4);
    ctx.beginPath();
    ctx.moveTo(4, h - 34);
    ctx.lineTo(w - 4, h - 34);
    ctx.lineTo(w - 12, h - 24);
    ctx.lineTo(12, h - 24);
    ctx.closePath();
    ctx.fillStyle = "#6a6478";
    ctx.fill();
    flame(ctx, w / 2, h - 42, 10, frame);
    return canvas;
  }
  if (name.startsWith("forge")) {
    bricks(ctx, w, h, "#6a5c7c", "#2a2238", 16, 10);
    ctx.fillStyle = "#1a0e08";
    ctx.beginPath();
    ctx.arc(w / 2, h * 0.55, w * 0.28, Math.PI, 0);
    ctx.lineTo(w / 2 + w * 0.28, h * 0.8);
    ctx.lineTo(w / 2 - w * 0.28, h * 0.8);
    ctx.fill();
    flame(ctx, w / 2, h * 0.66, 12, frame);
    return canvas;
  }
  if (name === "anvil") {
    ctx.fillStyle = "#5a5a66";
    ctx.beginPath();
    ctx.moveTo(2, 4);
    ctx.lineTo(w - 2, 4);
    ctx.lineTo(w - 12, 12);
    ctx.lineTo(w - 14, h);
    ctx.lineTo(14, h);
    ctx.lineTo(12, 12);
    ctx.closePath();
    ctx.fill();
    return canvas;
  }
  if (name.startsWith("crystal")) {
    const g = ctx.createRadialGradient(w / 2, h * 0.5, 0, w / 2, h * 0.5, w * 0.6);
    g.addColorStop(0, `rgba(200,120,255,${0.5 + 0.1 * frame})`);
    g.addColorStop(1, "rgba(120,40,200,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    for (const [x, y, s] of [[w / 2, 10, 1], [w / 2 - 16, 30, 0.7], [w / 2 + 16, 34, 0.6]] as const) {
      ctx.fillStyle = "#b06bff";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 10 * s, y + 30 * s);
      ctx.lineTo(x + 6 * s, h - 10);
      ctx.lineTo(x - 6 * s, h - 10);
      ctx.lineTo(x - 10 * s, y + 30 * s);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = "#e8c8ff";
      ctx.stroke();
    }
    rr(ctx, 6, h - 12, w - 12, 12, 4, "#4a4058");
    return canvas;
  }
  if (name.startsWith("alchemy-tank")) {
    ctx.strokeStyle = "#8a8a9a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(4, 10);
    ctx.lineTo(w / 2, 10);
    ctx.lineTo(w / 2, 24);
    ctx.stroke();
    rr(ctx, w / 2 - 22, 24, 44, h - 36, 10, `rgba(170,80,255,${0.55 + 0.08 * frame})`, "#c8c8d8", 3);
    rr(ctx, w / 2 - 26, h - 14, 52, 14, 3, "#5a5468");
    return canvas;
  }
  if (name.startsWith("magic-circle")) {
    ctx.strokeStyle = `rgba(80,200,255,${0.7 + 0.08 * frame})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2 - 3, h / 2 - 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w / 2 - 14, h / 2 - 8, 0, 0, Math.PI * 2);
    ctx.stroke();
    return canvas;
  }
  if (name === "armor") {
    ctx.fillStyle = "#9a9aaa";
    disc(ctx, w / 2, 9, 7, "#a8a8b8", "#333", 1);
    rr(ctx, w / 2 - 10, 16, 20, 24, 4, "#9a9aaa", "#333", 1);
    ctx.fillRect(w / 2 - 8, 40, 6, h - 40);
    ctx.fillRect(w / 2 + 2, 40, 6, h - 40);
    return canvas;
  }
  if (["barrel", "barrels", "crate", "crates", "shelf-potions", "bookcase-ladder", "scroll-desk", "table", "rug-red", "chain", "portcullis-side", "cobweb"].includes(name)) {
    const wood = "#7a4a22";
    if (name === "barrel" || name === "barrels") {
      const n = name === "barrel" ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const bw = w / n;
        rr(ctx, i * bw + 1, 2, bw - 2, h - 2, 8, wood, "#2a1808", 1.2);
        ctx.fillStyle = "#3a3a44";
        ctx.fillRect(i * bw + 1, h * 0.3, bw - 2, 2);
        ctx.fillRect(i * bw + 1, h * 0.7, bw - 2, 2);
      }
    } else if (name === "crate" || name === "crates") {
      const boxes = name === "crate" ? [[0, 0, w, h]] : [[0, h * 0.4, w * 0.55, h * 0.6], [w * 0.45, h * 0.3, w * 0.55, h * 0.7], [w * 0.15, 0, w * 0.45, h * 0.42]];
      for (const [x, y, bw, bh] of boxes) {
        rr(ctx, x! + 1, y! + 1, bw! - 2, bh! - 2, 2, "#9a6a32", "#3a2210", 1.2);
        ctx.strokeStyle = "#5a3a18";
        ctx.beginPath();
        ctx.moveTo(x! + 2, y! + 2);
        ctx.lineTo(x! + bw! - 2, y! + bh! - 2);
        ctx.stroke();
      }
    } else if (name === "shelf-potions" || name === "bookcase-ladder") {
      rr(ctx, 1, 1, (name === "bookcase-ladder" ? w * 0.7 : w) - 2, h - 2, 2, "#4a2a14", "#2a1408", 1.5);
      for (let y = 14; y < h - 6; y += name === "bookcase-ladder" ? 20 : 18) {
        ctx.fillStyle = "#6a3e1c";
        ctx.fillRect(3, y, (name === "bookcase-ladder" ? w * 0.7 : w) - 6, 3);
        for (let x = 6; x < (name === "bookcase-ladder" ? w * 0.7 : w) - 8; x += 7) {
          if (name === "shelf-potions") disc(ctx, x + 2, y - 5, 3, ["#c04ad0", "#4ad07a", "#d04a4a", "#4a9ad0"][(x + y) % 4]!, "#222", 0.6);
          else {
            ctx.fillStyle = ["#a33", "#36a", "#3a6", "#a83"][(x + y) % 4]!;
            ctx.fillRect(x, y - 12, 4, 12);
          }
        }
      }
      if (name === "bookcase-ladder") {
        ctx.strokeStyle = "#9a6a32";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(w * 0.62, 6);
        ctx.lineTo(w - 4, h);
        ctx.moveTo(w * 0.72, 6);
        ctx.lineTo(w + 6, h);
        ctx.stroke();
      }
    } else if (name === "scroll-desk" || name === "table") {
      rr(ctx, 2, h * 0.35, w - 4, 6, 2, "#8a5a2a", "#2a1408", 1);
      ctx.fillStyle = "#5a3a18";
      ctx.fillRect(6, h * 0.35 + 6, 4, h * 0.65 - 6);
      ctx.fillRect(w - 10, h * 0.35 + 6, 4, h * 0.65 - 6);
      if (name === "scroll-desk") rr(ctx, 10, h * 0.2, w * 0.45, 7, 3, "#efe0b8", "#8a6a3a", 1);
      flame(ctx, w * 0.78, h * 0.22, 3, 0);
    } else if (name === "rug-red") {
      rr(ctx, 2, 2, w - 4, h - 4, 3, "#7a1e2a", "#d0a040", 2);
      rr(ctx, 12, 8, w - 24, h - 16, 2, "transparent", "#c06a40", 1.2);
    } else if (name === "chain") {
      ctx.strokeStyle = "#6a6478";
      ctx.lineWidth = 2;
      for (let y = 0; y < h; y += 7) {
        ctx.beginPath();
        ctx.ellipse(w / 2, y + 3, 2.5, 3.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (name === "portcullis-side") {
      ctx.strokeStyle = "#4a4458";
      ctx.lineWidth = 3;
      for (let x = 4; x < w; x += 8) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(220,220,230,0.5)";
      ctx.lineWidth = 0.7;
      for (let i = 0; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos((i / 10) * Math.PI) * w, Math.sin((i / 10) * Math.PI) * h);
        ctx.stroke();
      }
    }
    return canvas;
  }
  if ((m = /^glow-(\w+)$/.exec(name))) {
    const c = STATE[m[1]!] ?? "#ffffff";
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, c);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(1, h / w);
    ctx.translate(-w / 2, -w / 2);
    const g2 = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g2.addColorStop(0, c);
    g2.addColorStop(0.55, c + "88");
    g2.addColorStop(1, c + "00");
    ctx.fillStyle = g2;
    ctx.fillRect(0, 0, w, w);
    ctx.restore();
    return canvas;
  }
  if ((m = /^mark-(\w+)$/.exec(name))) {
    const c = STATE[m[1]!] ?? "#fff";
    ctx.beginPath();
    ctx.moveTo(w / 2, h);
    ctx.lineTo(w / 2 - 5, h - 7);
    ctx.lineTo(w / 2 + 5, h - 7);
    ctx.fillStyle = c;
    ctx.fill();
    disc(ctx, w / 2, 9, 8.5, c, "#1a1420", 1.4);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText({ approval: "!", question: "?", asking: "…", failure: "✕", done: "✓", running: "⚙" }[m[1]!] ?? "", w / 2, 9.5);
    return canvas;
  }
  if ((m = /^(?:pr|probe)-([\w-]+)$/.exec(name))) {
    disc(ctx, w / 2, h / 2, w / 2 - 1, "#c9a040", "#3a2410", 1);
    disc(ctx, w / 2, h / 2, w / 2 - 3.5, PR[m[1]!] ?? "#888", "#3a2410", 0.6);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 8px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name.startsWith("probe") ? "P" : m[1]!.startsWith("ci") ? "C" : "R", w / 2, h / 2 + 0.5);
    return canvas;
  }
  if (name === "seal-automerge") {
    disc(ctx, w / 2, h / 2, w / 2 - 0.5, "#14837b", "#f2e6c8", 1);
    return canvas;
  }
  // Anything else: a labelled box.
  rr(ctx, 1, 1, w - 2, h - 2, 3, "rgba(120,100,160,0.6)", "#fff", 1);
  return canvas;
}
