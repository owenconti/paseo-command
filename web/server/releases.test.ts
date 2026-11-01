/** Release notes from GitHub, fetch stubbed: no test reaches the network. */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { releasesView, resetReleases, RELEASES_URL } from "./releases";

const real = globalThis.fetch;
let calls: string[] = [];
function stub(answer: () => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return answer();
  }) as typeof fetch;
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  published_at: "2026-10-30T12:00:00Z",
  body: `Notes for ${tag}`,
  html_url: `https://github.com/owenconti/paseo-command/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
});

beforeEach(() => {
  resetReleases();
  process.env.PASEO_COMMAND_VERSION = "0.2.0";
});
afterEach(() => {
  globalThis.fetch = real;
  delete process.env.PASEO_COMMAND_VERSION;
});

test("maps GitHub's releases, leaving out drafts and prereleases", async () => {
  stub(() => json([release("v0.3.0"), release("v0.3.1-rc1", { prerelease: true }), release("v0.2.5", { draft: true }), release("v0.2.0")]));
  const view = await releasesView();
  assert.equal(calls[0], RELEASES_URL);
  assert.equal(view.installed, "0.2.0");
  assert.equal(view.error, undefined);
  assert.deepEqual(view.releases[0], {
    version: "0.3.0",
    date: "2026-10-30T12:00:00Z",
    notes: "Notes for v0.3.0",
    url: "https://github.com/owenconti/paseo-command/releases/tag/v0.3.0",
  });
  assert.deepEqual(view.releases.map((r) => r.version), ["0.3.0", "0.2.0"]);
});

test("installed is dev without the app's version", async () => {
  delete process.env.PASEO_COMMAND_VERSION;
  stub(() => json([]));
  assert.equal((await releasesView()).installed, "dev");
});

test("a second call within the hour does not fetch", async () => {
  stub(() => json([release("v0.3.0")]));
  let now = 1_000_000;
  await releasesView(() => now);
  now += 59 * 60_000;
  await releasesView(() => now);
  assert.equal(calls.length, 1);
  now += 2 * 60_000;
  await releasesView(() => now);
  assert.equal(calls.length, 2);
});

test("releaseNotesSurviveFetchFailure", async () => {
  stub(() => json([release("v0.3.0")]));
  let now = 0;
  await releasesView(() => now);
  stub(() => Promise.reject(new Error("offline")));
  now += 2 * 3600_000;
  const view = await releasesView(() => now);
  assert.equal(view.error, "Couldn't load release notes");
  assert.deepEqual(view.releases.map((r) => r.version), ["0.3.0"]);
});

test("concurrent calls share one fetch, and a failure backs off for five minutes", async () => {
  stub(() => Promise.reject(new Error("offline")));
  let now = 0;
  const [a, b] = await Promise.all([releasesView(() => now), releasesView(() => now)]);
  assert.equal(calls.length, 1);
  assert.equal(a.error, b.error);
  now += 4 * 60_000;
  assert.equal((await releasesView(() => now)).error, "Couldn't load release notes");
  assert.equal(calls.length, 1);
  now += 2 * 60_000;
  await releasesView(() => now);
  assert.equal(calls.length, 2);
});

test("a failure with nothing cached answers an empty list and the error", async () => {
  stub(() => new Response("nope", { status: 500 }));
  assert.deepEqual(await releasesView(), {
    installed: "0.2.0",
    releases: [],
    error: "Couldn't load release notes",
  });
});
