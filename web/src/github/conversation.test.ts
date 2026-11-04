import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationOf, threadHunk, threadLines } from "./conversation";
import { tailHunk } from "./hunk";
import type { ReviewThread, TimelineEntry } from "./types";

const review = (id: string, at: string, o: Partial<Extract<TimelineEntry, { kind: "review" }>> = {}): TimelineEntry => ({
  kind: "review",
  id,
  author: { login: "bob" },
  state: "commented",
  body: "",
  createdAt: at,
  url: "",
  comments: 1,
  ...o,
});
const comment = (id: string, at: string): TimelineEntry => ({ kind: "comment", id, author: { login: "ada" }, body: "hi", createdAt: at, url: "" });
const thread = (id: string, reviews: [string | undefined, string][], o: Partial<ReviewThread> = {}): ReviewThread => ({
  id,
  path: "src/a.ts",
  line: 12,
  startLine: null,
  side: "RIGHT",
  isResolved: false,
  isOutdated: false,
  canResolve: true,
  canReply: true,
  comments: reviews.map(([reviewId, at], i) => ({ id: `${id}-${i}`, databaseId: i + 1, author: null, body: "x", createdAt: at, url: "", ...(reviewId ? { reviewId } : {}) })),
  ...o,
});

test("threads go under the review that started them; single comments and threads without a shown review stand alone; reply-only reviews go", () => {
  const timeline = [
    comment("IC_1", "2026-10-30T09:00:00Z"),
    review("PRR_changes", "2026-10-30T09:10:00Z", { state: "changes", body: "See inline", comments: 2 }),
    review("PRR_single", "2026-10-30T09:20:00Z"),
    review("PRR_reply", "2026-10-30T09:30:00Z"),
    review("PRR_approved", "2026-10-30T09:40:00Z", { state: "approved", comments: 0 }),
  ];
  const threads = [
    thread("RT_1", [["PRR_changes", "2026-10-30T09:10:00Z"], ["PRR_reply", "2026-10-30T09:30:00Z"]]),
    thread("RT_2", [["PRR_changes", "2026-10-30T09:10:00Z"]]),
    thread("RT_3", [["PRR_single", "2026-10-30T09:20:00Z"]]),
    thread("RT_4", [["PRR_gone", "2026-10-30T08:50:00Z"]]),
    thread("RT_empty", []),
  ];
  const items = conversationOf(timeline, threads);
  assert.deepEqual(
    items.map((i) => [i.kind, i.id, i.kind === "review" ? i.threads.map((t) => t.id) : undefined]),
    [
      ["thread", "RT_4", undefined],
      ["comment", "IC_1", undefined],
      ["review", "PRR_changes", ["RT_1", "RT_2"]],
      ["thread", "RT_3", undefined],
      ["review", "PRR_approved", []],
    ],
  );
  // The reply stays in its thread, in order.
  const changes = items[2]!;
  assert.ok(changes.kind === "review");
  assert.deepEqual(changes.threads[0]!.comments.map((c) => c.reviewId), ["PRR_changes", "PRR_reply"]);
});

test("a thread's lines in words: its range, the file, or where it was left once outdated", () => {
  assert.equal(threadLines(thread("a", [])), "line 12");
  assert.equal(threadLines(thread("a", [], { startLine: 10 })), "lines 10–12");
  assert.equal(threadLines(thread("a", [], { line: null, isOutdated: true, originalLine: 7, originalStartLine: 5 })), "lines 5–7");
  assert.equal(threadLines(thread("a", [], { onFile: true, line: null })), "the file");
  assert.equal(threadLines(thread("a", [], { line: null, originalLine: null })), "an earlier line");
});

test("a hunk cut to its last lines, its header counted for them", () => {
  const hunk = "@@ -10,7 +10,8 @@ function main() {\n a\n b\n-c\n+C\n+D\n d\n\\ No newline at end of file";
  assert.equal(tailHunk(hunk, 100), "@@ -10,4 +10,5 @@ function main() {\n a\n b\n-c\n+C\n+D\n d\n\\ No newline at end of file");
  // The last three lines (the marker goes with the line before it).
  assert.equal(tailHunk(hunk, 3), "@@ -13,1 +12,3 @@\n+C\n+D\n d\n\\ No newline at end of file");
  assert.equal(tailHunk(hunk, 1), "@@ -13,1 +14,1 @@\n d\n\\ No newline at end of file");
  // Only additions: the old side is empty, counted from the line before.
  assert.equal(tailHunk("@@ -0,0 +1,3 @@\n+a\n+b\n+c", 2), "@@ -0,0 +2,2 @@\n+b\n+c");
  assert.equal(tailHunk("not a hunk", 4), "");
  // A thread shows its range's lines, else the last four.
  const t = thread("a", [], { diffHunk: "@@ -1,8 +1,8 @@\n 1\n 2\n 3\n 4\n 5\n 6\n 7\n 8", startLine: 2, line: 7 });
  assert.equal(threadHunk(t).split("\n").length, 7);
  assert.equal(threadHunk({ ...t, startLine: null }).split("\n").length, 5);
});
