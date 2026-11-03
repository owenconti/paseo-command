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

/** Asked of the Files page from elsewhere: a workspace's file, as a kept tab, perhaps at a line (or lines). */
export type FileAsk = { workspace: string; host?: string; path: string; line?: number; endLine?: number };

const FILE_KEY = "files:openFile";
const lineIn = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v < 10_000_000 ? v : undefined);

/** An ask as a valid one (a workspace and a short path; lines whole numbers), else none. */
export function checkFileAsk(raw: unknown): FileAsk | null {
  if (!raw || typeof raw !== "object") return null;
  const { workspace, host, path, line, endLine } = raw as Record<string, unknown>;
  if (typeof workspace !== "string" || !workspace || typeof path !== "string" || !path || path.length > 1000) return null;
  const at = lineIn(line);
  const end = at ? lineIn(endLine) : undefined;
  return {
    workspace,
    ...(typeof host === "string" && host ? { host } : {}),
    path,
    ...(at ? { line: at } : {}),
    ...(end && at && end > at ? { endLine: end } : {}),
  };
}

/**
 * Opens a workspace's file in the Files page as a kept tab, scrolled to `line`
 * when given: kept for the page to take as it mounts, and asked of it at once
 * if it shows (`files-open-at`). The page takes it while it shows that
 * workspace (the selected one, or the selected agent's). The caller shows the
 * tab (`postAppMenu("files")`). The chat's file links call it.
 */
export function openFilesFile(ask: FileAsk): void {
  writeStore(FILE_KEY, ask);
  runAppCommand("files-open-at", ask);
}

/** The ask kept for the page as it mounts, taken once. */
export function takeFileAsk(): FileAsk | null {
  const ask = checkFileAsk(readStore<unknown>(FILE_KEY, null));
  removeStore(FILE_KEY);
  return ask;
}
