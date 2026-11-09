import { test } from "node:test";
import assert from "node:assert/strict";
import { hostRows } from "../server/live/hostRows";
import { worldSnapshot } from "./worldBridge";
import { agentName } from "./names";
import type { Agent, Workspace } from "./types";

test("the map and chat agree on a sole agent's workspace title and on shared-workspace agent titles", () => {
  for (const shared of [false, true]) {
    const rows = hostRows({ active: [
      { agent: { id: "agent-one", title: "Opening chat message", status: "idle", workspaceId: "workspace", cwd: "/fake" } },
      ...(shared ? [{ agent: { id: "agent-two", title: "Review changes", status: "idle" as const, workspaceId: "workspace", cwd: "/fake" } }] : []),
    ], inactive: [], workspaces: [{ id: "workspace", title: "DE-123 · Fix preview redirects", workspaceDirectory: "/fake" }], projects: [] });
    const agents = rows.agents as unknown as Agent[];
    const snapshot = worldSnapshot({ revision: 1, hosts: [], projects: [], workspaces: rows.workspaces as Workspace[], agents, permissions: new Set(), unread: new Set() });
    assert.equal(snapshot.agents[0].name, agentName(agents[0]));
    assert.equal(snapshot.agents[0].name, shared ? "Opening chat message" : "DE-123 · Fix preview redirects");
  }
});
