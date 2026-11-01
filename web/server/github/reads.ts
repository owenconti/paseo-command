/**
 * The GitHub tab's named reads, each one gh call (a PR's further file pages
 * aside), shaped defensively into `web/src/github/types.ts`:
 *
 *   viewer             who gh is signed in as
 *   prs?scope=…        open PRs: review requested from you, yours, or involving you (50, newest first)
 *   pr?repo=&number=   one PR: body, files (viewed or not), conversation, threads, commits, checks, reviewers
 *   diff?repo=&number= its diff, parsed (`gh pr diff`; GitHub's file patches when the diff is too large for it)
 */
import { parseUnifiedDiff } from "../../src/github/diff";
import {
  REPO,
  type ChecksState,
  type DiffFile,
  type Person,
  type PrCheck,
  type PrCommit,
  type PrDetail,
  type PrDiff,
  type PrFile,
  type PrList,
  type PrRow,
  type PrScope,
  type PrState,
  type ReviewDecision,
  type ReviewThread,
  type TimelineEntry,
  type Viewer,
  type YourReview,
} from "../../src/github/types";
import { cached, gh, GITHUB_TAB, graphql, GithubTabError, tabFailure } from "./client";

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const nodes = (v: unknown): Raw[] => {
  const n = rec(v).nodes;
  return Array.isArray(n) ? n.map(rec) : [];
};
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const BODY_MAX = 65_536;
const https = (v: unknown) => (/^https:\/\/github\.com\/[^\s]*$/.test(str(v)) ? str(v) : "");

/** A GitHub avatar address, only from GitHub's own avatar host. */
export function avatarOf(v: unknown): string | undefined {
  const s = str(v);
  return /^https:\/\/avatars\.githubusercontent\.com\/[^\s"'<>]*$/.test(s) ? s : undefined;
}

export function personOf(v: unknown): Person | null {
  const p = rec(v);
  const login = str(p.login);
  if (!login) return null;
  const name = str(p.name);
  const avatarUrl = avatarOf(p.avatarUrl);
  return { login: clip(login, 100), ...(name && name !== login ? { name: clip(name, 200) } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
}

const AUTHOR = "author { login avatarUrl ... on User { name } }";

const ROW = `
  id number title url isDraft state createdAt updatedAt headRefName baseRefName additions deletions changedFiles
  repository { nameWithOwner }
  ${AUTHOR}
  comments { totalCount }
  reviewDecision
  viewerLatestReview { state }
  labels(first: 10) { nodes { name color } }
  checks: commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;

export function stateOf(state: unknown, draft: unknown): PrState {
  if (state === "MERGED") return "merged";
  if (state === "CLOSED") return "closed";
  return draft === true ? "draft" : "open";
}
export function decisionOf(v: unknown): ReviewDecision | null {
  return v === "APPROVED" ? "approved" : v === "CHANGES_REQUESTED" ? "changes" : v === "REVIEW_REQUIRED" ? "review" : null;
}
export function rollupOf(v: unknown): ChecksState | null {
  if (v === "SUCCESS") return "passing";
  if (v === "FAILURE" || v === "ERROR") return "failing";
  if (v === "PENDING" || v === "EXPECTED") return "pending";
  return null;
}
export function reviewStateOf(v: unknown): YourReview | null {
  switch (v) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes";
    case "COMMENTED":
      return "commented";
    case "PENDING":
      return "pending";
    default:
      return null;
  }
}

/** One of GitHub's PRs as a list row; null without its identity. */
export function rowOf(v: unknown): PrRow | null {
  const p = rec(v);
  const repo = str(rec(p.repository).nameWithOwner);
  const number = num(p.number);
  const url = https(p.url);
  if (!str(p.id) || !REPO.test(repo) || !Number.isSafeInteger(number) || number <= 0 || !url) return null;
  const rollup = rec(rec(nodes(p.checks)[0]?.commit).statusCheckRollup).state;
  return {
    id: clip(str(p.id), 200),
    repo,
    number,
    title: clip(str(p.title), 500),
    url,
    author: personOf(p.author),
    state: stateOf(p.state, p.isDraft),
    createdAt: str(p.createdAt),
    updatedAt: str(p.updatedAt),
    headRef: clip(str(p.headRefName), 300),
    baseRef: clip(str(p.baseRefName), 300),
    additions: num(p.additions),
    deletions: num(p.deletions),
    changedFiles: num(p.changedFiles),
    comments: num(rec(p.comments).totalCount),
    reviewDecision: decisionOf(p.reviewDecision),
    checks: rollupOf(rollup),
    yourReview: reviewStateOf(rec(p.viewerLatestReview).state),
    labels: nodes(p.labels)
      .map((l) => ({ name: clip(str(l.name), 100), color: /^[0-9a-f]{6}$/i.test(str(l.color)) ? str(l.color) : "888888" }))
      .filter((l) => l.name),
  };
}

// ── viewer ───────────────────────────────────────────────────────────────────
export function readViewer(fresh = false): Promise<Viewer> {
  return cached("viewer", fresh, async () => {
    const data = await graphql("query { viewer { login name avatarUrl } }");
    const viewer = personOf(data.viewer);
    if (!viewer) throw new GithubTabError("signed-out", "gh isn't signed in to GitHub.");
    return { viewer };
  });
}

// ── prs ──────────────────────────────────────────────────────────────────────
export const SCOPE_QUERY: Record<PrScope, string> = {
  review: "is:pr is:open archived:false review-requested:@me sort:updated-desc",
  mine: "is:pr is:open archived:false author:@me sort:updated-desc",
  involved: "is:pr is:open archived:false involves:@me sort:updated-desc",
};
export const PRS_QUERY = `query($q: String!) {
  viewer { login name avatarUrl }
  search(query: $q, type: ISSUE, first: 50) { nodes { ... on PullRequest { ${ROW} } } }
}`;

export function readPrs(scope: PrScope, fresh = false): Promise<PrList> {
  return cached(`prs:${scope}`, fresh, async () => {
    const data = await graphql(PRS_QUERY, { q: SCOPE_QUERY[scope] });
    const viewer = personOf(data.viewer);
    if (!viewer) throw new GithubTabError("signed-out", "gh isn't signed in to GitHub.");
    const rows = nodes(data.search)
      .map(rowOf)
      .filter((r): r is PrRow => r !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { scope, rows, viewer };
  });
}

// ── pr ───────────────────────────────────────────────────────────────────────
const FILES = "files(first: 100, after: $after) { nodes { path additions deletions changeType viewerViewedState } pageInfo { hasNextPage endCursor } }";
export const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    ${ROW}
    body headRefOid mergeable viewerDidAuthor
    ${FILES}
    timelineComments: comments(last: 100) { nodes { id ${AUTHOR} body createdAt url } }
    reviews(last: 100) { nodes { id ${AUTHOR} state body submittedAt createdAt url comments { totalCount } } }
    reviewThreads(first: 100) { nodes {
      id path line startLine diffSide isResolved isOutdated viewerCanResolve viewerCanUnresolve viewerCanReply
      comments(first: 50) { nodes { id databaseId ${AUTHOR} body createdAt url } }
    } }
    commits(last: 100) { nodes { commit { oid messageHeadline committedDate author { name user { login avatarUrl } } } } }
    rollup: commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: 100) { nodes {
      __typename
      ... on CheckRun { name status conclusion detailsUrl title }
      ... on StatusContext { context state targetUrl description }
    } } } } } }
    reviewRequests(first: 30) { nodes { requestedReviewer { __typename ... on User { login } ... on Bot { login } ... on Mannequin { login } ... on Team { name } } } }
    latestReviews(first: 30) { nodes { author { login } state } }
  } }
}`;
export const FILES_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { ${FILES} } }
}`;
/** At most this many files' viewed state (GitHub pages them by 100). */
export const MAX_FILES = 300;

const CHANGE_TYPES: PrFile["changeType"][] = ["added", "deleted", "modified", "renamed", "copied", "changed"];
function fileOf(f: Raw): PrFile | null {
  const path = str(f.path);
  if (!path) return null;
  const type = str(f.changeType).toLowerCase() as PrFile["changeType"];
  const viewed = f.viewerViewedState === "VIEWED" ? "viewed" : f.viewerViewedState === "DISMISSED" ? "dismissed" : "unviewed";
  return {
    path: clip(path, 1000),
    additions: num(f.additions),
    deletions: num(f.deletions),
    changeType: CHANGE_TYPES.includes(type) ? type : "changed",
    viewed,
  };
}

const TIMELINE_REVIEW: Record<string, Extract<TimelineEntry, { kind: "review" }>["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

/** The conversation: comments and submitted reviews (not your pending one, nor empty comment-only reviews of threads alone), oldest first. */
export function timelineOf(comments: Raw[], reviews: Raw[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const c of comments) {
    if (!str(c.id)) continue;
    entries.push({
      kind: "comment",
      id: clip(str(c.id), 200),
      author: personOf(c.author),
      body: clip(str(c.body), BODY_MAX),
      createdAt: str(c.createdAt),
      url: https(c.url),
    });
  }
  for (const r of reviews) {
    const state = TIMELINE_REVIEW[str(r.state)];
    if (!state || !str(r.id)) continue;
    entries.push({
      kind: "review",
      id: clip(str(r.id), 200),
      author: personOf(r.author),
      state,
      body: clip(str(r.body), BODY_MAX),
      createdAt: str(r.submittedAt) || str(r.createdAt),
      url: https(r.url),
      comments: num(rec(r.comments).totalCount),
    });
  }
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function threadOf(t: Raw): ReviewThread | null {
  const path = str(t.path);
  if (!str(t.id) || !path) return null;
  const line = typeof t.line === "number" ? t.line : null;
  const startLine = typeof t.startLine === "number" ? t.startLine : null;
  return {
    id: clip(str(t.id), 200),
    path: clip(path, 1000),
    line,
    startLine,
    side: t.diffSide === "LEFT" ? "LEFT" : "RIGHT",
    isResolved: t.isResolved === true,
    isOutdated: t.isOutdated === true,
    canResolve: t.isResolved === true ? t.viewerCanUnresolve === true : t.viewerCanResolve === true,
    canReply: t.viewerCanReply === true,
    comments: nodes(t.comments)
      .filter((c) => str(c.id) && Number.isSafeInteger(c.databaseId))
      .map((c) => ({
        id: clip(str(c.id), 200),
        databaseId: c.databaseId as number,
        author: personOf(c.author),
        body: clip(str(c.body), BODY_MAX),
        createdAt: str(c.createdAt),
        url: https(c.url),
      })),
  };
}

export function commitOf(n: Raw): PrCommit | null {
  const c = rec(n.commit);
  const sha = str(c.oid);
  if (!/^[0-9a-f]{40}$/.test(sha)) return null;
  const author = rec(c.author);
  const user = personOf(author.user);
  const name = str(author.name);
  return {
    sha,
    title: clip(str(c.messageHeadline), 500),
    author: user ?? (name ? { login: clip(name, 100) } : null),
    at: str(c.committedDate),
  };
}

/** A check run's or status's state: passing, failing, pending or skipped. */
export function checkOf(n: Raw): PrCheck | null {
  const url = /^https:\/\/[^\s]+$/.test(str(n.detailsUrl) || str(n.targetUrl)) ? str(n.detailsUrl) || str(n.targetUrl) : undefined;
  if (n.__typename === "CheckRun") {
    const name = str(n.name);
    if (!name) return null;
    const conclusion = str(n.conclusion);
    let state: PrCheck["state"];
    if (str(n.status) !== "COMPLETED") state = "pending";
    else if (["SUCCESS", "NEUTRAL"].includes(conclusion)) state = "passing";
    else if (["SKIPPED", "STALE"].includes(conclusion)) state = "skipped";
    else state = "failing";
    const summary = str(n.title);
    return { name: clip(name, 300), state, ...(url ? { url } : {}), ...(summary ? { summary: clip(summary, 300) } : {}) };
  }
  if (n.__typename === "StatusContext") {
    const name = str(n.context);
    if (!name) return null;
    const s = str(n.state);
    const state: PrCheck["state"] = s === "SUCCESS" ? "passing" : s === "PENDING" || s === "EXPECTED" ? "pending" : "failing";
    const summary = str(n.description);
    return { name: clip(name, 300), state, ...(url ? { url } : {}), ...(summary ? { summary: clip(summary, 300) } : {}) };
  }
  return null;
}

/** Who's asked to review and how each last did (not the author). */
export function reviewersOf(requests: Raw[], latest: Raw[], author?: string): PrDetail["reviewers"] {
  const out = new Map<string, PrDetail["reviewers"][number]>();
  for (const r of latest) {
    const login = str(rec(r.author).login);
    const state = reviewStateOf(r.state);
    if (login && state && login !== author) out.set(login, { name: clip(login, 100), state });
  }
  for (const r of requests) {
    const who = rec(r.requestedReviewer);
    const name = str(who.login) || str(who.name);
    // A re-request stands over an earlier review.
    if (name) out.set(name, { name: clip(name, 100), state: "requested" });
  }
  return [...out.values()];
}

const MERGEABLE: Record<string, PrDetail["mergeable"]> = { MERGEABLE: "mergeable", CONFLICTING: "conflicting" };

/** GitHub's pullRequest object (and its further file pages) as a PrDetail; null when it isn't one. */
export function detailOf(p: Raw, extraFiles: Raw[] = []): PrDetail | null {
  const row = rowOf(p);
  if (!row) return null;
  const sha = str(p.headRefOid);
  const contexts = nodes(rec(rec(nodes(p.rollup)[0]?.commit).statusCheckRollup).contexts);
  return {
    ...row,
    body: clip(str(p.body), BODY_MAX),
    headSha: /^[0-9a-f]{40}$/.test(sha) ? sha : "",
    mergeable: MERGEABLE[str(p.mergeable)] ?? "unknown",
    viewerIsAuthor: p.viewerDidAuthor === true,
    files: [...nodes(p.files), ...extraFiles].map(fileOf).filter((f): f is PrFile => f !== null),
    timeline: timelineOf(nodes(p.timelineComments), nodes(p.reviews)),
    threads: nodes(p.reviewThreads)
      .map(threadOf)
      .filter((t): t is ReviewThread => t !== null),
    commits: nodes(p.commits)
      .map(commitOf)
      .filter((c): c is PrCommit => c !== null),
    checkRuns: contexts.map(checkOf).filter((c): c is PrCheck => c !== null),
    reviewers: reviewersOf(nodes(p.reviewRequests), nodes(p.latestReviews), row.author?.login),
  };
}

export const prKey = (repo: string, number: number) => `pr:${repo}#${number}`;
export const diffKey = (repo: string, number: number) => `diff:${repo}#${number}`;

export function readPr(repo: string, number: number, fresh = false): Promise<PrDetail> {
  return cached(prKey(repo, number), fresh, async () => {
    const [owner, name] = repo.split("/") as [string, string];
    const data = await graphql(PR_QUERY, { owner, name, number });
    const p = rec(rec(data.repository).pullRequest);
    const extra: Raw[] = [];
    let page = rec(rec(p.files).pageInfo);
    let count = nodes(p.files).length;
    while (page.hasNextPage === true && str(page.endCursor) && count < MAX_FILES) {
      const more = rec(rec(rec(await graphql(FILES_QUERY, { owner, name, number, after: str(page.endCursor) })).repository).pullRequest);
      const got = nodes(more.files);
      if (!got.length) break;
      extra.push(...got);
      count += got.length;
      page = rec(rec(more.files).pageInfo);
    }
    const detail = detailOf(p, extra);
    if (!detail) throw new GithubTabError("failed", `GitHub has no pull request #${number} in ${repo}, or gh's sign-in can't see it.`);
    return detail;
  });
}

// ── diff ─────────────────────────────────────────────────────────────────────
/** GitHub's REST file list (`pulls/:n/files`, one JSON object a line) as diff files, from their patches. */
export function filesFromPatches(lines: string): DiffFile[] {
  const files: DiffFile[] = [];
  for (const line of lines.split("\n")) {
    if (!line.trim()) continue;
    let f: Raw;
    try {
      f = rec(JSON.parse(line));
    } catch {
      continue;
    }
    const path = str(f.filename);
    if (!path) continue;
    const old = str(f.previous_filename);
    const status = str(f.status);
    const patch = str(f.patch);
    const parsed = patch ? parseUnifiedDiff(`diff --git a/x b/x\n--- a/x\n+++ b/x\n${patch}\n`).files[0] : undefined;
    files.push({
      path,
      ...(old && old !== path ? { oldPath: old } : {}),
      isNew: status === "added",
      isDeleted: status === "removed",
      additions: num(f.additions),
      deletions: num(f.deletions),
      hunks: parsed?.hunks ?? [],
      // GitHub leaves out the patch of binary and very large files.
      status: patch
        ? (parsed?.status ?? "ok")
        : num(f.changes) > 0 || num(f.additions) + num(f.deletions) > 0
          ? "too_large"
          : status === "renamed" || status === "copied"
            ? "ok"
            : "binary",
    });
  }
  return files;
}

/** Whether gh refused the diff as too large for GitHub to make (HTTP 406, or its words for it). */
const diffTooLargeForGithub = (e: unknown) => {
  const err = e as { stderr?: unknown; stdout?: unknown; message?: unknown };
  return /too_large|too large|exceeded the maximum|maximum number|HTTP 406/i.test(`${str(err?.stderr)} ${str(err?.stdout)} ${str(err?.message)}`);
};

export function readDiff(repo: string, number: number, fresh = false): Promise<PrDiff> {
  return cached(diffKey(repo, number), fresh, async () => {
    try {
      return parseUnifiedDiff(await GITHUB_TAB.run(["pr", "diff", String(number), "-R", repo, "--color", "never"]));
    } catch (e) {
      if (!diffTooLargeForGithub(e)) throw tabFailure(e);
    }
    const out = await gh(["api", "--paginate", `repos/${repo}/pulls/${number}/files?per_page=100`, "--jq", ".[]"]);
    // GitHub lists at most 3,000 files.
    return { files: filesFromPatches(out), tooLarge: true };
  });
}

// ── Parameters ───────────────────────────────────────────────────────────────
/** A `repo` and `number` query, checked; nothing else may be given (but `fresh=1`). */
export function prParams(params: URLSearchParams): { repo: string; number: number } {
  for (const k of params.keys()) if (!["repo", "number", "fresh"].includes(k)) throw new GithubTabError("invalid", `Unexpected parameter ${k}`);
  const repo = params.get("repo") ?? "";
  const n = params.get("number") ?? "";
  if (!REPO.test(repo) || repo.includes("..")) throw new GithubTabError("invalid", "Name the repository: repo=owner/name");
  if (!/^[1-9]\d{0,8}$/.test(n)) throw new GithubTabError("invalid", "Name the pull request: number");
  return { repo, number: Number(n) };
}
