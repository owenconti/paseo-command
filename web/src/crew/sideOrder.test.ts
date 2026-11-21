import assert from "node:assert/strict";
import { test } from "node:test";
import { inSideOrder, setSideOrder, sideOrderNow } from "./sideOrder";

test("stepping follows the crew list's order while it shows, else the roster", () => {
  const roster = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(inSideOrder(roster, null).map((a) => a.id), ["a", "b", "c", "d"]);
  // The list's order, with folded groups' agents (here d) left out and ids it no longer has dropped.
  assert.deepEqual(inSideOrder(roster, ["c", "a", "gone", "b"]).map((a) => a.id), ["c", "a", "b"]);
  // None known (a list of another fleet): the roster.
  assert.deepEqual(inSideOrder(roster, ["x"]).map((a) => a.id), ["a", "b", "c", "d"]);
  setSideOrder(["b", "a"]);
  const first = sideOrderNow();
  setSideOrder(["b", "a"]);
  assert.equal(sideOrderNow(), first, "the same order isn't published again");
  setSideOrder(null);
  assert.equal(sideOrderNow(), null);
});
