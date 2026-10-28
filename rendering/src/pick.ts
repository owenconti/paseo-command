import { HEX_RADIUS, footprint, type Axial, type AtlasLayout, type Entity } from "./world.ts";

/** The cell under a world point (the inverse of `point`, cube-rounded). */
export function cellAt(x: number, y: number): Axial {
  const r = y / (HEX_RADIUS * 1.5),
    q = x / (HEX_RADIUS * Math.sqrt(3)) - r / 2,
    s = -q - r;
  let rq = Math.round(q),
    rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q),
    dr = Math.abs(rr - r),
    ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  // Avoid -0, so cells compare equal to the layout's.
  return { q: rq + 0, r: rr + 0 };
}

/** What a pointer at a world point picks: the project, workspace or agent
 * whose cells hold it. Hosts are never picked on the map, and open grass and
 * sea pick nothing. */
export function entityAt(layout: AtlasLayout, x: number, y: number): Entity | null {
  const cell = cellAt(x, y);
  return (
    layout.entities.find(
      (e) => e.kind !== "host" && footprint(e).some((c) => c.q === cell.q && c.r === cell.r),
    ) ?? null
  );
}
