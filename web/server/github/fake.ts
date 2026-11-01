/**
 * A fake gh for the GitHub tab's tests: it answers the exact calls the server
 * makes (`client.ts`, `reads.ts`, `writes.ts`) from its state and records the
 * writes. `installFakeGithub` enables GitHub in the test settings file and
 * puts gh back (and the settings) on `restore()`. Nothing reaches GitHub.
 */
import { readSettings, writeSettings } from "../settings";
import { GITHUB_TAB, resetGithubTab } from "./client";

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
  viewer: Raw;
  /** Search results by scope's query text. */
  search: Record<string, Raw[]>;
  /** PRs by `owner/name#n`. */
  prs: Map<string, Raw>;
  diffs: Map<string, string | Error>;
  /** Every gh call: its arguments and stdin. */
  calls: { args: string[]; input?: string }[];
  /** The writes: REST posts with their parsed input, and GraphQL mutations with their variables. */
  writes: { path?: string; mutation?: string; input?: unknown; vars?: Record<string, string> }[];
  /** Answered instead of everything, while set (a failing gh). */
  fail?: Error;
  restore: () => void;
};

/** gh's `-f`/`-F` fields as an object. */
function fieldsOf(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++)
    if ((args[i] === "-f" || args[i] === "-F") && args[i + 1]) {
      const at = args[i + 1]!.indexOf("=");
      out[args[i + 1]!.slice(0, at)] = args[i + 1]!.slice(at + 1);
      i++;
    }
  return out;
}

export function installFakeGithub(): FakeGithub {
  const realRun = GITHUB_TAB.run;
  const had = readSettings();
  writeSettings({ integrations: { ...((had?.integrations as object) ?? {}), github: true } });
  resetGithubTab();
  const fake: FakeGithub = {
    viewer: { login: "me", name: "Me", avatarUrl: "https://avatars.githubusercontent.com/u/9?v=4" },
    search: {},
    prs: new Map(),
    diffs: new Map(),
    calls: [],
    writes: [],
    restore: () => {
      GITHUB_TAB.run = realRun;
      writeSettings({ integrations: (had?.integrations as object) ?? {} });
      resetGithubTab();
    },
  };
  GITHUB_TAB.run = async (args, input) => {
    fake.calls.push({ args, ...(input !== undefined ? { input } : {}) });
    if (fake.fail) throw fake.fail;
    if (args[0] === "api" && args[1] === "graphql") {
      const vars = fieldsOf(args);
      const query = vars.query ?? "";
      delete vars.query;
      if (query.startsWith("mutation")) {
        fake.writes.push({ mutation: /\{\s*(\w+)\(/.exec(query)?.[1], vars });
        return JSON.stringify({ data: { ok: true } });
      }
      if (query.includes("search(")) return JSON.stringify({ data: { viewer: fake.viewer, search: { nodes: fake.search[vars.q ?? ""] ?? [] } } });
      if (query.includes("pullRequest(")) {
        const pr = fake.prs.get(`${vars.owner}/${vars.name}#${vars.number}`) ?? null;
        if (pr && vars.after) return JSON.stringify({ data: { repository: { pullRequest: { files: (pr.morefiles as Raw) ?? { nodes: [] } } } } });
        return JSON.stringify({ data: { repository: { pullRequest: pr } } });
      }
      if (query.includes("viewer")) return JSON.stringify({ data: { viewer: fake.viewer } });
      throw new Error(`The fake gh doesn't know this query: ${query.slice(0, 80)}`);
    }
    if (args[0] === "pr" && args[1] === "diff") {
      const d = fake.diffs.get(`${args[4]}#${args[2]}`);
      if (d instanceof Error) throw d;
      if (d === undefined) throw Object.assign(new Error("gh failed"), { stderr: "no pull requests found" });
      return d;
    }
    if (args[0] === "api" && args[1] === "--paginate") {
      const m = /^repos\/([\w.-]+\/[\w.-]+)\/pulls\/(\d+)\/files/.exec(args[2] ?? "");
      const pr = m ? fake.prs.get(`${m[1]}#${m[2]}`) : undefined;
      return ((pr?.restFiles as Raw[]) ?? []).map((f) => JSON.stringify(f)).join("\n");
    }
    if (args[0] === "api" && args[1] === "-X" && args[2] === "POST") {
      fake.writes.push({ path: args[3], input: input ? JSON.parse(input) : undefined });
      return JSON.stringify({ html_url: `https://github.com/${args[3]}/1` });
    }
    throw new Error(`The fake gh doesn't know: gh ${args.join(" ").slice(0, 80)}`);
  };
  return fake;
}
