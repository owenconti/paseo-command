/** The field lists the named Linear operations ask for, shared so lists, details and sync agree. */

/** Everything the page keeps of one issue (no description, relations or links: those come with `Issue`). */
export const ISSUE_FIELDS = `id identifier title url priority estimate sortOrder dueDate branchName
  createdAt updatedAt archivedAt
  state { id } team { id } assignee { id } creator { id } project { id } projectMilestone { id }
  cycle { id } parent { id }
  labels(first: 30) { nodes { id } } subscribers(first: 30) { nodes { id } }`;

export const COMMENT_FIELDS = `id body createdAt editedAt updatedAt resolvedAt
  issue { id } parent { id } user { id } reactions { id emoji user { id } }`;

export const PROJECT_FIELDS = `id name icon color status { name } health lead { id } targetDate progress
  teams(first: 5) { nodes { id } } projectMilestones(first: 15) { nodes { id name } } url updatedAt`;

export const INITIATIVE_FIELDS = `id name status health owner { id } targetDate
  projects(first: 30) { nodes { id } } url updatedAt`;

export const WORKSPACE_QUERY = `query Workspace($projectCut: DateTimeOrDuration!) {
  viewer { id name displayName avatarUrl }
  users(first: 250, filter: { active: { eq: true } }) { nodes { id name displayName avatarUrl } }
  teams(first: 100) { nodes { id key name cyclesEnabled triageEnabled issueEstimationType issueEstimationAllowZero } }
  workflowStates(first: 250) { nodes { id name type color position team { id } } }
  issueLabels(first: 250) { nodes { id name color team { id } } }
  cycles(first: 100, filter: { or: [{ isActive: { eq: true } }, { isNext: { eq: true } }] }) {
    nodes { id number name startsAt endsAt isActive isNext team { id } }
  }
  projects(first: 250, filter: { and: [
    { or: [{ completedAt: { null: true } }, { completedAt: { gt: $projectCut } }] },
    { or: [{ canceledAt: { null: true } }, { canceledAt: { gt: $projectCut } }] }
  ] }) { nodes { ${PROJECT_FIELDS} } }
  initiatives(first: 100) { nodes { ${INITIATIVE_FIELDS} } }
}`;

export const ISSUES_QUERY = `query Issues($filter: IssueFilter, $first: Int!, $after: String) {
  issues(filter: $filter, first: $first, after: $after, orderBy: updatedAt) {
    nodes { ${ISSUE_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const ISSUE_QUERY = `query Issue($id: String!) {
  issue(id: $id) {
    ${ISSUE_FIELDS}
    description
    children(first: 100) { nodes { ${ISSUE_FIELDS} } }
    relations(first: 50) { nodes { id type relatedIssue { id } } }
    inverseRelations(first: 50) { nodes { id type issue { id } } }
    attachments(first: 20) { nodes { title url } }
    comments(first: 250) { nodes { ${COMMENT_FIELDS} } }
  }
}`;

export const SYNC_QUERY = `query Sync($since: DateTimeOrDuration!, $first: Int!) {
  issues(filter: { updatedAt: { gt: $since } }, includeArchived: true, first: $first, orderBy: updatedAt) {
    nodes { ${ISSUE_FIELDS} }
  }
  comments(filter: { updatedAt: { gt: $since } }, includeArchived: true, first: $first, orderBy: updatedAt) {
    nodes { ${COMMENT_FIELDS} }
  }
  projects(filter: { updatedAt: { gt: $since } }, includeArchived: true, first: $first, orderBy: updatedAt) {
    nodes { ${PROJECT_FIELDS} }
  }
  initiatives(filter: { updatedAt: { gt: $since } }, includeArchived: true, first: $first, orderBy: updatedAt) {
    nodes { ${INITIATIVE_FIELDS} }
  }
}`;
