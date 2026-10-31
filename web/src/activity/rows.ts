/** The Activity feed's rows: which items a filter shows, their day groups, and the words for what happened. */
import type { ActivityItem, ActivitySource } from "./types";

export type ActivityFilter = "all" | "unread" | ActivitySource;
export const FILTERS: ActivityFilter[] = ["all", "unread", "github", "linear", "slack"];
export const isFilter = (v: unknown): v is ActivityFilter => FILTERS.includes(v as ActivityFilter);
export const SOURCE_LABEL: Record<ActivitySource, string> = { github: "GitHub", linear: "Linear", slack: "Slack" };

export function filterItems(items: ActivityItem[], filter: ActivityFilter): ActivityItem[] {
  if (filter === "all") return items;
  if (filter === "unread") return items.filter((i) => i.unread);
  return items.filter((i) => i.source === filter);
}

export type DayGroup = "Today" | "Yesterday" | "This week" | "Older";

/** An item's day group, by local days from `now`: today, yesterday, the six days before, else older. */
export function dayGroup(at: string, now: Date): DayGroup {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "Older";
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= midnight) return "Today";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  if (t >= yesterday) return "Yesterday";
  const week = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
  return t >= week ? "This week" : "Older";
}

/** The items in their day groups, in order (the items are newest first). */
export function groupByDay(items: ActivityItem[], now: Date): { group: DayGroup; items: ActivityItem[] }[] {
  const out: { group: DayGroup; items: ActivityItem[] }[] = [];
  for (const item of items) {
    const group = dayGroup(item.at, now);
    const last = out.at(-1);
    if (last?.group === group) last.items.push(item);
    else out.push({ group, items: [item] });
  }
  return out;
}

const GITHUB: Record<string, string> = {
  review_requested: "Review requested",
  mention: "You were mentioned",
  team_mention: "Your team was mentioned",
  author: "Activity on your thread",
  comment: "New comment",
  assign: "Assigned to you",
  ci_activity: "CI activity",
  state_change: "State changed",
  subscribed: "Activity on a thread you watch",
  manual: "Activity on a thread you subscribed to",
  security_alert: "Security alert",
  approval_requested: "Deployment review requested",
  invitation: "Invitation",
  member_feature_requested: "Feature requested",
  security_advisory_credit: "Security advisory credit",
};
const LINEAR: Record<string, string> = {
  issueNewComment: "New comment",
  issueCommentMention: "Mentioned in a comment",
  issueMention: "Mentioned",
  issueAssignedToYou: "Assigned to you",
  issueUnassignedFromYou: "Unassigned from you",
  issueCommentReaction: "Reaction to your comment",
  issueEmojiReaction: "Reaction",
  issueStatusChanged: "Status changed",
  issueStatusChangedAll: "Status changed",
  issueSubscribed: "Subscribed",
  issueCreated: "New issue",
  issueDue: "Due soon",
  issuePriorityUrgent: "Marked urgent",
  issueBlocking: "Blocking",
  issueUnblocked: "Unblocked",
  issueThreadResolved: "Thread resolved",
  projectUpdateCreated: "Project update",
  projectUpdateMentionPrompt: "Mentioned in a project update",
  projectUpdateNewComment: "Comment on a project update",
  projectUpdatePrompt: "Project update due",
};
const SLACK: Record<string, string> = { dm: "Direct message", mention: "Mentioned you", thread: "Reply in a thread" };

/** What happened, in words: a GitHub reason, a Linear notification type, a Slack kind. */
export function whatHappened(item: Pick<ActivityItem, "source" | "kind">): string {
  const known = (item.source === "github" ? GITHUB : item.source === "linear" ? LINEAR : SLACK)[item.kind];
  if (known) return known;
  const words = item.kind
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Notification";
}

/** Short relative time: "now", "5m", "3h", "2d", then the date. */
export function shortAgo(at: string, now = Date.now()): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  const d = new Date(t);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() !== new Date(now).getFullYear() ? { year: "numeric" } : {}),
  });
}
