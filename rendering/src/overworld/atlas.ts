// Loads the Overworld sprite sheets (rendering/src/assets/overworld) and their frame maps.

export interface Frame {
  img: CanvasImageSource;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Anchor in frame pixels (where the sprite stands). */
  ax: number;
  ay: number;
  meta: Record<string, unknown>;
}

export type Sheets = Record<string, { frames: Map<string, Frame>; json: Record<string, unknown> }>;

export const SHEETS = [
  "host",
  "halls",
  "stalls",
  "robots",
  "ui-world",
  "terrain",
  "water",
  "theme-forest",
  "theme-farm",
  "theme-volcanic",
  "props",
  "status",
  "textures",
  "coast",
  "foliage",
  "sea2",
] as const;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

type Source = { json: Record<string, unknown>; url: string };

function framesOf(json: Record<string, unknown>, img: CanvasImageSource): Map<string, Frame> {
  const frames = new Map<string, Frame>();
  const raw = json.frames as Record<string, Record<string, unknown>> | Array<Record<string, unknown>>;
  const entries: Array<[string, Record<string, unknown>]> = Array.isArray(raw) ? raw.map((f) => [String(f.name), f]) : Object.entries(raw);
  for (const [key, f] of entries) {
    const w = Number(f.w);
    const h = Number(f.h);
    const anchor = f.anchor as { x: number; y: number } | undefined;
    frames.set(key, { img, x: Number(f.x), y: Number(f.y), w, h, ax: anchor ? Number(anchor.x) : w / 2, ay: anchor ? Number(anchor.y) : h, meta: f });
  }
  return frames;
}

/** The sheets from bundled sources (the app: Vite's asset URLs and JSON). A missing sheet is left out. */
export async function loadSheetsFrom(source: (name: string) => Source | undefined): Promise<Sheets> {
  const out: Sheets = {};
  await Promise.all(
    SHEETS.map(async (name) => {
      const src = source(name);
      if (!src) return;
      out[name] = { frames: framesOf(src.json, await loadImage(src.url)), json: src.json };
    }),
  );
  return out;
}

/** The sheets from a folder of PNGs and JSONs (the preview page). */
export async function loadSheets(base: string, overrides: Record<string, string> = {}): Promise<Sheets> {
  const out: Sheets = {};
  await Promise.all(
    SHEETS.map(async (name) => {
      const dir = overrides[name] ?? base;
      const res = await fetch(`${dir}/${name}.json`);
      if (!res.ok) return;
      const json = (await res.json()) as Record<string, unknown>;
      const img = await loadImage(`${dir}/${String(json.image ?? `${name}.png`)}`);
      out[name] = { frames: framesOf(json, img), json };
    }),
  );
  return out;
}

export function frameOf(sheets: Sheets, sheet: string, name: string): Frame {
  const f = sheets[sheet]?.frames.get(name);
  if (!f) throw new Error(`missing frame ${sheet}/${name}`);
  return f;
}

export function hasFrame(sheets: Sheets, sheet: string, name: string): boolean {
  return Boolean(sheets[sheet]?.frames.get(name));
}

/** A sheet's frame names starting with `prefix`, in name order (empty when the sheet is absent). */
export function framesWithPrefix(sheets: Sheets, sheet: string, prefix: string): string[] {
  const frames = sheets[sheet]?.frames;
  if (!frames) return [];
  return [...frames.keys()].filter((k) => k.startsWith(prefix)).sort();
}
