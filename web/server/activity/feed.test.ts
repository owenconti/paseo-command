/**
 * The Activity feed and its route over fake sources: nothing here reaches
 * GitHub, Linear or Slack.
 */
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, test } from "node:test";
import type { ActivityItem, ActivitySource, ActivityWriteName } from "../../src/activity/types";
import { readSettings, writeSettings } from "../settings";
import { activityFeed, activityWrite, resetActivityFeed, SOURCES, type ActivitySourceDef } from "./feed";
import { checkKeys, activityRoute } from "./route";

const real = { ...SOURCES };
let reads: ActivitySource[] = [];
let writes: { source: ActivitySource; name: ActivityWriteName; keys: string[] }[] = [];
let had: Record<string, unknown> | null;

const item = (source: ActivitySource, id: string, at: string, unread = true): ActivityItem => ({
  key: `${source}:${id}`,
  source,
  id,
  kind: "mention",
  title: id,
  subject: "issue",
  at,
  unread,
});

function fakeSource(source: ActivitySource, items: ActivityItem[] | Error, fail?: string): ActivitySourceDef {
  return {
    async read() {
      reads.push(source);
      if (items instanceof Error) throw items;
      return items;
    },
    async write(name, list) {
      writes.push({ source, name, keys: list.map((i) => i.key) });
      if (fail) throw Object.assign(new Error(fail), { kind: "refused" });
    },
  };
}
const enable = (on: Partial<Record<ActivitySource, boolean>>) =>
  writeSettings({ integrations: { github: false, linear: false, slack: false, ...on } });

beforeEach(() => {
  had = readSettings();
  reads = [];
  writes = [];
  resetActivityFeed();
  SOURCES.github = fakeSource("github", [item("github", "1", "2026-10-30T10:00:00Z"), item("github", "2", "2026-10-28T10:00:00Z", false)]);
  SOURCES.linear = fakeSource("linear", [item("linear", "issue:abcdef12", "2026-10-29T10:00:00Z")]);
  SOURCES.slack = fakeSource("slack", Object.assign(new Error("Slack refused the token."), { kind: "refused" }));
});
afterEach(() => {
  Object.assign(SOURCES, real);
  writeSettings({ integrations: (had?.integrations as object) ?? {} });
});

test("nothing is asked while every source is off", async () => {
  enable({});
  const feed = await activityFeed();
  assert.deepEqual(reads, []);
  assert.deepEqual(feed.items, []);
  assert.deepEqual(
    feed.sources.map((s) => [s.source, s.enabled]),
    [["github", false], ["linear", false], ["slack", false]],
  );
});

test("gathers enabled sources newest first; one failing never hides the others", async () => {
  enable({ github: true, linear: true, slack: true });
  const feed = await activityFeed();
  assert.deepEqual(feed.items.map((i) => i.key), ["github:1", "linear:issue:abcdef12", "github:2"]);
  assert.deepEqual(feed.sources, [
    { source: "github", enabled: true, ok: true, unread: 1 },
    { source: "linear", enabled: true, ok: true, unread: 1 },
    { source: "slack", enabled: true, ok: false, reason: "Slack refused the token.", unread: 0 },
  ]);
});

test("only enabled sources are asked", async () => {
  enable({ linear: true });
  await activityFeed();
  assert.deepEqual(reads, ["linear"]);
});

test("writes go to each item's source; failures are listed per key", async () => {
  enable({ github: true, linear: true });
  SOURCES.linear = fakeSource("linear", [item("linear", "issue:abcdef12", "2026-10-29T10:00:00Z")], "Linear refused the API key.");
  await activityFeed();
  const result = await activityWrite("read", ["github:1", "linear:issue:abcdef12", "github:99"]);
  assert.deepEqual(writes, [
    { source: "github", name: "read", keys: ["github:1"] },
    { source: "linear", name: "read", keys: ["linear:issue:abcdef12"] },
  ]);
  assert.deepEqual(result.failed, [
    { key: "github:99", error: "It's no longer in Activity." },
    { key: "linear:issue:abcdef12", error: "Linear refused the API key." },
  ]);
  assert.equal(result.feed.items.length, 3);
});

test("keys are checked", () => {
  assert.deepEqual(checkKeys({ keys: ["github:1", "github:1", "slack:C1:1700000000.0001"] }), [
    "github:1",
    "slack:C1:1700000000.0001",
  ]);
  assert.throws(() => checkKeys({ keys: [] }));
  assert.throws(() => checkKeys({ keys: ["gitlab:1"] }));
  assert.throws(() => checkKeys({ keys: ["github:../x"] }));
  assert.throws(() => checkKeys({ keys: "github:1" }));
  assert.throws(() => checkKeys({ keys: ["github:1"], extra: 1 }));
  assert.throws(() => checkKeys({ keys: Array.from({ length: 201 }, (_, i) => `github:${i}`) }));
});

async function ask(path: string, method = "GET", body?: unknown, type = "application/json") {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), {
    method,
    headers: { "content-type": type },
  }) as unknown as IncomingMessage;
  let answer: { status: number; body: any } | undefined;
  await activityRoute(req, new URL(path, "http://localhost"), (status, b) => (answer = { status, body: b }));
  return answer!;
}

test("the route answers the feed and the writes, and nothing else", async () => {
  enable({ github: true });
  const feed = await ask("/api/activity");
  assert.equal(feed.status, 200);
  assert.equal(feed.body.items.length, 2);
  assert.equal((await ask("/api/activity?fresh=1")).status, 200);
  assert.equal((await ask("/api/activity?fresh=2")).status, 400);
  assert.equal((await ask("/api/activity?x=1")).status, 400);
  assert.equal((await ask("/api/activity", "POST")).status, 405);
  assert.equal((await ask("/api/activity/m/nope", "POST", { keys: ["github:1"] })).status, 404);
  assert.equal((await ask("/api/activity/q/x")).status, 404);
  assert.equal((await ask("/api/activity/m/read")).status, 405);
  assert.equal((await ask("/api/activity/m/read", "POST", { keys: ["github:1"] }, "text/plain")).status, 415);
  assert.equal((await ask("/api/activity/m/read", "POST", { keys: ["nope"] })).status, 400);
  const done = await ask("/api/activity/m/done", "POST", { keys: ["github:1"] });
  assert.equal(done.status, 200);
  assert.deepEqual(writes, [{ source: "github", name: "done", keys: ["github:1"] }]);
});

test("the real sources contact nothing while their integrations are off", async () => {
  Object.assign(SOURCES, real);
  enable({});
  const { GITHUB_ACTIVITY } = await import("./github");
  const { LINEAR } = await import("../links");
  const run = GITHUB_ACTIVITY.run;
  const fetch = LINEAR.fetch;
  let contacted = 0;
  GITHUB_ACTIVITY.run = async () => (contacted++, "[]");
  LINEAR.fetch = (async () => (contacted++, new Response("{}"))) as typeof LINEAR.fetch;
  try {
    const feed = await activityFeed(true);
    assert.equal(contacted, 0);
    assert.ok(feed.sources.every((s) => !s.enabled));
  } finally {
    GITHUB_ACTIVITY.run = run;
    LINEAR.fetch = fetch;
  }
});
