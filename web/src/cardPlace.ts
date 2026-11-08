/** Where a map hover card goes so it lies wholly inside the map the user sees (pure, `cardPlace.test.ts`). */

/** Between the card and the thing it's about. */
export const CARD_GAP = 8;
/** Between the card and the map's edges. */
export const CARD_MARGIN = 8;

export type CardSize = { width: number; height: number };
/** The thing the card is about, in the view's coordinates: its top centre (`x`, `y`) and, when known, its bottom edge. */
export type CardAnchor = { x: number; y: number; bottom?: number };
export type CardPlace = {
  left: number;
  top: number;
  /** Set when the card is taller than the view: it's cut to this height. */
  maxHeight?: number;
  side: "above" | "below";
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** Above the thing if the card fits there (as it always stood); else below it if it fits there; else on the side
 * with more room, moved inside the view, and cut to the view's height if it's taller. Centred on the thing's x,
 * kept inside the view sideways. */
export function placeCard(view: CardSize, at: CardAnchor, card: CardSize): CardPlace {
  const m = CARD_MARGIN;
  const left = clamp(at.x - card.width / 2, m, view.width - m - card.width);
  const room = Math.max(0, view.height - 2 * m);
  const above = at.y - CARD_GAP - card.height;
  const below = (at.bottom ?? at.y) + CARD_GAP;
  if (card.height <= room) {
    if (above >= m) return { left, top: above, side: "above" };
    if (below + card.height <= view.height - m) return { left, top: below, side: "below" };
  }
  const side = at.y - CARD_GAP - m >= view.height - m - below ? "above" : "below";
  if (card.height > room) return { left, top: m, maxHeight: room, side };
  return { left, top: clamp(side === "above" ? above : below, m, view.height - m - card.height), side };
}
