// Overworld preview: lays out the concept's fleet and paints it, for side-by-side checks.
import { loadSheets } from "../src/overworld/atlas.ts";
import { layout, type OwAgent, type OwHost } from "../src/overworld/layout.ts";
import { paintScene } from "../src/overworld/paint.ts";
import { overworldFleet } from "../src/overworld/fleet.ts";
import { crowded } from "../tests/fixtures.mjs";
import { SAMPLE } from "../src/sample.ts";

const C = { blue: "#4d9bff", purple: "#b06bff", green: "#7fdc3c", yellow: "#ffd83a", red: "#ff5048" };
let n = 0;
const bots = (...cs: string[]): OwAgent[] => cs.map((c) => ({ id: `a${n++}`, colour: (C as Record<string, string>)[c] ?? c, working: false }));

export const CONCEPT: OwHost[] = [
  {
    id: "local", name: "LOCAL (Host 1)", theme: "forest", stats: { cpu: 42, mem: 58, disk: 70 },
    projects: [
      { id: "p1", name: "core-platform", icon: "code", roof: "red", workspaces: [
        { id: "w1", name: "api", agents: bots("blue", "purple", "green"), awning: "blue" },
        { id: "w2", name: "web", agents: bots("blue", "yellow"), awning: "red" } ] },
      { id: "p2", name: "developer-tools", icon: "cube", roof: "purple", workspaces: [
        { id: "w3", name: "cli", agents: bots("blue"), awning: "purple" } ] },
    ],
  },
  {
    id: "staging", name: "STAGING (Host 2)", theme: "farm", stats: { cpu: 37, mem: 64, disk: 55 },
    projects: [
      { id: "p3", name: "growth", icon: "chart", roof: "red", workspaces: [
        { id: "w4", name: "marketing", agents: bots("blue", "purple"), awning: "red" },
        { id: "w5", name: "analytics", agents: bots("blue", "yellow", "blue"), awning: "red" } ] },
      { id: "p4", name: "experiments", icon: "flask", roof: "purple", workspaces: [
        { id: "w6", name: "events", agents: bots("red"), awning: "purple" },
        { id: "w7", name: "ab-tests", agents: bots("blue", "green", "purple"), awning: "red" } ] },
    ],
  },
  {
    id: "prod", name: "PROD (Host 3)", theme: "volcanic", stats: { cpu: 51, mem: 72, disk: 81 },
    projects: [
      { id: "p5", name: "customer", icon: "person", roof: "red", workspaces: [
        { id: "w8", name: "app", agents: bots("blue", "green", "green") },
        { id: "w9", name: "support", agents: bots("purple", "yellow") } ] },
      { id: "p6", name: "platform", icon: "layers", roof: "purple", workspaces: [
        { id: "w10", name: "infra", agents: bots("blue", "yellow") },
        { id: "w11", name: "data", agents: bots("blue", "green", "yellow", "purple") } ] },
    ],
  },
];

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const K = Number(params.get("k") ?? 4);
  const tex = params.get("tex");
  const sheets = await loadSheets("../src/assets/overworld", tex ? { textures: tex } : {});
  await document.fonts.ready;
  const fleet = params.get("fleet");
  const scene = layout(fleet === "crowded" ? overworldFleet(crowded) : fleet === "sample" ? overworldFleet(SAMPLE) : CONCEPT);
  // Shift the world down by the concept's title band so it lines up with the reference.
  const c = document.createElement("canvas");
  c.width = scene.w * K;
  const H = fleet ? scene.h : 1312;
  c.height = H * K;
  const ctx = c.getContext("2d")!;
  ctx.save();
  ctx.translate(0, Number(params.get("dy") ?? 0) * K);
  const t0 = performance.now();
  paintScene(ctx, { ...scene, h: H }, sheets, { K, t: 0 });
  console.log(`paint ${Math.round(performance.now() - t0)} ms`);
  ctx.restore();
  if (!fleet && params.get("chrome") !== "0") paintChrome(ctx, K);
  document.body.appendChild(c);
  c.style.width = `${scene.w}px`;
  (window as unknown as { done: boolean }).done = true;
}
main().catch((e) => {
  document.body.textContent = String(e?.stack ?? e);
  (window as unknown as { done: string }).done = String(e);
});

// The concept's title plate and counts bar: app chrome, drawn here only to compare like with like.
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = "#1b1a35";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.restore();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "#f7d77c");
  g.addColorStop(0.5, "#c48a2c");
  g.addColorStop(1, "#8a5a1c");
  ctx.strokeStyle = g;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 230, 160, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 5, y + 5, w - 10, h - 10, 5);
  ctx.stroke();
}

function layersIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = s * 0.14;
  ctx.lineJoin = "round";
  for (const dy of [0, s * 0.28, s * 0.56]) {
    ctx.beginPath();
    ctx.moveTo(x - s / 2, y + dy - s * 0.2);
    ctx.lineTo(x, y + dy - s * 0.42);
    ctx.lineTo(x + s / 2, y + dy - s * 0.2);
    ctx.lineTo(x, y + dy + 0.02 * s);
    ctx.closePath();
    if (dy === 0) {
      ctx.fillStyle = "#fff";
      ctx.fill();
    } else ctx.stroke();
  }
  ctx.restore();
}

function paintChrome(ctx: CanvasRenderingContext2D, K: number): void {
  ctx.save();
  ctx.scale(K, K);
  panel(ctx, 10, 8, 610, 62);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(40, 52); ctx.lineTo(62, 30); ctx.lineTo(74, 42); ctx.lineTo(82, 34); ctx.lineTo(102, 52); ctx.closePath();
  ctx.fill();
  ctx.font = `700 29px Georgia, "Times New Roman", serif`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Strategy Map \u2014 Overworld View", 122, 40);
  ctx.font = `500 15.5px ui-rounded, system-ui, sans-serif`;
  ctx.fillText("A high-level map across regions and hosts", 122, 62);
  panel(ctx, 55, 1195, 1090, 74);
  const items: Array<[string, string]> = [["3", "Hosts"], ["6", "Projects"], ["12", "Workspaces"], ["22", "Agents"]];
  const xs = [115, 355, 600, 855];
  items.forEach(([n, label], i) => {
    const x = xs[i];
    layersIcon(ctx, x, 1235, 30);
    ctx.font = `800 27px ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = "#b8e83a";
    ctx.fillText(n, x + 30, 1242);
    const nw = ctx.measureText(n).width;
    ctx.font = `600 22px ui-rounded, system-ui, sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x + 40 + nw, 1241);
    if (i < 3) {
      ctx.fillStyle = "rgba(255, 220, 150, 0.8)";
      ctx.fillRect(xs[i + 1] - 45, 1218, 2, 32);
    }
  });
  ctx.restore();
}
