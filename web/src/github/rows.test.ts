import assert from "node:assert/strict";
import { test } from "node:test";
import { byDirectory, placeThreads, splitRows, unifiedRows } from "./rows";
import type { DiffFile, ReviewThread } from "./types";

const file: DiffFile = {
  path: "src/a.ts",
  isNew: false,
  isDeleted: false,
  additions: 2,
  deletions: 1,
  hunks: [
    {
      oldStart: 10,
      oldCount: 3,
      newStart: 10,
      newCount: 4,
      lines: [
        { type: "header", content: "@@ -10,3 +10,4 @@ function f()" },
        { type: "context", content: "a" },
        { type: "remove", content: "b" },
        { type: "add", content: "B" },
        { type: "add", content: "C" },
        { type: "context", content: "d" },
      ],
    },
  ],
};

test("unified rows number each line and anchor it", () => {
  const rows = unifiedRows(file);
  assert.equal(rows[0]!.kind, "hunk");
  assert.equal(rows[0]!.kind === "hunk" && rows[0]!.header, "@@ -10,3 +10,4 @@ function f()");
  const lines = rows.filter((r) => r.kind === "line");
  assert.deepEqual(
    lines.map((r) => [r.type, r.old, r.new, `${r.anchor.side}${r.anchor.line}`]),
    [
      ["context", 10, 10, "RIGHT10"],
      ["remove", 11, null, "LEFT11"],
      ["add", null, 11, "RIGHT11"],
      ["add", null, 12, "RIGHT12"],
      ["context", 12, 13, "RIGHT13"],
    ],
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length);
});

test("split rows pair removals with additions, unchanged lines on both sides", () => {
  const rows = splitRows(file).filter((r) => r.kind === "pair");
  assert.deepEqual(
    rows.map((r) => [r.left?.old ?? null, r.left?.anchor.side ?? null, r.right?.new ?? null]),
    [
      [10, "LEFT", 10],
      [11, "LEFT", 11],
      [null, null, 12],
      [12, "LEFT", 13],
    ],
  );
});

test("threads sit on their line, outdated ones apart", () => {
  const thread = (id: string, line: number | null, side: "LEFT" | "RIGHT", isOutdated = false): ReviewThread => ({
    id,
    path: "src/a.ts",
    line,
    startLine: null,
    side,
    isResolved: false,
    isOutdated,
    canResolve: true,
    canReply: true,
    comments: [],
  });
  const { placed, apart } = placeThreads(file, [
    thread("a", 11, "RIGHT"),
    thread("b", 11, "LEFT"),
    thread("c", null, "RIGHT", true),
    thread("d", 99, "RIGHT"),
  ]);
  assert.deepEqual([...placed.keys()].sort(), ["LEFT:11", "RIGHT:11"]);
  assert.deepEqual(
    apart.map((t) => t.id),
    ["c", "d"],
  );
});

test("files group by directory, the root first", () => {
  assert.deepEqual(
    byDirectory([{ path: "z/b.ts" }, { path: "README.md" }, { path: "a/c.ts" }, { path: "z/a.ts" }]).map((g) => [
      g.dir,
      g.files.map((f) => f.path),
    ]),
    [
      ["", ["README.md"]],
      ["a", ["a/c.ts"]],
      ["z", ["z/b.ts", "z/a.ts"]],
    ],
  );
});

test("repositories are owner/name, never dot segments", async () => {
  const { REPO } = await import("./types");
  assert.ok(REPO.test("acme/atlas"));
  assert.ok(REPO.test("a.b/c.d-e_f"));
  for (const bad of ["../x", "./x", "x/..", "x/.", "x", "x/y/z"]) assert.equal(REPO.test(bad), false, bad);
});
