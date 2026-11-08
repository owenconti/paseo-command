import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exchangeOf, linesOf, pageReply, type PageRoom } from "./script";
import type { Entry } from "../transcript";

const room: PageRoom = { perLine: 40, lines: 4 };
const fits = (page: string) => linesOf(page, room) <= room.lines;

describe("pageReply", () => {
  it("keeps a short reply on one page", () => {
    assert.deepEqual(pageReply("Done. The tests pass.", room), ["Done. The tests pass."]);
  });

  it("puts paragraphs together while they fit and starts a page when they don't", () => {
    const pages = pageReply("First short one.\n\nSecond short one.\n\n" + "Third is long enough to fill a line or two of the box. ".repeat(2), room);
    assert.equal(pages[0], "First short one.\n\nSecond short one.");
    assert.ok(pages.length >= 2);
    for (const page of pages) assert.ok(fits(page), page);
  });

  it("cuts a long paragraph between sentences and loses no words", () => {
    const text = Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} says a little more.`).join(" ");
    const pages = pageReply(text, room);
    assert.ok(pages.length > 1);
    for (const page of pages) {
      assert.ok(fits(page), page);
      assert.match(page, /\.$/, "pages end at a sentence");
    }
    assert.equal(pages.join(" "), text);
  });

  it("cuts a long list between items", () => {
    const items = Array.from({ length: 9 }, (_, i) => `- item ${i + 1}`);
    const pages = pageReply(items.join("\n"), room);
    assert.equal(pages.length, 3);
    assert.deepEqual(pages.join("\n").split("\n"), items);
  });

  it("keeps a list that follows its lead-in line a list", () => {
    const items = Array.from({ length: 6 }, (_, i) => `- change ${i + 1}`);
    const pages = pageReply(["**What changed**", ...items].join("\n"), room);
    assert.ok(pages.every(fits));
    assert.deepEqual(pages.join("\n").split("\n").filter((l) => l.startsWith("- ")), items);
    assert.ok(!pages.some((p) => / - change/.test(p)), "bullets never run into a paragraph");
  });

  it("fences each piece of long code again", () => {
    const code = ["```ts", ...Array.from({ length: 7 }, (_, i) => `const n${i} = ${i};`), "```"].join("\n");
    const pages = pageReply(code, room);
    assert.ok(pages.length > 1);
    for (const page of pages) {
      assert.match(page, /^```ts\n[\s\S]*\n```$/);
      assert.ok(fits(page), page);
    }
    assert.equal(pages.map((p) => p.split("\n").slice(1, -1).join("\n")).join("\n"), code.split("\n").slice(1, -1).join("\n"));
  });

  it("never ends a page on a heading", () => {
    const pages = pageReply("Intro line one.\n\nIntro line two.\n\n## Next\n\nBody of the next section, long enough to need its own page here.", room);
    for (const page of pages) assert.doesNotMatch(page, /##[^\n]*$/);
    assert.ok(pages.some((p) => p.startsWith("## Next")));
  });

  it("keeps a table whole and cuts words too long for any page", () => {
    const table = "| a | b |\n|---|---|\n" + Array.from({ length: 8 }, (_, i) => `| ${i} | x |`).join("\n");
    assert.deepEqual(pageReply(table, room), [table]);
    const word = "x".repeat(400);
    for (const page of pageReply(word, room)) assert.ok(page.length <= room.perLine * room.lines);
  });

  it("gives nothing for an empty reply", () => {
    assert.deepEqual(pageReply("  \n ", room), []);
  });
});

describe("exchangeOf", () => {
  const user = (text: string): Entry => ({ kind: "user", text });
  const said = (text: string, messageId?: string): Entry => ({ kind: "assistant", text, messageId });

  it("finds the reply to your last message", () => {
    const x = exchangeOf([user("Fix it"), said("Fixed.", "r1")]);
    assert.deepEqual(x.reply, { text: "Fixed.", id: "r1" });
    assert.equal(x.asked, "Fix it");
    assert.equal(x.earlier, undefined);
  });

  it("says what it is doing after its reply, and that an older reply came before your message", () => {
    const x = exchangeOf([
      said("Earlier answer."),
      user("Now run the tests"),
      { kind: "tool", tool: "Bash", text: "npm test", status: "running" },
    ]);
    assert.equal(x.doing, "Bash · npm test");
    assert.equal(x.reply?.text, "Earlier answer.");
    assert.equal(x.earlier, true);
    assert.equal(x.asked, "Now run the tests");
  });

  it("names an MCP tool by its own name and skips subagents' reports", () => {
    const x = exchangeOf([
      user("Look"),
      { kind: "tool", tool: "mcp__paseo__list_agents", text: "" },
      { kind: "tool", tool: "agent_message", text: "Agent b2 finished." },
    ]);
    assert.equal(x.doing, "list agents");
  });

  it("reports a failure after your message, with the reply before it", () => {
    const x = exchangeOf([user("Deploy"), said("Starting."), { kind: "event", label: "error", text: "Provider error: overloaded" }]);
    assert.equal(x.failure, "Provider error: overloaded");
    assert.equal(x.reply?.text, "Starting.");
  });

  it("treats a message just sent as your last one", () => {
    const x = exchangeOf([user("Fix it"), said("Fixed.", "r1"), { kind: "event", label: "error", text: "boom" }], "And the docs?");
    assert.equal(x.asked, "And the docs?");
    assert.equal(x.earlier, true);
    assert.equal(x.failure, undefined);
  });

  it("gives a stable id to a reply without one", () => {
    const a = exchangeOf([said("Same words.")]).reply!.id;
    const b = exchangeOf([user("x"), said("Same words.")]).reply!.id;
    assert.equal(a, b);
    assert.notEqual(a, exchangeOf([said("Other words.")]).reply!.id);
  });
});
