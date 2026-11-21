/** The crew list beside the Command tab's conversation (CrewSide.tsx): shown or hidden (⌘S, ⌘K), how it groups and sorts
 *  its agents (its Display menu, ⌘K), and its width, kept in localStorage and shared across the page. */
import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "../api";

const HIDDEN = "crew:sideHidden";
const WIDTH = "crew:sideWidth";
const GROUP = "crew:sideGroup";
const SORT = "crew:sideSort";
export const SIDE = { width: 300, min: 240, max: 480 };

/** By project (across hosts, by name: the default), by state (those needing you first), by host, or not at all. */
export type SideGroup = "project" | "status" | "host" | "none";
/** Your most recent message first (the default), or as the map has them (oldest first). */
export type SideSort = "recent" | "created";
export const SIDE_GROUPS: { value: SideGroup; label: string }[] = [
  { value: "project", label: "Project" },
  { value: "status", label: "Status" },
  { value: "host", label: "Host" },
  { value: "none", label: "None" },
];
export const SIDE_SORTS: { value: SideSort; label: string }[] = [
  { value: "recent", label: "Last prompt" },
  { value: "created", label: "Created" },
];

type State = { hidden: boolean; group: SideGroup; sort: SideSort };
const pick = <T extends string>(v: unknown, of: { value: T }[], fallback: T): T => (of.some((o) => o.value === v) ? (v as T) : fallback);
let state: State = {
  hidden: readStore<boolean>(HIDDEN, false) === true,
  group: pick(readStore<unknown>(GROUP, "project"), SIDE_GROUPS, "project"),
  sort: pick(readStore<unknown>(SORT, "recent"), SIDE_SORTS, "recent"),
};
const listeners = new Set<() => void>();
function set(next: Partial<State>): void {
  state = { ...state, ...next };
  if ("hidden" in next) writeStore(HIDDEN, state.hidden);
  if ("group" in next) writeStore(GROUP, state.group);
  if ("sort" in next) writeStore(SORT, state.sort);
  listeners.forEach((l) => l());
}

export const crewSideHidden = () => state.hidden;
export const setCrewSideHidden = (hidden: boolean) => hidden !== state.hidden && set({ hidden });
export const toggleCrewSide = () => set({ hidden: !state.hidden });
export const setCrewSideGroup = (group: SideGroup) => set({ group });
export const setCrewSideSort = (sort: SideSort) => set({ sort });

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export function useCrewSide(): State {
  return useSyncExternalStore(subscribe, () => state);
}
export const useCrewSideHidden = () => useCrewSide().hidden;

/** Its width once resized (clamped), else the default. */
export function readCrewSideWidth(): number {
  const w = readStore<number | null>(WIDTH, null);
  return typeof w === "number" && Number.isFinite(w) ? Math.max(SIDE.min, Math.min(SIDE.max, w)) : SIDE.width;
}
export function writeCrewSideWidth(w: number | null): number {
  const next = w === null ? SIDE.width : Math.round(Math.max(SIDE.min, Math.min(SIDE.max, w)));
  writeStore(WIDTH, w === null ? null : next);
  return next;
}
