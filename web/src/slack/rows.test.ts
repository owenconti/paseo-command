import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { messageRows } from "./rows";
import type { ShownMessage } from "./store";

const m = (s: number, userId = "U1", patch: Partial<ShownMessage> = {}): ShownMessage => ({ ts: `${s}.000100`, conversationId: "C1", userId, text: "", ...patch });
const day = (ts: string) => String(Math.floor(Number(ts.split(".")[0]) / 86400));
const shape = (rows: ReturnType<typeof messageRows>) => rows.map((r) => (r.kind === "message" ? `${r.message.ts.split(".")[0]}${r.compact ? "c" : ""}` : r.kind));

describe("slack message rows", () => {
  it("days, runs within five minutes, and the new messages line", () => {
    const list = [m(1000), m(1100), m(1500), m(1600, "U2"), m(1700, "U2", { subtype: "channel_join" }), m(1800, "U2"), m(90000), m(90010)];
    assert.deepEqual(shape(messageRows(list, day)), ["day", "1000", "1100c", "1500", "1600", "1700", "1800", "day", "90000", "90010c"]);
    assert.deepEqual(shape(messageRows(list, day, "1100.000100")), ["day", "1000", "1100c", "new", "1500", "1600", "1700", "1800", "day", "90000", "90010c"]);
  });
  it("the line skips your own messages and unsent ones run on", () => {
    const list = [m(1000, "U0"), m(1010, "U0"), m(1020, "U1"), { ...m(0, "U1"), ts: "local:1", pending: true }];
    assert.deepEqual(shape(messageRows(list, day, "999.000000", "U0")), ["day", "1000", "1010c", "new", "1020", "local:1c"]);
  });
});
