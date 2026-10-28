/** The command palette's search. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCommands, type Command } from "./palette";

const command = (label: string, extra: Partial<Command> = {}): Command => ({
  id: label,
  label,
  group: "Actions",
  run: () => {},
  ...extra,
});
const labels = (rows: Command[]) => rows.map((c) => c.label);

const COMMANDS = [
  command("Next agent"),
  command("New agent"),
  command("Fit the whole map"),
  command("Show agents that need you", { keywords: "attention approvals" }),
  command("fix-header", { group: "Agents", detail: "atlas", searchOnly: true }),
];

test("with no query, every command but those kept for search, in order", () => {
  assert.deepEqual(labels(rankCommands(COMMANDS, "  ")), [
    "Next agent",
    "New agent",
    "Fit the whole map",
    "Show agents that need you",
  ]);
});

test("a label's start ranks first, then a word's start, then keywords", () => {
  assert.deepEqual(labels(rankCommands(COMMANDS, "new")), ["New agent"]);
  assert.deepEqual(labels(rankCommands(COMMANDS, "agent")).slice(0, 3), [
    "Next agent",
    "New agent",
    "Show agents that need you",
  ]);
  assert.deepEqual(labels(rankCommands(COMMANDS, "approvals")), [
    "Show agents that need you",
  ]);
});

test("every word must match; search-only rows match by detail too", () => {
  assert.deepEqual(labels(rankCommands(COMMANDS, "fix atlas")), ["fix-header"]);
  assert.deepEqual(labels(rankCommands(COMMANDS, "new map")), []);
});

test("scattered letters match the label, after real matches", () => {
  assert.deepEqual(labels(rankCommands(COMMANDS, "ftwm")), [
    "Fit the whole map",
  ]);
});
