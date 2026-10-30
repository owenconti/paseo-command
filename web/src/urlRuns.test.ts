/** Web addresses in a user's message become links. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { urlRuns } from "./urlRuns";

test("links each web address and keeps the text around it", () => {
  assert.deepEqual(
    urlRuns("See https://github.com/a/b/actions/runs/1/job/2 please"),
    [
      { text: "See " },
      {
        text: "https://github.com/a/b/actions/runs/1/job/2",
        href: "https://github.com/a/b/actions/runs/1/job/2",
      },
      { text: " please" },
    ],
  );
});

test("leaves sentence punctuation and brackets outside the link", () => {
  assert.deepEqual(urlRuns("(http://x.io/a?b=1)."), [
    { text: "(" },
    { text: "http://x.io/a?b=1", href: "http://x.io/a?b=1" },
    { text: ")." },
  ]);
  assert.deepEqual(urlRuns("diff? https://x.io/p, then"), [
    { text: "diff? " },
    { text: "https://x.io/p", href: "https://x.io/p" },
    { text: ", then" },
  ]);
});

test("text without addresses is one run", () => {
  assert.deepEqual(urlRuns("no links here"), [{ text: "no links here" }]);
  assert.deepEqual(urlRuns("javascript:alert(1)"), [
    { text: "javascript:alert(1)" },
  ]);
});
