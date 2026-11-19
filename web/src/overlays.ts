/**
 * The page's own things that lie over the native views the macOS app lays on the page (your editor's terminal, the
 * agent's browser): tooltips, menus (the glance's, row menus) and the top bar's popovers (usage, What's new, games).
 * Those views are above the web view, so the page sends where these are (`holes`) and the app cuts them out.
 */
import type { Rect } from "./browser/browserBridge";

export const OVERLAYS = ".tooltip.shown, .popover-menu, .usage-card, .releases-popover, .games-window";

/** The overlays on screen that meet `box` (a client rect), a little wider than each for its shadow's nearest edge. */
export function overlayHoles(box: DOMRect, selector = OVERLAYS): Rect[] {
  const holes: Rect[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const o = el.getBoundingClientRect();
    if (o.width < 1 || o.height < 1 || o.right <= box.left || o.left >= box.right || o.bottom <= box.top || o.top >= box.bottom) continue;
    holes.push({ x: Math.floor(o.left) - 2, y: Math.floor(o.top) - 2, width: Math.ceil(o.width) + 4, height: Math.ceil(o.height) + 4 });
    if (holes.length >= 12) break;
  }
  return holes;
}
