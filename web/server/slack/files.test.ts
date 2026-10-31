import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { saveSecret } from "../secrets";
import { writeSettings } from "../settings";
import { DISABLED, NO_TOKEN, SLACK, SlackError } from "./client";
import { FAKE_IDS as I, FAKE_IMAGE, FAKE_PDF, FAKE_USER_TOKEN, PNG, installFakeSlack, type FakeSlack } from "./fake";
import { SLACK_FILES, slackAvatar, slackEmoji, slackFile, slackFileAddress, slackImage } from "./files";
import { SLACK_UPLOAD, uploadAddress, uploadName, uploadToSlack, uploadType } from "./upload";

let fake: FakeSlack;
beforeEach(() => {
  fake = installFakeSlack(undefined, { appToken: false });
});
afterEach(() => fake.restore());

test("images load from files.slack.com only, with the token, only as images", async () => {
  const ok = await slackImage(FAKE_IMAGE);
  assert.equal(ok.status, 200);
  assert.equal(ok.type, "image/png");
  assert.deepEqual(ok.bytes, PNG);
  assert.deepEqual(fake.fetched, [{ url: FAKE_IMAGE, token: FAKE_USER_TOKEN }]);
  for (const url of [
    "https://example.com/x.png",
    "http://files.slack.com/files-pri/x.png",
    "https://u:p@files.slack.com/files-pri/x.png",
    "https://files.slack.com.evil.example/x.png",
    "https://evilfiles.slack.com/x.png",
    "nonsense",
  ])
    assert.equal((await slackImage(url)).status, 400, url);
  assert.equal(fake.fetched.length, 1);
  assert.equal((await slackImage(FAKE_PDF)).status, 415);
  assert.equal(slackFileAddress("https://files.slack.com/a")?.hostname, "files.slack.com");
});

test("other files download, any type, at most 100 MB", async () => {
  const pdf = await slackFile(FAKE_PDF);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.name, "plan.pdf");
  assert.equal(SLACK_FILES.maxFileBytes, 100 * 1024 * 1024);
  const real = SLACK.fetch;
  SLACK.fetch = (async () =>
    new Response("x", { status: 200, headers: { "content-type": "application/pdf", "content-length": String(200 * 1024 * 1024) } })) as typeof fetch;
  assert.equal((await slackFile(FAKE_PDF)).status, 413);
  // A redirect off Slack's hosts is refused.
  SLACK.fetch = (async () => {
    const res = new Response("x", { status: 200, headers: { "content-type": "image/png" } });
    Object.defineProperty(res, "url", { value: "https://evil.example/x.png" });
    return res;
  }) as typeof fetch;
  assert.equal((await slackImage(FAKE_IMAGE)).status, 502);
  SLACK.fetch = real;
});

test("without a token or with Slack off, nothing is fetched", async () => {
  saveSecret({ name: "slackUserToken", value: null });
  assert.deepEqual(await slackImage(FAKE_IMAGE), { status: 404, error: NO_TOKEN });
  writeSettings({ integrations: { slack: false } });
  assert.deepEqual(await slackFile(FAKE_PDF), { status: 404, error: DISABLED });
  assert.equal((await slackAvatar(I.sam)).status, 404);
  assert.equal((await slackEmoji("party-parrot")).status, 404);
  assert.equal(fake.fetched.length, 0);
});

test("avatars: only the address Slack gives the person, on Slack's or Gravatar's hosts, without the token, kept an hour", async () => {
  const sam = await slackAvatar(I.sam);
  assert.equal(sam.status, 200);
  assert.equal(sam.type, "image/png");
  assert.equal(fake.fetched.at(-1)!.token, "");
  await slackAvatar(I.sam);
  assert.equal(fake.fetched.filter((f) => f.url.includes("avatars")).length, 1);
  // Ria's address is on another host: refused without fetching.
  const before = fake.fetched.length;
  assert.equal((await slackAvatar(I.ria)).status, 404);
  assert.equal((await slackAvatar(I.owen)).status, 404);
  assert.equal((await slackAvatar("https://x")).status, 400);
  assert.equal(fake.fetched.length, before);
});

test("custom emoji: by name, following aliases, only from Slack's emoji host", async () => {
  assert.equal((await slackEmoji("party-parrot")).type, "image/gif");
  assert.equal((await slackEmoji("parrot")).status, 200);
  assert.equal(fake.fetched.filter((f) => f.url.includes("emoji")).length, 1);
  assert.equal((await slackEmoji("loop")).status, 404);
  assert.equal((await slackEmoji("evil")).status, 404);
  assert.equal((await slackEmoji("nonesuch")).status, 404);
  assert.equal((await slackEmoji("Bad Name")).status, 400);
  assert.ok(!fake.fetched.some((f) => f.url.includes("evil")));
});

test("uploads: Slack's upload address, the bytes without the token, the file's id", async () => {
  const up = await uploadToSlack(Buffer.from("hello"), "../dir/notes\u0000.txt", "TEXT/PLAIN");
  assert.equal(up.name, "notes.txt");
  assert.match(up.id, /^F0UP\d+$/);
  const ask = fake.calls.find((c) => c.method === "files.getUploadURLExternal")!.params;
  assert.deepEqual(ask, { filename: "notes.txt", length: "5" });
  const put = fake.fetched.at(-1)!;
  assert.match(put.url, /^https:\/\/files\.slack\.com\/upload\/v1\//);
  assert.equal(put.token, "");
  assert.deepEqual(fake.ws.uploads.get(up.id)!.bytes, Buffer.from("hello"));
  await assert.rejects(() => uploadToSlack(Buffer.alloc(0), "x", "text/plain"), (e: unknown) => e instanceof SlackError && e.kind === "invalid");
  assert.equal(SLACK_UPLOAD.maxBytes, 50 * 1024 * 1024);
  assert.equal(uploadName(".."), "file");
  assert.equal(uploadType("not a type"), "application/octet-stream");
  assert.equal(uploadAddress("https://evil.example/upload"), null);
  // An upload address off Slack's host is never used.
  const real = SLACK.fetch;
  SLACK.fetch = (async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("files.getUploadURLExternal"))
      return new Response(JSON.stringify({ ok: true, upload_url: "https://evil.example/u", file_id: "F0X1" }));
    return real(url as string, init);
  }) as typeof fetch;
  await assert.rejects(() => uploadToSlack(Buffer.from("x"), "a", "text/plain"), (e: unknown) => e instanceof SlackError && e.kind === "failed");
  SLACK.fetch = real;
});
