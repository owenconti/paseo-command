import assert from "node:assert/strict";
import { test } from "node:test";
import { conversationOrder } from "./conversationOrder";
import { hostRank } from "./crew/hostOrder";
import type { Agent } from "./types";

const agent = (id: string, host: string | undefined, createdAt: string) => ({ id, host, projectId: "p", workspaceId: "w", createdAt }) as unknown as Agent;

test("J/K step hosts in Crew's host order when there is one, else as before", () => {
  const agents = [agent("a", undefined, "2026-01-01"), agent("b", "srv_lab", "2026-01-02"), agent("c", undefined, "2026-01-03")];
  assert.deepEqual(conversationOrder(agents).map((a) => a.id), ["a", "c", "b"]);
  assert.deepEqual(conversationOrder(agents, hostRank(["srv_lab", "local"])).map((a) => a.id), ["b", "a", "c"], "the lab first");
  assert.deepEqual(conversationOrder(agents, hostRank([])).map((a) => a.id), ["a", "c", "b"], "no order: as before");
});
