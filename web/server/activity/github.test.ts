/**
 * Activity's GitHub source over a fake GitHub API (`githubFake.ts`): nothing here reaches GitHub.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { NO_KEY, OFF, REFUSED } from "../githubApi";
import { installGithubApi, type FakeAnswer, type FakeRequest } from "../githubFake";
import {
  githubActivityFile,
  githubItem,
  readGithubActivity,
  resetGithubActivity,
  stateQuery,
  statesFrom,
  subjectUrl,
  writeGithubActivity,
} from "./github";
import { ACTIVITY_MARKS } from "./marks";

let fake: ReturnType<typeof installGithubApi>;
let answer: (req: FakeRequest) => FakeAnswer | Promise<FakeAnswer>;
const calls = () => fake.calls;
const isList = (r: FakeRequest) => r.method === "GET" && r.path === "notifications";

const thread = (
  id: string,
  o: { type?: string; url?: string | null; unread?: boolean; at?: string; reason?: string; lastRead?: string } = {},
) => ({
  id,
  unread: o.unread ?? true,
  last_read_at: o.lastRead ?? null,
  reason: o.reason ?? "review_requested",
  updated_at: o.at ?? "2026-10-30T10:00:00Z",
  subject: {
    title: `Thread ${id}`,
    url: o.url === undefined ? `https://api.github.com/repos/owen/app/pulls/${id}` : o.url,
    type: o.type ?? "PullRequest",
  },
  repository: { full_name: "owen/app", html_url: "https://github.com/owen/app" },
});

/** The marks' clock, moved by the tests. */
let clock = Date.now();
const realNow = ACTIVITY_MARKS.now;
const later = (ms: number) => (clock += ms);
const iso = (ms = 0) => new Date(clock + ms).toISOString();

beforeEach(() => {
  clock = Date.now();
  ACTIVITY_MARKS.now = () => clock;
  resetGithubActivity();
  answer = () => ({ json: [] });
  fake = installGithubApi((req) => answer(req));
});
afterEach(() => {
  ACTIVITY_MARKS.now = realNow;
  fake.restore();
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
  answer = (req) => {
    if (req.path === "graphql") return { json: { data: { r0: { n1: { state: "OPEN", isDraft: false } } } } };
    const page = Number(req.query.get("page"));
    return { json: Array.from({ length: 50 }, (_, i) => thread(String((page - 1) * 50 + i + 1))) };
  };
  const items = await readGithubActivity();
  assert.equal(items.length, 100);
  assert.equal(calls().filter(isList).length, 2);
  const first = calls()[0]!;
  assert.equal(first.query.get("all"), "true");
  assert.ok(first.query.get("since"));
  assert.equal(first.query.get("per_page"), "50");
  assert.equal(first.query.get("page"), "1");
  assert.match(first.authorization, /^Bearer ghp_/);
  assert.equal(items.find((i) => i.id === "1")!.state, "open");
  await readGithubActivity();
  assert.equal(calls().length, 3, "cached");
  await readGithubActivity(true);
  assert.equal(calls().length, 6, "fresh asks again");
});

test("a failing state query leaves items without states", async () => {
  answer = (req) => (req.path === "graphql" ? { status: 502, json: { message: "boom" } } : { json: [thread("1")] });
  const items = await readGithubActivity();
  assert.equal(items.length, 1);
  assert.equal(items[0]!.state, undefined);
});

test("a state query with errors for some items keeps the states it did answer", async () => {
  answer = (req) =>
    req.path === "graphql"
      ? { json: { data: { r0: { n1: { state: "MERGED", isDraft: false } } }, errors: [{ message: "Could not resolve" }] } }
      : { json: [thread("1")] };
  const items = await readGithubActivity();
  assert.equal(items[0]!.state, "merged");
});

test("no token, a refused token or GitHub off says so plainly", async () => {
  answer = () => ({ status: 401, json: { message: "Bad credentials" } });
  await assert.rejects(readGithubActivity(), { message: REFUSED });
  fake.restore();
  fake = installGithubApi(() => ({ json: [] }), { token: null });
  await assert.rejects(readGithubActivity(), { message: NO_KEY });
  fake.restore();
  fake = installGithubApi(() => ({ json: [] }), { enabled: false });
  await assert.rejects(readGithubActivity(), { message: OFF });
  assert.equal(fake.calls.length, 0, "nothing asked without a token or while off");
});

test("writes read and done; unread can't be done on GitHub", async () => {
  answer = (req) => (req.path === "graphql" ? { json: { data: {} } } : isList(req) ? { json: [thread("5"), thread("6")] } : { status: 205 });
  const [five, six] = await readGithubActivity();
  assert.deepEqual(await writeGithubActivity("read", [five!]), []);
  assert.deepEqual([calls().at(-1)!.method, calls().at(-1)!.path], ["PATCH", "notifications/threads/5"]);
  assert.equal((await readGithubActivity()).find((i) => i.id === "5")!.unread, false);
  assert.deepEqual(await writeGithubActivity("done", [six!]), []);
  assert.deepEqual([calls().at(-1)!.method, calls().at(-1)!.path], ["DELETE", "notifications/threads/6"]);
  assert.deepEqual((await readGithubActivity()).map((i) => i.id), ["5"]);
  const unread = await writeGithubActivity("unread", [five!]);
  assert.equal(unread.length, 1);
  assert.match(unread[0]!.error, /can't mark a notification unread/);
  answer = () => ({ status: 401, json: { message: "Bad credentials" } });
  assert.deepEqual(await writeGithubActivity("read", [five!]), [{ key: "github:5", error: REFUSED }]);
});

test("what's marked done stays done after the app reopens, until GitHub has something new on it", async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  let seven = thread("7", { unread: false, at: yesterday });
  // GitHub's list (all=true) still has a thread marked done, as read.
  answer = (req) => (req.path === "graphql" ? { json: { data: {} } } : isList(req) ? { json: [thread("5", { at: yesterday }), seven] } : { status: 204 });
  const items = await readGithubActivity();
  assert.deepEqual(await writeGithubActivity("done", [items.find((i) => i.id === "7")!]), []);
  assert.deepEqual(JSON.parse(readFileSync(githubActivityFile(), "utf8")), { done: { "7": { at: yesterday, doneAt: iso() } } });

  // Reopened: nothing kept in memory, the file read again.
  resetGithubActivity({ relaunch: true });
  assert.deepEqual((await readGithubActivity()).map((i) => i.id), ["5"]);

  // New activity on it, once GitHub's list has settled: back, as in GitHub's inbox.
  later(ACTIVITY_MARKS.settleMs);
  seven = thread("7", { at: iso() });
  assert.deepEqual((await readGithubActivity(true)).map((i) => i.id).sort(), ["5", "7"]);

  // A test's own reset leaves no file behind.
  resetGithubActivity();
  assert.equal(existsSync(githubActivityFile()), false);
});

test("the file of an earlier launch, GitHub's times only, still leaves them out", async () => {
  const yesterday = new Date(clock - 86_400_000).toISOString();
  answer = (req) => (req.path === "graphql" ? { json: { data: {} } } : { json: [thread("7", { unread: false, at: yesterday })] });
  writeFileSync(githubActivityFile(), JSON.stringify({ done: { "7": yesterday } }));
  resetGithubActivity({ relaunch: true });
  assert.deepEqual(await readGithubActivity(), []);
});

test("a done thread stays gone while GitHub lags, and when GitHub moves it without anything new for you", async () => {
  const marked = iso(-60_000);
  // GitHub's list, which still has the thread as it was until `settled`.
  let settled = false;
  let eight = () => thread("8", { at: marked });
  answer = (req) =>
    req.path === "graphql"
      ? { json: { data: {} } }
      : isList(req)
        ? { json: [thread("5", { at: marked }), settled ? eight() : thread("8", { at: marked })] }
        : { status: 204 };
  const items = await readGithubActivity();
  assert.deepEqual(await writeGithubActivity("done", [items.find((i) => i.id === "8")!]), []);
  const lists = calls().filter(isList).length;
  // The write forgot the cached list: GitHub is asked again, lagging, and it stays gone.
  assert.deepEqual((await readGithubActivity()).map((i) => i.id), ["5"]);
  assert.equal(calls().filter(isList).length, lists + 1);
  // Lagging, re-stamped and still unread a few seconds on: gone.
  later(5_000);
  eight = () => thread("8", { at: iso() });
  settled = true;
  assert.deepEqual((await readGithubActivity(true)).map((i) => i.id), ["5"]);
  // Settled: GitHub moves it for a push or a check (read, a newer time): still gone.
  later(ACTIVITY_MARKS.settleMs);
  eight = () => thread("8", { unread: false, at: iso(), lastRead: marked });
  assert.deepEqual((await readGithubActivity(true)).map((i) => i.id), ["5"]);
  // Unread, but not after when you last read it: still gone.
  eight = () => thread("8", { at: iso(), lastRead: iso(60_000) });
  assert.deepEqual((await readGithubActivity(true)).map((i) => i.id), ["5"]);
  // Something new for you, later than when it was marked done: back, and stays as GitHub has it once read.
  eight = () => thread("8", { at: iso(1_000), lastRead: marked });
  assert.deepEqual((await readGithubActivity(true)).map((i) => i.id).sort(), ["5", "8"]);
  eight = () => thread("8", { unread: false, at: iso(1_000), lastRead: iso(2_000) });
  assert.deepEqual((await readGithubActivity(true)).map((i) => i.id).sort(), ["5", "8"]);
  assert.deepEqual(JSON.parse(readFileSync(githubActivityFile(), "utf8")), { done: {} });
});

test("a read that began before the write doesn't put the thread back", async () => {
  let release: () => void = () => {};
  let hold = false;
  answer = async (req) => {
    if (req.path === "graphql") return { json: { data: {} } };
    if (!isList(req)) return { status: 204 };
    if (hold) await new Promise<void>((r) => (release = r));
    return { json: [thread("5"), thread("6")] };
  };
  const [, six] = await readGithubActivity();
  hold = true;
  const early = readGithubActivity(true);
  hold = false;
  assert.deepEqual(await writeGithubActivity("done", [six!]), []);
  release();
  assert.deepEqual((await early).map((i) => i.id), ["5"]);
  assert.deepEqual((await readGithubActivity()).map((i) => i.id), ["5"]);
});

test("read shows as read while GitHub's list still has it unread", async () => {
  answer = (req) => (req.path === "graphql" ? { json: { data: {} } } : isList(req) ? { json: [thread("5")] } : { status: 205 });
  const [five] = await readGithubActivity();
  assert.deepEqual(await writeGithubActivity("read", [five!]), []);
  assert.equal((await readGithubActivity(true))[0]!.unread, false);
  // Settled, GitHub still says unread: GitHub's word.
  later(ACTIVITY_MARKS.settleMs);
  assert.equal((await readGithubActivity(true))[0]!.unread, true);
});

test("a refused done leaves the thread in Activity, saying why", async () => {
  answer = (req) =>
    req.path === "graphql"
      ? { json: { data: {} } }
      : isList(req)
        ? { json: [thread("5"), thread("6")] }
        : req.method === "DELETE"
          ? { status: 404, json: { message: "Not Found" } }
          : { status: 205 };
  const [, six] = await readGithubActivity();
  const failed = await writeGithubActivity("done", [six!]);
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.key, "github:6");
  assert.ok(failed[0]!.error);
  assert.deepEqual((await readGithubActivity()).map((i) => i.id), ["5", "6"]);
  assert.equal(existsSync(githubActivityFile()), false, "nothing saved");
});
