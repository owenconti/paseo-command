import { test } from "node:test";
import assert from "node:assert/strict";
import { contextOf, contextText, tokens } from "./contextUsage";

test("tokens read short", () => {
  assert.deepEqual([812, 1200, 9999, 476133, 1_000_000, 1_250_000, 200_000].map(tokens), ["812", "1.2k", "10k", "476k", "1M", "1.3M", "200k"]);
});

test("the window's share and level", () => {
  assert.equal(contextOf(null), null);
  assert.equal(contextOf({ ContextUsedTokens: 5 }), null);
  assert.equal(contextOf({ ContextUsedTokens: 5, ContextMaxTokens: 0 }), null);
  assert.deepEqual(contextOf({ ContextUsedTokens: 476133, ContextMaxTokens: 1_000_000 }), { used: 476133, max: 1_000_000, share: 0.476133, level: "ok" });
  assert.equal(contextOf({ ContextUsedTokens: 140_000, ContextMaxTokens: 200_000 })!.level, "high");
  assert.equal(contextOf({ ContextUsedTokens: 190_000, ContextMaxTokens: 200_000 })!.level, "full");
  assert.equal(contextOf({ ContextUsedTokens: 250_000, ContextMaxTokens: 200_000 })!.share, 1);
});

test("the meter's words and tooltip", () => {
  assert.deepEqual(contextText({ ContextUsedTokens: 476133, ContextMaxTokens: 1_000_000 }), {
    label: "476k / 1M · 48%",
    tip: "Context: 476,133 of 1,000,000 tokens (48%)",
  });
  assert.deepEqual(contextText({ ContextUsedTokens: 50_000, ContextMaxTokens: 200_000, InputTokens: 1200, CachedTokens: 48_000, OutputTokens: 900, CostUsd: 0.4 }), {
    label: "50k / 200k · 25%",
    tip: "Context: 50,000 of 200,000 tokens (25%); last turn 1.2k in · 48k cached · 900 out · $0.40",
  });
  // Without the window (an older daemon, a provider that doesn't say): the last turn, as the header showed it.
  assert.deepEqual(contextText({ OutputTokens: 2400, CostUsd: 1.25 }), { label: "$1.25 · 2.4k out", tip: "Last turn: 2.4k out · $1.25" });
  assert.equal(contextText({}), null);
});
