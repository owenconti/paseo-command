import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { saveSecret } from "../secrets";
import { writeSettings } from "../settings";
import { DISABLED, LinearError, NO_KEY, resetLinearClient } from "./client";
import { FAKE_IDS as I, installFakeLinear, type FakeLinear } from "./fake";
import { resetLinearReads } from "./reads";
import { WRITES, linearWrite } from "./writes";

let fake: FakeLinear;
beforeEach(() => {
  fake = installFakeLinear();
  resetLinearClient();
  resetLinearReads();
});
afterEach(() => fake.restore());

const kind = (k: LinearError["kind"], message?: string) => (e: unknown) =>
  e instanceof LinearError && e.kind === k && (message === undefined || e.message === message);

test("lists exactly Activity's writes", () => {
  assert.deepEqual(Object.keys(WRITES).sort(), ["notificationArchiveAll", "notificationMarkReadAll", "notificationMarkUnreadAll"]);
});

/** Runs `fn` and asserts it moved every record's `updatedAt` forward. */
async function bumped<T>(records: { updatedAt: string }[], fn: () => Promise<T>): Promise<T> {
  const before = records.map((r) => r.updatedAt);
  await new Promise((r) => setTimeout(r, 5));
  const out = await fn();
  records.forEach((r, i) => assert.ok(r.updatedAt > before[i], "updatedAt moved"));
  return out;
}

test("notifications: an issue's or project's together, or one by id, read, unread and archived", async () => {
  const of = (id: string) => fake.ws.notifications.find((n) => n.id === id)!;
  const eng1 = [of(I.notifications.eng1Comment), of(I.notifications.eng1Reaction)];
  const at = new Date().toISOString();
  const read = await bumped(eng1, () => linearWrite("notificationMarkReadAll", { issueId: I.issues["ENG-1"], readAt: at }));
  assert.deepEqual(read.notifications.map((n) => !!n.readAt), [true, true]);
  assert.ok(eng1.every((n) => n.readAt));
  // Others are left alone.
  assert.equal(of(I.notifications.launchUpdate).readAt, null);
  await bumped(eng1, () => linearWrite("notificationMarkUnreadAll", { issueId: I.issues["ENG-1"] }));
  assert.ok(eng1.every((n) => n.readAt === null));

  const project = of(I.notifications.launchUpdate);
  await bumped([project], () => linearWrite("notificationArchiveAll", { projectId: I.projects.launch }));
  assert.ok(project.archivedAt);
  const one = of(I.notifications.eng3Assigned);
  const archived = await linearWrite("notificationArchiveAll", { id: one.id });
  assert.ok(archived.notifications[0]!.archivedAt);
});

test("refuses writes that don't name one thing, a time out of reach, or unknown names and fields", async () => {
  const issueId = I.issues["ENG-1"];
  const now = new Date().toISOString();
  for (const [name, body] of [
    ["notificationMarkReadAll", { readAt: now }],
    ["notificationMarkReadAll", { issueId, projectId: I.projects.launch, readAt: now }],
    ["notificationMarkReadAll", { issueId }],
    ["notificationMarkReadAll", { issueId, readAt: "yesterday" }],
    ["notificationMarkReadAll", { issueId, readAt: "2020-01-01T00:00:00Z" }],
    ["notificationArchiveAll", { issueId: "../x" }],
    ["notificationArchiveAll", { issueId, readAt: now }],
    ["notificationArchiveAll", "nope"],
    ["notificationSnoozeAll", { issueId }],
    ["issueUpdate", { id: issueId, priority: 2 }],
    ["constructor", {}],
  ] as const) {
    await assert.rejects(linearWrite(name, body), kind("invalid"), `${name} ${JSON.stringify(body)}`);
  }
  for (const name of ["constructor", "toString", "__proto__"]) {
    await assert.rejects(linearWrite("notificationArchiveAll", JSON.parse(`{"issueId":"${issueId}","${name}":1}`)), kind("invalid", `Unexpected field ${name}`));
  }
  assert.equal(fake.requests.length, 0);
});

test("passes Linear's refusal through", async () => {
  fake.fail("NotificationArchiveAll", { message: "x", type: "InvalidInput" });
  await assert.rejects(linearWrite("notificationArchiveAll", { id: I.notifications.eng3Assigned }), kind("invalid", "x"));
  fake.clear("NotificationArchiveAll");
  fake.fail("NotificationArchiveAll", { message: "boom" });
  await assert.rejects(linearWrite("notificationArchiveAll", { id: I.notifications.eng3Assigned }), kind("failed", "boom"));
});

test("an unavailable Linear is an error, never a success", async () => {
  const write = () => linearWrite("notificationMarkUnreadAll", { issueId: I.issues["ENG-1"] });
  fake.fail("NotificationMarkUnreadAll", { status: 429, message: "slow" });
  await assert.rejects(write(), (e) => kind("limited")(e) && typeof (e as LinearError).retryAt === "number");
  fake.clear("NotificationMarkUnreadAll");
  fake.fail("NotificationMarkUnreadAll", { status: 401, message: "no" });
  await assert.rejects(write(), kind("refused"));
  saveSecret({ name: "linearApiKey", value: null });
  await assert.rejects(write(), kind("no-key", NO_KEY));
  writeSettings({ integrations: { linear: false } });
  await assert.rejects(write(), kind("no-key", DISABLED));
});
