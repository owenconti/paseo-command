/**
 * The agent profiles' editor: whether it is open (and on which host), and a
 * revision that steps on each save, so New agent reads its profiles again.
 */
import { useSyncExternalStore } from "react";

type State = {
  /** The open editor's first host (undefined: local), or null when closed. */
  editing: { host?: string } | null;
  revision: number;
};
let state: State = { editing: null, revision: 0 };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const openProfileEditor = (host?: string) => set({ editing: { host } });
export const closeProfileEditor = () => set({ editing: null });
export const profilesSaved = () => set({ revision: state.revision + 1 });

export const useProfileEditor = () =>
  useSyncExternalStore(subscribe, () => state.editing);
export const useProfilesRevision = () =>
  useSyncExternalStore(subscribe, () => state.revision);
