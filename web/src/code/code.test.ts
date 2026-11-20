import { test } from "node:test";
import assert from "node:assert/strict";
import { baseText } from "./baseText";
import { fileUri, languageOf, placeOf, uriPath, workspaceUri } from "./paths";
import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import { linesOf } from "./split";

type L = { type: "context" | "add" | "remove" | "header"; content: string };
const hunk = (oldStart: number, oldCount: number, newStart: number, newCount: number, lines: L[]) => ({ oldStart, oldCount, newStart, newCount, lines });
const file = (hunks: ReturnType<typeof hunk>[], more: Partial<{ isNew: boolean; status: "ok" | "binary" | "too_large" }> = {}) => ({
  isNew: false,
  isDeleted: false,
  additions: 1,
  deletions: 1,
  status: "ok" as const,
  hunks,
  ...more,
});
const c = (content: string): L => ({ type: "context", content });
const a = (content: string): L => ({ type: "add", content });
const r = (content: string): L => ({ type: "remove", content });

test("a file's base text, rebuilt by applying its diff backwards", () => {
  const before = "one\ntwo\nthree\nfour\nfive\nsix\n";
  const now = "one\nTWO\nthree\nfour\nfive\nsix\nseven\n";
  const diff = file([
    hunk(1, 3, 1, 3, [{ type: "header", content: "@@ -1,3 +1,3 @@" }, c("one"), r("two"), a("TWO"), c("three")]),
    hunk(5, 2, 5, 3, [c("five"), c("six"), a("seven")]),
  ]);
  assert.equal(baseText(now, diff), before);
});

test("a deletion at the start, an insertion with no new lines, and a hunk that doesn't fit", () => {
  // Lines 1-2 removed: the new side has nothing at line 0.
  assert.equal(baseText("c\n", file([hunk(1, 2, 0, 0, [r("a"), r("b")])])), "a\nb\nc\n");
  // A line removed after line 2 of the new side.
  assert.equal(baseText("a\nb\nd\n", file([hunk(3, 1, 2, 0, [r("c")])])), "a\nb\nc\nd\n");
  // The file changed since its diff: its context no longer fits.
  assert.equal(baseText("one\nTWO!\nthree\n", file([hunk(1, 3, 1, 3, [c("one"), r("two"), a("TWO"), c("three")])])), null);
  assert.equal(baseText("x\n", file([], { isNew: true })), "");
  assert.equal(baseText("x\n", file([], { status: "too_large" })), null);
  assert.equal(baseText("x\n", { ...file([]), additions: 0, deletions: 0 }), "x\n");
});

test("languages by file name", () => {
  assert.deepEqual(languageOf("src/App.tsx"), { name: "TSX", lsp: { id: "typescriptreact", group: "typescript" } });
  assert.deepEqual(languageOf("app/Http/Kernel.php"), { name: "PHP", lsp: { id: "php", group: "php" } });
  assert.deepEqual(languageOf("resources/views/home.blade.php")?.lsp?.group, "php");
  assert.deepEqual(languageOf("README.md"), { name: "Markdown" });
  assert.deepEqual(languageOf("Dockerfile"), { name: "Dockerfile" });
  assert.equal(languageOf("LICENSE"), null);
});

test("URIs and where they are", () => {
  assert.equal(fileUri("/home/review/My App/@types/x.ts"), "file:///home/review/My%20App/%40types/x.ts");
  assert.equal(uriPath("file:///home/review/My%20App/%40types/x.ts"), "/home/review/My App/@types/x.ts");
  // Servers encode differently (pathToFileURL leaves @): both name the same file.
  assert.equal(uriPath("file:///home/review/My%20App/@types/x.ts"), "/home/review/My App/@types/x.ts");
  assert.equal(uriPath("file://localhost/a/b"), "/a/b");
  assert.equal(uriPath("file://server/a/b"), null);
  assert.equal(uriPath("https://x/a"), null);
  assert.deepEqual(placeOf("/w/app", "file:///w/app/src/a.ts"), { path: "src/a.ts" });
  assert.deepEqual(placeOf("/w/app/", workspaceUri("/w/app", "node_modules/@types/node/fs.d.ts")), { path: "node_modules/@types/node/fs.d.ts" });
  assert.deepEqual(placeOf("/w/app", "file:///w/application/x.ts"), { outside: "/w/application/x.ts" });
  assert.deepEqual(placeOf("/w/app", "file:///w/app/../etc/passwd"), { outside: "/w/app/../etc/passwd" });
  assert.deepEqual(placeOf("/w/app", "file:///usr/lib/node/lib.dom.d.ts"), { outside: "/usr/lib/node/lib.dom.d.ts" });
});

test("a split diff's chunks: lines on each side, which its spacers level", () => {
  const a = Text.of(["one", "two", "three", "four"]);
  const b = Text.of(["one", "TWO", "TWO and a half", "four"]);
  const [c] = Chunk.build(a, b);
  assert.equal(linesOf(a, c.fromA, c.toA), 2);
  assert.equal(linesOf(b, c.fromB, c.toB), 2);
  // Lines added: none on the base's side, so the base gets a spacer of two lines.
  const [added] = Chunk.build(Text.of(["x", "y"]), Text.of(["x", "new 1", "new 2", "y"]));
  assert.equal(linesOf(Text.of(["x", "y"]), added.fromA, added.toA), 0);
  assert.equal(linesOf(Text.of(["x", "new 1", "new 2", "y"]), added.fromB, added.toB), 2);
  // A chunk at the end, reaching past the document's last character.
  const [end] = Chunk.build(Text.of(["x", "old"]), Text.of(["x", "new", "more"]));
  assert.equal(linesOf(Text.of(["x", "new", "more"]), end.fromB, end.toB), 2);
});
