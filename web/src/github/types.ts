/**
 * The GitHub tab's wire types, shared by the page (`web/src/github/`) and the
 * server (`web/server/github/`, `GET /api/changes`).
 *
 * Reads: `GET /api/github/q/viewer|prs|repos|repoSearch|people|teams|pr|diff` (named, no passthrough) and
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

/**
 * `GET /api/github/q/prs?scope=…`: open PRs, most recently updated first (at most 50).
 * `GET /api/github/q/prs?repo=owner/name[&state=…][&author=…][&review=…][&draft=…][&checks=…]`:
 * a repository's PRs with those filters (`filters.ts`); `total` is how many GitHub found.
 */
export type PrList = { scope?: PrScope; repo?: string; total?: number; rows: PrRow[]; viewer: Person };

// ── Repositories ─────────────────────────────────────────────────────────────
/** Starred (favourite) repositories, `owner/name`, and organizations (or users), by login; kept in `settings.json`. */
export type GithubStars = { repos: string[]; orgs: string[] };

/** A repository in the sidebar, with its open PRs. */
export type RepoRow = {
  repo: string;
  owner: string;
  /** Its open pull requests. */
  open: number;
  /** You starred it, or its owner. */
  starred: boolean;
  ownerStarred: boolean;
  private: boolean;
  /** Starred, but GitHub has no such repository the token can see. */
  missing?: true;
};

/**
 * `GET /api/github/q/repos`: favourites first (starred repositories and those
 * of starred organizations), then the others with open PRs: yours, your
 * organizations' and collaborations', and those of PRs involving you.
 */
export type RepoList = { repos: RepoRow[]; stars: GithubStars };

/**
 * `GET /api/github/q/repoSearch?q=…`: repositories matching a name, `owner/name`
 * or an owner's login: those you know of (involved, yours, favourites) first,
 * then GitHub's repository search. `owner` is the account typed, when GitHub has it.
 * `note` says why GitHub's search wasn't asked (its rate limit), when it wasn't.
 */
export type RepoSearch = { query: string; repos: RepoRow[]; owner?: { login: string; starred: boolean }; note?: string };

/**
 * `GET /api/github/q/people?repo=owner/name`: who a repository's people
 * filters offer: you first, then recent pull requests' authors, then the
 * others who can be assigned (its collaborators and members).
 */
export type RepoPeople = { repo: string; viewer: Person; people: Person[] };

/** A team that can be asked to review: its `slug` (what GitHub's requests take) and name. */
export type Team = { slug: string; name: string };

/**
 * `GET /api/github/q/teams?repo=owner/name`: the teams with access to a
 * repository, for its reviewer picker. A personal repository has none; `note`
 * says why none are listed when the token can't list them.
 */
export type RepoTeams = { repo: string; teams: Team[]; note?: string };

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
  /** GitHub's rendering of the body, to clean and draw (else the Markdown is drawn). */
  html?: string;
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
  | { kind: "comment"; id: string; author: Person | null; body: string; html?: string; createdAt: string; url: string }
  | {
      kind: "review";
      id: string;
      author: Person | null;
      state: "approved" | "changes" | "commented" | "dismissed";
      body: string;
      html?: string;
      createdAt: string;
      url: string;
      /** How many line comments it left. */
      comments: number;
    };

export type PrCheck = {
  name: string;
  state: ChecksState | "skipped";
  url?: string;
  summary?: string;
  /** Its workflow (GitHub Actions) or app, or a status's creator. */
  source?: string;
  /** When it started and finished (a status: when it was last set). */
  startedAt?: string;
  completedAt?: string;
};
export type PrCommit = { sha: string; title: string; author: Person | null; at: string };

/** `GET /api/github/q/pr?repo=owner/name&number=N`. */
export type PrDetail = PrRow & {
  /** The description's Markdown (kept for editing) and GitHub's rendering of it, when it has one. */
  body: string;
  html?: string;
  headSha: string;
  /** The repository its branch is in (`owner/name`; a fork's for a PR from one); null when GitHub has none (a deleted fork). */
  headRepo: string | null;
  mergeable: "mergeable" | "conflicting" | "unknown";
  viewerIsAuthor: boolean;
  files: PrFile[];
  timeline: TimelineEntry[];
  threads: ReviewThread[];
  commits: PrCommit[];
  /** Its head's check runs and statuses (`checks` is their rollup). */
  checkRuns: PrCheck[];
  /** Who's asked to review (people and teams) and who has reviewed, with their latest verdict; never the author. */
  reviewers: PrReviewer[];
  assignees: Person[];
};

/** A verdict a review left. */
export type ReviewVerdict = "approved" | "changes" | "commented" | "dismissed";
/**
 * A reviewer: a person (`login`) or a team (its slug as `login`, its name).
 * `requested` while a review is asked of them (again, after `verdict`).
 */
export type PrReviewer = {
  kind: "user" | "team";
  login: string;
  name?: string;
  avatarUrl?: string;
  requested: boolean;
  verdict: ReviewVerdict | null;
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
  /** Requests reviews from people and teams (by slug), again from those who reviewed, or removes the requests. */
  reviewers: { repo: string; number: number; action: "add" | "remove"; users: string[]; teams: string[] };
  /** Assigns people to the PR, or unassigns them. */
  assignees: { repo: string; number: number; action: "add" | "remove"; users: string[] };
  /** Stars or unstars a repository (`owner/name`) or an organization (its login) as a favourite: kept in `settings.json`, not on GitHub. */
  star: { kind: "repo" | "org"; name: string; starred: boolean };
};
export type GithubWriteName = keyof GithubWriteInputs;
export const GITHUB_WRITES: GithubWriteName[] = ["comment", "review", "reply", "resolve", "viewed", "reviewers", "assignees", "star"];
/** At most this many people (or teams) in one reviewers or assignees write, as GitHub allows (10 assignees, 15 reviewers). */
export const MAX_REVIEWERS = 15;
export const MAX_ASSIGNEES = 10;
/** A team's slug. */
export const TEAM_SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export type GithubWriteResult = { ok: true; url?: string; stars?: GithubStars };

/** `owner/name`, as GitHub allows them (never `.` or `..`, which would climb an API path). */
export const REPO = /^(?!\.\.?\/)[\w.-]{1,100}\/(?!\.\.?$)[\w.-]{1,100}$/;
/** An organization's or user's login. */
export const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
