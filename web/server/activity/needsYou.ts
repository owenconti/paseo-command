/**
 * Which notifications Activity shows: those that ask something of you, not
 * everything the sources send (the user's call). Being asked to review, or
 * assigned, a pull request or issue is left out, since the GitHub tab's
 * pull request lists (and Linear's own views) already show those; so are
 * watching, state changes, CI and reactions. Mentions, replies on your
 * threads, deadlines and requests only you can answer stay.
 */

/** Off, every notification shows, as before (the sources' tests of their own shapes). */
export const ACTIVITY_NEEDS_YOU = { only: true };

/**
 * GitHub's reasons that need you: a mention (yours or your team's), a
 * comment on a thread you started or commented on, a security alert, a
 * deployment waiting on your approval and an invitation. Not
 * `review_requested`, `assign`, `subscribed`, `manual`, `state_change`,
 * `ci_activity` and the rest.
 */
const GITHUB_NEEDS_YOU = new Set([
  "mention",
  "team_mention",
  "author",
  "comment",
  "security_alert",
  "approval_requested",
  "invitation",
]);

export const githubNeedsYou = (reason: string) => !ACTIVITY_NEEDS_YOU.only || GITHUB_NEEDS_YOU.has(reason);

/**
 * Linear's notification types that need you: any mention (an issue's, a
 * comment's, a project update's, a document's), a new comment on an issue or
 * project update you follow, a due date or reminder, and a project update
 * asked of you. Not assignments, status or priority changes, subscriptions,
 * reactions or new issues, nor Linear's pull request notifications (GitHub's
 * already say what needs you there).
 */
const LINEAR_NEEDS_YOU = new Set([
  "issueNewComment",
  "projectUpdateNewComment",
  "issueDue",
  "issueReminder",
  "projectUpdatePrompt",
]);

export const linearNeedsYou = (type: string) =>
  !ACTIVITY_NEEDS_YOU.only || /mention/i.test(type) || LINEAR_NEEDS_YOU.has(type);
