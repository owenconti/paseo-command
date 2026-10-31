import { useEffect, useSyncExternalStore } from "react";
import { isUnavailable, linearRead } from "./api";
import type {
  IssueScope,
  LinearComment,
  LinearInitiative,
  LinearIssue,
  LinearProject,
  LinearSync,
  LinearUnavailable,
  LinearWorkspace,
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
/** Fields with a write in flight, by entity id; merges leave them as they are. Value: when it started. */
const pending = new Map<string, Map<string, number>>();
const scopeLoads = new Map<IssueScope, Promise<void>>();
let syncing: Promise<void> | undefined;

function publish(next: Partial<LinearData>): void {
  state = { ...state, ...next };
  for (const fn of [...listeners]) fn();
}

/** Marks fields of an issue or comment as being written: merges keep their current values. */
export function markPending(id: string, fields: readonly string[]): void {
  const marks = pending.get(id) ?? new Map<string, number>();
  for (const field of fields) marks.set(field, Date.now());
  pending.set(id, marks);
}

/** The write finished (or failed): merges may set these fields again. */
export function clearPending(id: string, fields: readonly string[]): void {
  const marks = pending.get(id);
  if (!marks) return;
  for (const field of fields) marks.delete(field);
  if (marks.size === 0) pending.delete(id);
}

/** The incoming record over the known one, keeping pending fields and detail fields the incoming one lacks. */
function mergeRecord<T extends { id: string }>(known: T | undefined, incoming: T, details: readonly string[] = []): T {
  if (!known) return incoming;
  const merged = { ...known, ...incoming } as Record<string, unknown>;
  const was = known as Record<string, unknown>;
  const now = incoming as Record<string, unknown>;
  for (const field of details) if (now[field] === undefined && was[field] !== undefined) merged[field] = was[field];
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
    issues.set(incoming.id, mergeRecord(known, incoming, DETAIL_FIELDS));
    byKey.set(incoming.key, incoming.id);
  }
  publish({ issues, byKey });
}

function mergeComments(list: LinearComment[]): void {
  if (list.length === 0) return;
  const comments = new Map(state.comments);
  for (const incoming of list) {
    if ((incoming as { archivedAt?: string }).archivedAt) comments.delete(incoming.id);
    else comments.set(incoming.id, mergeRecord(comments.get(incoming.id), incoming));
  }
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
  applySync,
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

/** Loads a scope's issues, paging up to 1,000; a scope already loaded (or loading) is not asked again. */
export function loadScope(scope: IssueScope): Promise<void> {
  if (state.loadedScopes.has(scope)) return Promise.resolve();
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
