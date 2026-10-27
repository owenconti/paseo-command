import { useSyncExternalStore } from "react";
import { api, errorMessage } from "./api";
import type { Workspace } from "./types";
import { workspaceKey } from "./workspaces";

/**
 * Workspace archives run in the background, outside React: the confirmation
 * closes at once and the request outlives any component (the panel, the
 * workspace view, even the app re-rendering or remounting). A reload drops
 * this state; the request already sent still completes on the server, and
 * the workspace then leaves the list with the next fleet update.
 */
export type ArchiveJob = {
  /** The workspace's client key (`workspaceKey`). */
  key: string;
  workspace: Workspace;
  status: "archiving" | "archived" | "failed";
  error: string;
  /** Rises with every attempt, so a stale answer never overwrites a retry. */
  attempt: number;
};

let jobs: ArchiveJob[] = [];
const listeners = new Set<() => void>();
const settled = new Set<(job: ArchiveJob) => void>();

function emit() {
  for (const listener of listeners) listener();
}
function put(job: ArchiveJob) {
  jobs = [...jobs.filter((j) => j.key !== job.key), job];
  emit();
}

export function archiveJobs(): readonly ArchiveJob[] {
  return jobs;
}
export function isArchiving(key: string) {
  return jobs.some((j) => j.key === key && j.status === "archiving");
}

/**
 * Start archiving `workspace` (already confirmed by the user). Returns false,
 * doing nothing, when that workspace is already being archived.
 */
export function startArchive(
  workspace: Workspace,
  request: (w: Workspace) => Promise<unknown> = archiveRequest,
): boolean {
  const key = workspaceKey(workspace);
  if (isArchiving(key)) return false;
  const attempt = (jobs.find((j) => j.key === key)?.attempt ?? 0) + 1;
  put({ key, workspace, status: "archiving", error: "", attempt });
  void request(workspace).then(
    () => finish(key, attempt, "archived", ""),
    (error: unknown) =>
      finish(
        key,
        attempt,
        "failed",
        errorMessage(error) || "Could not archive this workspace.",
      ),
  );
  return true;
}

function finish(
  key: string,
  attempt: number,
  status: "archived" | "failed",
  error: string,
) {
  const job = jobs.find((j) => j.key === key);
  if (!job || job.attempt !== attempt) return;
  const next = { ...job, status, error };
  put(next);
  for (const listener of settled) listener(next);
}

/** Forget a finished job (its toast was dismissed or timed out). */
export function dismissArchive(key: string) {
  const job = jobs.find((j) => j.key === key);
  if (!job || job.status === "archiving") return;
  jobs = jobs.filter((j) => j.key !== key);
  emit();
}

/** Called once per finished attempt, archived or failed. */
export function onArchiveSettled(listener: (job: ArchiveJob) => void) {
  settled.add(listener);
  return () => void settled.delete(listener);
}

export function useArchiveJobs(): readonly ArchiveJob[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    archiveJobs,
    archiveJobs,
  );
}

export function archiveRequest(target: Workspace) {
  return api(`workspaces/${target.workspaceId}/archive`, {
    confirm: true,
    expectedCwd: target.cwd,
    ...(target.host ? { host: target.host } : {}),
  });
}

/** Tests only. */
export function resetArchives() {
  jobs = [];
  emit();
}
