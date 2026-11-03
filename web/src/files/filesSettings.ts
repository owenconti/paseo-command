import { useEffect, useSyncExternalStore } from "react";
import { api, errorMessage } from "../api";
import { DEFAULT_FILES_SETTINGS, filesSettings, type FilesSettings } from "./editorCommand";

/**
 * Settings → Files, shared across the page: where files open (the built-in
 * viewer, or the editor command in a terminal) and that command, kept in the
 * data directory's settings.json (`files`, through `GET`/`POST /api/settings`).
 */
type State = { settings: FilesSettings; loaded: boolean; saving: boolean; error: string | null };
let state: State = { settings: DEFAULT_FILES_SETTINGS, loaded: false, saving: false, error: null };
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
const update = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export function refreshFilesSettings() {
  if (loading || state.saving) return loading;
  loading = api<{ files?: unknown; error?: string | null }>("settings")
    .then(
      (answer) => update({ settings: filesSettings(answer.files), loaded: true, error: answer.error ?? null }),
      (error) => update({ loaded: true, error: errorMessage(error) }),
    )
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

/** Save some of the settings; resolves to the error, or null once saved. */
export async function saveFilesSettings(change: Partial<FilesSettings>): Promise<string | null> {
  if (loading) await loading;
  update({ saving: true, error: null });
  try {
    const answer = await api<{ files?: unknown; error?: string | null }>("settings", { files: change });
    if (answer.error) throw new Error(answer.error);
    update({ settings: filesSettings(answer.files), saving: false });
    return null;
  } catch (error) {
    const message = errorMessage(error) || "Couldn't save the Files settings.";
    update({ saving: false, error: message });
    return message;
  }
}

export function useFilesSettings() {
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  useEffect(() => {
    if (!state.loaded) void refreshFilesSettings();
  }, []);
  return value;
}
