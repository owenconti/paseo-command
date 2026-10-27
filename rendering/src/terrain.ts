import Phaser from "phaser";
import {
  HEX_RADIUS,
  point,
  cellKey,
  landCells,
  random,
  seedOf,
  projects,
  workspaces,
  distance,
  type Axial,
  footprint,
  fittedWidth,
} from "./world";
import { sprite } from "./textures";
type Edge = { a: { x: number; y: number }; b: { x: number; y: number } };
export const WORLD_BOUNDS = { x: -1020, y: -610, width: 2480, height: 1550 };
function corners(cell: Axial, radius = HEX_RADIUS) {
  const c = point(cell);
  return Array.from({ length: 6 }, (_, i) => ({
    x: c.x + Math.cos((Math.PI / 3) * i - Math.PI / 2) * radius,
    y: c.y + Math.sin((Math.PI / 3) * i - Math.PI / 2) * radius,
  }));
}
function outline(ctx: CanvasRenderingContext2D, cell: Axial) {
  const verts = corners(cell);
  ctx.moveTo(verts[0]!.x, verts[0]!.y);
  for (const p of verts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
}
function coast(cells: Axial[]): Edge[] {
  const edges = new Map<string, Edge>();
  const key = (p: { x: number; y: number }) =>
    `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  for (const cell of cells) {
    const verts = corners(cell);
    for (let i = 0; i < 6; i++) {
      const a = verts[i]!,
        b = verts[(i + 1) % 6]!;
      const id = [key(a), key(b)].sort().join(":");
      if (edges.has(id)) edges.delete(id);
      else edges.set(id, { a, b });
    }
  }
  return [...edges.values()];
}
function cellScenery(
  scene: Phaser.Scene,
  cell: Axial,
  x: number,
  y: number,
  frame: string,
  width: number,
  angle: number,
) {
  const image = sprite(scene, x, y, frame, width).setDepth(2).setAngle(angle);
  const bounds = image.getBounds();
  const allowed = fittedWidth(
    x,
    y,
    bounds.width / bounds.height,
    bounds.width,
    [cell],
  );
  image.setScale((image.scaleX * allowed) / bounds.width);
  image.setData("sceneryCell", cell);
  return image;
}
export function drawTerrain(scene: Phaser.Scene): void {
  const { x, y, width, height } = WORLD_BOUNDS;
  const sand = scene.textures.get("sand").getSourceImage() as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(-x, -y);
  const landPattern = ctx.createPattern(sand, "repeat")!;
  landPattern.setTransform(new DOMMatrix().scale(0.55));
  for (const host of ["local", "macmini"]) {
    const cells = landCells(host),
      edges = coast(cells);
    // Only exposed tile edges get a shoreline; interior cells never receive a coastline.
    for (const [line, color, offset] of [
      [31, "rgba(62,134,143,.35)", 4],
      [20, "rgba(161,223,218,.7)", 0],
      [13, "rgba(235,247,223,.75)", 0],
      [7, "#877c61", 3],
    ] as const) {
      ctx.beginPath();
      for (const e of edges) {
        ctx.moveTo(e.a.x, e.a.y + offset);
        ctx.lineTo(e.b.x, e.b.y + offset);
      }
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.lineWidth = line;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    const rng = random(seedOf(host));
    for (const cell of cells) {
      const p = point(cell),
        shade = Math.floor(rng() * 14);
      ctx.beginPath();
      outline(ctx, cell);
      ctx.fillStyle = `rgb(${237 + Math.floor(shade * 0.3)},${224 + Math.floor(shade * 0.25)},${189 + shade})`;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.64;
      ctx.fillStyle = landPattern;
      ctx.fillRect(
        p.x - HEX_RADIUS,
        p.y - HEX_RADIUS,
        HEX_RADIUS * 2,
        HEX_RADIUS * 2,
      );
      ctx.globalAlpha = 1;
      // Fine seeded paper fibres and mineral speckling, baked once into the terrain layer.
      for (let i = 0; i < 110; i++) {
        const px = p.x + (rng() - 0.5) * HEX_RADIUS * 2,
          py = p.y + (rng() - 0.5) * HEX_RADIUS * 2;
        ctx.fillStyle =
          rng() > 0.45 ? "rgba(116,88,42,.055)" : "rgba(255,252,230,.25)";
        ctx.fillRect(px, py, rng() * 3 + 0.4, rng() * 1.5 + 0.3);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(115,92,52,.20)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.beginPath();
    for (const e of edges) {
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
    }
    ctx.strokeStyle = "#a5946c";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    for (const e of edges) {
      ctx.moveTo(e.a.x, e.a.y - 1);
      ctx.lineTo(e.b.x, e.b.y - 1);
    }
    ctx.strokeStyle = "rgba(255,249,218,.8)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  scene.textures.addCanvas("terrain", canvas);
  scene.add.image(x, y, "terrain").setOrigin(0).setDepth(0);
  const routes = scene.add.graphics().setDepth(1);
  for (const ws of workspaces) {
    const parent = projects.find((p) => p.id === ws.project)!;
    const a = point(parent.position),
      b = point(ws.position);
    routes.lineStyle(15, 0xc5af7d, 0.16);
    routes.lineBetween(a.x, a.y, b.x, b.y);
    routes.lineStyle(2, 0xb09a65, 0.12);
    routes.lineBetween(a.x, a.y, b.x, b.y);
  }
  // Scenery uses unoccupied tiles. It carries no operational identity.
  for (const host of ["local", "macmini"]) {
    const cells = landCells(host),
      rng = random(seedOf(host + "scenery"));
    const occupied = new Set(
      [...projects, ...workspaces]
        .filter((entity) => entity.host === host)
        .flatMap(footprint)
        .map(cellKey),
    );
    for (const cell of cells) {
      if (occupied.has(cellKey(cell))) continue;
      const p = point(cell),
        roll = rng();
      if (roll < 0.48) {
        cellScenery(
          scene,
          cell,
          p.x + (rng() - 0.5) * 35,
          p.y + (rng() - 0.5) * 20,
          roll < 0.23 ? "trees" : "tree-small",
          roll < 0.23 ? 58 : 40,
          (rng() - 0.5) * 25,
        );
      } else if (roll < 0.67) {
        cellScenery(
          scene,
          cell,
          p.x,
          p.y,
          "rocks",
          29 + rng() * 12,
          rng() * 110,
        );
      } else if (roll < 0.86) {
        const g = scene.add.graphics().setDepth(2);
        for (let i = 0; i < 5; i++) {
          const px = p.x + (rng() - 0.5) * 40,
            py = p.y + (rng() - 0.5) * 40;
          g.lineStyle(0.9, 0x88935b, 0.55);
          g.lineBetween(px, py, px - 2, py - 4);
          g.lineBetween(px, py, px + 3, py - 3);
        }
      }
    }
  }
}
