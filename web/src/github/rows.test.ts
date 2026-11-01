import assert from "node:assert/strict";
import { test } from "node:test";
import { anchorsOf, byDirectory, patchOf, placeThreads } from "./rows";
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

test("a file becomes the patch @pierre/diffs reads", () => {
  assert.equal(
    patchOf(file),
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -10,3 +10,4 @@ function f()",
      " a",
      "-b",
      "+B",
      "+C",
      " d",
      "",
    ].join("\n"),
  );
  const created = patchOf({ ...file, path: "n.ts", isNew: true });
  assert.match(created, /new file mode 100644\n--- \/dev\/null\n\+\+\+ b\/n.ts/);
  assert.match(patchOf({ ...file, oldPath: "old.ts" }), /rename from old.ts\nrename to src\/a.ts/);
});

test("anchors cover each line, and an unchanged line's left side", () => {
  assert.deepEqual([...anchorsOf(file)].sort(), ["LEFT:10", "LEFT:11", "LEFT:12", "RIGHT:10", "RIGHT:11", "RIGHT:12", "RIGHT:13"]);
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
