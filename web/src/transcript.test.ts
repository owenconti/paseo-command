import { test } from "node:test";
import assert from "node:assert/strict";
import { fromTimeline, toBlocks, type TimelineItem } from "./transcript";

const items: TimelineItem[] = [
  { kind: "user", id: "1", text: "Inventory", messageId: "u1", seq: 1, last: 1 },
  { kind: "assistant", id: "2", text: "Each bundle ", messageId: "r1", seq: 2, last: 2 },
  { kind: "assistant", id: "3", text: "lives in two places.", messageId: "r1", seq: 3, last: 4 },
];

test("a merged reply carries its message id and its last row's position (not version)", () => {
  const entries = fromTimeline(items);
  assert.deepEqual(entries[1], {
    kind: "assistant",
    text: "Each bundle lives in two places.",
    messageId: "r1",
    seq: 3,
  });
});

test("a reply without a message id or sequence carries neither", () => {
  const entries = fromTimeline([{ kind: "assistant", id: "9", text: "Hi" }]);
  assert.deepEqual(entries, [{ kind: "assistant", text: "Hi" }]);
});

test("blocks pass the reply's message id and sequence through, keys unchanged", () => {
  const blocks = toBlocks(fromTimeline(items));
  const reply = blocks[1]!;
  assert.equal(reply.kind, "assistant");
  assert.equal((reply as { messageId?: string }).messageId, "r1");
  assert.equal((reply as { seq?: number }).seq, 3);
  assert.equal(reply.key, "assistant::Each bundle lives in two places.#1");
});
