import { test } from "node:test";
import assert from "node:assert/strict";
import { mayAsk, optionReadings, pickOptions, replySentences } from "./sentences";

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

test("only questions and requests may ask the user anything", () => {
  assert.equal(mayAsk("Can you merge PR #3 first?"), true);
  assert.equal(mayAsk("Should I keep going?)"), true);
  assert.equal(mayAsk("Let me know which file you meant."), true);
  assert.equal(mayAsk("Please confirm the host name."), true);
  assert.equal(
    mayAsk("That work touches the same files as the open PR #3, and its Sentry check is still waiting on it."),
    false,
  );
  assert.equal(mayAsk("I'll fix that alongside the next change."), false);
});

test("an \"A, or B?\" question's alternatives, as replies", () => {
  const cases: [string, string[]][] = [
    [
      "Should I push the branch and open a PR, or do you want the chamber fixtures deleted first?",
      ["Push the branch and open a PR", "Delete the chamber fixtures first"],
    ],
    [
      "Should I push the branch and open a PR or do you want the chamber fixtures deleted first?",
      ["Push the branch and open a PR", "Delete the chamber fixtures first"],
    ],
    ["Do you want me to fix it now, or leave it for a follow-up PR?", ["Fix it now", "Leave it for a follow-up PR"]],
    [
      "Would you like me to open a PR, or would you rather I keep going on this branch?",
      ["Open a PR", "Keep going on this branch"],
    ],
    ["Keep the old endpoint, or remove it?", ["Keep the old endpoint", "Remove it"]],
    ["Should I squash the commits or just rebase?", ["Squash the commits", "Just rebase"]],
  ];
  for (const [q, options] of cases) assert.deepEqual(pickOptions(q), options, q);
  // Not clear alternatives: left to Jev and the readings.
  for (const q of [
    "Should I merge it, or not?",
    "Should the cache be per-host or global?",
    "Is it per-host, or global?",
    "Use Redis, Memcached, or an in-memory map?",
    "Can you check the logs, or should I?",
    "Shall I continue?",
    "Push the branch, or open a PR.",
  ])
    assert.deepEqual(pickOptions(q), [], q);
});
