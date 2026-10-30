import {
  HEX_RADIUS,
  point,
  cellKey,
  random,
  seedOf,
  type Axial,
  type AtlasLayout,
  type Island,
  footprint,
  cellBounds,
} from "./world";
type Edge = { a: { x: number; y: number }; b: { x: number; y: number } };
/** Room around the land for its bank. */
const SURF = 40;
/** The meadow the islands rise from. */
export const GROUND = "#566f31";
const EARTH = "74,56,30";

/** Smooth value noise on a lattice that wraps every `period` cells. */
function periodicNoise(period: number, seed: number) {
  const rng = random(seed);
  const grid = Float32Array.from({ length: period * period }, () => rng());
  const at = (x: number, y: number) =>
    grid[(((y % period) + period) % period) * period + (((x % period) + period) % period)]!;
  return (u: number, v: number) => {
    const x = u * period,
      y = v * period,
      x0 = Math.floor(x),
      y0 = Math.floor(y),
      fx = x - x0,
      fy = y - y0,
      sx = fx * fx * (3 - 2 * fx),
      sy = fy * fy * (3 - 2 * fy);
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bottom - top) * sy;
  };
}
function fbm(periods: number[], seed: number) {
  const layers = periods.map((p, i) => periodicNoise(p, seed + i * 7919));
  return (u: number, v: number) => {
    let sum = 0,
      weight = 0,
      amp = 1;
    for (const layer of layers) {
      sum += layer(u, v) * amp;
      weight += amp;
      amp *= 0.55;
    }
    return sum / weight;
  };
}
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);

/** A seamless tile of meadow seen from above: lush and dry patches, grain and tufts. */
function paintGroundCanvas(): HTMLCanvasElement {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const patches = fbm([3, 6, 12], 11),
    detail = fbm([24, 48, 96, 192], 23),
    rng = random(seedOf("meadow"));
  const lush = [62, 92, 38],
    dry = [128, 132, 70],
    shade = [38, 58, 26];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const dryness = Math.max(0, Math.min(1, (patches(u, v) - 0.42) * 2.1));
      const d = detail(u, v);
      let c = mix(lush, dry, dryness * 0.75);
      c = mix(c, shade, Math.max(0, 0.5 - d) * 0.9);
      const grain = (rng() - 0.5) * 16;
      const i = (y * size + x) * 4;
      image.data[i] = c[0]! + grain;
      image.data[i + 1] = c[1]! + grain;
      image.data[i + 2] = c[2]! + grain * 0.6;
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  // Tufts: little clusters of blades, wrapped at the edges so the tile stays seamless.
  const blade = (x: number, y: number, angle: number, length: number, color: string) => {
    for (const dx of [0, ...(x < 8 ? [size] : []), ...(x > size - 8 ? [-size] : [])])
      for (const dy of [0, ...(y < 8 ? [size] : []), ...(y > size - 8 ? [-size] : [])]) {
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + dx, y + dy);
        ctx.lineTo(x + dx + Math.cos(angle) * length, y + dy + Math.sin(angle) * length);
        ctx.stroke();
      }
  };
  ctx.lineCap = "round";
  for (let i = 0; i < 9000; i++) {
    const x = rng() * size,
      y = rng() * size,
      light = rng() > 0.45;
    ctx.lineWidth = 0.7 + rng() * 0.6;
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++)
      blade(
        x,
        y,
        rng() * Math.PI * 2,
        2 + rng() * 4,
        light
          ? `rgba(${150 + rng() * 40},${170 + rng() * 30},${80 + rng() * 30},.32)`
          : "rgba(24,40,14,.3)",
      );
  }
  // Sparse wildflowers and bare earth.
  for (let i = 0; i < 260; i++) {
    const x = rng() * size,
      y = rng() * size,
      roll = rng();
    ctx.fillStyle =
      roll < 0.4
        ? "rgba(246,240,214,.75)"
        : roll < 0.7
          ? "rgba(236,204,84,.7)"
          : `rgba(${EARTH},.22)`;
    ctx.beginPath();
    ctx.arc(x, y, roll < 0.7 ? 0.9 + rng() * 0.8 : 2 + rng() * 4, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}
let groundCache: HTMLCanvasElement | null = null;
/** A seamless tile of meadow, memoized: the same canvas every call. */
export function groundTile(): HTMLCanvasElement {
  return (groundCache ??= paintGroundCanvas());
}

/** The sea the hosts' landmasses rise from. */
export const WATER = "#1d6884";

function paintWaterCanvas(): HTMLCanvasElement {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const depth = fbm([3, 6, 12], 101),
    swell = fbm([8, 16, 32], 131),
    ripple = fbm([24, 48, 96], 157),
    rng = random(seedOf("water"));
  const deep = [20, 74, 102],
    mid = [33, 112, 138],
    light = [64, 158, 172];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      let c = mix(deep, mid, Math.max(0, Math.min(1, (depth(u, v) - 0.3) * 1.8)));
      c = mix(c, light, Math.max(0, swell(u, v) - 0.58) * 1.6);
      // Thin bright crests where the ripple field folds.
      const crest = Math.pow(1 - Math.abs(ripple(u, v) * 2 - 1), 34);
      const grain = (rng() - 0.5) * 5;
      const i = (y * size + x) * 4;
      image.data[i] = c[0]! + crest * 38 + grain;
      image.data[i + 1] = c[1]! + crest * 48 + grain;
      image.data[i + 2] = c[2]! + crest * 44 + grain;
      image.data[i + 3] = 255;
    }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
let waterCache: HTMLCanvasElement | null = null;
/** A seamless tile of open water, memoized: depth mottling and fine ripple light. */
export function waterTile(): HTMLCanvasElement {
  return (waterCache ??= paintWaterCanvas());
}

function paintGlintsCanvas(): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const ripple = fbm([12, 24, 48], 211);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const crest = Math.pow(1 - Math.abs(ripple(x / size, y / size) * 2 - 1), 48);
      const i = (y * size + x) * 4;
      image.data[i] = 225;
      image.data[i + 1] = 245;
      image.data[i + 2] = 240;
      image.data[i + 3] = crest * 120;
    }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
let glintsCache: HTMLCanvasElement | null = null;
/** Moving sparkle on the water, memoized: sparse crests only, drawn over the
 * sea and drifted. */
export function glintsTile(): HTMLCanvasElement {
  return (glintsCache ??= paintGlintsCanvas());
}

function paintCloudsCanvas(): HTMLCanvasElement {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  const n = fbm([3, 6, 12, 24], 41);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = n(x / size, y / size);
      const a = Math.max(0, Math.min(1, (v - 0.56) * 4));
      const i = (y * size + x) * 4;
      image.data[i] = 12;
      image.data[i + 1] = 20;
      image.data[i + 2] = 10;
      image.data[i + 3] = a * a * 255;
    }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
let cloudsCache: HTMLCanvasElement | null = null;
/** Soft cloud shadows, memoized: seamless, to drift slowly over the whole map. */
export function cloudsTile(): HTMLCanvasElement {
  return (cloudsCache ??= paintCloudsCanvas());
}

/** A piece of terrain artwork, ready to become a texture: a generated
 * canvas plus where it goes and how it reads. */
export type Piece = {
  kind: "variation" | "landmass" | "island";
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
  tint?: number;
  alpha?: number;
  depth: number;
};

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

/** A host's land: grass hex tiles on the shared grid, rising from the sea with
 * turquoise shallows, a foam line and a sandy beach along its hex coast. */
function landmassPiece(
  land: { host: string; online: boolean; cells: Axial[] },
  seed: string,
): Piece {
  const cells = land.cells;
  const bounds = cellBounds(cells);
  const reach = HEX_RADIUS * 1.2;
  const x0 = bounds.x - reach,
    y0 = bounds.y - reach,
    width = bounds.width + reach * 2,
    height = bounds.height + reach * 2;
  const k = 0.7;
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(width * k);
  canvas.height = Math.ceil(height * k);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(k, k);
  ctx.translate(-x0, -y0);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const edges = coast(cells);
  const trace = () => {
    ctx.beginPath();
    for (const e of edges) {
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
    }
  };
  const fillLand = () => {
    ctx.beginPath();
    for (const cell of cells) outline(ctx, cell);
  };
  // Shallows and foam, outside the land.
  ctx.save();
  ctx.filter = "blur(10px)";
  trace();
  ctx.lineWidth = 120;
  ctx.strokeStyle = "rgba(80,184,180,.32)";
  ctx.stroke();
  trace();
  ctx.lineWidth = 56;
  ctx.strokeStyle = "rgba(118,206,196,.45)";
  ctx.stroke();
  ctx.restore();
  trace();
  ctx.lineWidth = 16;
  ctx.strokeStyle = "rgba(228,244,238,.75)";
  ctx.stroke();
  // Grass tiles.
  const pattern = ctx.createPattern(groundTile(), "repeat")!;
  for (const cell of cells) {
    const shade = random(seedOf(seed + cellKey(cell)))();
    ctx.beginPath();
    outline(ctx, cell);
    ctx.fillStyle = pattern;
    ctx.fill();
    ctx.fillStyle = shade > 0.5 ? `rgba(255,250,200,${(shade - 0.5) * 0.12})` : `rgba(10,30,5,${(0.5 - shade) * 0.16})`;
    ctx.fill();
    ctx.strokeStyle = "rgba(20,36,10,.16)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  // Beach: the sand band just inside the coast.
  ctx.save();
  fillLand();
  ctx.clip();
  trace();
  ctx.lineWidth = 30;
  ctx.strokeStyle = "rgb(214,192,140)";
  ctx.stroke();
  trace();
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgb(178,156,112)";
  ctx.stroke();
  ctx.restore();
  return {
    kind: "landmass",
    canvas,
    x: x0,
    y: y0,
    width,
    height,
    depth: -8,
    ...(land.online ? {} : { tint: 0xb0ad9f, alpha: 0.85 }),
  };
}

/** Large, non-repeating variation over the map, so the meadow tile never reads as a tile. */
function variationPiece(layout: AtlasLayout): Piece {
  const land = cellBounds(layout.islands.flatMap((i) => i.cells));
  const margin = 3000;
  const x = land.x - margin,
    y = land.y - margin,
    width = land.width + margin * 2,
    height = land.height + margin * 2;
  const cells = 96;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = cells;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(cells, cells);
  // A fixed seed, not the map's layout: this texture is decorative noise,
  // the same every time so every renderer agrees on it.
  const n = fbm([4, 8, 16], seedOf("variation-1"));
  for (let j = 0; j < cells; j++)
    for (let i = 0; i < cells; i++) {
      const v = n(i / cells, j / cells),
        k = (j * cells + i) * 4,
        dark = v < 0.5;
      image.data[k] = dark ? 8 : 90;
      image.data[k + 1] = dark ? 34 : 170;
      image.data[k + 2] = dark ? 58 : 182;
      image.data[k + 3] = Math.abs(v - 0.5) * 2 * (dark ? 120 : 60);
    }
  ctx.putImageData(image, 0, 0);
  return { kind: "variation", canvas, x, y, width, height, depth: -9 };
}

/** One baked canvas per island keeps every texture well within GPU limits. */
type TileStyle = "project" | "workspace" | "empty";
/** The painted material tiles: agents' sand (`sand.png`) and workspaces' dirt (`dirt.png`). */
export type Tiles = { sand: HTMLImageElement; dirt: HTMLImageElement };
/** Laid stone for a landmark's courtyard: staggered courses of worn flagstones. */
function flagstones(ctx: CanvasRenderingContext2D, c: { x: number; y: number }) {
  ctx.fillStyle = "rgb(150,142,126)";
  ctx.fillRect(c.x - HEX_RADIUS, c.y - HEX_RADIUS, HEX_RADIUS * 2, HEX_RADIUS * 2);
  // One running bond anchored to the world, so courses continue unbroken
  // across every cell of a courtyard. Each stone's look comes from its own
  // world position, never from the cell drawing it.
  const course = 19,
    stone = 34;
  const first = Math.floor((c.y - HEX_RADIUS) / course);
  for (let row = first; row * course < c.y + HEX_RADIUS; row++) {
    const y = row * course,
      offset = (((row * 13) % stone) + stone) % stone;
    const col0 = Math.floor((c.x - HEX_RADIUS - offset) / stone);
    for (let col = col0; col * stone + offset < c.x + HEX_RADIUS; col++) {
      const x = col * stone + offset,
        shade = (random(seedOf(`${row},${col}`))() - 0.5) * 26;
      ctx.fillStyle = `rgb(${206 + shade},${199 + shade},${183 + shade * 0.8})`;
      ctx.beginPath();
      ctx.roundRect(x + 1.2, y + 1.2, stone - 2.4, course - 2.4, 3);
      ctx.fill();
      // A worn highlight along each stone's upper edge.
      ctx.strokeStyle = "rgba(255,250,236,.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 3, y + 2.2);
      ctx.lineTo(x + stone - 3, y + 2.2);
      ctx.stroke();
    }
  }
}
function islandPiece(
  island: Island,
  styleOf: (cell: Axial) => TileStyle,
  plots: { style: TileStyle; cells: Axial[] }[],
  tiles: Tiles,
): Piece {
  const bounds = cellBounds(island.cells);
  const x = Math.floor(bounds.x - SURF),
    y = Math.floor(bounds.y - SURF);
  const width = Math.ceil(bounds.width + SURF * 2),
    height = Math.ceil(bounds.height + SURF * 2);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(-x, -y);
  const landPattern = ctx.createPattern(tiles.sand, "repeat")!;
  landPattern.setTransform(new DOMMatrix().scale(0.55));
  // Anchored to the world, so a workspace's three cells read as one yard.
  const dirtPattern = ctx.createPattern(tiles.dirt, "repeat")!;
  dirtPattern.setTransform(new DOMMatrix().scale(0.4));
  const cells = island.cells,
    edges = coast(cells);
  // An earthen bank outlines each island without casting a shadow on the grass.
  const trace = (dy = 0) => {
    ctx.beginPath();
    for (const e of edges) {
      ctx.moveTo(e.a.x, e.a.y + dy);
      ctx.lineTo(e.b.x, e.b.y + dy);
    }
  };
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const [width, color, dy] of [
    [16, `rgba(${EARTH},.95)`, 3],
    [11, "rgba(118,94,58,1)", 1],
    [6, "rgba(168,142,96,1)", 0],
  ] as const) {
    trace(dy);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }
  for (const cell of cells) {
    const p = point(cell),
      rng = random(seedOf(island.key + cellKey(cell))),
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
    const style = styleOf(cell);
    if (style === "project") flagstones(ctx, p);
    if (style === "workspace") {
      ctx.fillStyle = dirtPattern;
      ctx.fillRect(p.x - HEX_RADIUS, p.y - HEX_RADIUS, HEX_RADIUS * 2, HEX_RADIUS * 2);
    }
    ctx.restore();
    // Only open sand shows the grid; built plots read as one surface.
    if (style === "empty") {
      ctx.strokeStyle = "rgba(115,92,52,.20)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }
  // A firm kerb around each structure's plot, inside its own cells only, so a
  // landmark's ten cells read as one courtyard and a cottage as one yard.
  for (const plot of plots) {
    ctx.save();
    ctx.beginPath();
    for (const cell of plot.cells) outline(ctx, cell);
    ctx.clip();
    ctx.beginPath();
    for (const e of coast(plot.cells)) {
      ctx.moveTo(e.a.x, e.a.y);
      ctx.lineTo(e.b.x, e.b.y);
    }
    ctx.lineJoin = "round";
    ctx.strokeStyle = plot.style === "project" ? "rgba(98,90,76,.95)" : "rgba(112,80,48,.95)";
    ctx.lineWidth = plot.style === "project" ? 12 : 14;
    ctx.stroke();
    ctx.restore();
  }
  ctx.beginPath();
  for (const e of edges) {
    ctx.moveTo(e.a.x, e.a.y);
    ctx.lineTo(e.b.x, e.b.y);
  }
  ctx.strokeStyle = "rgba(120,98,62,.7)";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  return {
    kind: "island",
    canvas,
    x,
    y,
    width,
    height,
    depth: 0,
    // An unreachable host keeps its last known shape, faded like an old chart.
    ...(island.online ? {} : { tint: 0xb9b4a6, alpha: 0.78 }),
  };
}

/** Every piece of terrain artwork the map needs for this layout: the
 * project and workspace islands, the drift-breaking variation overlay, and
 * each host's landmass. The native app's bridge sends them to SpriteKit as
 * textures. */
export function terrainPieces(layout: AtlasLayout, tiles: Tiles): Piece[] {
  return terrainParts(layout, tiles).map((part) => part.paint());
}

/** `terrainPieces`, each unpainted, with a key that changes whenever what it
 * would paint does: a renderer that keeps textures paints only new keys. */
export function terrainParts(layout: AtlasLayout, tiles: Tiles): { key: string; paint: () => Piece }[] {
  const projectCells = new Set(layout.projects.flatMap(footprint).map(cellKey));
  // Light dirt spans a workspace's three cells; its agents stand on the
  // light tiles of the other cells.
  const workspaceCells = new Set(layout.workspaces.flatMap(footprint).map(cellKey));
  const styleOf = (cell: Axial): TileStyle =>
    projectCells.has(cellKey(cell))
      ? "project"
      : workspaceCells.has(cellKey(cell))
        ? "workspace"
        : "empty";
  const plots = [
    ...layout.projects.map((p) => ({ style: "project" as const, host: p.host, cells: footprint(p) })),
    ...layout.workspaces.map((w) => ({ style: "workspace" as const, host: w.host, cells: footprint(w) })),
  ];
  const parts = layout.islands.map((island) => {
    const own = new Set(island.cells.map(cellKey));
    const mine = plots.filter((p) => p.host === island.host && own.has(cellKey(p.cells[0]!)));
    return {
      key: `island:${JSON.stringify([island.key, island.online, island.cells.map((c) => [cellKey(c), styleOf(c)]), mine])}`,
      paint: () => islandPiece(island, styleOf, mine, tiles),
    };
  });
  parts.push({
    key: `variation:${JSON.stringify(cellBounds(layout.islands.flatMap((i) => i.cells)))}`,
    paint: () => variationPiece(layout),
  });
  // One landmass of grass hexes per host, under its project islands. Each
  // grass hex's shade comes from a fixed seed, not the host: decorative
  // grain, the same every time so every renderer (and every build) agrees.
  layout.land.forEach((land, i) =>
    parts.push({
      key: `landmass:${i}:${JSON.stringify([land.online, land.cells.map(cellKey)])}`,
      paint: () => landmassPiece(land, `landmass-1-${i}`),
    }),
  );
  return parts;
}

