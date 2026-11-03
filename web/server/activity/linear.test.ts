/**
 * Activity's Linear source over the fake Linear: nothing here reaches Linear.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resetLinearClient } from "../linear/client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "../linear/fake";
import { resetLinearReads } from "../linear/reads";
import { writeSettings } from "../settings";
import { issueKeysIn } from "../linear/normalize";
import { linearEntity, readLinearActivity, resetLinearActivity, writeLinearActivity } from "./linear";
import { ACTIVITY_MARKS } from "./marks";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
  resetLinearActivity();
});
const realNow = ACTIVITY_MARKS.now;
afterEach(() => {
  ACTIVITY_MARKS.now = realNow;
  fake.restore();
});

test("one item per issue or project, as the Inbox, without the snoozed", async () => {
  const items = await readLinearActivity();
  assert.deepEqual(
    items.map((i) => i.key),
    [`linear:issue:${I.issues["ENG-1"]}`, `linear:issue:${I.issues["ENG-3"]}`, `linear:project:${I.projects.launch}`],
  );
  const [eng1, eng3, launch] = items;
  assert.equal(eng1!.unread, true);
  assert.equal(eng1!.title, "Ship the Linear tab");
  assert.match(eng1!.subtitle!, /^ENG-1 · Sam Rivera commented/);
  assert.equal(eng1!.subject, "issue");
  assert.equal(eng1!.kind, "issueNewComment");
  assert.equal(eng1!.url, "https://linear.app/fake/issue/ENG-1#comment");
  assert.equal(eng1!.actor?.name, "Sam Rivera");
  assert.equal(eng3!.unread, false);
  assert.equal(launch!.url, "https://linear.app/fake/project/launch");
  assert.equal(launch!.subject, "project");
});

test("cached briefly; fresh asks again", async () => {
  await readLinearActivity();
  const asked = fake.requests.filter((r) => r.operation === "Notifications").length;
  await readLinearActivity();
  assert.equal(fake.requests.filter((r) => r.operation === "Notifications").length, asked);
  await readLinearActivity(true);
  assert.equal(fake.requests.filter((r) => r.operation === "Notifications").length, asked + 1);
});

test("read, unread and done act on a row's notifications together", async () => {
  const [eng1, , launch] = await readLinearActivity();
  assert.deepEqual(await writeLinearActivity("read", [eng1!]), []);
  assert.deepEqual(fake.requests.at(-1)!.variables.input, { issueId: I.issues["ENG-1"] });
  assert.equal(fake.requests.at(-1)!.operation, "NotificationMarkReadAll");
  assert.equal((await readLinearActivity())[0]!.unread, false);
  assert.deepEqual(await writeLinearActivity("unread", [eng1!]), []);
  assert.equal(fake.requests.at(-1)!.operation, "NotificationMarkUnreadAll");
  assert.deepEqual(await writeLinearActivity("done", [launch!]), []);
  assert.deepEqual(fake.requests.at(-1)!.variables.input, { projectId: I.projects.launch });
  assert.ok(!(await readLinearActivity()).some((i) => i.key === launch!.key));
  fake.fail("NotificationArchiveAll", { message: "Nope", type: "InvalidInput" });
  const failed = await writeLinearActivity("done", [eng1!]);
  assert.deepEqual(failed, [{ key: eng1!.key, error: "Nope" }]);
});

test("ids name an issue, project or notification", () => {
  assert.deepEqual(linearEntity(`issue:${I.issues["ENG-1"]}`), { issueId: I.issues["ENG-1"] });
  assert.deepEqual(linearEntity(`notification:${I.notifications.eng1Comment}`), { id: I.notifications.eng1Comment });
  assert.equal(linearEntity("team:x"), null);
});

test("a pull request notification opens the issue its branch or title names", async () => {
  const at = new Date().toISOString();
  const pr = (id: string, type: string, pullRequest: { title: string; sourceBranch: string }) => ({
    id,
    kind: "pullRequest" as const,
    type,
    title: pullRequest.title,
    subtitle: "merge-gate / pass check failed",
    url: `https://github.com/acme/site/pull/${id.length}`,
    createdAt: at,
    updatedAt: at,
    readAt: null,
    snoozedUntilAt: null,
    archivedAt: null,
    actor: null,
    pullRequest: { id: `0000000${id.length}-pr00-4000-8000-000000000000`, ...pullRequest },
  });
  fake.ws.notifications.push(
    pr("90000001-0000-4000-8000-000000000001", "pullRequestChecksFailed", {
      title: "Build file-based pages as immutable ES modules",
      sourceBranch: "owen/de-1-build-file-based-pages",
    }),
    pr("90000001-0000-4000-8000-000000000002", "pullRequestCommented", {
      title: "ENG-2: Tidy the sidebar",
      sourceBranch: "tidy-sidebar",
    }),
    pr("90000001-0000-4000-8000-000000000003", "pullRequestCommented", {
      title: "Release 2026",
      sourceBranch: "release-2026",
    }),
  );
  const items = await readLinearActivity();
  const of = (id: string) => items.find((i) => i.key === `linear:notification:${id}`)!;
  const checks = of("90000001-0000-4000-8000-000000000001");
  // Linear's address for the issue, from the workspace's.
  assert.equal(checks.url, "https://linear.app/fake/issue/DE-1");
  assert.equal(checks.subject, "pull");
  assert.equal(checks.kind, "pullRequestChecksFailed");
  assert.match(checks.subtitle!, /^DE-1 · merge-gate/);
  assert.equal(of("90000001-0000-4000-8000-000000000002").url, "https://linear.app/fake/issue/ENG-2");
  // No team of the workspace's: its address, as before.
  const release = of("90000001-0000-4000-8000-000000000003");
  assert.equal(release.url, "https://github.com/acme/site/pull/36");
  assert.ok(fake.requests.some((r) => r.operation === "Notifications"));
});

test("without Linear's address for the workspace, the one set for the header's chip, else a notification's", async () => {
  fake.ws.urlKey = "";
  fake.ws.notifications = fake.ws.notifications.filter((n) => n.kind !== "issue");
  const at = new Date().toISOString();
  fake.ws.notifications.push({
    id: "90000001-0000-4000-8000-000000000004",
    kind: "pullRequest",
    type: "pullRequestCommented",
    title: "ENG-2: Tidy the sidebar",
    subtitle: "Sam commented",
    url: "https://github.com/acme/site/pull/4",
    createdAt: at,
    updatedAt: at,
    readAt: null,
    snoozedUntilAt: null,
    archivedAt: null,
    actor: null,
    pullRequest: { id: "00000004-pr00-4000-8000-000000000000", title: "ENG-2: Tidy the sidebar", sourceBranch: "tidy" },
  });
  const pull = async () => (await readLinearActivity(true)).find((i) => i.subject === "pull")!.url;
  // The project's notification names the workspace.
  assert.equal(await pull(), "https://linear.app/fake/issue/ENG-2");
  writeSettings({ linearWorkspace: "acme" });
  assert.equal(await pull(), "https://linear.app/acme/issue/ENG-2");
  // Nothing names it: the pull request's own address.
  writeSettings({ linearWorkspace: "" });
  fake.ws.notifications = fake.ws.notifications.filter((n) => n.kind === "pullRequest");
  assert.equal(await pull(), "https://github.com/acme/site/pull/4");
});

test("issue keys in a branch or title", () => {
  assert.deepEqual(issueKeysIn("owen/de-7919-build-file-based-pages DE-7919: Build"), ["DE-7919"]);
  assert.deepEqual(issueKeysIn("[ENG-12] fix, see eng-13"), ["ENG-12", "ENG-13"]);
  assert.deepEqual(issueKeysIn("feature/x2-3 v1.2-3 node-v20"), ["X2-3"]);
  assert.deepEqual(issueKeysIn("main"), []);
});

test("a done row stays gone while the Inbox lags, until a newer notification", async () => {
  let clock = Date.now();
  ACTIVITY_MARKS.now = () => clock;
  const [eng1] = await readLinearActivity();
  assert.deepEqual(await writeLinearActivity("done", [eng1!]), []);
  // The Inbox still lists them, as before the write (and still unread): gone, asked again or not.
  const archived = fake.ws.notifications.filter((n) => n.archivedAt);
  assert.ok(archived.length);
  for (const n of archived) n.archivedAt = null;
  assert.ok(!(await readLinearActivity()).some((i) => i.key === eng1!.key));
  clock += ACTIVITY_MARKS.settleMs;
  assert.ok(!(await readLinearActivity(true)).some((i) => i.key === eng1!.key));
  // A new notification on the issue: back.
  const newer = new Date(clock + 1_000).toISOString();
  archived[0]!.createdAt = newer;
  archived[0]!.updatedAt = newer;
  archived[0]!.readAt = null;
  assert.ok((await readLinearActivity(true)).some((i) => i.key === eng1!.key));
});

test("a refused read stays unread; read shows as read while the Inbox still has it unread", async () => {
  const [eng1] = await readLinearActivity();
  fake.fail("NotificationMarkReadAll", { message: "Later", type: "InvalidInput" });
  assert.deepEqual(await writeLinearActivity("read", [eng1!]), [{ key: eng1!.key, error: "Later" }]);
  assert.equal((await readLinearActivity()).find((i) => i.key === eng1!.key)!.unread, true);
  fake.restore();
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
  assert.deepEqual(await writeLinearActivity("read", [eng1!]), []);
  for (const n of fake.ws.notifications) n.readAt = null;
  assert.equal((await readLinearActivity()).find((i) => i.key === eng1!.key)!.unread, false);
});
