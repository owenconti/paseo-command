import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changeTextStep, checkTextStep, TEXT_STEP, textSizeKey } from "./textSize";

const key = (k: string, mods: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
  textSizeKey({ key: k, metaKey: true, ctrlKey: false, altKey: false, ...mods });

describe("Linear text size", () => {
  it("reads ⌘+ (or ⌘=), ⌘− and ⌘0", () => {
    assert.equal(key("+"), "bigger");
    assert.equal(key("="), "bigger");
    assert.equal(key("-"), "smaller");
    assert.equal(key("0"), "actual");
    assert.equal(key("+", { metaKey: false }), null);
    assert.equal(key("=", { altKey: true }), null);
    assert.equal(key("s"), null);
  });
  it("steps within its range and resets to the default", () => {
    assert.equal(TEXT_STEP.default, 2);
    assert.equal(changeTextStep(2, "bigger"), 3);
    assert.equal(changeTextStep(2, "smaller"), 1);
    assert.equal(changeTextStep(TEXT_STEP.max, "bigger"), TEXT_STEP.max);
    assert.equal(changeTextStep(TEXT_STEP.min, "smaller"), TEXT_STEP.min);
    assert.equal(changeTextStep(7, "actual"), TEXT_STEP.default);
  });
  it("keeps only a remembered step it could have set", () => {
    assert.equal(checkTextStep(5), 5);
    assert.equal(checkTextStep("5"), TEXT_STEP.default);
    assert.equal(checkTextStep(1.5), TEXT_STEP.default);
    assert.equal(checkTextStep(99), TEXT_STEP.default);
  });
});
