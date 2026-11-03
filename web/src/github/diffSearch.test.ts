import assert from "node:assert/strict";
import { test } from "node:test";
import { filterFiles, findInDiff, FIND_LIMIT, fuzzyPath, sameMatch, shownLines } from "./diffSearch";
import type { DiffFile } from "./types";

const file = (path: string, hunks: DiffFile["hunks"]): DiffFile => ({ path, isNew: false, isDeleted: false, additions: 0, deletions: 0, hunks, status: "ok" });

// Two hunks; the second's changes interleaved, as a parser may give them.
const TWO = file("src/github/DiffView.tsx", [
  {
    oldStart: 1,
    oldCount: 3,
    newStart: 1,
    newCount: 3,
    lines: [
      { type: "header", content: "@@ -1,3 +1,3 @@" },
      { type: "context", content: "import { Search } from 'x';" },
      { type: "remove", content: "const search = 1;" },
      { type: "add", content: "const Search = 2;" },
      { type: "context", content: "export {};" },
    ],
  },
  {
    oldStart: 40,
    oldCount: 3,
    newStart: 40,
    newCount: 3,
    lines: [
      { type: "header", content: "@@ -40,3 +40,3 @@" },
      { type: "remove", content: "old one" },
      { type: "add", content: "new one" },
      { type: "remove", content: "old two" },
      { type: "add", content: "new two" },
      { type: "context", content: "search again, search" },
    ],
  },
]);
// Big enough to show folded (BIG_FILE), and searched all the same.
const BIG = file("web/big.json", [
  {
    oldStart: 1,
    oldCount: 0,
    newStart: 1,
    newCount: 2000,
    lines: [
      { type: "header", content: "@@ -0,0 +1,2000 @@" },
      ...Array.from({ length: 2000 }, (_, i) => ({ type: "add" as const, content: i === 1700 ? "  needle: true," : `  line${i}: ${i},` })),
    ],
  },
]);

test("fuzzyPath matches characters in order, marks them, and prefers the file's name and word starts", () => {
  assert.equal(fuzzyPath("xyz", "src/a.ts"), null);
  assert.deepEqual(fuzzyPath("s a", "src/a.ts")?.marks, [0, 4]);
  assert.deepEqual(fuzzyPath("dv", "src/github/DiffView.tsx")?.marks, [11, 15]);
  assert.deepEqual(fuzzyPath("DIFF", "src/github/DiffView.tsx")?.marks, [11, 12, 13, 14]);
  // A run in the name beats scattered letters in the directories.
  assert.ok(fuzzyPath("view", "src/github/DiffView.tsx")!.score > fuzzyPath("view", "vendor/ide/eww/x.ts")!.score);
  assert.deepEqual(fuzzyPath("", "a")?.marks, []);
});

test("filterFiles keeps the matching files in order and names the best", () => {
  const files = [{ path: "src/a.ts" }, { path: "web/src/github/DiffView.tsx" }, { path: "docs/diff-viewer.md" }, { path: "README.md" }];
  const got = filterFiles(files, "diffview");
  assert.deepEqual(
    got.files.map((f) => f.path),
    ["web/src/github/DiffView.tsx", "docs/diff-viewer.md"],
  );
  assert.equal(got.best, "web/src/github/DiffView.tsx");
  assert.equal(filterFiles(files, "zzz").files.length, 0);
  assert.equal(filterFiles(files, "zzz").best, undefined);
});

test("shownLines keys each line by side and number, removals before additions", () => {
  const lines = shownLines(TWO);
  assert.deepEqual(
    lines.map((l) => `${l.key}${l.alt ? `/${l.alt}` : ""}`),
    ["R1/L1", "L2", "R2", "R3/L3", "L40", "L41", "R40", "R41", "R42/L42"],
  );
  assert.deepEqual(
    lines.slice(4, 8).map((l) => l.content),
    ["old one", "old two", "new one", "new two"],
  );
});

test("findInDiff finds in added, removed and unchanged lines across hunks, case-insensitive by default", () => {
  const { matches } = findInDiff([TWO], "search", { caseSensitive: false, regex: false });
  assert.deepEqual(
    matches.map((m) => [m.key, m.alt ?? "", m.start, m.end]),
    [
      ["R1", "L1", 9, 15],
      ["L2", "", 6, 12],
      ["R2", "", 6, 12],
      ["R42", "L42", 0, 6],
      ["R42", "L42", 14, 20],
    ],
  );
  assert.equal(findInDiff([TWO], "search", { caseSensitive: true, regex: false }).matches.length, 3);
  // Plain text is literal; a regular expression only when asked.
  assert.equal(findInDiff([TWO], "o.e", { caseSensitive: false, regex: false }).matches.length, 0);
  assert.deepEqual(
    findInDiff([TWO], "(old|new) (one|two)", { caseSensitive: false, regex: true }).matches.map((m) => m.key),
    ["L40", "L41", "R40", "R41"],
  );
  assert.equal(findInDiff([TWO], "(", { caseSensitive: false, regex: true }).error, "Invalid pattern");
  // An empty match moves on.
  assert.equal(findInDiff([TWO], "x*", { caseSensitive: false, regex: true }).matches.length, 2);
  assert.equal(findInDiff([TWO], "", { caseSensitive: false, regex: false }).matches.length, 0);
});

test("findInDiff searches every file, a big (folded) one too, in their order", () => {
  const { matches } = findInDiff([TWO, BIG], "NEEDLE", { caseSensitive: false, regex: false });
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0], { file: 1, path: "web/big.json", key: "R1701", line: 1700, start: 2, end: 8 });
  const both = findInDiff([BIG, TWO], "e", { caseSensitive: false, regex: false }).matches;
  assert.ok(both.findIndex((m) => m.file === 1) > both.map((m) => m.file).lastIndexOf(0));
  // Binary and too large files have no lines to search.
  assert.equal(findInDiff([{ ...BIG, status: "too_large", hunks: [] }], "needle", { caseSensitive: false, regex: false }).matches.length, 0);
});

test("findInDiff stops at its limit and says so", () => {
  const got = findInDiff([BIG], "line", { caseSensitive: false, regex: false });
  assert.equal(got.matches.length, 1999);
  assert.equal(got.capped, false);
  const many = findInDiff([BIG], ".", { caseSensitive: false, regex: true });
  assert.equal(many.matches.length, FIND_LIMIT);
  assert.ok(many.capped);
  assert.ok(sameMatch(many.matches[0]!, { ...many.matches[0]!, file: 9 }));
});
