import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { linearKeyAction } from "./keys";

const press = (
  key: string,
  mods: { meta?: boolean; shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
  target: { tagName?: string; isContentEditable?: boolean } | null = { tagName: "BUTTON" },
) =>
  linearKeyAction({
    key,
    metaKey: !!mods.meta,
    shiftKey: !!mods.shift,
    ctrlKey: !!mods.ctrl,
    altKey: !!mods.alt,
    target,
  });

describe("linearKeyAction", () => {
  it("letter keys are ignored while typing", () => {
    assert.equal(press("s", {}, { tagName: "TEXTAREA" }), null);
    assert.equal(press("s", {}, { tagName: "INPUT" }), null);
    assert.equal(press("j", {}, { tagName: "SELECT" }), null);
    assert.equal(press("s", {}, { tagName: "DIV", isContentEditable: true }), null);
    assert.equal(press("Escape", {}, { tagName: "INPUT" }), null);
    assert.equal(press(".", { meta: true }, { tagName: "TEXTAREA" }), null);
  });

  it("maps each key", () => {
    const cases: [string, Parameters<typeof press>[1], string][] = [
      ["j", {}, "down"],
      ["ArrowDown", {}, "down"],
      ["k", {}, "up"],
      ["ArrowUp", {}, "up"],
      ["Enter", {}, "open"],
      ["o", {}, "open"],
      ["Escape", {}, "back"],
      ["c", {}, "create"],
      ["s", {}, "status"],
      ["p", {}, "priority"],
      ["a", {}, "assign"],
      ["i", {}, "assignMe"],
      ["l", {}, "labels"],
      ["m", {}, "project"],
      ["C", { shift: true }, "cycle"],
      [".", { meta: true }, "copyBranch"],
      [",", { meta: true, shift: true }, "copyLink"],
      ["<", { meta: true, shift: true }, "copyLink"],
      ["/", {}, "filter"],
      ["f", {}, "filterBy"],
    ];
    for (const [key, mods, action] of cases) assert.equal(press(key, mods), action, `${key} ${JSON.stringify(mods)}`);
    // Capitals from Caps Lock are the same letters.
    assert.equal(press("S"), "status");
    assert.equal(press("s", {}, null), "status");
  });

  it("leaves other keys and other modifiers alone", () => {
    assert.equal(press("s", { meta: true }), null); // ⌘S: left to the view's sidebar toggle
    // ⌘F searches the list, as / does, even from a text field.
    assert.equal(press("f", { meta: true }), "filter");
    assert.equal(press("f", { meta: true }, { tagName: "INPUT" }), "filter");
    assert.equal(press("x"), null);
    assert.equal(press("n"), null);
    assert.equal(press("c", { meta: true }), null);
    assert.equal(press("c", { ctrl: true }), null);
    assert.equal(press("c", { alt: true }), null);
    assert.equal(press("S", { shift: true }), null);
    assert.equal(press(",", { meta: true }), null);
    assert.equal(press(".", { meta: true, shift: true }), null);
    assert.equal(press("Enter", { meta: true }), null);
    assert.equal(press("j", { shift: true }), null);
  });
});
