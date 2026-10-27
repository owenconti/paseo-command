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
  })),
  agents: rows.map((r, i) => ({
    key: `agent-${i + 1}`,
    host: r.host,
    project: `${r.host}/${r.project}`,
    workspace: `workspace-${i + 1}`,
    name: r.name,
    model: r.model,
    state: r.state,
  })),
};
