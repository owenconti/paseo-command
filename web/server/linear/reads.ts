/**
 * Linear's named reads, for Activity's Linear source: the workspace's people
 * and teams, and a page of your Inbox. Each throws a LinearError when Linear
 * can't answer; the workspace is kept for five minutes.
 */
import type { LinearNotification, LinearWorkspace } from "./types";
import { integrationEnabled } from "../integrations";
import { DISABLED, LinearError, linearApiKey, linearRequest, NO_KEY } from "./client";
import { MY_ISSUES_QUERY, NOTIFICATIONS_QUERY, WORKSPACE_QUERY } from "./fragments";
import { groupIssues, type GlanceIssueGroup } from "../../src/glance";
import { httpsUrl, nodesOf, notificationOf, recOf, strOf, teamOf, userOf } from "./normalize";

export const LINEAR_READS = {
  workspaceTtlMs: 5 * 60_000,
  /** Crew's glance: your open issues are asked at most this often (the page asks every minute). */
  myIssuesTtlMs: 50_000,
  inboxSize: 250,
  /** Your assigned issues: one page of this many, kept this long, done counted over this many days, this many of each group listed. */
  issuesPage: 250,
  /** At most this many assigned issues are read (pages of `issuesPage`); past it the counts are lower bounds. */
  issuesMax: 2000,
  doneDays: 14,
  itemsMax: 12,
  titleMax: 120,
};

const nonNull = <T>(v: T | null): v is T => v !== null;

let workspaceCache: { key: string; at: number; value: LinearWorkspace } | undefined;
let myIssuesCache: { key: string; at: number; value: GlanceIssueGroup[] } | undefined;

/** Forgets what the reads kept (tests). */
export function resetLinearReads(): void {
  workspaceCache = undefined;
  myIssuesCache = undefined;
}

/** Your issues in progress, in review and to do, by state (Crew's glance); kept `myIssuesTtlMs` unless `fresh`. */
export async function readMyIssues(fresh = false): Promise<GlanceIssueGroup[]> {
  const key = linearApiKey() ?? "";
  if (!fresh && myIssuesCache && myIssuesCache.key === key && Date.now() - myIssuesCache.at < LINEAR_READS.myIssuesTtlMs) {
    return myIssuesCache.value;
  }
  const data = await linearRequest<Data>("MyIssues", MY_ISSUES_QUERY, {});
  const value = groupIssues(nodesOf(recOf(data.viewer).assignedIssues));
  myIssuesCache = { key, at: Date.now(), value };
  return value;
}

type Data = Record<string, unknown>;

/** The workspace's address, people and teams; `fresh` skips the five-minute cache. */
export async function readWorkspace(fresh = false): Promise<LinearWorkspace> {
  const key = linearApiKey() ?? "";
  if (!fresh && workspaceCache && workspaceCache.key === key && Date.now() - workspaceCache.at < LINEAR_READS.workspaceTtlMs) {
    return workspaceCache.value;
  }
  const data = await linearRequest<Data>("Workspace", WORKSPACE_QUERY, {});
  const viewer = recOf(data.viewer);
  const viewerId = strOf(viewer.id);
  const users = nodesOf(data.users)
    .map((u) => userOf(u, viewerId))
    .filter(nonNull);
  if (viewerId && !users.some((u) => u.id === viewerId)) {
    const me = userOf(viewer, viewerId);
    if (me) users.push(me);
  }
  const urlKey = strOf(recOf(data.organization).urlKey);
  const value: LinearWorkspace = {
    viewerId,
    urlKey: /^[a-z0-9][a-z0-9-]{0,63}$/i.test(urlKey) ? urlKey.toLowerCase() : "",
    users,
    teams: nodesOf(data.teams)
      .map(teamOf)
      .filter(nonNull)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
  };
  workspaceCache = { key, at: Date.now(), value };
  return value;
}

/**
 * A page of your Inbox: 250 notifications not archived, the most recently
 * updated first (snoozed ones too; Activity hides them); `next` is the cursor
 * for the following page.
 */
export async function readNotifications(after?: string): Promise<{ notifications: LinearNotification[]; next?: string }> {
  const data = await linearRequest<Data>("Notifications", NOTIFICATIONS_QUERY, { first: LINEAR_READS.inboxSize, after });
  const page = recOf(data.notifications);
  const info = recOf(page.pageInfo);
  const next = strOf(info.endCursor);
  return {
    notifications: nodesOf(page)
      .map(notificationOf)
      .filter(nonNull)
      .filter((n) => !n.archivedAt),
    next: info.hasNextPage === true && next ? next : undefined,
  };
}

