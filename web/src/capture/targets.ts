/**
 * Who a screen capture can go to (the macOS app's send panel, `CapturePanel.tsx`; pure: `targets.test.ts`): every
 * agent that isn't archived or a subagent, the most recently active first (your last message, else its own last
 * update); then a new agent in each workspace (its agents' latest activity first, else the newest); then a new
 * agent in a new workspace (a worktree) of each project. The search narrows them all by every word typed, in the
 * name, project, workspace, branch or host.
 */
import type { Agent, Project, Workspace } from "../types";

export type CaptureTarget =
  | {
      kind: "agent";
      key: string;
      agent: Agent;
      title: string;
      /** Where it is: project · workspace, and the host when it isn't this Mac. */
      place: string;
      running: boolean;
      active: number;
    }
  | {
      kind: "workspace";
      key: string;
      workspace: Workspace;
      title: string;
      place: string;
      active: number;
    }
  | {
      kind: "project";
      key: string;
      project: Project;
      title: string;
      place: string;
    };

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function captureTargets(agents: Agent[], projects: Project[], workspaces: Workspace[]): CaptureTarget[] {
  const projectName = new Map(projects.map((p) => [`${p.host ?? ""}|${p.projectId}`, p.name]));
  const workspaceOf = new Map(workspaces.map((w) => [`${w.host ?? ""}|${w.workspaceId}`, w]));
  const agentRows: CaptureTarget[] = agents
    .filter((a) => !a.archived && !a.child)
    .map((a) => {
      const h = a.host ?? "";
      const project = a.projectId ? projectName.get(`${h}|${a.projectId}`) : undefined;
      const ws = a.workspaceId ? workspaceOf.get(`${h}|${a.workspaceId}`) : undefined;
      const title = (a.title || a.name || a.shortId || "Agent").trim();
      const wsName = ws?.name && ws.name !== title && ws.name !== project ? ws.name : undefined;
      const place = [project, wsName, a.host ? a.hostLabel || a.host : undefined].filter(Boolean).join(" · ");
      return {
        kind: "agent" as const,
        key: `agent:${a.id}`,
        agent: a,
        title,
        place,
        running: a.status === "running",
        active: Math.max(time(a.lastUserMessageAt), time(a.updatedAt), time(a.createdAt ?? a.created)),
      };
    })
    .sort((x, y) => (y.kind === "agent" && x.kind === "agent" ? y.active - x.active : 0));
  // A workspace's last activity: its agents' latest, else when it was made.
  const lastIn = new Map<string, number>();
  for (const row of agentRows)
    if (row.kind === "agent" && row.agent.workspaceId) {
      const k = `${row.agent.host ?? ""}|${row.agent.workspaceId}`;
      lastIn.set(k, Math.max(lastIn.get(k) ?? 0, row.active));
    }
  const workspaceRows: CaptureTarget[] = workspaces
    .filter((w) => !w.stale)
    .map((w) => {
      const k = `${w.host ?? ""}|${w.workspaceId}`;
      const project = (w.projectId ? projectName.get(`${w.host ?? ""}|${w.projectId}`) : undefined) ?? w.project;
      const branch = w.branch && w.branch !== w.name ? w.branch : undefined;
      return {
        kind: "workspace" as const,
        key: `workspace:${k}`,
        workspace: w,
        title: w.name || w.branch || "Workspace",
        place: [project !== w.name ? project : undefined, branch, w.host ? w.hostLabel || w.host : undefined].filter(Boolean).join(" · "),
        active: lastIn.get(k) ?? time(w.createdAt),
      };
    })
    .sort((x, y) => y.active - x.active);
  const projectRows: CaptureTarget[] = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      kind: "project" as const,
      key: `project:${p.host ?? ""}|${p.projectId}`,
      project: p,
      title: p.name,
      place: p.host ? p.hostLabel || p.host : "",
    }));
  return [...agentRows, ...workspaceRows, ...projectRows];
}

function haystack(t: CaptureTarget) {
  if (t.kind === "agent") return [t.title, t.place, t.agent.branch, t.agent.provider].join(" ").toLowerCase();
  if (t.kind === "workspace") return ["workspace", t.title, t.place, t.workspace.branch, t.workspace.project].join(" ").toLowerCase();
  return ["new workspace", t.title, t.place, t.project.path].join(" ").toLowerCase();
}

export function filterTargets(targets: CaptureTarget[], query: string): CaptureTarget[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return targets;
  return targets.filter((t) => {
    const text = haystack(t);
    return words.every((w) => text.includes(w));
  });
}

/** A workspace in the panel's first list: its agents and a new agent there (`newAgent`; none for agents without a
 * workspace the fleet lists, "Other sessions"). */
export type CaptureGroup = {
  key: string;
  title: string;
  place: string;
  agents: Extract<CaptureTarget, { kind: "agent" }>[];
  newAgent?: Extract<CaptureTarget, { kind: "workspace" }>;
  running: number;
  active: number;
};

/**
 * The targets as the panel lists them: workspaces, the most recently active first (their agents' latest, else when
 * made), each holding its agents (most recent first) and a new agent there; agents in no listed workspace in "Other
 * sessions" last; then a new workspace in each project.
 */
export function groupTargets(targets: CaptureTarget[]): { groups: CaptureGroup[]; projects: Extract<CaptureTarget, { kind: "project" }>[] } {
  const byKey = new Map<string, CaptureGroup>();
  const order: CaptureGroup[] = [];
  for (const t of targets)
    if (t.kind === "workspace") {
      const g: CaptureGroup = { key: t.key, title: t.title, place: t.place, agents: [], newAgent: t, running: 0, active: t.active };
      byKey.set(`${t.workspace.host ?? ""}|${t.workspace.workspaceId}`, g);
      order.push(g);
    }
  let other: CaptureGroup | undefined;
  for (const t of targets) {
    if (t.kind !== "agent") continue;
    const g =
      (t.agent.workspaceId && byKey.get(`${t.agent.host ?? ""}|${t.agent.workspaceId}`)) ||
      (other ??= { key: "workspace:other", title: "Other sessions", place: "Not in a workspace", agents: [], running: 0, active: 0 });
    g.agents.push(t);
    if (t.running) g.running++;
    g.active = Math.max(g.active, t.active);
  }
  const groups = order.sort((a, b) => b.active - a.active);
  if (other) groups.push(other);
  return { groups, projects: targets.filter((t): t is Extract<CaptureTarget, { kind: "project" }> => t.kind === "project") };
}

/** The workspaces the search finds: by the workspace's own words or any of its agents'. */
export function filterGroups(groups: CaptureGroup[], query: string): CaptureGroup[] {
  if (!query.trim()) return groups;
  return groups.filter((g) => (g.newAgent && filterTargets([g.newAgent], query).length) || filterTargets(g.agents, query).length);
}
