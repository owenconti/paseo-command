/** Assigned Linear issue counts for the command belt. The legacy PR-count wire type remains shared with its API. */
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { useIntegrations } from "./integrationSettings";

/** How often the counts are asked for while the Dungeon Board shows (the server keeps each a minute). */
export const DASHBOARD_POLL_MS = 60_000;
/** At most this many items per group. */
export const DASHBOARD_ITEMS_MAX = 12;

/** Groups listed in an answer's `atLeast` are lower bounds (the read stopped at its cap): shown as "N+". */
/** Why an answer has no counts. */
export type CountsUnavailable<S extends string> = { state: S; message: string };

export type PrCountItem = {
  title: string;
  repo: string;
  number: number;
  url: string;
};
export type PrGroup = "merged" | "review" | "draft" | "conflicts";
/** Your PRs: merged in the last 14 days; open ones with conflicts or failing checks, drafts, and the rest (in review). */
export type PrCountsAnswer =
  | {
      state: "ok";
      counts: Record<PrGroup, number>;
      items: Record<PrGroup, PrCountItem[]>;
      atLeast?: PrGroup[];
    }
  | CountsUnavailable<"off" | "no-token" | "error">;

export type IssueCountItem = { id: string; title: string; url: string; status?: string };
export type IssueGroup = "done" | "inProgress" | "todo" | "blocked";
/** Linear issues assigned to you: completed in the last 14 days, started, unstarted, and open ones blocked. */
export type IssueCountsAnswer =
  | {
      state: "ok";
      counts: Record<IssueGroup, number>;
      items: Record<IssueGroup, IssueCountItem[]>;
      atLeast?: IssueGroup[];
    }
  | CountsUnavailable<"off" | "no-key" | "error">;

export type DashboardCounts = {
  prs: PrCountsAnswer | null;
  issues: IssueCountsAnswer | null;
};

const GITHUB_OFF: PrCountsAnswer = {
  state: "off",
  message: "Enable GitHub in Settings to use GitHub.",
};
const LINEAR_OFF: IssueCountsAnswer = {
  state: "off",
  message: "Enable Linear in Settings to see your issues.",
};

const same = <T>(a: T, b: T) =>
  JSON.stringify(a) === JSON.stringify(b) ? a : b;

/** Poll assigned issues while the belt is visible, refresh on key changes, and distinguish an unavailable source from zero. */
export function useDashboardCounts(active: boolean): DashboardCounts {
  const { integrations, loaded } = useIntegrations();
  const linear = integrations.linear;
  const [issues, setIssues] = useState<IssueCountsAnswer | null>(null);
  useEffect(() => {
    if (!active || !loaded) return;
    let stopped = false;
    let serial = 0;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      clearTimeout(timer);
      const mine = ++serial;
      if (!document.hidden) {
        if (linear)
          await api<IssueCountsAnswer>(
            "linear/issue-counts",
            undefined,
            controller.signal,
          ).then(
            (next) =>
              !stopped &&
              mine === serial &&
              setIssues((old) => same(old, next)),
            () => {
              if (!stopped && mine === serial)
                setIssues({
                  state: "error",
                  message:
                    "Couldn’t refresh assigned Linear issues. Try again shortly.",
                });
            },
          );
        else setIssues((old) => same(old, LINEAR_OFF));
      }
      if (!stopped && mine === serial)
        timer = setTimeout(poll, DASHBOARD_POLL_MS);
    }
    const shown = () => !document.hidden && void poll();
    const keys = () => void poll();
    document.addEventListener("visibilitychange", shown);
    window.addEventListener("paseo:secrets", keys);
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", shown);
      window.removeEventListener("paseo:secrets", keys);
    };
  }, [active, loaded, linear]);
  return useMemo(() => ({ prs: null, issues }), [issues]);
}
