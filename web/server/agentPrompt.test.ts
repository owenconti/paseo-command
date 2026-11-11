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

test("new agents are told how to answer with a visual reply", async () => {
  const { VISUAL_LANG, VISUAL_CSP } = await import("../src/visual/page");
  assert.match(AGENT_SYSTEM_PROMPT, new RegExp("```" + VISUAL_LANG + "\\n<!doctype html>"));
  // What the prompt promises is what the frame allows.
  assert.match(AGENT_SYSTEM_PROMPT, /over https/);
  assert.match(AGENT_SYSTEM_PROMPT, /If you have an html_render tool, call it/);
  assert.match(VISUAL_CSP, /script-src 'unsafe-inline' 'unsafe-eval' https:/);
  for (const name of ["--background", "--foreground", "--chart-1", "--font-mono"])
    assert.ok(AGENT_SYSTEM_PROMPT.includes(name), name);
});

test("new agents are told that the browser tabs they open are shown to the user", () => {
  assert.match(AGENT_SYSTEM_PROMPT, /<paseo_command_browser>[\s\S]*browser_new_tab[\s\S]*<\/paseo_command_browser>/);
  assert.match(AGENT_SYSTEM_PROMPT, /Without those tools, give the user the address/);
});
