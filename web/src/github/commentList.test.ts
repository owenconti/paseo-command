import assert from "node:assert/strict";
import { test } from "node:test";
import { noteGroups, plainSnippet, shownGroups, stepNote, threadWhere } from "./commentList";
import type { ReviewThread } from "./types";

const thread = (id: string, path: string, line: number | null, o: Partial<ReviewThread> = {}): ReviewThread => ({
  id,
  path,
  line,
  startLine: null,
  side: "RIGHT",
  isResolved: false,
  isOutdated: false,
  canResolve: true,
  canReply: true,
  comments: [
    { id: `${id}_1`, databaseId: 1, author: { login: "bob" }, body: "First **point**: see [docs](https://x.y).", createdAt: "2026-01-01T00:00:00Z", url: "" },
    { id: `${id}_2`, databaseId: 2, author: { login: "ada" }, body: "Reply", createdAt: "2026-01-01T00:00:00Z", url: "" },
  ],
  ...o,
});

test("entries group by file in the diff's order, by line, threads before drafts, other files last", () => {
  const groups = noteGroups(
    [{ path: "b.ts" }, { path: "a.ts" }],
    [thread("T1", "a.ts", 9), thread("T2", "b.ts", 4), thread("T3", "a.ts", 2), thread("T4", "z.ts", 1)],
    [{ id: "D1", path: "a.ts", side: "RIGHT", line: 2, body: "mine" }],
    [{ id: "D2", path: "b.ts", side: "LEFT", line: 7, startLine: 5, body: "old" }],
  );
  assert.deepEqual(
    groups.map((g) => [g.path, g.entries.map((e) => e.id)]),
    [
      ["b.ts", ["D2", "T2"]],
      ["a.ts", ["T3", "D1", "T1"]],
      ["z.ts", ["T4"]],
    ],
  );
  const d2 = groups[0]!.entries[0]!;
  assert.equal(d2.where, "L5–7");
  assert.equal(d2.outdated, true);
  const t2 = groups[0]!.entries[1]!;
  assert.equal(t2.replies, 1);
  assert.equal(t2.text, "First point: see docs.");
  assert.equal(t2.author?.login, "bob");
});

test("a thread's place: its range, where it was left once outdated, or the file", () => {
  assert.equal(threadWhere(thread("a", "a.ts", 12, { startLine: 10 })), "L10–12");
  assert.equal(threadWhere(thread("a", "a.ts", null, { isOutdated: true, originalLine: 4 })), "L4");
  assert.equal(threadWhere(thread("a", "a.ts", null, { onFile: true })), "File");
});

test("resolved and outdated entries hide until shown; stepping wraps and starts from the file in view", () => {
  const groups = noteGroups(
    [{ path: "a.ts" }, { path: "b.ts" }],
    [thread("A", "a.ts", 1), thread("R", "a.ts", 2, { isResolved: true }), thread("O", "b.ts", null, { isOutdated: true }), thread("B", "b.ts", 3)],
    [],
  );
  const shown = shownGroups(groups, false).flatMap((g) => g.entries);
  assert.deepEqual(shown.map((e) => e.id), ["A", "B"]);
  assert.equal(shownGroups(groups, true).flatMap((g) => g.entries).length, 4);
  const order = new Map([
    ["a.ts", 0],
    ["b.ts", 1],
  ]);
  assert.equal(stepNote(shown, "A", 1, order)?.id, "B");
  assert.equal(stepNote(shown, "B", 1, order)?.id, "A");
  assert.equal(stepNote(shown, "A", -1, order)?.id, "B");
  assert.equal(stepNote(shown, undefined, 1, order, "b.ts")?.id, "B");
  assert.equal(stepNote(shown, undefined, -1, order, "b.ts")?.id, "A");
  assert.equal(stepNote([], undefined, 1, order), undefined);
});

test("snippets are plain text, cut short", () => {
  assert.equal(plainSnippet("> quoted\n\n```suggestion\nconst x = 1;\n```\n<!-- hidden --> `code` &amp; more"), "quoted const x = 1; code & more");
  assert.equal(plainSnippet("x".repeat(300), 20).length, 20);
  assert.equal(plainSnippet("*rename* the _snake_case_ var, a * b"), "rename the snake_case var, a * b");
});
