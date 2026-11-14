/**
 * The pool boxes' status (`GET /api/pool`, src/pool.ts) shared across the page:
 * read when something needing it mounts, then every second while a claim or
 * release runs. `onPoolJobEnd` hears each job this page saw running finish.
 *
 * New agent's claim is remembered with its message (`dispatch-pool-job`), so
 * leaving New agent loses neither: reopened, it shows the claim again; if the
 * claim fails, its message goes back into New agent's empty draft and the
 * failure is kept (`dispatch-pool-failed`) for New agent to say when it next
 * opens; once it has started the agent, the form New agent kept
 * (`dispatch-form`) is cleared.
 *
 * The claim itself is the server's (it goes on whatever the page does); the
 * status lists recent claims (`jobs`), which the agent list shows as pending
 * rows (`PoolClaims.tsx`) until their agent shows or the user dismisses them.
 * Polled while any of them runs, from whatever mounted the store, and a claim
 * this page started is heard ending even after a reload.
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
/** New agent's claim that failed, for New agent to say why when it next opens (until sent again or dismissed). */
const FORM_FAILED = "dispatch-pool-failed";
export const formFailedJob = () => readStore<string>(FORM_FAILED, "");
export const forgetFormFailure = () => removeStore(FORM_FAILED);
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
  else writeStore(FORM_FAILED, job.id);
  if (job.phase !== "done" && !readStore(DISPATCH_DRAFT, "").trim() && form.prompt) {
    // Never over a message written since.
    writeStore(DISPATCH_DRAFT, form.prompt);
    restored.add(job.id);
  }
}

/** A job finished: told once, and New agent's own claim settled. */
function finish(job: PoolJob) {
  const mine = formPoolJob()?.id === job.id;
  const seen = watched.delete(job.id);
  if (mine) settleFormJob(job);
  // Heard by those listening if this page saw it run, or started it (before a reload, say).
  if (seen || mine) ended.forEach((fn) => fn(job));
}

function set(next: PoolStatus | null) {
  const jobs = [...(next?.jobs ?? []), ...(next?.job && !next.jobs?.some((j) => j.id === next.job!.id) ? [next.job] : [])];
  for (const job of jobs) {
    if (jobRunning(job)) watched.add(job.id);
    else finish(job);
  }
  // A claim the server no longer knows (it restarted mid-claim) ends as failed, its message put back:
  // after a few reads, as one asked before the claim may answer after it.
  const form = formPoolJob();
  if (next && form && !jobs.some((j) => j.id === form.id)) {
    if (++unknown >= 3) {
      unknown = 0;
      settleFormJob({ id: form.id, kind: "claim", phase: "failed", steps: [], startedAt: 0 });
    }
  } else unknown = 0;
  status = next;
  listeners.forEach((fn) => fn());
  clearTimeout(timer);
  if (jobs.some(jobRunning) || (next && form)) timer = setTimeout(() => void refreshPool(), POLL_MS);
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
  if (status) set({ ...status, job, jobs: [job, ...(status.jobs ?? []).filter((j) => j.id !== job.id)] });
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
  forgetFormFailure();
  return job;
}

/** Put a finished claim away: it leaves the agent list (and New agent stops saying why it failed). */
export async function dismissPoolJob(id: string) {
  if (formFailedJob() === id) forgetFormFailure();
  await api("pool/dismiss", { id });
  await refreshPool();
}
/**
 * Release a claimed box (`release.sh`). After an archive (`after`: the box's host and the archived workspace)
 * the server releases it only if nothing else is active on the host.
 */
export const releasePoolBox = (pool: string, after?: { host: string; workspace: string }) =>
  start("pool/release", { pool, ...after });
