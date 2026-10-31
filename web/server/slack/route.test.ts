import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, beforeEach, test } from "node:test";
import { saveSecret } from "../secrets";
import { writeSettings } from "../settings";
import { DISABLED, NO_TOKEN } from "./client";
import { SLACK_EVENTS, emitSlack, slackListeners } from "./events";
import { FAKE_IDS as I, FAKE_IMAGE, FAKE_PDF, PNG, installFakeSlack, type FakeSlack } from "./fake";
import { slackRoute } from "./route";

let fake: FakeSlack;
beforeEach(() => {
  fake = installFakeSlack(undefined, { appToken: false });
});
afterEach(() => fake.restore());

const T = I.ts;

/** A response that keeps what's written. */
class Res extends EventEmitter {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  body?: Buffer;
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end(chunk?: Buffer) {
    this.body = chunk;
  }
}

async function ask(path: string, opts: { method?: string; body?: unknown; type?: string; raw?: Buffer } = {}) {
  let answer: { status: number; body: any } | undefined;
  const bytes = opts.raw ?? (opts.body !== undefined ? Buffer.from(JSON.stringify(opts.body)) : Buffer.alloc(0));
  const req = Object.assign(Readable.from([bytes]), {
    method: opts.method ?? "GET",
    headers: { "content-type": opts.type ?? (opts.raw ? "application/octet-stream" : "application/json") },
  }) as unknown as IncomingMessage;
  const res = new Res();
  await slackRoute(req, new URL(path, "http://localhost"), res as unknown as ServerResponse, (status, body) => (answer = { status, body }));
  return answer ?? { status: res.statusCode, body: res.body, res };
}

test("answers the named reads, checks their parameters, and refuses others", async () => {
  const ws = await ask("/api/slack/q/workspace");
  assert.equal(ws.status, 200);
  assert.equal(ws.body.selfId, I.owen);
  assert.equal((await ask("/api/slack/q/workspace?fresh=1")).status, 200);
  assert.equal((await ask("/api/slack/q/workspace?fresh=yes")).status, 400);
  assert.equal((await ask("/api/slack/q/workspace?x=1")).body.error, "Unexpected parameters");
  assert.equal((await ask("/api/slack/q/nope")).status, 404);
  assert.equal((await ask("/api/slack/q")).status, 404);
  assert.equal((await ask("/api/slack/../linear/q/workspace")).status, 404);

  const history = await ask(`/api/slack/q/history?conversation=${I.general}`);
  assert.equal(history.body.messages.length, 6);
  assert.equal((await ask(`/api/slack/q/history?conversation=${I.general}&before=${T.image}`)).body.messages.length, 3);
  assert.equal((await ask(`/api/slack/q/history?conversation=general`)).status, 400);
  assert.equal((await ask(`/api/slack/q/history?conversation=${I.general}&before=x`)).status, 400);
  assert.equal((await ask(`/api/slack/q/history?conversation=${I.general}&limit=5`)).status, 400);
  assert.equal((await ask(`/api/slack/q/history`)).status, 400);

  const replies = await ask(`/api/slack/q/replies?conversation=${I.general}&ts=${T.parent}`);
  assert.equal(replies.body.replies.length, 2);
  assert.equal((await ask(`/api/slack/q/replies?conversation=${I.general}`)).status, 400);
  assert.equal((await ask(`/api/slack/q/replies?conversation=${I.general}&ts=${T.parent}&after=1`)).status, 400);

  assert.equal((await ask(`/api/slack/q/conversation?id=${I.dm}`)).body.conversation.name, "Sam");
  assert.equal((await ask(`/api/slack/q/conversation?id=x`)).status, 400);
  assert.equal((await ask(`/api/slack/q/search?term=lunch`)).body.messages.length, 1);
  assert.equal((await ask(`/api/slack/q/search?term=%20`)).status, 400);
  assert.equal((await ask(`/api/slack/q/search?term=a&count=5`)).status, 400);

  const unreads = await ask(`/api/slack/q/unreads`);
  // Known so far: what the reads above saw (latest, a DM's read point), no counts yet.
  assert.equal(unreads.body.pending, 5);
  assert.ok(unreads.body.conversations.every((c: { unread?: number }) => c.unread === undefined));
  assert.equal(unreads.body.conversations.find((c: { id: string }) => c.id === I.dm).lastRead, T.dmOld);
  // A Slack error that's the request's fault: 400 with Slack's words.
  fake.fail("conversations.history", { error: "channel_not_found" });
  assert.deepEqual(await ask(`/api/slack/q/history?conversation=C0NOPE`), { status: 400, body: { error: "Slack can't find that conversation." } });
  fake.fail("conversations.history", { error: "internal_error" });
  assert.equal((await ask(`/api/slack/q/history?conversation=${I.general}`)).status, 502);
});

test("reads Slack can't answer now are a normal answer, with when to try again", async () => {
  fake.fail("search.messages", { error: "ratelimited", status: 429, retryAfter: 20 });
  const limited = await ask("/api/slack/q/search?term=x");
  assert.equal(limited.status, 200);
  assert.equal(limited.body.available, false);
  assert.ok(limited.body.retryAt > Date.now());
  fake.fail("auth.test", { error: "invalid_auth" });
  assert.deepEqual((await ask("/api/slack/q/workspace")).body, { available: false, reason: "Slack refused the token." });
  saveSecret({ name: "slackUserToken", value: null });
  assert.deepEqual((await ask("/api/slack/q/workspace")).body, { available: false, reason: NO_TOKEN });
  writeSettings({ integrations: { slack: false } });
  assert.deepEqual((await ask(`/api/slack/q/history?conversation=${I.general}`)).body, { available: false, reason: DISABLED });
  assert.deepEqual((await ask("/api/slack/events")).body, { available: false, reason: DISABLED });
});

test("writes: JSON only, named, with Slack's refusals as errors", async () => {
  const posted = await ask("/api/slack/m/post", { method: "POST", body: { conversationId: I.general, markdown: "hi" } });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.message.text, "hi");
  assert.equal((await ask("/api/slack/m/nope", { method: "POST", body: {} })).status, 404);
  assert.equal((await ask("/api/slack/m/post?x=1", { method: "POST", body: {} })).status, 400);
  assert.equal((await ask("/api/slack/m/post", { method: "POST", body: {}, type: "text/plain" })).status, 415);
  assert.equal((await ask("/api/slack/m/post", { method: "POST", body: { conversationId: I.general } })).status, 400);
  assert.equal((await ask("/api/slack/m/post", { method: "POST", raw: Buffer.from("{bad"), type: "application/json" })).status, 400);
  assert.equal((await ask("/api/slack/m/post", { method: "POST", raw: Buffer.alloc(1024 * 1024 + 1, 32), type: "application/json" })).status, 413);
  fake.fail("chat.postMessage", { error: "ratelimited", status: 429, retryAfter: 5 });
  const limited = await ask("/api/slack/m/post", { method: "POST", body: { conversationId: I.general, markdown: "hi" } });
  assert.equal(limited.status, 409);
  assert.ok(limited.body.retryAt);
  fake.fail("chat.postMessage", { error: "token_revoked" });
  assert.equal((await ask("/api/slack/m/post", { method: "POST", body: { conversationId: I.general, markdown: "hi" } })).status, 401);
  fake.fail("chat.postMessage", { error: "fatal_error" });
  assert.equal((await ask("/api/slack/m/post", { method: "POST", body: { conversationId: I.general, markdown: "hi" } })).status, 502);
  saveSecret({ name: "slackUserToken", value: null });
  assert.equal((await ask("/api/slack/m/mark", { method: "POST", body: { conversationId: I.general, ts: T.bot } })).status, 503);
  assert.equal((await ask("/api/slack/m/post", { method: "PUT", body: {} })).status, 404);
});

test("upload: raw bytes to Slack, answering the file's id", async () => {
  const up = await ask("/api/slack/upload?name=a.txt&type=text/plain", { method: "POST", raw: Buffer.from("hello") });
  assert.equal(up.status, 200);
  assert.equal(up.body.name, "a.txt");
  assert.match(up.body.id, /^F/);
  assert.equal((await ask("/api/slack/upload?name=a&x=1", { method: "POST", raw: Buffer.from("x") })).status, 400);
  assert.equal((await ask("/api/slack/upload?name=a", { method: "POST", raw: Buffer.from("x"), type: "text/plain" })).status, 415);
  assert.equal((await ask("/api/slack/upload?name=a", { method: "POST", raw: Buffer.alloc(0) })).status, 400);
});

test("files, images, avatars and emoji are served safely", async () => {
  const image = (await ask(`/api/slack/image?url=${encodeURIComponent(FAKE_IMAGE)}`)) as { status: number; body: Buffer; res: Res };
  assert.equal(image.status, 200);
  assert.deepEqual(image.body, PNG);
  assert.equal(image.res.headers["content-type"], "image/png");
  assert.equal(image.res.headers["cache-control"], "private, max-age=86400");
  const file = (await ask(`/api/slack/file?url=${encodeURIComponent(FAKE_PDF)}`)) as { status: number; res: Res };
  assert.equal(file.res.headers["content-type"], "application/octet-stream");
  assert.equal(file.res.headers["x-content-type-options"], "nosniff");
  assert.equal(file.res.headers["content-disposition"], "attachment; filename*=UTF-8''plan.pdf");
  assert.equal((await ask(`/api/slack/image?url=${encodeURIComponent("https://example.com/x.png")}`)).status, 400);
  assert.equal((await ask(`/api/slack/image?url=x&y=1`)).status, 400);
  const avatar = (await ask(`/api/slack/avatar?user=${I.sam}`)) as { status: number; res: Res };
  assert.equal(avatar.status, 200);
  assert.equal(avatar.res.headers["cache-control"], "private, max-age=3600");
  assert.equal((await ask(`/api/slack/avatar?url=${encodeURIComponent("https://avatars.slack-edge.com/x.png")}`)).status, 400);
  assert.equal((await ask(`/api/slack/emoji?name=parrot`)).status, 200);
  assert.equal((await ask(`/api/slack/emoji?name=evil`)).status, 404);
});

test("events: live first, every event, pings, and the listener goes on close", async () => {
  const ping = SLACK_EVENTS.pingMs;
  SLACK_EVENTS.pingMs = 20;
  try {
    const req = Object.assign(new EventEmitter(), { method: "GET", headers: {} }) as unknown as IncomingMessage;
    const res = new Res();
    await slackRoute(req, new URL("http://localhost/api/slack/events"), res as unknown as ServerResponse, () => assert.fail("no JSON answer"));
    assert.equal(res.headers["content-type"], "text/event-stream");
    assert.equal(slackListeners(), 1);
    const data = () => res.chunks.filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6)));
    assert.equal(data()[0].type, "live");
    assert.equal(data()[0].live.mode, "polling");
    emitSlack({ type: "marked", conversationId: I.dm, lastRead: T.dm2 });
    assert.deepEqual(data()[1], { type: "marked", conversationId: I.dm, lastRead: T.dm2 });
    assert.ok(res.chunks.at(-1)!.endsWith("\n\n"));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(res.chunks.includes(": ping\n\n"));
    req.emit("close");
    assert.equal(slackListeners(), 0);
    const count = res.chunks.length;
    emitSlack({ type: "resync" });
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(res.chunks.length, count);
    assert.equal((await ask("/api/slack/events?x=1")).status, 400);
  } finally {
    SLACK_EVENTS.pingMs = ping;
  }
});
