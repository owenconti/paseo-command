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

test("profiles editor: lists the profiles and saves edits, keeping what it doesn't show", async () => {
  const before = await get("profiles/editor");
  assert.equal(before.status, 200, JSON.stringify(before.data));
  assert.equal(before.data.supported, true);
  assert.deepEqual(before.data.profiles.map((p: any) => p.id), ["agent_profile_ship"]);
  // Meanwhile another client adds one: the editor's save keeps it.
  local.agentProfiles = [
    ...local.agentProfiles,
    { id: "agent_profile_elsewhere", name: "Elsewhere", provider: "claude" },
  ];
  const r = await post("profiles", {
    base: ["agent_profile_ship"],
    profiles: [
      { name: "Reviewer", provider: "claude", model: "opus", thinking: "", mode: "plan", features: {}, notes: "" },
      {
        id: "agent_profile_ship",
        name: "Shipper 2",
        provider: "claude",
        model: "opus",
        thinking: "high",
        mode: "bypassPermissions",
        features: { fast_mode: false },
        notes: "Ships",
      },
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(
    r.data.map((p: any) => p.name),
    ["Reviewer", "Shipper 2", "Elsewhere"],
  );
  const saved = local.callsOf("patchDaemonConfig").at(-1)?.args[0].agentProfiles;
  assert.match(saved[0].id, /^agent_profile_[0-9a-f]{12}$/);
  assert.deepEqual(saved[0], {
    id: saved[0].id, name: "Reviewer", provider: "claude", model: "opus", modeId: "plan",
  });
  assert.deepEqual(saved[1], {
    id: "agent_profile_ship",
    name: "Shipper 2",
    icon: "rocket",
    provider: "claude",
    model: "opus",
    modeId: "bypassPermissions",
    thinkingOptionId: "high",
    featureValues: { nested: { no: 1 }, fast_mode: false },
    notes: "Ships",
  });
  // The list GET shows the saved profiles at once.
  const list = await get("profiles");
  assert.deepEqual(list.data.map((p: any) => p.name), ["Reviewer", "Shipper 2", "Elsewhere"]);
  // Deleting: a listed profile left out goes.
  const del = await post("profiles", {
    base: list.data.map((p: any) => p.id),
    profiles: [list.data[1]],
  });
  assert.deepEqual(del.data.map((p: any) => p.name), ["Shipper 2"]);
});

test("profiles editor refuses bad rows and old daemons", async () => {
  for (const profiles of [
    [{ name: "", provider: "claude" }],
    [{ name: "X", provider: "nope" }],
    [{ name: "X", provider: "claude" }, { name: "x", provider: "claude" }],
    [{ name: "X", provider: "claude", features: { "bad key": 1 } }],
  ]) {
    const r = await post("profiles", { base: [], profiles });
    assert.equal(r.status, 400, JSON.stringify(profiles));
  }
  local.features = { ...local.features, agentProfiles: false };
  const editor = await get("profiles/editor");
  assert.equal(editor.data.supported, false);
  const r = await post("profiles", { base: [], profiles: [] });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /too old/);
  local.features = { ...local.features, agentProfiles: true };
});
