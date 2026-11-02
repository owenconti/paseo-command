/** The command palette's search. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankCommands, type Command } from "./palette";

const command = (label: string, extra: Partial<Command> = {}): Command => ({
  id: label,
  label,
  group: "Actions",
  page: "Command",
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

test("among equal matches the page on screen comes first, never ahead of a better one", () => {
  const rows = [
    command("Add project", { page: "Command" }),
    command("Show projects", { page: "Command", group: "Lists" }),
    command("Filter the repository's pulls by project", { page: "GitHub", keys: [["M"]] }),
    command("Go to GitHub projects", { page: "GitHub" }),
    command("project", { page: "GitHub" }),
  ];
  // Command shown: the order the matches alone give.
  assert.deepEqual(labels(rankCommands(rows, "project", "Command")), [
    "project",
    "Add project",
    "Show projects",
    "Filter the repository's pulls by project",
    "Go to GitHub projects",
  ]);
  // GitHub shown: its own lead among the word-start matches, but the exact
  // label still leads and Command's word-start matches stay above GitHub's
  // weaker ones.
  assert.deepEqual(labels(rankCommands(rows, "project", "GitHub")), [
    "project",
    "Filter the repository's pulls by project",
    "Go to GitHub projects",
    "Add project",
    "Show projects",
  ]);
  assert.deepEqual(labels(rankCommands(rows, "add", "GitHub")), ["Add project"]);
  // No query: the page on screen changes nothing.
  assert.deepEqual(
    labels(rankCommands(rows, "", "GitHub")),
    labels(rankCommands(rows, "")),
  );
});
