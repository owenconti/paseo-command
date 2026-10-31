import { useEffect, useSyncExternalStore } from "react";
import { errorMessage } from "../api";
import { isUnavailable, linearRead, linearWrite } from "./api";
import type {
  IssueScope,
  LinearComment,
  LinearInitiative,
  LinearIssue,
  LinearProject,
  LinearSync,
  LinearUnavailable,
  LinearWorkspace,
  WriteName,
} from "./types";

/** Everything the Linear view knows, in one place; a screen selects what it shows. */
export type LinearData = {
  workspace?: LinearWorkspace;
  issues: Map<string, LinearIssue>;
  /** Issue key (ENG-1) to its id. */
  byKey: Map<string, string>;
  comments: Map<string, LinearComment>;
  loadedScopes: Set<IssueScope>;
  /** Set while Linear can't be asked (no key, refused, rate limited); cleared by the next answer. */
  unavailable?: LinearUnavailable;
  /** Where the next sync starts: the newest cursor a sync returned. */
  cursor?: string;
};

const SYNC_EVERY_MS = 20_000;
const MAX_SCOPE_ISSUES = 1000;
/** The fields only an issue's details carry; a list or sync record without them must not erase them. */
const DETAIL_FIELDS = ["description", "childIds", "relations", "links"] as const;

function empty(): LinearData {
  return { issues: new Map(), byKey: new Map(), comments: new Map(), loadedScopes: new Set() };
}

let state = empty();
/** When the first load began: the first sync starts there, so nothing between load and sync is missed. */
let loadStartedAt: string | undefined;
const listeners = new Set<() => void>();
/** Fields with a write in flight, by entity id; merges leave them as they are. Value: when it started (unique, rising). */
const pending = new Map<string, Map<string, number>>();
let lastMark = 0;
/**
 * For an issue's fields with an edit in flight: the value Linear last had, as
 * far as the page knows (before the first edit, then each saved edit or newer
 * sync). A refused edit goes back to it once no other edit of the field is pending.
 */
const confirmed = new Map<string, Map<string, unknown>>();
/** Each issue's writes, one after another: the last choice is the last one Linear applies. */
const writeQueues = new Map<string, Promise<unknown>>();
/** Says why a write didn't happen (the Linear view sets it to the app's notice). */
let notify: (message: string) => void = () => {};
const scopeLoads = new Map<IssueScope, Promise<void>>();
let syncing: Promise<void> | undefined;

function publish(next: Partial<LinearData>): void {
  state = { ...state, ...next };
  for (const fn of [...listeners]) fn();
}

/** Marks fields of an issue or comment as being written: merges keep their current values. */
export function markPending(id: string, fields: readonly string[]): void {
  const marks = pending.get(id) ?? new Map<string, number>();
  lastMark = Math.max(Date.now(), lastMark + 1);
  for (const field of fields) marks.set(field, lastMark);
  pending.set(id, marks);
}

/** The write finished (or failed): merges may set these fields again. */
export function clearPending(id: string, fields: readonly string[]): void {
  const marks = pending.get(id);
  if (!marks) return;
  for (const field of fields) marks.delete(field);
  if (marks.size === 0) pending.delete(id);
}

/** Clears the fields this write marked, leaving any a later write of the same field marked since. */
function clearOwnPending(id: string, fields: readonly string[], mark: number): void {
  const marks = pending.get(id);
  clearPending(id, fields.filter((field) => marks?.get(field) === mark));
}

/** Where the Linear view says a write failed. */
export function setLinearNotice(fn: (message: string) => void): void {
  notify = fn;
}

/**
 * The incoming record in the known one's place. A record always comes whole,
 * and JSON drops a field Linear cleared (an assignee, a due date), so nothing
 * of the known one is kept but detail fields the incoming one lacks and fields
 * with a write pending.
 */
function mergeRecord<T extends { id: string }>(known: T | undefined, incoming: T, details: readonly string[] = []): T {
  if (!known) return incoming;
  const merged = { ...incoming } as Record<string, unknown>;
  const was = known as Record<string, unknown>;
  for (const field of details) if (merged[field] === undefined && was[field] !== undefined) merged[field] = was[field];
  for (const field of pending.get(incoming.id)?.keys() ?? []) {
    if (field in was) merged[field] = was[field];
    else delete merged[field];
  }
  return merged as T;
}

function upsertById<T extends { id: string }>(list: T[], incoming: T[]): T[] {
  const byId = new Map(list.map((row) => [row.id, row]));
  for (const row of incoming) byId.set(row.id, mergeRecord(byId.get(row.id), row));
  return [...byId.values()];
}

function removeById<T extends { id: string }>(list: T[], ids: Set<string>): T[] {
  return list.filter((row) => !ids.has(row.id));
}

function mergeIssues(list: LinearIssue[]): void {
  if (list.length === 0) return;
  const issues = new Map(state.issues);
  const byKey = new Map(state.byKey);
  for (const incoming of list) {
    const known = issues.get(incoming.id);
    if (incoming.archivedAt) {
      issues.delete(incoming.id);
      byKey.delete(known?.key ?? incoming.key);
      continue;
    }
    // A page fetched before a newer sync must not roll the issue back.
    if (known && Date.parse(incoming.updatedAt) < Date.parse(known.updatedAt)) continue;
    // What Linear has for a field being edited: a refused edit goes back to it.
    const kept = confirmed.get(incoming.id);
    for (const field of pending.get(incoming.id)?.keys() ?? [])
      kept?.set(field, (incoming as unknown as Record<string, unknown>)[field]);
    issues.set(incoming.id, mergeRecord(known, incoming, DETAIL_FIELDS));
    byKey.set(incoming.key, incoming.id);
  }
  publish({ issues, byKey });
}

/**
 * Sets exactly these fields of a known issue (undefined removes one), whatever
 * its updatedAt: an optimistic edit and its rollback, which `mergeIssues`'s
 * stale-record guard must not skip.
 */
function patchIssue(id: string, fields: Partial<LinearIssue>): void {
  const known = state.issues.get(id);
  if (!known) return;
  const next = { ...known } as Record<string, unknown>;
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) delete next[field];
    else next[field] = value;
  }
  publish({ issues: new Map(state.issues).set(id, next as LinearIssue) });
}

/** Forgets the confirmed values of an issue's fields that no edit is pending on any more. */
function settle(id: string): void {
  const kept = confirmed.get(id);
  if (!kept) return;
  const marks = pending.get(id);
  for (const field of [...kept.keys()]) if (!marks?.has(field)) kept.delete(field);
  if (kept.size === 0) confirmed.delete(id);
}

/**
 * One whitelisted write. With `optimistic`, the issue shows `patch` at once and
 * syncs leave those fields alone until Linear answers; Linear's answer then
 * takes their place. An issue's writes are sent one after another, in the
 * order they were made. When Linear refuses, the fields go back to what Linear
 * last had (unless a later edit of them is still pending) and the notice says why.
 */
async function write(
  name: WriteName,
  input: Record<string, unknown>,
  optimistic?: { issueId: string; patch: Partial<LinearIssue> },
): Promise<boolean> {
  const id = optimistic?.issueId;
  const fields = optimistic ? Object.keys(optimistic.patch) : [];
  const known = id ? (state.issues.get(id) as Record<string, unknown> | undefined) : undefined;
  let mark = 0;
  if (id && known) {
    // The first edit of a field in flight notes what Linear has for it.
    const kept = confirmed.get(id) ?? new Map<string, unknown>();
    for (const field of fields) if (!pending.get(id)?.has(field)) kept.set(field, known[field]);
    confirmed.set(id, kept);
    patchIssue(id, optimistic!.patch);
    markPending(id, fields);
    mark = lastMark;
  }
  const previous = (id && writeQueues.get(id)) || Promise.resolve();
  const request = previous.then(() => linearWrite<{ issue?: LinearIssue; comment?: LinearComment }>(name, input));
  const queued = request.catch(() => {});
  if (id) writeQueues.set(id, queued);
  try {
    const answer = await request;
    if (mark) {
      const kept = confirmed.get(id!);
      for (const field of fields) kept?.set(field, (optimistic!.patch as Record<string, unknown>)[field]);
      clearOwnPending(id!, fields, mark);
    }
    // Linear's answer, which also updates what's confirmed for fields a later edit still holds.
    if (answer?.issue) mergeIssues([answer.issue]);
    if (answer?.comment) mergeComments([answer.comment]);
    if (mark) settle(id!);
    return true;
  } catch (e) {
    if (mark) {
      const kept = confirmed.get(id!);
      clearOwnPending(id!, fields, mark);
      // Fields a later edit still holds wait for it; the rest go back to what Linear has.
      const back = fields.filter((f) => !pending.get(id!)?.has(f) && kept?.has(f));
      patchIssue(id!, Object.fromEntries(back.map((f) => [f, kept!.get(f)])) as Partial<LinearIssue>);
      settle(id!);
    }
    notify(`Linear didn't save that: ${errorMessage(e) || "it didn't answer"}`);
    return false;
  } finally {
    if (id && writeQueues.get(id) === queued) writeQueues.delete(id);
  }
}

function mergeComments(list: LinearComment[]): void {
  if (list.length === 0) return;
  const comments = new Map(state.comments);
  for (const incoming of list) {
    if ((incoming as { archivedAt?: string }).archivedAt) {
      comments.delete(incoming.id);
      continue;
    }
    comments.set(incoming.id, mergeRecord(comments.get(incoming.id), incoming));
  }
  publish({ comments });
}

/**
 * Sets fields of a known comment at once (an optimistic reaction, or putting
 * it back); syncs leave the fields alone while `pending` is marked on them.
 */
function patchComment(id: string, fields: Partial<LinearComment>): void {
  const known = state.comments.get(id);
  if (known) publish({ comments: new Map(state.comments).set(id, { ...known, ...fields }) });
}

/** A comment Linear deleted, and its replies, which go with it. */
function removeComment(id: string): void {
  if (!state.comments.has(id)) return;
  const comments = new Map(state.comments);
  comments.delete(id);
  for (const c of state.comments.values()) if (c.parentId === id) comments.delete(c.id);
  publish({ comments });
}

function mergeWorkspaceRows(projects: LinearProject[], initiatives: LinearInitiative[]): void {
  const workspace = state.workspace;
  if (!workspace || (projects.length === 0 && initiatives.length === 0)) return;
  const gone = (rows: { id: string }[]) =>
    new Set(rows.filter((r) => (r as { archivedAt?: string }).archivedAt).map((r) => r.id));
  publish({
    workspace: {
      ...workspace,
      projects: removeById(upsertById(workspace.projects, projects), gone(projects)),
      initiatives: removeById(upsertById(workspace.initiatives, initiatives), gone(initiatives)),
    },
  });
}

function applySync(delta: LinearSync): void {
  mergeIssues(delta.issues);
  mergeComments(delta.comments);
  mergeWorkspaceRows(delta.projects, delta.initiatives);
  publish({ cursor: delta.cursor });
}

export const linearStore = {
  getState: (): LinearData => state,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  mergeIssues,
  mergeComments,
  patchComment,
  removeComment,
  applySync,
  write,
  setWorkspace(workspace: LinearWorkspace): void {
    publish({ workspace: { ...workspace }, unavailable: undefined });
  },
  setUnavailable(unavailable: LinearUnavailable | undefined): void {
    publish({ unavailable });
  },
  /** Back to empty (tests). */
  reset(): void {
    state = empty();
    loadStartedAt = undefined;
    pending.clear();
    confirmed.clear();
    writeQueues.clear();
    scopeLoads.clear();
    syncing = undefined;
    for (const fn of [...listeners]) fn();
  },
};

/** Select from the store; the component redraws when the selected value changes. */
export function useLinear<T>(select: (d: LinearData) => T): T {
  return useSyncExternalStore(linearStore.subscribe, () => select(linearStore.getState()));
}

/** The scope as a predicate over the store, so an edit moves an issue between lists at once. Archived issues are never in it. */
export function scopeIssues(d: LinearData, scope: IssueScope): LinearIssue[] {
  const stateType = (issue: LinearIssue) => d.workspace?.states.find((s) => s.id === issue.stateId)?.type;
  const open = (issue: LinearIssue) => {
    const type = stateType(issue);
    return type !== "completed" && type !== "canceled";
  };
  const viewer = d.workspace?.viewerId;
  let keep: (issue: LinearIssue) => boolean;
  if (scope === "assigned") keep = (i) => viewer !== undefined && i.assigneeId === viewer && open(i);
  else if (scope === "created") keep = (i) => viewer !== undefined && i.creatorId === viewer && open(i);
  else if (scope === "subscribed") keep = (i) => viewer !== undefined && i.subscriberIds.includes(viewer) && open(i);
  else if (scope.startsWith("project:")) keep = (i) => i.projectId === scope.slice("project:".length);
  else {
    const [, teamId, view] = scope.split(":");
    const types = { triage: ["triage"], active: ["unstarted", "started"], backlog: ["backlog"] }[view];
    keep = (i) => i.teamId === teamId && (types === undefined || types.includes(stateType(i) ?? ""));
  }
  return [...d.issues.values()].filter((i) => !i.archivedAt && keep(i));
}

/** Notes the first load's start, and whether Linear answered; true when it returned data. */
function accept<T>(answer: T | LinearUnavailable): answer is T {
  if (isUnavailable(answer)) {
    linearStore.setUnavailable(answer);
    return false;
  }
  if (state.unavailable) linearStore.setUnavailable(undefined);
  return true;
}

function noteLoadStart(): void {
  loadStartedAt ??= new Date().toISOString();
}

/** Loads the workspace (teams, states, people…); `fresh` skips the server's cache. */
export async function loadWorkspace(fresh = false): Promise<void> {
  noteLoadStart();
  const answer = await linearRead<LinearWorkspace>("workspace", fresh ? { fresh: "1" } : {});
  if (accept(answer)) linearStore.setWorkspace(answer);
}

async function pageScope(scope: IssueScope): Promise<void> {
  noteLoadStart();
  let after: string | undefined;
  let count = 0;
  do {
    const answer = await linearRead<{ issues: LinearIssue[]; next?: string }>(
      "issues",
      after ? { scope, after } : { scope },
    );
    if (!accept(answer)) return;
    mergeIssues(answer.issues);
    count += answer.issues.length;
    after = answer.next;
  } while (after && count < MAX_SCOPE_ISSUES);
  publish({ loadedScopes: new Set(state.loadedScopes).add(scope) });
}

/** Loads a scope's issues, paging up to 1,000; a scope already loaded (or loading) is not asked again unless `fresh`. */
export function loadScope(scope: IssueScope, fresh = false): Promise<void> {
  if (!fresh && state.loadedScopes.has(scope)) return Promise.resolve();
  let load = scopeLoads.get(scope);
  if (!load) {
    load = pageScope(scope).finally(() => scopeLoads.delete(scope));
    scopeLoads.set(scope, load);
  }
  return load;
}

/** Loads one issue by key with its description, comments and children. */
export async function loadIssue(key: string): Promise<void> {
  noteLoadStart();
  const answer = await linearRead<{ issue: LinearIssue | null; comments?: LinearComment[]; children?: LinearIssue[] }>(
    "issue",
    { key },
  );
  if (!accept(answer) || !answer.issue) return;
  mergeIssues([answer.issue, ...(answer.children ?? [])]);
  mergeComments(answer.comments ?? []);
}

async function reloadAll(): Promise<void> {
  await loadWorkspace(true);
  for (const scope of [...state.loadedScopes]) await pageScope(scope);
}

async function syncOnce(): Promise<void> {
  const since = state.cursor ?? loadStartedAt;
  if (!since) return;
  const answer = await linearRead<LinearSync>("sync", { since });
  if (!accept(answer)) return;
  applySync(answer);
  // More than one batch changed: reload instead of re-asking from the newer cursor, which would skip the older changes.
  if (answer.more) await reloadAll();
}

/** One sync round; nothing before the first load, while Linear is paused (`retryAt` ahead) or while one is running. */
export function syncTick(now: number = Date.now()): Promise<void> {
  if (syncing) return syncing;
  const retryAt = state.unavailable?.retryAt;
  if (retryAt !== undefined && retryAt > now) return Promise.resolve();
  syncing = syncOnce()
    .catch(() => {})
    .finally(() => {
      syncing = undefined;
    });
  return syncing;
}

/** While `active` (Linear shows), keeps the store current: a sync at once, then every 20 s. */
export function useLinearSync(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    void syncTick();
    const timer = setInterval(() => void syncTick(), SYNC_EVERY_MS);
    return () => clearInterval(timer);
  }, [active]);
}
