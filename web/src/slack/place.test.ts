import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkPlace } from "./place";

describe("slack place", () => {
  it("keeps a conversation, thread and message that look like Slack's; drops the rest", () => {
    assert.deepEqual(checkPlace({ conversationId: "C0123ABC", threadTs: "1730000000.000100", ts: "1730000001.000200" }), {
      conversationId: "C0123ABC",
      threadTs: "1730000000.000100",
      ts: "1730000001.000200",
    });
    assert.deepEqual(checkPlace({ conversationId: "D9", threadTs: "nope" }), { conversationId: "D9" });
    assert.deepEqual(checkPlace({ conversationId: "../etc" }), {});
    assert.deepEqual(checkPlace(null), {});
    assert.deepEqual(checkPlace("C1"), {});
  });
});
