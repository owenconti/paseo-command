import assert from "node:assert/strict";
import { test } from "node:test";
import {
  baseOfScope,
  fromIssueFilter,
  fromProjectFilter,
  intersectFilters,
  issuePreferences,
  projectDisplayOf,
  projectPreferences,
  resolveIssueFilter,
  toIssueFilter,
  toProjectFilter,
  type IssueViewFilter,
} from "./viewFilter";
import type { LinearState } from "./types";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

test("an issue view's filter goes to Linear's IssueFilter and back", () => {
  const filters: IssueViewFilter[] = [
    { base: {}, filters: {} },
    { base: { me: "assignee" }, filters: { status: ["Todo", "In Progress"] } },
    { base: { me: "creator" }, filters: { priority: ["1", "2"] } },
    { base: { me: "subscriber", teamId: A }, filters: { labels: [A, "none"] } },
    { base: { teamId: A, stateTypes: ["backlog"] }, filters: { project: ["none"], cycle: [B], assignee: [A, "none"] } },
    { base: {}, filters: { labels: ["none"] } },
  ];
  for (const f of filters) assert.deepEqual(fromIssueFilter(toIssueFilter(f)), f);
  assert.deepEqual(toIssueFilter({ base: {}, filters: {} }), {});
  assert.deepEqual(toIssueFilter({ base: {}, filters: { project: [A] } }), { project: { id: { in: [A] } } });
});

test("Linear's own shapes are read too: ids by eq, conditions side by side, statuses by id", () => {
  assert.deepEqual(fromIssueFilter({ assignee: { id: { eq: A } }, state: { type: { eq: "started" } } }), {
    base: { stateTypes: ["started"] },
    filters: { assignee: [A] },
  });
  assert.deepEqual(fromIssueFilter({ and: [{ priority: { eq: 2 } }, { labels: { id: { in: [A] } } }] }), {
    base: {},
    filters: { priority: ["2"], labels: [A] },
  });
  const byId = fromIssueFilter({ state: { id: { in: [A, B] } } })!;
  assert.deepEqual(byId.stateIds, [A, B]);
  const states = [
    { id: A, name: "Todo" },
    { id: B, name: "Todo" },
  ] as LinearState[];
  assert.deepEqual(resolveIssueFilter(byId, states), { base: {}, filters: { status: ["Todo"] } });
  assert.equal(resolveIssueFilter(byId, states.slice(0, 1)), null, "a status the workspace doesn't have");
});

test("a filter with anything the app can't say isn't read", () => {
  for (const raw of [
    { estimate: { gte: 1 } },
    { assignee: { name: { eq: "Sam" } } },
    { priority: { gt: 1 } },
    { or: [{ priority: { eq: 1 } }, { assignee: { null: true } }] },
    { and: [{ priority: { eq: 1 } }, { priority: { eq: 2 } }] },
    { team: { id: { in: [A, B] } } },
    { state: { type: { in: ["nope"] } } },
    { and: "nope" },
    [],
  ])
    assert.equal(fromIssueFilter(raw), null, JSON.stringify(raw));
});

test("a project view's filter goes to Linear's ProjectFilter and back", () => {
  const f = { status: ["Started"], health: ["onTrack", "atRisk"], lead: [A, "none"], team: [B] };
  assert.deepEqual(fromProjectFilter(toProjectFilter(f)), f);
  assert.deepEqual(fromProjectFilter({}), {});
  assert.deepEqual(fromProjectFilter({ lead: { null: true } }), { lead: ["none"] });
  assert.equal(fromProjectFilter({ targetDate: { lt: "2026-01-01" } }), null);
  assert.equal(fromProjectFilter({ health: { in: ["great"] } }), null);
});

test("a place's base, and what's shown narrowing a view", () => {
  assert.deepEqual(baseOfScope("assigned"), { base: { me: "assignee" }, filters: {} });
  assert.deepEqual(baseOfScope(`team:${A}:active`), { base: { teamId: A, stateTypes: ["unstarted", "started"] }, filters: {} });
  assert.deepEqual(baseOfScope(`team:${A}:all`), { base: { teamId: A }, filters: {} });
  assert.deepEqual(baseOfScope(`project:${A}`), { base: {}, filters: { project: [A] } });
  assert.deepEqual(baseOfScope(`cycle:${B}`), { base: {}, filters: { cycle: [B] } });
  assert.equal(baseOfScope("search:sync"), null);
  assert.deepEqual(intersectFilters({ status: ["Todo", "Done"], priority: ["1"] }, { status: ["Todo"], labels: [A] }), {
    status: ["Todo"],
    priority: ["1"],
    labels: [A],
  });
});

test("displays as Linear's view preferences, and a project view's back", () => {
  assert.deepEqual(
    issuePreferences({ layout: "list", grouping: "status", subGrouping: "none", ordering: "relevance", completed: "month" }),
    { layout: "list", issueGrouping: "workflowState", issueSubGrouping: "noGrouping", showCompletedIssues: "pastMonth" },
  );
  const display = { grouping: "lead", ordering: "progress", completed: "none" } as const;
  assert.deepEqual(projectDisplayOf(projectPreferences(display)), display);
  assert.deepEqual(projectDisplayOf({ projectGrouping: "somethingNew" }), {});
});
