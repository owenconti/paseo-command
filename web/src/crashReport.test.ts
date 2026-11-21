import assert from "node:assert/strict";
import { test } from "node:test";
import { crashText, isChunkLoadError } from "./crashReport";

test("a crash's report: where, the message, the stack's first lines and the components", () => {
  const e = new TypeError("x is undefined");
  e.stack = "TypeError: x is undefined\n    at a (FilesPane.tsx:1)\n    at b (store.ts:2)";
  assert.equal(
    crashText("the Files tab", e, "\n    at FilesPane\n    at App"),
    "crash in the Files tab: TypeError: x is undefined\n  at a (FilesPane.tsx:1)\n  at b (store.ts:2)\n  components:\n  at FilesPane\n  at App",
  );
  assert.equal(crashText("the page", "nope"), "crash in the page: nope");
  assert.ok(crashText("x", new Error("y".repeat(9000))).length <= 4000);
});

test("a module that couldn't load, as WebKit and Chrome say it", () => {
  assert.ok(isChunkLoadError(new TypeError("Importing a module script failed.")));
  assert.ok(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1:4321/assets/FilesPane-BD9_JKjO.js")));
  assert.ok(!isChunkLoadError(new TypeError("x is undefined")));
  assert.ok(!isChunkLoadError("Failed to fetch"));
});
