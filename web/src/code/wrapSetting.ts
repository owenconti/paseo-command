import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "../api";

/** Whether the Files tab's editor wraps long lines (Settings → Files, ⌥Z, vim's `:set wrap`; off by default). Kept in
 *  localStorage, apart from the editor's code so Settings and the palette don't load it. A split diff keeps its lines
 *  whole (its two sides line up line by line). */
const STORE = "files:wrap";
let on = readStore<unknown>(STORE, false) === true;
const listeners = new Set<() => void>();
export const wrapSetting = () => on;
export function setWrapSetting(next: boolean) {
  if (next === on) return;
  on = next;
  writeStore(STORE, next);
  listeners.forEach((l) => l());
}
export const toggleWrapSetting = () => setWrapSetting(!on);
export function onWrapSetting(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const useWrapSetting = () => useSyncExternalStore(onWrapSetting, () => on, () => on);
