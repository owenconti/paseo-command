import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENT_SYSTEM_PROMPT } from "./agentPrompt";
import { dispatchPlan } from "./api/validate";

test("new agents are told to explain the context before asking a question", () => {
  const plan = dispatchPlan(
    { projectId: "p1", prompt: "Hello", provider: "claude" },
    [{ projectId: "p1", path: "/repo" }],
    [{ provider: "claude", status: "available" }],
  );
  assert.equal(plan.agent.systemPrompt, AGENT_SYSTEM_PROMPT);
  assert.match(AGENT_SYSTEM_PROMPT, /visible message/);
  assert.match(AGENT_SYSTEM_PROMPT, /do not see your reasoning/);
});
