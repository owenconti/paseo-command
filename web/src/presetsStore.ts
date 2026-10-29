/**
 * The preset prompts as this page knows them (`GET /api/presets`), shared by
 * New agent, the Settings popover and the editor, which saves them
 * (`POST /api/presets`) and opens from either.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import type { Preset } from "./presets";

type State = {
  presets: Preset[];
  /** Why settings.json can't be read, if it can't. */
  error: string | null;
  loaded: boolean;
  /** Whether the editor is open. */
  editing: boolean;
};
let state: State = { presets: [], error: null, loaded: false, editing: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Read settings.json again (as each New agent form and the editor open). */
export function refreshPresets(): Promise<State> {
  return api<{ presets: Preset[]; error: string | null }>("presets")
    .then((r) =>
      set({
        presets: Array.isArray(r.presets) ? r.presets : [],
        error: r.error ?? null,
        loaded: true,
      }),
    )
    .catch(() => set({ loaded: true }))
    .then(() => state);
}

/** Save the presets; throws the server's reason when it refuses them. */
export async function savePresets(presets: Preset[]) {
  const r = await api<{ presets: Preset[] }>("presets", { presets });
  set({ presets: r.presets, error: null, loaded: true });
}

export const openPresetEditor = () => set({ editing: true });
export const closePresetEditor = () => set({ editing: false });

/** The presets, read when a component using them mounts. */
export function usePresets() {
  const current = useSyncExternalStore(subscribe, () => state);
  useEffect(() => {
    void refreshPresets();
  }, []);
  return current;
}

/** Whether the editor is open, without reading the file. */
export const usePresetEditorOpen = () =>
  useSyncExternalStore(subscribe, () => state.editing);
