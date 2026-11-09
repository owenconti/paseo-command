/**
 * The Dungeon Board's vault: your pull requests (`GET /api/github/q/prCounts`)
 * and your Linear issues (`GET /api/linear/issue-counts`), each counted by group with
 * up to 12 of each. Both answer 200 with a `state`; the page reads only that.
 */
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

export type PrCountItem = { title: string; repo: string; number: number; url: string };
export type PrGroup = "merged" | "review" | "draft" | "conflicts";
/** Your PRs: merged in the last 14 days; open ones with conflicts or failing checks, drafts, and the rest (in review). */
export type PrCountsAnswer =
  | { state: "ok"; counts: Record<PrGroup, number>; items: Record<PrGroup, PrCountItem[]>; atLeast?: PrGroup[] }
  | CountsUnavailable<"off" | "no-token" | "error">;

export type IssueCountItem = { id: string; title: string; url: string };
export type IssueGroup = "done" | "inProgress" | "todo" | "blocked";
/** Linear issues assigned to you: completed in the last 14 days, started, unstarted, and open ones blocked. */
export type IssueCountsAnswer =
  | { state: "ok"; counts: Record<IssueGroup, number>; items: Record<IssueGroup, IssueCountItem[]>; atLeast?: IssueGroup[] }
  | CountsUnavailable<"off" | "no-key" | "error">;

export type DashboardCounts = { prs: PrCountsAnswer | null; issues: IssueCountsAnswer | null };

const GITHUB_OFF: PrCountsAnswer = { state: "off", message: "Enable GitHub in Settings to use GitHub." };
const LINEAR_OFF: IssueCountsAnswer = { state: "off", message: "Enable Linear in Settings to see your issues." };

const same = <T>(a: T, b: T) => (JSON.stringify(a) === JSON.stringify(b) ? a : b);

/**
 * Both answers, asked every minute while `active` (and the page is shown); null until the
 * first one arrives. An integration that's off isn't asked: its answer is `off` here.
 * A failed request keeps the answer already shown.
 */
export function useDashboardCounts(active: boolean): DashboardCounts {
  const { integrations, loaded } = useIntegrations();
  const github = integrations.github;
  const linear = integrations.linear;
  const [prs, setPrs] = useState<PrCountsAnswer | null>(null);
  const [issues, setIssues] = useState<IssueCountsAnswer | null>(null);
  useEffect(() => {
    if (!active || !loaded) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      clearTimeout(timer);
      if (!document.hidden) {
        await Promise.all([
          github
            ? api<PrCountsAnswer>("github/q/prCounts", undefined, controller.signal).then(
                (next) => !stopped && setPrs((old) => same(old, next)),
                () => {},
              )
            : setPrs((old) => same(old, GITHUB_OFF)),
          linear
            ? api<IssueCountsAnswer>("linear/issue-counts", undefined, controller.signal).then(
                (next) => !stopped && setIssues((old) => same(old, next)),
                () => {},
              )
            : setIssues((old) => same(old, LINEAR_OFF)),
        ]);
      }
      if (!stopped) timer = setTimeout(poll, DASHBOARD_POLL_MS);
    }
    const shown = () => !document.hidden && void poll();
    document.addEventListener("visibilitychange", shown);
    void poll();
    return () => {
      document.removeEventListener("visibilitychange", shown);
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, loaded, github, linear]);
  // One object per answer, not per render: the map's data depends on it, and a new object each render re-laid the
  // world out on every render (a hover re-reported by the update set the tip again, looping).
  return useMemo(() => ({ prs, issues }), [prs, issues]);
}
