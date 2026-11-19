import assert from "node:assert/strict";
import { test } from "node:test";
import { insertMention, mentionAt, rankMentions } from "./mentions";

test("the @word at the caret, at a word's start, not in an address or code", () => {
  assert.deepEqual(mentionAt("Thanks @ow", 10), { start: 7, query: "ow" });
  assert.deepEqual(mentionAt("@", 1), { start: 0, query: "" });
  assert.deepEqual(mentionAt("cc (@sam-r", 10), { start: 4, query: "sam-r" });
  assert.equal(mentionAt("mail me at owen@acme", 20), null, "an address");
  assert.equal(mentionAt("@owen done", 10), null, "past a space");
  assert.equal(mentionAt("run `npm @scope", 15), null, "in a code span");
  assert.equal(mentionAt("```\n@decorator", 14), null, "in a fenced block");
  assert.deepEqual(mentionAt("```\nx\n```\n@o", 12), { start: 10, query: "o" }, "after a closed block");
  assert.equal(mentionAt("hi @" + "a".repeat(40), 44), null, "longer than a login");
});

test("people ranked: login prefix, then a name's word, then the login holding it", () => {
  const people = [
    { login: "sam", name: "Sam Rivera" },
    { login: "owenconti", name: "Owen Conti" },
    { login: "bowen", name: "Ben Owens" },
    { login: "riv", name: "Alex" },
  ];
  assert.deepEqual(rankMentions(people, "ow").map((p) => p.login), ["owenconti", "bowen"]);
  assert.deepEqual(rankMentions(people, "riv").map((p) => p.login), ["riv", "sam"]);
  assert.deepEqual(rankMentions(people, "").map((p) => p.login), ["sam", "owenconti", "bowen", "riv"]);
  assert.deepEqual(rankMentions(people, "", 2).map((p) => p.login), ["sam", "owenconti"]);
  assert.deepEqual(rankMentions(people, "zzz"), []);
});

test("putting one in: the login and a space, the caret after it", () => {
  assert.deepEqual(insertMention("Thanks @ow", 7, 10, "owenconti"), { text: "Thanks @owenconti ", caret: 18 });
  assert.deepEqual(insertMention("@s please", 0, 2, "sam"), { text: "@sam please", caret: 5 });
});
