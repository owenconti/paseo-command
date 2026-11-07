import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "./api";

/** The map's style in the macOS app: the hex Islands (the default), the Overworld, a
 * terraced fantasy map of castles, project halls and workspace booths, or the Dungeon Board,
 * a dungeon cutaway with a floor per host, or the Village, a village square per host round a crystal fountain. Kept in localStorage; a page opened with `?map=<style>`
 * (`native:mock -- --dungeon`) starts in that style and keeps it. */
export type MapStyle = "islands" | "overworld" | "dungeon" | "village";

export const MAP_STYLES: { id: MapStyle; name: string; detail: string }[] = [
  { id: "islands", name: "Islands", detail: "Hex islands on a painted sea" },
  { id: "overworld", name: "Overworld", detail: "Castles, halls and market booths on terraced islands" },
  { id: "dungeon", name: "Dungeon Board", detail: "A dungeon cutaway: a floor per host, robots in candle-lit alcoves" },
  { id: "village", name: "Village", detail: "A village square per host: project halls round a crystal fountain, robots on their porches" },
];

const STORE = "atlas:style";
const check = (value: unknown): MapStyle => (MAP_STYLES.some((m) => m.id === value) ? (value as MapStyle) : "islands");
const asked = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("map");
let style = check(asked ?? readStore<unknown>(STORE, "islands"));
if (asked) writeStore(STORE, style);
const listeners = new Set<() => void>();

export const mapStyle = () => style;

export function setMapStyle(next: MapStyle) {
  if (next === style) return;
  style = next;
  writeStore(STORE, style);
  listeners.forEach((listener) => listener());
}

export function useMapStyle(): MapStyle {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => style,
  );
}
