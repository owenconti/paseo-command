/**
 * The GitHub tab's wire types, shared by the page (`web/src/github/`) and the
 * server (`web/server/github/`, `GET /api/changes`).
 *
 * Reads: `GET /api/github/q/viewer|prs|pr|diff` (named, no passthrough) and
 * `GET /api/changes?workspace=<id>[&host=<id>][&mode=all|base|uncommitted]`
 * (the workspace's branch against its base, from the daemon). A read that
 * can't be answered right now (GitHub off, no GitHub token or a refused one, not a git
 * checkout) answers `GithubUnavailable`, not an error.
 * Writes: `POST /api/github/m/<GithubWriteName>` with `GithubWriteInputs[name]`,
 * each field checked; they fail with GitHub's message.
 */

/** A read that can't be answered right now, and why, in words for the view. */
export type GithubUnavailable = { available: false; reason: string };

// ── Diffs ────────────────────────────────────────────────────────────────────
/** A run of a line's text and its highlight style (the daemon's tokens; none for PR diffs). */
export type DiffToken = { text: string; style: string | null };
/** One line of a hunk; a hunk's first line is its `@@ … @@` header. */
export type DiffLine = { type: "context" | "add" | "remove" | "header"; content: string; tokens?: DiffToken[] };
export type DiffHunk = { oldStart: number; oldCount: number; newStart: number; newCount: number; lines: DiffLine[] };
/** One file's changes, as the daemon's `ParsedDiffFile` (PR diffs are parsed to the same shape). */
export type DiffFile = {
  path: string;
  /** Where it was before a rename. */
  oldPath?: string;
  isNew: boolean;
  isDeleted: boolean;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
  /** `binary` and `too_large` files have no hunks. */
  status?: "ok" | "binary" | "too_large";
};

/** Which changes a workspace's diff shows: committed and uncommitted (all), committed only (base), or uncommitted only. */
export type ChangesMode = "all" | "base" | "uncommitted";
export const CHANGES_MODES: ChangesMode[] = ["all", "base", "uncommitted"];

/** The workspace's PR, when Paseo or GitHub knows it. */
export type ChangesPr = { number: number; url: string; title: string; state: string; repo?: string };

/** `GET /api/changes`: the workspace's branch against its base (main). */
export type WorkspaceChanges = {
  cwd: string;
  branch: string | null;
  /** What it's compared with (`main`), as the daemon chose. */
  baseRef: string | null;
  mode: ChangesMode;
  files: DiffFile[];
  /** The daemon left files out: the diff is too large to show whole. */
  tooLarge: boolean;
  /** Commits ahead of and behind the base. */
  ahead?: number;
  behind?: number;
  /** Uncommitted changes in the checkout. */
  dirty?: boolean;
  /** `owner/name`, from the checkout's remote when it's GitHub. */
  repo?: string;
  pr?: ChangesPr | null;
};

// ── Pull requests ────────────────────────────────────────────────────────────
export type Person = { login: string; name?: string; avatarUrl?: string };

export type PrState = "open" | "draft" | "merged" | "closed";
/** The PR's review decision: approved, changes requested, or review required. */
export type ReviewDecision = "approved" | "changes" | "review";
export type ChecksState = "passing" | "failing" | "pending";
/** Your own latest review of it. */
export type YourReview = "approved" | "changes" | "commented" | "pending";

/** The lists in the sidebar: review requested from you, yours, and those involving you. */
export type PrScope = "review" | "mine" | "involved";
export const PR_SCOPES: PrScope[] = ["review", "mine", "involved"];

/** A PR in a list. `repo` is `owner/name`. */
export type PrRow = {
  /** GitHub's node id. */
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  author: Person | null;
  state: PrState;
  createdAt: string;
  updatedAt: string;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: number;
  reviewDecision: ReviewDecision | null;
  checks: ChecksState | null;
  yourReview: YourReview | null;
  labels: { name: string; color: string }[];
};

/** `GET /api/github/q/prs?scope=…`: open PRs, most recently updated first (at most 50). */
export type PrList = { scope: PrScope; rows: PrRow[]; viewer: Person };

/** A changed file in the PR, as GitHub lists it, with whether you've marked it viewed. */
export type PrFile = {
  path: string;
  additions: number;
  deletions: number;
  changeType: "added" | "deleted" | "modified" | "renamed" | "copied" | "changed";
  viewed: "viewed" | "unviewed" | "dismissed";
};

export type ReviewComment = {
  /** GitHub's node id. */
  id: string;
  /** The REST id (replies go to it). */
  databaseId: number;
  author: Person | null;
  body: string;
  createdAt: string;
  url: string;
};

/** A review comment thread on a line (or lines) of a file. */
export type ReviewThread = {
  id: string;
  path: string;
  /** The line it's on in the current diff (null once outdated). */
  line: number | null;
  /** Where a multi-line comment starts. */
  startLine: number | null;
  /** RIGHT is the new file, LEFT the old. */
  side: "LEFT" | "RIGHT";
  isResolved: boolean;
  isOutdated: boolean;
  canResolve: boolean;
  canReply: boolean;
  comments: ReviewComment[];
};

/** The conversation: comments and submitted reviews, oldest first. */
export type TimelineEntry =
  | { kind: "comment"; id: string; author: Person | null; body: string; createdAt: string; url: string }
  | {
      kind: "review";
      id: string;
      author: Person | null;
      state: "approved" | "changes" | "commented" | "dismissed";
      body: string;
      createdAt: string;
      url: string;
      /** How many line comments it left. */
      comments: number;
    };

export type PrCheck = { name: string; state: ChecksState | "skipped"; url?: string; summary?: string };
export type PrCommit = { sha: string; title: string; author: Person | null; at: string };

/** `GET /api/github/q/pr?repo=owner/name&number=N`. */
export type PrDetail = PrRow & {
  body: string;
  headSha: string;
  mergeable: "mergeable" | "conflicting" | "unknown";
  viewerIsAuthor: boolean;
  files: PrFile[];
  timeline: TimelineEntry[];
  threads: ReviewThread[];
  commits: PrCommit[];
  /** Its head's check runs and statuses (`checks` is their rollup). */
  checkRuns: PrCheck[];
  /** Review requested from these people (and teams, by name). */
  reviewers: { name: string; state: YourReview | "requested" }[];
};

/** `GET /api/github/q/diff?repo=owner/name&number=N`: the PR's diff, parsed. */
export type PrDiff = { files: DiffFile[]; tooLarge: boolean };

/** `GET /api/github/q/viewer`: whose the token is, and the scopes it lacks (absent when none). */
export type Viewer = { viewer: Person; missingScopes?: string[] };

// ── Writes ───────────────────────────────────────────────────────────────────
/** A line comment drafted for a review. `line` is in the new file on RIGHT, the old on LEFT. */
export type DraftComment = {
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
  /** A multi-line comment's first line (on `startSide`). */
  startLine?: number;
  startSide?: "LEFT" | "RIGHT";
  body: string;
};

export type ReviewEvent = "APPROVE" | "REQUEST_CHANGES" | "COMMENT";

export type GithubWriteInputs = {
  /** A comment on the PR's conversation. */
  comment: { repo: string; number: number; body: string };
  /** Submits a review: its verdict, its summary and its line comments, at `commitId` (the head it was read at). */
  review: { repo: string; number: number; event: ReviewEvent; body: string; commitId: string; comments: DraftComment[] };
  /** A reply in a review thread, to its first comment's `databaseId`. */
  reply: { repo: string; number: number; commentId: number; body: string };
  /** Resolves or unresolves a review thread. */
  resolve: { threadId: string; resolved: boolean };
  /** Marks a file viewed or not viewed, as GitHub's "Viewed" checkbox. */
  viewed: { prId: string; path: string; viewed: boolean };
};
export type GithubWriteName = keyof GithubWriteInputs;
export const GITHUB_WRITES: GithubWriteName[] = ["comment", "review", "reply", "resolve", "viewed"];
export type GithubWriteResult = { ok: true; url?: string };

/** `owner/name`, as GitHub allows them (never `.` or `..`, which would climb an API path). */
export const REPO = /^(?!\.\.?\/)[\w.-]{1,100}\/(?!\.\.?$)[\w.-]{1,100}$/;
