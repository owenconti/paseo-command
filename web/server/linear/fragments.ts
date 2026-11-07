/** The GraphQL Activity's Linear source sends: the workspace's people and teams, and your Inbox. */

/** A notification, and what it's about: an issue (and comment), a project, or a pull request (its branch and title name its issue). */
export const NOTIFICATION_FIELDS = `id type title subtitle url createdAt updatedAt readAt snoozedUntilAt archivedAt
  actor { id }
  ... on IssueNotification { issue { id identifier } comment { id body } }
  ... on ProjectNotification { project { id } }
  ... on PullRequestNotification { pullRequest { id title sourceBranch } }`;

export const WORKSPACE_QUERY = `query Workspace {
  viewer { id name displayName avatarUrl }
  organization { urlKey }
  users(first: 250, filter: { active: { eq: true } }) { nodes { id name displayName avatarUrl } }
  teams(first: 100) { nodes { id key name } }
}`;

/** Your Inbox: notifications not archived, the most recently updated first, a page at a time. */
export const NOTIFICATIONS_QUERY = `query Notifications($first: Int!, $after: String) {
  notifications(first: $first, after: $after, orderBy: updatedAt) {
    nodes { ${NOTIFICATION_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

/**
 * Issues assigned to you that are open (started or unstarted) or completed since `$since`,
 * a page of 250, with what blocks them: their state's name, labels, and incoming relations
 * (`inverseRelations`: this issue is the relation's `relatedIssue`, so a `blocks` one's
 * `issue` blocks it). Connections are kept short to stay under Linear's complexity limit.
 */
export const ASSIGNED_ISSUES_QUERY = `query AssignedIssues($first: Int!, $after: String, $since: DateTimeOrDuration!) {
  viewer {
    assignedIssues(
      first: $first
      after: $after
      orderBy: updatedAt
      filter: { or: [
        { state: { type: { in: ["started", "unstarted"] } } }
        { state: { type: { eq: "completed" } }, completedAt: { gte: $since } }
      ] }
    ) {
      nodes {
        identifier title url completedAt
        state { type name }
        labels(first: 10) { nodes { name } }
        inverseRelations(first: 5) { nodes { type issue { state { type } } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;
