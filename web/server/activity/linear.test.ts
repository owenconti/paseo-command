/**
 * Activity's Linear source over the fake Linear: nothing here reaches Linear.
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { resetLinearClient } from "../linear/client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "../linear/fake";
import { resetLinearReads } from "../linear/reads";
import { linearEntity, readLinearActivity, resetLinearActivity, writeLinearActivity } from "./linear";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
  resetLinearActivity();
});
afterEach(() => fake.restore());

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
  assert.deepEqual(eng1!.open, { kind: "linear-issue", key: "ENG-1" });
  assert.equal(eng1!.actor?.name, "Sam Rivera");
  assert.equal(eng3!.unread, false);
  assert.deepEqual(launch!.open, { kind: "linear-project", id: I.projects.launch });
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
