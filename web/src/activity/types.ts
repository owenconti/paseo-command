/**
 * The Activity tab's shapes, shared by the server (`web/server/activity/`,
 * which gathers GitHub, Linear and Slack notifications into one feed) and the
 * page (`web/src/activity/`).
 */

export type ActivitySource = "github" | "linear" | "slack";

export type ActivityItem = {
  /** Unique across sources: `<source>:<source's own id>`. */
  key: string;
  source: ActivitySource;
  /** The source's own id: a GitHub notification thread, a Linear notification, a Slack conversation + ts. */
  id: string;
  /**
   * What happened, in the source's words, as a short kind:
   * GitHub: review_requested, mention, team_mention, author, comment, assign, ci_activity, state_change, subscribed, …
   * Linear: its notification type (issueNewComment, issueAssignedToYou, …).
   * Slack: dm, mention, thread.
   */
  kind: string;
  /** The line people read first: a PR's or issue's title, a Slack conversation's name. */
  title: string;
  /** A second line: a repo and number, an issue key, the message's words (clipped to 300 characters). */
  subtitle?: string;
  /** What it's about, for its icon: pull, issue, release, discussion, commit, check; issue, project; message. */
  subject: string;
  /** Who did it, when known. */
  actor?: { name: string; avatarUrl?: string };
  /** When it last changed (ISO). */
  at: string;
  unread: boolean;
  /** Where it opens: a web address (GitHub, else the source's page). */
  url?: string;
  /** Where it opens in the app, when it can: a Linear issue (by key) or project, a Slack conversation or thread. */
  open?:
    | { kind: "linear-issue"; key: string }
    | { kind: "linear-project"; id: string }
    | { kind: "slack"; conversationId: string; ts?: string; threadTs?: string };
  /** GitHub: the PR's or issue's state, when known (open, closed, merged, draft). */
  state?: string;
};

export type ActivitySourceStatus = {
  source: ActivitySource;
  /** On in settings. */
  enabled: boolean;
  /** Answered this time; false with `reason` when it couldn't (no key, gh not signed in, rate limited). */
  ok: boolean;
  reason?: string;
  /** Unread items from it. */
  unread: number;
};

export type ActivityFeed = {
  items: ActivityItem[];
  sources: ActivitySourceStatus[];
  /** When the server gathered it (ISO). */
  at: string;
};

/** `POST /api/activity/m/<name>` with `{ keys: string[] }` (item keys). */
export type ActivityWriteName = "read" | "unread" | "done";
export type ActivityWriteResult = { feed: ActivityFeed; failed?: { key: string; error: string }[] };
