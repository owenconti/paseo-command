import assert from "node:assert/strict";
import { test } from "node:test";
import { diffStats, numberLines, parseUnifiedDiff } from "./diff";

const DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@ export function main() {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
\\ No newline at end of file
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+hello
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-bye
-now
diff --git a/old name.md b/new name.md
similarity index 90%
rename from old name.md
rename to new name.md
index 5555555..6666666 100644
--- a/old name.md
+++ b/new name.md
@@ -3 +3 @@
-x
+y
diff --git a/logo.png b/logo.png
index 7777777..8888888 100644
Binary files a/logo.png and b/logo.png differ
diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"
index 1..2 100644
--- "a/caf\\303\\251.txt"
+++ "b/caf\\303\\251.txt"
@@ -1 +1 @@
-a
+b
`;

test("a unified diff parses to the daemon's shape", () => {
  const { files, tooLarge } = parseUnifiedDiff(DIFF);
  assert.equal(tooLarge, false);
  assert.deepEqual(
    files.map((f) => [f.path, f.oldPath, f.isNew, f.isDeleted, f.additions, f.deletions, f.status]),
    [
      ["src/app.ts", undefined, false, false, 2, 1, "ok"],
      ["new.txt", undefined, true, false, 1, 0, "ok"],
      ["gone.txt", undefined, false, true, 0, 2, "ok"],
      ["new name.md", "old name.md", false, false, 1, 1, "ok"],
      ["logo.png", undefined, false, false, 0, 0, "binary"],
      ["café.txt", undefined, false, false, 1, 1, "ok"],
    ],
  );
  const hunk = files[0]!.hunks[0]!;
  assert.deepEqual(hunk.lines[0], { type: "header", content: "@@ -1,3 +1,4 @@ export function main() {" });
  assert.deepEqual(
    hunk.lines.slice(1).map((l) => [l.type, l.content]),
    [
      ["context", "const a = 1;"],
      ["remove", "const b = 2;"],
      ["add", "const b = 3;"],
      ["add", "const c = 4;"],
      ["context", "const d = 5;"],
    ],
  );
  assert.equal(files[4]!.hunks.length, 0);
  assert.deepEqual([files[3]!.hunks[0]!.oldCount, files[3]!.hunks[0]!.newStart], [1, 3]);
});

test("a removed line that looks like a header stays a removal", () => {
  const { files } = parseUnifiedDiff(
    "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,1 @@\n--- old\n keep\n",
  );
  assert.deepEqual(
    files[0]!.hunks[0]!.lines.map((l) => [l.type, l.content]),
    [["header", "@@ -1,2 +1,1 @@"], ["remove", "-- old"], ["context", "keep"]],
  );
});

test("large files and diffs are cut", () => {
  const big = `diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -0,0 +1,10 @@\n${"+x\n".repeat(10)}`;
  const small = "diff --git a/b b/b\n--- a/b\n+++ b/b\n@@ -1 +1 @@\n-1\n+2\n";
  const one = parseUnifiedDiff(big + small, { fileLines: 5 });
  assert.equal(one.files[0]!.status, "too_large");
  assert.equal(one.files[0]!.hunks.length, 0);
  assert.equal(one.files[0]!.additions, 10);
  assert.equal(one.files[1]!.status, "ok");
  const cut = parseUnifiedDiff(small + small.replaceAll("/b", "/c") + small.replaceAll("/b", "/d"), { totalLines: 4 });
  assert.equal(cut.tooLarge, true);
  assert.deepEqual(cut.files.map((f) => f.path), ["b", "c"]);
  assert.deepEqual(parseUnifiedDiff(""), { files: [], tooLarge: false });
});

test("lines are numbered in the old and new files", () => {
  const hunk = parseUnifiedDiff(DIFF).files[0]!.hunks[0]!;
  assert.deepEqual(
    numberLines(hunk).map((l) => [l.type, l.oldLine, l.newLine]),
    [
      ["header", undefined, undefined],
      ["context", 1, 1],
      ["remove", 2, undefined],
      ["add", undefined, 2],
      ["add", undefined, 3],
      ["context", 3, 4],
    ],
  );
  assert.deepEqual(diffStats(parseUnifiedDiff(DIFF).files), { files: 6, additions: 5, deletions: 5 });
});
