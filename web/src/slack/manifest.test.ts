import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createAppUrl, METHOD_SCOPES, slackManifest, USER_EVENTS, USER_SCOPES } from "./manifest";

const SERVER = join(import.meta.dirname, "../../server/slack");
/** The server's own code: what it calls of Slack (not its tests or its fake). */
const sources = readdirSync(SERVER)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "fake.ts")
  .map((f) => readFileSync(join(SERVER, f), "utf8"))
  .join("\n");

test("slack manifest: every Web API method the server calls has its scopes asked for", () => {
  const methods = new Set(
    [...sources.matchAll(/"((?:auth|users|conversations|chat|reactions|files|search|emoji|apps|team|stars|pins|bookmarks|usergroups|dnd)\.[a-zA-Z]+(?:\.[a-zA-Z]+)?)"/g)]
      .map((m) => m[1])
      .filter((m) => !m.endsWith(".com")),
  );
  assert.ok(methods.size > 10, "found the methods");
  for (const method of methods) {
    assert.ok(Object.hasOwn(METHOD_SCOPES, method), `${method} is in METHOD_SCOPES`);
    for (const scope of METHOD_SCOPES[method]) assert.ok(USER_SCOPES.includes(scope), `${scope} for ${method}`);
  }
  assert.ok(USER_SCOPES.includes("files:read"), "files download");
  // Opening a DM, and marking any conversation read, are writes.
  for (const scope of ["im:write", "mpim:write", "channels:write", "groups:write"]) assert.ok(USER_SCOPES.includes(scope), scope);
});

test("slack manifest: every event the socket handles is subscribed, as the user, over Socket Mode", () => {
  const handled = new Set([...sources.matchAll(/"([a-z]+_(?:added|removed|marked|rename|change|joined_channel))"/g)].map((m) => m[1]));
  for (const event of handled) assert.ok(USER_EVENTS.includes(event), `${event} is subscribed`);
  for (const kind of ["channels", "groups", "im", "mpim"]) assert.ok(USER_EVENTS.includes(`message.${kind}`));
  const manifest = slackManifest();
  assert.equal(manifest.settings.socket_mode_enabled, true);
  assert.deepEqual(manifest.settings.event_subscriptions.user_events, USER_EVENTS);
  assert.ok(!("bot" in manifest.oauth_config.scopes), "no bot: everything goes as the user");
});

test("slack manifest: the Create app link carries the manifest", () => {
  const url = new URL(createAppUrl("Mine"));
  assert.equal(url.origin + url.pathname, "https://api.slack.com/apps");
  assert.equal(url.searchParams.get("new_app"), "1");
  assert.deepEqual(JSON.parse(url.searchParams.get("manifest_json")!), slackManifest("Mine"));
});
