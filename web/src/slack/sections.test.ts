import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addSection,
  deleteSection,
  moveConversation,
  moveSection,
  recentItems,
  renameSection,
  sidebarSections,
  stepConversation,
} from "./sections";
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

  it("your own sections come after Unreads, in their order, taking their conversations from Starred, Channels and DMs", () => {
    const own = [
      { id: "s1", name: "Team", conversationIds: ["D1", "CB", "CM", "GONE"] },
      { id: "s2", name: "Empty", conversationIds: [] },
    ];
    const out = sidebarSections(all, (x) => x.name, undefined, own);
    assert.deepEqual(out.map((s) => s.key), ["unreads", "section:s1", "section:s2", "starred", "channels", "dms"]);
    // CM is unread: Unreads keeps it; an unknown id shows nothing.
    assert.deepEqual(ids(out[1]), ["D1", "CB"]);
    assert.equal(out[1].title, "Team");
    assert.deepEqual(ids(out[4]), ["CA", "CMUTED"]);
    assert.deepEqual(ids(out[5]), ["D2", "D3"]);
  });

  it("Recent: conversations and threads you're in by their newest message, from anyone, at most twenty", () => {
    const threads = [
      { conversationId: "CA", threadTs: "1.0", latest: "7.0", unread: true },
      { conversationId: "CX", threadTs: "1.0", latest: "99.0", unread: false },
    ];
    const items = recentItems(all, threads);
    assert.deepEqual(items.map((i) => i.key), ["c:D2", "t:CA:1.0", "c:CU", "c:D1", "c:CM"]);
    const many = Array.from({ length: 30 }, (_, n) => c(`C${n}`, { latest: `${n}.0` }));
    assert.equal(recentItems(many, []).length, 20);
    assert.equal(recentItems(many, [])[0].key, "c:C29");
  });

  it("makes, renames, moves and deletes sections; a conversation is in one at most", () => {
    let own = addSection([], "s1", " Team ", "CA");
    own = addSection(own, "s2", "Later", "CA");
    assert.deepEqual(own, [
      { id: "s1", name: "Team", conversationIds: [] },
      { id: "s2", name: "Later", conversationIds: ["CA"] },
    ]);
    own = moveConversation(own, "CB", "s2", "CA");
    assert.deepEqual(own[1].conversationIds, ["CB", "CA"]);
    own = moveConversation(own, "CA", "s1");
    assert.deepEqual(own.map((s) => s.conversationIds), [["CA"], ["CB"]]);
    own = moveConversation(own, "CA", undefined);
    assert.deepEqual(own[0].conversationIds, []);
    own = renameSection(own, "s2", "Soon");
    own = moveSection(own, "s2", 0);
    assert.deepEqual(own.map((s) => s.name), ["Soon", "Team"]);
    assert.deepEqual(deleteSection(own, "s2").map((s) => s.id), ["s1"]);
  });
});
