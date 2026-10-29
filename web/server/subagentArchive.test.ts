import { test } from "node:test";
import assert from "node:assert/strict";
import { planArchive } from "./subagentArchive";
import { FORK_LABEL } from "../src/forks/types";

test("archiving finished subagents leaves a reply fork's helper alone", () => {
  const child = (id: string, labels: Record<string, string> = {}) => ({
    id,
    status: "idle",
    workspaceId: "ws",
    labels: { "paseo.parent-agent-id": "main", ...labels },
  });
  const plan = planArchive({
    parent: "main",
    agents: [
      { id: "main", status: "idle", workspaceId: "ws", labels: {} },
      child("helper-task"),
      child("fork-helper", { [FORK_LABEL]: "fork_1" }),
    ] as never,
    provider: () => [],
  });
  const all = [...plan.archive, ...plan.dismiss, ...plan.keep].map((c) => c.id);
  assert.ok(plan.archive.some((c) => c.id === "helper-task"), JSON.stringify(plan));
  assert.ok(!all.includes("fork-helper"), JSON.stringify(plan));
});
