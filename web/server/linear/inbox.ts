/** Activity's Linear rows, as Linear's Inbox groups your notifications. */
import type { LinearNotification } from "./types";

/** One Inbox row: an issue's (or project's) notifications together, as Linear's Inbox shows them. */
export type InboxGroup = {
  key: string;
  issueId?: string;
  issueKey?: string;
  projectId?: string;
  /** The newest of them: the row says what it says. */
  latest: LinearNotification;
  notifications: LinearNotification[];
  unread: boolean;
  /** Every one of them is snoozed until later. */
  snoozed: boolean;
};

const isSnoozed = (n: LinearNotification, now: number) =>
  !!n.snoozedUntilAt && Date.parse(n.snoozedUntilAt) > now;

/** The issue a pull request notification is about: the first key its branch or title names of one of these teams. */
export function pullRequestIssueKey(n: LinearNotification, teamKeys: Iterable<string>): string | undefined {
  const teams = new Set([...teamKeys].map((k) => k.toUpperCase()));
  return n.pullRequestIssueKeys?.find((key) => teams.has(key.split("-")[0]!));
}

/**
 * The notifications as Inbox rows, newest first: an issue's together, a
 * project's together, any other alone; unread if any is, snoozed if all
 * are. `snoozed` picks the snoozed rows instead of the rest. A pull
 * request's row opens the issue its branch or title names, of `teamKeys`.
 */
export function inboxGroups(
  list: Iterable<LinearNotification>,
  now: number,
  snoozed = false,
  teamKeys: Iterable<string> = [],
): InboxGroup[] {
  const teams = [...teamKeys];
  const groups = new Map<string, LinearNotification[]>();
  for (const n of list) {
    if (n.archivedAt) continue;
    const key = n.issueId ? `issue:${n.issueId}` : n.projectId ? `project:${n.projectId}` : `notification:${n.id}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return [...groups]
    .map(([key, notifications]) => {
      const sorted = notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const latest = sorted[0];
      return {
        key,
        issueId: latest.issueId,
        issueKey:
          sorted.find((n) => n.issueKey)?.issueKey ??
          sorted.map((n) => pullRequestIssueKey(n, teams)).find(Boolean),
        projectId: latest.projectId,
        latest,
        notifications: sorted,
        unread: sorted.some((n) => !n.readAt),
        snoozed: sorted.every((n) => isSnoozed(n, now)),
      };
    })
    .filter((g) => g.snoozed === snoozed)
    .sort((a, b) => b.latest.createdAt.localeCompare(a.latest.createdAt));
}

/** A row's words: the issue's key and title, and what happened. */
export function inboxText(group: InboxGroup): { key?: string; title: string; what: string } {
  const n = group.latest;
  const key = group.issueKey;
  const title = key && n.title.startsWith(`${key} `) ? n.title.slice(key.length + 1) : n.title;
  const quote = n.commentBody ? `: “${n.commentBody.replace(/\s+/g, " ").trim()}”` : "";
  return { key, title, what: `${n.subtitle}${quote}` };
}
