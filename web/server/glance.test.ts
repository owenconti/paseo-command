import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import type { IncomingMessage } from "node:http";
import { readSettings, writeSettings } from "./settings";
import { installFakeLinear, type FakeLinear } from "./linear/fake";
import { fakePr, installFakeGithub } from "./github/fake";
import { SCOPE_QUERY } from "./github/reads";
import { resetGithubTab } from "./github/client";
import { resetLinearClient } from "./linear/client";
import { resetLinearReads } from "./linear/reads";
import { glanceRoute, HEALTH, readGlance, readHealth, resetGlance } from "./glance";

const realFetch = HEALTH.fetch;
let asked = 0;
let answer: () => Response | Promise<Response>;
let linear: FakeLinear | undefined;
const integrations = (on: Record<string, boolean>) =>
  writeSettings({ integrations: { ...((readSettings()?.integrations as object) ?? {}), ...on } });

beforeEach(() => {
  resetGlance();
  resetLinearClient();
  resetLinearReads();
  asked = 0;
  answer = () => new Response(JSON.stringify({ iterations: 100, pgsql: 0.47, "redis-cache": 1.2, mongodb: 4 }), { status: 200 });
  HEALTH.fetch = (async (url: unknown) => {
    assert.equal(String(url), "https://app.go-diagonal.com/health/status");
    asked += 1;
    return answer();
  }) as typeof fetch;
});
afterEach(() => {
  HEALTH.fetch = realFetch;
  linear?.restore();
  linear = undefined;
  integrations({ linear: false, github: false, health: false });
});

test("nothing is asked while every integration is off", async () => {
  integrations({ linear: false, github: false, health: false });
  assert.deepEqual(await readGlance(), {});
  assert.equal(asked, 0);
});

test("Diagonal's health: its services, kept a while, checked again when fresh", async () => {
  integrations({ health: true });
  const g = await readGlance();
  assert.equal(g.health?.up, true);
  assert.deepEqual(g.health?.services, [
    { name: "pgsql", ms: 0.47 },
    { name: "redis-cache", ms: 1.2 },
    { name: "mongodb", ms: 4 },
  ]);
  await readGlance();
  assert.equal(asked, 1, "kept");
  await readGlance(true);
  assert.equal(asked, 2, "fresh checks now");
});

test("Diagonal down: an error status, a bad answer or no answer each say why", async () => {
  answer = () => new Response("oops", { status: 503 });
  let h = await readHealth(true);
  assert.equal(h.up, false);
  assert.match(h.error ?? "", /503/);
  answer = () => new Response("<html>", { status: 200 });
  h = await readHealth(true);
  assert.equal(h.up, false);
  assert.match(h.error ?? "", /expected JSON/);
  answer = () => Promise.reject(new TypeError("fetch failed"));
  h = await readHealth(true);
  assert.equal(h.up, false);
  assert.match(h.error ?? "", /couldn't be reached/);
});

test("your Linear issues by state, while Linear is on", async () => {
  linear = installFakeLinear();
  const g = await readGlance();
  assert.ok(g.linear && "groups" in g.linear);
  assert.deepEqual(
    g.linear.groups.map((x) => [x.state, x.type, x.total]),
    [["In Progress", "started", 8], ["Blocked", "started", 1], ["Todo", "unstarted", 8]],
  );
  assert.equal(g.health, undefined);
  assert.equal(g.github, undefined);
  assert.equal(linear.requests.filter((r) => r.operation === "MyIssues").length, 1);
  await readGlance();
  assert.equal(linear.requests.filter((r) => r.operation === "MyIssues").length, 1, "kept");
});

test("Linear failing says why without hiding Diagonal's health", async () => {
  linear = installFakeLinear();
  integrations({ health: true });
  linear.fail("MyIssues", { message: "boom" });
  const g = await readGlance();
  assert.deepEqual(g.linear, { error: "boom" });
  assert.equal(g.health?.up, true);
});

test("pull requests asking your review and assigned to you, with GitHub's counts", async () => {
  resetGithubTab();
  const gh = installFakeGithub();
  try {
    gh.search[SCOPE_QUERY.review] = [fakePr({ number: 7 }), fakePr({ number: 8, repo: "owen/lib" })];
    gh.search[SCOPE_QUERY.assigned] = [fakePr({ number: 9 })];
    const g = await readGlance(true);
    assert.ok(g.github && "review" in g.github);
    assert.equal(g.github.review.total, 2);
    assert.deepEqual(g.github.review.rows.map((r) => `${r.repo}#${r.number}`).sort(), ["owen/app#7", "owen/lib#8"]);
    assert.deepEqual(g.github.assigned.rows.map((r) => r.number), [9]);
    assert.equal(g.linear, undefined);
  } finally {
    gh.restore();
  }
  const off = installFakeGithub({ token: null });
  try {
    const g = await readGlance(true);
    assert.ok(g.github && "error" in g.github, "no token says why");
  } finally {
    off.restore();
  }
});

test("the route takes only fresh=1", async () => {
  const call = async (path: string, method = "GET") => {
    let got: { status: number; body: unknown } | undefined;
    await glanceRoute({ method } as IncomingMessage, new URL(path, "http://localhost"), (status, body) => (got = { status, body }));
    return got!;
  };
  assert.equal((await call("/api/glance")).status, 200);
  assert.equal((await call("/api/glance?fresh=1")).status, 200);
  assert.equal((await call("/api/glance?fresh=2")).status, 400);
  assert.equal((await call("/api/glance?x=1")).status, 400);
  assert.equal((await call("/api/glance", "POST")).status, 405);
});
