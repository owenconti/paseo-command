import { HEX_RADIUS, landBounds, type AtlasLayout, type Entity } from "./world.ts";

/** Closest zoom, in CSS px per world px (multiply by the render density). */
export const MAX_ZOOM = 2.4;
/** Screen room (CSS pixels) kept for the map's floating status above and legend below. */
export const OVERLAY_TOP = 76;
export const OVERLAY_BOTTOM = 72;

type Box = { x: number; y: number; width: number; height: number };
/** The map's size in render px, i.e. CSS px × density. Every zoom here is in
 * render px per world px. */
export type View = { width: number; height: number };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** The world box the camera may show: the land, room for each host's shores
 * all round and its banner above (in world units), and for the map's own
 * floating overlays (status above, legend below), which keep their
 * screen size at any zoom. */
export function mapExtent(layout: AtlasLayout | null, view: View, density: number): Box {
  const bounds = layout ? landBounds(layout) : { x: -400, y: -300, width: 800, height: 600 };
  const marginX = HEX_RADIUS * 1.6,
    top = HEX_RADIUS * 1.6,
    bottom = HEX_RADIUS * 0.9;
  const padTop = OVERLAY_TOP * density,
    padBottom = OVERLAY_BOTTOM * density;
  // The zoom at which land, world margins and overlays just fit; the
  // overlays' room is fixed at that zoom so the extent stays put.
  const zoom = Math.max(
    0.01,
    Math.min(
      view.width / (bounds.width + marginX * 2),
      (view.height - padTop - padBottom) / (bounds.height + top + bottom),
    ),
  );
  return {
    x: bounds.x - marginX,
    y: bounds.y - top - padTop / zoom,
    width: bounds.width + marginX * 2,
    height: bounds.height + top + bottom + (padTop + padBottom) / zoom,
  };
}

/** The furthest out the camera goes: the whole extent just fits. */
export function minimumZoom(layout: AtlasLayout | null, view: View, density: number): number {
  const extent = mapExtent(layout, view, density);
  return Math.min(view.width / extent.width, view.height / extent.height);
}

/** Keep the zoom within its limits and the view within the extent; a view
 * wider (or taller) than the extent centres on it along that axis. */
export function clampCamera(
  c: { centerX: number; centerY: number; zoom: number },
  layout: AtlasLayout | null,
  view: View,
  density: number,
): { centerX: number; centerY: number; zoom: number } {
  const extent = mapExtent(layout, view, density);
  const zoom = clamp(c.zoom, minimumZoom(layout, view, density), MAX_ZOOM * density);
  const w = view.width / zoom,
    h = view.height / zoom;
  const centerX =
    w >= extent.width
      ? extent.x + extent.width / 2
      : clamp(c.centerX, extent.x + w / 2, extent.x + extent.width - w / 2);
  const centerY =
    h >= extent.height
      ? extent.y + extent.height / 2
      : clamp(c.centerY, extent.y + h / 2, extent.y + extent.height - h / 2);
  return { centerX, centerY, zoom };
}

/** The zoom that frames an entity at `loc` (its `locations` box). Not yet
 * limited: clamp it to `minimumZoom` and `MAX_ZOOM * density`. */
export function focusZoom(kind: Entity["kind"], loc: Box, view: View, density: number): number {
  if (kind === "host")
    return Math.min((view.width - 90 * density) / loc.width, (view.height - 80 * density) / loc.height);
  if (kind === "project") return Math.min(1.5 * density, view.height / 650);
  return 1.5 * density;
}

/** Whether a location's centre sits well inside the visible world box (12%
 * margins), so bringing it into view needs no pan. */
export function comfortablyVisible(loc: Box, worldView: Box): boolean {
  const mx = worldView.width * 0.12,
    my = worldView.height * 0.12;
  return (
    loc.x > worldView.x + mx &&
    loc.x < worldView.x + worldView.width - mx &&
    loc.y > worldView.y + my &&
    loc.y < worldView.y + worldView.height - my
  );
}
