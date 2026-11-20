/**
 * The Activity tab's shapes, shared by the server (`web/server/activity/`,
 * which gathers GitHub and Linear notifications into one feed) and the
 * page (`web/src/activity/`).
 */

export type ActivitySource = "github" | "linear";

/** What was said: the comment, review, line comment or description that notified you. */
export type ActivitySaid = {
  what: "comment" | "review" | "line comment" | "description";
  /** As one plain line (Markdown's marks, quoted replies and code blocks left out), clipped to 1,000 characters. */
  text: string;
  /** A review's, when it approved or asked for changes. */
  verdict?: "approved" | "changes requested";
  /** A line comment's file. */
  path?: string;
  /** Its own page (a comment's anchor). */
  url?: string;
};

export type ActivityItem = {
  /** Unique across sources: `<source>:<source's own id>`. */
  key: string;
  source: ActivitySource;
  /** The source's own id: a GitHub notification thread, a Linear notification. */
  id: string;
  /**
   * What happened, in the source's words, as a short kind:
   * GitHub: review_requested, mention, team_mention, author, comment, assign, ci_activity, state_change, subscribed, …
   * Linear: its notification type (issueNewComment, issueAssignedToYou, …).
   */
  kind: string;
  /** The line people read first: a PR's or issue's title. */
  title: string;
  /** A second line: a repo and number, an issue key, a comment's words (clipped to 300 characters). */
  subtitle?: string;
  /** What it's about, for its icon: pull, issue, release, discussion, commit, check; issue, project. */
  subject: string;
  /** Who did it, when known. */
  actor?: { name: string; avatarUrl?: string };
  /** When it last changed (ISO). */
  at: string;
  unread: boolean;
  /** Where it opens: a web address (GitHub's; Linear's, the issue's when it names one). */
  url?: string;
  /** What happened, as the source says it in a sentence (Linear's "Sam Rivera mentioned you"). */
  what?: string;
  /** What was said, when known (GitHub: read from the thread; Linear: the comment). */
  said?: ActivitySaid;
  /** GitHub: the PR's or issue's state, when known (open, closed, merged, draft). */
  state?: string;
};

export type ActivitySourceStatus = {
  source: ActivitySource;
  /** On in settings. */
  enabled: boolean;
  /** Answered this time; false with `reason` when it couldn't (no key or token, rate limited). */
  ok: boolean;
  reason?: string;
  /** Unread items from it. */
  unread: number;
  /** More source pages exist: this loaded Inbox count is a lower bound. */
  limited?: boolean;
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
