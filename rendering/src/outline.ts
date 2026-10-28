import { HEX_RADIUS, point, type Axial } from "./world.ts";

type P = { x: number; y: number };
/** An entity's outer perimeter, ready to stroke at `width`. `segments` holds
 * its `edgeCount` inset sides first, then the bridges across the steps where
 * two cells meet; `caps` are the sides' inset ends, one per side end (so a
 * corner shared by two sides of one cell repeats), each a dot `width` across.
 * Drawn in that order (sides, caps, bridges), overlapping strokes keep the
 * order Phaser has always drawn them in. */
export type Perimeter = { segments: [P, P][]; caps: P[]; edgeCount: number };

const corner = (c: P, i: number, r: number) => ({
  x: c.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * r,
  y: c.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * r,
});

/**
 * Trace the outer perimeter of some cells. `inset` keeps a stroke `width`
 * wide wholly inside its cells, so painted kerbs and banks beside them never
 * cut into it; each side is pulled in toward its own cell, and the steps where
 * two cells meet are bridged.
 */
export function perimeter(cells: Axial[], width: number, inset = true): Perimeter {
  const key = (p: P) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
  const shrink = inset ? width / 2 / Math.cos(Math.PI / 6) : 0;
  const sides = new Map<string, { a: P; b: P; ia: P; ib: P }>();
  for (const cell of cells) {
    const c = point(cell);
    for (let i = 0; i < 6; i++) {
      const a = corner(c, i, HEX_RADIUS),
        b = corner(c, i + 1, HEX_RADIUS),
        id = [key(a), key(b)].sort().join(":");
      if (sides.has(id)) sides.delete(id);
      else sides.set(id, { a, b, ia: corner(c, i, HEX_RADIUS - shrink), ib: corner(c, i + 1, HEX_RADIUS - shrink) });
    }
  }
  const segments: [P, P][] = [];
  // Each perimeter corner, with the inset ends that meet there.
  const ends = new Map<string, P[]>();
  for (const { a, b, ia, ib } of sides.values()) {
    segments.push([ia, ib]);
    for (const [p, q] of [[a, ia], [b, ib]] as const) {
      const list = ends.get(key(p)) ?? [];
      list.push(q);
      ends.set(key(p), list);
    }
  }
  const caps: P[] = [];
  for (const list of ends.values()) {
    caps.push(...list);
    if (list.length === 2 && key(list[0]!) !== key(list[1]!)) segments.push([list[0]!, list[1]!]);
  }
  return { segments, caps, edgeCount: sides.size };
}
