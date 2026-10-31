import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { slackKeyAction } from "./keys";

const key = (k: string, mods: Partial<{ metaKey: boolean; shiftKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}, target: { tagName?: string } | null = { tagName: "DIV" }) =>
  slackKeyAction({ key: k, metaKey: false, shiftKey: false, ctrlKey: false, altKey: false, ...mods, target });

describe("slack keys", () => {
  it("⌥↑ ⌥↓ move between conversations, with ⇧ between unread ones, typing or not", () => {
    assert.equal(key("ArrowUp", { altKey: true }), "previous");
    assert.equal(key("ArrowDown", { altKey: true }), "next");
    assert.equal(key("ArrowDown", { altKey: true, shiftKey: true }), "nextUnread");
    assert.equal(key("ArrowUp", { altKey: true, shiftKey: true }), "previousUnread");
    assert.equal(key("ArrowDown", { altKey: true }, { tagName: "TEXTAREA" }), "next");
  });
  it("/, Esc and C only while not typing", () => {
    assert.equal(key("/"), "search");
    assert.equal(key("Escape"), "back");
    assert.equal(key("c"), "compose");
    assert.equal(key("/", {}, { tagName: "TEXTAREA" }), null);
    assert.equal(key("Escape", {}, { tagName: "INPUT" }), null);
  });
  it("leaves the page's and the app's keys alone", () => {
    assert.equal(key("k", { metaKey: true }), null);
    assert.equal(key("s", { metaKey: true }), null);
    assert.equal(key("ArrowDown"), null);
    assert.equal(key("ArrowDown", { ctrlKey: true, altKey: true }), null);
    assert.equal(key("j"), null);
  });
});
