/** Linear's shapes as the server sends them and the page keeps them (no API key ever reaches the page). */
export type LinearUser = { id: string; name: string; displayName: string; avatarUrl?: string; me?: boolean };
export type LinearState = {
  id: string;
  name: string;
  type: "triage" | "backlog" | "unstarted" | "started" | "completed" | "canceled";
  color: string;
  position: number;
  teamId: string;
};
export type LinearLabel = { id: string; name: string; color: string; teamId?: string };
export type LinearTeam = {
  id: string;
  key: string;
  name: string;
  cyclesEnabled: boolean;
  triageEnabled: boolean;
  /** The estimate values the team's estimation type allows; [] when estimates are off. */
  estimates: number[];
  /** The status Linear gives a new issue of the team when none is chosen. */
  defaultStateId?: string;
};
export type LinearCycle = {
  id: string;
  teamId: string;
  number: number;
  name?: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  isNext: boolean;
  /** The rest come with a team's cycles (`q/cycles`), not with the workspace's. */
  isPast?: boolean;
  completedAt?: string;
  /** Done, of 0–1, as Linear counts it (estimates where the team uses them). */
  progress?: number;
  /** Issues in the cycle, and those done, as of Linear's last count. */
  scope?: number;
  done?: number;
};
/** A saved custom view of issues (Linear's Views), with its own display as set in Linear, in the page's words. */
export type LinearCustomView = {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color: string;
  /** Shared with the workspace (or its team), else yours alone. */
  shared: boolean;
  teamId?: string;
  ownerId?: string;
  updatedAt: string;
  display: {
    layout?: "list" | "board";
    grouping?: "status" | "assignee" | "priority" | "project" | "cycle" | "none";
    ordering?: "priority" | "updated" | "created" | "manual" | "due" | "title";
    completed?: "all" | "week" | "month" | "none";
  };
};
export type LinearProject = {
  id: string;
  name: string;
  icon?: string;
  color: string;
  status: string;
  health?: "onTrack" | "atRisk" | "offTrack";
  leadId?: string;
  targetDate?: string;
  progress: number;
  teamIds: string[];
  milestones: { id: string; name: string }[];
  url: string;
  updatedAt: string;
};
export type LinearInitiative = {
  id: string;
  name: string;
  status: string;
  health?: string;
  ownerId?: string;
  targetDate?: string;
  projectIds: string[];
  url: string;
  updatedAt: string;
};
/** Always from this issue's side: inverse relations are mapped to blocked_by / duplicate_of. */
export type LinearRelation = {
  id: string;
  type: "blocks" | "blocked_by" | "related" | "duplicate" | "duplicate_of";
  issueId: string;
};
export type LinearIssue = {
  id: string;
  key: string;
  title: string;
  url: string;
  teamId: string;
  stateId: string;
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: 0 | 1 | 2 | 3 | 4;
  estimate?: number;
  assigneeId?: string;
  creatorId?: string;
  labelIds: string[];
  projectId?: string;
  milestoneId?: string;
  cycleId?: string;
  parentId?: string;
  dueDate?: string;
  branchName: string;
  subscriberIds: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
  /** When it was finished: done, or canceled. */
  completedAt?: string;
  canceledAt?: string;
  /** The last four only come with one issue's details (`q/issue`). */
  description?: string;
  childIds?: string[];
  relations?: LinearRelation[];
  links?: { title: string; url: string }[];
};
export type LinearComment = {
  id: string;
  issueId: string;
  parentId?: string;
  authorId?: string;
  body: string;
  createdAt: string;
  editedAt?: string;
  resolvedAt?: string;
  /** Each emoji once: who reacted, and each one's reaction id (`ids[i]` is `userIds[i]`'s). */
  reactions: { emoji: string; userIds: string[]; ids: string[] }[];
};
export type LinearWorkspace = {
  viewerId: string;
  users: LinearUser[];
  teams: LinearTeam[];
  states: LinearState[];
  labels: LinearLabel[];
  cycles: LinearCycle[];
  projects: LinearProject[];
  initiatives: LinearInitiative[];
};
export type LinearSync = {
  cursor: string;
  issues: LinearIssue[];
  comments: LinearComment[];
  projects: LinearProject[];
  initiatives: LinearInitiative[];
  more: boolean;
};
export type LinearBudget = { requestsRemaining: number; complexityRemaining: number; resetAt: number };
export type LinearUnavailable = { available: false; reason: string; retryAt?: number };
export type IssueScope =
  | "assigned"
  | "created"
  | "subscribed"
  | `team:${string}:${"triage" | "active" | "backlog" | "all"}`
  | `project:${string}`
  | `cycle:${string}`
  | `view:${string}`
  | `search:${string}`;
export type WriteName =
  | "issueUpdate"
  | "issueCreate"
  | "issueArchive"
  | "issueUnarchive"
  | "issueDelete"
  | "issueSubscribe"
  | "issueUnsubscribe"
  | "issueRelationCreate"
  | "issueRelationDelete"
  | "commentCreate"
  | "commentUpdate"
  | "commentDelete"
  | "commentResolve"
  | "commentUnresolve"
  | "reactionCreate"
  | "reactionDelete";
