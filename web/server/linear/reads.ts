/**
 * Linear's named reads: the workspace, issue lists by scope, issues by id, one
 * issue with its comments, and one sync request for what changed since a cursor. Each throws
 * a LinearError when Linear can't answer; the workspace is kept for five minutes.
 */
import type {
  IssueScope,
  LinearBudget,
  LinearComment,
  LinearCustomView,
  LinearCycle,
  LinearIssue,
  LinearNotification,
  LinearSync,
  LinearWorkspace,
} from "../../src/linear/types";
import { LinearError, linearApiKey, linearBudget, linearRequest } from "./client";
import {
  CYCLES_QUERY,
  ISSUES_QUERY,
  ISSUE_QUERY,
  NOTIFICATIONS_QUERY,
  SEARCH_QUERY,
  SYNC_QUERY,
  VIEW_ISSUES_QUERY,
  VIEWS_QUERY,
  WORKSPACE_QUERY,
} from "./fragments";
import {
  commentOf,
  customViewOf,
  cycleOf,
  initiativeOf,
  issueDetailOf,
  issueOf,
  labelOf,
  nodesOf,
  notificationOf,
  projectOf,
  recOf,
  stateOf,
  strOf,
  teamOf,
  userOf,
} from "./normalize";

export const LINEAR_READS = {
  workspaceTtlMs: 5 * 60_000,
  pageSize: 250,
  syncSize: 100,
  maxIds: 50,
  searchSize: 50,
  inboxSize: 250,
  /** Linear allows 30 searches a minute; the server keeps under that. */
  searchesPerMinute: 25,
};

const DAY = 86_400_000;
const KEY = /^[a-z][a-z0-9]{0,9}-\d{1,6}$/i;
const ID = /^[0-9a-f-]{8,64}$/i;
const nonNull = <T>(v: T | null): v is T => v !== null;

let workspaceCache: { key: string; at: number; value: LinearWorkspace } | undefined;

/** Forgets what the reads kept (tests). */
export function resetLinearReads(): void {
  workspaceCache = undefined;
  searches = [];
}

type Data = Record<string, unknown>;

/** The people, teams, states, labels, cycles, projects and initiatives; `fresh` skips the five-minute cache. */
export async function readWorkspace(fresh = false): Promise<LinearWorkspace> {
  const key = linearApiKey() ?? "";
  if (!fresh && workspaceCache && workspaceCache.key === key && Date.now() - workspaceCache.at < LINEAR_READS.workspaceTtlMs) {
    return workspaceCache.value;
  }
  const projectCut = new Date(Date.now() - 30 * DAY).toISOString();
  const data = await linearRequest<Data>("Workspace", WORKSPACE_QUERY, { projectCut });
  const viewer = recOf(data.viewer);
  const viewerId = strOf(viewer.id);
  const users = nodesOf(data.users)
    .map((u) => userOf(u, viewerId))
    .filter(nonNull);
  if (viewerId && !users.some((u) => u.id === viewerId)) {
    const me = userOf(viewer, viewerId);
    if (me) users.push(me);
  }
  const value: LinearWorkspace = {
    viewerId,
    users,
    // By name, as the sidebar lists them.
    teams: nodesOf(data.teams)
      .map(teamOf)
      .filter(nonNull)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })),
    states: nodesOf(data.workflowStates).map(stateOf).filter(nonNull).sort((a, b) => a.position - b.position),
    labels: nodesOf(data.issueLabels).map(labelOf).filter(nonNull),
    cycles: nodesOf(data.cycles).map(cycleOf).filter(nonNull),
    projects: nodesOf(data.projects).map(projectOf).filter(nonNull),
    initiatives: nodesOf(data.initiatives).map(initiativeOf).filter(nonNull),
  };
  workspaceCache = { key, at: Date.now(), value };
  return value;
}

const OPEN = { state: { type: { nin: ["completed", "canceled"] } } };

/** How far back a team's All and a project's list keep finished issues (the Display's "Past month"). */
export const FINISHED_DAYS = 30;

/** Linear's issue filter for a scope; `all` and `project:` also keep what finished in the last 30 days, `cycle:` everything in it. */
function filterFor(scope: IssueScope): Record<string, unknown> {
  const recent = new Date(Date.now() - FINISHED_DAYS * DAY).toISOString();
  const openOrRecent = {
    or: [OPEN, { completedAt: { gt: recent } }, { canceledAt: { gt: recent } }],
  };
  if (scope === "assigned") return { assignee: { isMe: { eq: true } }, ...OPEN };
  if (scope === "created") return { creator: { isMe: { eq: true } }, ...OPEN };
  if (scope === "subscribed") return { subscribers: { some: { isMe: { eq: true } } }, ...OPEN };
  const project = /^project:(.+)$/.exec(scope)?.[1];
  if (project !== undefined) {
    if (!ID.test(project)) throw new LinearError("invalid", "Unknown issue scope.");
    return { project: { id: { eq: project } }, ...openOrRecent };
  }
  const cycle = /^cycle:(.+)$/.exec(scope)?.[1];
  if (cycle !== undefined) {
    if (!ID.test(cycle)) throw new LinearError("invalid", "Unknown issue scope.");
    return { cycle: { id: { eq: cycle } } };
  }
  const team = /^team:([^:]+):(triage|active|backlog|all)$/.exec(scope);
  if (!team || !ID.test(team[1])) throw new LinearError("invalid", "Unknown issue scope.");
  const [, teamId, view] = team;
  const byTeam = { team: { id: { eq: teamId } } };
  if (view === "all") return { ...byTeam, ...openOrRecent };
  const types = { triage: ["triage"], active: ["unstarted", "started"], backlog: ["backlog"] }[view]!;
  return { ...byTeam, state: { type: { in: types } } };
}

/** How far back a team's past cycles go. */
const PAST_CYCLES_DAYS = 120;

/** A team's cycles with their progress: current, upcoming, and those that ended in the last 120 days. */
export async function readCycles(teamId: string): Promise<{ cycles: LinearCycle[] }> {
  if (!ID.test(teamId)) throw new LinearError("invalid", "Invalid team id");
  const cut = new Date(Date.now() - PAST_CYCLES_DAYS * DAY).toISOString();
  const data = await linearRequest<Data>("Cycles", CYCLES_QUERY, { teamId, cut });
  return {
    cycles: nodesOf(data.cycles)
      .map(cycleOf)
      .filter(nonNull)
      .filter((c) => c.teamId === teamId)
      .sort((a, b) => b.number - a.number),
  };
}

/** The issue views you can see, yours and shared (not those of projects or initiatives). */
export async function readViews(): Promise<{ views: LinearCustomView[] }> {
  const data = await linearRequest<Data>("CustomViews", VIEWS_QUERY, {});
  return {
    views: nodesOf(data.customViews)
      .map(customViewOf)
      .filter(nonNull)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

let searches: number[] = [];

/**
 * Up to 50 issues anywhere in the workspace matching `term` (1–200
 * characters), most relevant first. Linear allows 30 searches a minute: past
 * 25 in the last minute this refuses as limited until the oldest is a minute old.
 */
export async function readSearch(term: string): Promise<{ issues: LinearIssue[] }> {
  const trimmed = term.trim();
  if (!trimmed || trimmed.length > 200) throw new LinearError("invalid", "Search for 1 to 200 characters");
  const now = Date.now();
  searches = searches.filter((at) => now - at < 60_000);
  if (searches.length >= LINEAR_READS.searchesPerMinute)
    throw new LinearError("limited", "Searching too fast for Linear; try again in a moment.", searches[0] + 60_000);
  searches.push(now);
  const data = await linearRequest<Data>("SearchIssues", SEARCH_QUERY, { term: trimmed, first: LINEAR_READS.searchSize });
  return { issues: nodesOf(data.searchIssues).map(issueOf).filter(nonNull) };
}

/** One page of a scope's issues, most recently updated first; `next` is the cursor for the following page. */
export async function readIssues(
  scope: IssueScope,
  after?: string,
  first = LINEAR_READS.pageSize,
): Promise<{ issues: LinearIssue[]; next?: string }> {
  // A view's issues are its own filter's, which Linear applies.
  const view = /^view:(.+)$/.exec(scope)?.[1];
  if (view !== undefined && !ID.test(view)) throw new LinearError("invalid", "Unknown issue scope.");
  const data = view
    ? recOf((await linearRequest<Data>("ViewIssues", VIEW_ISSUES_QUERY, { id: view, first, after })).customView)
    : await linearRequest<Data>("Issues", ISSUES_QUERY, { filter: filterFor(scope), first, after });
  const page = recOf(data.issues);
  const info = recOf(page.pageInfo);
  const next = strOf(info.endCursor);
  return {
    issues: nodesOf(page).map(issueOf).filter(nonNull),
    next: info.hasNextPage === true && next ? next : undefined,
  };
}

/**
 * Up to 50 issues by id, in one request: those Linear still lists (not
 * archived, deleted or out of reach). The page asks this for issues a scope's
 * load no longer returned, to learn where they went.
 */
export async function readIssuesById(ids: string[]): Promise<{ issues: LinearIssue[] }> {
  const unique = [...new Set(ids.map((id) => id.trim().toLowerCase()))];
  if (!unique.length || unique.length > LINEAR_READS.maxIds || !unique.every((id) => ID.test(id)))
    throw new LinearError("invalid", "Invalid issue ids");
  const data = await linearRequest<Data>("Issues", ISSUES_QUERY, { filter: { id: { in: unique } }, first: unique.length });
  return { issues: nodesOf(recOf(data.issues)).map(issueOf).filter(nonNull) };
}

/** One issue by key (or id) with its description, children, relations, attachments and comments; null when Linear has none. */
export async function readIssue(
  rawKey: string,
): Promise<{ issue: LinearIssue; comments: LinearComment[]; children: LinearIssue[] } | null> {
  const trimmed = rawKey.trim();
  const key = ID.test(trimmed) && !KEY.test(trimmed) ? trimmed.toLowerCase() : trimmed.toUpperCase();
  if (!KEY.test(key) && !ID.test(key)) throw new LinearError("invalid", "Invalid issue key");
  let data: Data;
  try {
    data = await linearRequest<Data>("Issue", ISSUE_QUERY, { id: key });
  } catch (e) {
    if (e instanceof LinearError && e.kind === "invalid" && /could not find|not found/i.test(e.message)) return null;
    throw e;
  }
  const raw = recOf(data.issue);
  const issue = issueDetailOf(raw);
  if (!issue) return null;
  return {
    issue,
    comments: nodesOf(raw.comments)
      .map(commentOf)
      .filter(nonNull)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    children: nodesOf(raw.children).map(issueOf).filter(nonNull),
  };
}

/**
 * A page of your Inbox: 250 notifications not archived, the most recently
 * updated first (snoozed ones too; the page hides them); `next` is the cursor
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

/**
 * Everything that changed since `since`, in one request. `cursor` is the newest
 * `updatedAt` seen (else `since`); `more` says a list hit its 100, so the
 * answer may be missing older changes and the caller should reload.
 */
export async function readSync(since: string): Promise<LinearSync> {
  const at = Date.parse(since);
  if (!Number.isFinite(at)) throw new LinearError("invalid", "Invalid sync cursor");
  const first = LINEAR_READS.syncSize;
  const data = await linearRequest<Data>("Sync", SYNC_QUERY, { since: new Date(at).toISOString(), first });
  const issueNodes = nodesOf(data.issues);
  const commentNodes = nodesOf(data.comments);
  const projectNodes = nodesOf(data.projects);
  const initiativeNodes = nodesOf(data.initiatives);
  const notificationNodes = nodesOf(data.notifications);
  let newest = at;
  for (const raw of [...issueNodes, ...commentNodes, ...projectNodes, ...initiativeNodes, ...notificationNodes]) {
    const t = Date.parse(strOf(raw.updatedAt));
    if (Number.isFinite(t) && t > newest) newest = t;
  }
  return {
    cursor: newest === at ? since : new Date(newest).toISOString(),
    issues: issueNodes.map(issueOf).filter(nonNull),
    comments: commentNodes.map(commentOf).filter(nonNull),
    projects: projectNodes.map(projectOf).filter(nonNull),
    initiatives: initiativeNodes.map(initiativeOf).filter(nonNull),
    notifications: notificationNodes.map(notificationOf).filter(nonNull),
    more: [issueNodes, commentNodes, projectNodes, initiativeNodes, notificationNodes].some(
      (list) => list.length >= first,
    ),
  };
}

/** Whether a key is set, and what the last reply said was left of the hourly budget. */
export function readStatus(): { configured: boolean; budget: LinearBudget | null } {
  return { configured: Boolean(linearApiKey()), budget: linearBudget() };
}
