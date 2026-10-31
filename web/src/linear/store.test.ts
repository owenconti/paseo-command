import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { FAKE_IDS } from "../../server/linear/fake";
import { setLinearTransport, setLinearUploader } from "./api";
import {
  clearPending,
  keepSynced,
  linearStore,
  loadCycles,
  loadIssue,
  loadNotifications,
  loadScope,
  loadSearch,
  loadViews,
  loadWorkspace,
  markPending,
  scopeIssues,
  setLinearNotice,
  syncTick,
} from "./store";
import type { LinearComment, LinearIssue, LinearNotification, LinearState, LinearSync, LinearWorkspace } from "./types";

const ME = FAKE_IDS.owen;
const TODO: LinearState = { id: "s-todo", name: "Todo", type: "unstarted", color: "#ccc", position: 1, teamId: "t" };
const DONE: LinearState = { id: "s-done", name: "Done", type: "completed", color: "#0a0", position: 2, teamId: "t" };
const WS: LinearWorkspace = {
  viewerId: ME,
  users: [],
  teams: [],
  states: [TODO, DONE],
  labels: [],
  cycles: [],
  projects: [],
  initiatives: [],
};

function issue(n: number, patch: Partial<LinearIssue> = {}): LinearIssue {
  return {
    id: `i-${n}`,
    key: `ENG-${n}`,
    title: `Issue ${n}`,
    url: `https://linear.app/x/issue/ENG-${n}`,
    teamId: "t",
    stateId: TODO.id,
    priority: 0,
    labelIds: [],
    branchName: `eng-${n}`,
    subscriberIds: [],
    sortOrder: n,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...patch,
  };
}
const sync = (patch: Partial<LinearSync> = {}): LinearSync => ({
  cursor: "2026-10-31T10:00:00.000Z",
  issues: [],
  comments: [],
  projects: [],
  initiatives: [],
  notifications: [],
  more: false,
  ...patch,
});

let calls: string[];
let answers: Record<string, (path: string, body?: unknown) => unknown>;
let notices: string[];
beforeEach(() => {
  linearStore.reset();
  calls = [];
  answers = {};
  notices = [];
  setLinearNotice((message) => notices.push(message));
  setLinearTransport(async (path, body) => {
    calls.push(path);
    const name = path.replace(/^linear\/q\//, "").split("?")[0];
    if (!answers[name]) throw new Error(`unexpected ${path}`);
    return answers[name](path, body);
  });
});
afterEach(() => {
  setLinearTransport(null);
  setLinearUploader(null);
});

/** A write's answer the test releases by hand, to look at the store while it's in flight. */
function held<T>() {
  let release!: (value: T) => void;
  let refuse!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    refuse = reject;
  });
  // Refused before it's asked for (writes queue): not an unhandled rejection meanwhile.
  promise.catch(() => {});
  return { promise, release, refuse };
}

/** Lets queued writes go out. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

describe("linear store", () => {
  it("a deleted issue leaves the store, and other issues' sub-issues and relations", () => {
    linearStore.mergeIssues([
      issue(1, { childIds: ["i-2"], relations: [{ id: "r1", type: "blocks", issueId: "i-2" }] }),
      issue(2, { parentId: "i-1" }),
      issue(3, { relations: [{ id: "r2", type: "related", issueId: "i-1" }] }),
    ]);
    linearStore.removeIssue("i-2");
    const d = linearStore.getState();
    assert.equal(d.issues.has("i-2"), false);
    assert.equal(d.byKey.has("ENG-2"), false);
    assert.deepEqual(d.issues.get("i-1")?.childIds, []);
    assert.deepEqual(d.issues.get("i-1")?.relations, []);
    assert.equal(d.issues.get("i-3")?.relations?.length, 1);
  });
  it("scopes follow the store", () => {
    linearStore.setWorkspace(WS);
    linearStore.mergeIssues([issue(1, { assigneeId: ME })]);
    assert.deepEqual(scopeIssues(linearStore.getState(), "assigned").map((i) => i.key), ["ENG-1"]);
    linearStore.mergeIssues([issue(1, { assigneeId: ME, stateId: DONE.id, updatedAt: "2026-10-02T00:00:00Z" })]);
    assert.deepEqual(scopeIssues(linearStore.getState(), "assigned"), []);
  });

  it("a cycle's issues follow the store, finished ones too", () => {
    linearStore.setWorkspace(WS);
    linearStore.mergeIssues([issue(1, { cycleId: "c-7" }), issue(2, { cycleId: "c-7", stateId: DONE.id }), issue(3)]);
    assert.deepEqual(scopeIssues(linearStore.getState(), "cycle:c-7").map((i) => i.key).sort(), ["ENG-1", "ENG-2"]);
    linearStore.mergeIssues([issue(1, { updatedAt: "2026-10-02T00:00:00Z" })]);
    assert.deepEqual(scopeIssues(linearStore.getState(), "cycle:c-7").map((i) => i.key), ["ENG-2"]);
  });

  it("a view's issues are those Linear returned, in its order, asked again when a sync changes issues while it shows", async () => {
    linearStore.setWorkspace(WS);
    let members = ["i-2", "i-1"];
    answers.issues = () => ({ issues: members.map((id) => issue(Number(id.slice(2)))) });
    await loadScope("view:v1");
    assert.deepEqual(scopeIssues(linearStore.getState(), "view:v1").map((i) => i.key), ["ENG-2", "ENG-1"]);
    // Nothing asked by id: a view's load says itself what's in it.
    assert.deepEqual(calls, ["linear/q/issues?scope=view%3Av1"]);
    // A sync brings a change: the view shown is asked again, and ENG-2 has left it.
    linearStore.setShownScope("view:v1");
    members = ["i-1"];
    answers.sync = () => sync({ issues: [issue(2, { title: "Moved", updatedAt: "2026-10-02T00:00:00Z" })] });
    linearStore.applySync(sync({ cursor: "2026-10-01T00:00:00Z" }));
    await syncTick();
    assert.deepEqual(scopeIssues(linearStore.getState(), "view:v1").map((i) => i.key), ["ENG-1"]);
    // Not shown: a sync with changes doesn't ask now, but the view is asked again when it next shows.
    linearStore.setShownScope(undefined);
    calls = [];
    members = ["i-1", "i-2"];
    answers.sync = () => sync({ issues: [issue(2, { title: "Back", updatedAt: "2026-10-03T00:00:00Z" })] });
    await syncTick();
    assert.ok(!calls.some((c) => c.includes("scope=view")));
    assert.equal(linearStore.getState().loadedScopes.has("view:v1"), false);
    // Meanwhile it shows what it had.
    assert.deepEqual(scopeIssues(linearStore.getState(), "view:v1").map((i) => i.key), ["ENG-1"]);
    await loadScope("view:v1");
    assert.deepEqual(scopeIssues(linearStore.getState(), "view:v1").map((i) => i.key), ["ENG-1", "ENG-2"]);
    // A sync with nothing changed leaves a loaded view alone.
    answers.sync = () => sync();
    await syncTick();
    assert.equal(linearStore.getState().loadedScopes.has("view:v1"), true);
  });

  it("a search lists what Linear found, most relevant first, and a refusal stays with the search", async () => {
    linearStore.setWorkspace(WS);
    answers.search = () => ({ issues: [issue(3), issue(1)] });
    assert.deepEqual(await loadSearch(" sync "), {});
    assert.deepEqual(calls, ["linear/q/search?term=sync"]);
    assert.deepEqual(scopeIssues(linearStore.getState(), "search:sync").map((i) => i.key), ["ENG-3", "ENG-1"]);
    // Asked in the last minute: not again, unless fresh.
    await loadSearch("sync");
    assert.equal(calls.length, 1);
    await loadSearch("sync", true);
    assert.equal(calls.length, 2);
    // Too fast for Linear: the search says why, and the tab isn't paused.
    answers.search = () => ({ available: false, reason: "Searching too fast", retryAt: Date.now() + 60_000 });
    assert.deepEqual(await loadSearch("launch"), { error: "Searching too fast" });
    assert.equal(linearStore.getState().unavailable, undefined);
  });

  it("your inbox: loaded once, kept by sync, a write shown at once and put back if refused", async () => {
    const note = (id: string, extra: Partial<LinearNotification> = {}): LinearNotification => ({
      id,
      type: "issueNewComment",
      title: "ENG-1 Issue 1",
      subtitle: "Sam commented",
      url: "https://linear.app/x",
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
      issueId: "i-1",
      ...extra,
    });
    answers.notifications = () => ({ notifications: [note("n1"), note("n2")] });
    await Promise.all([loadNotifications(), loadNotifications()]);
    assert.deepEqual(calls, ["linear/q/notifications"]);
    assert.deepEqual([...linearStore.getState().notifications.keys()], ["n1", "n2"]);

    // A sync's changes take their place; an archived one leaves.
    linearStore.applySync(sync({ notifications: [note("n1", { readAt: "2026-10-31T00:00:00Z" }), note("n2", { archivedAt: "x" })] }));
    assert.ok(linearStore.getState().notifications.get("n1")?.readAt);
    assert.equal(linearStore.getState().notifications.has("n2"), false);

    // Marked unread: at once, and a sync in flight doesn't undo it; Linear's answer then stands.
    const answer = held<{ notifications: LinearNotification[] }>();
    setLinearTransport(async (path, body) => {
      calls.push(path);
      if (path === "linear/m/notificationMarkUnreadAll") return answer.promise;
      throw new Error(`unexpected ${path} ${JSON.stringify(body)}`);
    });
    const writing = linearStore.writeNotifications("notificationMarkUnreadAll", { issueId: "i-1" }, ["n1"], { readAt: undefined });
    assert.equal(linearStore.getState().notifications.get("n1")?.readAt, undefined);
    linearStore.applySync(sync({ notifications: [note("n1", { readAt: "2026-10-31T00:00:00Z" })] }));
    assert.equal(linearStore.getState().notifications.get("n1")?.readAt, undefined);
    answer.release({ notifications: [note("n1", { updatedAt: "2026-10-31T01:00:00Z" })] });
    assert.equal(await writing, true);
    assert.equal(linearStore.getState().notifications.get("n1")?.updatedAt, "2026-10-31T01:00:00Z");

    // Archiving refused: it comes back as it was, and the notice says why.
    setLinearTransport(async () => {
      throw new Error("Not allowed");
    });
    const archived = linearStore.writeNotifications("notificationArchiveAll", { id: "n1" }, ["n1"], { archivedAt: "now" });
    assert.equal(linearStore.getState().notifications.has("n1"), false);
    assert.equal(await archived, false);
    assert.ok(linearStore.getState().notifications.has("n1"));
    assert.match(notices.at(-1) ?? "", /Not allowed/);
  });

  it("inbox writes on a notification go one after another; a refused one puts back only what it set", async () => {
    const note = (id: string, extra: Partial<LinearNotification> = {}): LinearNotification => ({
      id,
      type: "issueNewComment",
      title: "ENG-1 Issue 1",
      subtitle: "Sam commented",
      url: "https://linear.app/x",
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
      issueId: "i-1",
      ...extra,
    });
    linearStore.mergeNotifications([note("n1")]);
    const snooze = held<{ notifications: LinearNotification[] }>();
    const read = held<{ notifications: LinearNotification[] }>();
    const sent: string[] = [];
    setLinearTransport(async (path) => {
      sent.push(path);
      if (path.endsWith("notificationSnoozeAll")) return snooze.promise;
      if (path.endsWith("notificationMarkReadAll")) return read.promise;
      throw new Error(`unexpected ${path}`);
    });
    const later = "2026-11-01T09:00:00.000Z";
    const snoozing = linearStore.writeNotifications("notificationSnoozeAll", { issueId: "i-1", snoozedUntilAt: later }, ["n1"], {
      snoozedUntilAt: later,
    });
    const reading = linearStore.writeNotifications("notificationMarkReadAll", { issueId: "i-1", readAt: "r" }, ["n1"], {
      readAt: "2026-10-31T00:00:00Z",
    });
    await settled();
    assert.deepEqual(sent, ["linear/m/notificationSnoozeAll"], "the read waits for the snooze");
    const shown = () => linearStore.getState().notifications.get("n1");
    assert.deepEqual([shown()?.snoozedUntilAt, shown()?.readAt], [later, "2026-10-31T00:00:00Z"]);
    snooze.refuse(new Error("No"));
    assert.equal(await snoozing, false);
    // The snooze goes back; the read, still pending, stays.
    assert.deepEqual([shown()?.snoozedUntilAt, shown()?.readAt], [undefined, "2026-10-31T00:00:00Z"]);
    read.release({ notifications: [note("n1", { readAt: "2026-10-31T00:00:00Z", updatedAt: "2026-10-31T00:00:01Z" })] });
    assert.equal(await reading, true);
    assert.deepEqual(sent, ["linear/m/notificationSnoozeAll", "linear/m/notificationMarkReadAll"]);
    assert.deepEqual([shown()?.snoozedUntilAt, shown()?.readAt], [undefined, "2026-10-31T00:00:00Z"]);
  });

  it("an inbox read begun before a write was saved doesn't undo it, nor bring back what was archived", async () => {
    const note = (id: string, extra: Partial<LinearNotification> = {}): LinearNotification => ({
      id,
      type: "issueNewComment",
      title: "ENG-1 Issue 1",
      subtitle: "Sam commented",
      url: "https://linear.app/x",
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
      issueId: "i-1",
      ...extra,
    });
    linearStore.mergeNotifications([note("n1"), note("n2", { issueId: "i-2" })]);
    const load = held<{ notifications: LinearNotification[] }>();
    setLinearTransport(async (path) => {
      if (path === "linear/q/notifications") return load.promise;
      if (path.endsWith("notificationMarkReadAll"))
        return { notifications: [note("n1", { readAt: "2026-10-31T00:00:00Z" })] };
      if (path.endsWith("notificationArchiveAll")) return { notifications: [note("n2", { issueId: "i-2", archivedAt: "a" })] };
      throw new Error(`unexpected ${path}`);
    });
    const loading = loadNotifications(true);
    await linearStore.writeNotifications("notificationMarkReadAll", { issueId: "i-1", readAt: "r" }, ["n1"], {
      readAt: "2026-10-31T00:00:00Z",
    });
    await linearStore.writeNotifications("notificationArchiveAll", { issueId: "i-2" }, ["n2"], { archivedAt: "a" });
    // The load's answer, from before both.
    load.release({ notifications: [note("n1"), note("n2", { issueId: "i-2" })] });
    await loading;
    assert.equal(linearStore.getState().notifications.get("n1")?.readAt, "2026-10-31T00:00:00Z");
    assert.equal(linearStore.getState().notifications.has("n2"), false);
    // A newer record than the page's (changed in Linear since) still comes in.
    linearStore.applySync(sync({ notifications: [note("n1", { updatedAt: "2026-11-02T00:00:00Z" })] }), 0);
    assert.equal(linearStore.getState().notifications.get("n1")?.readAt, undefined);
  });

  it("the inbox loads page by page up to 500, and is asked again once archiving leaves it well below", async () => {
    const note = (n: number): LinearNotification => ({
      id: `n${n}`,
      type: "issueNewComment",
      title: "T",
      subtitle: "S",
      url: "https://linear.app/x",
      createdAt: "2026-10-30T00:00:00Z",
      updatedAt: "2026-10-30T00:00:00Z",
      issueId: `i-${n}`,
    });
    answers.notifications = (path) => {
      const start = Number(new URL(path, "http://x").searchParams.get("after") ?? 0);
      return { notifications: Array.from({ length: 250 }, (_, n) => note(start + n)), next: String(start + 250) };
    };
    await loadNotifications();
    assert.deepEqual(calls, ["linear/q/notifications", "linear/q/notifications?after=250"]);
    assert.equal(linearStore.getState().notifications.size, 500);
    assert.equal(linearStore.getState().notificationsCapped, true);
    // Archiving 60 rows' worth: the inbox is asked for again.
    setLinearTransport(async (path) => {
      calls.push(path);
      if (path.startsWith("linear/m/")) return { notifications: [] };
      return answers.notifications(path);
    });
    calls = [];
    for (let n = 0; n < 60; n++)
      await linearStore.writeNotifications("notificationArchiveAll", { issueId: `i-${n}` }, [`n${n}`], { archivedAt: "a" });
    await settled();
    assert.ok(calls.includes("linear/q/notifications"), "asked again");
    assert.equal(calls.filter((c) => c === "linear/q/notifications").length, 1, "once");
  });

  it("attachments: a link and an uploaded file join the issue; a refused removal puts it back", async () => {
    const at = (id: string, createdAt: string) => ({ id, title: id, url: `https://example.com/${id}`, createdAt });
    linearStore.mergeIssues([issue(1, { attachments: [at("a1", "2026-10-01T00:00:00Z")] })]);
    const sent: { path: string; body: unknown }[] = [];
    setLinearTransport(async (path, body) => {
      sent.push({ path, body });
      if (path.endsWith("attachmentLinkURL")) return { attachment: at("a2", "2026-10-02T00:00:00Z") };
      if (path.endsWith("attachmentCreate")) return { attachment: { ...at("a3", "2026-10-03T00:00:00Z"), url: (body as { url: string }).url } };
      throw new Error("Not allowed");
    });
    setLinearUploader(async (_file, name) => ({ url: `https://uploads.linear.app/w/x/${name}`, name, contentType: "application/pdf", size: 2048 }));
    assert.equal(await linearStore.attachLink("i-1", "https://example.com/a2", " "), true);
    assert.deepEqual(sent[0].body, { issueId: "i-1", url: "https://example.com/a2" }, "a blank title isn't sent");
    assert.equal(await linearStore.attachFile("i-1", new Blob(["x"]), "report.pdf"), true);
    assert.deepEqual(sent[1].body, {
      issueId: "i-1",
      url: "https://uploads.linear.app/w/x/report.pdf",
      title: "report.pdf",
      subtitle: "PDF · 2 KB",
    });
    const ids = () => linearStore.getState().issues.get("i-1")?.attachments?.map((a) => a.id);
    assert.deepEqual(ids(), ["a1", "a2", "a3"]);
    // Removing: gone at once, back in its place when Linear refuses.
    const removing = linearStore.detach("i-1", "a2");
    assert.deepEqual(ids(), ["a1", "a3"]);
    assert.equal(await removing, false);
    assert.deepEqual(ids(), ["a1", "a2", "a3"]);
    assert.match(notices.at(-1) ?? "", /Not allowed/);
    // An upload that fails attaches nothing and says why.
    setLinearUploader(async () => {
      throw new Error("Files up to 25 MB can be uploaded.");
    });
    assert.equal(await linearStore.attachFile("i-1", new Blob(["x"]), "huge.mov"), false);
    assert.match(notices.at(-1) ?? "", /huge\.mov: Files up to 25 MB/);
    assert.deepEqual(ids(), ["a1", "a2", "a3"]);
  });

  it("loads the views once, and again when fresh", async () => {
    const view = { id: "v1", name: "Mine", color: "#000", shared: false, updatedAt: "", display: { layout: "board" } };
    answers.views = () => ({ views: [view] });
    await Promise.all([loadViews(), loadViews()]);
    await loadViews();
    assert.deepEqual(calls, ["linear/q/views"]);
    assert.deepEqual(linearStore.getState().views, [view]);
    await loadViews(true);
    assert.equal(calls.length, 2);
  });

  it("loads a team's cycles once, and again when fresh", async () => {
    const cycle = { id: "c-7", teamId: "t", number: 7, startsAt: "", endsAt: "", isActive: true, isNext: false, progress: 0.5 };
    answers.cycles = () => ({ cycles: [cycle] });
    await Promise.all([loadCycles("t"), loadCycles("t")]);
    await loadCycles("t");
    assert.deepEqual(calls, ["linear/q/cycles?team=t"]);
    assert.deepEqual(linearStore.getState().cycles.get("t"), [cycle]);
    await loadCycles("t", true);
    assert.equal(calls.length, 2);
    answers.cycles = () => ({ available: false, reason: "no key" });
    await loadCycles("u");
    assert.equal(linearStore.getState().cycles.has("u"), false);
    assert.equal(linearStore.getState().unavailable?.reason, "no key");
  });

  it("sync merges newer issues and drops archived ones", () => {
    linearStore.mergeIssues([issue(1), issue(2)]);
    linearStore.applySync(
      sync({
        issues: [
          issue(1, { title: "Renamed", updatedAt: "2026-10-31T09:00:00Z" }),
          issue(2, { archivedAt: "2026-10-31T09:00:00Z" }),
          issue(3),
        ],
      }),
    );
    const d = linearStore.getState();
    assert.equal(d.issues.get("i-1")?.title, "Renamed");
    assert.equal(d.issues.has("i-2"), false);
    assert.equal(d.byKey.has("ENG-2"), false);
    assert.equal(d.byKey.get("ENG-3"), "i-3");
    assert.equal(d.cursor, "2026-10-31T10:00:00.000Z");
  });

  it("sync never overwrites a field with a pending write", () => {
    linearStore.mergeIssues([issue(1)]);
    markPending("i-1", ["stateId"]);
    linearStore.applySync(sync({ issues: [issue(1, { stateId: DONE.id, title: "New title" })] }));
    assert.equal(linearStore.getState().issues.get("i-1")?.stateId, TODO.id);
    assert.equal(linearStore.getState().issues.get("i-1")?.title, "New title");
    clearPending("i-1", ["stateId"]);
    linearStore.applySync(sync({ issues: [issue(1, { stateId: DONE.id })] }));
    assert.equal(linearStore.getState().issues.get("i-1")?.stateId, DONE.id);
  });

  it("keeps an issue's details when a list or sync lacks them", () => {
    linearStore.mergeIssues([issue(1, { description: "Body", childIds: ["i-2"], relations: [], attachments: [] })]);
    linearStore.mergeIssues([issue(1, { title: "From a list" })]);
    linearStore.applySync(sync({ issues: [issue(1, { title: "From sync" })] }));
    const got = linearStore.getState().issues.get("i-1")!;
    assert.equal(got.title, "From sync");
    assert.equal(got.description, "Body");
    assert.deepEqual(got.childIds, ["i-2"]);
    assert.deepEqual(got.relations, []);
    assert.deepEqual(got.attachments, []);
  });

  it("pauses sync while limited", async () => {
    linearStore.applySync(sync({ cursor: "C0" }));
    linearStore.setUnavailable({ available: false, reason: "limited", retryAt: 1_000_000 + 60_000 });
    answers.sync = () => sync();
    await syncTick(1_000_000);
    assert.deepEqual(calls, []);
    await syncTick(1_000_000 + 60_001);
    assert.equal(calls.length, 1);
  });

  it("starts syncing from when the first load began", async () => {
    answers.workspace = () => WS;
    answers.sync = () => sync({ cursor: "C1" });
    const before = Date.now();
    await loadWorkspace();
    await syncTick(Date.now());
    const since = new URL(`http://x/${calls[1]}`).searchParams.get("since")!;
    assert.ok(Date.parse(since) >= before && Date.parse(since) <= Date.now());
    await syncTick(Date.now());
    assert.equal(new URL(`http://x/${calls[2]}`).searchParams.get("since"), "C1");
  });

  it("does nothing before anything is loaded", async () => {
    await syncTick(Date.now());
    assert.deepEqual(calls, []);
  });

  it("reloads loaded scopes when sync says more", async () => {
    answers.workspace = () => WS;
    answers.issues = () => ({ issues: [issue(1, { assigneeId: ME })] });
    await loadWorkspace();
    await loadScope("assigned");
    calls.length = 0;
    answers.sync = () => sync({ cursor: "C2", more: true });
    await syncTick(Date.now());
    assert.ok(calls.some((c) => c.startsWith("linear/q/sync")));
    assert.ok(calls.includes("linear/q/workspace?fresh=1"));
    assert.ok(calls.some((c) => c.startsWith("linear/q/issues?scope=assigned")));
    assert.equal(linearStore.getState().cursor, "C2");
    assert.equal(calls.filter((c) => c.startsWith("linear/q/sync")).length, 1);
  });

  it("pages a scope and loads it once", async () => {
    linearStore.setWorkspace(WS);
    answers.issues = (path) =>
      path.includes("after=p2") ? { issues: [issue(2, { assigneeId: ME })] } : { issues: [issue(1, { assigneeId: ME })], next: "p2" };
    await loadScope("assigned");
    await loadScope("assigned");
    assert.equal(calls.length, 2);
    assert.equal(scopeIssues(linearStore.getState(), "assigned").length, 2);
    assert.ok(linearStore.getState().loadedScopes.has("assigned"));
  });

  it("asks again for a loaded scope when fresh (Refresh)", async () => {
    linearStore.setWorkspace(WS);
    answers.issues = () => ({ issues: [issue(1, { assigneeId: ME })] });
    await loadScope("assigned");
    await loadScope("assigned", true);
    assert.equal(calls.length, 2);
  });

  it("records unavailable and leaves the scope unloaded", async () => {
    answers.issues = () => ({ available: false, reason: "no key" });
    await loadScope("assigned");
    assert.equal(linearStore.getState().unavailable?.reason, "no key");
    assert.equal(linearStore.getState().loadedScopes.has("assigned"), false);
  });
  it("writes optimistically, then keeps Linear's answer", async () => {
    linearStore.mergeIssues([issue(1, { priority: 3 })]);
    const answer = held<unknown>();
    let sent: unknown;
    answers["linear/m/issueUpdate"] = (_path, body) => {
      sent = body;
      return answer.promise;
    };
    const done = linearStore.write("issueUpdate", { id: "i-1", priority: 1 }, { issueId: "i-1", patch: { priority: 1 } });
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 1);
    // A sync from before the write lands meanwhile: the edited field keeps the edit.
    linearStore.applySync(sync({ issues: [issue(1, { priority: 3, title: "Synced", updatedAt: "2026-10-02T00:00:00Z" })] }));
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 1);
    assert.equal(linearStore.getState().issues.get("i-1")?.title, "Synced");
    answer.release({ issue: issue(1, { priority: 1, title: "Synced", updatedAt: "2026-10-03T00:00:00Z" }) });
    assert.equal(await done, true);
    assert.deepEqual(sent, { id: "i-1", priority: 1 });
    assert.equal(linearStore.getState().issues.get("i-1")?.updatedAt, "2026-10-03T00:00:00Z");
    assert.deepEqual(notices, []);
    // Nothing is pending any more: the next sync sets the field.
    linearStore.applySync(sync({ issues: [issue(1, { priority: 2, updatedAt: "2026-10-04T00:00:00Z" })] }));
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 2);
  });

  it("rolls a refused write back, even after a newer sync", async () => {
    linearStore.mergeIssues([issue(1, { priority: 3, labelIds: ["l-1"] })]);
    const answer = held<unknown>();
    answers["linear/m/issueUpdate"] = () => answer.promise;
    const done = linearStore.write(
      "issueUpdate",
      { id: "i-1", priority: 1, assigneeId: ME, labelIds: [] },
      { issueId: "i-1", patch: { priority: 1, assigneeId: ME, labelIds: [] } },
    );
    linearStore.applySync(sync({ issues: [issue(1, { priority: 3, labelIds: ["l-1"], title: "Synced", updatedAt: "2026-10-05T00:00:00Z" })] }));
    answer.refuse(new Error("Not allowed"));
    assert.equal(await done, false);
    const got = linearStore.getState().issues.get("i-1")!;
    assert.equal(got.priority, 3);
    assert.deepEqual(got.labelIds, ["l-1"]);
    assert.equal("assigneeId" in got, false);
    assert.equal(got.title, "Synced");
    assert.deepEqual(notices, ["Linear didn't save that: Not allowed"]);
    // Pending is cleared: sync sets the field again.
    linearStore.applySync(sync({ issues: [issue(1, { priority: 4, updatedAt: "2026-10-06T00:00:00Z" })] }));
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 4);
  });

  it("a refused write leaves a later edit of the same field alone", async () => {
    linearStore.mergeIssues([issue(1, { priority: 3 })]);
    const first = held<unknown>();
    const second = held<unknown>();
    const queue = [first, second];
    answers["linear/m/issueUpdate"] = () => queue.shift()!.promise;
    const one = linearStore.write("issueUpdate", { id: "i-1", priority: 1 }, { issueId: "i-1", patch: { priority: 1 } });
    const two = linearStore.write("issueUpdate", { id: "i-1", priority: 2 }, { issueId: "i-1", patch: { priority: 2 } });
    first.refuse(new Error("Busy"));
    assert.equal(await one, false);
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 2);
    // The second write is still pending: a sync doesn't undo it.
    linearStore.applySync(sync({ issues: [issue(1, { priority: 3, updatedAt: "2026-10-02T00:00:00Z" })] }));
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 2);
    second.release({ issue: issue(1, { priority: 2, updatedAt: "2026-10-03T00:00:00Z" }) });
    assert.equal(await two, true);
  });

  it("two refused edits of a field put back what Linear has, whichever is refused first", async () => {
    for (const order of [[0, 1], [1, 0]]) {
      linearStore.reset();
      linearStore.mergeIssues([issue(1, { priority: 3 })]);
      const replies = [held<unknown>(), held<unknown>()];
      const queue = [...replies];
      answers["linear/m/issueUpdate"] = () => queue.shift()!.promise;
      const a = linearStore.write("issueUpdate", { id: "i-1", priority: 1 }, { issueId: "i-1", patch: { priority: 1 } });
      const b = linearStore.write("issueUpdate", { id: "i-1", priority: 2 }, { issueId: "i-1", patch: { priority: 2 } });
      for (const n of order) replies[n].refuse(new Error("Not allowed"));
      assert.deepEqual(await Promise.all([a, b]), [false, false]);
      assert.equal(linearStore.getState().issues.get("i-1")?.priority, 3, `order ${order}`);
    }
  });

  it("a refused edit followed by a saved one keeps the saved one", async () => {
    linearStore.mergeIssues([issue(1, { priority: 3 })]);
    const first = held<unknown>();
    const second = held<unknown>();
    const queue = [first, second];
    answers["linear/m/issueUpdate"] = () => queue.shift()!.promise;
    const a = linearStore.write("issueUpdate", { id: "i-1", priority: 1 }, { issueId: "i-1", patch: { priority: 1 } });
    const b = linearStore.write("issueUpdate", { id: "i-1", priority: 2 }, { issueId: "i-1", patch: { priority: 2 } });
    first.refuse(new Error("Busy"));
    assert.equal(await a, false);
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 2);
    second.release({ issue: issue(1, { priority: 2, updatedAt: "2026-10-03T00:00:00Z" }) });
    assert.equal(await b, true);
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 2);
  });

  it("sends an issue's writes one after another, so the last choice is the last applied", async () => {
    linearStore.mergeIssues([issue(1, { labelIds: [] })]);
    const first = held<unknown>();
    const second = held<unknown>();
    const queue = [first, second];
    const sent: unknown[] = [];
    answers["linear/m/issueUpdate"] = (_path, body) => {
      sent.push(body);
      return queue.shift()!.promise;
    };
    const a = linearStore.write("issueUpdate", { id: "i-1", labelIds: ["l-1"] }, { issueId: "i-1", patch: { labelIds: ["l-1"] } });
    const b = linearStore.write(
      "issueUpdate",
      { id: "i-1", labelIds: ["l-1", "l-2"] },
      { issueId: "i-1", patch: { labelIds: ["l-1", "l-2"] } },
    );
    await settled();
    assert.deepEqual(sent, [{ id: "i-1", labelIds: ["l-1"] }]);
    assert.deepEqual(linearStore.getState().issues.get("i-1")?.labelIds, ["l-1", "l-2"]);
    first.release({ issue: issue(1, { labelIds: ["l-1"], updatedAt: "2026-10-02T00:00:00Z" }) });
    assert.equal(await a, true);
    await settled();
    assert.deepEqual(sent, [
      { id: "i-1", labelIds: ["l-1"] },
      { id: "i-1", labelIds: ["l-1", "l-2"] },
    ]);
    // The first answer didn't undo the second, still pending.
    assert.deepEqual(linearStore.getState().issues.get("i-1")?.labelIds, ["l-1", "l-2"]);
    second.release({ issue: issue(1, { labelIds: ["l-1", "l-2"], updatedAt: "2026-10-03T00:00:00Z" }) });
    assert.equal(await b, true);
    assert.deepEqual(linearStore.getState().issues.get("i-1")?.labelIds, ["l-1", "l-2"]);
  });

  it("a refused edit goes back to a newer value a sync brought meanwhile", async () => {
    linearStore.mergeIssues([issue(1, { priority: 3 })]);
    const answer = held<unknown>();
    answers["linear/m/issueUpdate"] = () => answer.promise;
    const done = linearStore.write("issueUpdate", { id: "i-1", priority: 1 }, { issueId: "i-1", patch: { priority: 1 } });
    // Someone else set it to Low in Linear meanwhile.
    linearStore.applySync(sync({ issues: [issue(1, { priority: 4, updatedAt: "2026-10-02T00:00:00Z" })] }));
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 1);
    answer.refuse(new Error("Not allowed"));
    assert.equal(await done, false);
    assert.equal(linearStore.getState().issues.get("i-1")?.priority, 4);
  });

  it("a comment comes whole: a cleared field clears, a pending one stays, a write's comment is kept", async () => {
    const comment = (patch: Partial<LinearComment> = {}): LinearComment => ({
      id: "c-1",
      issueId: "i-1",
      authorId: ME,
      body: "Hi",
      createdAt: "2026-10-01T00:00:00Z",
      reactions: [],
      ...patch,
    });
    linearStore.mergeComments([comment({ resolvedAt: "2026-10-02T00:00:00Z" })]);
    // As the page gets it over JSON: no resolvedAt at all.
    linearStore.mergeComments([JSON.parse(JSON.stringify(comment({ resolvedAt: undefined })))]);
    assert.equal(linearStore.getState().comments.get("c-1")?.resolvedAt, undefined);

    const mine = [{ emoji: "👍", userIds: [ME], ids: [""] }];
    markPending("c-1", ["reactions"]);
    linearStore.patchComment("c-1", { reactions: mine });
    linearStore.applySync(sync({ comments: [comment({ body: "Hi there" })] }));
    assert.deepEqual(linearStore.getState().comments.get("c-1")?.reactions, mine);
    assert.equal(linearStore.getState().comments.get("c-1")?.body, "Hi there");
    clearPending("c-1", ["reactions"]);

    answers["linear/m/commentUpdate"] = () => ({ comment: comment({ body: "Edited", editedAt: "2026-10-03T00:00:00Z" }) });
    assert.equal(await linearStore.write("commentUpdate", { id: "c-1", body: "Edited" }), true);
    assert.equal(linearStore.getState().comments.get("c-1")?.body, "Edited");
    linearStore.mergeComments([comment({ id: "c-2", parentId: "c-1" })]);
    linearStore.removeComment("c-1");
    assert.equal(linearStore.getState().comments.has("c-1"), false);
    assert.equal(linearStore.getState().comments.has("c-2"), false, "its reply goes with it");
  });

  it("a field cleared in Linear clears here too, though JSON drops it", () => {
    linearStore.mergeIssues([issue(1, { assigneeId: ME, dueDate: "2026-11-01", description: "Kept" })]);
    // Unassigned elsewhere: the sync's record, over JSON, has no assigneeId (nor the list-less description).
    const cleared = JSON.parse(JSON.stringify(issue(1, { updatedAt: "2026-10-02T00:00:00Z" })));
    linearStore.applySync(sync({ issues: [cleared] }));
    const now = linearStore.getState().issues.get("i-1")!;
    assert.equal(now.assigneeId, undefined);
    assert.equal(now.dueDate, undefined);
    assert.equal(now.description, "Kept");
    assert.equal("assigneeId" in now, false);
  });

  it("skips sync ticks while the page is hidden, and syncs once as it shows again", async () => {
    linearStore.applySync(sync({ cursor: "C0" }));
    answers.sync = () => sync({ cursor: "C0" });
    const doc = Object.assign(new EventTarget(), { hidden: false }) as unknown as Document & { hidden: boolean };
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      const stop = keepSynced(doc, 20_000);
      await settled();
      assert.equal(calls.length, 1, "at once");
      doc.hidden = true;
      doc.dispatchEvent(new Event("visibilitychange"));
      mock.timers.tick(60_000);
      await settled();
      assert.equal(calls.length, 1, "none while hidden");
      doc.hidden = false;
      doc.dispatchEvent(new Event("visibilitychange"));
      await settled();
      assert.equal(calls.length, 2, "once as it shows");
      mock.timers.tick(20_000);
      await settled();
      assert.equal(calls.length, 3, "then every 20 s");
      stop();
      mock.timers.tick(60_000);
      doc.dispatchEvent(new Event("visibilitychange"));
      await settled();
      assert.equal(calls.length, 3, "stopped");
    } finally {
      mock.timers.reset();
    }
  });

  it("after a complete load, asks by id for issues that left the scope unseen, and drops those Linear no longer lists", async () => {
    linearStore.setWorkspace(WS);
    // Seen earlier as assigned to you; since then 2 was reassigned and 3 archived, unseen.
    linearStore.mergeIssues([issue(1, { assigneeId: ME }), issue(2, { assigneeId: ME }), issue(3, { assigneeId: ME })]);
    answers.issues = () => ({ issues: [issue(1, { assigneeId: ME })] });
    answers.byId = () => ({ issues: [issue(2, { assigneeId: "someone", updatedAt: "2026-10-05T00:00:00Z" })] });
    await loadScope("assigned", true);
    assert.deepEqual(calls, ["linear/q/issues?scope=assigned", "linear/q/byId?ids=i-2%2Ci-3"]);
    const d = linearStore.getState();
    assert.deepEqual(scopeIssues(d, "assigned").map((i) => i.key), ["ENG-1"]);
    assert.equal(d.issues.get("i-2")?.assigneeId, "someone", "kept, where it now belongs");
    assert.equal(d.issues.has("i-3"), false);
    assert.equal(d.byKey.has("ENG-3"), false);
    // Nothing left over: no request by id.
    calls.length = 0;
    await loadScope("assigned", true);
    assert.deepEqual(calls, ["linear/q/issues?scope=assigned"]);
  });

  it("keeps leftovers when Linear can't be asked about them", async () => {
    linearStore.setWorkspace(WS);
    linearStore.mergeIssues([issue(1, { assigneeId: ME }), issue(2, { assigneeId: ME })]);
    answers.issues = () => ({ issues: [issue(1, { assigneeId: ME })] });
    answers.byId = () => ({ available: false, reason: "limited", retryAt: Date.now() + 60_000 });
    await loadScope("assigned", true);
    assert.equal(linearStore.getState().issues.has("i-2"), true);
  });

  it("stops at 1,000 issues, notes the scope as capped, and asks nothing by id", async () => {
    linearStore.setWorkspace(WS);
    linearStore.mergeIssues([issue(5000, { assigneeId: ME })]);
    let page = 0;
    answers.issues = () => {
      const from = page++ * 250;
      return { issues: Array.from({ length: 250 }, (_, n) => issue(from + n, { assigneeId: ME })), next: `p${page}` };
    };
    await loadScope("assigned");
    assert.equal(calls.length, 4);
    assert.ok(linearStore.getState().cappedScopes.has("assigned"));
    assert.equal(linearStore.getState().issues.has("i-5000"), true);
    // Complete again: no longer capped (and what it left out is asked about).
    answers.issues = () => ({ issues: [] });
    answers.byId = () => ({ issues: [] });
    await loadScope("assigned", true);
    assert.equal(linearStore.getState().cappedScopes.has("assigned"), false);
  });

  it("a sync's reload asks for the open issue and its comments too", async () => {
    answers.workspace = () => WS;
    answers.issue = () => ({ issue: issue(1, { description: "Fresh" }), comments: [], children: [] });
    await loadWorkspace();
    linearStore.setOpenIssue("ENG-1");
    answers.sync = () => sync({ cursor: "C2", more: true });
    await syncTick(Date.now());
    assert.ok(calls.includes("linear/q/issue?key=ENG-1"));
    assert.equal(linearStore.getState().issues.get("i-1")?.description, "Fresh");
  });

  it("retries a scope whose first load was refused as limited, once the pause has passed", async () => {
    linearStore.setWorkspace(WS);
    const retryAt = Date.now() + 60_000;
    answers.issues = () => ({ available: false, reason: "limited", retryAt });
    answers.sync = () => sync();
    await loadScope("assigned");
    assert.equal(linearStore.getState().loadedScopes.has("assigned"), false);
    answers.issues = () => ({ issues: [issue(1, { assigneeId: ME })] });
    await syncTick(retryAt - 1);
    assert.equal(calls.length, 1, "not before");
    await syncTick(retryAt + 1);
    assert.ok(linearStore.getState().loadedScopes.has("assigned"));
    assert.equal(calls.filter((c) => c.startsWith("linear/q/issues")).length, 2);
    // Loaded now: not asked again.
    await syncTick(retryAt + 2);
    assert.equal(calls.filter((c) => c.startsWith("linear/q/issues")).length, 2);
  });

  it("a read begun before a subscription was saved doesn't undo it (Linear keeps updatedAt)", async () => {
    linearStore.setWorkspace(WS);
    linearStore.mergeIssues([issue(1)]);
    const read = held<unknown>();
    answers.issue = () => read.promise;
    const loading = loadIssue("ENG-1");
    await settled();
    answers["linear/m/issueSubscribe"] = () => ({ issue: issue(1, { subscriberIds: [ME] }) });
    assert.equal(
      await linearStore.write("issueSubscribe", { id: "i-1" }, { issueId: "i-1", patch: { subscriberIds: [ME] } }),
      true,
    );
    // The read answers from before the write, with the same updatedAt.
    read.release({ issue: issue(1, { subscriberIds: [], title: "Read" }), comments: [], children: [] });
    await loading;
    assert.deepEqual(linearStore.getState().issues.get("i-1")?.subscriberIds, [ME]);
    assert.equal(linearStore.getState().issues.get("i-1")?.title, "Read");
    // A read begun after it says what Linear has (unsubscribed elsewhere, say).
    answers.issue = () => ({ issue: issue(1, { subscriberIds: [] }), comments: [], children: [] });
    await loadIssue("ENG-1");
    assert.deepEqual(linearStore.getState().issues.get("i-1")?.subscriberIds, []);
  });

  it("a list row without the description doesn't count as Linear clearing it", async () => {
    linearStore.mergeIssues([issue(1, { description: "Body" })]);
    const answer = held<unknown>();
    answers["linear/m/issueUpdate"] = () => answer.promise;
    const done = linearStore.write(
      "issueUpdate",
      { id: "i-1", description: "Edited" },
      { issueId: "i-1", patch: { description: "Edited" } },
    );
    // A list row (no description) arrives meanwhile.
    linearStore.mergeIssues([JSON.parse(JSON.stringify(issue(1, { title: "Listed", updatedAt: "2026-10-02T00:00:00Z" })))]);
    answer.refuse(new Error("Not allowed"));
    assert.equal(await done, false);
    assert.equal(linearStore.getState().issues.get("i-1")?.description, "Body");
    assert.equal(linearStore.getState().issues.get("i-1")?.title, "Listed");
  });
});
