/**
 * The pool boxes' status (`GET /api/pool`, src/pool.ts) shared across the page:
 * read when something needing it mounts, then every second while a claim or
 * release runs. `onPoolJobEnd` hears each job this page saw running finish.
 *
 * New agent's claim is remembered with its message (`dispatch-pool-job`), so
 * leaving New agent loses neither: reopened, it shows the claim again; if the
 * claim fails, its message goes back into New agent's empty draft; once it
 * has started the agent, the form New agent kept (`dispatch-form`) is cleared.
 */
import { useEffect, useSyncExternalStore } from "react";
import { api, readStore, removeStore, writeStore } from "./api";
import { jobRunning, type PoolJob, type PoolStatus } from "./pool";

let status: PoolStatus | null = null;
const listeners = new Set<() => void>();
const ended = new Set<(job: PoolJob) => void>();
/** Jobs seen running, so a finished one is told once. */
const watched = new Set<string>();
let loading: Promise<PoolStatus | null> | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const POLL_MS = 1000;

/** New agent's claim under way: its job and the message it carries. */
type FormJob = { id: string; prompt: string };
const FORM_JOB = "dispatch-pool-job";
/** New agent's own keys: its unsent form and its first message's draft (Composer's `draft:dispatch`). */
export const DISPATCH_FORM = "dispatch-form";
const DISPATCH_DRAFT = "draft:dispatch";
export const formPoolJob = () => readStore<FormJob | null>(FORM_JOB, null);
/** Claims whose message was put back into New agent's draft. */
const restored = new Set<string>();
let unknown = 0;
export const draftRestored = (jobId: string) => restored.has(jobId);

/** A claim New agent started has ended: its message back if it failed, the kept form gone if it worked. */
function settleFormJob(job: PoolJob) {
  const form = formPoolJob();
  if (job.kind !== "claim" || form?.id !== job.id) return;
  removeStore(FORM_JOB);
  if (job.phase === "done") removeStore(DISPATCH_FORM);
  else if (!readStore(DISPATCH_DRAFT, "").trim() && form.prompt) {
    // Never over a message written since.
    writeStore(DISPATCH_DRAFT, form.prompt);
    restored.add(job.id);
  }
}

function set(next: PoolStatus | null) {
  const job = next?.job;
  if (job && jobRunning(job)) watched.add(job.id);
  else if (job && watched.delete(job.id)) {
    settleFormJob(job);
    ended.forEach((fn) => fn(job));
  } else if (job && formPoolJob()?.id === job.id) settleFormJob(job);
  // A claim the server no longer knows (it restarted mid-claim) ends as failed, its message put back:
  // after a few reads, as one asked before the claim may answer after it.
  const form = formPoolJob();
  if (next && form && next.job?.id !== form.id) {
    if (++unknown >= 3) {
      unknown = 0;
      settleFormJob({ id: form.id, kind: "claim", phase: "failed", steps: [], startedAt: 0 });
    }
  } else unknown = 0;
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
export async function claimPoolBox(body: Record<string, unknown>) {
  const job = await start("pool/claim", body);
  writeStore(FORM_JOB, { id: job.id, prompt: typeof body.prompt === "string" ? body.prompt : "" });
  return job;
}
/** Release a claimed box (`release.sh`). */
export const releasePoolBox = (pool: string) => start("pool/release", { pool });
