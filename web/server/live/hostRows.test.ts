import { test } from "node:test";
import assert from "node:assert/strict";
import { archivedAgent } from "./hostRows";
import { isArchived } from "../../src/types";

test("a closed agent is still shown; only archived ones are hidden", () => {
  assert.equal(archivedAgent({ id: "a", status: "closed" } as never), false);
  assert.equal(isArchived({ status: "closed" }), false);
  assert.equal(
    archivedAgent({
      id: "b",
      status: "closed",
      archivedAt: "2026-10-28",
    } as never),
    true,
  );
  assert.equal(isArchived({ status: "closed", archived: true }), true);
});

test("a fork's helper is never shown, counted as work, or asked about", async () => {
  const { hostRows } = await import("./hostRows");
  const { FORK_LABEL } = await import("../../src/forks/types");
  const main = { id: "main", status: "idle", workspaceId: "ws", labels: {} };
  const helper = {
    id: "helper",
    status: "running",
    workspaceId: "ws",
    labels: { [FORK_LABEL]: "fork_1", "paseo.parent-agent-id": "main" },
    pendingPermissions: [{ id: "p1", name: "Bash", kind: "tool" }],
  };
  const rows = hostRows({
    active: [{ agent: helper }, { agent: main }] as never,
    inactive: [],
    workspaces: [],
    projects: [],
  });
  assert.deepEqual(
    rows.agents.map((a: { id: string }) => a.id),
    ["main"],
  );
  assert.equal((rows.agents[0] as { subagentsRunning?: boolean }).subagentsRunning, undefined);
  assert.deepEqual(rows.permissions, []);
});
