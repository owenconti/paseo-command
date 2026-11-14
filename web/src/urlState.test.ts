import { test } from "node:test";
import assert from "node:assert/strict";
import { readUrlState, selectionKey, urlSearch } from "./urlState";

test("an agent with its host and subagent round-trips through the URL", () => {
  const state = readUrlState("?agent=a1&host=srv_b&sub=s9");
  assert.deepEqual(state, { selection: { type: "agent", id: "a1", host: "srv_b", subagent: "s9" } });
  assert.equal(urlSearch(state), "?agent=a1&host=srv_b&sub=s9");
  assert.equal(selectionKey(state.selection), "agent:a1:srv_b:s9");
});

test("nothing open is an empty query; old list parameters are ignored", () => {
  assert.deepEqual(readUrlState(""), { selection: null });
  assert.equal(urlSearch({ selection: null }), "");
  assert.deepEqual(readUrlState("?tab=Hosts&filter=running&on=local&list=1"), { selection: null });
  assert.deepEqual(readUrlState("?workspace=w1&tab=Agents"), { selection: { type: "workspace", id: "w1" } });
  // A subagent belongs to an agent only.
  assert.deepEqual(readUrlState("?project=p1&sub=s1"), { selection: { type: "project", id: "p1" } });
});
