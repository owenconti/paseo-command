import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, test } from "node:test";
import { LINEAR } from "../links";
import { saveSecret } from "../secrets";
import { resetLinearClient } from "./client";
import { linearAvatar, resetAvatars } from "./avatar";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "./fake";
import { resetLinearReads } from "./reads";
import { linearRoute } from "./route";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
  resetAvatars();
});
afterEach(() => fake.restore());

async function ask(path: string, method = "GET") {
  let answer: { status: number; body: any } | undefined;
  const headers: Record<string, string> = {};
  let sent: Buffer | undefined;
  const res = {
    statusCode: 0,
    setHeader: (name: string, value: string) => void (headers[name.toLowerCase()] = value),
    end: (bytes: Buffer) => void (sent = bytes),
  } as unknown as ServerResponse;
  await linearRoute({ method } as IncomingMessage, new URL(path, "http://localhost"), res, (status, body) => (answer = { status, body }));
  return answer ?? { status: res.statusCode, body: sent, headers };
}

test("serves a member's avatar by their id, and nothing else", async () => {
  const sam = await ask(`/api/linear/avatar?user=${I.sam}`);
  assert.equal(sam.status, 200);
  assert.equal((sam as { headers: Record<string, string> }).headers["content-type"], "image/png");
  assert.equal((await ask(`/api/linear/avatar?user=${I.owen}`)).status, 404, "no avatar");
  assert.equal((await ask("/api/linear/avatar?user=nobody")).status, 404);
  assert.equal((await ask("/api/linear/avatar?url=https://avatars.fake.example/sam.png")).status, 400, "never an address the page names");
  assert.equal((await ask(`/api/linear/avatar?user=${I.sam}&x=1`)).status, 400);
  assert.equal((await ask(`/api/linear/avatar?user=${I.sam}`, "POST")).status, 404);
  // The Linear tab's reads, writes and file routes are gone.
  for (const path of ["/api/linear/q/workspace", "/api/linear/q/notifications", "/api/linear/image?url=x", "/api/linear/file?url=x"])
    assert.equal((await ask(path)).status, 404, path);
  assert.equal((await ask("/api/linear/m/notificationArchiveAll", "POST")).status, 404);
  assert.equal((await ask("/api/linear/upload", "POST")).status, 404);
  saveSecret({ name: "linearApiKey", value: null });
  resetLinearReads();
  assert.equal((await ask(`/api/linear/avatar?user=${I.sam}`)).status, 404, "without Linear, no one's");
});

test("Linear's own uploads load with the key; other hosts without it", async () => {
  const fetched: { url: string; auth?: string }[] = [];
  LINEAR.fetch = (async (url: string, init?: RequestInit) => {
    fetched.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  assert.equal((await linearAvatar("https://uploads.linear.app/a/b/me.png")).status, 200);
  assert.equal((await linearAvatar("https://example.com/me.png")).status, 200);
  assert.deepEqual(fetched, [
    { url: "https://uploads.linear.app/a/b/me.png", auth: "lin_api_fake" },
    { url: "https://example.com/me.png", auth: undefined },
  ]);
  // Kept an hour.
  await linearAvatar("https://example.com/me.png");
  assert.equal(fetched.length, 2);
  assert.equal((await linearAvatar(undefined)).status, 404);
});

test("gives the workspace's address and team keys, only while Linear answers", async () => {
  assert.deepEqual((await ask("/api/linear/teams")).body, { urlKey: "fake", teams: ["DE", "ENG"] });
  assert.equal((await ask("/api/linear/teams?x=1")).status, 400);
  assert.equal((await ask("/api/linear/teams", "POST")).status, 404);
  saveSecret({ name: "linearApiKey", value: null });
  resetLinearReads();
  assert.deepEqual((await ask("/api/linear/teams")).body, { urlKey: "", teams: [] }, "without a key, none");
});
