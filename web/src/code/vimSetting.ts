import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "../api";

/** Whether the Files tab's editor has vim keys (Settings → Files; on by default). Kept in localStorage, apart from
 *  the editor's code so Settings doesn't load it. */
const STORE = "files:vim";
let on = readStore<unknown>(STORE, true) !== false;
const listeners = new Set<() => void>();
export const vimSetting = () => on;
export function setVimSetting(next: boolean) {
  if (next === on) return;
  on = next;
  writeStore(STORE, next);
  listeners.forEach((l) => l());
}
export function onVimSetting(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const useVimSetting = () => useSyncExternalStore(onVimSetting, () => on, () => on);
