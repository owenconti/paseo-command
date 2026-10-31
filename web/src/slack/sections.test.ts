import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sidebarSections, stepConversation } from "./sections";
import type { SlackConversation } from "./types";

const c = (id: string, patch: Partial<SlackConversation> = {}): SlackConversation => ({
  id,
  kind: "channel",
  name: id.toLowerCase(),
  isMember: true,
  isArchived: false,
  ...patch,
});
const ids = (s: { items: SlackConversation[] }) => s.items.map((x) => x.id);

describe("slack sidebar", () => {
  const all = [
    c("CB"),
    c("CA"),
    c("CU", { unread: 3, latest: "5.0" }),
    c("CM", { unread: 1, mentions: 1, latest: "1.0" }),
    c("CMUTED", { unread: 9, isMuted: true }),
    c("CS", { isStarred: true }),
    c("CX", { isArchived: true }),
    c("CO", { isMember: false }),
    c("D1", { kind: "im", latest: "2.0" }),
    c("D2", { kind: "mpim", latest: "9.0" }),
    c("D3", { kind: "im", unread: undefined }),
  ];
  const sections = sidebarSections(all, (x) => x.name);

  it("unreads first (mentions first), then starred, channels by name, DMs newest first; muted, archived and others' channels aside", () => {
    assert.deepEqual(sections.map((s) => s.key), ["unreads", "starred", "channels", "dms"]);
    assert.deepEqual(ids(sections[0]), ["CM", "CU"]);
    assert.deepEqual(ids(sections[1]), ["CS"]);
    assert.deepEqual(ids(sections[2]), ["CA", "CB", "CMUTED"]);
    assert.deepEqual(ids(sections[3]), ["D2", "D1", "D3"]);
  });

  it("the open one stays in Unreads once read; empty sections go but Channels and DMs", () => {
    const read = all.map((x) => (x.id === "CU" ? { ...x, unread: 0 } : x));
    assert.deepEqual(ids(sidebarSections(read, (x) => x.name, "CU")[0]), ["CM", "CU"]);
    assert.deepEqual(sidebarSections([c("CA")], (x) => x.name).map((s) => s.key), ["channels", "dms"]);
  });

  it("steps through the order, wrapping, or to the next one that needs you", () => {
    const order = sections.flatMap((s) => s.items);
    assert.equal(stepConversation(order, "CM", 1), "CU");
    assert.equal(stepConversation(order, "CM", -1), "D3");
    assert.equal(stepConversation(order, undefined, 1), "CM");
    assert.equal(stepConversation(order, "CU", 1, true), "CM");
    assert.equal(stepConversation(order, "CA", -1, true), "CU");
    assert.equal(stepConversation([c("CA")], "CA", 1, true), undefined);
  });
});
