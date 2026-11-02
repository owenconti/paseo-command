import assert from "node:assert/strict";
import { test } from "node:test";
import { actionKey, actionLabel, blockers, mergeActions, mergeMethodFor, rememberMergeMethod } from "./merge";
import type { PrDetail, PrMerge } from "./types";

const merge = (m: Partial<PrMerge> = {}): PrMerge => ({
  status: "clean",
  methods: ["merge", "squash", "rebase"],
  canMerge: true,
  canMergeAsAdmin: false,
  canUpdate: true,
  canClose: true,
  canReopen: true,
  canUpdateBranch: true,
  autoMergeAllowed: true,
  canEnableAutoMerge: true,
  canDisableAutoMerge: true,
  autoMerge: null,
  queueRequired: false,
  queue: null,
  deleteBranchOnMerge: false,
  headBranchExists: true,
  canDeleteBranch: true,
  messages: {},
  ...m,
});
const pr = (o: Partial<PrDetail> = {}, m: Partial<PrMerge> = {}): PrDetail =>
  ({ repo: "o/r", number: 1, state: "open", headRef: "feat", mergeable: "mergeable", reviewDecision: null, checkRuns: [], ...o, merge: merge(m) }) as PrDetail;
const kinds = (p: PrDetail) => mergeActions(p, "squash").map(actionKey);

test("a clean PR merges, with the method chosen; it can also go back to a draft or close", () => {
  assert.deepEqual(kinds(pr()), ["merge:squash", "draft", "close"]);
  assert.deepEqual(blockers(pr()), []);
});

test("blocked: each reason, and auto-merge offered instead of a merge", () => {
  const p = pr({ reviewDecision: "review", checkRuns: [{ name: "ci", state: "pending" }] }, { status: "blocked" });
  assert.deepEqual(
    blockers(p).map((b) => [b.key, b.level]),
    [
      ["review", "block"],
      ["checks-pending", "block"],
    ],
  );
  assert.deepEqual(kinds(p), ["auto:squash", "draft", "close"]);
  // Nothing known: the base branch's rules.
  assert.deepEqual(blockers(pr({}, { status: "blocked" })).map((b) => b.key), ["rules"]);
  // An administrator may merge past them.
  assert.ok(kinds(pr({}, { status: "blocked", canMergeAsAdmin: true })).includes("merge:squash"));
});

test("conflicts, behind and draft say so; behind offers updating the branch both ways", () => {
  assert.deepEqual(blockers(pr({ mergeable: "conflicting" }, { status: "dirty" })).map((b) => b.key), ["conflicts"]);
  assert.ok(!kinds(pr({ mergeable: "conflicting" }, { status: "dirty" })).some((k) => k.startsWith("auto") || k.startsWith("merge")));
  const behind = pr({}, { status: "behind" });
  assert.deepEqual(blockers(behind).map((b) => b.key), ["behind"]);
  assert.deepEqual(kinds(behind), ["auto:squash", "update:merge", "update:rebase", "draft", "close"]);
  const draft = pr({ state: "draft" }, { status: "draft" });
  assert.deepEqual(blockers(draft).map((b) => b.key), ["draft"]);
  assert.deepEqual(kinds(draft), ["ready", "close"]);
});

test("unstable: failing checks that aren't required warn without blocking", () => {
  const p = pr({ checkRuns: [{ name: "lint", state: "failing" }] }, { status: "unstable" });
  assert.deepEqual(blockers(p).map((b) => b.level), ["warn"]);
  assert.equal(kinds(p)[0], "merge:squash");
});

test("auto-merge on: disable it; a merge queue: merge when ready, then remove", () => {
  assert.deepEqual(kinds(pr({}, { status: "blocked", autoMerge: { method: "merge" } })), ["auto-off", "draft", "close"]);
  assert.deepEqual(kinds(pr({}, { queueRequired: true })), ["queue", "draft", "close"]);
  assert.deepEqual(kinds(pr({}, { queueRequired: true, queue: { state: "queued", position: 1 } })), ["dequeue", "close"]);
});

test("merged or closed: reopen a closed one, delete the branch where the token may; nothing without permission", () => {
  assert.deepEqual(kinds(pr({ state: "merged" })), ["delete-branch"]);
  assert.deepEqual(kinds(pr({ state: "closed" })), ["reopen", "delete-branch"]);
  assert.deepEqual(kinds(pr({ state: "closed" }, { canDeleteBranch: false, canReopen: false })), []);
  assert.deepEqual(kinds(pr({}, { canMerge: false, canUpdate: false, canClose: false, canEnableAutoMerge: false })), []);
  assert.equal(actionLabel({ kind: "delete-branch" }, pr()), "Delete branch feat");
});

test("the method: the last used while still allowed, else the first allowed, never one the PR doesn't allow", () => {
  const store = new Map<string, string>();
  const was = (globalThis as { localStorage?: unknown }).localStorage;
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  try {
    // A repository allowing merge commits and squash, whose base branch's rules allow only squash (Diagonal-HQ/diagonal).
    assert.equal(mergeMethodFor("Diagonal-HQ/diagonal", ["squash"]), "squash");
    rememberMergeMethod("Diagonal-HQ/diagonal", "merge");
    assert.equal(mergeMethodFor("diagonal-hq/diagonal", ["squash"]), "squash");
    assert.equal(mergeMethodFor("diagonal-hq/diagonal", ["merge", "squash"]), "merge");
    assert.equal(mergeMethodFor("o/r", []), null);
  } finally {
    (globalThis as { localStorage?: unknown }).localStorage = was;
  }
  // A method chosen that it doesn't allow falls back to one it does; merges and auto-merge use only those.
  const squashOnly = pr({}, { methods: ["squash"] });
  assert.deepEqual(mergeActions(squashOnly, "merge").map(actionKey), ["merge:squash", "draft", "close"]);
  assert.equal(actionLabel(mergeActions(squashOnly, null)[0]!, squashOnly), "Squash and merge…");
  const blocked = pr({}, { methods: ["squash"], status: "blocked" });
  assert.deepEqual(mergeActions(blocked, "merge").map(actionKey), ["auto:squash", "draft", "close"]);
});

test("no method allowed: no merge or auto-merge, and it says why; rules unread only warn", () => {
  const none = pr({}, { methods: [], methodsNote: "The base branch’s rules allow none of the repository’s merge methods." });
  assert.deepEqual(mergeActions(none, null).map(actionKey), ["draft", "close"]);
  assert.deepEqual(blockers(none).map((b) => [b.key, b.level]), [["methods", "block"]]);
  assert.deepEqual(mergeActions(pr({}, { methods: [], status: "blocked" }), "merge").map(actionKey), ["draft", "close"]);
  const unread = pr({}, { methodsNote: "GitHub didn’t say…" });
  assert.deepEqual(blockers(unread).map((b) => [b.key, b.level]), [["methods", "warn"]]);
  assert.equal(kinds(unread)[0], "merge:squash");
});
