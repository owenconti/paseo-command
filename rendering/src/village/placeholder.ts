/**
 * Plain stand-ins for the Village's sprites, painted under the frame contract's
 * names and sizes (`frames.ts`) until the real sheets land in `assets/village/`.
 * Simple procedural shapes in the concept's colours, enough to judge composition,
 * each labelled with its frame's name where it has room.
 */
import { FRAMES, SHEET_SCALE } from "./frames.ts";

type Ctx = CanvasRenderingContext2D;
const ROBOT: Record<string, string> = {
  orange: "#e0784a", white: "#eeeae2", green: "#6cc24a", blue: "#3d8fe0",
  cyan: "#2ac6d0", purple: "#9c5fe0", pink: "#ec6fb2", yellow: "#f2c83a",
};
const BUILDING: Record<string, string> = {
  "hall-blue": "#3b5fa8", "hall-purple": "#7a4fb0", "dome-teal": "#2f8a86",
  "workshop-rust": "#b0582e", "hall-green": "#4f8a3a", "hall-red": "#a83b3b",
};
const TILE: Record<string, string> = { merged: "#3fae4a", review: "#3f7fd8", draft: "#e0b23a", failing: "#d8453a", none: "#56606e" };

function round(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function noise(ctx: Ctx, w: number, h: number, base: string, spots: string[], n: number, size: number, seed: number) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = spots[i % spots.length]!;
    const x = rnd() * w, y = rnd() * h, r = size * (0.5 + rnd());
    // Wrapped, so the tile repeats seamlessly.
    for (const dx of [-w, 0, w]) for (const dy of [-h, 0, h]) {
      ctx.beginPath();
      ctx.ellipse(x + dx, y + dy, r, r * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
function tree(ctx: Ctx, w: number, h: number, leaf: string, dark: string) {
  ctx.fillStyle = "#5a3a22";
  ctx.fillRect(w * 0.45, h * 0.6, w * 0.1, h * 0.4);
  for (const [x, y, r, c] of [[0.5, 0.42, 0.42, dark], [0.32, 0.5, 0.26, leaf], [0.68, 0.48, 0.27, leaf], [0.5, 0.3, 0.3, leaf]] as const) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(w * x, h * y, w * r, h * r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Paint one frame's placeholder. */
export function paintPlaceholder(name: string): HTMLCanvasElement {
  const spec = FRAMES[name]!;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(spec.w * SHEET_SCALE));
  canvas.height = Math.max(1, Math.round(spec.h * SHEET_SCALE));
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SHEET_SCALE, SHEET_SCALE);
  const { w, h } = spec;
  let label = true;
  const robot = /^robot-(\w+)-(idle|work)-(\d)$/.exec(name);
  const drone = /^drone-(\w+)$/.exec(name);
  if (BUILDING[name]) {
    // Stone walls, a coloured roof, three lit windows.
    ctx.fillStyle = "#8a7a62";
    ctx.fillRect(w * 0.08, h * 0.42, w * 0.84, h * 0.58);
    ctx.fillStyle = BUILDING[name]!;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.5);
    ctx.lineTo(w * 0.2, h * 0.06);
    ctx.lineTo(w * 0.8, h * 0.06);
    ctx.lineTo(w, h * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffc860";
    for (const x of [0.25, 0.5, 0.75]) ctx.fillRect(w * x - 10, h * 0.55, 20, 26);
  } else if (name === "bay-arch") {
    ctx.fillStyle = "#7a6a52";
    round(ctx, 0, 0, w, h, w / 2);
    ctx.fill();
    ctx.fillStyle = "#2a1e14";
    round(ctx, 8, 10, w - 16, h - 14, (w - 16) / 2);
    ctx.fill();
    label = false;
  } else if (name === "banner") {
    ctx.fillStyle = "#c9a040";
    ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = "#2a2440";
    ctx.beginPath();
    ctx.moveTo(4, 6);
    ctx.lineTo(w - 4, 6);
    ctx.lineTo(w - 4, h);
    ctx.lineTo(w / 2, h - 14);
    ctx.lineTo(4, h);
    ctx.closePath();
    ctx.fill();
    label = false;
  } else if (name.startsWith("plaque")) {
    ctx.fillStyle = "#6a4a2a";
    round(ctx, 0, 0, w, h, 8);
    ctx.fill();
    ctx.fillStyle = "#ead9b0";
    round(ctx, 4, 4, w - 8, h - 8, 6);
    ctx.fill();
    label = false;
  } else if (name.startsWith("tile-") && name !== "tile-frame") {
    const kind = name.slice(5);
    ctx.fillStyle = "#3a2a1a";
    round(ctx, 0, 0, w, h, 8);
    ctx.fill();
    ctx.fillStyle = TILE[kind] ?? "#888";
    round(ctx, 4, 4, w - 8, h - 8, 6);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${h * 0.5}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText({ merged: "✓", review: "⑂", draft: "✎", failing: "!", none: "≡" }[kind] ?? "?", w / 2, h / 2 + 2);
    label = false;
  } else if (name === "tile-frame" || name === "panel-9slice" || name === "pill") {
    ctx.fillStyle = "#c9a040";
    round(ctx, 0, 0, w, h, 10);
    ctx.fill();
    ctx.fillStyle = "#2a1e16";
    round(ctx, 3, 3, w - 6, h - 6, 8);
    ctx.fill();
    label = false;
  } else if (robot || drone) {
    const c = ROBOT[(robot ?? drone)![1]!] ?? "#aaa";
    const bob = robot && robot[2] === "work" ? (Number(robot[3]) % 2) * 2 : 0;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.52 - bob, w * 0.42, h * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1a2030";
    round(ctx, w * 0.22, h * 0.34 - bob, w * 0.56, h * 0.24, h * 0.1);
    ctx.fill();
    ctx.fillStyle = "#8ff0ff";
    for (const x of [0.38, 0.62]) {
      ctx.beginPath();
      ctx.arc(w * x, h * 0.46 - bob, h * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
    label = false;
  } else if (name === "floorlight" || name === "crystal-glow" || name === "dot") {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    label = false;
  } else if (name.startsWith("fountain")) {
    ctx.fillStyle = "#9a8a72";
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.75, w * 0.48, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a8ac0";
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.72, w * 0.4, h * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = name === "fountain-on" ? "#7fd8ff" : "#4a5a6a";
    ctx.beginPath();
    ctx.moveTo(w / 2, h * 0.05);
    ctx.lineTo(w * 0.6, h * 0.6);
    ctx.lineTo(w * 0.4, h * 0.6);
    ctx.closePath();
    ctx.fill();
  } else if (name.startsWith("water-ripple")) {
    ctx.strokeStyle = "rgba(200,240,255,0.5)";
    ctx.lineWidth = 2;
    const k = Number(name.slice(-1));
    for (let r = 0; r < 3; r++) {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w * (0.15 + 0.12 * r + 0.03 * k), h * (0.15 + 0.12 * r + 0.03 * k), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    label = false;
  } else if (name === "grass") {
    noise(ctx, w, h, "#5f8a32", ["#6e9a3a", "#517a2a", "#7aa846"], 60, 6, 7);
    label = false;
  } else if (name === "cobble") {
    noise(ctx, w, h, "#9a8a6c", ["#b0a080", "#8a7a5c", "#c0b090"], 50, 7, 11);
    label = false;
  } else if (name === "path") {
    noise(ctx, w, h, "#a08a62", ["#b49c72", "#8c7652"], 40, 6, 13);
    label = false;
  } else if (name === "plaza-ring") {
    ctx.strokeStyle = "#c0b090";
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.ellipse(w / 2, h / 2, w * 0.45, h * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
    label = false;
  } else if (name.startsWith("porch")) {
    noise(ctx, w, h, "#b8a888", ["#c8b898", "#a89878"], 14, 6, 5);
    ctx.fillStyle = "#7a6a52";
    ctx.fillRect(0, h - 12, w, 12);
    label = false;
  } else if (name.startsWith("tree")) {
    tree(ctx, w, h, "#6a9a34", "#3e6a24");
    label = false;
  } else if (name.startsWith("blossom")) {
    tree(ctx, w, h, "#f0a0c8", "#c870a0");
    label = false;
  } else if (name.startsWith("bush")) {
    ctx.fillStyle = "#4e8a2e";
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 0.6, w * 0.48, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    label = false;
  } else if (name.startsWith("flowers")) {
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = ["#e86aa0", "#f0d040", "#a070e0", "#fff"][i % 4]!;
      ctx.beginPath();
      ctx.arc(((i * 37) % w), h * 0.3 + ((i * 13) % (h * 0.6)), 3, 0, Math.PI * 2);
      ctx.fill();
    }
    label = false;
  } else if (name === "river" || name === "pond" || name.startsWith("waterfall")) {
    ctx.fillStyle = "#3a8ac0";
    if (name === "pond") {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(220,245,255,0.5)";
    for (let i = 0; i < 6; i++) ctx.fillRect(((i * 29) % w), ((i * 41) % h), 14, 3);
    label = name !== "river";
  } else if (name.startsWith("lamp")) {
    ctx.fillStyle = "#3a3028";
    ctx.fillRect(w / 2 - 2, h * 0.25, 4, h * 0.75);
    ctx.fillStyle = name === "lamp-on" ? "#ffd070" : "#5a5040";
    ctx.fillRect(w / 2 - 7, h * 0.08, 14, 18);
    label = false;
  } else if (name.startsWith("wall")) {
    ctx.fillStyle = "#8a826e";
    ctx.fillRect(0, h * 0.2, w, h * 0.8);
    ctx.fillStyle = "#a89e86";
    ctx.fillRect(0, h * 0.1, w, h * 0.16);
  } else {
    ctx.fillStyle = "rgba(140, 110, 70, 0.85)";
    round(ctx, 0, 0, w, h, Math.min(8, w / 4, h / 4));
    ctx.fill();
  }
  if (label && w > 30 && h > 16) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `bold ${Math.min(12, h / 3)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(name, w / 2, h / 2, w - 4);
  }
  return canvas;
}
