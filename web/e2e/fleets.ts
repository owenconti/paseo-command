/**
 * Mock fleets shared by the Atlas e2e tests and `scripts/measure-world.mjs`.
 * Every id is deterministic, so a run reproduces exactly the same layout.
 * A `Fleet`'s fields are the same shapes `mockApi` (./harness) answers over
 * HTTP and the live socket: plain arrays, not the functions `mockApi` wraps
 * them in.
 */
import { agentRow } from "./harness";

export type HostRow = {
  serverId: string;
  label: string;
  status: string;
  local: boolean;
  state: string;
};
export type ProjectRow = {
  projectId: string;
  name: string;
  kind: string;
  path: string;
  host?: string;
};
export type WorkspaceRow = {
  workspaceId: string;
  projectId: string;
  project: string;
  name: string;
  isolation: string;
  cwd: string;
  branch: string;
  host?: string;
  /** A workspace's PR, set by tests at runtime; shape owned by the app. */
  pr?: unknown;
  labels?: string[];
  createdAt?: string;
};
export type AgentRow = {
  id: string;
  shortId: string;
  name: string;
  provider: string;
  status: string;
  cwd: string;
  created: string;
  workspaceId?: string;
  host?: string;
  stale?: boolean;
  unread?: boolean;
  subagents?: unknown[];
  createdAt?: string;
};
export type PermissionRow = {
  id: string;
  host?: string;
  agentId: string;
  name: string;
  description: string;
  kind?: string;
};
export type Fleet = {
  hosts: HostRow[];
  projects: ProjectRow[];
  workspaces: WorkspaceRow[];
  agents: AgentRow[];
  permissions: PermissionRow[];
};

// ---------------------------------------------------------------------------
// small: the fixture every Atlas e2e test exercises (unchanged from before
// it moved here).
// ---------------------------------------------------------------------------

export const MAC = "srv_macmini";
const smallHosts: HostRow[] = [
  { serverId: "srv_local", label: "Studio", status: "online", local: true, state: "online" },
  { serverId: MAC, label: "macmini", status: "offline", local: false, state: "offline" },
];
const smallProjects: ProjectRow[] = [
  { projectId: "prj_atlas", name: "atlas", kind: "git", path: "/work/atlas" },
  { projectId: "prj_api", name: "api", kind: "git", path: "/work/api" },
  { projectId: "prj_infra", name: "infra", kind: "git", path: "/srv/infra", host: MAC },
];
/** A workspace fixture row; also used by atlas.e2e.ts to add rows at test time. */
export const ws = (
  id: string,
  projectId: string,
  name: string,
  cwd: string,
  host?: string,
): WorkspaceRow => ({
  workspaceId: id,
  projectId,
  project: projectId.slice(4),
  name,
  isolation: "local",
  cwd,
  branch: "main",
  ...(host ? { host } : {}),
});
const smallWorkspaces: WorkspaceRow[] = [
  ws("wks_a", "prj_atlas", "Map polish", "/work/atlas/a"),
  ws("wks_b", "prj_atlas", "Labels", "/work/atlas/b"),
  ws("wks_c", "prj_api", "Schema", "/work/api/c"),
  ws("wks_d", "prj_infra", "Deploy", "/srv/infra/d", MAC),
];
const agent = (
  id: string,
  status: string,
  name: string,
  workspaceId: string,
  cwd: string,
  extra: Partial<AgentRow> = {},
): AgentRow => ({ ...agentRow(id, status, name), workspaceId, cwd, ...extra });
const smallAgents: AgentRow[] = [
  agent("a-running", "running", "Runner", "wks_a", "/work/atlas/a"),
  agent("a-idle", "idle", "Idler", "wks_a", "/work/atlas/a"),
  agent("a-done", "idle", "Finisher", "wks_b", "/work/atlas/b", { unread: true }),
  agent("a-approval", "idle", "Asker for leave", "wks_b", "/work/atlas/b"),
  agent("a-question", "idle", "Questioner", "wks_c", "/work/api/c", {
    provider: "codex/gpt-6.1-sol",
  }),
  agent("a-failed", "error", "Breaker", "wks_c", "/work/api/c"),
  agent("a-offline", "running", "Far away", "wks_d", "/srv/infra/d", {
    host: MAC,
    stale: true,
  }),
];
const smallPermissions: PermissionRow[] = [
  { id: "p1", agentId: "a-approval", name: "Bash", description: "rm -rf build" },
  {
    id: "p2",
    agentId: "a-question",
    name: "AskUserQuestion",
    description: "-",
    kind: "question",
  },
];
export const small: Fleet = {
  hosts: smallHosts,
  projects: smallProjects,
  workspaces: smallWorkspaces,
  agents: smallAgents,
  permissions: smallPermissions,
};

// ---------------------------------------------------------------------------
// large: a stress fleet for the measurement script. 8 hosts (one offline),
// 40 projects, 70 workspaces, 150 agents: ~40% running, 10% each of done,
// approval, question and failed, the rest idle; a handful run subagents
// (1-4); both Claude and Codex providers.
// ---------------------------------------------------------------------------

const HOST_COUNT = 8;
const PROJECT_COUNT = 40;
const WORKSPACE_COUNT = 70;
const AGENT_COUNT = 150;

function buildLarge(): Fleet {
  const hosts: HostRow[] = Array.from({ length: HOST_COUNT }, (_, i) => {
    const offline = i === HOST_COUNT - 1;
    const serverId = i === 0 ? "srv_local" : `srv_host${i}`;
    return {
      serverId,
      label: i === 0 ? "Studio" : `Host ${i}`,
      status: offline ? "offline" : "online",
      local: i === 0,
      state: offline ? "offline" : "online",
    };
  });
  const offlineHost = hosts[HOST_COUNT - 1]!.serverId;
  const localHost = hosts[0]!.serverId;
  const hostAt = (i: number) => hosts[i % HOST_COUNT]!.serverId;
  const isLocal = (host: string) => host === localHost;

  const projects: ProjectRow[] = Array.from({ length: PROJECT_COUNT }, (_, i) => {
    const host = hostAt(i);
    return {
      projectId: `prj_${i}`,
      name: `project-${i}`,
      kind: "git",
      path: `/work/project-${i}`,
      ...(isLocal(host) ? {} : { host }),
    };
  });

  // Every project gets at least one workspace; the rest round-robin.
  const perProject = Array<number>(PROJECT_COUNT).fill(1);
  for (let i = 0; i < WORKSPACE_COUNT - PROJECT_COUNT; i++) perProject[i % PROJECT_COUNT]!++;
  const workspaces: WorkspaceRow[] = [];
  projects.forEach((p, pi) => {
    const host = hostAt(pi);
    for (let k = 0; k < perProject[pi]!; k++) {
      const id = `wks_${workspaces.length}`;
      workspaces.push({
        workspaceId: id,
        projectId: p.projectId,
        project: p.name,
        name: `workspace-${workspaces.length}`,
        isolation: "local",
        cwd: `${p.path}/${id}`,
        branch: "main",
        ...(isLocal(host) ? {} : { host }),
      });
    }
  });

  // 60 running, 15 each of done/approval/question/failed, 30 idle (=150).
  const statusPlan = [
    ...Array(60).fill("running"),
    ...Array(15).fill("done"),
    ...Array(15).fill("approval"),
    ...Array(15).fill("question"),
    ...Array(15).fill("failed"),
    ...Array(30).fill("idle"),
  ];
  const agents: AgentRow[] = [];
  const permissions: PermissionRow[] = [];
  for (let i = 0; i < AGENT_COUNT; i++) {
    const w = workspaces[i % WORKSPACE_COUNT]!;
    const host = w.host;
    const plan = statusPlan[i]!;
    const status = plan === "failed" ? "error" : plan === "running" ? "running" : "idle";
    const id = `a-${i}`;
    const row: AgentRow = {
      ...agentRow(id, status, `Agent ${i}`),
      workspaceId: w.workspaceId,
      cwd: w.cwd,
      ...(host ? { host } : {}),
    };
    if (i % 5 === 0) row.provider = "codex/gpt-6.1-sol";
    if (plan === "done") row.unread = true;
    if (plan === "approval")
      permissions.push({ id: `perm-${i}`, agentId: id, name: "Bash", description: "rm -rf build" });
    if (plan === "question")
      permissions.push({
        id: `perm-${i}`,
        agentId: id,
        name: "AskUserQuestion",
        description: "-",
        kind: "question",
      });
    // A handful run subagents (1 to 4 of them).
    if (i % 35 === 5) {
      const count = (Math.floor(i / 35) % 4) + 1;
      row.subagents = Array.from({ length: count }, (_, k) => ({
        id: `${id}-sub-${k}`,
        name: `Subtask ${k + 1}`,
        kind: "general-purpose",
        status: "running",
        source: "provider",
      }));
    }
    // An offline host's last-known rows are stale, as a real daemon reports.
    if (host === offlineHost) row.stale = true;
    agents.push(row);
  }
  return { hosts, projects, workspaces, agents, permissions };
}

export const large: Fleet = buildLarge();

// ---------------------------------------------------------------------------
// dungeon: the Dungeon Board's concept fleet. Three hosts (LOCAL, STAGING,
// PROD), six projects, eleven workspaces and robots of several providers in
// every state the daemon reports; PR labels on a few workspaces.
// ---------------------------------------------------------------------------

const DUNGEON: [host: string, project: string, workspace: string, agents: [provider: string, plan: string, subagents?: string[]][], labels?: string[]][] = [
  ["srv_local", "core-platform", "api", [["claude/claude-opus-5-5", "running", ["claude/claude-haiku-5-5", "codex/gpt-6.1-sol"]], ["opencode/kimi-k3", "idle"], ["aider/qwen-4-coder", "running"]], ["CI running", "Awaiting review"]],
  ["srv_local", "core-platform", "web", [["codex/gpt-6.1-sol", "running"], ["deepseek/deepseek-v4", "approval"]], ["CI green", "Approved"]],
  ["srv_local", "developer-tools", "cli", [["opencode/kimi-k3", "done"]]],
  ["srv_staging", "growth", "marketing", [["amp/amp-smart", "idle"], ["claude/claude-sonnet-5", "running"]]],
  ["srv_staging", "growth", "analytics", [["claude/claude-opus-5-5", "question"], ["deepseek/deepseek-v4", "running"], ["bedrock/nova-pro", "idle"]], ["CI failing", "Changes requested"]],
  ["srv_staging", "experiments", "events", [["minimax/minimax-m3", "failed"]]],
  ["srv_staging", "experiments", "ab-tests", [["codex/gpt-6.1-sol", "running", ["codex/gpt-6.1-sol"]], ["aider/qwen-4-coder", "idle"], ["deepseek/deepseek-v4", "done"], ["amp/amp-smart", "running"]]],
  ["srv_prod", "customer", "app", [["opencode/kimi-k3", "running"], ["claude/claude-opus-5-5", "done"], ["aider/qwen-4-coder", "idle"]], ["CI running"]],
  ["srv_prod", "customer", "support", [["minimax/minimax-m3", "idle"], ["bedrock/nova-pro", "running"]]],
  ["srv_prod", "platform", "infra", [["claude/claude-opus-5-5", "approval"], ["codex/gpt-6.1-sol", "running"]], ["CI green", "Awaiting review"]],
  ["srv_prod", "platform", "data", [["opencode/kimi-k3", "running", ["opencode/kimi-k3", "claude/claude-haiku-5-5", "aider/qwen-4-coder"]], ["aider/qwen-4-coder", "idle"], ["deepseek/deepseek-v4", "running"], ["amp/amp-smart", "idle"]]],
];
function buildDungeon(): Fleet {
  const hosts: HostRow[] = [
    { serverId: "srv_local", label: "LOCAL", status: "online", local: true, state: "online" },
    { serverId: "srv_staging", label: "STAGING", status: "online", local: false, state: "online" },
    { serverId: "srv_prod", label: "PROD", status: "online", local: false, state: "online" },
  ];
  const remote = (host: string) => (host === "srv_local" ? {} : { host });
  const projects: ProjectRow[] = [];
  const workspaces: WorkspaceRow[] = [];
  const agents: AgentRow[] = [];
  const permissions: PermissionRow[] = [];
  DUNGEON.forEach(([host, project, name, rows, labels], w) => {
    const projectId = `prj_${project}`;
    if (!projects.some((p) => p.projectId === projectId))
      projects.push({ projectId, name: project, kind: "git", path: `/work/${project}`, ...remote(host) });
    const workspaceId = `wks_${name}`;
    const cwd = `/work/${project}/${name}`;
    workspaces.push({
      workspaceId, projectId, project, name, isolation: "worktree", cwd, branch: name,
      createdAt: `2026-11-0${1 + (w % 5)}T0${w % 10}:00:00Z`,
      ...(labels ? { labels } : {}),
      ...remote(host),
    });
    rows.forEach(([provider, plan, subs], i) => {
      const id = `a-${name}-${i}`;
      const status = plan === "failed" ? "error" : plan === "running" ? "running" : "idle";
      agents.push({
        ...agentRow(id, status, `${name} agent ${i + 1}`),
        provider,
        workspaceId,
        cwd,
        createdAt: `2026-11-06T${String(w).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`,
        ...(plan === "done" ? { unread: true } : {}),
        ...(subs
          ? { subagents: subs.map((model, k) => ({ id: `${id}-sub-${k}`, name: `Subtask ${k + 1}`, kind: "general-purpose", status: "running", source: "provider", model })) }
          : {}),
        ...remote(host),
      });
      if (plan === "approval") permissions.push({ id: `perm-${id}`, agentId: id, name: "Bash", description: "npm publish", ...remote(host) });
      if (plan === "question") permissions.push({ id: `perm-${id}`, agentId: id, name: "AskUserQuestion", description: "-", kind: "question", ...remote(host) });
    });
  });
  return { hosts, projects, workspaces, agents, permissions };
}
export const dungeon: Fleet = buildDungeon();
/** The dungeon fleet's host loads, for `GET /api/hoststats`. */
export const DUNGEON_STATS: Record<string, { cpu: number; memory: number; disk: number }> = {
  local: { cpu: 42, memory: 58, disk: 70 },
  srv_staging: { cpu: 37, memory: 64, disk: 55 },
  srv_prod: { cpu: 51, memory: 72, disk: 81 },
};

// ---------------------------------------------------------------------------
// village: the Village's concept fleet. One host, four projects, twelve
// workspaces across every PR tile (ready, in review, changes asked, failing,
// none) and six robots of several providers in varied states.
// ---------------------------------------------------------------------------

const VILLAGE: [project: string, workspace: string, agents: [provider: string, plan: string, subagents?: string[]][], labels?: string[]][] = [
  ["api-gateway", "auth", [["claude/claude-opus-5-5", "running", ["claude/claude-haiku-5-5", "codex/gpt-6.1-sol"]]], ["CI green", "Approved"]],
  ["api-gateway", "routing", [], ["CI running", "Awaiting review"]],
  ["api-gateway", "billing", [["deepseek/deepseek-v4", "question"]], ["CI green", "Changes requested"]],
  ["api-gateway", "search", [], ["CI failing"]],
  ["web-app", "dashboard", [["codex/gpt-6.1-sol", "running"]], ["CI running"]],
  ["web-app", "onboarding", [], ["Approved"]],
  ["web-app", "settings", []],
  ["workspaces", "core", [["opencode/kimi-k3", "idle"]]],
  ["workspaces", "data", []],
  ["workspaces", "export", [], ["Merge conflicts"]],
  ["workspaces", "infra", []],
  ["agents-lab", "experiments", [["claude/claude-sonnet-5", "approval"], ["codex/gpt-6.1-sol", "done"]], ["Awaiting review"]],
];
function buildVillage(): Fleet {
  const hosts: HostRow[] = [{ serverId: "srv_local", label: "Diagonal Ops", status: "online", local: true, state: "online" }];
  const projects: ProjectRow[] = [];
  const workspaces: WorkspaceRow[] = [];
  const agents: AgentRow[] = [];
  const permissions: PermissionRow[] = [];
  VILLAGE.forEach(([project, name, rows, labels], w) => {
    const projectId = `prj_${project}`;
    if (!projects.some((p) => p.projectId === projectId)) projects.push({ projectId, name: project, kind: "git", path: `/work/${project}` });
    const workspaceId = `wks_${name}`;
    const cwd = `/work/${project}/${name}`;
    workspaces.push({
      workspaceId, projectId, project, name, isolation: "worktree", cwd, branch: name,
      createdAt: `2026-11-0${1 + Math.floor(w / 6)}T${String(w).padStart(2, "0")}:00:00Z`,
      ...(labels ? { labels } : {}),
    });
    rows.forEach(([provider, plan, subs], i) => {
      const id = `a-${name}-${i}`;
      const status = plan === "failed" ? "error" : plan === "running" ? "running" : "idle";
      agents.push({
        ...agentRow(id, status, `${name} agent ${i + 1}`),
        provider,
        workspaceId,
        cwd,
        createdAt: `2026-11-06T${String(w).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`,
        ...(plan === "done" ? { unread: true } : {}),
        ...(subs
          ? { subagents: subs.map((model, k) => ({ id: `${id}-sub-${k}`, name: `Subtask ${k + 1}`, kind: "general-purpose", status: "running", source: "provider", model })) }
          : {}),
      });
      if (plan === "approval") permissions.push({ id: `perm-${id}`, agentId: id, name: "Bash", description: "npm publish" });
      if (plan === "question") permissions.push({ id: `perm-${id}`, agentId: id, name: "AskUserQuestion", description: "-", kind: "question" });
    });
  });
  return { hosts, projects, workspaces, agents, permissions };
}
export const village: Fleet = buildVillage();
/** The village fleet's host load, for `GET /api/hoststats` (its disk past 90%, in red). */
export const VILLAGE_STATS: Record<string, { cpu: number; memory: number; disk: number }> = {
  local: { cpu: 34, memory: 61, disk: 92 },
};
