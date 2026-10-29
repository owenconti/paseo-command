/** Axial hex helpers and the Atlas art the games draw with. */
import robotsUrl from "../../../rendering/src/assets/robots.png";
import propsUrl from "../../../rendering/src/assets/props.png";
import treeUrl from "../../../rendering/src/assets/tree-v2.png";
import PROPS from "../../../rendering/src/assets/props.json";

export type Hex = { q: number; r: number };

export const key = (h: Hex) => `${h.q},${h.r}`;

const DIRS: Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export const neighbours = (h: Hex): Hex[] =>
  DIRS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));

export const ring = (h: Hex) => Math.max(Math.abs(h.q), Math.abs(h.r), Math.abs(h.q + h.r));

/** Every cell within `radius` of the origin. */
export function disc(radius: number): Hex[] {
  const cells: Hex[] = [];
  for (let q = -radius; q <= radius; q++)
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r++)
      cells.push({ q, r });
  return cells;
}

/** Centre of a pointy-top cell of circumradius `size`. */
export const pointy = (h: Hex, size: number) => ({
  x: size * Math.sqrt(3) * (h.q + h.r / 2),
  y: size * 1.5 * h.r,
});

/** SVG points of a hex at (x, y): pointy or flat topped. */
export function corners(x: number, y: number, size: number, flat = false): string {
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i + (flat ? 0 : 30));
    out.push(`${(x + size * Math.cos(a)).toFixed(2)},${(y + size * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(" ");
}

export const shuffle = <T,>(xs: T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

type Art = { href: string; sheet: [number, number]; rect: [number, number, number, number] };

export const ROBOTS = ["teal", "violet", "lime", "blue"] as const;
export function robotArt(i: number): Art {
  // Each robot's opaque bounds in its quarter of the sheet.
  return { href: robotsUrl, sheet: [1536, 1024], rect: [162 + (i % 2) * 715, 68 + Math.floor(i / 2) * 508, 489, 351] };
}
export type PropName = keyof typeof PROPS;
export function propArt(name: PropName): Art {
  return { href: propsUrl, sheet: [2048, 1536], rect: PROPS[name].rect as Art["rect"] };
}
export const treeArt: Art = { href: treeUrl, sheet: [1, 1], rect: [0, 0, 1, 1] };

/** A cropped sprite from a sheet, fitted into a `size` box centred on (x, y). */
export function Sprite({ art, x = 0, y = 0, size }: { art: Art; x?: number; y?: number; size: number }) {
  const [rx, ry, rw, rh] = art.rect;
  if (art === treeArt)
    return <image href={art.href} x={x - size / 2} y={y - size / 2} width={size} height={size} />;
  return (
    <svg
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      viewBox={`${rx} ${ry} ${rw} ${rh}`}
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
    >
      <image href={art.href} width={art.sheet[0]} height={art.sheet[1]} />
    </svg>
  );
}
