import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkDisplay,
  checkFilters,
  completedChoices,
  DEFAULT_DISPLAY,
  filterIssues,
  regroup,
  scopeCompleted,
  settleDisplay,
  swapGroupings,
  type Display,
  type Ordering,
} from "./display";
import { arrangeIssues, dropChange, dropChanges, issueMatches, swimlanes } from "./group";
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

test("linear display: the Completed choices are what the list's scope keeps", () => {
  for (const scope of ["assigned", "created", "subscribed", "team:t:triage", "team:t:active", "team:t:backlog"])
    assert.deepEqual(completedChoices(scope), [], scope);
  for (const scope of ["project:p", "team:t:all"]) assert.deepEqual(completedChoices(scope), ["month", "week", "none"], scope);
  for (const scope of ["cycle:c", "view:v", "search:words"])
    assert.deepEqual(completedChoices(scope), ["all", "month", "week", "none"], scope);
  // "All" where only the past month is kept: the past month.
  assert.equal(scopeCompleted("all", completedChoices("project:p")), "month");
  assert.equal(scopeCompleted("week", completedChoices("project:p")), "week");
  assert.equal(scopeCompleted("all", completedChoices("assigned")), "all");
});

test("linear sub-groups: each group's issues by the sub-grouping, its issues theirs in turn; a board's swimlanes", () => {
  const issues = [
    issue(1, "todo", 2, "2026-10-01", { assigneeId: "sam" }),
    issue(2, "prog", 1, "2026-10-02", { assigneeId: "me" }),
    issue(3, "todo", 1, "2026-10-03", { assigneeId: "me" }),
    issue(4, "todo", 3, "2026-10-04"),
    issue(5, "prog", 2, "2026-10-05", { assigneeId: "sam" }),
  ];
  const display = { grouping: "status", subGrouping: "assignee", ordering: "priority" } as const;
  const groups = arrangeIssues(issues, ME_WS, display);
  assert.deepEqual(
    groups.map((g) => [g.label, g.subgroups?.map((s) => [s.label, s.issues.map((i) => i.key)])]),
    [
      ["In Progress", [["Owen Conti", ["ENG-2"]], ["Sam Rivera", ["ENG-5"]]]],
      ["Todo", [["Owen Conti", ["ENG-3"]], ["Sam Rivera", ["ENG-1"]], ["No assignee", ["ENG-4"]]]],
    ],
  );
  // The group's issues in display order: its sub-groups', in turn.
  assert.deepEqual(groups[1].issues.map((i) => i.key), ["ENG-3", "ENG-1", "ENG-4"]);
  // None, or the grouping's own property: no sub-groups.
  assert.equal(arrangeIssues(issues, ME_WS, { ...display, subGrouping: "none" })[0].subgroups, undefined);
  assert.equal(arrangeIssues(issues, ME_WS, { ...display, subGrouping: "status" })[0].subgroups, undefined);
  const none = { ...display, subGrouping: "none" } as const;
  assert.equal(swimlanes(arrangeIssues(issues, ME_WS, none), ME_WS, none), null);

  // A board: the team's every state a column, a lane for each sub-group with issues, a cell for each column.
  const lanes = swimlanes(arrangeIssues(issues, ME_WS, display, { states: STATES }), ME_WS, display)!;
  assert.deepEqual(
    lanes.map((l) => [l.lane.label, l.lane.issues.map((i) => i.key)]),
    [
      ["Owen Conti", ["ENG-2", "ENG-3"]],
      ["Sam Rivera", ["ENG-5", "ENG-1"]],
      ["No assignee", ["ENG-4"]],
    ],
  );
  assert.deepEqual(
    lanes[2].cells.map((c) => [c.label, c.issues.map((i) => i.key)]),
    [["In Progress", []], ["In Review", []], ["Todo", ["ENG-4"]], ["Triage", []], ["Backlog", []], ["Done", []], ["Canceled", []]],
  );
  // A lane that only a later column has still comes in the sub-grouping's order.
  const later = swimlanes(
    arrangeIssues([issue(6, "prog", 1, "", { assigneeId: "sam" }), issue(7, "todo", 1, "", { assigneeId: "me" })], ME_WS, display),
    ME_WS,
    display,
  )!;
  assert.deepEqual(later.map((l) => l.lane.label), ["Owen Conti", "Sam Rivera"]);
});

test("linear board: a drop in a swimlane's cell takes the column's and the lane's values, as one change", () => {
  const two = issue(2, "todo", 3, "", { assigneeId: "sam", cycleId: "c7" });
  const prog = { key: "state:In Progress", value: "In Progress" };
  const todo = { key: "state:Todo", value: "Todo" };
  const me = { key: "user:me", value: "me" };
  const sam = { key: "user:sam", value: "sam" };
  const both = (column: typeof prog, lane: typeof me) =>
    dropChanges(two, [{ group: column, grouping: "status" }, { group: lane, grouping: "assignee" }], ME_WS);
  assert.deepEqual(both(prog, me), {
    input: { stateId: "prog", assigneeId: "me" },
    patch: { stateId: "prog", assigneeId: "me" },
  });
  assert.deepEqual(both(prog, sam), { input: { stateId: "prog" }, patch: { stateId: "prog" } });
  assert.deepEqual(both(todo, me), { input: { assigneeId: "me" }, patch: { assigneeId: "me" } });
  assert.equal(both(todo, sam), null, "its own cell");
  // Either it can't take: no drop at all (it would land elsewhere).
  const x1 = { key: "cycle:x1", value: "x1" };
  assert.equal(
    dropChanges(two, [{ group: prog, grouping: "status" }, { group: x1, grouping: "cycle" }], ME_WS),
    null,
    "another team's cycle",
  );
  // Without a lane, as a column drop.
  assert.deepEqual(dropChanges(two, [{ group: prog, grouping: "status" }], ME_WS), dropChange(two, prog, "status", ME_WS));
});

test("linear display: sub-grouping as Linear's Display options have it", () => {
  const d = (patch: Partial<Display>): Display => ({ ...DEFAULT_DISPLAY, ...patch });
  // Sub-grouped by another property; by the grouping's own: swapped, or cleared when there's nothing to swap.
  assert.equal(regroup(d({}), "subGrouping", "assignee").subGrouping, "assignee");
  const sub = d({ grouping: "status", subGrouping: "assignee" });
  assert.deepEqual(regroup(sub, "subGrouping", "status"), d({ grouping: "assignee", subGrouping: "status" }));
  assert.deepEqual(regroup(d({}), "subGrouping", "status"), d({}));
  // Grouped by the sub-grouping's property: swapped; by none: no sub-grouping.
  assert.deepEqual(regroup(sub, "grouping", "assignee"), d({ grouping: "assignee", subGrouping: "status" }));
  assert.deepEqual(regroup(sub, "grouping", "priority"), d({ grouping: "priority", subGrouping: "assignee" }));
  assert.deepEqual(regroup(sub, "grouping", "none"), d({ grouping: "none", subGrouping: "none" }));
  // ⇅
  assert.deepEqual(swapGroupings(sub), d({ grouping: "assignee", subGrouping: "status" }));
  assert.deepEqual(swapGroupings(d({})), d({}));
  // A board is grouped; a sub-grouping is never the grouping.
  assert.deepEqual(settleDisplay(d({ layout: "board", grouping: "none" })), d({ layout: "board", grouping: "status" }));
  assert.deepEqual(settleDisplay(d({ grouping: "priority", subGrouping: "priority" })), d({ grouping: "priority" }));
  // Remembered displays: one kept before sub-groupings has none, even where the place's default has one.
  const viewDefault = d({ layout: "board", grouping: "assignee", subGrouping: "priority" });
  assert.equal(checkDisplay({ layout: "list", grouping: "status", ordering: "priority", completed: "all" }, viewDefault).subGrouping, "none");
  assert.equal(checkDisplay(null, viewDefault).subGrouping, "priority");
  assert.equal(checkDisplay({ grouping: "assignee", subGrouping: "assignee" }).subGrouping, "none");
  assert.equal(checkDisplay({ grouping: "none", subGrouping: "assignee" }).subGrouping, "none");
});
