import { test } from "node:test";
import assert from "node:assert/strict";
import { isUnread, newSince, type Release } from "./releases";

const r = (version: string): Release => ({ version, date: "", notes: "", url: "" });
const list = [r("0.4.0"), r("0.3.0"), r("0.2.0")];

test("newSince counts the releases listed before the last seen one", () => {
  assert.equal(newSince(list, "0.3.0"), 1);
  assert.equal(newSince(list, "0.4.0"), 0);
  assert.equal(newSince(list, "0.1.0"), 3);
  assert.equal(newSince(list, null), 0);
});

test("a dot only when the newest release differs from a stored one", () => {
  assert.equal(isUnread("0.4.0", "0.3.0"), true);
  assert.equal(isUnread("0.4.0", "0.4.0"), false);
  assert.equal(isUnread("0.4.0", null), false);
  assert.equal(isUnread(undefined, "0.4.0"), false);
});
