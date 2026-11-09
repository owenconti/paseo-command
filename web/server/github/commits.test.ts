import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { installGithubApi } from "../githubFake";
import { resetGithubTab } from "./client";
import { githubRoute } from "./route";
const A = "a".repeat(40),
  B = "b".repeat(40);
let fake: ReturnType<typeof installGithubApi>;
beforeEach(() => {
  resetGithubTab();
  fake = installGithubApi((req) => {
    if (req.path === "graphql") {
      const vars = (req.body as { variables: Record<string, string> })
        .variables;
      const sha = vars.after ? B : A;
      return {
        json: {
          data: {
            repository: {
              object: {
                oid: A,
                history: {
                  nodes: [
                    {
                      oid: sha,
                      messageHeadline: "Fix the map",
                      committedDate: "2026-11-08T12:00:00Z",
                      author: { name: "Ada", user: { login: "ada" } },
                    },
                  ],
                  pageInfo: {
                    hasNextPage: !vars.after,
                    endCursor: vars.after ? null : "next-cursor",
                  },
                },
              },
            },
          },
        },
      };
    }
    if (req.accept.includes("diff"))
      return {
        text: "diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n",
      };
    return {
      json: {
        commit: {
          message: "Fix the map\n\nFull explanation",
          author: { name: "Ada" },
          committer: { date: "2026-11-08T12:00:00Z" },
        },
        parents: [{ sha: B }],
        stats: { additions: 1, deletions: 1 },
      },
    };
  });
});
afterEach(() => fake.restore());
async function ask(query: string) {
  let result: { status: number; body: any } | undefined;
  const req = Object.assign(Readable.from([]), {
    method: "GET",
    headers: {},
  }) as unknown as IncomingMessage;
  await githubRoute(
    req,
    new URL(`/api/github/q/${query}`, "http://localhost"),
    (status, body) => {
      result = { status, body };
    },
  );
  return result!;
}
test("history follows main and older pages use the pinned head and checked cursor", async () => {
  const first = await ask("commits?repo=owen/app");
  assert.equal(first.status, 200);
  assert.equal(first.body.head, A);
  assert.equal(first.body.more, true);
  assert.equal(first.body.rows[0].author, "Ada");
  const initial = (fake.calls[0]!.body as { variables: Record<string, string> })
    .variables;
  assert.equal(initial.ref, "refs/heads/main");
  const next = await ask(`commits?repo=owen/app&head=${A}&after=next-cursor`);
  assert.equal(next.body.rows[0].sha, B);
  assert.equal(next.body.more, false);
  const pinned = (fake.calls[1]!.body as { variables: Record<string, string> })
    .variables;
  assert.equal(pinned.ref, A);
  assert.equal(pinned.after, "next-cursor");
  await ask("commits?repo=owen/app");
  assert.equal(fake.calls.length, 2, "tip reads use the cache");
  await ask("commits?repo=owen/app&fresh=1");
  assert.equal(fake.calls.length, 3);
});
test("commit detail contains its full message, author, parents and file diff", async () => {
  const r = await ask(`commit?repo=owen/app&sha=${A}`);
  assert.equal(r.status, 200);
  assert.match(r.body.message, /Full explanation/);
  assert.deepEqual(r.body.parents, [B]);
  assert.equal(r.body.files[0].path, "app.ts");
  assert.equal(r.body.files[0].additions, 1);
  assert.equal(r.body.tooLarge, false);
});
test("rejects unbounded or malformed parameters before contacting GitHub", async () => {
  for (const q of [
    "commits?repo=../oops",
    "commits?repo=owen/app&after=cursor",
    "commits?repo=owen/app&head=main",
    `commits?repo=owen/app&head=${A}&after=${"x".repeat(513)}`,
    "commit?repo=owen/app&sha=main",
    `commit?repo=owen/app&sha=${A}&extra=1`,
  ])
    assert.equal((await ask(q)).status, 400, q);
  assert.equal(fake.calls.length, 0);
});

test("a missing main branch is reported as unavailable, never as an empty successful history", async () => {
  fake.restore();
  resetGithubTab();
  fake = installGithubApi(() => ({
    json: { data: { repository: { object: null } } },
  }));
  const r = await ask("commits?repo=owen/app");
  assert.equal(r.status, 200);
  assert.equal(r.body.available, false);
  assert.match(r.body.reason, /no readable main/);
});
test("a large diff is labelled partial while preserving the file patches GitHub provides", async () => {
  fake.restore();
  resetGithubTab();
  fake = installGithubApi((req) =>
    req.accept.includes("diff")
      ? { status: 406, json: { message: "Diff too large" } }
      : {
          json: {
            commit: { message: "Large change" },
            files: [
              {
                filename: "app.ts",
                status: "modified",
                additions: 1,
                deletions: 1,
                patch: "@@ -1 +1 @@\n-old\n+new",
              },
            ],
          },
        },
  );
  const r = await ask(`commit?repo=owen/app&sha=${A}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.tooLarge, true);
  assert.equal(r.body.files[0].path, "app.ts");
});
