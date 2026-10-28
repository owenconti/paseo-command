/**
 * Keeps each workspace's PR standing as Paseo workspace labels: one for its
 * CI, one for its review (rendering/src/prStatus.ts names them). The Paseo
 * app shows them, and the Atlas plants a flag for each.
 *
 * - The PR is Paseo's (the workspace row's `pr`), else, for a checkout on
 *   this machine, gh's (read-only `gh pr view`, cached in server/links.ts).
 * - Only a definite answer removes labels: no PR, merged or closed. A lookup
 *   that fails, or can't be made (a remote checkout Paseo can't tell about),
 *   and a stale host's rows, leave the labels as they are.
 * - The six names are the labeller's: a pass sets them as GitHub says,
 *   whoever changed them. Every other label is left alone.
 * - Only changes are sent. A label already in the host's catalog keeps the
 *   catalog's colour.
 */
import { PR_LABELS } from "../../rendering/src/prStatus";
import type { DaemonClient } from "./api/hosts";
import { BASE_BRANCHES, ghPullRequest, type GhAnswer, type PullRequest } from "./links";

type LabelColor = Parameters<DaemonClient["setWorkspaceLabel"]>[0]["label"]["color"];

/** The first pass waits a little, so the app's start isn't slowed; then one every `everyMs`. */
export const PR_LABELS_TUNING = { firstMs: 5000, everyMs: 30000 };

/** The labels a workspace should carry, or null when its PR can't be known. */
export function wantedLabels(pr: PullRequest | null | undefined): string[] | null {
  if (pr === undefined) return null;
  if (!pr || pr.state === "merged" || pr.state === "closed") return [];
  const out: string[] = [];
  const ci = { pending: "CI running", passing: "CI green", failing: "CI failing" } as const;
  const state = pr.ci?.state;
  if (state && state !== "none") out.push(ci[state]);
  if (pr.state === "open")
    out.push(
      pr.review === "approved"
        ? "Approved"
        : pr.review === "changes_requested"
          ? "Changes requested"
          : "Awaiting review",
    );
  return out;
}

export type LabelRow = {
  workspaceId: string;
  /** Its host's serverId; absent for this machine's daemon. */
  host?: string;
  cwd?: string;
  branch?: string;
  pr?: PullRequest | null;
  labels?: string[];
  stale?: boolean;
};
export type LabellerDeps = {
  rows(): Promise<LabelRow[]>;
  gh(cwd: string, branch: string): Promise<GhAnswer>;
  catalog(host: string | undefined): Promise<{ name: string; color: string }[]>;
  setLabel(
    host: string | undefined,
    o: { workspaceId: string; label: { name: string; color: string }; assigned: boolean },
  ): Promise<unknown>;
  log?(message: string): void;
};

const key = (name: string) => name.trim().toLowerCase();
const OWNED = new Map(PR_LABELS.map((l) => [key(l.name), l]));

export function createPrLabeller(deps: LabellerDeps) {
  const log = deps.log ?? ((m: string) => console.warn(`[pr-labels] ${m}`));
  /** The PR for a row: undefined when it can't be known now. */
  async function prOf(row: LabelRow): Promise<PullRequest | null | undefined> {
    const branch = (row.branch ?? "").trim();
    if (BASE_BRANCHES.test(branch)) return null;
    if (row.pr !== undefined) return row.pr;
    if (row.host || !row.cwd) return undefined;
    const answer = await deps.gh(row.cwd, branch);
    return answer.available ? answer.pr : undefined;
  }
  async function pass(): Promise<void> {
    let rows: LabelRow[];
    try {
      rows = await deps.rows();
    } catch (error) {
      log(`workspaces unreadable: ${String(error)}`);
      return;
    }
    const catalogs = new Map<string, Promise<Map<string, string>>>();
    const colorFor = (host: string | undefined, name: string) => {
      const k = host ?? "";
      if (!catalogs.has(k))
        catalogs.set(
          k,
          deps.catalog(host).then(
            (list) => new Map(list.map((l) => [key(l.name), l.color])),
            () => new Map<string, string>(),
          ),
        );
      return catalogs.get(k)!.then((c) => c.get(key(name)) ?? OWNED.get(key(name))!.color);
    };
    for (const row of rows) {
      if (row.stale || !row.workspaceId) continue;
      try {
        const wanted = wantedLabels(await prOf(row));
        if (!wanted) continue;
        const have = (row.labels ?? []).filter((n) => OWNED.has(key(n)));
        const want = new Set(wanted.map(key));
        const holding = new Set(have.map(key));
        for (const name of have)
          if (!want.has(key(name)))
            await deps.setLabel(row.host, {
              workspaceId: row.workspaceId,
              label: { name, color: await colorFor(row.host, name) },
              assigned: false,
            });
        for (const name of wanted)
          if (!holding.has(key(name)))
            await deps.setLabel(row.host, {
              workspaceId: row.workspaceId,
              label: { name, color: await colorFor(row.host, name) },
              assigned: true,
            });
      } catch (error) {
        log(`workspace ${row.workspaceId}: ${String(error)}`);
      }
    }
  }
  return { pass };
}

/** The app's own daemons: workspace rows as the API serves them, labels set as the panel sets them. */
function appDeps(): LabellerDeps {
  return {
    rows: async () => {
      const { aggregate } = await import("./api/reads");
      return (await aggregate("workspaces")).rows as LabelRow[];
    },
    gh: (cwd, branch) => ghPullRequest(cwd, branch),
    catalog: async (host) => {
      const [{ labelCatalog }, { resolveHost }] = await Promise.all([
        import("./api/reads"),
        import("./api/hosts"),
      ]);
      return labelCatalog(await resolveHost(host));
    },
    setLabel: async (host, o) => {
      const [{ resolveHost, sdk, timed }, { TUNING }] = await Promise.all([
        import("./api/hosts"),
        import("./fleet"),
      ]);
      const client = await sdk(await resolveHost(host, "write"));
      return timed(
        client.setWorkspaceLabel({ ...o, label: { ...o.label, color: o.label.color as LabelColor } }),
        TUNING.writeMs,
      );
    },
  };
}

let loop: { timer: ReturnType<typeof setTimeout>; stopped: boolean } | null = null;
/** Start labelling while the app serves: one loop per process, passes never overlapping. */
export function startPrLabels(deps: LabellerDeps = appDeps()): void {
  if (loop) return;
  const labeller = createPrLabeller(deps);
  const mine = { timer: undefined as unknown as ReturnType<typeof setTimeout>, stopped: false };
  const tick = async () => {
    await labeller.pass();
    if (!mine.stopped) mine.timer = setTimeout(tick, PR_LABELS_TUNING.everyMs).unref();
  };
  // Never what holds the process open.
  mine.timer = setTimeout(tick, PR_LABELS_TUNING.firstMs).unref();
  loop = mine;
}
export function stopPrLabels(): void {
  if (!loop) return;
  loop.stopped = true;
  clearTimeout(loop.timer);
  loop = null;
}
