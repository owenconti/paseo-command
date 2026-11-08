import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CARD_GAP, CARD_MARGIN, placeCard } from "./cardPlace";

const view = { width: 800, height: 600 };
const card = { width: 200, height: 100 };
const inside = (p: { left: number; top: number; maxHeight?: number }, size = card, v = view) => {
  assert.ok(p.left >= CARD_MARGIN, `left ${p.left}`);
  assert.ok(p.top >= CARD_MARGIN, `top ${p.top}`);
  assert.ok(p.left + size.width <= v.width - CARD_MARGIN, `right ${p.left + size.width}`);
  assert.ok(p.top + (p.maxHeight ?? size.height) <= v.height - CARD_MARGIN, `bottom ${p.top + (p.maxHeight ?? size.height)}`);
};

describe("map hover cards", () => {
  it("stand centred above the thing when they fit there", () => {
    const p = placeCard(view, { x: 400, y: 300, bottom: 340 }, card);
    assert.deepEqual(p, { left: 300, top: 300 - CARD_GAP - 100, side: "above" });
  });

  it("go below the thing when there's no room above", () => {
    const p = placeCard(view, { x: 400, y: 4, bottom: 40 }, card);
    assert.deepEqual(p, { left: 300, top: 40 + CARD_GAP, side: "below" });
    inside(p);
    // Without its bottom edge, below its top.
    assert.equal(placeCard(view, { x: 400, y: 4 }, card).top, 4 + CARD_GAP);
  });

  it("take the roomier side, moved inside the view, when neither fits", () => {
    const tall = { width: 200, height: 400 };
    const high = placeCard(view, { x: 400, y: 330, bottom: 360 }, tall);
    assert.equal(high.side, "above");
    assert.equal(high.top, CARD_MARGIN);
    inside(high, tall);
    const low = placeCard(view, { x: 400, y: 150, bottom: 260 }, tall);
    assert.equal(low.side, "below");
    inside(low, tall);
  });

  it("are cut to the view's height when taller than it", () => {
    const p = placeCard(view, { x: 400, y: 10, bottom: 30 }, { width: 200, height: 900 });
    assert.equal(p.top, CARD_MARGIN);
    assert.equal(p.maxHeight, view.height - 2 * CARD_MARGIN);
    inside(p, { width: 200, height: 900 });
  });

  it("keep inside the view sideways", () => {
    inside(placeCard(view, { x: 795, y: 300 }, card));
    assert.equal(placeCard(view, { x: 795, y: 300 }, card).left, 800 - CARD_MARGIN - 200);
    assert.equal(placeCard(view, { x: -20, y: 300 }, card).left, CARD_MARGIN);
    // A thing whose top is out of view: below it, where it shows.
    inside(placeCard(view, { x: 400, y: -60, bottom: 30 }, card));
  });
});
