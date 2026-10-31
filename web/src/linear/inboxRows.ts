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

/**
 * The notifications as Inbox rows, newest first: an issue's together, a
 * project's together, any other alone; unread if any is, snoozed if all
 * are. `snoozed` picks the snoozed rows instead of the rest.
 */
export function inboxGroups(list: Iterable<LinearNotification>, now: number, snoozed = false): InboxGroup[] {
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
        issueKey: sorted.find((n) => n.issueKey)?.issueKey,
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

/** Whom a row's writes name: its issue's or project's notifications, else the one. */
export function inboxEntity(group: InboxGroup): Record<string, string> {
  if (group.issueId) return { issueId: group.issueId };
  if (group.projectId) return { projectId: group.projectId };
  return { id: group.latest.id };
}

/** Unread rows not snoozed: the sidebar's count. */
export function unreadCount(list: Iterable<LinearNotification>, now: number): number {
  return inboxGroups(list, now).filter((g) => g.unread).length;
}

/** Linear's snooze choices from `now`: an hour, tomorrow at 9, next Monday at 9 (local time). */
export function snoozeTimes(now: Date): { label: string; at: Date }[] {
  const nine = (d: Date) => {
    const at = new Date(d);
    at.setHours(9, 0, 0, 0);
    return at;
  };
  const tomorrow = nine(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (((8 - now.getDay()) % 7) || 7));
  return [
    { label: "An hour", at: new Date(now.getTime() + 3_600_000) },
    { label: "Tomorrow", at: tomorrow },
    { label: "Next week", at: nine(monday) },
  ];
}

/** A row's words: the issue's key and title (the issue's own when known), and what happened. */
export function inboxText(group: InboxGroup, issueTitle?: string): { key?: string; title: string; what: string } {
  const n = group.latest;
  const key = group.issueKey;
  const title = issueTitle ?? (key && n.title.startsWith(`${key} `) ? n.title.slice(key.length + 1) : n.title);
  const quote = n.commentBody ? `: “${n.commentBody.replace(/\s+/g, " ").trim()}”` : "";
  return { key, title, what: `${n.subtitle}${quote}` };
}
