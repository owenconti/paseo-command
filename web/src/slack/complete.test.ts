import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applySuggestion, completionAt, matchUsers } from "./complete";
import type { SlackUser } from "./types";

const u = (id: string, name: string, realName = name, patch: Partial<SlackUser> = {}): SlackUser => ({ id, name, realName, isBot: false, deleted: false, ...patch });
const USERS = [u("U1", "ana", "Ana Lopez"), u("U2", "bob", "Bob Ng"), u("U3", "anabot", "Ana Bot", { isBot: true }), u("U4", "anon", "Anon", { deleted: true }), u("U5", "lo", "Lola")];

describe("slack composer completion", () => {
  it("people by name, real name or its words; people before bots; not deleted", () => {
    assert.deepEqual(matchUsers(USERS, "an").map((x) => x.id), ["U1", "U3"]);
    assert.deepEqual(matchUsers(USERS, "lop").map((x) => x.id), ["U1"]);
    assert.deepEqual(matchUsers(USERS, "ol").map((x) => x.id), ["U5"]);
  });
  it("@ offers people and inserts their mention; : offers emoji after two letters", () => {
    const text = "hi @an";
    const c = completionAt(text, text.length, USERS)!;
    assert.equal(c.kind, "user");
    assert.equal(c.start, 3);
    assert.deepEqual(applySuggestion(text, text.length, c, c.items[0]), { text: "hi <@U1> ", caret: 9 });
    const e = completionAt("nice :tad", 9, USERS)!;
    assert.equal(e.kind, "emoji");
    assert.equal(e.items[0].insert, ":tada: ");
    assert.equal(completionAt("nice :t", 7, USERS), null);
    assert.equal(completionAt("mail@an", 7, USERS), null);
    assert.equal(completionAt("10:30", 5, USERS), null);
  });
});
