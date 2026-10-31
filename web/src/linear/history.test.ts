import assert from "node:assert/strict";
import { test } from "node:test";
import { currentPlace, HISTORY_MAX, startHistory, step, visit } from "./history";
import type { LinearPlace } from "./place";

const assigned: LinearPlace = { screen: "my", tab: "assigned" };
const projects: LinearPlace = { screen: "projects" };
const issue: LinearPlace = { screen: "projects", issue: "ENG-1" };

test("linear history: back and forward as a browser's, a new place dropping what was ahead", () => {
  let h = visit(visit(startHistory(assigned), projects), issue);
  assert.deepEqual(h, { stack: [assigned, projects, issue], at: 2 });
  h = step(h, -1)!;
  assert.deepEqual(currentPlace(h), projects);
  h = step(h, -1)!;
  assert.equal(step(h, -1), null, "nothing before the first");
  h = step(h, 1)!;
  assert.deepEqual(currentPlace(h), projects);
  // Somewhere new from the middle: what was ahead goes.
  const inbox: LinearPlace = { screen: "inbox" };
  h = visit(h, inbox);
  assert.deepEqual(h, { stack: [assigned, projects, inbox], at: 2 });
  assert.equal(step(h, 1), null, "nothing after the last");
});

test("linear history: the same place changes nothing; a replacement takes the current entry's place", () => {
  const h = visit(startHistory(assigned), projects);
  assert.equal(visit(h, { screen: "projects" }), h);
  const search: LinearPlace = { screen: "search", query: "s" };
  const typed = visit(visit(h, search), { screen: "search", query: "sync" }, true);
  assert.deepEqual(typed, { stack: [assigned, projects, { screen: "search", query: "sync" }], at: 2 });
});

test("linear history: keeps the last hundred places", () => {
  let h = startHistory(assigned);
  for (let n = 0; n < HISTORY_MAX + 20; n++) h = visit(h, { screen: "search", query: String(n) });
  assert.equal(h.stack.length, HISTORY_MAX);
  assert.equal(h.at, HISTORY_MAX - 1);
  assert.deepEqual(currentPlace(h), { screen: "search", query: String(HISTORY_MAX + 19) });
});
