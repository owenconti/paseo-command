/**
 * Activity's GitHub source over a fake gh: nothing here runs gh or reaches GitHub.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import {
  GITHUB_ACTIVITY,
  NO_GH,
  SIGNED_OUT,
  githubActivityFile,
  githubItem,
  readGithubActivity,
  resetGithubActivity,
  stateQuery,
  statesFrom,
  subjectUrl,
  writeGithubActivity,
} from "./github";

const realRun = GITHUB_ACTIVITY.run;
let calls: string[][] = [];
let answer: (args: string[]) => string | Error;

const thread = (id: string, o: { type?: string; url?: string | null; unread?: boolean; at?: string; reason?: string } = {}) => ({
  id,
  unread: o.unread ?? true,
  reason: o.reason ?? "review_requested",
  updated_at: o.at ?? "2026-10-30T10:00:00Z",
  subject: {
    title: `Thread ${id}`,
    url: o.url === undefined ? `https://api.github.com/repos/owen/app/pulls/${id}` : o.url,
    type: o.type ?? "PullRequest",
  },
  repository: { full_name: "owen/app", html_url: "https://github.com/owen/app" },
});

beforeEach(() => {
  resetGithubActivity();
  calls = [];
  answer = () => "[]";
  GITHUB_ACTIVITY.run = async (args) => {
    calls.push(args);
    const out = answer(args);
    if (out instanceof Error) throw out;
    return out;
  };
});
afterEach(() => {
  GITHUB_ACTIVITY.run = realRun;
});

test("subjects open on their GitHub pages", () => {
  assert.equal(subjectUrl("https://api.github.com/repos/o/r/pulls/12", "PullRequest"), "https://github.com/o/r/pull/12");
  assert.equal(subjectUrl("https://api.github.com/repos/o/r/issues/7", "Issue"), "https://github.com/o/r/issues/7");
  assert.equal(subjectUrl("https://api.github.com/repos/o/r/releases/123", "Release"), "https://github.com/o/r/releases");
  assert.equal(subjectUrl("https://api.github.com/repos/o/r/commits/abcdef1", "Commit"), "https://github.com/o/r/commit/abcdef1");
  assert.equal(subjectUrl("", "CheckSuite", "https://github.com/o/r"), "https://github.com/o/r/actions");
  assert.equal(subjectUrl("", "Discussion", "https://github.com/o/r"), "https://github.com/o/r/discussions");
  assert.equal(subjectUrl("javascript:alert(1)", "Issue"), undefined);
});

test("a thread maps to an item", () => {
  assert.deepEqual(githubItem(thread("12")), {
    key: "github:12",
    source: "github",
    id: "12",
    kind: "review_requested",
    title: "Thread 12",
    subtitle: "owen/app #12",
    subject: "pull",
    at: "2026-10-30T10:00:00Z",
    unread: true,
    url: "https://github.com/owen/app/pull/12",
  });
  assert.equal(githubItem({ id: "../x" }), null);
  const release = githubItem(thread("9", { type: "Release", url: "https://api.github.com/repos/owen/app/releases/9" }))!;
  assert.equal(release.subject, "release");
  assert.equal(release.subtitle, "owen/app");
});

test("states come from one query by alias", () => {
  const refs = [
    { repo: "owen/app", number: "12" },
    { repo: "owen/app", number: "13" },
    { repo: "bad repo/x", number: "1" },
  ];
  const q = stateQuery(refs)!;
  assert.match(q, /r0: repository\(owner: "owen", name: "app"\) \{ n12: .* n13: /);
  assert.doesNotMatch(q, /bad repo/);
  const states = statesFrom(refs, {
    data: { r0: { n12: { state: "OPEN", isDraft: true }, n13: { state: "MERGED", isDraft: false } } },
  });
  assert.equal(states.get("owen/app#12"), "draft");
  assert.equal(states.get("owen/app#13"), "merged");
});

test("reads notifications, pages to 100, adds states and caches a minute", async () => {
  answer = (args) => {
    if (args[1] === "graphql") return JSON.stringify({ data: { r0: { n1: { state: "OPEN", isDraft: false } } } });
    const page = Number(/page=(\d+)$/.exec(args[3]!)![1]);
    return JSON.stringify(Array.from({ length: 50 }, (_, i) => thread(String((page - 1) * 50 + i + 1))));
  };
  const items = await readGithubActivity();
  assert.equal(items.length, 100);
  assert.equal(calls.filter((c) => c[1] !== "graphql").length, 2);
  assert.match(calls[0]![3]!, /^\/notifications\?all=true&since=[^&]+&per_page=50&page=1$/);
  assert.equal(items.find((i) => i.id === "1")!.state, "open");
  await readGithubActivity();
  assert.equal(calls.length, 3, "cached");
  await readGithubActivity(true);
  assert.equal(calls.length, 6, "fresh asks again");
});

test("a failing state query leaves items without states", async () => {
  answer = (args) => (args[1] === "graphql" ? new Error("boom") : JSON.stringify([thread("1")]));
  const items = await readGithubActivity();
  assert.equal(items.length, 1);
  assert.equal(items[0]!.state, undefined);
});

test("a state query with errors for some items keeps the states it did answer", async () => {
  answer = (args) =>
    args[1] === "graphql"
      ? Object.assign(new Error("gh exited 1"), {
          stderr: "GraphQL: Could not resolve to a Repository",
          stdout: JSON.stringify({ data: { r0: { n1: { state: "MERGED", isDraft: false } } }, errors: [{ message: "Could not resolve" }] }),
        })
      : JSON.stringify([thread("1")]);
  const items = await readGithubActivity();
  assert.equal(items[0]!.state, "merged");
});

test("gh missing or signed out says so plainly", async () => {
  answer = () => Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" });
  await assert.rejects(readGithubActivity(), { message: NO_GH });
  answer = () => Object.assign(new Error("exit 4"), { stderr: "To get started with GitHub CLI, please run:  gh auth login" });
  await assert.rejects(readGithubActivity(), { message: SIGNED_OUT });
});

test("writes read and done; unread can't be done on GitHub", async () => {
  answer = (args) => (args[1] === "graphql" ? "{}" : args[1] === "-X" && args[2] === "GET" ? JSON.stringify([thread("5"), thread("6")]) : "");
  const [five, six] = await readGithubActivity();
  assert.deepEqual(await writeGithubActivity("read", [five!]), []);
  assert.deepEqual(calls.at(-1), ["api", "-X", "PATCH", "/notifications/threads/5"]);
  assert.equal((await readGithubActivity()).find((i) => i.id === "5")!.unread, false);
  assert.deepEqual(await writeGithubActivity("done", [six!]), []);
  assert.deepEqual(calls.at(-1), ["api", "-X", "DELETE", "/notifications/threads/6"]);
  assert.deepEqual((await readGithubActivity()).map((i) => i.id), ["5"]);
  const unread = await writeGithubActivity("unread", [five!]);
  assert.equal(unread.length, 1);
  assert.match(unread[0]!.error, /can't mark a notification unread/);
  answer = () => new Error("HTTP 401: Bad credentials");
  assert.deepEqual(await writeGithubActivity("read", [five!]), [{ key: "github:5", error: SIGNED_OUT }]);
});

test("what's marked done stays done after the app reopens, until GitHub has something new on it", async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  let seven = thread("7", { unread: false, at: yesterday });
  // GitHub's list (all=true) still has a thread marked done, as read.
  answer = (args) => (args[1] === "graphql" ? "{}" : args[2] === "GET" ? JSON.stringify([thread("5", { at: yesterday }), seven]) : "");
  const items = await readGithubActivity();
  assert.deepEqual(await writeGithubActivity("done", [items.find((i) => i.id === "7")!]), []);
  assert.deepEqual(JSON.parse(readFileSync(githubActivityFile(), "utf8")), { done: { "7": yesterday } });

  // Reopened: nothing kept in memory, the file read again.
  resetGithubActivity({ relaunch: true });
  assert.deepEqual((await readGithubActivity()).map((i) => i.id), ["5"]);

  // New activity on it: back, as in GitHub's inbox.
  seven = thread("7", { at: new Date().toISOString() });
  assert.deepEqual((await readGithubActivity(true)).map((i) => i.id).sort(), ["5", "7"]);

  // A test's own reset leaves no file behind.
  resetGithubActivity();
  assert.equal(existsSync(githubActivityFile()), false);
});
