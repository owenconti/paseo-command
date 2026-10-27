import { activeAgents } from "./activeAgents";
import { projectKey, workspaceKey } from "./workspaces";
import { sameHost, type Agent, type Project, type Workspace } from "./types";

/** Native placement belongs to Swift. The React work surface needs semantic
 * associations only, and must not build city streets or Three geometry. */
export function nativeAssociations(
  projects: Project[],
  workspaces: Workspace[],
  agents: Agent[],
) {
  const live = activeAgents(agents);
  const layout = {
    bases: new Map(),
    buildings: new Map(),
    units: new Map(),
    agentWorkspace: new Map(),
    projectWorkspaces: new Map(),
    workspaceProject: new Map(),
    campuses: new Map(),
    lots: new Map(),
    slots: new Map(),
    staging: new Map(),
    streets: new Map(),
    gates: new Map(),
    boroughs: new Map(),
  };
  const contains = (root: string, path: string) =>
    !!root && (path === root || path.startsWith(root.replace(/\/$/, "") + "/"));
  for (const workspace of workspaces) {
    const project = projects.find(
      (p) => sameHost(p, workspace) && p.name === workspace.project,
    );
    if (!project) continue;
    const key = projectKey(project);
    layout.workspaceProject.set(workspaceKey(workspace), key);
    layout.projectWorkspaces.set(key, [
      ...(layout.projectWorkspaces.get(key) ?? []),
      workspace,
    ]);
  }
  for (const agent of live) {
    const workspace =
      workspaces.find(
        (w) => sameHost(w, agent) && agent.workspaceId === w.workspaceId,
      ) ??
      workspaces
        .filter((w) => sameHost(w, agent) && contains(w.cwd, agent.cwd))
        .sort((a, b) => b.cwd.length - a.cwd.length)[0];
    if (workspace) {
      layout.agentWorkspace.set(agent.id, workspaceKey(workspace));
      continue;
    }
    const project =
      projects.find(
        (p) => sameHost(p, agent) && p.projectId === agent.projectId,
      ) ??
      projects
        .filter((p) => sameHost(p, agent) && contains(p.path, agent.cwd))
        .sort((a, b) => b.path.length - a.path.length)[0];
    if (project) {
      const key = projectKey(project);
      layout.agentWorkspace.set(agent.id, key);
      layout.staging.set(agent.id, {
        projectId: key,
        cell: layout.staging.size,
      });
    }
  }
  return { live, workspaces, layout };
}
