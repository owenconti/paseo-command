/** The order of Crew's hosts, as the user arranges them (dragging a host's head, ⌥↑ / ⌥↓ on it, ⌘K), kept in
 *  localStorage (`crew:hostOrder`). Hosts it doesn't name keep their place after those it does, in the fleet's order.
 *  The map's hosts and J/K's stepping both follow it. */
import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "../api";

const KEY = "crew:hostOrder";

/** `hosts` in `order`'s order: the hosts it names first, as it has them, then the rest as they came. Pure. */
export function orderHosts<T extends { key: string }>(hosts: readonly T[], order: readonly string[]): T[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  return hosts
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (rank.get(a.h.key) ?? order.length + a.i) - (rank.get(b.h.key) ?? order.length + b.i))
    .map(({ h }) => h);
}

/** The order after moving `key` to `to` among `shown` (the hosts on the map, as they show now); hosts the order named
 *  that aren't shown keep their names in it, after. Pure. */
export function moveHost(order: readonly string[], shown: readonly string[], key: string, to: number): string[] {
  const from = shown.indexOf(key);
  if (from < 0) return [...order];
  const next = shown.filter((k) => k !== key);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, key);
  return [...next, ...order.filter((k) => !next.includes(k))];
}

/** A rank for each host key by the order (for J/K), unknown ones after, as they come. Pure. */
export const hostRank = (order: readonly string[]) => {
  const rank = new Map(order.map((k, i) => [k, i]));
  return (key: string) => rank.get(key) ?? order.length;
};

const check = (raw: unknown): string[] =>
  Array.isArray(raw) ? [...new Set(raw.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length < 200))].slice(0, 200) : [];

let order = check(readStore<unknown>(KEY, []));
/** The hosts the map shows now, in its order (CrewMap says), for ⌘K's moves. */
let shown: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let snapshot = { order, shown };

function set(next: { order?: string[]; shown?: string[] }) {
  if (next.order) {
    order = next.order;
    writeStore(KEY, order.length ? order : null);
  }
  if (next.shown) shown = next.shown;
  snapshot = { order, shown };
  emit();
}

export function useHostOrder() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
  );
}

/** Moves a host to `to` among those shown. */
export const placeHost = (key: string, to: number) => set({ order: moveHost(order, shown, key, to) });
/** One step earlier (-1) or later (+1) among those shown. */
export function stepHost(key: string, by: -1 | 1) {
  const at = shown.indexOf(key);
  if (at < 0 || at + by < 0 || at + by >= shown.length) return;
  placeHost(key, at + by);
}
export const resetHostOrder = () => set({ order: [] });
/** CrewMap says which hosts it shows, in its order. */
export function showHosts(keys: string[]) {
  if (keys.join("\n") !== shown.join("\n")) set({ shown: keys });
}
