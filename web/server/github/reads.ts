/**
 * The GitHub tab's named reads, each one GitHub API call (a PR's further file
 * pages aside), shaped defensively into `web/src/github/types.ts`:
 *
 *   viewer             whose the token is, and the scopes it lacks
 *   prs?scope=…        open PRs: review requested from you, yours, or involving you (50, newest first)
 *   prs?repo=…&<filters> a repository's PRs with the filters (`src/github/filters.ts`; 50, newest first;
 *                      one search for each person chosen, in one request)
 *   repos              favourites (stars, `stars.ts`), then other repositories with open PRs, each counted
 *   repoSearch?q=…     repositories by name, `owner/name` or owner: those known first, then GitHub's search
 *   people?repo=…      who its people filters offer: you, recent PRs' authors, its assignable users
 *   teams?repo=…       the teams with access to it, for its reviewer picker (REST; none for a personal repository)
 *   pr?repo=&number=   one PR: body, files (viewed or not), conversation, threads, commits, checks, reviewers, assignees
 *   diff?repo=&number= its diff, parsed (GitHub's diff media type; its file patches when the diff is too large for it)
 */
import { parseUnifiedDiff } from "../../src/github/diff";
import {
  OWNER,
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
  type PrReviewer,
  type PrRow,
  type PrScope,
  type PrState,
  type RepoList,
  type RepoPeople,
  type RepoRow,
  type RepoSearch,
  type RepoTeams,
  type ReviewDecision,
  type ReviewVerdict,
  type Team,
  TEAM_SLUG,
  type ReviewThread,
  type TimelineEntry,
  type Viewer,
  type YourReview,
} from "../../src/github/types";
import { GithubApiError, githubGraphql as graphql, githubPaged, githubRest, githubText, missingScopes } from "../githubApi";
import { filterQueries, type RepoFilters } from "../../src/github/filters";
import { cached, searchSlot } from "./client";
import { readStars } from "./stars";

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
/** Whose the token is (REST `GET user`, whose `X-OAuth-Scopes` says what the token may do). */
export function readViewer(fresh = false): Promise<Viewer> {
  return cached("viewer", fresh, async () => {
    const { data, headers } = await githubRest<Raw>("GET", "user");
    const viewer = personOf({ login: rec(data).login, name: rec(data).name, avatarUrl: rec(data).avatar_url });
    if (!viewer) throw new GithubApiError("failed", "GitHub didn't say whose the token is.");
    const missing = missingScopes(headers);
    return { viewer, ...(missing.length ? { missingScopes: missing } : {}) };
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
    searchSlot();
    const data = await graphql(PRS_QUERY, { q: SCOPE_QUERY[scope] });
    return { scope, ...searchRows(data) };
  });
}

function searchRows(data: Raw): { rows: PrRow[]; viewer: PrList["viewer"]; total: number } {
  const viewer = personOf(data.viewer);
  if (!viewer) throw new GithubApiError("failed", "GitHub didn't say whose the token is.");
  const rows = nodes(data.search)
    .map(rowOf)
    .filter((r): r is PrRow => r !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const count = rec(data.search).issueCount;
  return { rows, viewer, total: typeof count === "number" && Number.isSafeInteger(count) ? count : rows.length };
}

/** One request with a search for each query (`s0`, `s1`, …). */
export function repoPrsQuery(queries: string[]): { query: string; variables: Record<string, string> } {
  const variables = Object.fromEntries(queries.map((q, i) => [`q${i}`, q]));
  const params = queries.map((_, i) => `$q${i}: String!`).join(", ");
  const fields = queries.map((_, i) => `s${i}: search(query: $q${i}, type: ISSUE, first: 50) { issueCount nodes { ... on PullRequest { ${ROW} } } }`);
  return { query: `query(${params}) {\n  viewer { login name avatarUrl }\n  ${fields.join("\n  ")}\n}`, variables };
}

/**
 * A repository's pull requests with these filters: one search, or one for
 * each person chosen (`filterQueries`), asked together and merged, the 50
 * most recently updated. Its total is GitHub's count for one search; for
 * several, what they found together, or (when any found more than it gave)
 * their counts added (some PRs may be counted twice).
 */
export function readRepoPrs(repo: string, filters: RepoFilters, fresh = false): Promise<PrList> {
  const queries = filterQueries(repo, filters);
  return cached(`prs:repo:${queries.join("|").toLowerCase()}`, fresh, async () => {
    searchSlot(queries.length);
    const { query, variables } = repoPrsQuery(queries);
    const data = await graphql(query, variables);
    const viewer = personOf(data.viewer);
    if (!viewer) throw new GithubApiError("failed", "GitHub didn't say whose the token is.");
    const byId = new Map<string, PrRow>();
    let counted = 0;
    let more = false;
    queries.forEach((_, i) => {
      const found = searchRows({ viewer: data.viewer, search: data[`s${i}`] });
      counted += found.total;
      if (found.total > found.rows.length) more = true;
      // GitHub's search matches the repository whatever its case; keep only its own.
      for (const r of found.rows) if (r.repo.toLowerCase() === repo.toLowerCase()) byId.set(r.id, r);
    });
    const rows = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const total = queries.length === 1 ? counted : more ? Math.max(counted, rows.length) : rows.length;
    return { repo, rows: rows.slice(0, 50), viewer, total };
  });
}

// ── repos ────────────────────────────────────────────────────────────────────
/** At most this many starred (or involving) repositories, and starred owners, are asked of GitHub by name. */
export const MAX_NAMED_REPOS = 40;
export const MAX_NAMED_OWNERS = 20;
const REPO_FIELDS = "fragment R on Repository { nameWithOwner isArchived isPrivate owner { login } pullRequests(states: OPEN) { totalCount } }";
const VIEWER_REPOS =
  "viewer { repositories(first: 100, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { ...R } } }";

/** One GraphQL query for your repositories, these by name, and these owners' (most recently pushed first). */
export function reposQuery(repos: string[], owners: string[]): { query: string; variables: Record<string, string> } {
  const params: string[] = [];
  const fields: string[] = [VIEWER_REPOS];
  const variables: Record<string, string> = {};
  repos.forEach((r, i) => {
    const [owner, name] = r.split("/") as [string, string];
    params.push(`$r${i}o: String!`, `$r${i}n: String!`);
    fields.push(`r${i}: repository(owner: $r${i}o, name: $r${i}n) { ...R }`);
    variables[`r${i}o`] = owner;
    variables[`r${i}n`] = name;
  });
  owners.forEach((o, i) => {
    params.push(`$o${i}: String!`);
    fields.push(`o${i}: repositoryOwner(login: $o${i}) { repositories(first: 100, orderBy: { field: PUSHED_AT, direction: DESC }) { nodes { ...R } } }`);
    variables[`o${i}`] = o;
  });
  return { query: `query${params.length ? `(${params.join(", ")})` : ""} {\n  ${fields.join("\n  ")}\n}\n${REPO_FIELDS}`, variables };
}

/** A repository GitHub answered as a row (archived ones only if starred); null when it isn't one. */
function repoRowOf(r: Raw, stars: { repos: Set<string>; orgs: Set<string> }): RepoRow | null {
  const repo = str(r.nameWithOwner);
  if (!REPO.test(repo)) return null;
  const owner = str(rec(r.owner).login) || repo.split("/")[0]!;
  const starred = stars.repos.has(repo.toLowerCase());
  if (!starred && r.isArchived === true) return null;
  return { repo, owner, open: num(rec(r.pullRequests).totalCount), starred, ownerStarred: stars.orgs.has(owner.toLowerCase()), private: r.isPrivate === true };
}
const starSets = (stars: { repos: string[]; orgs: string[] }) => ({
  repos: new Set(stars.repos.map((r) => r.toLowerCase())),
  orgs: new Set(stars.orgs.map((o) => o.toLowerCase())),
});

/**
 * Every repository the tab knows of, once each: starred ones (`missing` when
 * GitHub has none the token sees), those of PRs involving you, yours (most
 * recently pushed first) and starred owners'. `involved` names the second.
 */
function knownRepos(fresh = false): Promise<{ rows: RepoRow[]; involved: Set<string> }> {
  const stars = readStars();
  return cached(`repos:known:${JSON.stringify(stars).toLowerCase()}`, fresh, async () => {
    // The repositories of PRs involving you (from that list, shared with the sidebar's count), as far as it answers.
    const involved = await readPrs("involved").then(
      (l) => l.rows.map((r) => r.repo),
      () => [] as string[],
    );
    const named: string[] = [];
    for (const r of [...stars.repos, ...involved]) if (!named.some((n) => n.toLowerCase() === r.toLowerCase())) named.push(r);
    const { query, variables } = reposQuery(named.slice(0, MAX_NAMED_REPOS), stars.orgs.slice(0, MAX_NAMED_OWNERS));
    const data = await graphql(query, variables);
    const raw: Raw[] = [];
    const owned: Raw[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (/^r\d+$/.test(k) && v) raw.push(rec(v));
      if (/^o\d+$/.test(k)) owned.push(...nodes(rec(v).repositories));
    }
    raw.push(...nodes(rec(data.viewer).repositories), ...owned);
    const sets = starSets(stars);
    const byName = new Map<string, RepoRow>();
    for (const r of raw) {
      const row = repoRowOf(r, sets);
      if (row && !byName.has(row.repo.toLowerCase())) byName.set(row.repo.toLowerCase(), row);
    }
    for (const repo of stars.repos)
      if (!byName.has(repo.toLowerCase())) {
        const owner = repo.split("/")[0]!;
        byName.set(repo.toLowerCase(), { repo, owner, open: 0, starred: true, ownerStarred: sets.orgs.has(owner.toLowerCase()), private: false, missing: true });
      }
    return { rows: [...byName.values()], involved: new Set(involved.map((r) => r.toLowerCase())) };
  });
}

/**
 * The sidebar's repositories: favourites first (starred, then of starred
 * owners), then the rest with open PRs, most open first. A starred repository
 * always shows (`missing` when GitHub has none the token sees); others only
 * with open PRs, and archived ones not at all.
 */
export function readRepos(fresh = false): Promise<RepoList> {
  const stars = readStars();
  return knownRepos(fresh).then(({ rows }) => {
    const rank = (r: RepoRow) => (r.starred ? 0 : r.ownerStarred ? 1 : 2);
    const lower = (s: string) => s.toLowerCase();
    const repos = rows
      .filter((r) => r.starred || r.open > 0)
      .sort((a, b) => rank(a) - rank(b) || b.open - a.open || lower(a.repo).localeCompare(lower(b.repo)));
    return { repos, stars };
  });
}

// ── repoSearch ───────────────────────────────────────────────────────────────
/** At most this many repositories found. */
export const MAX_FOUND = 30;
/** Searches are kept a minute (GitHub's search allows 30 a minute). */
export const SEARCH_TTL_MS = 60_000;

/**
 * What's typed to find a repository, as the search takes it: a github.com
 * address, `@owner` and `.git` lose their extras; else null (nothing, or
 * more than `owner/name`'s characters and spaces).
 */
export function searchText(raw: string): { text: string; owner?: string; name: string } | null {
  const t = raw
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
    .replace(/^@/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .replace(/\s+/g, " ");
  if (!t || t.length > 200 || !/^[\w.\- ]+(\/[\w.\- ]*)?$/.test(t)) return null;
  const slash = t.indexOf("/");
  if (slash < 0) return { text: t, name: t };
  const owner = t.slice(0, slash).trim();
  return OWNER.test(owner) ? { text: t, owner, name: t.slice(slash + 1).trim() } : null;
}

/** Whether a repository matches what's typed: every word in its `owner/name`, or (with an owner) the owner and the name's words. */
export function repoMatches(repo: string, t: { owner?: string; name: string }): boolean {
  const lower = repo.toLowerCase();
  const [owner, name] = lower.split("/") as [string, string];
  const words = t.name.toLowerCase().split(" ").filter(Boolean);
  if (t.owner) return owner.startsWith(t.owner.toLowerCase()) && words.every((w) => name.includes(w));
  return words.every((w) => lower.includes(w));
}

/** One request: GitHub's repository search for the words (within the owner when one's named), the exact `owner/name`, and the account typed. */
export function repoSearchQuery(t: { owner?: string; name: string }): { query: string; variables: Record<string, string> } {
  const fields: string[] = [];
  const params: string[] = [];
  const variables: Record<string, string> = {};
  const words = t.name.trim();
  const q = [words ? `${words} in:name` : "", t.owner ? `user:${t.owner}` : "", "fork:true", ...(words ? [] : ["sort:updated"])].filter(Boolean).join(" ");
  params.push("$q: String!");
  variables.q = q;
  fields.push("search(query: $q, type: REPOSITORY, first: 20) { nodes { ...R } }");
  const login = t.owner ?? (OWNER.test(words) ? words : undefined);
  if (login) {
    params.push("$login: String!");
    variables.login = login;
    fields.push("owner: repositoryOwner(login: $login) { login }");
  }
  if (t.owner && words && REPO.test(`${t.owner}/${words}`)) {
    params.push("$name: String!");
    variables.name = words;
    fields.push("exact: repository(owner: $login, name: $name) { ...R }");
  }
  return { query: `query(${params.join(", ")}) {\n  ${fields.join("\n  ")}\n}\n${REPO_FIELDS}`, variables };
}

/**
 * Repositories matching what's typed (`searchText`): those the tab knows of
 * (involved first, then yours as most recently pushed, starred and starred
 * owners'), then what GitHub's repository search finds, `MAX_FOUND` at most.
 * One character asks only those known; while the search's minute is spent,
 * those known answer with a note.
 */
export function readRepoSearch(raw: string, fresh = false): Promise<RepoSearch> {
  const t = searchText(raw);
  if (!t) throw new GithubApiError("invalid", "Find a repository by its name, owner/name or owner.");
  return cached(
    `reposearch:${t.text.toLowerCase()}:${JSON.stringify(readStars()).toLowerCase()}`,
    fresh,
    async () => {
      const stars = readStars();
      const sets = starSets(stars);
      const known = await knownRepos().catch(() => ({ rows: [] as RepoRow[], involved: new Set<string>() }));
      const local = known.rows
        .filter((r) => repoMatches(r.repo, t))
        .map((r, i) => ({ r, i }))
        .sort((a, b) => Number(known.involved.has(b.r.repo.toLowerCase())) - Number(known.involved.has(a.r.repo.toLowerCase())) || a.i - b.i)
        .map(({ r }) => r);
      const found = new Map(local.map((r) => [r.repo.toLowerCase(), r]));
      const out: RepoSearch = { query: t.text, repos: [] };
      if (t.text.length >= 2) {
        try {
          searchSlot();
          const { query, variables } = repoSearchQuery(t);
          const data = await graphql(query, variables);
          for (const r of [...(data.exact ? [rec(data.exact)] : []), ...nodes(data.search)]) {
            const row = repoRowOf(r, sets);
            if (row && !found.has(row.repo.toLowerCase())) found.set(row.repo.toLowerCase(), row);
          }
          const login = str(rec(data.owner).login);
          if (OWNER.test(login)) out.owner = { login, starred: sets.orgs.has(login.toLowerCase()) };
        } catch (e) {
          if (!(e instanceof GithubApiError && e.kind === "limited")) throw e;
          out.note = "GitHub’s search is busy for a minute; these are the repositories you know of.";
        }
      }
      out.repos = [...found.values()].slice(0, MAX_FOUND);
      return out;
    },
    SEARCH_TTL_MS,
  );
}

// ── people ───────────────────────────────────────────────────────────────────
/** A repository's people change slowly: asked again after five minutes. */
export const PEOPLE_TTL_MS = 5 * 60_000;
export const PEOPLE_QUERY = `query($owner: String!, $name: String!) {
  viewer { login name avatarUrl }
  repository(owner: $owner, name: $name) {
    assignableUsers(first: 100) { nodes { login name avatarUrl } }
    pullRequests(first: 50, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${AUTHOR} } }
  }
}`;

/** Who a repository's people filters offer: you, then recent pull requests' authors (newest first), then its other assignable users by login. */
export function readPeople(repo: string, fresh = false): Promise<RepoPeople> {
  return cached(
    `people:${repo.toLowerCase()}`,
    fresh,
    async () => {
      const [owner, name] = repo.split("/") as [string, string];
      const data = await graphql(PEOPLE_QUERY, { owner, name });
      const viewer = personOf(data.viewer);
      if (!viewer) throw new GithubApiError("failed", "GitHub didn't say whose the token is.");
      const r = rec(data.repository);
      if (!data.repository) throw new GithubApiError("not-found", `GitHub has no ${repo} the token can see.`);
      const seen = new Set([viewer.login.toLowerCase()]);
      const take = (list: Raw[]) =>
        list
          .map((n) => personOf(n.author ?? n))
          .filter((p): p is Person => {
            if (!p || seen.has(p.login.toLowerCase())) return false;
            seen.add(p.login.toLowerCase());
            return true;
          });
      const authors = take(nodes(r.pullRequests));
      const others = take(nodes(r.assignableUsers)).sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()));
      return { repo, viewer, people: [...authors, ...others] };
    },
    PEOPLE_TTL_MS,
  );
}

// ── teams ────────────────────────────────────────────────────────────────────
export const TEAMS_MAX = 100;
/**
 * The teams with access to a repository (REST `repos/:repo/teams`), by name.
 * A personal repository has none; one the token can't list them for (it needs
 * `read:org`, or isn't the organization's member) answers none, saying so.
 */
export function readTeams(repo: string, fresh = false): Promise<RepoTeams> {
  return cached(
    `teams:${repo.toLowerCase()}`,
    fresh,
    async () => {
      let list: unknown[];
      try {
        list = await githubPaged<unknown>(`repos/${repo}/teams?per_page=100`, TEAMS_MAX);
      } catch (e) {
        if (e instanceof GithubApiError && (e.kind === "forbidden" || e.kind === "not-found"))
          return { repo, teams: [], note: "The token can't list this repository's teams." };
        throw e;
      }
      const teams = list
        .map((t): Team | null => {
          const slug = str(rec(t).slug);
          return TEAM_SLUG.test(slug) ? { slug, name: clip(str(rec(t).name) || slug, 200) } : null;
        })
        .filter((t): t is Team => t !== null)
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      return { repo, teams };
    },
    PEOPLE_TTL_MS,
  );
}

// ── pr ───────────────────────────────────────────────────────────────────────
const FILES = "files(first: 100, after: $after) { nodes { path additions deletions changeType viewerViewedState } pageInfo { hasNextPage endCursor } }";
export const PR_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    ${ROW}
    body headRefOid mergeable viewerDidAuthor headRepository { nameWithOwner }
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
      ... on CheckRun { name status conclusion detailsUrl title startedAt completedAt checkSuite { app { name } workflowRun { workflow { name } } } }
      ... on StatusContext { context state targetUrl description createdAt creator { login } }
    } } } } } }
    reviewRequests(first: 30) { nodes { requestedReviewer {
      __typename ... on User { login name avatarUrl } ... on Bot { login avatarUrl } ... on Mannequin { login avatarUrl } ... on Team { slug name }
    } } }
    latestReviews(first: 30) { nodes { ${AUTHOR} state } }
    assignees(first: 20) { nodes { login name avatarUrl } }
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
    const suite = rec(n.checkSuite);
    const source = str(rec(rec(rec(suite.workflowRun).workflow)).name) || str(rec(suite.app).name);
    return {
      name: clip(name, 300),
      state,
      ...(url ? { url } : {}),
      ...(summary ? { summary: clip(summary, 300) } : {}),
      ...(source ? { source: clip(source, 200) } : {}),
      ...times(n.startedAt, n.completedAt),
    };
  }
  if (n.__typename === "StatusContext") {
    const name = str(n.context);
    if (!name) return null;
    const s = str(n.state);
    const state: PrCheck["state"] = s === "SUCCESS" ? "passing" : s === "PENDING" || s === "EXPECTED" ? "pending" : "failing";
    const summary = str(n.description);
    const source = str(rec(n.creator).login);
    return {
      name: clip(name, 300),
      state,
      ...(url ? { url } : {}),
      ...(summary ? { summary: clip(summary, 300) } : {}),
      ...(source ? { source: clip(source, 200) } : {}),
      // A status says only when it was last set: when a pending one started, a finished one finished.
      ...(state === "pending" ? times(n.createdAt, undefined) : times(undefined, n.createdAt)),
    };
  }
  return null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
function times(started: unknown, completed: unknown): { startedAt?: string; completedAt?: string } {
  const s = str(started);
  const c = str(completed);
  return { ...(ISO.test(s) ? { startedAt: s } : {}), ...(ISO.test(c) ? { completedAt: c } : {}) };
}

const VERDICT: Record<string, ReviewVerdict> = { APPROVED: "approved", CHANGES_REQUESTED: "changes", COMMENTED: "commented", DISMISSED: "dismissed" };

/**
 * Who's asked to review (people and teams) and who reviewed, with each one's
 * latest verdict (not a pending review), reviewers first as GitHub lists
 * them; never the author. A re-request keeps the earlier verdict beside it.
 */
export function reviewersOf(requests: Raw[], latest: Raw[], author?: string): PrReviewer[] {
  const out = new Map<string, PrReviewer>();
  const key = (kind: PrReviewer["kind"], login: string) => `${kind}:${login.toLowerCase()}`;
  for (const r of latest) {
    const who = personOf(r.author);
    const verdict = VERDICT[str(r.state)];
    if (!who || !verdict || who.login === author) continue;
    out.set(key("user", who.login), { kind: "user", ...who, requested: false, verdict });
  }
  for (const r of requests) {
    const who = rec(r.requestedReviewer);
    if (who.__typename === "Team") {
      const slug = str(who.slug);
      if (!TEAM_SLUG.test(slug)) continue;
      const name = clip(str(who.name), 200);
      out.set(key("team", slug), { kind: "team", login: slug, ...(name && name !== slug ? { name } : {}), requested: true, verdict: null });
      continue;
    }
    const p = personOf(who);
    if (!p || p.login === author) continue;
    const was = out.get(key("user", p.login));
    out.set(key("user", p.login), { kind: "user", ...p, requested: true, verdict: was?.verdict ?? null });
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
    headRepo: REPO.test(str(rec(p.headRepository).nameWithOwner)) ? str(rec(p.headRepository).nameWithOwner) : null,
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
    assignees: nodes(p.assignees)
      .map(personOf)
      .filter((a): a is Person => a !== null),
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
    if (!detail) throw new GithubApiError("not-found", `GitHub has no pull request #${number} in ${repo}, or the token can't see it.`);
    return detail;
  });
}

// ── diff ─────────────────────────────────────────────────────────────────────
/** GitHub's REST file list (`pulls/:n/files`) as diff files, from their patches. */
export function filesFromPatches(list: unknown[]): DiffFile[] {
  const files: DiffFile[] = [];
  for (const raw of list) {
    const f = rec(raw);
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

/** GitHub refused to make the diff as too large (406, or its words for it). */
const diffTooLargeForGithub = (e: unknown) =>
  e instanceof GithubApiError && (e.status === 406 || /too_large|too large|exceeded the maximum|maximum number/i.test(e.message));

/** GitHub lists at most 3,000 of a PR's files. */
export const MAX_PATCH_FILES = 3000;

export function readDiff(repo: string, number: number, fresh = false): Promise<PrDiff> {
  return cached(diffKey(repo, number), fresh, async () => {
    try {
      return parseUnifiedDiff(await githubText(`repos/${repo}/pulls/${number}`, "application/vnd.github.diff"));
    } catch (e) {
      if (!diffTooLargeForGithub(e)) throw e;
    }
    const list = await githubPaged<unknown>(`repos/${repo}/pulls/${number}/files?per_page=100`, MAX_PATCH_FILES);
    return { files: filesFromPatches(list), tooLarge: true };
  });
}

// ── Parameters ───────────────────────────────────────────────────────────────
/** A `repo` and `number` query, checked; nothing else may be given (but `fresh=1`). */
export function prParams(params: URLSearchParams): { repo: string; number: number } {
  for (const k of params.keys()) if (!["repo", "number", "fresh"].includes(k)) throw new GithubApiError("invalid", `Unexpected parameter ${k}`);
  const repo = params.get("repo") ?? "";
  const n = params.get("number") ?? "";
  if (!REPO.test(repo) || repo.includes("..")) throw new GithubApiError("invalid", "Name the repository: repo=owner/name");
  if (!/^[1-9]\d{0,8}$/.test(n)) throw new GithubApiError("invalid", "Name the pull request: number");
  return { repo, number: Number(n) };
}
