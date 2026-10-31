import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { FAKE_IDS } from "../../server/linear/fake";
import { DEFAULT_PLACE, placeScope, readPlace, writePlace, type LinearPlace } from "./place";
import type { LinearTeam, LinearWorkspace } from "./types";

// The page's localStorage, in memory.
const stored = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, String(v)),
    removeItem: (k: string) => void stored.delete(k),
  },
});

const team = (id: string, key: string, triageEnabled: boolean): LinearTeam => ({
  id,
  key,
  name: key,
  cyclesEnabled: false,
  triageEnabled,
  estimates: [],
});
const WS: LinearWorkspace = {
  viewerId: FAKE_IDS.owen,
  users: [],
  teams: [team(FAKE_IDS.eng, "ENG", true), team(FAKE_IDS.de, "DE", false)],
  states: [],
  labels: [],
  cycles: [],
  projects: [],
  initiatives: [],
};

describe("linear place", () => {
  beforeEach(() => stored.clear());

  it("defaults to the issues assigned to you", () => {
    assert.deepEqual(readPlace(WS), { screen: "my", tab: "assigned" });
    assert.deepEqual(DEFAULT_PLACE, { screen: "my", tab: "assigned" });
    stored.set("paseo-command:linear:place", "{not json");
    assert.deepEqual(readPlace(WS), { screen: "my", tab: "assigned" });
    stored.set("paseo-command:linear:place", JSON.stringify({ screen: "nowhere" }));
    assert.deepEqual(readPlace(WS), { screen: "my", tab: "assigned" });
  });

  it("comes back as written, with the open issue", () => {
    const place: LinearPlace = { screen: "team", teamId: FAKE_IDS.eng, tab: "backlog", issue: "ENG-1" };
    writePlace(place);
    assert.deepEqual(readPlace(WS), place);
    writePlace({ screen: "my", tab: "subscribed" });
    assert.deepEqual(readPlace(WS), { screen: "my", tab: "subscribed" });
  });

  it("falls back to the default for a team the workspace doesn't have", () => {
    writePlace({ screen: "team", teamId: "00000000-0000-4000-8000-000000000000", tab: "all", issue: "X-1" });
    assert.deepEqual(readPlace(WS), { screen: "my", tab: "assigned" });
    // Before the workspace is in, the team can't be checked: it stays.
    assert.equal(readPlace(undefined).screen, "team");
  });

  it("leaves Triage for Active on a team without triage", () => {
    writePlace({ screen: "team", teamId: FAKE_IDS.de, tab: "triage" });
    assert.deepEqual(readPlace(WS), { screen: "team", teamId: FAKE_IDS.de, tab: "active" });
  });

  it("maps each place to the store's scope", () => {
    assert.equal(placeScope({ screen: "my", tab: "assigned" }), "assigned");
    assert.equal(placeScope({ screen: "my", tab: "created" }), "created");
    assert.equal(placeScope({ screen: "my", tab: "subscribed" }), "subscribed");
    for (const tab of ["triage", "active", "backlog", "all"] as const)
      assert.equal(placeScope({ screen: "team", teamId: FAKE_IDS.eng, tab }), `team:${FAKE_IDS.eng}:${tab}`);
    assert.equal(placeScope({ screen: "project", projectId: FAKE_IDS.projects.launch }), `project:${FAKE_IDS.projects.launch}`);
    assert.equal(placeScope({ screen: "projects" }), null);
    assert.equal(placeScope({ screen: "initiatives" }), null);
  });
});
