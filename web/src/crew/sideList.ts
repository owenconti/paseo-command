/** The crew list's groups (CrewSide.tsx), pure: its agents grouped by project (across hosts, by name), status, host or
 *  not at all, and sorted by recent activity or as created. */
import type { State } from "../model/fleet";
import type { SideGroup, SideSort } from "./sideStore";

export type SideItem = {
  key: string;
  state: State;
  /** When it was created, you last sent it a message, and it was last active (ISO), when known. */
  created?: string;
  prompted?: string;
  active?: string;
  project?: { key: string; name: string };
  host: { key: string; name: string; local: boolean };
  /** The map's order: its place among the agents (host, project, workspace, age). */
  order: number;
};
export type SideGroupOf<T> = { key: string; label: string; items: T[] };

/** The states the Status grouping gathers, in its order: those needing you first. */
export const STATUS_GROUPS: { key: string; label: string; states: State[] }[] = [
  { key: "status:needs", label: "Needs you", states: ["failed", "approval", "question", "asking"] },
  { key: "status:done", label: "Replied", states: ["done"] },
  { key: "status:running", label: "Working", states: ["running"] },
  { key: "status:idle", label: "Idle", states: ["idle"] },
  { key: "status:offline", label: "Offline", states: ["offline"] },
];

const time = (iso?: string) => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : 0;
};
export function sortItems<T extends SideItem>(items: T[], sort: SideSort): T[] {
  return [...items].sort((a, b) =>
    // By your last message (Paseo's "Last prompt"), not the last activity, so working agents don't reshuffle the list.
    sort === "recent" ? time(b.prompted ?? b.created) - time(a.prompted ?? a.created) || a.order - b.order : a.order - b.order,
  );
}

/** The groups, each sorted; a group's place is its first item's in the map's order (status: needing you first). */
export function groupItems<T extends SideItem>(items: T[], group: SideGroup, sort: SideSort): SideGroupOf<T>[] {
  if (group === "none") return [{ key: "all", label: "", items: sortItems(items, sort) }];
  if (group === "status")
    return STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, items: sortItems(items.filter((i) => g.states.includes(i.state)), sort) })).filter(
      (g) => g.items.length,
    );
  const groups = new Map<string, SideGroupOf<T> & { first: number }>();
  for (const item of items) {
    const [key, label] =
      group === "host"
        ? [`host:${item.host.key}`, item.host.name]
        : item.project
          ? [`project:${item.project.name.toLowerCase()}`, item.project.name]
          : ["project:", "Without a project"];
    const g = groups.get(key) ?? { key, label, items: [], first: item.order };
    g.items.push(item);
    g.first = Math.min(g.first, item.order);
    groups.set(key, g);
  }
  // Projects by name (as the map has them within a host); hosts in the map's (the user's) order.
  const list = [...groups.values()].sort((a, b) =>
    group === "project" ? (a.key === "project:" ? 1 : b.key === "project:" ? -1 : a.label.localeCompare(b.label, undefined, { sensitivity: "base" })) : a.first - b.first,
  );
  return list.map(({ key, label, items }) => ({ key, label, items: sortItems(items, sort) }));
}
