import { D, type DungeonLayout, type Rect } from "./layout.ts";

/** Physical selection details, separate from the pick boxes above a project's hall. */
export function dungeonThresholds(l: Pick<DungeonLayout, "projects" | "workspaces">) {
  const edge = (r: Rect, inset: number) => ({ x: r.x + inset, y: r.y + r.h - 5, w: r.w - inset * 2 });
  return [
    ...l.projects.flatMap((p) => p.entity ? [{
      id: p.entity.id,
      ...edge(p.hall, 7),
      accents: [p.hall.x + 2, p.hall.x + p.hall.w - 22].map((x) => ({ x, y: p.hall.y + 3, w: 20, h: 3 })),
      badge: { x: p.sign.x + 7, y: p.sign.y + p.sign.h * 0.62 },
    }] : []),
    ...l.workspaces.map((w) => ({
      id: w.entity.id,
      ...edge(w.rect, D.alcoveSide),
      accents: [w.rect.x + 5, w.rect.x + w.rect.w - 16].map((x) => ({ x, y: w.rect.y + w.rect.h - 12, w: 11, h: 3 })),
    })),
  ];
}
