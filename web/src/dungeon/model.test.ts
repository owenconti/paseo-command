import test from "node:test";
import assert from "node:assert/strict";
import { hudAgents } from "./model";
import type { AtlasData } from "../../../rendering/src/world";
test("belt queues follow map state and exclude offline hosts", () => {
  const data: AtlasData = {
    hosts: [
      { key: "on", name: "Online", online: true, local: true },
      { key: "off", name: "Offline", online: false, local: false },
    ],
    projects: [],
    workspaces: [],
    agents: [
      "running",
      "done",
      "approval",
      "question",
      "asking",
      "failed",
      "offline",
      "idle",
    ].map((state, i) => ({
      key: String(i),
      name: String(i),
      host: "on",
      model: "codex",
      state: state as AtlasData["agents"][number]["state"],
    })),
  };
  data.agents.push({
    key: "stale-running",
    name: "stale",
    host: "off",
    state: "running",
    model: "codex",
  });
  assert.deepEqual(
    hudAgents(data, "waiting").map((a) => a.state),
    ["approval", "question", "asking"],
  );
  assert.deepEqual(
    hudAgents(data, "replies").map((a) => a.state),
    ["done"],
  );
  assert.deepEqual(
    hudAgents(data, "running").map((a) => a.key),
    ["0"],
  );
  assert.deepEqual(
    hudAgents(data, "failures").map((a) => a.state),
    ["failed"],
  );
});
