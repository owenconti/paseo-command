/**
 * The Village map's dashboard halls: your pull requests (`GET /api/github/q/prCounts`)
 * and your Linear issues (`GET /api/linear/issue-counts`), each counted by group with
 * up to 12 of each. Both answer 200 with a `state`; the page reads only that.
 */
import { useEffect, useState } from "react";
import { api } from "./api";
import { useIntegrations } from "./integrationSettings";

/** How often the counts are asked for while the Village shows (the server keeps each a minute). */
export const VILLAGE_COUNTS_POLL_MS = 60_000;
/** At most this many items per group. */
export const VILLAGE_ITEMS_MAX = 12;

/** Why an answer has no counts. */
export type CountsUnavailable<S extends string> = { state: S; message: string };

export type PrCountItem = { title: string; repo: string; number: number; url: string };
export type PrGroup = "merged" | "review" | "draft" | "conflicts";
/** Your PRs: merged in the last 14 days; open ones with conflicts or failing checks, drafts, and the rest (in review). */
export type PrCountsAnswer =
  | { state: "ok"; counts: Record<PrGroup, number>; items: Record<PrGroup, PrCountItem[]> }
  | CountsUnavailable<"off" | "no-token" | "error">;

export type IssueCountItem = { id: string; title: string; url: string };
export type IssueGroup = "done" | "inProgress" | "todo" | "blocked";
/** Linear issues assigned to you: completed in the last 14 days, started, unstarted, and open ones blocked. */
export type IssueCountsAnswer =
  | { state: "ok"; counts: Record<IssueGroup, number>; items: Record<IssueGroup, IssueCountItem[]> }
  | CountsUnavailable<"off" | "no-key" | "error">;

export type VillageCounts = { prs: PrCountsAnswer | null; issues: IssueCountsAnswer | null };

const GITHUB_OFF: PrCountsAnswer = { state: "off", message: "Enable GitHub in Settings to use GitHub." };
const LINEAR_OFF: IssueCountsAnswer = { state: "off", message: "Enable Linear in Settings to see your issues." };

const same = <T>(a: T, b: T) => (JSON.stringify(a) === JSON.stringify(b) ? a : b);

/**
 * Both answers, asked every minute while `active` (and the page is shown); null until the
 * first one arrives. An integration that's off isn't asked: its answer is `off` here.
 * A failed request keeps the answer already shown.
 */
export function useVillageCounts(active: boolean): VillageCounts {
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
      if (!stopped) timer = setTimeout(poll, VILLAGE_COUNTS_POLL_MS);
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
  return { prs, issues };
}
