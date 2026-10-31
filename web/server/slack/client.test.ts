import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { rmSync } from "node:fs";
import { saveSecret, secretsFile } from "../secrets";
import { settingsFile, writeSettings } from "../settings";
import { DISABLED, NO_APP_TOKEN, NO_TOKEN, SLACK, SlackError, plainError, resetSlackClient, slackCall, slackCooldown } from "./client";

const realFetch = SLACK.fetch;
let seen: { url: string; body: string; type: string | null; auth: string | null }[] = [];

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  SLACK.fetch = (async (url: unknown, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seen.push({ url: String(url), body: String(init?.body), type: h.get("content-type"), auth: h.get("authorization") });
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
}

beforeEach(() => {
  seen = [];
  resetSlackClient();
  writeSettings({ integrations: { slack: true } });
  saveSecret({ name: "slackUserToken", value: "xoxp-test" });
});
afterEach(() => {
  SLACK.fetch = realFetch;
  rmSync(secretsFile(), { force: true });
  rmSync(settingsFile(), { force: true });
});

const kind = (k: string, message?: string | RegExp) => (e: unknown) =>
  e instanceof SlackError && e.kind === k && (message === undefined || (typeof message === "string" ? e.message === message : message.test(e.message)));

test("sends the method with the user token as a form, or JSON when asked", async () => {
  reply(200, { ok: true, user_id: "U1" });
  const a = await slackCall("auth.test", { limit: 5, types: "im,mpim", skip: undefined, files: [{ id: "F1" }] });
  assert.equal(a.user_id, "U1");
  assert.equal(seen[0].url, "https://slack.com/api/auth.test");
  assert.equal(seen[0].auth, "Bearer xoxp-test");
  assert.equal(seen[0].type, "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen[0].body)), { limit: "5", types: "im,mpim", files: '[{"id":"F1"}]' });
  await slackCall("chat.postMessage", { channel: "C1", markdown_text: "**hi**" }, { json: true });
  assert.equal(seen[1].type, "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(seen[1].body), { channel: "C1", markdown_text: "**hi**" });
});

test("off or without a token, nothing is sent", async () => {
  reply(200, { ok: true });
  saveSecret({ name: "slackUserToken", value: null });
  await assert.rejects(() => slackCall("auth.test"), kind("no-key", NO_TOKEN));
  await assert.rejects(() => slackCall("apps.connections.open", {}, { token: "app" }), kind("no-key", NO_APP_TOKEN));
  saveSecret({ name: "slackUserToken", value: "xoxp-test" });
  writeSettings({ integrations: { slack: false } });
  await assert.rejects(() => slackCall("auth.test"), kind("no-key", DISABLED));
  await assert.rejects(() => slackCall("apps.connections.open", {}, { token: "app" }), kind("no-key", DISABLED));
  assert.equal(seen.length, 0);
});

test("the app token is sent only for app calls", async () => {
  saveSecret({ name: "slackAppToken", value: "xapp-test" });
  reply(200, { ok: true, url: "wss://x" });
  await slackCall("apps.connections.open", {}, { token: "app" });
  assert.equal(seen[0].auth, "Bearer xapp-test");
});

test("maps Slack's refusals", async () => {
  for (const error of ["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive"]) {
    reply(200, { ok: false, error });
    await assert.rejects(() => slackCall("auth.test"), kind("refused", "Slack refused the token."));
  }
  reply(200, { ok: false, error: "missing_scope", needed: "search:read", provided: "chat:write" });
  await assert.rejects(() => slackCall("search.messages"), kind("refused", "Slack refused: the token needs the search:read scope."));
  reply(200, { ok: false, error: "missing_scope", needed: "<script>" });
  await assert.rejects(() => slackCall("search.messages"), kind("refused", "Slack refused: the token is missing a scope."));
});

test("names other errors in plain words, invalid for the request's fault", async () => {
  reply(200, { ok: false, error: "channel_not_found" });
  await assert.rejects(() => slackCall("conversations.info"), (e: unknown) => kind("invalid", "Slack can't find that conversation.")(e) && (e as SlackError).code === "channel_not_found");
  reply(200, { ok: false, error: "internal_error" });
  await assert.rejects(() => slackCall("conversations.info"), kind("failed", "Slack said: internal error."));
  reply(500, { nope: true });
  await assert.rejects(() => slackCall("conversations.info"), kind("failed", "Slack answered 500."));
  SLACK.fetch = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
  await assert.rejects(() => slackCall("conversations.info"), kind("failed", "Slack answered 502."));
  SLACK.fetch = (async () => {
    throw new Error("offline");
  }) as typeof fetch;
  await assert.rejects(() => slackCall("conversations.info"), kind("failed", "Slack could not be reached."));
  assert.equal(plainError("weird_thing<>"), "Slack said: weird thing.");
});

test("a rate limit cools the method down: reads wait, essential calls still try", async () => {
  reply(429, {}, { "retry-after": "30" });
  const before = Date.now();
  await assert.rejects(
    () => slackCall("conversations.history"),
    (e: unknown) => kind("limited")(e) && (e as SlackError).retryAt! >= before + 30_000 && (e as SlackError).retryAt! <= Date.now() + 30_000,
  );
  assert.ok(slackCooldown("conversations.history"));
  assert.equal(slackCooldown("conversations.info"), undefined);
  seen = [];
  reply(200, { ok: true, messages: [] });
  await assert.rejects(() => slackCall("conversations.history"), kind("limited"));
  assert.equal(seen.length, 0);
  await slackCall("conversations.info");
  await slackCall("conversations.history", {}, { essential: true });
  assert.equal(seen.length, 2);
  // ok:false ratelimited without a header: a minute.
  reply(200, { ok: false, error: "ratelimited" });
  await assert.rejects(() => slackCall("users.list"), (e: unknown) => kind("limited")(e) && (e as SlackError).retryAt! > Date.now() + 50_000);
});
