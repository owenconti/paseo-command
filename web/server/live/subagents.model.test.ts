import { test } from "node:test";
import assert from "node:assert/strict";
import { subagentRow } from "./subagents";

test("a provider subagent's row names its provider and model for the map's drone", () => {
  const row = subagentRow({ id: "s1", parentAgentId: "a1", provider: "codex", title: "general", subtitle: "gpt-6.1-sol · high" });
  assert.equal(row.model, "codex gpt-6.1-sol · high");
  assert.equal(subagentRow({ id: "s2", parentAgentId: "a1" }).model, undefined);
});
