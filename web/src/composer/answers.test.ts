import { test } from "node:test";
import assert from "node:assert/strict";
import { answersMessage } from "./answers";

const a = (question: string, answer: string) => ({ id: question, question, answer });

test("answered questions become quote and answer pairs before the message", () => {
  assert.equal(
    answersMessage(
      [a("Per host?", " Yes, per host. "), a("Keep the old endpoint?", "No.")],
      "Thanks!",
    ),
    "> Per host?\nYes, per host.\n\n> Keep the old endpoint?\nNo.\n\nThanks!",
  );
});

test("unanswered questions are dropped", () => {
  assert.equal(answersMessage([a("Per host?", "  "), a("Old one?", "No.")], ""), "> Old one?\nNo.");
  assert.equal(answersMessage([a("Per host?", "")], ""), "");
});

test("each line of a quoted question is quoted", () => {
  assert.equal(answersMessage([a("One\n\nTwo", "Both.")], ""), "> One\n>\n> Two\nBoth.");
});
