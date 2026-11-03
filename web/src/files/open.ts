import { readStore, removeStore, writeStore } from "../api";
import { runAppCommand } from "../appCommands";

/** Asked of the Files page from elsewhere: its Changes, perhaps at a file. */
export type ChangesAsk = { path?: string };

const STORE_KEY = "files:openChanges";

/** An ask as a valid one (a path relative and short enough), else none. */
export function checkChangesAsk(raw: unknown): ChangesAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const path = (raw as { path?: unknown }).path;
  return typeof path === "string" && path && path.length <= 1000 ? { path } : {};
}

/**
 * Opens the Files page's Changes (at `path`, all changes, when given): kept
 * for the page to take as it mounts, and asked of it at once if it shows
 * (`files-changes`). The caller shows the tab (`postAppMenu("files")`).
 * ⇧⌘G, the workspace view's Changes, pending comments' Show the changes, ⌘K
 * and old GitHub places for a workspace's changes call it.
 */
export function openFilesChanges(path?: string): void {
  const ask: ChangesAsk = path ? { path } : {};
  if (path) writeStore("github:changesMode", "all");
  writeStore(STORE_KEY, ask);
  runAppCommand("files-changes", ask);
}

/** The ask kept for the page as it mounts, taken once. */
export function takeChangesAsk(): ChangesAsk | null {
  const ask = checkChangesAsk(readStore<unknown>(STORE_KEY, null));
  removeStore(STORE_KEY);
  return ask;
}
