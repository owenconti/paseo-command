import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { LINEAR } from "../links";
import { saveSecret } from "../secrets";
import { writeSettings } from "../settings";
import { DISABLED, NO_KEY, resetLinearClient } from "./client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "./fake";
import { linearImage } from "./image";
import { resetLinearReads } from "./reads";
import { linearRoute } from "./route";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
});
afterEach(() => fake.restore());

async function ask(path: string, method = "GET") {
  let answer: { status: number; body: any } | undefined;
  await linearRoute(
    { method } as IncomingMessage,
    new URL(path, "http://localhost"),
    {} as ServerResponse,
    (status, body) => (answer = { status, body }),
  );
  return answer!;
}

test("answers named reads and refuses others", async () => {
  const workspace = await ask("/api/linear/q/workspace");
  assert.equal(workspace.status, 200);
  assert.equal(workspace.body.viewerId, I.owen);
  assert.equal((await ask("/api/linear/q/nope")).status, 404);
  const cycles = await ask(`/api/linear/q/cycles?team=${I.eng}`);
  assert.deepEqual(cycles.body.cycles.map((c: { number: number }) => c.number), [7, 6]);
  assert.equal((await ask(`/api/linear/q/cycles?team=${I.eng}&x=1`)).status, 400);
  assert.equal((await ask(`/api/linear/q/cycles?team=nope`)).status, 400);
  assert.equal((await ask(`/api/linear/q/issues?scope=cycle:${I.cycles.eng}`)).body.issues.length, 2);
  assert.equal((await ask("/api/linear/q/views")).body.views.length, 2);
  assert.equal((await ask("/api/linear/q/notifications")).body.notifications.length, 5);
  assert.equal((await ask("/api/linear/q/notifications?first=5")).status, 400);
  assert.equal((await ask("/api/linear/q/notifications?after=%0A")).status, 400);
  assert.equal((await ask("/api/linear/q/notifications?after=2")).body.notifications.length, 3);
  assert.deepEqual((await ask("/api/linear/q/search?term=sync%20design")).body.issues.map((i: { key: string }) => i.key), ["ENG-3"]);
  assert.equal((await ask("/api/linear/q/search?term=")).status, 400);
  assert.equal((await ask(`/api/linear/q/issues?scope=search:sync`)).status, 400);
  assert.equal((await ask("/api/linear/q/views?x=1")).status, 400);
  assert.equal((await ask(`/api/linear/q/issues?scope=view:${I.views.samsWork}`)).body.issues.length, 3);
  assert.equal((await ask("/api/linear/q/issues?scope=bad")).status, 400);
  assert.equal((await ask("/api/linear/q/issues")).status, 400);
  assert.equal((await ask("/api/linear/q/workspace?x=1")).body.error, "Unexpected parameters");
  assert.equal((await ask("/api/linear/q/issues?scope=assigned&after=%0A")).status, 400);

  const issues = await ask("/api/linear/q/issues?scope=assigned");
  assert.deepEqual(issues.body.issues.map((i: { key: string }) => i.key).sort(), ["ENG-1", "ENG-3"]);
  const issue = await ask("/api/linear/q/issue?key=ENG-1");
  assert.equal(issue.body.comments.length, 3);
  assert.equal((await ask("/api/linear/q/issue?key=ENG-404")).body.issue, null);
  assert.equal((await ask("/api/linear/q/issue?key=%20%20")).status, 400);
  const eng = (key: string) => fake.ws.issues.find((i) => i.identifier === key)!.id;
  const byId = await ask(`/api/linear/q/byId?ids=${eng("ENG-1")},${eng("DE-1")}`);
  assert.deepEqual(byId.body.issues.map((i: { key: string }) => i.key).sort(), ["DE-1", "ENG-1"]);
  assert.equal((await ask("/api/linear/q/byId?ids=nope")).status, 400);
  assert.equal((await ask(`/api/linear/q/byId?ids=${eng("ENG-1")}&x=1`)).status, 400);
  const since = new Date(Date.now() - 86_400_000 * 40).toISOString();
  assert.ok((await ask(`/api/linear/q/sync?since=${encodeURIComponent(since)}`)).body.issues.length > 0);
  assert.deepEqual((await ask("/api/linear/q/status")).body.configured, true);
  assert.equal((await ask("/api/linear/m/issueNope", "POST")).status, 404);
  assert.equal((await ask("/api/linear/q/workspace", "POST")).status, 404);
});

test("answers limited as unavailable with retryAt", async () => {
  fake.fail("Workspace", { status: 429, message: "slow down" });
  const { status, body } = await ask("/api/linear/q/workspace");
  assert.equal(status, 200);
  assert.equal(body.available, false);
  assert.equal(typeof body.retryAt, "number");
  assert.match(body.reason, /limit/);
});

test("answers no key as unavailable, and a failure as 502", async () => {
  fake.fail("Issues", { message: "boom" });
  const failed = await ask("/api/linear/q/issues?scope=assigned");
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "boom");
  saveSecret({ name: "linearApiKey", value: null });
  const none = await ask("/api/linear/q/workspace");
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { available: false, reason: NO_KEY });
  writeSettings({ integrations: { linear: false } });
  const off = await ask("/api/linear/q/workspace");
  assert.deepEqual(off.body, { available: false, reason: DISABLED });
});

test("an uploaded image is fetched with the key; nothing else is", async () => {
  const fetched: { url: string; auth: string }[] = [];
  const reply = (type: string) =>
    (LINEAR.fetch = (async (url: string, init?: RequestInit) => {
      fetched.push({ url, auth: String((init?.headers as Record<string, string>).Authorization) });
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": type } });
    }) as typeof fetch);
  reply("image/png");
  const ok = await linearImage("https://uploads.linear.app/a/b/image.png");
  assert.equal(ok.status, 200);
  assert.equal(ok.type, "image/png");
  assert.deepEqual(fetched, [{ url: "https://uploads.linear.app/a/b/image.png", auth: "lin_api_fake" }]);
  for (const url of ["https://example.com/x.png", "http://uploads.linear.app/x.png", "https://u:p@uploads.linear.app/x.png", "nonsense"])
    assert.equal((await linearImage(url)).status, 400);
  assert.equal(fetched.length, 1);
  reply("text/html");
  assert.equal((await linearImage("https://uploads.linear.app/a/b/page")).status, 415);
  const before = fetched.length;
  saveSecret({ name: "linearApiKey", value: null });
  assert.deepEqual(await linearImage("https://uploads.linear.app/a/b/image.png"), { status: 404, error: NO_KEY });
  writeSettings({ integrations: { linear: false } });
  assert.deepEqual(await linearImage("https://uploads.linear.app/a/b/image.png"), { status: 404, error: DISABLED });
  assert.equal(fetched.length, before);
});
