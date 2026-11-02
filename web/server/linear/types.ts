/** What the server reads of Linear for Activity: your Inbox, and the workspace's people and teams. */
export type LinearUser = { id: string; name: string; displayName: string; avatarUrl?: string; me?: boolean };
export type LinearTeam = { id: string; key: string; name: string };
export type LinearNotification = {
  id: string;
  /** Linear's kind of notification ("issueNewComment", "issueAssignedToYou"…). */
  type: string;
  title: string;
  subtitle: string;
  url: string;
  actorId?: string;
  createdAt: string;
  updatedAt: string;
  readAt?: string;
  /** Hidden from the Inbox until then. */
  snoozedUntilAt?: string;
  archivedAt?: string;
  issueId?: string;
  issueKey?: string;
  /** The comment it's about, its words clipped to 300 characters. */
  commentId?: string;
  commentBody?: string;
  projectId?: string;
  /** A pull request notification's pull request, and the issue keys its branch and title name (any team's). */
  pullRequestId?: string;
  pullRequestIssueKeys?: string[];
};
export type LinearWorkspace = {
  viewerId: string;
  /** The workspace's address on linear.app (`linear.app/<urlKey>/…`), "" when Linear doesn't say. */
  urlKey: string;
  users: LinearUser[];
  teams: LinearTeam[];
};
export type LinearBudget = { requestsRemaining: number; complexityRemaining: number; resetAt: number };
export type WriteName = "notificationMarkReadAll" | "notificationMarkUnreadAll" | "notificationArchiveAll";
