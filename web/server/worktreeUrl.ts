/**
 * A Diagonal workspace's own app address (the user's ask: its browser opens it by itself). Diagonal's repositories
 * (`Diagonal-HQ/…` on GitHub) carry `bin/worktree`, whose `status` prints the worktree's instance slot and its URL:
 *
 *     Slot: diagonal-17
 *     Link: …/diagonal-17
 *     Setup: complete
 *     URL: https://chamber.17.diagonal.test/admin
 *
 * `GET /api/workspace-url?workspace=<id>[&host=<serverId>][&fresh=1]` runs it in the workspace's folder on its host
 * (a short daemon terminal named `paseo · worktree status`, listed as an editor so terminal lists leave it out; the
 * folder from the fleet's row, never the request), reads the `URL:` line and ends the terminal. The script only reads
 * files (`status` never claims a slot or writes). Kept `WORKTREE.keepMs` (a miss `missMs`); one run at a time a workspace.
 * Other repositories answer `{ url: null, why: "not-diagonal" }` without running anything.
 */
import { aggregate } from "./api/reads";
import { resolveHost, sdk, timed } from "./api/hosts";
import { id } from "./api/validate";
import { isDiagonalRepo } from "../src/worktree";

export const WORKTREE = { timeoutMs: 20_000, pollMs: 300, keepMs: 10 * 60_000, missMs: 60_000 };
/** Printed once the script is done, so its output is known to be whole. */
export const DONE = "__paseo_worktree_status_done__";
export const WORKTREE_TERMINAL = "paseo · worktree status";

export { isDiagonalRepo };

export type WorktreeStatus = { url: string | null; slot?: string; setup?: string; why?: "not-diagonal" | "no-script" | "no-url" | "timeout" };

/** `bin/worktree status`'s lines: its URL (https only), slot and setup. */
export function parseWorktreeStatus(text: string): WorktreeStatus {
  const field = (name: string) => text.match(new RegExp(`^\\s*${name}:\\s*(\\S.*?)\\s*$`, "im"))?.[1];
  if (/^no bin\/worktree$/m.test(text)) return { url: null, why: "no-script" };
  const slot = field("Slot");
  const setup = field("Setup");
  let url: string | null = null;
  const raw = field("URL");
  if (raw) {
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" && u.hostname && !u.username && !u.password) url = u.toString();
    } catch {
      url = null;
    }
  }
  return { url, ...(slot ? { slot } : {}), ...(setup ? { setup } : {}), ...(url ? {} : { why: "no-url" as const }) };
}

/** The script, run under the host's login shell (its PATH, for git) in the workspace's folder; then it waits to be read. */
export const STATUS_SCRIPT = `if [ -x bin/worktree ]; then "\${SHELL:-/bin/sh}" -l -c 'bin/worktree status' 2>&1; else echo "no bin/worktree"; fi; echo ${DONE}; sleep 60`;

const kept = new Map<string, { at: number; status: WorktreeStatus }>();
const running = new Map<string, Promise<WorktreeStatus>>();

export async function workspaceUrl(url: URL): Promise<WorktreeStatus> {
  const host = await resolveHost(url.searchParams.get("host"));
  const workspaceId = id(url.searchParams.get("workspace"));
  const { rows } = await aggregate("workspaces");
  const row = (rows as { workspaceId?: string; host?: string; cwd?: string; repo?: string }[]).find(
    (w) => w.workspaceId === workspaceId && (w.host || "") === (host?.serverId || ""),
  );
  if (!row?.cwd) throw new Error("Unknown workspace");
  if (!isDiagonalRepo(row.repo)) return { url: null, why: "not-diagonal" };
  const key = `${host?.serverId ?? ""}|${workspaceId}`;
  const was = kept.get(key);
  if (was && url.searchParams.get("fresh") !== "1" && Date.now() - was.at < (was.status.url ? WORKTREE.keepMs : WORKTREE.missMs)) return was.status;
  const pending = running.get(key);
  if (pending) return pending;
  const cwd = row.cwd;
  const run = (async () => {
    const client = await sdk(host);
    const made = await timed(
      client.createTerminal(cwd, WORKTREE_TERMINAL, undefined, { workspaceId, command: "/bin/sh", args: ["-c", STATUS_SCRIPT] }),
      undefined,
      client,
    );
    if (!made.terminal) throw new Error(made.error || "bin/worktree status didn't start");
    const terminal = made.terminal.id;
    try {
      const until = Date.now() + WORKTREE.timeoutMs;
      while (Date.now() < until) {
        const shot = await timed(client.captureTerminal(terminal, { stripAnsi: true }), undefined, client).catch(() => null);
        const text = (shot?.lines ?? []).join("\n");
        if (text.includes(DONE)) return parseWorktreeStatus(text.slice(0, text.lastIndexOf(DONE)));
        await new Promise((r) => setTimeout(r, WORKTREE.pollMs));
      }
      return { url: null, why: "timeout" as const };
    } finally {
      await timed(client.killTerminal(terminal), undefined, client).catch(() => undefined);
    }
  })();
  running.set(key, run);
  try {
    const status = await run;
    kept.set(key, { at: Date.now(), status });
    return status;
  } finally {
    running.delete(key);
  }
}

/** Forget what was kept (tests). */
export const resetWorkspaceUrls = () => {
  kept.clear();
  running.clear();
};
