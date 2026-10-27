import { test } from "node:test";
import assert from "node:assert/strict";
import { readUrlState, urlSearch } from "./urlState";

const defaults = { tab: "Workspaces" as const };

test("an agent with its subagent, tab, filter and host round-trip through the URL", () => {
  const state = {
    selection: { type: "agent" as const, id: "a1", host: "srv", subagent: "s2" },
    tab: "Agents" as const,
    filter: "running" as const,
    hostFilter: "",
    browsing: false,
  };
  const search = urlSearch(state, defaults);
  assert.equal(search, "?agent=a1&host=srv&sub=s2&tab=Agents&filter=running&on=local");
  assert.deepEqual(readUrlState(search), state);
});

test("defaults stay out of the URL, and an empty query is the fleet list", () => {
  assert.equal(
    urlSearch({ selection: null, tab: "Workspaces", filter: "all", hostFilter: null, browsing: true }, defaults),
    "",
  );
  assert.deepEqual(readUrlState(""), {
    selection: null,
    tab: undefined,
    filter: undefined,
    hostFilter: null,
    browsing: true,
  });
});

test("the list shown over a selection, and unknown values, are read safely", () => {
  const state = readUrlState("?workspace=w1&list=1&tab=Nope&filter=bogus");
  assert.deepEqual(state.selection, { type: "workspace", id: "w1" });
  assert.equal(state.browsing, true);
  assert.equal(state.tab, undefined);
  assert.equal(state.filter, undefined);
});
