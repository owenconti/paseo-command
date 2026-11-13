/** The Crew map's roster: the fleet as a chat app's sidebar. Agents that need you are pinned first, most urgent first;
 * then every host's projects, each project's workspaces and each workspace's agents, oldest first (by creation, then
 * key: never by changing titles, so rows don't swap as the map's places don't). Projects without workspaces and hosts
 * without either are left out, as on the map; agents without a workspace sit with their project (or host). Pure. */
import { STATE_PRIORITY, type AtlasData, type State } from "../../../rendering/src/world";

export type RosterAgent = AtlasData["agents"][number];
export type RosterWorkspace = AtlasData["workspaces"][number] & { agents: RosterAgent[] };
export type RosterProject = { key: string; name: string; stale?: boolean; workspaces: RosterWorkspace[]; loose: RosterAgent[] };
export type RosterHost = { key: string; name: string; online: boolean; projects: RosterProject[]; loose: RosterAgent[] };
export type Roster = {
  /** Agents that need you (failed, approval, question, a reply waiting on you), most urgent first. */
  needYou: RosterAgent[];
  hosts: RosterHost[];
  /** Every agent, as the roster lists them below Needs you. */
  agents: RosterAgent[];
  /** How many agents are in each state. */
  counts: Partial<Record<State, number>>;
};

/** The states that pin an agent under Needs you. */
export const NEEDS_YOU: readonly State[] = ["failed", "approval", "question", "asking"];

const byAge = <T extends { key: string; created?: string }>(a: T, b: T) =>
  (a.created ?? "").localeCompare(b.created ?? "") || a.key.localeCompare(b.key);
const byName = <T extends { key: string; name: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key);
const urgency = (s: State) => STATE_PRIORITY.indexOf(s);

/** `filter`, when given, keeps agents whose name, workspace, project or host contains it (case-insensitive), and
 * workspaces whose name does (with all their agents). */
export function buildRoster(data: AtlasData, filter = ""): Roster {
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
  }).filter((h) => h.projects.length || h.loose.length);

  const needYou = agents
    .filter((a) => NEEDS_YOU.includes(a.state))
    .sort((a, b) => urgency(a.state) - urgency(b.state) || byAge(a, b));
  // Below Needs you, in the roster's own order (host, project, workspace, age).
  const listed = hosts.flatMap((h) => [
    ...h.projects.flatMap((p) => [...p.workspaces.flatMap((w) => w.agents), ...p.loose]),
    ...h.loose,
  ]);
  return { needYou, hosts, agents: listed, counts };
}

/** The overview's sections when nothing is open: every agent by state, the urgent first. */
export const OVERVIEW_SECTIONS: { id: string; title: string; states: State[] }[] = [
  { id: "need", title: "Needs you", states: ["failed", "approval", "question", "asking"] },
  { id: "done", title: "Replied", states: ["done"] },
  { id: "running", title: "Working", states: ["running"] },
  { id: "idle", title: "Idle", states: ["idle"] },
  { id: "offline", title: "Offline", states: ["offline"] },
];

export function overview(data: AtlasData) {
  const sorted = [...data.agents].sort((a, b) => urgency(a.state) - urgency(b.state) || byAge(a, b));
  return OVERVIEW_SECTIONS.map((s) => ({ ...s, agents: sorted.filter((a) => s.states.includes(a.state)) })).filter((s) => s.agents.length);
}
