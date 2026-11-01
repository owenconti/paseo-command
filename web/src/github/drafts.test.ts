import assert from "node:assert/strict";
import { test } from "node:test";
import { addComment, editComment, removeComment, reviewComments, type ReviewDraft } from "./drafts";

const empty: ReviewDraft = { comments: [], body: "" };

test("comments are added, edited and removed by id", () => {
  const a = addComment(empty, { path: "a.ts", line: 3, side: "RIGHT", body: "one" });
  const b = addComment(a.draft, { path: "b.ts", line: 9, side: "LEFT", body: "two" });
  assert.notEqual(a.id, b.id);
  const edited = editComment(b.draft, a.id, "uno");
  assert.deepEqual(
    edited.comments.map((c) => c.body),
    ["uno", "two"],
  );
  assert.deepEqual(
    removeComment(edited, b.id).comments.map((c) => c.path),
    ["a.ts"],
  );
});

test("review comments leave out blanks and a range that is one line", () => {
  let d = addComment(empty, { path: "a.ts", line: 3, side: "RIGHT", startLine: 3, startSide: "RIGHT", body: "x" }).draft;
  d = addComment(d, { path: "a.ts", line: 8, side: "RIGHT", startLine: 5, body: "range" }).draft;
  d = addComment(d, { path: "a.ts", line: 9, side: "RIGHT", body: "   " }).draft;
  assert.deepEqual(reviewComments(d), [
    { path: "a.ts", line: 3, side: "RIGHT", body: "x" },
    { path: "a.ts", line: 8, side: "RIGHT", startLine: 5, startSide: "RIGHT", body: "range" },
  ]);
});
