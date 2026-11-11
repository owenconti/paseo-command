import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeTimeline } from "./daemon";
import { publishedPage, readVisualPage, visualPageOf } from "./visual";
import { toBlocks, fromTimeline } from "../src/transcript";

const ID = "9ae04a72a56db06b5729ed41";
/** The row a daemon gave for a real call of the plugin's tool by a Claude agent. */
const row = (over: Record<string, unknown> = {}) => ({
  provider: "claude",
  item: {
    type: "tool_call",
    callId: "toolu_015",
    name: "mcp__paseo__html_render",
    detail: {
      type: "unknown",
      input: { title: "Plugin check", html: "<!DOCTYPE html><p>Hello from the plugin</p>" },
      output: { output: { visualReply: { id: ID, title: "Plugin check" } } },
    },
    status: "completed",
    error: null,
    ...over,
  },
  timestamp: "2026-11-11T18:17:28.674Z",
  seqStart: 6,
  seqEnd: 9,
});

test("a completed html_render call names the page it published", () => {
  assert.deepEqual(publishedPage("mcp__paseo__html_render", row().item.detail), { page: ID, title: "Plugin check" });
  assert.deepEqual(publishedPage("html_render", { output: { structuredContent: { visualReply: { id: ID } } }, input: { title: " Build\n times " } }), {
    page: ID,
    title: "Build times",
  });
  // A provider that keeps only the tool's text.
  assert.deepEqual(publishedPage("paseo.html_render", { input: { title: "T" }, output: `Shown to the user in the chat (page ${ID}). Don't mention it.` }), {
    page: ID,
    title: "T",
  });
  // Another tool, a made-up id, no answer.
  assert.equal(publishedPage("mcp__other__render", row().item.detail), undefined);
  assert.equal(publishedPage("not_html_render_at_all_x", row().item.detail), undefined);
  assert.equal(publishedPage("html_render", { output: { visualReply: { id: "../../etc/passwd" } } }), undefined);
  assert.equal(publishedPage("html_render", { output: "The page uses a viewport height unit (100vh)." }), undefined);
  assert.equal(publishedPage("html_render", null), undefined);
});

test("the timeline carries the page's id and title, never its HTML", () => {
  const [item] = shapeTimeline([row()]);
  assert.deepEqual(item, {
    kind: "tool",
    id: "6:toolu_015",
    name: "mcp__paseo__html_render",
    status: "completed",
    summary: "Plugin check",
    detail: "",
    at: "2026-11-11T18:17:28.674Z",
    visual: { page: ID, title: "Plugin check" },
  });
  assert.doesNotMatch(JSON.stringify(item), /Hello from the plugin/);
  // A call still running, or one the plugin refused, stays an ordinary tool row.
  for (const over of [{ status: "running", detail: { type: "unknown", input: { title: "T" } } }, { status: "failed", error: "vh" }]) {
    const [plain] = shapeTimeline([row(over)]);
    assert.equal(plain.kind, "tool");
    assert.equal("visual" in plain, false);
  }
});

test("a published page is a block of its own between the steps around it", () => {
  const tool = (id: string, name: string) => ({ kind: "tool" as const, id, name, status: "completed", summary: "x", detail: "" });
  const blocks = toBlocks(
    fromTimeline([
      tool("1", "Read"),
      { ...tool("2", "mcp__paseo__html_render"), visual: { page: ID, title: "Plugin check" } },
      tool("3", "Bash"),
      { kind: "assistant", id: "4", text: "done" },
    ]),
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["activity", "visual", "activity", "assistant"],
  );
  assert.deepEqual(blocks[1], { kind: "visual", page: ID, title: "Plugin check", key: `visual:${ID}` });
});

test("the page is read from the plugin by id only, and its answer is checked", async () => {
  const asked: unknown[] = [];
  const page = await readVisualPage(ID, {
    invoke: async (...args) => {
      asked.push(args);
      return { id: ID, agentId: "a", title: "Plugin check", createdAt: "x", html: "<p>hi</p>" };
    },
  });
  assert.deepEqual(asked, [["visual-replies", "page.read", { id: ID }]]);
  assert.deepEqual(page, { id: ID, title: "Plugin check", html: "<p>hi</p>" });
  for (const bad of [null, "", "../x", "9AE04A72A56DB06B5729ED41", `${ID}0`])
    await assert.rejects(readVisualPage(bad, { invoke: async () => assert.fail("asked") }), /Invalid page id/);
  assert.throws(() => visualPageOf(ID, { id: "b".repeat(24), html: "<p>x</p>" }), /couldn't be read/);
  assert.throws(() => visualPageOf(ID, { id: ID }), /couldn't be read/);
  await assert.rejects(readVisualPage(ID, { invoke: async () => Promise.reject(new Error("Plugin visual-replies is not installed")) }), /not installed/);
});
