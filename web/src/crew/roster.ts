/** The Crew map's grouping: every host's projects (by name), each project's workspaces and each workspace's agents,
 * oldest first (by creation, then key: never by changing titles, so nodes don't swap as the map's places don't).
 * Projects without workspaces and hosts without either are left out (but for hosts kept by key: a claimed pool box's,
 * so it can be released); agents without a workspace sit with their project (or host). Pure. */
import { STATE_PRIORITY, type AtlasData, type State } from "../model/fleet";

export type RosterAgent = AtlasData["agents"][number];
export type RosterWorkspace = AtlasData["workspaces"][number] & { agents: RosterAgent[] };
export type RosterProject = { key: string; name: string; stale?: boolean; workspaces: RosterWorkspace[]; loose: RosterAgent[] };
export type RosterHost = { key: string; name: string; online: boolean; projects: RosterProject[]; loose: RosterAgent[] };
export type Roster = {
  hosts: RosterHost[];
  /** Every agent, in the map's order. */
  agents: RosterAgent[];
  /** How many agents are in each state. */
  counts: Partial<Record<State, number>>;
};

const byAge = <T extends { key: string; created?: string }>(a: T, b: T) =>
  (a.created ?? "").localeCompare(b.created ?? "") || a.key.localeCompare(b.key);
const byName = <T extends { key: string; name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key);

/** `filter`, when given, keeps agents whose name, workspace, project or host contains it (case-insensitive), and
 * workspaces whose name does (with all their agents). */
export function buildRoster(data: AtlasData, filter = "", keepHosts: ReadonlySet<string> = new Set()): Roster {
  const q = filter.trim().toLowerCase();
  const has = (text: string | undefined) => !q || (text ?? "").toLowerCase().includes(q);
  const projectsByKey = new Map(data.projects.map((p) => [p.key, p]));
  const workspacesByKey = new Map(data.workspaces.map((w) => [w.key, w]));
  const hostsByKey = new Map(data.hosts.map((h) => [h.key, h]));
  const keep = (a: RosterAgent) => {
    if (!q) return true;
    const w = a.workspace ? workspacesByKey.get(a.workspace) : undefined;
    const p = a.project ? projectsByKey.get(a.project) : undefined;
    return has(a.name) || has(w?.name) || has(p?.name) || has(hostsByKey.get(a.host)?.name);
  };
  const agents = data.agents.filter(keep).sort(byAge);
  const counts: Partial<Record<State, number>> = {};
  for (const a of data.agents) counts[a.state] = (counts[a.state] ?? 0) + 1;

  const hosts: RosterHost[] = data.hosts.map((h) => {
    const mine = agents.filter((a) => a.host === h.key);
    const projects = data.projects
      .filter((p) => p.host === h.key)
      .sort(byName)
      .map((p): RosterProject => {
        const workspaces = data.workspaces
          .filter((w) => w.host === h.key && w.project === p.key)
          .sort(byAge)
          .map((w) => ({ ...w, agents: mine.filter((a) => a.workspace === w.key) }))
          .filter((w) => w.agents.length || has(w.name));
        const loose = mine.filter((a) => a.project === p.key && (!a.workspace || !workspacesByKey.has(a.workspace)));
        return { key: p.key, name: p.name, stale: p.stale, workspaces, loose };
      })
      .filter((p) => p.workspaces.length || p.loose.length);
    const placed = new Set(projects.flatMap((p) => [...p.workspaces.flatMap((w) => w.agents), ...p.loose]).map((a) => a.key));
    const loose = mine.filter((a) => !placed.has(a.key));
    return { key: h.key, name: h.name, online: h.online, projects, loose };
  }).filter((h) => h.projects.length || h.loose.length || (!q && keepHosts.has(h.key)));

  // In the map's own order (host, project, workspace, age).
  const listed = hosts.flatMap((h) => [
    ...h.projects.flatMap((p) => [...p.workspaces.flatMap((w) => w.agents), ...p.loose]),
    ...h.loose,
  ]);
  return { hosts, agents: listed, counts };
}

/** How many of `agents` are in each state, most urgent first (`STATE_PRIORITY`), leaving out states none is in:
 * a folded host's or project's head shows them. */
export function stateTally(agents: readonly { state: State }[]): { state: State; count: number }[] {
  const counts = new Map<State, number>();
  for (const a of agents) counts.set(a.state, (counts.get(a.state) ?? 0) + 1);
  return STATE_PRIORITY.filter((s) => counts.has(s)).map((state) => ({ state, count: counts.get(state)! }));
}
/** A project's agents: its workspaces' and those outside one. */
export const projectAgents = (p: RosterProject) => [...p.workspaces.flatMap((w) => w.agents), ...p.loose];
/** A host's agents, in all its projects and outside them. */
export const hostAgents = (h: RosterHost) => [...h.projects.flatMap(projectAgents), ...h.loose];
