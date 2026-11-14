/**
 * The pool boxes' status (`GET /api/pool`, src/pool.ts) shared across the page:
 * read when something needing it mounts, then every second while a claim or
 * release runs. `onPoolJobEnd` hears each job this page saw running finish.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api";
import { jobRunning, type PoolJob, type PoolStatus } from "./pool";

let status: PoolStatus | null = null;
const listeners = new Set<() => void>();
const ended = new Set<(job: PoolJob) => void>();
/** Jobs seen running, so a finished one is told once. */
const watched = new Set<string>();
let loading: Promise<PoolStatus | null> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const POLL_MS = 1000;

function set(next: PoolStatus | null) {
  const job = next?.job;
  if (job && jobRunning(job)) watched.add(job.id);
  else if (job && watched.delete(job.id)) ended.forEach((fn) => fn(job));
  status = next;
  listeners.forEach((fn) => fn());
  clearTimeout(timer);
  if (jobRunning(job)) timer = setTimeout(() => void refreshPool(), POLL_MS);
}

export function refreshPool() {
  return (loading ??= api<PoolStatus>("pool")
    .then(
      (s) => {
        set(s);
        return s;
      },
      () => status,
    )
    .finally(() => (loading = undefined)));
}

/** The status, read on mount while `active`. */
export function usePool(active = true) {
  const value = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
  );
  useEffect(() => {
    if (active) void refreshPool();
  }, [active]);
  return value;
}

/** Hear each claim or release finish (done or failed). */
export function onPoolJobEnd(fn: (job: PoolJob) => void) {
  ended.add(fn);
  return () => void ended.delete(fn);
}

async function start(path: string, body: Record<string, unknown>) {
  const { job } = await api<{ job: PoolJob }>(path, body);
  if (status) set({ ...status, job });
  else await refreshPool();
  watched.add(job.id);
  clearTimeout(timer);
  timer = setTimeout(() => void refreshPool(), POLL_MS);
  return job;
}

/** Claim a box, then dispatch New agent's first message into it. */
export const claimPoolBox = (body: Record<string, unknown>) => start("pool/claim", body);
/** Release a claimed box (`release.sh`). */
export const releasePoolBox = (pool: string) => start("pool/release", { pool });
