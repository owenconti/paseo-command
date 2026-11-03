import assert from "node:assert/strict";
import { test } from "node:test";
import { APPLY_LEAD, applyMessage, pendingLabel, placeLabel, textOf, type LocalComment } from "./localComments";
import type { DiffFile } from "./types";

const c = (over: Partial<LocalComment>): LocalComment => ({
  id: "dc_1",
  path: "src/map.ts",
  side: "RIGHT",
  line: 12,
  text: ["const zoom = 3;"],
  body: "Use the constant.",
  createdAt: "2026-11-01T00:00:00Z",
  ...over,
});

test("the Apply message: the instruction, then each comment's place, quoted lines and text", () => {
  const text = applyMessage([
    c({}),
    c({ id: "dc_2", path: "web/a.tsx", startLine: 4, line: 6, text: ["one", "", "three"], body: "Split this up.\nAnd name it." }),
    c({ id: "dc_3", side: "LEFT", line: 2, text: ["old()"], body: "Keep this call." }),
  ]);
  assert.equal(
    text,
    `${APPLY_LEAD}\n\n` +
      "1. src/map.ts:12\n   > const zoom = 3;\n   Use the constant.\n\n" +
      "2. web/a.tsx:4-6\n   > one\n   >\n   > three\n   Split this up.\n   And name it.\n\n" +
      "3. src/map.ts:2 (the old version, before your changes)\n   > old()\n   Keep this call.",
  );
});

test("labels", () => {
  assert.equal(pendingLabel(1), "1 pending comment");
  assert.equal(pendingLabel(3), "3 pending comments");
  assert.equal(placeLabel({ path: "a.ts", line: 5, startLine: 5 }), "a.ts:5");
  assert.equal(placeLabel({ path: "a.ts", line: 5, startLine: 2 }), "a.ts:2-5");
});

test("a comment's lines are read from the diff, on its side", () => {
  const file: DiffFile = {
    path: "a.ts",
    isNew: false,
    isDeleted: false,
    additions: 1,
    deletions: 1,
    status: "ok",
    hunks: [
      {
        oldStart: 1,
        oldCount: 2,
        newStart: 1,
        newCount: 2,
        lines: [
          { type: "context", content: "same" },
          { type: "remove", content: "old" },
          { type: "add", content: "new" },
        ],
      },
    ],
  };
  assert.deepEqual(textOf(file, "RIGHT", 1, 2), ["same", "new"]);
  assert.deepEqual(textOf(file, "LEFT", 1, 2), ["same", "old"]);
});
