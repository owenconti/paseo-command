import type { AtlasData, State } from "./world";
/** Clearly illustrative fleet for the standalone rendering study. Never a daemon. */
const sample = (
  host: string,
  project: string,
  name: string,
  model: string,
  state: State,
) => ({ host, project, name, model, state });
const rows = [
  sample("local", "paseo-command", "Workspace navigation", "claude/claude-opus-5-5", "running"),
  sample("local", "paseo-command", "Conversation layout", "codex/gpt-6.1-sol", "idle"),
  sample("local", "paseo-command", "Atlas rendering", "codex/gpt-6-astra", "done"),
  sample("local", "diagonal-api", "API response types", "codex/gpt-6.1-sol", "running"),
  sample("local", "diagonal-api", "Schema update", "claude/claude-sonnet-5", "approval"),
  sample("local", "diagonal-api", "Integration checks", "codex/gpt-6-astra", "failed"),
  sample("local", "web", "Frontend components", "claude/claude-sonnet-5", "running"),
  sample("local", "web", "Accessibility review", "claude/claude-opus-5-5", "question"),
  sample("macmini", "infra", "Deployment pipeline", "codex/gpt-6-astra", "running"),
  sample("macmini", "infra", "Host configuration", "codex/gpt-6.1-sol", "idle"),
];
const SAMPLE_LABELS: Record<number, string[]> = {
  0: ["CI running", "Awaiting review"],
  3: ["CI green", "Approved"],
  5: ["CI failing", "Changes requested"],
  8: ["CI running"],
};
export const SAMPLE: AtlasData = {
  hosts: [
    { key: "local", name: "Local", online: true, local: true },
    { key: "macmini", name: "Macmini", online: true, local: false },
  ],
  projects: [...new Set(rows.map((r) => `${r.host}/${r.project}`))].map(
    (key) => ({
      key,
      host: key.split("/")[0]!,
      name: key.split("/")[1]!,
    }),
  ),
  workspaces: rows.map((r, i) => ({
    key: `workspace-${i + 1}`,
    host: r.host,
    project: `${r.host}/${r.project}`,
    name: r.name,
    // Illustrative PR labels, as the app's labeller sets them; they plant flags.
    ...(SAMPLE_LABELS[i] ? { labels: SAMPLE_LABELS[i] } : {}),
  })),
  agents: rows.map((r, i) => ({
    key: `agent-${i + 1}`,
    host: r.host,
    project: `${r.host}/${r.project}`,
    workspace: `workspace-${i + 1}`,
    name: r.name,
    model: r.model,
    state: r.state,
    // Running helpers on a couple of busy agents.
    subagents: i === 0 ? 3 : i === 3 ? 1 : 0,
  })),
};

/** Asset review fleet: enough neighbours to exercise every balanced artwork choice. */
export const STRUCTURE_SAMPLE: AtlasData = {
  hosts: [{ key: "local", name: "Structure review · illustrative", online: true, local: true }],
  projects: Array.from({ length: 8 }, (_, i) => ({
    key: `structure-${i}`, host: "local", name: `Structure ${i + 1}`,
  })),
  workspaces: Array.from({ length: 8 }, (_, i) =>
    Array.from({ length: i === 0 ? 7 : 1 }, (_, j) => ({
      key: `structure-${i}-workspace-${j}`, host: "local",
      project: `structure-${i}`, name: `Cottage ${j + 1}`,
    })),
  ).flat(),
  agents: [],
};

/** The Dungeon Board's concept fleet: three hosts, six projects, eleven
 * workspaces, robots of several providers across every state. Illustrative. */
const DUNGEON_ROWS: [host: string, project: string, workspace: string, agents: [model: string, state: State, subagents?: string[]][], labels?: string[]][] = [
  ["local", "core-platform", "api", [["claude/claude-opus-5-5", "running", ["claude/claude-haiku-5-5", "codex/gpt-6.1-sol"]], ["opencode/kimi-k3", "idle"], ["aider/qwen-4-coder", "running"]], ["CI running", "Awaiting review"]],
  ["local", "core-platform", "web", [["codex/gpt-6.1-sol", "running"], ["deepseek/deepseek-v4", "approval"]], ["CI green", "Approved"]],
  ["local", "developer-tools", "cli", [["opencode/kimi-k3", "done"]]],
  ["staging", "growth", "marketing", [["amp/amp-smart", "idle"], ["claude/claude-sonnet-5", "running"]]],
  ["staging", "growth", "analytics", [["claude/claude-opus-5-5", "question"], ["deepseek/deepseek-v4", "running"], ["bedrock/nova-pro", "idle"]], ["CI failing", "Changes requested"]],
  ["staging", "experiments", "events", [["minimax/minimax-m3", "failed"]]],
  ["staging", "experiments", "ab-tests", [["codex/gpt-6.1-sol", "running", ["codex/gpt-6.1-sol"]], ["aider/qwen-4-coder", "idle"], ["deepseek/deepseek-v4", "asking"], ["amp/amp-smart", "running"]]],
  ["prod", "customer", "app", [["opencode/kimi-k3", "running"], ["claude/claude-opus-5-5", "done"], ["aider/qwen-4-coder", "idle"]], ["CI running"]],
  ["prod", "customer", "support", [["minimax/minimax-m3", "idle"], ["bedrock/nova-pro", "running"]]],
  ["prod", "platform", "infra", [["claude/claude-opus-5-5", "approval"], ["codex/gpt-6.1-sol", "running"]], ["CI green", "Awaiting review"]],
  ["prod", "platform", "data", [["opencode/kimi-k3", "running", ["opencode/kimi-k3", "claude/claude-haiku-5-5", "aider/qwen-4-coder"]], ["aider/qwen-4-coder", "idle"], ["deepseek/deepseek-v4", "running"], ["amp/amp-smart", "idle"]]],
];
export const DUNGEON_SAMPLE: AtlasData = {
  hosts: [
    { key: "local", name: "LOCAL", online: true, local: true, stats: { cpu: 42, memory: 58, disk: 70 } },
    { key: "staging", name: "STAGING", online: true, local: false, stats: { cpu: 37, memory: 64, disk: 55 } },
    { key: "prod", name: "PROD", online: true, local: false, stats: { cpu: 51, memory: 72, disk: 81 } },
  ],
  projects: [...new Set(DUNGEON_ROWS.map(([h, p]) => `${h}/${p}`))].map((key) => ({ key, host: key.split("/")[0]!, name: key.split("/")[1]! })),
  workspaces: DUNGEON_ROWS.map(([host, project, name, , labels], i) => ({
    key: `${host}/${project}/${name}`,
    host,
    project: `${host}/${project}`,
    name,
    created: `2026-11-0${1 + (i % 5)}T0${i % 10}:00:00Z`,
    ...(labels ? { labels } : {}),
    ...(name === "web" ? { probe: { state: "approved" as const }, autoMerge: true } : {}),
    ...(name === "analytics" ? { probe: { state: "findings" as const, findings: 3 } } : {}),
  })),
  agents: DUNGEON_ROWS.flatMap(([host, project, name, agents], w) =>
    agents.map(([model, state, subs], i) => ({
      key: `${host}/${project}/${name}/${i}`,
      host,
      project: `${host}/${project}`,
      workspace: `${host}/${project}/${name}`,
      name: `${name} agent ${i + 1}`,
      model,
      state,
      created: `2026-11-06T${String(w).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`,
      ...(subs ? { subagents: subs.length, subagentModels: subs } : {}),
    })),
  ),
};
