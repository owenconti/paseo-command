import test from "node:test";
import assert from "node:assert/strict";
import type { Agent } from "../types";
import { conversationOrder } from "./navigation";
const agent = (id: string, extra: Partial<Agent> = {}): Agent => ({
  id,
  shortId: id,
  name: id,
  provider: "codex",
  status: "idle",
  cwd: "/repo",
  projectId: "project",
  workspaceId: "workspace",
  created: "2026-11-09T00:00:00Z",
  ...extra,
});
test("conversation navigation keeps a stable roster when statuses or unread flags change", () => {
  const rows = [
    agent("older", { created: "2026-11-08T00:00:00Z" }),
    agent("newer", { status: "running", unread: true }),
    agent("remote", { host: "remote" }),
  ];
  assert.deepEqual(
    conversationOrder([...rows].reverse()).map((a) => a.id),
    ["older", "newer", "remote"],
  );
  assert.deepEqual(
    conversationOrder(
      rows.map((a) => ({
        ...a,
        status: a.status === "idle" ? "running" : "idle",
        unread: !a.unread,
      })),
    ).map((a) => a.id),
    ["older", "newer", "remote"],
  );
  assert.equal(rows[0]!.id, "older", "sorting never mutates the caller's list");
});
