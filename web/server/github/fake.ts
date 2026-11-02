/**
 * A fake GitHub API for the GitHub tab's tests (over `../githubFake.ts`): it
 * answers the exact requests the server makes (`reads.ts`, `writes.ts`) from
 * its state and records the writes. `installFakeGithub` enables GitHub with a
 * fake token in the test settings and secrets, and puts them back on
 * `restore()`. Nothing reaches GitHub.
 */
import { installGithubApi, type FakeAnswer, type FakeRequest } from "../githubFake";
import { resetGithubTab } from "./client";

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
export const SHA = "a".repeat(40);

/** A dependency bot's comment (socket-security's) as written, with its table, images and hidden marker. */
export const BOT_MARKDOWN =
  "Review the following changes in direct dependencies. Learn more about [Socket for GitHub](https://socket.dev).\n\n" +
  '<table>\n<thead><tr><th>Diff</th><th width="200px">Package</th><th align="center">Supply Chain<br/>Security</th></tr></thead>\n' +
  '<tbody><tr><td><a href="https://socket.dev/diff/npm/left-pad/1.3.0">Added</a></td><td>left-pad@1.3.0</td>' +
  '<td align="center"><img src="https://github-app-statics.socket.dev/score-100.svg" width="50" height="40"></td></tr></tbody>\n</table>\n\n' +
  "[View full report](https://socket.dev/report)\n\n<!-- overview-comment -->";
/** GitHub's rendering of it (`bodyHTML`): its image through camo, the marker gone. */
export const BOT_HTML =
  '<p dir="auto">Review the following changes in direct dependencies. Learn more about <a href="https://socket.dev" rel="nofollow">Socket for GitHub</a>.</p>\n' +
  '<markdown-accessiblity-table><table>\n<thead><tr><th>Diff</th><th width="200px">Package</th><th align="center">Supply Chain<br>Security</th></tr></thead>\n' +
  '<tbody><tr><td><a href="https://socket.dev/diff/npm/left-pad/1.3.0" rel="nofollow">Added</a></td><td>left-pad@1.3.0</td>' +
  '<td align="center"><a target="_blank" rel="noopener noreferrer nofollow" href="https://camo.githubusercontent.com/5c0ffee/68747470733a2f2f"><img src="https://camo.githubusercontent.com/5c0ffee/68747470733a2f2f" width="50" height="40" data-canonical-src="https://github-app-statics.socket.dev/score-100.svg" style="max-width: 100%;"></a></td></tr></tbody>\n</table></markdown-accessiblity-table>\n' +
  '<p dir="auto"><a href="https://socket.dev/report" rel="nofollow">View full report</a></p>\n';
/** A description with a folded block, as written and as GitHub renders it. */
export const DETAILS_MARKDOWN = "Fixes it.\n\n<details><summary>Why</summary>\n\nThe <kbd>⌘K</kbd> list was **short**.\n\n</details>\n<!-- hidden note -->";
export const DETAILS_HTML =
  '<p dir="auto">Fixes it.</p>\n<details>\n<summary>Why</summary>\n<p dir="auto">The <kbd>⌘K</kbd> list was <strong>short</strong>.</p>\n</details>\n';

export function fakePr(o: Partial<Raw> & { number: number; repo?: string } = { number: 1 }): Raw {
  const repo = o.repo ?? "owen/app";
  const { repo: _, number: __, ...rest } = o;
  return {
    id: `PR_${o.number}`,
    number: o.number,
    title: `PR ${o.number}`,
    url: `https://github.com/${repo}/pull/${o.number}`,
    isDraft: false,
    state: "OPEN",
    createdAt: "2026-10-30T09:00:00Z",
    updatedAt: `2026-10-30T10:00:0${o.number % 10}Z`,
    headRefName: `feature-${o.number}`,
    baseRefName: "main",
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    repository: { nameWithOwner: repo },
    author: { login: "ada", name: "Ada", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
    comments: { totalCount: 1 },
    reviewDecision: "REVIEW_REQUIRED",
    viewerLatestReview: null,
    labels: { nodes: [{ name: "bug", color: "d73a4a" }] },
    checks: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
    body: "Fixes it.",
    headRefOid: SHA,
    headRepository: { nameWithOwner: repo },
    mergeable: "MERGEABLE",
    viewerDidAuthor: false,
    files: { nodes: [{ path: "src/app.ts", additions: 3, deletions: 1, changeType: "MODIFIED", viewerViewedState: "UNVIEWED" }], pageInfo: { hasNextPage: false, endCursor: null } },
    timelineComments: { nodes: [{ id: "IC_1", author: { login: "bob" }, body: "Looks close.", createdAt: "2026-10-30T09:30:00Z", url: `https://github.com/${repo}/pull/${o.number}#issuecomment-1` }] },
    reviews: { nodes: [] },
    reviewThreads: {
      nodes: [
        {
          id: "RT_1",
          path: "src/app.ts",
          line: 2,
          startLine: null,
          diffSide: "RIGHT",
          isResolved: false,
          isOutdated: false,
          viewerCanResolve: true,
          viewerCanUnresolve: false,
          viewerCanReply: true,
          comments: { nodes: [{ id: "RC_1", databaseId: 101, author: { login: "bob" }, body: "Why 3?", createdAt: "2026-10-30T09:40:00Z", url: `https://github.com/${repo}/pull/${o.number}#discussion_r101` }] },
        },
      ],
    },
    commits: { nodes: [{ commit: { oid: SHA, messageHeadline: "Change b", committedDate: "2026-10-30T08:00:00Z", author: { name: "Ada", user: { login: "ada", avatarUrl: null } } } }] },
    rollup: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              state: "SUCCESS",
              contexts: {
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "test",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                    detailsUrl: "https://github.com/x",
                    title: "All good",
                    startedAt: "2026-10-30T09:00:00Z",
                    completedAt: "2026-10-30T09:02:05Z",
                    checkSuite: { app: { name: "GitHub Actions" }, workflowRun: { workflow: { name: "CI" } } },
                  },
                ],
              },
            },
          },
        },
      ],
    },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me", name: "Me" } }] },
    latestReviews: { nodes: [] },
    assignees: { nodes: [{ login: "ada", name: "Ada", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" }] },
    // The merge box: clean, every method allowed, the token may do everything; no queue, no auto-merge.
    mergeStateStatus: "CLEAN",
    isMergeQueueEnabled: false,
    isInMergeQueue: false,
    mergeQueueEntry: null,
    viewerCanUpdate: true,
    viewerCanClose: true,
    viewerCanReopen: true,
    viewerCanMergeAsAdmin: false,
    viewerCanUpdateBranch: false,
    viewerCanEnableAutoMerge: true,
    viewerCanDisableAutoMerge: true,
    viewerCanDeleteHeadRef: true,
    autoMergeRequest: null,
    headRef: { id: `REF_${o.number}` },
    mergedAt: null,
    closedAt: null,
    mergedBy: null,
    mergeTitle: `Merge pull request #${o.number} from ada/feature-${o.number}`,
    mergeBody: `PR ${o.number}`,
    squashTitle: `PR ${o.number} (#${o.number})`,
    squashBody: "* Change b",
    baseRepo: { viewerPermission: "WRITE", mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true, autoMergeAllowed: true, deleteBranchOnMerge: false },
    ...rest,
  };
}

/** A repository as the repos query asks for it. */
export function fakeRepo(repo: string, open = 1, o: Partial<Raw> = {}): Raw {
  return { nameWithOwner: repo, isArchived: false, isPrivate: false, owner: { login: repo.split("/")[0] }, pullRequests: { totalCount: open }, ...o };
}

export const FAKE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index 1..2 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,2 +1,4 @@
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
+const d = 5;
`;

export type FakeGithub = {
  /** `GET user`'s answer. */
  viewer: Raw;
  /** The token's scopes, as `X-OAuth-Scopes` says them. */
  scopes: string;
  /** What a PR search counts, by its text, when more than it answers. */
  counts: Record<string, number>;
  /** PR search results by the query's text (a scope's, a repository's with its filters). */
  search: Record<string, Raw[]>;
  /** Repository search results by the query's text (`repoSearchQuery`'s `q`). */
  repoSearch: Record<string, Raw[]>;
  /** A repository's assignable users and its recent PRs' authors, by `owner/name` (lowercase), for the people query. */
  people: Map<string, { assignable: Raw[]; authors: Raw[] }>;
  /** The teams with access to a repository, by `owner/name`, as REST lists them (`{ slug, name }`), or GitHub's refusal. */
  teams: Map<string, Raw[] | FakeAnswer>;
  /** The viewer's repositories, repositories by `owner/name` (lowercase), and owners' (by lowercase login), for the repos query. */
  viewerRepos: Raw[];
  repos: Map<string, Raw>;
  owners: Map<string, Raw[]>;
  /** PRs by `owner/name#n`. */
  prs: Map<string, Raw>;
  /** A branch's rules (REST `rules/branches`), by `owner/name:branch`, or GitHub's refusal; none by default. */
  rules: Map<string, Raw[] | FakeAnswer>;
  /** Diffs by `owner/name#n`, or GitHub's refusal. */
  diffs: Map<string, string | FakeAnswer>;
  /** Every request made. */
  calls: FakeRequest[];
  /** The writes: REST posts with their body, and GraphQL mutations with their variables. */
  writes: { method?: string; path?: string; mutation?: string; input?: unknown; vars?: Record<string, unknown> }[];
  /** Answered instead of everything, while set (GitHub refusing). */
  fail?: FakeAnswer;
  /** GraphQL mutations GitHub refuses, by name, with its error's message. */
  refuse: Record<string, string>;
  restore: () => void;
};

const notFound: FakeAnswer = { status: 404, json: { message: "Not Found" } };

export function installFakeGithub(opts: { enabled?: boolean; token?: string | null } = {}): FakeGithub {
  resetGithubTab();
  const fake: FakeGithub = {
    viewer: { login: "me", name: "Me", avatar_url: "https://avatars.githubusercontent.com/u/9?v=4" },
    scopes: "repo, notifications, read:org",
    search: {},
    counts: {},
    repoSearch: {},
    people: new Map(),
    teams: new Map(),
    viewerRepos: [],
    repos: new Map(),
    owners: new Map(),
    prs: new Map(),
    diffs: new Map(),
    rules: new Map(),
    calls: [],
    writes: [],
    refuse: {},
    restore: () => {},
  };
  /** A mutation done to the PR it names (`vars.id`): GitHub keeps it, so the next read says so. */
  const mutate = (name: string, vars: Record<string, unknown>): Raw => {
    const pr = [...fake.prs.values()].find((p) => p.id === vars.id);
    if (!pr) return {};
    const now = "2026-10-31T12:00:00Z";
    switch (name) {
      case "mergePullRequest":
        Object.assign(pr, { state: "MERGED", mergedAt: now, closedAt: now, mergedBy: { login: fake.viewer.login }, autoMergeRequest: null, isInMergeQueue: false, mergeQueueEntry: null });
        return { pullRequest: { state: "MERGED", merged: true } };
      case "enablePullRequestAutoMerge":
        pr.autoMergeRequest = { mergeMethod: vars.method, enabledAt: now, enabledBy: { login: fake.viewer.login } };
        break;
      case "disablePullRequestAutoMerge":
        pr.autoMergeRequest = null;
        break;
      case "enqueuePullRequest":
        Object.assign(pr, { isInMergeQueue: true, mergeQueueEntry: { state: "QUEUED", position: 1 } });
        break;
      case "dequeuePullRequest":
        Object.assign(pr, { isInMergeQueue: false, mergeQueueEntry: null });
        break;
      case "markPullRequestReadyForReview":
        Object.assign(pr, { isDraft: false, mergeStateStatus: pr.mergeStateStatus === "DRAFT" ? "CLEAN" : pr.mergeStateStatus });
        break;
      case "convertPullRequestToDraft":
        Object.assign(pr, { isDraft: true, mergeStateStatus: "DRAFT" });
        break;
      case "updatePullRequestBranch":
        pr.mergeStateStatus = "CLEAN";
        break;
      case "closePullRequest":
        Object.assign(pr, { state: "CLOSED", closedAt: now });
        break;
      case "reopenPullRequest":
        Object.assign(pr, { state: "OPEN", closedAt: null });
        break;
    }
    return { pullRequest: { id: pr.id } };
  };
  const answer = (req: FakeRequest): FakeAnswer => {
    if (fake.fail) return fake.fail;
    const body = (req.body ?? {}) as { query?: string; variables?: Record<string, unknown> };
    if (req.method === "POST" && req.path === "graphql") {
      const query = body.query ?? "";
      const vars = body.variables ?? {};
      if (query.trimStart().startsWith("mutation")) {
        const name = /\{\s*(\w+)\(/.exec(query)?.[1] ?? "";
        fake.writes.push({ mutation: name, vars });
        if (fake.refuse[name]) return { json: { data: { [name]: null }, errors: [{ type: "UNPROCESSABLE", message: fake.refuse[name] }] } };
        return { json: { data: { ok: true, [name]: mutate(name, vars) } } };
      }
      const viewer = { login: fake.viewer.login, name: fake.viewer.name, avatarUrl: fake.viewer.avatar_url };
      if (query.includes("type: REPOSITORY")) {
        const data: Raw = { search: { nodes: fake.repoSearch[String(vars.q)] ?? [] } };
        if (vars.login !== undefined) {
          const login = String(vars.login).toLowerCase();
          const known = fake.owners.has(login) || [...fake.repos.keys(), ...fake.viewerRepos.map((r) => String(r.nameWithOwner).toLowerCase())].some((r) => r.startsWith(`${login}/`));
          data.owner = known ? { login: vars.login } : null;
        }
        if (vars.name !== undefined) data.exact = fake.repos.get(`${vars.login}/${vars.name}`.toLowerCase()) ?? null;
        return { json: { data } };
      }
      if (query.includes("assignableUsers")) {
        const p = fake.people.get(`${vars.owner}/${vars.name}`.toLowerCase());
        const repository = p ? { assignableUsers: { nodes: p.assignable }, pullRequests: { nodes: p.authors.map((author) => ({ author })) } } : null;
        return { json: { data: { viewer, repository } } };
      }
      if (query.includes("search(")) {
        const data: Raw = { viewer };
        const answer = (q: unknown) => {
          const found = fake.search[String(q ?? "")] ?? [];
          return { issueCount: (fake.counts[String(q ?? "")] ?? found.length), nodes: found };
        };
        if (vars.q !== undefined) data.search = answer(vars.q);
        for (const [k, v] of Object.entries(vars)) {
          const i = /^q(\d+)$/.exec(k)?.[1];
          if (i !== undefined) data[`s${i}`] = answer(v);
        }
        return { json: { data } };
      }
      if (query.includes("fragment R on Repository")) {
        const data: Raw = { viewer: { repositories: { nodes: fake.viewerRepos } } };
        for (const [k, v] of Object.entries(vars)) {
          const r = /^r(\d+)o$/.exec(k);
          if (r) data[`r${r[1]}`] = fake.repos.get(`${v}/${vars[`r${r[1]}n`]}`.toLowerCase()) ?? null;
          if (/^o\d+$/.test(k)) data[k] = fake.owners.has(String(v).toLowerCase()) ? { repositories: { nodes: fake.owners.get(String(v).toLowerCase()) } } : null;
        }
        return { json: { data } };
      }
      if (query.includes("pullRequest(")) {
        const pr = fake.prs.get(`${vars.owner}/${vars.name}#${vars.number}`) ?? null;
        if (pr && vars.after) return { json: { data: { repository: { pullRequest: { files: (pr.morefiles as Raw) ?? { nodes: [] } } } } } };
        return { json: { data: { repository: { pullRequest: pr } } } };
      }
      return { status: 400, json: { message: `The fake GitHub doesn't know this query: ${query.slice(0, 80)}` } };
    }
    if (req.method === "GET" && req.path === "user") return { json: fake.viewer, headers: { "x-oauth-scopes": fake.scopes } };
    const teams = /^repos\/([\w.-]+\/[\w.-]+)\/teams$/.exec(req.path);
    if (req.method === "GET" && teams) {
      const t = fake.teams.get(teams[1]!);
      return t === undefined ? { json: [] } : Array.isArray(t) ? { json: t } : t;
    }
    const rules = /^repos\/([\w.-]+\/[\w.-]+)\/rules\/branches\/(.+)$/.exec(req.path);
    if (req.method === "GET" && rules) {
      const r = fake.rules.get(`${rules[1]}:${rules[2]!.split("/").map(decodeURIComponent).join("/")}`);
      return r === undefined ? { json: [] } : Array.isArray(r) ? { json: r } : r;
    }
    const pull = /^repos\/([\w.-]+\/[\w.-]+)\/pulls\/(\d+)(\/files)?$/.exec(req.path);
    if (req.method === "GET" && pull) {
      const key = `${pull[1]}#${pull[2]}`;
      if (pull[3]) return { json: (fake.prs.get(key)?.restFiles as Raw[]) ?? [] };
      const d = fake.diffs.get(key);
      if (d === undefined) return notFound;
      if (typeof d !== "string") return d;
      if (req.accept !== "application/vnd.github.diff") return { status: 415, json: { message: "Ask for the diff media type" } };
      return { text: d };
    }
    if (req.method === "POST") {
      fake.writes.push({ method: "POST", path: req.path, input: req.body });
      return { status: 201, json: { html_url: `https://github.com/${req.path}/1` } };
    }
    if (req.method === "DELETE") {
      fake.writes.push({ method: "DELETE", path: req.path, input: req.body });
      const ref = /^repos\/([\w.-]+\/[\w.-]+)\/git\/refs\/heads\/(.+)$/.exec(req.path);
      if (ref) {
        const branch = ref[2]!.split("/").map(decodeURIComponent).join("/");
        const pr = [...fake.prs.values()].find((p) => p.headRefName === branch && (rec(p.headRepository).nameWithOwner ?? "") === ref[1]);
        if (!pr?.headRef) return { status: 422, json: { message: "Reference does not exist" } };
        pr.headRef = null;
        return { status: 204 };
      }
      return { json: {} };
    }
    return { status: 400, json: { message: `The fake GitHub doesn't know: ${req.method} ${req.path}` } };
  };
  const api = installGithubApi((req) => answer(req), opts);
  fake.calls = api.calls;
  fake.restore = () => {
    api.restore();
    resetGithubTab();
  };
  return fake;
}
