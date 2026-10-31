import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { setActivityTransport } from "./api";
import { dayGroup, filterItems, groupByDay, whatHappened } from "./rows";
import {
  activityStore,
  applyWrites,
  loadActivity,
  pollDue,
  resetActivityStore,
  setActivityIntegrations,
  setActivityNotice,
  unreadOf,
  writeItems,
} from "./store";
import type { ActivityFeed, ActivityItem, ActivitySource } from "./types";

const item = (source: ActivitySource, id: string, unread = true, at = "2026-10-30T10:00:00Z"): ActivityItem => ({
  key: `${source}:${id}`,
  source,
  id,
  kind: "mention",
  title: `T${id}`,
  subject: "issue",
  at,
  unread,
});
const feedOf = (items: ActivityItem[]): ActivityFeed => ({
  items,
  sources: (["github", "linear", "slack"] as const).map((source) => ({
    source,
    enabled: true,
    ok: true,
    unread: items.filter((i) => i.source === source && i.unread).length,
  })),
  at: "2026-10-30T10:00:00Z",
});

let server: ActivityItem[];
let requests: { path: string; body?: unknown }[];
let writeAnswer: (keys: string[]) => Promise<unknown>;
let notices: string[];
const on = { github: true, linear: true, slack: true };

beforeEach(() => {
  resetActivityStore();
  server = [item("github", "1"), item("linear", "issue:abcdef12"), item("slack", "C1:1", false)];
  requests = [];
  notices = [];
  writeAnswer = async () => ({ feed: feedOf(server) });
  setActivityTransport(async (path, body) => {
    requests.push({ path, body });
    if (path.startsWith("activity/m/")) return writeAnswer((body as { keys: string[] }).keys);
    return feedOf(server);
  });
  setActivityNotice((m) => notices.push(m));
});
afterEach(() => setActivityTransport(null));

test("asks nothing while every source is off", async () => {
  setActivityIntegrations({ github: false, linear: false, slack: false });
  await loadActivity();
  assert.equal(requests.length, 0);
  assert.equal(unreadOf(activityStore.getState()), undefined);
});

test("an integration switched on asks at once, fresh", async () => {
  setActivityIntegrations(on);
  await loadActivity();
  assert.equal(requests[0]!.path, "activity?fresh=1");
  assert.equal(unreadOf(activityStore.getState()), 2);
});

test("writes show at once and stay once the server agrees", async () => {
  setActivityIntegrations(on);
  await loadActivity();
  let release!: () => void;
  writeAnswer = (keys) =>
    new Promise((done) => {
      release = () => {
        server = server.map((i) => (keys.includes(i.key) ? { ...i, unread: false } : i));
        done({ feed: feedOf(server) });
      };
    });
  const writing = writeItems("read", ["github:1"]);
  assert.equal(activityStore.getState().feed!.items[0]!.unread, false);
  assert.equal(activityStore.getState().feed!.sources[0]!.unread, 0);
  release();
  assert.equal(await writing, true);
  assert.deepEqual(requests.at(-1), { path: "activity/m/read", body: { keys: ["github:1"] } });
  assert.equal(activityStore.getState().feed!.items[0]!.unread, false);
});

test("a refused write is put back with a notice", async () => {
  setActivityIntegrations(on);
  await loadActivity();
  writeAnswer = async (keys) => ({ feed: feedOf(server), failed: keys.map((key) => ({ key, error: "Linear refused the API key." })) });
  assert.equal(await writeItems("done", ["linear:issue:abcdef12"]), false);
  assert.ok(activityStore.getState().feed!.items.some((i) => i.key === "linear:issue:abcdef12"));
  assert.match(notices[0]!, /Couldn’t mark as done “Tissue:abcdef12”: Linear refused the API key\./);
  writeAnswer = async () => {
    throw new Error("offline");
  };
  assert.equal(await writeItems("read", ["github:1"]), false);
  assert.equal(activityStore.getState().feed!.items[0]!.unread, true);
  assert.match(notices[1]!, /in GitHub: offline/);
});

test("GitHub items aren't marked unread; those already so aren't asked", async () => {
  server = [item("github", "1", false), item("slack", "C1:1", false)];
  setActivityIntegrations(on);
  await loadActivity();
  assert.equal(await writeItems("unread", ["github:1"]), true);
  assert.equal(requests.length, 1);
  await writeItems("unread", ["github:1", "slack:C1:1"]);
  assert.deepEqual(requests.at(-1)!.body, { keys: ["slack:C1:1"] });
});

test("a poll answered after a write settled doesn't undo it", async () => {
  setActivityIntegrations(on);
  await loadActivity();
  let answerPoll!: () => void;
  setActivityTransport(async (path) => {
    if (path.startsWith("activity/m/")) return { feed: feedOf(server.map((i) => ({ ...i, unread: false }))) };
    return new Promise((done) => (answerPoll = () => done(feedOf(server))));
  });
  const poll = loadActivity(true);
  await writeItems("read", ["github:1", "linear:issue:abcdef12"]);
  answerPoll();
  await poll;
  assert.equal(unreadOf(activityStore.getState()), 0);
});

test("polls every 30 s while shown and visible, else a minute", () => {
  assert.equal(pollDue(30_000, true, false, 0), true);
  assert.equal(pollDue(30_000, true, true, 0), false);
  assert.equal(pollDue(30_000, false, false, 0), false);
  assert.equal(pollDue(60_000, false, false, 0), true);
});

test("applies done and read over the server's feed", () => {
  const feed = feedOf([item("github", "1"), item("slack", "C1:1")]);
  const out = applyWrites(feed, [
    { name: "done", keys: new Set(["github:1"]) },
    { name: "read", keys: new Set(["slack:C1:1"]) },
  ]);
  assert.deepEqual(out.items.map((i) => [i.key, i.unread]), [["slack:C1:1", false]]);
  assert.equal(applyWrites(feed, []), feed);
});

test("rows: filters, day groups and words", () => {
  const now = new Date(2026, 9, 31, 12);
  const at = (d: number, h = 10) => new Date(2026, 9, d, h).toISOString();
  assert.equal(dayGroup(at(31), now), "Today");
  assert.equal(dayGroup(at(30, 23), now), "Yesterday");
  assert.equal(dayGroup(at(26), now), "This week");
  assert.equal(dayGroup(at(20), now), "Older");
  const items = [item("github", "1", true, at(31)), item("linear", "issue:x1234567", false, at(31, 9)), item("slack", "C:1", true, at(20))];
  assert.deepEqual(groupByDay(items, now).map((g) => [g.group, g.items.length]), [["Today", 2], ["Older", 1]]);
  assert.deepEqual(filterItems(items, "unread").map((i) => i.source), ["github", "slack"]);
  assert.deepEqual(filterItems(items, "linear").map((i) => i.source), ["linear"]);
  assert.equal(whatHappened({ source: "github", kind: "review_requested" }), "Review requested");
  assert.equal(whatHappened({ source: "linear", kind: "issueSomethingNew" }), "Issue something new");
  assert.equal(whatHappened({ source: "slack", kind: "dm" }), "Direct message");
});
