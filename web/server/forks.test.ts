import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  CONCLUDE_PROMPT,
  firstPrompt,
  forksFile,
  getFork,
  listForks,
  saveFork,
  sendBackText,
} from "./forks";
import { nextColour, type Fork, type Quote } from "../src/forks/types";

const reset = () => rmSync(forksFile(), { force: true });
const quote = (text: string): Quote => ({
  replyKey: "assistant:x#1",
  messageId: "m1",
  text,
  start: 0,
  end: text.length,
});
const fork = (over: Partial<Fork>): Fork => ({
  id: "f1",
  host: null,
  agentId: "a1",
  helperId: "h1",
  boundary: { messageId: "m1" },
  quotes: [quote("Each bundle lives in two places.")],
  question: "Why?",
  colour: 0,
  createdAt: "2026-10-28T10:00:00.000Z",
  ...over,
});

test("a saved fork is listed for its host and agent, and found by id", () => {
  reset();
  saveFork(fork({}));
  saveFork(fork({ id: "f2", host: "h2" }));
  assert.deepEqual(
    listForks(null, "a1").map((f) => f.id),
    ["f1"],
  );
  assert.deepEqual(
    listForks("h2", "a1").map((f) => f.id),
    ["f2"],
  );
  assert.equal(getFork("f2")?.host, "h2");
  assert.equal(getFork("nope"), undefined);
});

test("saving a fork again replaces it, and forks list newest first", () => {
  reset();
  saveFork(fork({ id: "old", createdAt: "2026-10-28T09:00:00.000Z" }));
  saveFork(fork({ id: "new", createdAt: "2026-10-28T11:00:00.000Z" }));
  saveFork(fork({ id: "old", createdAt: "2026-10-28T09:00:00.000Z", closedAt: "x" }));
  const listed = listForks(null, "a1");
  assert.deepEqual(
    listed.map((f) => f.id),
    ["new", "old"],
  );
  assert.equal(listed[1]!.closedAt, "x");
});

test("no file is no forks; a damaged one throws rather than be overwritten", () => {
  reset();
  assert.deepEqual(listForks(null, "a1"), []);
  mkdirSync(dirname(forksFile()), { recursive: true });
  writeFileSync(forksFile(), "{not json");
  assert.throws(() => listForks(null, "a1"), /forks\.json/);
  assert.throws(() => saveFork(fork({})), /forks\.json/);
  reset();
});

test("the first prompt quotes each piece, then asks the question", () => {
  assert.equal(
    firstPrompt([quote("Each bundle lives in two places.")], "Why?"),
    "This is a short side conversation forked from the conversation above. The user highlighted these parts of your reply:\n\n> Each bundle lives in two places.\n\nTheir question: Why?",
  );
  assert.equal(
    firstPrompt([quote("one\ntwo"), quote("three")], "Q"),
    "This is a short side conversation forked from the conversation above. The user highlighted these parts of your reply:\n\n> one\n> two\n\n> three\n\nTheir question: Q",
  );
});

test("the conclusion prompt and the send-back message", () => {
  assert.equal(
    CONCLUDE_PROMPT,
    "In a few sentences, state what this side conversation concluded, written for the main conversation. Reply with the conclusion only.",
  );
  const text = sendBackText(
    [quote("Each bundle lives in two places.")],
    "Two checks call build:*.",
  );
  assert.ok(
    text.startsWith(
      "From a side conversation about:\n> Each bundle lives in two places.\n\n",
    ),
    text,
  );
  assert.ok(text.endsWith("Two checks call build:*."), text);
});

test("colours: the lowest unused, else round the palette", () => {
  assert.equal(nextColour([]), 0);
  assert.equal(nextColour([0, 1, 3]), 2);
  assert.equal(nextColour([0, 1, 2, 3, 4, 5]), 0);
  assert.equal(nextColour([0, 1, 2, 3, 4, 5, 0]), 1);
});
