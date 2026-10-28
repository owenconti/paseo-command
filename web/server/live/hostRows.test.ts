import { test } from "node:test";
import assert from "node:assert/strict";
import { archivedAgent } from "./hostRows";
import { isArchived } from "../../src/types";

test("a closed agent is still shown; only archived ones are hidden", () => {
  assert.equal(archivedAgent({ id: "a", status: "closed" } as never), false);
  assert.equal(isArchived({ status: "closed" }), false);
  assert.equal(
    archivedAgent({
      id: "b",
      status: "closed",
      archivedAt: "2026-10-28",
    } as never),
    true,
  );
  assert.equal(isArchived({ status: "closed", archived: true }), true);
});
