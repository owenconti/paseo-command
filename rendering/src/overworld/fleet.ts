// The live fleet (AtlasData, as the Islands map takes it) as the Overworld lays it out.
import { campKey, MODEL_COLORS, modelColor, type AtlasData } from "../world.ts";
import { hash, type OwAgent, type OwHost, type OwProject, type OwWorkspace, type Roof, type Theme } from "./layout.ts";

const THEMES: Theme[] = ["forest", "farm", "volcanic"];
const ROOFS: Roof[] = ["red", "purple", "blue", "green", "amber", "teal"];

/** A robot's sheet colour (Claude orange, ChatGPT/Codex pearl) or the tint for the neutral robot. */
export function robotColour(model: string): string {
  const m = modelColor(model);
  if (m === "orange") return "orange";
  if (m === "white") return "pearl";
  return `#${MODEL_COLORS[m].toString(16).padStart(6, "0")}`;
}

const byCreated = <T extends { created?: string; key: string }>(a: T, b: T) =>
  (a.created ?? "").localeCompare(b.created ?? "") || a.key.localeCompare(b.key);

/** Hosts with workspaces (or agents), their projects with workspaces, oldest first. As the Islands
 * map, projects and hosts without any are left out; a host theme is seeded from its key. */
export function overworldFleet(data: AtlasData): OwHost[] {
  const agentsOf = (where: (a: AtlasData["agents"][number]) => boolean): OwAgent[] =>
    data.agents
      .filter(where)
      .sort(byCreated)
      .map((a) => ({ id: a.key, colour: robotColour(a.model), working: a.state === "running" }));
  const hosts: OwHost[] = [];
  for (const host of data.hosts) {
    const workspaces = data.workspaces.filter((w) => w.host === host.key).sort(byCreated);
    const ws = (w: AtlasData["workspaces"][number]): OwWorkspace => ({
      id: w.key,
      name: w.name,
      agents: agentsOf((a) => a.host === host.key && a.workspace === w.key),
    });
    const known = new Set(workspaces.map((w) => w.key));
    const shown = new Set(data.projects.filter((p) => p.host === host.key && workspaces.some((w) => w.project === p.key)).map((p) => p.key));
    const homeless = (project: string) =>
      agentsOf((a) => a.host === host.key && !(a.workspace && known.has(a.workspace)) && (a.project && shown.has(a.project) ? a.project : "") === project);
    const camp = (project: string, agents: OwAgent[]): OwWorkspace => ({ id: campKey(host.key, project), name: "No workspace", agents, camp: true });
    const projects: OwProject[] = [];
    // With no names on the map, a hall's roof is its project's mark: seeded from its name, so the same
    // project has the same roof on every host, and the next free one where two halls on a host would match.
    const roofs = new Set<Roof>();
    for (const p of data.projects.filter((p) => shown.has(p.key))) {
      const h = hash(p.name || p.key);
      let roof = ROOFS[h % ROOFS.length]!;
      for (let k = 1; roofs.has(roof) && k < ROOFS.length; k++) roof = ROOFS[(h + k) % ROOFS.length]!;
      roofs.add(roof);
      const own = workspaces.filter((w) => w.project === p.key).map(ws);
      const waiting = homeless(p.key);
      if (waiting.length) own.push(camp(p.key, waiting));
      projects.push({ id: p.key, name: p.name, roof, workspaces: own });
    }
    const loose = workspaces.filter((w) => !w.project || !shown.has(w.project));
    const waiting = homeless("");
    if (loose.length || waiting.length) {
      const extra: OwWorkspace[] = loose.map(ws);
      if (waiting.length) extra.push(camp("", waiting));
      projects.push({ id: `${host.key}:loose`, name: "", roof: "red", hall: false, workspaces: extra });
    }
    if (!projects.length) continue;
    // Each host's scenery is seeded from it; a host never shares its neighbour's (the one drawn before it),
    // taking the first other one instead (forest before farm before volcanic, the busiest).
    const before = hosts[hosts.length - 1]?.theme;
    let theme = THEMES[hash(host.key) % THEMES.length]!;
    if (theme === before) theme = THEMES.find((t) => t !== before)!;
    hosts.push({
      id: host.key,
      name: host.name,
      theme,
      offline: !host.online,
      stats:
        host.stats && host.stats.cpu !== undefined && host.stats.memory !== undefined && host.stats.disk !== undefined
          ? { cpu: Math.round(host.stats.cpu), mem: Math.round(host.stats.memory), disk: Math.round(host.stats.disk) }
          : undefined,
      projects,
    });
  }
  return hosts;
}
