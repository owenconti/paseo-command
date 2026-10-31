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
  reactions: { emoji: string; userIds: string[] }[];
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
  | `project:${string}`;
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
