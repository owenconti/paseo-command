/**
 * Who a screen capture can go to (the macOS app's send panel, `CapturePanel.tsx`; pure: `targets.test.ts`): every
 * agent that isn't archived or a subagent, the most recently active first (your last message, else its own last
 * update), then each project as "New agent in …". The search narrows both by every word typed, in the agent's
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
  const projectRows: CaptureTarget[] = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      kind: "project" as const,
      key: `project:${p.host ?? ""}|${p.projectId}`,
      project: p,
      title: `New agent in ${p.name}`,
      place: p.host ? p.hostLabel || p.host : "",
    }));
  return [...agentRows, ...projectRows];
}

function haystack(t: CaptureTarget) {
  if (t.kind === "agent") return [t.title, t.place, t.agent.branch, t.agent.provider].join(" ").toLowerCase();
  return [t.title, t.place, t.project.path].join(" ").toLowerCase();
}

export function filterTargets(targets: CaptureTarget[], query: string): CaptureTarget[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return targets;
  return targets.filter((t) => {
    const text = haystack(t);
    return words.every((w) => text.includes(w));
  });
}
