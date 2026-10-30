import { test } from "node:test";
import assert from "node:assert/strict";
import { groupIssues, issueMatches, issuePrompt, type LinearIssueRow } from "./linearIssues";
import { fillPreset } from "./presets";

const row = (key: string, state: [string, string], priority: number, updatedAt: string, extra: Partial<LinearIssueRow> = {}): LinearIssueRow => ({
  key,
  title: `Title ${key}`,
  url: `https://linear.app/acme/issue/${key}`,
  state: { name: state[0], type: state[1], color: "#fff" },
  priority,
  priorityLabel: "",
  team: "ENG",
  labels: [],
  updatedAt,
  ...extra,
});

test("linear issues: grouped by state, started first, then by priority with none last", () => {
  const groups = groupIssues([
    row("ENG-1", ["Backlog", "backlog"], 1, "2026-10-01"),
    row("ENG-2", ["Todo", "unstarted"], 0, "2026-10-05"),
    row("ENG-3", ["In Progress", "started"], 3, "2026-10-02"),
    row("ENG-4", ["Todo", "unstarted"], 2, "2026-10-01"),
    row("ENG-5", ["Todo", "unstarted"], 2, "2026-10-03"),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.state.name, g.issues.map((i) => i.key)]),
    [
      ["In Progress", ["ENG-3"]],
      ["Todo", ["ENG-5", "ENG-4", "ENG-2"]],
      ["Backlog", ["ENG-1"]],
    ],
  );
});

test("linear issues: search matches every word in key, title, project or labels", () => {
  const issue = row("ENG-12", ["Todo", "unstarted"], 0, "", {
    title: "Fix the login page",
    project: "Launch",
    labels: [{ name: "Bug", color: "#f00" }],
  });
  assert.ok(issueMatches(issue, "eng-12"));
  assert.ok(issueMatches(issue, "login bug"));
  assert.ok(issueMatches(issue, " launch "));
  assert.ok(!issueMatches(issue, "login feature"));
});

test("linear issues: the prompt and presets carry the issue", () => {
  const issue = { key: "ENG-12", title: "Fix it", url: "https://linear.app/a/issue/ENG-12", description: "It breaks." };
  assert.equal(
    issuePrompt(issue),
    "Work on this issue.\n\nLinear issue ENG-12: Fix it\nhttps://linear.app/a/issue/ENG-12\n\nIt breaks.",
  );
  assert.equal(
    fillPreset("Plan {{ issue }} first.", undefined, issue),
    "Plan ENG-12 (Fix it) first.\n\nLinear issue ENG-12: Fix it\nhttps://linear.app/a/issue/ENG-12\n\nIt breaks.",
  );
  assert.equal(
    fillPreset("Review {{pr}}.", { number: 7 }, { ...issue, description: "" }),
    "Review #7.\n\nLinear issue ENG-12: Fix it\nhttps://linear.app/a/issue/ENG-12",
  );
  // Without an issue, presets are as they were.
  assert.equal(fillPreset("Review {{pr}}.", { number: 7 }), "Review #7.");
});
