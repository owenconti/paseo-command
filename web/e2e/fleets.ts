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
};
export type PermissionRow = {
  id: string;
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
