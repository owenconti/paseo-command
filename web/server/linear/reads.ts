/**
 * Linear's named reads, for Activity's Linear source: the workspace's people
 * and teams, and a page of your Inbox. Each throws a LinearError when Linear
 * can't answer; the workspace is kept for five minutes.
 */
import type { LinearNotification, LinearWorkspace } from "./types";
import type { IssueCountItem, IssueCountsAnswer, IssueGroup } from "../../src/villageCounts";
import { integrationEnabled } from "../integrations";
import { DISABLED, LinearError, linearApiKey, linearRequest, NO_KEY } from "./client";
import { ASSIGNED_ISSUES_QUERY, NOTIFICATIONS_QUERY, WORKSPACE_QUERY } from "./fragments";
import { httpsUrl, nodesOf, notificationOf, recOf, strOf, teamOf, userOf } from "./normalize";

export const LINEAR_READS = {
  workspaceTtlMs: 5 * 60_000,
  inboxSize: 250,
  /** Your assigned issues: one page of this many, kept this long, done counted over this many days, this many of each group listed. */
  issuesPage: 250,
  /** At most this many assigned issues are read (pages of `issuesPage`); past it the counts are lower bounds. */
  issuesMax: 2000,
  issueCountsTtlMs: 60_000,
  doneDays: 14,
  itemsMax: 12,
  titleMax: 120,
};

const nonNull = <T>(v: T | null): v is T => v !== null;

let workspaceCache: { key: string; at: number; value: LinearWorkspace } | undefined;
const issueCountsCache = new Map<string, { at: number; value: Promise<IssueCountsAnswer> }>();

/** Forgets what the reads kept (tests). */
export function resetLinearReads(): void {
  workspaceCache = undefined;
  issueCountsCache.clear();
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

// ── Your issues, counted (the Village's dashboard) ─────────────────────────────
const isBlockedWord = (v: unknown) => strOf(v).trim().toLowerCase() === "blocked";
const OPEN = new Set(["started", "unstarted"]);

/**
 * Whether an open issue is blocked: its state or a label is named "Blocked", or an
 * issue that isn't completed or canceled blocks it.
 */
export function isBlocked(issue: Record<string, unknown>): boolean {
  if (isBlockedWord(recOf(issue.state).name)) return true;
  if (nodesOf(issue.labels).some((l) => isBlockedWord(l.name))) return true;
  return nodesOf(issue.inverseRelations).some((r) => {
    if (strOf(r.type) !== "blocks") return false;
    const by = strOf(recOf(recOf(r.issue).state).type);
    return by !== "completed" && by !== "canceled";
  });
}

const clipTitle = (s: string) => (s.length > LINEAR_READS.titleMax ? `${s.slice(0, LINEAR_READS.titleMax - 1)}…` : s);

function issueItem(raw: Record<string, unknown>): IssueCountItem | null {
  const id = strOf(raw.identifier);
  const url = httpsUrl(raw.url);
  if (!/^[A-Za-z0-9]+-\d+$/.test(id) || !url.startsWith("https://linear.app/")) return null;
  return { id, title: clipTitle(strOf(raw.title).trim()), url };
}

/** Counts one page of assigned issues into done, in progress, todo and blocked (blocked ones only there). */
export function countIssues(issues: Record<string, unknown>[], since: number): Extract<IssueCountsAnswer, { state: "ok" }> {
  const groups: Record<IssueGroup, { at: string; item: IssueCountItem }[]> = { done: [], inProgress: [], todo: [], blocked: [] };
  for (const raw of issues) {
    const item = issueItem(raw);
    if (!item) continue;
    const type = strOf(recOf(raw.state).type);
    if (type === "completed") {
      const at = strOf(raw.completedAt);
      const time = Date.parse(at);
      if (Number.isFinite(time) && time >= since) groups.done.push({ at, item });
    } else if (OPEN.has(type)) {
      groups[isBlocked(raw) ? "blocked" : type === "started" ? "inProgress" : "todo"].push({ at: "", item });
    }
  }
  // The newest completed first; the others keep Linear's order (most recently updated first).
  groups.done.sort((a, b) => b.at.localeCompare(a.at));
  const keys = Object.keys(groups) as IssueGroup[];
  return {
    state: "ok",
    counts: Object.fromEntries(keys.map((k) => [k, groups[k].length])) as Record<IssueGroup, number>,
    items: Object.fromEntries(keys.map((k) => [k, groups[k].slice(0, LINEAR_READS.itemsMax).map((g) => g.item)])) as Record<IssueGroup, IssueCountItem[]>,
  };
}

async function askIssueCounts(): Promise<IssueCountsAnswer> {
  const since = Date.now() - LINEAR_READS.doneDays * 86_400_000;
  try {
    // Page through them, up to `issuesMax`; past that the counts are "at least".
    const issues: Record<string, unknown>[] = [];
    let after: string | undefined;
    let more = true;
    while (more && issues.length < LINEAR_READS.issuesMax) {
      const data = await linearRequest<Data>("AssignedIssues", ASSIGNED_ISSUES_QUERY, {
        first: Math.min(LINEAR_READS.issuesPage, LINEAR_READS.issuesMax - issues.length),
        ...(after ? { after } : {}),
        since: new Date(since).toISOString(),
      });
      const page = recOf(recOf(data.viewer).assignedIssues);
      issues.push(...nodesOf(page));
      const info = recOf(page.pageInfo);
      after = strOf(info.endCursor) || undefined;
      more = info.hasNextPage === true && !!after;
    }
    const counted = countIssues(issues, since);
    return more ? { ...counted, atLeast: ["done", "inProgress", "todo", "blocked"] } : counted;
  } catch (e) {
    if (!(e instanceof LinearError)) return { state: "error", message: "Linear failed." };
    if (e.kind === "no-key") return integrationEnabled("linear") ? { state: "no-key", message: NO_KEY } : { state: "off", message: DISABLED };
    return { state: "error", message: e.message };
  }
}

/**
 * The issues assigned to you, counted (`countIssues`), or why not: Linear off, no key,
 * or Linear's error. Kept a minute per key (`fresh` asks again); a failure isn't kept.
 */
export async function readIssueCounts(fresh = false): Promise<IssueCountsAnswer> {
  if (!integrationEnabled("linear")) return { state: "off", message: DISABLED };
  const key = linearApiKey();
  if (!key) return { state: "no-key", message: NO_KEY };
  const hit = issueCountsCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < LINEAR_READS.issueCountsTtlMs) return hit.value;
  const entry = { at: Date.now(), value: askIssueCounts() };
  issueCountsCache.set(key, entry);
  const value = await entry.value;
  if (value.state !== "ok" && issueCountsCache.get(key) === entry) issueCountsCache.delete(key);
  return value;
}
