/**
 * Archiving a pool box's last workspace releases the box (src/pool.ts).
 *
 * - Before the archive (a worktree may go with it) the box's checkout is read
 *   (`POST /api/pool/before-archive`): uncommitted changes, unpushed commits.
 *   The archive's toast shows at once; the read is bounded and never stops
 *   the archive.
 * - Once it's archived, what else is active on the box's host is read
 *   (`POST /api/pool/after-archive`). Anything left: the box stays claimed.
 * - Nothing left and the checkout clean: `release.sh` runs in the background
 *   (`POST /api/pool/release` with the host, which checks again). Anything
 *   unpushed, or a checkout that couldn't be read: the user is asked first.
 *
 * Hosts that aren't a claimed pool box are archived as before. Outside React,
 * as archives.ts is: an archive outlives whatever started it.
 */
import { api, errorMessage } from "./api";
import { archiveRequest, isArchiving, onArchiveSettled, startArchive } from "./archives";
import {
  boxIdle,
  checkoutClean,
  releaseWarning,
  type PoolBox,
  type PoolCheckout,
  type PoolRemaining,
} from "./pool";
import { releasePoolBox } from "./poolStore";
import type { Workspace } from "./types";
import { workspaceKey } from "./workspaces";

/** A release that needs the user's word first: the archived workspace's checkout had unpushed work. */
export type ReleaseAsk = {
  box: PoolBox;
  host: string;
  workspaceId: string;
  warning: string;
  checkout?: PoolCheckout;
};

export const POOL_ARCHIVE = {
  /** The checkout read before archiving gives up after this, and the archive goes on. */
  checkMs: 12000,
};

type Pending = { box: PoolBox; checkout?: PoolCheckout; workspace: Workspace };
const pending = new Map<string, Pending>();
const asks = new Set<(ask: ReleaseAsk) => void>();
const notices = new Set<(message: string, failed?: boolean) => void>();

function bounded<T>(value: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    value.catch(() => null),
    new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), ms))),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Archive a workspace (confirmed), first noting what releasing its pool box
 * would lose when it's on one. `pool` is whether Pool boxes is on.
 */
export function archiveWorkspace(workspace: Workspace, pool: boolean) {
  if (!pool || !workspace.host) return startArchive(workspace);
  const key = workspaceKey(workspace);
  if (isArchiving(key)) return false;
  return startArchive(workspace, async (w) => {
    const before = await bounded(
      api<{ box: PoolBox | null; checkout?: PoolCheckout }>("pool/before-archive", {
        host: w.host,
        workspace: w.workspaceId,
      }),
      POOL_ARCHIVE.checkMs,
    );
    if (before?.box) pending.set(key, { box: before.box, checkout: before.checkout, workspace: w });
    else pending.delete(key);
    return archiveRequest(w);
  });
}

function tell(message: string, failed = false) {
  notices.forEach((fn) => fn(message, failed));
}

/** Release a box after its last workspace was archived; the server checks the host is idle again. */
export async function releaseAfterArchive(ask: Pick<ReleaseAsk, "box" | "host" | "workspaceId">) {
  try {
    await releasePoolBox(ask.box.id, { host: ask.host, workspace: ask.workspaceId });
    tell(`Releasing ${ask.box.label}: its last workspace was archived.`);
  } catch (error) {
    tell(`${ask.box.label} wasn't released: ${errorMessage(error) || "the request failed."}`, true);
  }
}

async function settle(key: string, archived: boolean) {
  const p = pending.get(key);
  if (!p) return;
  pending.delete(key);
  if (!archived) return;
  const host = p.workspace.host!;
  let after: { box: PoolBox | null; remaining?: PoolRemaining };
  try {
    after = await api("pool/after-archive", { host, workspace: p.workspace.workspaceId, cwd: p.workspace.cwd });
  } catch (error) {
    return tell(
      `Couldn't tell whether ${p.box.label} is free (${errorMessage(error) || "the request failed"}). Release it from its host in the crew when it is.`,
      true,
    );
  }
  if (!after.box || !after.remaining || !boxIdle(after.remaining)) return;
  const ask = { box: after.box, host, workspaceId: p.workspace.workspaceId };
  if (checkoutClean(p.checkout)) return releaseAfterArchive(ask);
  asks.forEach((fn) => fn({ ...ask, warning: releaseWarning(after.box!.label, p.checkout), checkout: p.checkout }));
}

onArchiveSettled((job) => void settle(job.key, job.status === "archived"));

/** Hear a release that needs confirming. */
export function onReleaseAsk(fn: (ask: ReleaseAsk) => void) {
  asks.add(fn);
  return () => void asks.delete(fn);
}
/** Hear what happened to a box after an archive (released, kept, couldn't tell). */
export function onPoolArchiveNotice(fn: (message: string, failed?: boolean) => void) {
  notices.add(fn);
  return () => void notices.delete(fn);
}

/** Tests only. */
export function resetPoolArchive() {
  pending.clear();
}
