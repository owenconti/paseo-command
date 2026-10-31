/**
 * Turns Linear's GraphQL replies into the page's shared types. Everything is
 * clipped and checked here (titles 300, names 120, bodies 100000; colours
 * `#rrggbb`, else grey; https URLs only), so nothing Linear sends reaches the
 * page unchecked. Malformed records come back as null and are dropped.
 */
import type {
  LinearAttachment,
  LinearComment,
  LinearCustomView,
  LinearCycle,
  LinearInitiative,
  LinearIssue,
  LinearLabel,
  LinearNotification,
  LinearProject,
  LinearRelation,
  LinearState,
  LinearTeam,
  LinearUser,
} from "../../src/linear/types";

import { allowAvatar } from "./image";

type Raw = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const num = (v: unknown, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const nodes = (v: unknown): Raw[] => {
  const list = rec(v).nodes;
  return Array.isArray(list) ? list.map(rec) : [];
};
/** The id of a `{ id }` reference, "" when absent. */
const refId = (v: unknown) => str(rec(v).id);
const optId = (v: unknown) => refId(v) || undefined;

export const httpsUrl = (v: unknown) => {
  try {
    const url = new URL(str(v));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};
export const color = (v: unknown) => (/^#[0-9a-f]{6}$/i.test(str(v)) ? str(v) : "#8a8f98");

const STATE_TYPES = ["triage", "backlog", "unstarted", "started", "completed", "canceled"] as const;

export function userOf(raw: Raw, viewerId?: string): LinearUser | null {
  const id = str(raw.id);
  if (!id) return null;
  const name = clip(str(raw.name), 120);
  return {
    id,
    name,
    displayName: clip(str(raw.displayName), 120) || name,
    avatarUrl: httpsUrl(raw.avatarUrl) || undefined,
    ...(id === viewerId ? { me: true } : {}),
  };
}

/** The estimate values a team's estimation type allows; 0 only where the team allows it. */
export function estimatesOf(type: unknown, allowZero: unknown): number[] {
  const scale: Record<string, number[]> = {
    exponential: [0, 1, 2, 4, 8, 16],
    fibonacci: [0, 1, 2, 3, 5, 8],
    linear: [0, 1, 2, 3, 4, 5],
    tShirt: [0, 1, 2, 3, 5, 8],
  };
  return (scale[str(type)] ?? []).filter((v) => v !== 0 || allowZero === true);
}

export function teamOf(raw: Raw): LinearTeam | null {
  const id = str(raw.id);
  const key = clip(str(raw.key), 20);
  if (!id || !key) return null;
  return {
    id,
    key,
    name: clip(str(raw.name), 120),
    cyclesEnabled: raw.cyclesEnabled === true,
    triageEnabled: raw.triageEnabled === true,
    estimates: estimatesOf(raw.issueEstimationType, raw.issueEstimationAllowZero),
    ...(str(rec(raw.defaultIssueState).id) ? { defaultStateId: str(rec(raw.defaultIssueState).id) } : {}),
  };
}

export function stateOf(raw: Raw): LinearState | null {
  const id = str(raw.id);
  const teamId = refId(raw.team);
  const type = STATE_TYPES.find((t) => t === raw.type);
  if (!id || !teamId || !type) return null;
  return { id, name: clip(str(raw.name), 60), type, color: color(raw.color), position: num(raw.position), teamId };
}

export function labelOf(raw: Raw): LinearLabel | null {
  const id = str(raw.id);
  if (!id) return null;
  return { id, name: clip(str(raw.name), 120), color: color(raw.color), teamId: optId(raw.team) };
}

export function cycleOf(raw: Raw): LinearCycle | null {
  const id = str(raw.id);
  const teamId = refId(raw.team);
  if (!id || !teamId) return null;
  return {
    id,
    teamId,
    number: num(raw.number),
    name: clip(str(raw.name), 120) || undefined,
    startsAt: str(raw.startsAt),
    endsAt: str(raw.endsAt),
    isActive: raw.isActive === true,
    isNext: raw.isNext === true,
    // A team's cycles (`q/cycles`) carry their progress; the workspace's don't.
    ...("progress" in raw
      ? {
          isPast: raw.isPast === true,
          completedAt: str(raw.completedAt) || undefined,
          progress: Math.min(1, Math.max(0, num(raw.progress))),
          scope: lastCount(raw.issueCountHistory),
          done: lastCount(raw.completedIssueCountHistory),
        }
      : {}),
  };
}

/** The last of Linear's daily counts (a cycle's issues, its done ones); 0 before the first. */
const lastCount = (v: unknown) => {
  const last = Array.isArray(v) ? v[v.length - 1] : undefined;
  return Math.max(0, Math.round(num(last)));
};

/** Linear's words for a view's display, as the page's (`display.ts`); anything else is left to the default. */
const LAYOUT: Record<string, LinearCustomView["display"]["layout"]> = { list: "list", board: "board" };
const GROUPING: Record<string, LinearCustomView["display"]["grouping"]> = {
  workflowState: "status",
  status: "status",
  state: "status",
  assignee: "assignee",
  priority: "priority",
  project: "project",
  cycle: "cycle",
  noGrouping: "none",
  none: "none",
};
const ORDERING: Record<string, LinearCustomView["display"]["ordering"]> = {
  priority: "priority",
  updatedAt: "updated",
  updated: "updated",
  createdAt: "created",
  created: "created",
  manual: "manual",
  dueDate: "due",
  title: "title",
};
const COMPLETED: Record<string, LinearCustomView["display"]["completed"]> = {
  all: "all",
  pastMonth: "month",
  month: "month",
  pastWeek: "week",
  week: "week",
  pastDay: "week",
  none: "none",
};

/** An issue view; null for one of projects, initiatives or anything else. */
export function customViewOf(raw: Raw): LinearCustomView | null {
  const id = str(raw.id);
  if (!id || (str(raw.modelName) || "issue").toLowerCase() !== "issue") return null;
  const prefs = rec(raw.viewPreferencesValues);
  const pick = <T>(table: Record<string, T>, v: unknown): T | undefined =>
    Object.hasOwn(table, str(v)) ? table[str(v)] : undefined;
  const display: LinearCustomView["display"] = {};
  const layout = pick(LAYOUT, prefs.layout);
  const grouping = pick(GROUPING, prefs.issueGrouping);
  const ordering = pick(ORDERING, prefs.viewOrdering);
  const completed = pick(COMPLETED, prefs.showCompletedIssues);
  if (layout) display.layout = layout;
  if (grouping) display.grouping = grouping;
  if (ordering) display.ordering = ordering;
  if (completed) display.completed = completed;
  return {
    id,
    name: clip(str(raw.name), 120),
    description: clip(str(raw.description), 500) || undefined,
    icon: clip(str(raw.icon), 40) || undefined,
    color: color(raw.color),
    shared: raw.shared === true,
    teamId: optId(raw.team),
    ownerId: optId(raw.owner),
    updatedAt: str(raw.updatedAt),
    display,
  };
}

/** Linear's status is an object on projects and a plain word on initiatives. */
const statusName = (v: unknown) => clip(typeof v === "string" ? v : str(rec(v).name), 60);

export function projectOf(raw: Raw): LinearProject | null {
  const id = str(raw.id);
  if (!id) return null;
  const health = ["onTrack", "atRisk", "offTrack"].find((h) => h === raw.health) as LinearProject["health"];
  return {
    id,
    name: clip(str(raw.name), 120),
    icon: clip(str(raw.icon), 40) || undefined,
    color: color(raw.color),
    status: statusName(raw.status),
    health,
    leadId: optId(raw.lead),
    targetDate: str(raw.targetDate) || undefined,
    progress: Math.min(1, Math.max(0, num(raw.progress))),
    teamIds: nodes(raw.teams).map((t) => str(t.id)).filter(Boolean),
    milestones: nodes(raw.projectMilestones)
      .map((m) => ({ id: str(m.id), name: clip(str(m.name), 120) }))
      .filter((m) => m.id),
    url: httpsUrl(raw.url),
    updatedAt: str(raw.updatedAt),
  };
}

export function initiativeOf(raw: Raw): LinearInitiative | null {
  const id = str(raw.id);
  if (!id) return null;
  return {
    id,
    name: clip(str(raw.name), 120),
    status: statusName(raw.status),
    health: clip(str(raw.health), 30) || undefined,
    ownerId: optId(raw.owner),
    targetDate: str(raw.targetDate) || undefined,
    projectIds: nodes(raw.projects).map((p) => str(p.id)).filter(Boolean),
    url: httpsUrl(raw.url),
    updatedAt: str(raw.updatedAt),
  };
}

export function issueOf(raw: Raw): LinearIssue | null {
  const id = str(raw.id);
  const key = clip(str(raw.identifier).toUpperCase(), 30);
  const stateId = refId(raw.state);
  const teamId = refId(raw.team);
  if (!id || !key || !stateId || !teamId) return null;
  const priority = Number(raw.priority);
  return {
    id,
    key,
    title: clip(str(raw.title), 300),
    url: httpsUrl(raw.url),
    teamId,
    stateId,
    priority: (Number.isInteger(priority) && priority >= 0 && priority <= 4 ? priority : 0) as LinearIssue["priority"],
    estimate: typeof raw.estimate === "number" && Number.isFinite(raw.estimate) ? raw.estimate : undefined,
    assigneeId: optId(raw.assignee),
    creatorId: optId(raw.creator),
    labelIds: nodes(raw.labels).map((l) => str(l.id)).filter(Boolean),
    projectId: optId(raw.project),
    milestoneId: optId(raw.projectMilestone),
    cycleId: optId(raw.cycle),
    parentId: optId(raw.parent),
    dueDate: str(raw.dueDate) || undefined,
    branchName: clip(str(raw.branchName), 150),
    subscriberIds: nodes(raw.subscribers).map((u) => str(u.id)).filter(Boolean),
    sortOrder: num(raw.sortOrder),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    archivedAt: str(raw.archivedAt) || undefined,
    completedAt: str(raw.completedAt) || undefined,
    canceledAt: str(raw.canceledAt) || undefined,
  };
}

/** Relations from this issue's side: the ones it owns and the inverse ones other issues own. */
function relationsOf(raw: Raw): LinearRelation[] {
  const own: Record<string, LinearRelation["type"]> = { blocks: "blocks", related: "related", duplicate: "duplicate" };
  const inverse: Record<string, LinearRelation["type"]> = { blocks: "blocked_by", related: "related", duplicate: "duplicate_of" };
  const out: LinearRelation[] = [];
  for (const r of nodes(raw.relations)) {
    const type = own[str(r.type)];
    const issueId = refId(r.relatedIssue);
    if (type && str(r.id) && issueId) out.push({ id: str(r.id), type, issueId });
  }
  for (const r of nodes(raw.inverseRelations)) {
    const type = inverse[str(r.type)];
    const issueId = refId(r.issue);
    if (type && str(r.id) && issueId) out.push({ id: str(r.id), type, issueId });
  }
  return out;
}

/** An attachment, if it has an id and an http(s) address. */
export function attachmentOf(raw: Raw): LinearAttachment | null {
  const id = str(raw.id);
  const url = webUrl(raw.url);
  if (!id || !url) return null;
  return {
    id,
    title: clip(str(raw.title), 300),
    subtitle: clip(str(raw.subtitle), 300) || undefined,
    url,
    sourceType: clip(str(raw.sourceType), 40) || undefined,
    creatorId: optId(raw.creator),
    createdAt: str(raw.createdAt),
  };
}

/** An http or https address (links attached to issues may be either); "" for anything else. */
const webUrl = (v: unknown) => {
  try {
    const url = new URL(str(v));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
};

/** An issue with what only its details carry: description, children, relations and attachments. */
export function issueDetailOf(raw: Raw): LinearIssue | null {
  const issue = issueOf(raw);
  if (!issue) return null;
  return {
    ...issue,
    description: clip(str(raw.description), 100000),
    childIds: nodes(raw.children).map((c) => str(c.id)).filter(Boolean),
    relations: relationsOf(raw),
    attachments: nodes(raw.attachments)
      .map(attachmentOf)
      .filter((a): a is LinearAttachment => a !== null)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

export function commentOf(raw: Raw): LinearComment | null {
  const id = str(raw.id);
  const issueId = refId(raw.issue);
  if (!id || !issueId) return null;
  // Each emoji once, with who reacted and their reactions' ids (to take one's own away).
  const reactions = new Map<string, { userIds: string[]; ids: string[] }>();
  for (const r of Array.isArray(raw.reactions) ? raw.reactions.map(rec) : []) {
    const emoji = clip(str(r.emoji), 40);
    const userId = refId(r.user);
    const reactionId = str(r.id);
    if (!emoji || !userId || !reactionId) continue;
    const known = reactions.get(emoji) ?? { userIds: [], ids: [] };
    reactions.set(emoji, { userIds: [...known.userIds, userId], ids: [...known.ids, reactionId] });
  }
  return {
    id,
    issueId,
    parentId: optId(raw.parent),
    authorId: optId(raw.user),
    body: clip(str(raw.body), 100000),
    createdAt: str(raw.createdAt),
    editedAt: str(raw.editedAt) || undefined,
    resolvedAt: str(raw.resolvedAt) || undefined,
    reactions: [...reactions].map(([emoji, who]) => ({ emoji, ...who })),
  };
}

/** A notification, with the issue (or project) and comment it's about; null without an id. */
export function notificationOf(raw: Raw): LinearNotification | null {
  const id = str(raw.id);
  if (!id) return null;
  const issue = rec(raw.issue);
  const comment = rec(raw.comment);
  const key = clip(str(issue.identifier).toUpperCase(), 30);
  // The server may load this avatar for the page from now on: Linear named it.
  const avatar = httpsUrl(raw.actorAvatarUrl);
  if (avatar) allowAvatar(avatar);
  return {
    id,
    type: clip(str(raw.type), 60),
    title: clip(str(raw.title), 300),
    subtitle: clip(str(raw.subtitle), 300),
    url: httpsUrl(raw.url),
    actorId: optId(raw.actor),
    actorName: clip(str(rec(raw.botActor).name) || str(rec(raw.externalUserActor).name), 120) || undefined,
    actorAvatarUrl: avatar || undefined,
    actorInitials: clip(str(raw.actorInitials), 3) || undefined,
    actorColor: /^#[0-9a-f]{6}$/i.test(str(raw.actorAvatarColor)) ? str(raw.actorAvatarColor) : undefined,
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    readAt: str(raw.readAt) || undefined,
    snoozedUntilAt: str(raw.snoozedUntilAt) || undefined,
    archivedAt: str(raw.archivedAt) || undefined,
    issueId: str(issue.id) || undefined,
    issueKey: key || undefined,
    commentId: str(comment.id) || undefined,
    commentBody: clip(str(comment.body), 300) || undefined,
    reactionEmoji: clip(str(raw.reactionEmoji), 40) || undefined,
    projectId: optId(raw.project),
  };
}

export { nodes as nodesOf, rec as recOf, str as strOf };
