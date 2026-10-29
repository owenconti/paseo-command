import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorQuote, quoteFromSelection } from "./anchor";
import type { Quote } from "./types";

const text = "Some tools are already Rust. Each bundle lives in two places. Done.";
const q = (over: Partial<Quote>): Quote => ({
  replyKey: "k",
  text: "Each bundle lives in two places.",
  start: 29,
  end: 61,
  ...over,
});

test("a quote anchors where it was chosen", () => {
  assert.equal(text.slice(29, 61), "Each bundle lives in two places.");
  assert.deepEqual(anchorQuote(text, q({})), { start: 29, end: 61 });
});

test("when the reply's text moved, the quote is found by its words", () => {
  const moved = "Intro added. " + text;
  assert.deepEqual(anchorQuote(moved, q({})), { start: 42, end: 74 });
});

test("a quote whose words are gone has no anchor", () => {
  assert.equal(anchorQuote("Rewritten entirely.", q({})), null);
});

test("a selection is trimmed to its words, with the reply it came from", () => {
  const root = { textContent: text };
  assert.deepEqual(
    quoteFromSelection(root, 28, 62, { key: "k", messageId: "r1" }),
    { replyKey: "k", messageId: "r1", text: "Each bundle lives in two places.", start: 29, end: 61 },
  );
  assert.deepEqual(quoteFromSelection(root, 0, 4, { key: "k" }), {
    replyKey: "k",
    text: "Some",
    start: 0,
    end: 4,
  });
});

test("an empty or blank selection is no quote", () => {
  const root = { textContent: "a   b" };
  assert.equal(quoteFromSelection(root, 1, 4, { key: "k" }), null);
  assert.equal(quoteFromSelection(root, 2, 2, { key: "k" }), null);
});
