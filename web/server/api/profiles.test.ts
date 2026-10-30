import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fleet, get, install, post } from "../fake-daemon";

// Only fake daemons: install() points the app's connector at them.
const { network, local } = fleet();
local.addProject({ projectId: "prj_app", path: "/home/review/app", name: "app" });
local.agentProfiles = [
  {
    id: "agent_profile_ship",
    name: "Shipper",
    icon: "rocket",
    provider: "claude",
    model: "opus",
    modeId: "bypassPermissions",
    thinkingOptionId: "high",
    featureValues: { fast_mode: true, nested: { no: 1 } },
    notes: "When invoking /ship-issue",
  },
  { id: "agent_profile_bad", name: "No provider" },
];
let uninstall: () => void;
before(() => {
  uninstall = install(network);
});
after(() => {
  uninstall();
  // The API keeps live connections and timers; nothing else runs here.
  setTimeout(() => process.exit(0), 50).unref();
});

test("profiles: the daemon config's agent profiles, complete ones only", async () => {
  const r = await get("profiles");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data, [
    {
      id: "agent_profile_ship",
      name: "Shipper",
      provider: "claude",
      model: "opus",
      mode: "bypassPermissions",
      thinking: "high",
      features: { fast_mode: true },
      notes: "When invoking /ship-issue",
    },
  ]);
});

test("dispatch carries a profile's feature values to the new agent", async () => {
  const r = await post("dispatch", {
    projectId: "prj_app",
    prompt: "Ship it",
    provider: "claude",
    model: "opus",
    thinking: "high",
    mode: "bypassPermissions",
    features: { fast_mode: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const agent = local.callsOf("createAgent").at(-1)?.args[0];
  assert.deepEqual(agent.featureValues, { fast_mode: true });
  assert.equal(agent.thinkingOptionId, "high");
  for (const features of [["fast_mode"], { "bad key": true }, { x: { y: 1 } }]) {
    const bad = await post("dispatch", {
      projectId: "prj_app", prompt: "x", provider: "claude", features,
    });
    assert.equal(bad.status, 400, JSON.stringify(features));
  }
});
