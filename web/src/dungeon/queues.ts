import { useEffect } from "react";
import { useIntegrations } from "../integrationSettings";
import { readPath, useGithubRead, type Resource } from "../github/api";
import type { PrList } from "../github/types";
import { useActivity, useActivityPoll } from "../activity/store";
import type { ActivityItem } from "../activity/types";
import type { AtlasData, DashboardItem } from "../../../rendering/src/world";
import { dashCount } from "../../../rendering/src/dashboard";
export type QueueItem = {
  key: string;
  title: string;
  detail: string;
  url?: string;
  status?: string;
  activity?: ActivityItem;
};
export type WorkQueue = {
  known: boolean;
  total: number;
  lowerBound: boolean;
  items: QueueItem[];
  why: string;
  integration: "github" | "linear";
};
const unavailable = (
  integration: WorkQueue["integration"],
  why: string,
): WorkQueue => ({
  known: false,
  total: 0,
  lowerBound: false,
  items: [],
  why,
  integration,
});
export function prQueue(read: Resource<PrList>, enabled: boolean): WorkQueue {
  if (!enabled)
    return unavailable(
      "github",
      "Enable GitHub in Settings to see your pull requests.",
    );
  if (read.error || read.unavailable)
    return unavailable("github", read.error || read.unavailable!);
  if (!read.data) return unavailable("github", "Loading your pull requests…");
  if (!Array.isArray(read.data.rows))
    return unavailable("github", "GitHub did not return a pull request list.");
  const total = read.data.total ?? read.data.rows.length;
  return {
    known: true,
    total,
    lowerBound: read.data.total === undefined && read.data.rows.length >= 50,
    integration: "github",
    why: "",
    items: read.data.rows.map((p) => ({
      key: `${p.repo}#${p.number}`,
      title: p.title,
      detail: `${p.repo}#${p.number}`,
      url: p.url,
      status: [
        p.state,
        p.reviewDecision === "approved"
          ? "Approved"
          : p.reviewDecision === "changes"
            ? "Changes requested"
            : p.reviewDecision === "review"
              ? "Review required"
              : "",
        p.checks ? `Checks ${p.checks}` : "",
      ]
        .filter(Boolean)
        .join(" · "),
    })),
  };
}
export function issueQueues(counts: AtlasData["dashboard"]): {
  issues: WorkQueue;
  blocked: WorkQueue;
} {
  const d = counts?.issues,
    c = dashCount(d, "issues");
  if (!c.known) {
    const q = unavailable("linear", c.why);
    return { issues: q, blocked: q };
  }
  const item = (i: DashboardItem, status: string): QueueItem => ({
    key: i.id || i.url,
    title: i.title,
    detail: i.id || "Assigned issue",
    url: i.url,
    status:
      status === "Blocked"
        ? i.status && i.status.toLowerCase() !== "blocked"
          ? `Blocked · ${i.status}`
          : "Blocked"
        : i.status || status,
  });
  const groups = ["inProgress", "todo", "blocked"] as const;
  return {
    issues: {
      known: true,
      total: groups.reduce((n, k) => n + (c.by[k] ?? 0), 0),
      lowerBound: groups.some((k) => c.atLeast.includes(k)),
      why: "",
      integration: "linear",
      items: groups.flatMap((k) =>
        (d?.items?.[k] ?? []).map((i) =>
          item(
            i,
            k === "inProgress"
              ? "In progress"
              : k === "todo"
                ? "Todo"
                : "Blocked",
          ),
        ),
      ),
    },
    blocked: {
      known: true,
      total: c.by.blocked ?? 0,
      lowerBound: c.atLeast.includes("blocked"),
      why: "",
      integration: "linear",
      items: (d?.items?.blocked ?? []).map((i) => item(i, "Blocked")),
    },
  };
}
export function useWorkQueues(counts: AtlasData["dashboard"]) {
  const { integrations } = useIntegrations();
  const review = useGithubRead<PrList>(
    integrations.github ? readPath("prs", { scope: "review" }) : null,
    60_000,
  );
  const assigned = useGithubRead<PrList>(
    integrations.github ? readPath("prs", { scope: "assigned" }) : null,
    60_000,
  );
  useEffect(() => {
    const refresh = () => {
      if (integrations.github) {
        void review.reload();
        void assigned.reload();
      }
    };
    window.addEventListener("paseo:secrets", refresh);
    return () => window.removeEventListener("paseo:secrets", refresh);
  }, [integrations.github, review.reload, assigned.reload]);
  useActivityPoll(false);
  const activity = useActivity((s) => s);
  const source = activity.feed?.sources.find((s) => s.source === "linear");
  const unread =
    activity.feed?.items.filter((i) => i.source === "linear" && i.unread) ?? [];
  const inbox: WorkQueue = !integrations.linear
    ? unavailable("linear", "Enable Linear in Settings to see your Inbox.")
    : activity.error
      ? unavailable("linear", activity.error)
      : !source
        ? unavailable("linear", "Loading your Linear Inbox…")
        : !source.enabled
          ? unavailable(
              "linear",
              "Enable Linear in Settings to see your Inbox.",
            )
          : !source.ok
            ? unavailable("linear", source.reason || "Linear didn’t answer.")
            : {
                known: true,
                total: unread.length,
                lowerBound: !!source.limited,
                why: "",
                integration: "linear",
                items: unread.map((i) => ({
                  key: i.key,
                  title: i.title,
                  detail:
                    i.subtitle ||
                    (i.actor?.name
                      ? `From ${i.actor.name}`
                      : "Linear notification"),
                  url: i.url,
                  activity: i,
                })),
              };
  return {
    linearEnabled: integrations.linear,
    review: prQueue(review, integrations.github),
    assigned: prQueue(assigned, integrations.github),
    ...issueQueues(
      integrations.linear
        ? counts
        : {
            issues: {
              state: "off",
              message: "Enable Linear in Settings to see your issues.",
            },
          },
    ),
    inbox,
  };
}
export const queueText = (q: WorkQueue) =>
  q.known ? `${q.total}${q.lowerBound ? "+" : ""}` : "—";
/** The user's full GitHub dashboard remains available when the preview is capped. */
export const githubQueueUrl = (scope: "review" | "assigned") =>
  `https://github.com/pulls?q=${encodeURIComponent(`is:pr is:open ${scope === "review" ? "review-requested" : "assignee"}:@me`)}`;
