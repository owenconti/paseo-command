import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUTO_TITLE,
  copiedPromptTitle,
  createAutomaticNames,
  taskTitle,
  workspaceIssue,
} from "./automaticNames";
import { SUMMARY_LABEL } from "./workingOn";
import type { DaemonClient } from "./api/hosts";
import type { AgentRecord, WorkspaceRecord } from "./live/client";

const opening =
  "We need to fix redirects and preview lifecycle in the backend, with regression coverage.";
function fixture() {
  let now = 100000;
  const agent: AgentRecord = {
    id: "agent",
    title: opening,
    status: "idle",
    provider: "codex",
    cwd: "/fake/work",
    workspaceId: "ws",
  };
  const workspace: WorkspaceRecord = {
    id: "ws",
    title: null,
    name: "random-woods",
    workspaceKind: "worktree",
    gitRuntime: { currentBranch: "fix-preview" } as never,
  };
  const saved: Record<string, { issue: string; title: string }> = {};
  const writes: unknown[] = [];
  let onGenerate = () => {};
  let onIssue = () => {};
  const client = {
    async fetchWorkspaces() {
      return { entries: [{ ...workspace }] };
    },
    async setWorkspaceTitle(id: string, title: string) {
      writes.push({ workspace: id, title });
      workspace.title = title;
      return { title };
    },
    async fetchAgentTimeline() {
      return {
        entries: [
          {
            seqStart: 1,
            seqEnd: 1,
            item: { type: "user_message", text: opening },
          },
        ],
      };
    },
    async fetchAgent() {
      return { agent: { ...agent } };
    },
    async updateAgent(id: string, update: any) {
      writes.push({ agent: id, ...update });
      agent.title = update.name;
      agent.labels = { ...agent.labels, ...update.labels };
    },
    async getDaemonConfig() {
      return {
        config: {
          metadataGeneration: {
            providers: [{ provider: "codex", model: "metadata" }],
          },
        },
      };
    },
    async getProvidersSnapshot() {
      return { entries: [] };
    },
    async createAgent(options: any) {
      writes.push({ helper: options });
      onGenerate();
      return { id: "helper" };
    },
    async waitForFinish() {
      return {
        status: "idle",
        lastMessage: "Fix redirects and preview lifecycle",
      };
    },
    async archiveAgent(id: string) {
      writes.push({ archived: id });
    },
  } as unknown as DaemonClient;
  const service = () =>
    createAutomaticNames({
      now: () => now,
      read: () => saved,
      save: (key, value) => {
        saved[key] = value;
      },
      issue: async (key) => {
        onIssue();
        return {
          available: true,
          issue: {
            key,
            title: "Fix preview redirects",
            state: "Started",
            url: "https://linear.app/fake/issue/DE-123",
          },
        };
      },
    });
  const observe = (s = service(), host = "local") =>
    s.observe(host, client, [{ agent: { ...agent } }], [{ ...workspace }]);
  return {
    agent,
    workspace,
    writes,
    saved,
    client,
    service,
    observe,
    advance: (ms = 300001) => {
      now += ms;
    },
    generating: (fn: () => void) => {
      onGenerate = fn;
    },
    lookingUp: (fn: () => void) => {
      onIssue = fn;
    },
  };
}

test("generates and persists a stable task title through the metadata helper, renaming an unnamed sole-agent worktree too", async () => {
  const f = fixture(),
    s = f.service();
  await Promise.all([f.observe(s), f.observe(s)]);
  assert.equal(f.agent.title, "Fix redirects and preview lifecycle");
  assert.equal(f.agent.labels?.[AUTO_TITLE], f.agent.title);
  assert.equal(f.workspace.title, f.agent.title);
  const helper = (f.writes.find((w: any) => w.helper) as any).helper;
  assert.equal(helper.workspaceId, "ws");
  assert.equal(helper.config.model, "metadata");
  assert.equal(helper.labels[SUMMARY_LABEL], "true");
  assert.match(helper.initialPrompt, /stable 3–8 word task title/);
  assert.ok(f.writes.some((w: any) => w.archived === "helper"));
  f.advance();
  await f.observe(f.service()); // A new process recognises the persisted title label.
  assert.equal(f.writes.filter((w: any) => w.helper).length, 1);
});

test("a verified branch issue renames an existing workspace; the agent title retains its issue key", async () => {
  const f = fixture();
  f.workspace.title = "random-woods";
  f.workspace.gitRuntime = { currentBranch: "owen/de-123-preview" } as never;
  f.agent.title = `DE-123 ${opening}`;
  f.client.fetchAgentTimeline = (async () => ({
    entries: [
      {
        seqStart: 1,
        seqEnd: 1,
        item: { type: "user_message", text: f.agent.title },
      },
    ],
  })) as never;
  await f.observe();
  assert.equal(f.workspace.title, "DE-123 · Fix preview redirects");
  assert.equal(f.agent.title, "DE-123 · Fix redirects and preview lifecycle");
  assert.equal(f.writes.filter((w: any) => w.workspace).length, 1);
});

test("workspace assignment persists and respects a later custom name, including after restart", async () => {
  const f = fixture();
  f.agent.title = "Custom agent title";
  f.workspace.gitRuntime = { currentBranch: "de-123-preview" } as never;
  await f.observe();
  f.workspace.title = "My custom workspace name";
  f.advance();
  await f.observe(f.service());
  assert.equal(f.workspace.title, "My custom workspace name");
  assert.equal(f.writes.filter((w: any) => w.workspace).length, 1);
});

test("a rename or branch change while Linear answers prevents the automatic write", async () => {
  for (const change of ["title", "branch"]) {
    const f = fixture();
    f.agent.title = "Custom title";
    f.workspace.gitRuntime = { currentBranch: "de-123-preview" } as never;
    f.lookingUp(() => {
      if (change === "title") f.workspace.title = "Just renamed";
      else f.workspace.gitRuntime = { currentBranch: "de-456-other" } as never;
    });
    await f.observe();
    assert.equal(f.writes.length, 0);
  }
});

test("a custom agent name set while its helper runs wins", async () => {
  const f = fixture();
  f.generating(() => {
    f.agent.title = "User renamed this";
  });
  await f.observe();
  assert.equal(f.agent.title, "User renamed this");
  assert.equal(f.writes.filter((w: any) => w.agent || w.workspace).length, 0);
});

test("manual names, helpers, child agents and reply forks are never renamed", async () => {
  for (const override of [
    { title: "Backend redirects" },
    { archivedAt: "2026-01-01" },
    { internal: true },
    { labels: { [SUMMARY_LABEL]: "true" } },
    { labels: { "paseo.parent-agent-id": "parent" } },
    { labels: { "paseo-command-fork": "fork" } },
  ]) {
    const f = fixture();
    Object.assign(f.agent, override);
    await f.observe();
    assert.equal(f.writes.length, 0, JSON.stringify(override));
  }
});

test("association uses branch then PR, and only unambiguous worktree agent issue titles", () => {
  const w = { id: "ws", workspaceKind: "worktree" } as WorkspaceRecord;
  const agents = [
    { id: "a", workspaceId: "ws", title: "DE-123 Fix it" },
    { id: "b", workspaceId: "ws", title: "DE-456 Another task" },
  ] as AgentRecord[];
  assert.equal(workspaceIssue(w, agents), null);
  assert.equal(workspaceIssue(w, agents.slice(0, 1)), "DE-123");
  assert.equal(
    workspaceIssue({ ...w, workspaceKind: "directory" }, agents.slice(0, 1)),
    null,
  );
  assert.equal(
    workspaceIssue(
      { ...w, gitRuntime: { currentBranch: "de-789-fix" } as never },
      agents,
    ),
    "DE-789",
  );
});

test("title recognition and output validation reject custom names and oversized replies", () => {
  assert.equal(
    copiedPromptTitle(opening.slice(0, 45) + "…", opening, "agent"),
    true,
  );
  assert.equal(copiedPromptTitle("My chosen title", opening, "agent"), false);
  assert.equal(
    taskTitle('{"title":"Fix preview redirects"}'),
    "Fix preview redirects",
  );
  assert.throws(() => taskTitle("x".repeat(81)));
  assert.throws(() => taskTitle("<title>Fix it</title>"));
});

test("an agent created before its first message is named on the next pass", async () => {
  const f = fixture(),
    s = f.service();
  const timeline = f.client.fetchAgentTimeline;
  f.client.fetchAgentTimeline = (async () => ({ entries: [] })) as never;
  await f.observe(s);
  assert.equal(f.writes.length, 0);
  f.client.fetchAgentTimeline = timeline;
  f.advance(15001);
  await f.observe(s);
  assert.equal(f.agent.title, "Fix redirects and preview lifecycle");
});

test("equal agent and workspace IDs on different hosts are named independently", async () => {
  const first = fixture(),
    second = fixture(),
    service = first.service();
  await Promise.all([
    first.observe(service, "host-a"),
    second.observe(service, "host-b"),
  ]);
  assert.equal(first.agent.title, "Fix redirects and preview lifecycle");
  assert.equal(second.agent.title, "Fix redirects and preview lifecycle");
  assert.deepEqual(Object.keys(first.saved).sort(), [
    '["host-a","ws"]',
    '["host-b","ws"]',
  ]);
});
