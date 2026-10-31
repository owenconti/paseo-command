import assert from "node:assert/strict";
import { test } from "node:test";
import { groupIssues, issueMatches } from "./group";
import type { LinearIssue, LinearState, LinearWorkspace } from "./types";

const state = (id: string, name: string, type: LinearState["type"], position: number): LinearState => ({
  id,
  name,
  type,
  color: "#fff",
  position,
  teamId: "t",
});
const STATES = [
  state("tri", "Triage", "triage", 0),
  state("back", "Backlog", "backlog", 1),
  state("todo", "Todo", "unstarted", 2),
  state("prog", "In Progress", "started", 3),
  state("rev", "In Review", "started", 4),
  state("done", "Done", "completed", 5),
  state("gone", "Canceled", "canceled", 6),
];
const WS = {
  viewerId: "me",
  users: [{ id: "sam", name: "Sam Rivera", displayName: "Sam" }],
  teams: [{ id: "t", key: "ENG", name: "Engineering", cyclesEnabled: false, triageEnabled: true, estimates: [] }],
  states: STATES,
  labels: [{ id: "bug", name: "Bug", color: "#f00" }],
  cycles: [],
  projects: [{ id: "p", name: "Launch" }],
  initiatives: [],
} as unknown as LinearWorkspace;

const issue = (n: number, stateId: string, priority: LinearIssue["priority"], updatedAt: string, extra: Partial<LinearIssue> = {}) =>
  ({
    id: `i-${n}`,
    key: `ENG-${n}`,
    title: `Title ${n}`,
    teamId: "t",
    stateId,
    priority,
    labelIds: [],
    updatedAt,
    ...extra,
  }) as LinearIssue;

test("linear groups: by state, started then unstarted, triage, backlog, done, canceled; urgent first, none last", () => {
  const groups = groupIssues(
    [
      issue(1, "back", 1, "2026-10-01"),
      issue(2, "todo", 0, "2026-10-05"),
      issue(3, "rev", 3, "2026-10-02"),
      issue(4, "todo", 2, "2026-10-01"),
      issue(5, "todo", 2, "2026-10-03"),
      issue(6, "gone", 0, "2026-10-03"),
      issue(7, "done", 0, "2026-10-03"),
      issue(8, "tri", 0, "2026-10-03"),
      issue(9, "prog", 4, "2026-10-03"),
    ],
    WS,
  );
  assert.deepEqual(
    groups.map((g) => [g.state.name, g.issues.map((i) => i.key)]),
    [
      ["In Progress", ["ENG-9"]],
      ["In Review", ["ENG-3"]],
      ["Todo", ["ENG-5", "ENG-4", "ENG-2"]],
      ["Triage", ["ENG-8"]],
      ["Backlog", ["ENG-1"]],
      ["Done", ["ENG-7"]],
      ["Canceled", ["ENG-6"]],
    ],
  );
});

test("linear groups: search matches every word in key, title, project, team, labels or assignee", () => {
  const one = issue(12, "todo", 0, "", { title: "Fix the login page", projectId: "p", labelIds: ["bug"], assigneeId: "sam" });
  assert.ok(issueMatches(one, "eng-12", WS));
  assert.ok(issueMatches(one, "login bug", WS));
  assert.ok(issueMatches(one, " launch ", WS));
  assert.ok(issueMatches(one, "sam", WS));
  assert.ok(!issueMatches(one, "login feature", WS));
});
