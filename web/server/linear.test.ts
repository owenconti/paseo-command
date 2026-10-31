import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./subagentArchive";
import { writeSettings, settingsFile } from "./settings";
import { LINEAR } from "./links";
import { assignedIssues, issueDetail, linearImage, resetLinear } from "./linear";

// Linear is never reached: LINEAR.fetch answers here.
const secretFile = () => join(dataDir(), "secrets.json");
const setKey = (linearApiKey: string) => {
  mkdirSync(dataDir(), { recursive: true });
  writeFileSync(secretFile(), JSON.stringify({ linearApiKey }));
};
beforeEach(() => writeSettings({ integrations: { linear: true } }));
const realFetch = LINEAR.fetch;
const asked: { query: string; variables: Record<string, unknown>; auth: string }[] = [];
function answer(data: unknown, status = 200) {
  LINEAR.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    asked.push({
      ...body,
      auth: String((init?.headers as Record<string, string>).Authorization),
    });
    return new Response(JSON.stringify(data), { status });
  }) as typeof fetch;
}
afterEach(() => {
  LINEAR.fetch = realFetch;
  rmSync(secretFile(), { force: true });
  rmSync(settingsFile(), { force: true });
  asked.length = 0;
  resetLinear();
});

const issue = {
  identifier: "eng-12",
  title: "Fix the thing",
  url: "https://linear.app/acme/issue/ENG-12/fix-the-thing",
  priority: 2,
  priorityLabel: "High",
  branchName: "owen/eng-12-fix-the-thing",
  updatedAt: "2026-10-29T10:00:00.000Z",
  state: { name: "In Progress", type: "started", color: "#f2c94c" },
  team: { key: "ENG", name: "Engineering" },
  project: { name: "Launch" },
  labels: { nodes: [{ name: "Bug", color: "#eb5757" }] },
};

test("linear: unavailable without an API key, and nothing is asked", async () => {
  answer({ data: {} });
  const list = await assignedIssues();
  assert.equal(list.available, false);
  assert.match((list as { reason: string }).reason, /linearApiKey.*secrets.json/);
  assert.equal((await issueDetail("ENG-12")).available, false);
  assert.equal(asked.length, 0);
});

test("linear: lists your open assigned issues, cleaned", async () => {
  setKey("lin_api_test");
  answer({
    data: {
      viewer: {
        name: "Owen",
        assignedIssues: {
          nodes: [
            issue,
            { ...issue, identifier: "", title: "No key" },
            { ...issue, identifier: "ENG-13", url: "javascript:alert(1)", priority: 9, state: { color: "red" } },
          ],
        },
      },
    },
  });
  const list = await assignedIssues();
  assert.ok(list.available);
  assert.equal(list.viewer, "Owen");
  assert.deepEqual(list.issues[0], {
    key: "ENG-12",
    title: "Fix the thing",
    url: issue.url,
    state: { name: "In Progress", type: "started", color: "#f2c94c" },
    priority: 2,
    priorityLabel: "High",
    team: "ENG",
    project: "Launch",
    labels: [{ name: "Bug", color: "#eb5757" }],
    branchName: "owen/eng-12-fix-the-thing",
    updatedAt: issue.updatedAt,
  });
  assert.equal(list.issues.length, 2);
  assert.equal(list.issues[1].url, "");
  assert.equal(list.issues[1].priority, 0);
  assert.equal(list.issues[1].state.color, "#8a8f98");
  assert.equal(asked[0].auth, "lin_api_test");
  assert.match(asked[0].query, /assignedIssues/);
  assert.match(asked[0].query, /nin: \["completed", "canceled"\]/);
  // Cached, until asked for afresh.
  await assignedIssues();
  assert.equal(asked.length, 1);
  await assignedIssues(Date.now(), true);
  assert.equal(asked.length, 2);
});

test("linear: a refused key says so and isn't cached", async () => {
  setKey("lin_api_bad");
  answer({ errors: [{ message: "Authentication required" }] }, 401);
  const list = await assignedIssues();
  assert.deepEqual(list, { available: false, reason: "Linear refused the API key." });
  await assignedIssues();
  assert.equal(asked.length, 2);
});

test("linear: an issue's details, comments oldest first", async () => {
  setKey("lin_api_test");
  answer({
    data: {
      issue: {
        ...issue,
        description: "It **breaks**.",
        createdAt: "2026-10-01T00:00:00.000Z",
        dueDate: null,
        estimate: 3,
        assignee: { name: "Owen" },
        creator: { name: "Sam" },
        parent: { identifier: "ENG-1", title: "Epic" },
        attachments: { nodes: [{ title: "PR", url: "https://github.com/a/b/pull/1" }, { title: "Bad", url: "file:///x" }] },
        comments: {
          nodes: [
            { body: "Later", createdAt: "2026-10-03T00:00:00.000Z", user: { name: "Sam" } },
            { body: "First", createdAt: "2026-10-02T00:00:00.000Z", user: null },
          ],
        },
      },
    },
  });
  const detail = await issueDetail("eng-12");
  assert.ok(detail.available && detail.issue);
  assert.equal(asked[0].variables.id, "ENG-12");
  assert.equal(detail.issue.description, "It **breaks**.");
  assert.equal(detail.issue.dueDate, undefined);
  assert.equal(detail.issue.estimate, 3);
  assert.deepEqual(detail.issue.parent, { key: "ENG-1", title: "Epic" });
  assert.deepEqual(detail.issue.links, [{ title: "PR", url: "https://github.com/a/b/pull/1" }]);
  assert.deepEqual(
    detail.issue.comments.map((c) => [c.author, c.body]),
    [["Someone", "First"], ["Sam", "Later"]],
  );
  await assert.rejects(issueDetail("not a key"), /Invalid issue key/);
});

test("linear: an issue Linear doesn't know is null", async () => {
  setKey("lin_api_test");
  answer({ data: { issue: null } });
  assert.deepEqual(await issueDetail("ENG-404"), { available: true, issue: null });
});

test("linear: an uploaded image is fetched with the key; nothing else is", async () => {
  setKey("lin_api_test");
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
  assert.deepEqual(fetched, [{ url: "https://uploads.linear.app/a/b/image.png", auth: "lin_api_test" }]);
  for (const url of ["https://example.com/x.png", "http://uploads.linear.app/x.png", "https://u:p@uploads.linear.app/x.png", "nonsense"])
    assert.equal((await linearImage(url)).status, 400);
  assert.equal(fetched.length, 1);
  reply("text/html");
  assert.equal((await linearImage("https://uploads.linear.app/a/b/page")).status, 415);
});
