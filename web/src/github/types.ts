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
export type PrScope = "review" | "assigned" | "mine" | "involved";
export const PR_SCOPES: PrScope[] = ["review", "assigned", "mine", "involved"];

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
  /** The review it was left in (GitHub's node id): a thread's first comment's is the review that started it. */
  reviewId?: string;
};

/** A review comment thread on a line (or lines) of a file. */
export type ReviewThread = {
  id: string;
  path: string;
  /** The line it's on in the current diff (null once outdated). */
  line: number | null;
  /** Where a multi-line comment starts. */
  startLine: number | null;
  /** The line (and start) it was left on, in the diff of its commit: what an outdated thread shows. */
  originalLine?: number | null;
  originalStartLine?: number | null;
  /** On the whole file, not a line. */
  onFile?: boolean;
  /** RIGHT is the new file, LEFT the old. */
  side: "LEFT" | "RIGHT";
  /** The diff around its line when it was left (its first comment's `diffHunk`, its last lines only), a hunk header first. */
  diffHunk?: string;
  /** How many comments it has, when more than `comments` holds (GitHub's are paged). */
  totalComments?: number;
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
  /** How many threads the PR has, when more than `threads` holds (at most `MAX_THREADS` are read). */
  threadsTotal?: number;
  commits: PrCommit[];
  /** Its head's check runs and statuses (`checks` is their rollup). */
  checkRuns: PrCheck[];
  /** Who's asked to review (people and teams) and who has reviewed, with their latest verdict; never the author. */
  reviewers: PrReviewer[];
  assignees: Person[];
  /** What its merge box shows and allows (`merge.ts` says what's blocking it). */
  merge: PrMerge;
};

/** How a PR merges: a merge commit, squashed into one, or rebased onto the base. */
export type MergeMethod = "merge" | "squash" | "rebase";
export const MERGE_METHODS: MergeMethod[] = ["merge", "squash", "rebase"];
/** GitHub's `mergeStateStatus`, lower-cased: clean, blocked (requirements unmet), behind, dirty (conflicts), draft, has_hooks, unstable (non-required checks failing), unknown. */
export type MergeStatus = "clean" | "blocked" | "behind" | "dirty" | "draft" | "has_hooks" | "unstable" | "unknown";
/** GitHub's merge queue entry states, lower-cased. */
export type QueueEntryState = "queued" | "awaiting_checks" | "mergeable" | "unmergeable" | "locked";

/**
 * A PR's merge box: GitHub's merge state, what the repository allows and
 * what the token may do. `methods` are the ones both the repository and its
 * base branch's rules allow, in GitHub's order; `messages` GitHub's default
 * commit title and message per method.
 */
export type PrMerge = {
  status: MergeStatus;
  methods: MergeMethod[];
  /** Why no method is offered, or that the base branch's rules couldn't be read. */
  methodsNote?: string;
  /** The token can push to the base (merge), or merge past unmet requirements as an administrator. */
  canMerge: boolean;
  canMergeAsAdmin: boolean;
  /** Edit it: ready for review, convert to draft. */
  canUpdate: boolean;
  canClose: boolean;
  canReopen: boolean;
  /** Bring its branch up to date with the base. */
  canUpdateBranch: boolean;
  /** The repository allows auto-merge, and the token may turn it on or off. */
  autoMergeAllowed: boolean;
  canEnableAutoMerge: boolean;
  canDisableAutoMerge: boolean;
  /** On: GitHub merges it once its requirements pass; how, who turned it on and when. */
  autoMerge: { method: MergeMethod; by?: Person; at?: string } | null;
  /** The base branch merges through a merge queue; the PR's place in it, while queued. */
  queueRequired: boolean;
  queue: { state: QueueEntryState; position?: number } | null;
  /** GitHub deletes the head branch after merging (the repository's setting). */
  deleteBranchOnMerge: boolean;
  /** The head branch still exists, and the token may delete it (never a fork it can't push to). */
  headBranchExists: boolean;
  canDeleteBranch: boolean;
  messages: Partial<Record<"merge" | "squash", { title: string; body: string }>>;
  mergedBy?: Person;
  mergedAt?: string;
  closedAt?: string;
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
  /**
   * Merges it with one of the repository's methods (title and message for merge and squash), at `headSha`
   * (the head it was read at, so nothing pushed since merges unseen). An administrator's merge goes past unmet requirements.
   */
  merge: { repo: string; number: number; prId: string; method: MergeMethod; headSha: string; title?: string; message?: string };
  /** Turns auto-merge on (with a method, and title and message for merge and squash) or off. */
  autoMerge: { repo: string; number: number; prId: string; enable: boolean; method?: MergeMethod; headSha?: string; title?: string; message?: string };
  /** Adds it to its base's merge queue, or removes it. */
  queue: { repo: string; number: number; prId: string; action: "add" | "remove"; headSha?: string };
  /** Ready for review (true) or back to a draft (false). */
  ready: { repo: string; number: number; prId: string; ready: boolean };
  /** Brings its branch up to date with the base, by a merge commit or a rebase. */
  updateBranch: { repo: string; number: number; prId: string; method: "merge" | "rebase"; headSha: string };
  /** Closes it (after posting `comment`, when given) or reopens it. */
  state: { repo: string; number: number; prId: string; state: "closed" | "open"; comment?: string };
  /** Deletes its head branch, once it's merged or closed (the server reads which branch). */
  deleteBranch: { repo: string; number: number };
  /** Stars or unstars a repository (`owner/name`) or an organization (its login) as a favourite: kept in `settings.json`, not on GitHub. */
  star: { kind: "repo" | "org"; name: string; starred: boolean };
};
export type GithubWriteName = keyof GithubWriteInputs;
export const GITHUB_WRITES: GithubWriteName[] = [
  "comment",
  "review",
  "reply",
  "resolve",
  "viewed",
  "reviewers",
  "assignees",
  "merge",
  "autoMerge",
  "queue",
  "ready",
  "updateBranch",
  "state",
  "deleteBranch",
  "star",
];
/** At most this many people (or teams) in one reviewers or assignees write, as GitHub allows (10 assignees, 15 reviewers). */
export const MAX_REVIEWERS = 15;
export const MAX_ASSIGNEES = 10;
/** A team's slug. */
export const TEAM_SLUG = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
export type GithubWriteResult = { ok: true; url?: string; stars?: GithubStars; /** A merge: GitHub merged it (false: it was queued or auto-merge took it). */ merged?: boolean };

/** `owner/name`, as GitHub allows them (never `.` or `..`, which would climb an API path). */
export const REPO = /^(?!\.\.?\/)[\w.-]{1,100}\/(?!\.\.?$)[\w.-]{1,100}$/;
/** An organization's or user's login. */
export const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** All commits reachable from main, paged from a fixed head while monitoring the latest one separately. */
export type MainCommit = { sha: string; title: string; author: string; login?: string; date: string };
export type MainCommitPage = { repo: string; branch: "main"; head: string; rows: MainCommit[]; cursor: string | null; more: boolean };
export type MainCommitDetail = MainCommit & PrDiff & { message: string; parents: string[]; additions: number; deletions: number };
