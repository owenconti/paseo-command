import type { Agent, Project, Workspace } from "./types";
import { sameHost } from "./types";

// Escaped so the encoding is injective: `a@b` on no host ≠ `a` on host `b`.
const esc = (s: string) =>
  s.includes("%") || s.includes("@")
    ? s.replace(/%/g, "%25").replace(/@/g, "%40")
    : s;
const qualify = (id: string, host?: string) =>
  host ? `${esc(id)}@${esc(host)}` : esc(id);
/** Project IDs are unique per host; this is unique across hosts. */
export const projectKey = (p: { projectId: string; host?: string }) =>
  qualify(p.projectId, p.host);
/** Workspace IDs are unique per host; this is unique across hosts. */
export const workspaceKey = (w: { workspaceId: string; host?: string }) =>
  qualify(w.workspaceId, w.host);

const byId = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);

/**
 * Workspaces to list: the registered ones (in the daemon's order), then a
 * synthetic one for each live agent's project checkout that isn't registered,
 * ordered by host and path so the agent list's order never matters.
 */
export function withLocalWorkspaces(
  projects: Project[],
  workspaces: Workspace[],
  live: Agent[],
): Workspace[] {
  const extra = new Map<string, Workspace>();
  const registered = new Set(
    workspaces.map((w) => `${w.host ?? ""}\u0000${w.cwd}`),
  );
  for (const a of [...live].sort((x, y) => byId(x.id, y.id))) {
    const cwd = a.cwd;
    const id = `local_${a.host || ""}${cwd}`;
    if (extra.has(id) || registered.has(`${a.host ?? ""}\u0000${cwd}`))
      continue;
    const p = projects.find(
      (p) =>
        sameHost(p, a) &&
        (p.projectId === a.projectId ||
          cwd === p.path ||
          cwd.startsWith(p.path + "/")),
    );
    if (p)
      extra.set(id, {
        workspaceId: id,
        projectId: p.projectId,
        project: p.name,
        name: cwd.split("/").pop() || "Local checkout",
        branch: a.branch || "",
        isolation: cwd === p.path ? "local" : "worktree",
        cwd,
        background: false,
        host: a.host,
        hostLabel: a.hostLabel,
      });
  }
  const sorted = [...extra.values()].sort(
    (x, y) => byId(x.host || "", y.host || "") || byId(x.cwd, y.cwd),
  );
  return [...workspaces, ...sorted];
}
