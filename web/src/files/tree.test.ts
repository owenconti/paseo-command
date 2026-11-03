import { test } from "node:test";
import assert from "node:assert/strict";
import { findInText } from "../github/diffSearch";
import { filterRows, parentsOf, rankPaths, sizeLabel, treeRows, type Listing } from "./tree";
import type { FileEntry } from "./types";

const dir = (path: string, ignored = false): FileEntry => ({ name: path.split("/").pop()!, path, kind: "directory", size: 0, ...(ignored ? { ignored: true as const } : {}) });
const file = (path: string, ignored = false): FileEntry => ({ name: path.split("/").pop()!, path, kind: "file", size: 10, ...(ignored ? { ignored: true as const } : {}) });

const LISTINGS = new Map<string, Listing>([
  ["", [dir(".git", true), dir("node_modules", true), dir("src"), dir("docs"), file("README.md"), file("debug.log", true)]],
  ["src", [dir("src/lib"), file("src/index.ts")]],
  ["src/lib", [file("src/lib/a.ts")]],
  ["node_modules", [dir("node_modules/pkg"), file("node_modules/x.js")]],
  ["docs", { error: "That file or folder isn't there any more." }],
]);
const listingOf = (d: string) => LISTINGS.get(d);
const show = (rows: ReturnType<typeof treeRows>) =>
  rows.map((r) => `${"  ".repeat(r.depth)}${r.name}${r.kind === "directory" ? "/" : ""}${r.open ? " open" : ""}${r.loading ? " loading" : ""}${r.error ? " error" : ""}${r.ignored ? " ignored" : ""}`);

test("the tree: open directories' entries under them, ignored ones hidden", () => {
  assert.deepEqual(show(treeRows(listingOf, new Set(), false)), ["src/", "docs/", "README.md"]);
  assert.deepEqual(show(treeRows(listingOf, new Set(["src", "src/lib", "docs"]), false)), [
    "src/ open",
    "  lib/ open",
    "    a.ts",
    "  index.ts",
    "docs/ open error",
    "README.md",
  ]);
  // Opened but not read yet; a closed parent hides an open child.
  assert.deepEqual(show(treeRows(listingOf, new Set(["src/lib"]), false)), ["src/", "docs/", "README.md"]);
  assert.deepEqual(show(treeRows((d) => (d === "src" ? undefined : listingOf(d)), new Set(["src"]), false)), ["src/ open loading", "docs/", "README.md"]);
});

test("ignored entries show when asked, and whatever is under an ignored directory is ignored too", () => {
  assert.deepEqual(show(treeRows(listingOf, new Set(["node_modules"]), true)), [
    ".git/ ignored",
    "node_modules/ open ignored",
    "  pkg/ ignored",
    "  x.js ignored",
    "src/",
    "docs/",
    "README.md",
    "debug.log ignored",
  ]);
});

const PATHS = ["README.md", "src/index.ts", "src/lib/a.ts", "src/lib/strings.ts", "docs/guide/setup.md", "web/src/files/FilesView.tsx", "web/src/files/tree.ts"];

test("the filter: the files that fit under their directories, names marked", () => {
  const f = filterRows(PATHS, "fv");
  assert.deepEqual(
    f.rows.map((r) => `${"  ".repeat(r.depth)}${r.name}${r.kind === "directory" ? "/" : ""} [${r.marks?.join(",")}]`),
    ["web/ []", "  src/ []", "    files/ []", "      FilesView.tsx [0,5]"],
  );
  assert.equal(f.count, 1);
  assert.equal(f.best, "web/src/files/FilesView.tsx");
  const lib = filterRows(PATHS, "lib");
  assert.deepEqual(lib.rows.map((r) => r.path), ["src", "src/lib", "src/lib/a.ts", "src/lib/strings.ts"]);
  assert.deepEqual(filterRows(PATHS, "zzz"), { rows: [], count: 0 });
  // Capped: the count says how many fit.
  assert.equal(filterRows(PATHS, "s", 2).count, 6);
});

test("quick-open: best fits first, names over directories, shorter first", () => {
  assert.deepEqual(rankPaths(PATHS, "tree").map((h) => h.path), ["web/src/files/tree.ts"]);
  assert.deepEqual(rankPaths(PATHS, "index").map((h) => h.path)[0], "src/index.ts");
  assert.deepEqual(rankPaths(PATHS, "str")[0]!.path, "src/lib/strings.ts");
  assert.equal(rankPaths(PATHS, "s", 2).length, 2);
  assert.deepEqual(rankPaths(PATHS, ""), []);
});

test("find in a file: each line's matches, keyed as the file draws its lines", () => {
  const text = "const a = 1;\nconst b = a + a;\n";
  const { matches } = findInText("x.ts", text, "a", { caseSensitive: false, regex: false });
  assert.deepEqual(
    matches.map((m) => [m.key, m.line, m.start, m.end]),
    [
      ["R1", 0, 6, 7],
      ["R2", 1, 10, 11],
      ["R2", 1, 14, 15],
    ],
  );
  assert.equal(findInText("x.ts", text, "CONST", { caseSensitive: true, regex: false }).matches.length, 0);
  assert.equal(findInText("x.ts", text, "b\\s=", { caseSensitive: false, regex: true }).matches.length, 1);
  assert.equal(findInText("x.ts", text, "(", { caseSensitive: false, regex: true }).error, "Invalid pattern");
});

test("parents and sizes", () => {
  assert.deepEqual(parentsOf("a/b/c.ts"), ["a", "a/b"]);
  assert.deepEqual(parentsOf("c.ts"), []);
  assert.equal(sizeLabel(512), "512 B");
  assert.equal(sizeLabel(3500), "3.4 KB");
  assert.equal(sizeLabel(2 * 1024 * 1024), "2.0 MB");
});
