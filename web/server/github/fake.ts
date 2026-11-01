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
export const SHA = "a".repeat(40);

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
    rollup: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "https://github.com/x", title: "All good" }] } } } }] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "me" } }] },
    latestReviews: { nodes: [] },
    ...rest,
  };
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
  /** Search results by scope's query text. */
  search: Record<string, Raw[]>;
  /** PRs by `owner/name#n`. */
  prs: Map<string, Raw>;
  /** Diffs by `owner/name#n`, or GitHub's refusal. */
  diffs: Map<string, string | FakeAnswer>;
  /** Every request made. */
  calls: FakeRequest[];
  /** The writes: REST posts with their body, and GraphQL mutations with their variables. */
  writes: { path?: string; mutation?: string; input?: unknown; vars?: Record<string, unknown> }[];
  /** Answered instead of everything, while set (GitHub refusing). */
  fail?: FakeAnswer;
  restore: () => void;
};

const notFound: FakeAnswer = { status: 404, json: { message: "Not Found" } };

export function installFakeGithub(opts: { enabled?: boolean; token?: string | null } = {}): FakeGithub {
  resetGithubTab();
  const fake: FakeGithub = {
    viewer: { login: "me", name: "Me", avatar_url: "https://avatars.githubusercontent.com/u/9?v=4" },
    scopes: "repo, notifications, read:org",
    search: {},
    prs: new Map(),
    diffs: new Map(),
    calls: [],
    writes: [],
    restore: () => {},
  };
  const answer = (req: FakeRequest): FakeAnswer => {
    if (fake.fail) return fake.fail;
    const body = (req.body ?? {}) as { query?: string; variables?: Record<string, unknown> };
    if (req.method === "POST" && req.path === "graphql") {
      const query = body.query ?? "";
      const vars = body.variables ?? {};
      if (query.trimStart().startsWith("mutation")) {
        fake.writes.push({ mutation: /\{\s*(\w+)\(/.exec(query)?.[1], vars });
        return { json: { data: { ok: true } } };
      }
      const viewer = { login: fake.viewer.login, name: fake.viewer.name, avatarUrl: fake.viewer.avatar_url };
      if (query.includes("search(")) return { json: { data: { viewer, search: { nodes: fake.search[String(vars.q ?? "")] ?? [] } } } };
      if (query.includes("pullRequest(")) {
        const pr = fake.prs.get(`${vars.owner}/${vars.name}#${vars.number}`) ?? null;
        if (pr && vars.after) return { json: { data: { repository: { pullRequest: { files: (pr.morefiles as Raw) ?? { nodes: [] } } } } } };
        return { json: { data: { repository: { pullRequest: pr } } } };
      }
      return { status: 400, json: { message: `The fake GitHub doesn't know this query: ${query.slice(0, 80)}` } };
    }
    if (req.method === "GET" && req.path === "user") return { json: fake.viewer, headers: { "x-oauth-scopes": fake.scopes } };
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
      fake.writes.push({ path: req.path, input: req.body });
      return { status: 201, json: { html_url: `https://github.com/${req.path}/1` } };
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
