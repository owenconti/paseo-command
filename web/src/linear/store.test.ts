import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { FAKE_IDS } from "../../server/linear/fake";
import { setLinearTransport } from "./api";
import {
  clearPending,
  linearStore,
  loadScope,
  loadWorkspace,
  markPending,
  scopeIssues,
  setLinearNotice,
  syncTick,
} from "./store";
import type { LinearIssue, LinearState, LinearSync, LinearWorkspace } from "./types";

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
afterEach(() => setLinearTransport(null));

/** A write's answer the test releases by hand, to look at the store while it's in flight. */
function held<T>() {
  let release!: (value: T) => void;
  let refuse!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    release = resolve;
    refuse = reject;
  });
  return { promise, release, refuse };
}

describe("linear store", () => {
  it("scopes follow the store", () => {
    linearStore.setWorkspace(WS);
    linearStore.mergeIssues([issue(1, { assigneeId: ME })]);
    assert.deepEqual(scopeIssues(linearStore.getState(), "assigned").map((i) => i.key), ["ENG-1"]);
    linearStore.mergeIssues([issue(1, { assigneeId: ME, stateId: DONE.id, updatedAt: "2026-10-02T00:00:00Z" })]);
    assert.deepEqual(scopeIssues(linearStore.getState(), "assigned"), []);
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
    linearStore.mergeIssues([issue(1, { description: "Body", childIds: ["i-2"], relations: [], links: [] })]);
    linearStore.mergeIssues([issue(1, { title: "From a list" })]);
    linearStore.applySync(sync({ issues: [issue(1, { title: "From sync" })] }));
    const got = linearStore.getState().issues.get("i-1")!;
    assert.equal(got.title, "From sync");
    assert.equal(got.description, "Body");
    assert.deepEqual(got.childIds, ["i-2"]);
    assert.deepEqual(got.relations, []);
    assert.deepEqual(got.links, []);
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
});
