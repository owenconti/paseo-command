import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import {
  createWorkingOnService,
  summaryCandidates,
  summaryContext,
  summarySentence,
  SUMMARY_LABEL,
} from "./workingOn";
import type { DaemonClient } from "./api/hosts";
import type { AgentRecord } from "./api/agents";

const source: AgentRecord = {
  id: "source",
  status: "running",
  provider: "codex",
  model: "main",
  workspaceId: "existing",
  cwd: "/fake/work",
  lastUserMessageAt: "2026-10-27T00:00:00Z",
};
function fake() {
  const calls: { method: string; value?: any }[] = [];
  let reply: any = {
    status: "idle",
    lastMessage: '{"sentence":"Fixing the map tooltip."}',
  };
  let configs = [
    { provider: "claude", model: "haiku-custom", thinkingOptionId: "low" },
  ];
  let failArchive = false;
  const client = {
    async fetchAgentTimeline() {
      return {
        entries: [
          {
            seqStart: 1,
            seqEnd: 1,
            item: { type: "user_message", text: "Fix the map tooltip" },
          },
        ],
      };
    },
    async getDaemonConfig() {
      calls.push({ method: "config" });
      return { config: { metadataGeneration: { providers: configs } } };
    },
    async getProvidersSnapshot() {
      return { entries: [] };
    },
    async createAgent(value: any) {
      calls.push({ method: "create", value });
      return { id: "actual-helper-id" };
    },
    async waitForFinish(id: string) {
      calls.push({ method: "wait", value: id });
      return reply;
    },
    async cancelAgent(id: string) {
      calls.push({ method: "cancel", value: id });
    },
    async archiveAgent(id: string) {
      calls.push({ method: "archive", value: id });
      if (failArchive) throw Error("offline");
    },
  } as unknown as DaemonClient;
  return {
    client,
    calls,
    reply: (v: any) => (reply = v),
    configs: (v: any) => (configs = v),
    failArchive: () => (failArchive = true),
  };
}
async function settled(
  service: ReturnType<typeof createWorkingOnService>,
  client: DaemonClient,
  agent = source,
  host = "host-a",
) {
  for (let i = 0; i < 20; i++) {
    await setImmediate();
    const result = await service.request(client, host, agent);
    if (!result.pending) return result;
  }
  throw new Error("Summary did not settle");
}
test("uses the host metadata model in the existing workspace and archives the returned helper ID", async () => {
  const f = fake(),
    service = createWorkingOnService();
  assert.equal(
    (await service.request(f.client, "host-a", source)).pending,
    true,
  );
  const result = await settled(service, f.client);
  assert.equal(result.sentence, "Fixing the map tooltip.");
  const create = f.calls.find((c) => c.method === "create")!.value;
  assert.equal(create.workspaceId, "existing");
  assert.equal(create.callerAgentId, source.id);
  assert.equal(create.config.provider, "claude");
  assert.equal(create.config.model, "haiku-custom");
  assert.equal(create.config.thinkingOptionId, "low");
  assert.equal(create.labels[SUMMARY_LABEL], "true");
  assert.match(create.initialPrompt, /Fix the map tooltip/);
  assert.equal(create.worktree, undefined);
  assert.deepEqual(
    f.calls.filter((c) => c.method === "wait" || c.method === "archive"),
    [
      { method: "wait", value: "actual-helper-id" },
      { method: "archive", value: "actual-helper-id" },
    ],
  );
  await service.request(f.client, "host-a", source);
  assert.equal(f.calls.filter((c) => c.method === "create").length, 1);
});
test("deduplicates tabs, serializes work per host, and isolates equal IDs on different hosts", async () => {
  const f = fake(),
    service = createWorkingOnService();
  await Promise.all([
    service.request(f.client, "host-a", source),
    service.request(f.client, "host-a", source),
  ]);
  await settled(service, f.client);
  assert.equal(f.calls.filter((c) => c.method === "create").length, 1);
  await service.request(f.client, "host-b", source);
  await settled(service, f.client, source, "host-b");
  assert.equal(f.calls.filter((c) => c.method === "create").length, 2);
});
test("permission, timeout, and error responses are cleaned up and never used as summaries", async () => {
  for (const status of ["permission", "timeout", "error"]) {
    const f = fake(),
      service = createWorkingOnService();
    f.reply({ status, lastMessage: "I completed everything" });
    await service.request(f.client, "host-a", source);
    const result = await settled(service, f.client);
    assert.equal(result.sentence, null);
    assert.ok(result.error);
    assert.equal(f.calls.filter((c) => c.method === "archive").length, 1);
    assert.equal(
      f.calls.filter((c) => c.method === "cancel").length,
      status === "error" ? 0 : 1,
    );
  }
});
test("manual fallback preserves order and stops when helper cleanup fails", async () => {
  const f = fake(),
    service = createWorkingOnService();
  f.configs([
    { provider: "claude", model: "one" },
    { provider: "codex", model: "two" },
  ]);
  f.reply({ status: "error", lastMessage: null });
  f.failArchive();
  await service.request(f.client, "host-a", source);
  assert.ok((await settled(service, f.client)).error);
  assert.deepEqual(
    f.calls
      .filter((c) => c.method === "create")
      .map((c) => c.value.config.model),
    ["one"],
  );
});
test("refuses idle/archived/internal/helper/unplaced agents without generating", async () => {
  const f = fake(),
    service = createWorkingOnService();
  const patches: Partial<AgentRecord>[] = [
    { status: "idle" },
    { archivedAt: "today" },
    { internal: true },
    { labels: { [SUMMARY_LABEL]: "true" } },
    { workspaceId: undefined },
  ];
  for (const patch of patches) {
    assert.equal(
      (await service.request(f.client, "host-a", { ...source, ...patch }))
        .pending,
      false,
    );
  }
  assert.equal(f.calls.length, 0);
});
test("new turn drops old text; unchanged activity does not spend another generation", async () => {
  let now = 1;
  const f = fake(),
    service = createWorkingOnService(() => now);
  await service.request(f.client, "host-a", source);
  await settled(service, f.client);
  now += 60001;
  await service.request(f.client, "host-a", source);
  await settled(service, f.client);
  assert.equal(f.calls.filter((c) => c.method === "create").length, 1);
  const next = { ...source, lastUserMessageAt: "next-turn" };
  assert.equal(
    (await service.request(f.client, "host-a", next)).sentence,
    null,
  );
  await settled(service, f.client, next);
  assert.equal(f.calls.filter((c) => c.method === "create").length, 2);
});
test("Automatic matches available small models then current selection; Manual never adds defaults", () => {
  const catalog: Parameters<typeof summaryCandidates>[1] = [
    {
      provider: "claude",
      enabled: true,
      status: "ready",
      models: [{ provider: "claude", id: "claude-haiku", label: "Haiku" }],
    },
  ];
  assert.deepEqual(
    summaryCandidates([], catalog, source).map((c) => c.model),
    ["claude-haiku", "main"],
  );
  assert.deepEqual(
    summaryCandidates(
      [{ provider: "other", model: "specific" }],
      catalog,
      source,
    ),
    [{ provider: "other", model: "specific" }],
  );
});
test("context is bounded and excludes reasoning; output stays one short text sentence", () => {
  const context = summaryContext([
    { kind: "reasoning", id: "1", text: "private" },
    { kind: "user", id: "2", text: "hello" },
  ]);
  assert.equal(context, "user: hello");
  assert.equal(
    summarySentence("Fixing\nlabels"),
    "Fixing labels.",
  );
  assert.equal(
    summarySentence("Actively working on fixing labels"),
    "Fixing labels.",
  );
  assert.equal(
    summarySentence("Actively working on the map tooltip"),
    "Working on the map tooltip.",
  );
  assert.throws(() => summarySentence("x".repeat(241)));
  assert.throws(() => summarySentence(""));
});
