/**
 * The crew list's order as it shows (CrewSide.tsx: its groups and sort, folded groups left out), as agent ids, while
 * it shows; null otherwise. J/K, ↑/↓ and ‹ › in main walk it then, so the next agent is the card below (the user's
 * ask: they walked the map's roster, which the list's sort by last prompt doesn't follow).
 */
import { useSyncExternalStore } from "react";

let order: string[] | null = null;
const listeners = new Set<() => void>();

export function setSideOrder(ids: string[] | null) {
  if (ids === order || (ids && order && ids.length === order.length && ids.every((id, i) => id === order![i]))) return;
  order = ids;
  for (const l of listeners) l();
}

export const sideOrderNow = () => order;

export function useSideOrder() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => order,
    () => null,
  );
}

/** The agents in the list's order (those it names), else (none of them known) the roster as it is. */
export function inSideOrder<T extends { id: string }>(roster: T[], ids: string[] | null): T[] {
  if (!ids?.length) return roster;
  const byId = new Map(roster.map((a) => [a.id, a]));
  const shown = ids.flatMap((id) => byId.get(id) ?? []);
  return shown.length ? shown : roster;
}
