/**
 * Workspaces' pending diff comments as this page knows them (`GET
 * /api/diff-comments`), shared by the Changes diff that writes them, the chat's
 * Apply control and ⌘K. Each change is shown at once and posted; a refusal
 * reads them again and says why.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { api, errorMessage } from "../api";
import { applyMessage, pending, type LocalComment, type LocalCommentChange } from "./localComments";

type Entry = { comments: LocalComment[]; loaded: boolean };
const EMPTY: Entry = { comments: [], loaded: false };
const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const keyOf = (host: string | undefined, workspace: string) => `${host ?? ""}|${workspace}`;
const set = (key: string, comments: LocalComment[]) => {
  entries.set(key, { comments, loaded: true });
  listeners.forEach((l) => l());
};
const query = (host: string | undefined, workspace: string) =>
  `diff-comments?workspace=${encodeURIComponent(workspace)}${host ? `&host=${encodeURIComponent(host)}` : ""}`;

/** Read a workspace's comments again. */
export async function refreshLocalComments(host: string | undefined, workspace: string) {
  try {
    const r = await api<{ comments: LocalComment[] }>(query(host, workspace));
    set(keyOf(host, workspace), Array.isArray(r.comments) ? r.comments : []);
  } catch {
    // Kept as they were; the next read tries again.
  }
}

/** Change a workspace's comments; answers whether it went through (else `onError` hears why). */
export async function changeLocalComments(
  host: string | undefined,
  workspace: string,
  change: LocalCommentChange,
  onError?: (message: string) => void,
): Promise<boolean> {
  const key = keyOf(host, workspace);
  const before = entries.get(key)?.comments ?? [];
  const now = new Date().toISOString();
  // Shown at once, as the server will keep it.
  const shown: LocalComment[] | null =
    change.action === "edit"
      ? before.map((c) => (c.id === change.id ? { ...c, body: change.body.trim(), updatedAt: now } : c))
      : change.action === "remove"
        ? before.filter((c) => c.id !== change.id)
        : change.action === "discard"
          ? before.filter((c) => c.appliedAt)
          : change.action === "apply"
            ? before.map((c) => (change.ids.includes(c.id) && !c.appliedAt ? { ...c, appliedAt: now } : c))
            : null;
  if (shown) set(key, shown);
  try {
    const r = await api<{ comments: LocalComment[] }>("diff-comments", { ...(host ? { host } : {}), workspace, ...change });
    set(key, r.comments);
    return true;
  } catch (error) {
    onError?.(`Couldn’t save the comment: ${errorMessage(error) || "the app’s server didn’t answer"}`);
    void refreshLocalComments(host, workspace);
    return false;
  }
}

/** A workspace's comments (read when a component using them mounts), and what changes them. */
export function useLocalComments(host: string | undefined, workspace: string | undefined, onError?: (message: string) => void) {
  const key = workspace ? keyOf(host, workspace) : "";
  const entry = useSyncExternalStore(subscribe, () => (key ? (entries.get(key) ?? EMPTY) : EMPTY));
  useEffect(() => {
    if (workspace) void refreshLocalComments(host, workspace);
  }, [host, workspace]);
  const change = useCallback(
    (c: LocalCommentChange) => (workspace ? changeLocalComments(host, workspace, c, onError) : Promise.resolve(false)),
    [host, workspace, onError],
  );
  const open = useMemo(() => pending(entry.comments), [entry.comments]);
  return { comments: entry.comments, pending: open, loaded: entry.loaded, change };
}

/**
 * Sends a workspace's pending comments to an agent as one message, through
 * `send` (the chat's own send path, so it shows in the transcript), then
 * marks them applied. Answers whether it was sent.
 */
export async function applyLocalComments(
  host: string | undefined,
  workspace: string,
  comments: LocalComment[],
  agentId: string,
  send: (text: string) => Promise<boolean>,
  onError?: (message: string) => void,
): Promise<boolean> {
  if (!comments.length) return false;
  if (!(await send(applyMessage(comments)))) return false;
  await changeLocalComments(host, workspace, { action: "apply", ids: comments.map((c) => c.id), agentId }, onError);
  return true;
}
