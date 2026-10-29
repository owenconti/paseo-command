import { test } from "node:test";
import assert from "node:assert/strict";
import { optionReadings, replySentences } from "./sentences";

test("sentences and list items, without code or marks", () => {
  assert.deepEqual(
    replySentences(
      "I've updated the **cache** layer. Two things:\n\n1. Should the cache be `per-host` or global?\n2. Keep the old /v1 endpoint for now?\n\n```ts\nconst x = 1. Not a sentence?\n```\nOk.",
    ),
    [
      "I've updated the cache layer.",
      "Should the cache be per-host or global?",
      "Keep the old /v1 endpoint for now?",
    ],
  );
});

test("wrapped lines join into one paragraph", () => {
  assert.deepEqual(replySentences("Do you want me\nto keep going? Say so."), [
    "Do you want me to keep going?",
  ]);
});

test("option readings take the first option at each length", () => {
  assert.deepEqual(optionReadings("Should the cache be per-host or global?").slice(0, 2), [
    ["per-host", "global"],
    ["be per-host", "global"],
  ]);
  assert.deepEqual(optionReadings("Use Redis, Memcached, or an in-memory map?")[0], [
    "Redis",
    "Memcached",
    "an in-memory map",
  ]);
  assert.deepEqual(optionReadings("Shall I continue?"), []);
});
