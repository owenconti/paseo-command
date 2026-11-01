/** Geometry of the native app's docked session sidebar. The sidebar is flush
 * with the top and bottom edges and with the left or right edge (`side`);
 * Unity renders the world only in the area beside it. */
export type PanelSide = "left" | "right";
export type PanelState = {
  /** Expanded width in CSS pixels. */
  width: number;
  mode: "compact" | "split";
  collapsed: boolean;
  /** The window edge the sidebar docks to. */
  side: PanelSide;
};
export const SIDEBAR_MIN = 320;
export const SIDEBAR_MAX = 960;
export const SIDEBAR_DEFAULT = 440;
/** The two-pane layout needs at least this much sidebar. */
export const SPLIT_MIN = 720;
/** The world always keeps at least this much width when the window allows. */
export const WORLD_MIN = 320;

/** The widest sidebar this window allows. */
export function sidebarLimit(viewportWidth: number) {
  return Math.max(
    Math.min(SIDEBAR_MIN, viewportWidth),
    Math.min(SIDEBAR_MAX, viewportWidth - WORLD_MIN),
  );
}
/** `width`, held between the minimum and what the window allows. */
export function fitSidebar(width: number, viewportWidth: number) {
  const lower = Math.min(SIDEBAR_MIN, Math.max(1, viewportWidth));
  const value = Number.isFinite(width) ? width : SIDEBAR_DEFAULT;
  return Math.round(
    Math.min(sidebarLimit(viewportWidth), Math.max(lower, value)),
  );
}
/** The width the sidebar occupies on screen (none when collapsed: its
 * controls live in the window's top bar). */
export function sidebarExtent(state: PanelState, viewportWidth: number) {
  return state.collapsed ? 0 : fitSidebar(state.width, viewportWidth);
}
/** The width after dragging the sidebar's inner edge `dx` pixels to the
 * right: a left sidebar grows with it, a right sidebar shrinks. */
export const dragWidth = (start: number, dx: number, side: PanelSide) =>
  side === "left" ? start + dx : start - dx;
/** The width an arrow key asks for: the inner edge moves the way the arrow
 * points, so the same key grows a left sidebar and shrinks a right one. */
export function arrowWidth(
  width: number,
  key: string,
  step: number,
  side: PanelSide,
) {
  const outward = side === "left" ? "ArrowRight" : "ArrowLeft";
  const inward = side === "left" ? "ArrowLeft" : "ArrowRight";
  return key === outward ? width + step : key === inward ? width - step : null;
}
/** Whether this window has room for the two-pane layout. */
export const splitFits = (viewportWidth: number) =>
  sidebarLimit(viewportWidth) >= SPLIT_MIN;

const record = (value: unknown) =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
/**
 * The saved sidebar, or the earlier floating panel's width, mode and
 * collapsed state (on the left), or the defaults. Corrupt values fall back individually.
 * The width is the preferred width: a narrower window shows less of it
 * (`sidebarExtent`) without forgetting it.
 */
export function restorePanel(value: unknown, legacy?: unknown): PanelState {
  const saved = record(value) ?? record(legacy);
  const width =
    typeof saved?.width === "number" && Number.isFinite(saved.width)
      ? saved.width
      : SIDEBAR_DEFAULT;
  return {
    width: Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width))),
    mode: saved?.mode === "split" ? "split" : "compact",
    collapsed: saved?.collapsed === true,
    side: saved?.side === "right" ? "right" : "left",
  };
}
