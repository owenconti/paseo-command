import assert from "node:assert/strict";
import { test } from "node:test";
import { checkDisplay, checkFilters, DEFAULT_DISPLAY, filterIssues, type Ordering } from "./display";
import { arrangeIssues, dropChange, issueMatches } from "./group";
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
  const groups = arrangeIssues(
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
    groups.map((g) => [g.label, g.issues.map((i) => i.key)]),
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

const ME_WS = {
  ...WS,
  users: [
    { id: "me", name: "Owen Conti", displayName: "Owen" },
    { id: "sam", name: "Sam Rivera", displayName: "Sam" },
    { id: "ada", name: "Ada Lovelace", displayName: "Ada" },
  ],
  projects: [
    { id: "p", name: "Launch", color: "#00f", milestones: [{ id: "m", name: "Beta" }] },
    { id: "q", name: "Docs", color: "#0f0", milestones: [] },
  ],
  cycles: [
    { id: "c7", teamId: "t", number: 7, startsAt: "", endsAt: "", isActive: true, isNext: false },
    { id: "c8", teamId: "t", number: 8, startsAt: "", endsAt: "", isActive: false, isNext: true },
    { id: "x1", teamId: "other", number: 1, startsAt: "", endsAt: "", isActive: true, isNext: false },
  ],
} as unknown as LinearWorkspace;
const keysOf = (groups: ReturnType<typeof arrangeIssues>) => groups.map((g) => [g.label, g.issues.map((i) => i.key)]);

test("linear groups: by assignee (you first, nobody last), priority (none last), project and cycle (current first)", () => {
  const issues = [
    issue(1, "todo", 0, "2026-10-01", { assigneeId: "sam", projectId: "q", cycleId: "c8" }),
    issue(2, "todo", 2, "2026-10-02", { assigneeId: "me", projectId: "p", cycleId: "c7" }),
    issue(3, "todo", 1, "2026-10-03"),
    issue(4, "todo", 4, "2026-10-04", { assigneeId: "ada", cycleId: "gone" }),
  ];
  const by = (grouping: "assignee" | "priority" | "project" | "cycle") =>
    keysOf(arrangeIssues(issues, ME_WS, { grouping, ordering: "priority" }));
  assert.deepEqual(by("assignee"), [
    ["Owen Conti", ["ENG-2"]],
    ["Ada Lovelace", ["ENG-4"]],
    ["Sam Rivera", ["ENG-1"]],
    ["No assignee", ["ENG-3"]],
  ]);
  assert.deepEqual(by("priority"), [
    ["Urgent", ["ENG-3"]],
    ["High", ["ENG-2"]],
    ["Low", ["ENG-4"]],
    ["No priority", ["ENG-1"]],
  ]);
  assert.deepEqual(by("project"), [
    ["Docs", ["ENG-1"]],
    ["Launch", ["ENG-2"]],
    ["No project", ["ENG-3", "ENG-4"]],
  ]);
  assert.deepEqual(by("cycle"), [
    ["Cycle 7", ["ENG-2"]],
    ["Cycle 8", ["ENG-1"]],
    ["Another cycle", ["ENG-4"]],
    ["No cycle", ["ENG-3"]],
  ]);
  assert.deepEqual(keysOf(arrangeIssues(issues, ME_WS, { grouping: "none", ordering: "updated" })), [
    ["Issues", ["ENG-4", "ENG-3", "ENG-2", "ENG-1"]],
  ]);
});

test("linear groups: orderings, a search's relevance, and a board's empty columns", () => {
  const issues = [
    issue(1, "todo", 3, "2026-10-03", { title: "b", createdAt: "2026-09-01", sortOrder: 3, dueDate: "2026-11-02" }),
    issue(2, "todo", 1, "2026-10-01", { title: "c", createdAt: "2026-09-03", sortOrder: 1 }),
    issue(3, "todo", 0, "2026-10-02", { title: "a", createdAt: "2026-09-02", sortOrder: 2, dueDate: "2026-11-01" }),
  ];
  const order = (ordering: Ordering, rank?: Map<string, number>) =>
    arrangeIssues(issues, WS, { grouping: "none", ordering }, { rank })[0].issues.map((i) => i.key);
  assert.deepEqual(order("priority"), ["ENG-2", "ENG-1", "ENG-3"]);
  assert.deepEqual(order("updated"), ["ENG-1", "ENG-3", "ENG-2"]);
  assert.deepEqual(order("created"), ["ENG-2", "ENG-3", "ENG-1"]);
  assert.deepEqual(order("manual"), ["ENG-2", "ENG-3", "ENG-1"]);
  assert.deepEqual(order("due"), ["ENG-3", "ENG-1", "ENG-2"]);
  assert.deepEqual(order("title"), ["ENG-3", "ENG-1", "ENG-2"]);
  assert.deepEqual(order("relevance", new Map([["i-3", 0], ["i-1", 1], ["i-2", 2]])), ["ENG-3", "ENG-1", "ENG-2"]);
  // A board shows each of the team's states, empty or not.
  const board = arrangeIssues(issues, WS, DEFAULT_DISPLAY, { states: STATES });
  assert.deepEqual(
    board.map((g) => [g.label, g.issues.length]),
    [["In Progress", 0], ["In Review", 0], ["Todo", 3], ["Triage", 0], ["Backlog", 0], ["Done", 0], ["Canceled", 0]],
  );
});

test("linear filters: any value of a property, every property, and how recently finished issues show", () => {
  const now = Date.parse("2026-10-31T00:00:00Z");
  const issues = [
    issue(1, "todo", 1, "2026-10-30", { assigneeId: "sam", labelIds: ["bug"] }),
    issue(2, "prog", 2, "2026-10-30", { projectId: "p" }),
    issue(3, "done", 0, "2026-10-30", { completedAt: "2026-10-28T00:00:00Z" }),
    issue(4, "gone", 0, "2026-10-30", { canceledAt: "2026-10-10T00:00:00Z" }),
    issue(5, "done", 0, "2026-10-30", { completedAt: "2026-08-01T00:00:00Z" }),
  ];
  const keys = (filters: Parameters<typeof filterIssues>[1], completed: Parameters<typeof filterIssues>[2] = "all") =>
    filterIssues(issues, filters, completed, WS, now).map((i) => i.key);
  assert.deepEqual(keys({}), ["ENG-1", "ENG-2", "ENG-3", "ENG-4", "ENG-5"]);
  assert.deepEqual(keys({ status: ["Todo", "In Progress"] }), ["ENG-1", "ENG-2"]);
  assert.deepEqual(keys({ assignee: ["none"] }), ["ENG-2", "ENG-3", "ENG-4", "ENG-5"]);
  assert.deepEqual(keys({ assignee: ["none"], project: ["p"] }), ["ENG-2"]);
  assert.deepEqual(keys({ labels: ["bug"] }), ["ENG-1"]);
  assert.deepEqual(keys({ labels: ["none"], priority: ["2"] }), ["ENG-2"]);
  assert.deepEqual(keys({}, "week"), ["ENG-1", "ENG-2", "ENG-3"]);
  assert.deepEqual(keys({}, "month"), ["ENG-1", "ENG-2", "ENG-3", "ENG-4"]);
  assert.deepEqual(keys({}, "none"), ["ENG-1", "ENG-2"]);
});

test("linear display and filters: remembered values are checked", () => {
  assert.deepEqual(checkDisplay(null), DEFAULT_DISPLAY);
  assert.deepEqual(checkDisplay({ layout: "board", grouping: "nope", ordering: "due" }), {
    ...DEFAULT_DISPLAY,
    layout: "board",
    ordering: "due",
  });
  assert.deepEqual(checkDisplay({}, { ...DEFAULT_DISPLAY, grouping: "none" }).grouping, "none");
  assert.deepEqual(checkFilters({ status: ["Todo", "Todo", 3, ""], nope: ["x"], labels: [] }), { status: ["Todo"] });
  assert.deepEqual(checkFilters("x"), {});
});

test("linear board: a drop changes the grouping's property, only where it can", () => {
  const two = issue(2, "todo", 0, "", { assigneeId: "sam", projectId: "p", milestoneId: "m", cycleId: "c7" });
  assert.deepEqual(dropChange(two, { value: "In Progress" }, "status", ME_WS), {
    input: { stateId: "prog" },
    patch: { stateId: "prog" },
  });
  assert.equal(dropChange(two, { value: "Todo" }, "status", ME_WS), null);
  assert.equal(dropChange(two, { value: "Shipped" }, "status", ME_WS), null);
  assert.deepEqual(dropChange(two, { value: null }, "assignee", ME_WS), {
    input: { assigneeId: null },
    patch: { assigneeId: undefined },
  });
  assert.deepEqual(dropChange(two, { value: 1 }, "priority", ME_WS)?.input, { priority: 1 });
  // Another project: its milestone goes.
  assert.deepEqual(dropChange(two, { value: "q" }, "project", ME_WS), {
    input: { projectId: "q", projectMilestoneId: null },
    patch: { projectId: "q", milestoneId: undefined },
  });
  assert.deepEqual(dropChange(two, { value: "c8" }, "cycle", ME_WS)?.input, { cycleId: "c8" });
  assert.equal(dropChange(two, { value: "x1" }, "cycle", ME_WS), null, "another team's cycle");
  assert.deepEqual(dropChange(two, { value: null }, "cycle", ME_WS)?.input, { cycleId: null });
  assert.equal(dropChange(two, { value: null }, "none", ME_WS), null);
});
