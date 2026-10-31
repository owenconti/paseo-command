import { useEffect, useSyncExternalStore } from "react";
import { errorMessage } from "../api";
import { isUnavailable, linearRead, linearWrite } from "./api";
import type {
  IssueScope,
  LinearComment,
  LinearCustomView,
  LinearCycle,
  LinearInitiative,
  LinearIssue,
  LinearNotification,
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
  /** Loaded scopes that stopped at 1,000 issues (the most recently updated). */
  cappedScopes: Set<IssueScope>;
  /** Set while Linear can't be asked (no key, refused, rate limited); cleared by the next answer. */
  unavailable?: LinearUnavailable;
  /** Where the next sync starts: the newest cursor a sync returned. */
  cursor?: string;
  /** Each team's cycles with their progress (`q/cycles`), by team id, newest first. */
  cycles: Map<string, LinearCycle[]>;
  /** The issue views you can see (`q/views`), once loaded. */
  views?: LinearCustomView[];
  /**
   * The issues of scopes the store can't tell by itself (a view's own filter),
   * by id in Linear's order, as their last load returned them.
   */
  members: Map<IssueScope, string[]>;
  /** Your Inbox's notifications (not archived), by id, once loaded (`notificationsLoaded`). */
  notifications: Map<string, LinearNotification>;
  notificationsLoaded: boolean;
};

const SYNC_EVERY_MS = 20_000;
const MAX_SCOPE_ISSUES = 1000;
/** Issues asked for by id in one request, and at most after a scope's load (see `recheckLeftovers`). */
const BY_ID_BATCH = 50;
const MAX_RECHECK = 100;
/** The fields only an issue's details carry; a list or sync record without them must not erase them. */
const DETAIL_FIELDS = ["description", "childIds", "relations", "links"] as const;

function empty(): LinearData {
  return {
    issues: new Map(),
    byKey: new Map(),
    comments: new Map(),
    loadedScopes: new Set(),
    cappedScopes: new Set(),
    cycles: new Map(),
    members: new Map(),
    notifications: new Map(),
    notificationsLoaded: false,
  };
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
/** The scope whose load Linear refused for a while (`retryAt`): the first sync tick after then asks again. */
let retryScope: IssueScope | undefined;
/** The issue open in the view, by key: a reload asks for it (and its comments) too. */
let openKey: string | undefined;
/** The scope the view shows: a view's is loaded again when a sync brings changed issues. */
let shownScope: IssueScope | undefined;
/**
 * Orders reads against saved writes: a read takes a tick when it starts, a
 * saved write a tick per field (`written`). A read that started before the
 * write was saved must not undo it with an older answer of the same
 * `updatedAt` (Linear doesn't move it for every write: subscribing doesn't).
 */
let clock = 0;
const written = new Map<string, Map<string, number>>();

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
function mergeRecord<T extends { id: string }>(
  known: T | undefined,
  incoming: T,
  details: readonly string[] = [],
  keep: readonly string[] = [],
): T {
  if (!known) return incoming;
  const merged = { ...incoming } as Record<string, unknown>;
  const was = known as Record<string, unknown>;
  for (const field of details) if (merged[field] === undefined && was[field] !== undefined) merged[field] = was[field];
  for (const field of [...(pending.get(incoming.id)?.keys() ?? []), ...keep]) {
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

/** The fields of a saved write that a read started at `readAt` (before the save) must leave alone; forgets older saves. */
function savedSince(id: string, readAt: number | undefined): string[] {
  const marks = written.get(id);
  if (readAt === undefined || !marks) return [];
  const keep: string[] = [];
  for (const [field, at] of marks) {
    if (at > readAt) keep.push(field);
    else marks.delete(field);
  }
  if (marks.size === 0) written.delete(id);
  return keep;
}

/**
 * Merges issues Linear sent. `readAt` is when the read that brought them
 * started (`clock`): fields a write saved since keep the saved value unless
 * the record is newer than the one the page has.
 */
function mergeIssues(list: LinearIssue[], readAt?: number): void {
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
    const newer = !known || Date.parse(incoming.updatedAt) > Date.parse(known.updatedAt);
    const keep = newer ? [] : savedSince(incoming.id, readAt);
    // What Linear has for a field being edited: a refused edit goes back to it.
    // A list or sync record lacks the detail fields: that says nothing of them.
    const kept = confirmed.get(incoming.id);
    const record = incoming as unknown as Record<string, unknown>;
    for (const field of pending.get(incoming.id)?.keys() ?? []) {
      if (keep.includes(field)) continue;
      if (record[field] === undefined && (DETAIL_FIELDS as readonly string[]).includes(field)) continue;
      kept?.set(field, record[field]);
    }
    issues.set(incoming.id, mergeRecord(known, incoming, DETAIL_FIELDS, keep));
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
      // Saved: a read already under way may still carry the value from before.
      const saved = written.get(id!) ?? new Map<string, number>();
      for (const field of fields) saved.set(field, ++clock);
      written.set(id!, saved);
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

/**
 * Creates an issue (the Create issue dialog); the new issue joins the store.
 * Answers it, or Linear's reason for refusing (no notice: the dialog says it).
 */
async function createIssue(input: Record<string, unknown>): Promise<{ issue: LinearIssue } | { error: string }> {
  try {
    const answer = await linearWrite<{ issue?: LinearIssue }>("issueCreate", input);
    if (!answer?.issue) return { error: "Linear didn't return the new issue." };
    mergeIssues([answer.issue]);
    return { issue: answer.issue };
  } catch (e) {
    return { error: errorMessage(e) || "it didn't answer" };
  }
}

/** An issue Linear deleted (moved to its trash): it leaves every list, and other issues' sub-issues and relations. */
function removeIssue(id: string): void {
  const known = state.issues.get(id);
  if (!known) return;
  const issues = new Map(state.issues);
  issues.delete(id);
  for (const [otherId, other] of issues) {
    const childIds = other.childIds?.filter((c) => c !== id);
    const relations = other.relations?.filter((r) => r.issueId !== id);
    if (childIds?.length !== other.childIds?.length || relations?.length !== other.relations?.length)
      issues.set(otherId, { ...other, childIds, relations });
  }
  const byKey = new Map(state.byKey);
  if (byKey.get(known.key) === id) byKey.delete(known.key);
  publish({ issues, byKey });
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

/** Notifications with a write in flight: merges leave them as the write shows them. */
const pendingNotifications = new Map<string, number>();

/** Notifications Linear sent: archived ones leave the Inbox; the rest take their place (unless a write is in flight). */
function mergeNotifications(list: LinearNotification[] = [], force = false): void {
  if (list.length === 0) return;
  const notifications = new Map(state.notifications);
  for (const n of list) {
    if (!force && pendingNotifications.has(n.id)) continue;
    if (n.archivedAt) notifications.delete(n.id);
    else notifications.set(n.id, n);
  }
  publish({ notifications });
}

/**
 * A write on notifications (read, unread, snooze, unsnooze, archive, unarchive):
 * `ids` show `patch` at once (archived ones leave), then Linear's answer; if
 * Linear refuses, they go back as they were and the notice says why.
 */
async function writeNotifications(
  name: WriteName,
  input: Record<string, unknown>,
  ids: string[],
  patch: Partial<LinearNotification>,
): Promise<boolean> {
  const before = ids.map((id) => state.notifications.get(id)).filter((n): n is LinearNotification => !!n);
  const mark = ++lastMark;
  for (const id of ids) pendingNotifications.set(id, mark);
  mergeNotifications(
    before.map((n) => {
      const next = { ...n, ...patch } as Record<string, unknown>;
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      return next as LinearNotification;
    }),
    true,
  );
  const settle = () => {
    for (const id of ids) if (pendingNotifications.get(id) === mark) pendingNotifications.delete(id);
  };
  try {
    const answer = await linearWrite<{ notifications?: LinearNotification[] }>(name, input);
    settle();
    mergeNotifications(answer?.notifications ?? []);
    return true;
  } catch (e) {
    settle();
    // Back as Linear has them (an archived one comes back too).
    mergeNotifications(before, true);
    notify(`Linear didn't save that: ${errorMessage(e) || "it didn't answer"}`);
    return false;
  }
}

function applySync(delta: LinearSync, readAt?: number): void {
  mergeIssues(delta.issues, readAt);
  mergeComments(delta.comments);
  mergeWorkspaceRows(delta.projects, delta.initiatives);
  mergeNotifications(delta.notifications);
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
  writeNotifications,
  mergeNotifications,
  createIssue,
  removeIssue,
  setWorkspace(workspace: LinearWorkspace): void {
    publish({ workspace: { ...workspace }, unavailable: undefined });
  },
  setUnavailable(unavailable: LinearUnavailable | undefined): void {
    publish({ unavailable });
  },
  /** The issue open in the view (a reload asks for it again), or undefined. */
  setOpenIssue(key: string | undefined): void {
    openKey = key;
  },
  /** The scope the view shows (a view's is reloaded when issues change), or undefined. */
  setShownScope(scope: IssueScope | undefined): void {
    shownScope = scope;
  },
  /** Back to empty (tests). */
  reset(): void {
    state = empty();
    loadStartedAt = undefined;
    pending.clear();
    confirmed.clear();
    writeQueues.clear();
    scopeLoads.clear();
    cycleLoads.clear();
    written.clear();
    syncing = undefined;
    retryScope = undefined;
    openKey = undefined;
    shownScope = undefined;
    viewsLoad = undefined;
    searchedAt.clear();
    notificationsLoad = undefined;
    pendingNotifications.clear();
    for (const fn of [...listeners]) fn();
  },
};

/** Select from the store; the component redraws when the selected value changes. */
export function useLinear<T>(select: (d: LinearData) => T): T {
  return useSyncExternalStore(linearStore.subscribe, () => select(linearStore.getState()));
}

/** Scopes whose issues are what Linear last returned for them, not a predicate the store can apply: a view's, a search's. */
export const listedScope = (scope: IssueScope) => scope.startsWith("view:") || scope.startsWith("search:");

/**
 * The scope as a predicate over the store, so an edit moves an issue between
 * lists at once; a view's issues are those its last load returned (Linear
 * applies its filter), in that order. Archived issues are never in it.
 */
export function scopeIssues(d: LinearData, scope: IssueScope): LinearIssue[] {
  if (listedScope(scope))
    return (d.members.get(scope) ?? [])
      .map((id) => d.issues.get(id))
      .filter((i): i is LinearIssue => !!i && !i.archivedAt);
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
  else if (scope.startsWith("cycle:")) keep = (i) => i.cycleId === scope.slice("cycle:".length);
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

let notificationsLoad: Promise<void> | undefined;

/** Loads your Inbox; asked once unless `fresh` (sync keeps it current after). */
export function loadNotifications(fresh = false): Promise<void> {
  if (!fresh && state.notificationsLoaded) return Promise.resolve();
  notificationsLoad ??= (async () => {
    noteLoadStart();
    const answer = await linearRead<{ notifications: LinearNotification[] }>("notifications");
    if (!accept(answer)) return;
    // Those with a write in flight keep what it shows.
    const notifications = new Map(
      answer.notifications.map((n) => [n.id, pendingNotifications.has(n.id) ? state.notifications.get(n.id) ?? n : n]),
    );
    publish({ notifications, notificationsLoaded: true });
  })().finally(() => {
    notificationsLoad = undefined;
  });
  return notificationsLoad;
}

/** A search's scope: its term, trimmed. */
export const searchScope = (term: string): IssueScope => `search:${term.trim()}`;

/**
 * Searches the whole workspace (`q/search`): the issues join the store and
 * the search's scope lists them, most relevant first. A term asked in the
 * last minute isn't asked again unless `fresh`. Answers why Linear didn't
 * (searching too fast, no key…) without pausing the rest of the tab.
 */
export async function loadSearch(term: string, fresh = false): Promise<{ error?: string }> {
  const scope = searchScope(term);
  const known = searchedAt.get(scope);
  if (!fresh && known !== undefined && Date.now() - known < 60_000) return {};
  const at = ++clock;
  let answer: { issues: LinearIssue[] } | LinearUnavailable;
  try {
    answer = await linearRead<{ issues: LinearIssue[] }>("search", { term: term.trim() });
  } catch (e) {
    return { error: errorMessage(e) || "Linear didn't answer." };
  }
  if (isUnavailable(answer)) return { error: answer.reason };
  searchedAt.set(scope, Date.now());
  mergeIssues(answer.issues, at);
  publish({ members: new Map(state.members).set(scope, answer.issues.map((i) => i.id)) });
  return {};
}
const searchedAt = new Map<IssueScope, number>();

let viewsLoad: Promise<void> | undefined;

/** Loads the issue views you can see; asked once unless `fresh`. */
export function loadViews(fresh = false): Promise<void> {
  if (!fresh && state.views) return Promise.resolve();
  viewsLoad ??= linearRead<{ views: LinearCustomView[] }>("views")
    .then((answer) => {
      if (accept(answer)) publish({ views: answer.views });
    })
    .finally(() => {
      viewsLoad = undefined;
    });
  return viewsLoad;
}

const cycleLoads = new Map<string, Promise<void>>();

/** Loads a team's cycles with their progress; a team already loaded (or loading) isn't asked again unless `fresh`. */
export function loadCycles(teamId: string, fresh = false): Promise<void> {
  if (!fresh && state.cycles.has(teamId)) return Promise.resolve();
  let load = cycleLoads.get(teamId);
  if (!load) {
    load = linearRead<{ cycles: LinearCycle[] }>("cycles", { team: teamId })
      .then((answer) => {
        if (accept(answer)) publish({ cycles: new Map(state.cycles).set(teamId, answer.cycles) });
      })
      .finally(() => cycleLoads.delete(teamId));
    cycleLoads.set(teamId, load);
  }
  return load;
}

/** Takes issues out of the store, leaving other issues' sub-issues and relations naming them (those ask for them again). */
function dropIssues(ids: string[]): void {
  if (ids.length === 0) return;
  const issues = new Map(state.issues);
  const byKey = new Map(state.byKey);
  for (const id of ids) {
    const known = issues.get(id);
    if (!known) continue;
    issues.delete(id);
    if (byKey.get(known.key) === id) byKey.delete(known.key);
  }
  publish({ issues, byKey });
}

const finished = (d: LinearData, issue: LinearIssue) => {
  const type = d.workspace?.states.find((s) => s.id === issue.stateId)?.type;
  return type === "completed" || type === "canceled";
};

/**
 * After a scope's complete load: the issues the store lists in it that Linear
 * didn't return have left it while unseen (reassigned, moved, closed…), or
 * gone. They're asked for by id, 50 to a request and 100 at most (the open
 * issue first), and merged, which moves them to where they now belong; those
 * Linear no longer lists (archived, deleted, out of reach), and any past the
 * hundred, leave the store, to come back with the next list that has them.
 * Asking again keeps every other list truthful, which dropping all of them
 * wouldn't; a scope's load seldom leaves more than a few. Team "All" and
 * project lists keep only what finished in the last 14 days, which the
 * store can't tell, so their finished issues aren't asked about.
 */
async function recheckLeftovers(scope: IssueScope, returned: Set<string>): Promise<void> {
  const recent = scope.startsWith("project:") || scope.endsWith(":all");
  const left = scopeIssues(state, scope)
    .filter((i) => !returned.has(i.id) && !(recent && finished(state, i)))
    .sort((a, b) => Number(b.key === openKey) - Number(a.key === openKey))
    .map((i) => i.id);
  if (left.length === 0) return;
  const asked = left.slice(0, MAX_RECHECK);
  const found = new Set<string>();
  for (let i = 0; i < asked.length; i += BY_ID_BATCH) {
    const at = ++clock;
    const answer = await linearRead<{ issues: LinearIssue[] }>("byId", { ids: asked.slice(i, i + BY_ID_BATCH).join(",") });
    // Linear can't be asked now: nothing is known of them, so they stay.
    if (!accept(answer)) return;
    mergeIssues(answer.issues, at);
    for (const issue of answer.issues) found.add(issue.id);
  }
  dropIssues(left.filter((id) => !found.has(id)));
}

async function pageScope(scope: IssueScope): Promise<void> {
  noteLoadStart();
  if (retryScope === scope) retryScope = undefined;
  let after: string | undefined;
  let count = 0;
  const returned = new Set<string>();
  do {
    const at = ++clock;
    const answer = await linearRead<{ issues: LinearIssue[]; next?: string }>(
      "issues",
      after ? { scope, after } : { scope },
    );
    if (!accept(answer)) {
      // Refused for a while (rate limited): asked again once that's passed, if it never loaded.
      if (answer.retryAt !== undefined && !state.loadedScopes.has(scope)) retryScope = scope;
      return;
    }
    mergeIssues(answer.issues, at);
    for (const issue of answer.issues) returned.add(issue.id);
    count += answer.issues.length;
    after = answer.next;
  } while (after && count < MAX_SCOPE_ISSUES);
  const capped = new Set(state.cappedScopes);
  if (after) capped.add(scope);
  else capped.delete(scope);
  // A view's issues are what Linear returned, in its order.
  const members = listedScope(scope) ? new Map(state.members).set(scope, [...returned]) : state.members;
  publish({ loadedScopes: new Set(state.loadedScopes).add(scope), cappedScopes: capped, members });
  // Only a complete load says what isn't in the scope (a view's says so itself).
  if (!after && !listedScope(scope)) await recheckLeftovers(scope, returned);
}

/** Loads a scope's issues, paging up to 1,000; a scope already loaded (or loading) is not asked again unless `fresh`. */
export function loadScope(scope: IssueScope, fresh = false): Promise<void> {
  // Another place now: a scope refused earlier isn't wanted any more.
  if (retryScope !== scope) retryScope = undefined;
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
  const at = ++clock;
  const answer = await linearRead<{ issue: LinearIssue | null; comments?: LinearComment[]; children?: LinearIssue[] }>(
    "issue",
    { key },
  );
  if (!accept(answer) || !answer.issue) return;
  mergeIssues([answer.issue, ...(answer.children ?? [])], at);
  mergeComments(answer.comments ?? []);
}

/** Everything afresh: the workspace, each loaded scope, and the open issue with its comments. */
async function reloadAll(): Promise<void> {
  await loadWorkspace(true);
  if (state.notificationsLoaded) await loadNotifications(true);
  for (const scope of [...state.loadedScopes]) await pageScope(scope);
  if (openKey) await loadIssue(openKey);
}

async function syncOnce(): Promise<void> {
  const since = state.cursor ?? loadStartedAt;
  if (!since) return;
  const at = ++clock;
  const answer = await linearRead<LinearSync>("sync", { since });
  if (!accept(answer)) return;
  applySync(answer, at);
  // More than one batch changed: reload instead of re-asking from the newer cursor, which would skip the older changes.
  if (answer.more) await reloadAll();
  // Changed issues may have joined or left the view shown, by its own filter: ask Linear again.
  else if (answer.issues.length && shownScope?.startsWith("view:") && state.loadedScopes.has(shownScope))
    await pageScope(shownScope);
}

/**
 * One sync round; nothing before the first load, while Linear is paused
 * (`retryAt` ahead) or while one is running. A scope whose load was refused
 * for that pause is asked for again too.
 */
export function syncTick(now: number = Date.now()): Promise<void> {
  if (syncing) return syncing;
  const retryAt = state.unavailable?.retryAt;
  if (retryAt !== undefined && retryAt > now) return Promise.resolve();
  const retry = retryScope && !state.loadedScopes.has(retryScope) ? loadScope(retryScope).catch(() => {}) : undefined;
  syncing = Promise.all([retry, syncOnce().catch(() => {})])
    .then(() => {})
    .finally(() => {
      syncing = undefined;
    });
  return syncing;
}

/** What `keepSynced` needs of the page: whether it's hidden, and word when that changes. */
type Visibility = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

/**
 * Syncs at once and then every `every` ms, skipping ticks while the page is
 * hidden (the window minimised or behind another), and once as it shows again.
 * Returns the stop.
 */
export function keepSynced(doc: Visibility = document, every = SYNC_EVERY_MS): () => void {
  const tick = () => {
    if (!doc.hidden) void syncTick();
  };
  tick();
  const timer = setInterval(tick, every);
  doc.addEventListener("visibilitychange", tick);
  return () => {
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", tick);
  };
}

/** While `active` (Linear shows) and the page isn't hidden, keeps the store current: a sync at once, then every 20 s. */
export function useLinearSync(active: boolean): void {
  useEffect(() => (active ? keepSynced() : undefined), [active]);
}
