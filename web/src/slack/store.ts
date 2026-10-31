import { useEffect, useSyncExternalStore } from "react";
import { errorMessage } from "../api";
import { isUnavailable, openSlackEvents, parseEvent, slackRead, slackWrite, type EventStream } from "./api";
import type {
  SlackConversation,
  SlackEvent,
  SlackHistory,
  SlackLive,
  SlackMessage,
  SlackReaction,
  SlackSearch,
  SlackThread,
  SlackUnavailable,
  SlackUnreads,
  SlackUser,
  SlackWorkspace,
  SlackWriteInputs,
  SlackWriteName,
  SlackWriteResult,
} from "./types";

/** A message as the page shows it: `pending` while it's being sent (its `ts` is then a local one). */
export type ShownMessage = SlackMessage & { pending?: boolean };

/** A conversation's messages (top-level ones and those also sent to it from a thread), oldest first. */
export type MessageList = {
  messages: ShownMessage[];
  /** Older messages remain in Slack. */
  more: boolean;
  /** The newest page is in. */
  loaded: boolean;
  /** Older messages are being asked for. */
  loadingOlder?: boolean;
  /** Why the last read didn't happen. */
  error?: string;
};

/** A thread: its parent and replies, oldest first. */
export type ThreadData = {
  parent?: ShownMessage;
  replies: ShownMessage[];
  more: boolean;
  loaded: boolean;
  error?: string;
};

/** The event stream: not asked for, opening, open, or down (polling covers then). */
export type StreamState = "off" | "connecting" | "open" | "down";

/** Everything the Slack view knows, in one place; a screen selects what it shows. */
export type SlackData = {
  workspace?: SlackWorkspace;
  /** Set while Slack can't be asked (off, no token, refused, rate limited); cleared by the next answer. */
  unavailable?: SlackUnavailable;
  users: Map<string, SlackUser>;
  conversations: Map<string, SlackConversation>;
  /** Each conversation's messages, by conversation id. */
  history: Map<string, MessageList>;
  /** Threads, by `threadKey`. */
  threads: Map<string, ThreadData>;
  /** The server's read state is in (`q/unreads`, or an `unreads` event). */
  unreadsLoaded: boolean;
  /** Conversations whose read state the server is still checking. */
  unreadsPending: number;
  live?: SlackLive;
  stream: StreamState;
};

const POLL_EVERY_MS = 20_000;
/** A closed stream (the server refused it) is opened again after this long. */
const REOPEN_MS = 30_000;
/** Unread messages counted at most; past that, `unreadMore`. */
const UNREAD_CAP = 100;

export const threadKey = (conversationId: string, threadTs: string) => `${conversationId}:${threadTs}`;
const messageKey = (conversationId: string, ts: string) => `${conversationId}:${ts}`;

function empty(): SlackData {
  return {
    users: new Map(),
    conversations: new Map(),
    history: new Map(),
    threads: new Map(),
    unreadsLoaded: false,
    unreadsPending: 0,
    stream: "off",
  };
}

let state = empty();
const listeners = new Set<() => void>();
/** Says why a write didn't happen (the Slack view sets it to the app's notice). */
let notify: (message: string) => void = () => {};
/** Message fields with a write in flight, by `messageKey`: merges keep the page's values. Value: the write's mark. */
const pendingFields = new Map<string, Map<string, number>>();
let lastMark = 0;
/** Conversations with a mark (read) in flight, and where to: merges never move them back meanwhile. */
const marking = new Map<string, string>();
/** Replies already counted on their parent (an event and a thread read can bring the same one). */
const countedReplies = new Set<string>();
let localSerial = 0;
/** What shows: the open conversation and thread (polling and resync read them again). */
let open: { conversationId?: string; threadTs?: string } = {};
const historyLoads = new Map<string, Promise<void>>();
const threadLoads = new Map<string, Promise<void>>();
let unreadsLoad: Promise<void> | undefined;
let polling: Promise<void> | undefined;

function publish(next: Partial<SlackData>): void {
  state = { ...state, ...next };
  for (const fn of [...listeners]) fn();
}

/** Where the Slack view says a write failed. */
export function setSlackNotice(fn: (message: string) => void): void {
  notify = fn;
}

// ── Timestamps ───────────────────────────────────────────────────────

const isLocal = (ts: string) => ts.startsWith("local:");

/** Orders Slack timestamps ("1730000000.000100"); local (unsent) ones come last. */
export function compareTs(a: string, b: string): number {
  if (isLocal(a) || isLocal(b)) return Number(isLocal(a)) - Number(isLocal(b)) || a.localeCompare(b);
  const [as, af = "0"] = a.split(".");
  const [bs, bf = "0"] = b.split(".");
  return Number(as) - Number(bs) || Number(af.padEnd(6, "0")) - Number(bf.padEnd(6, "0"));
}
const byTs = (a: { ts: string }, b: { ts: string }) => compareTs(a.ts, b.ts);
const newer = (a: string | undefined, b: string | undefined) => (!a ? b : !b ? a : compareTs(a, b) >= 0 ? a : b);

/** Whether a message shows in its conversation (not only in its thread). */
export const inConversation = (m: Pick<SlackMessage, "ts" | "threadTs" | "subtype">) =>
  !m.threadTs || m.threadTs === m.ts || m.subtype === "thread_broadcast";
/** Whether a message is a thread's reply. */
const isReply = (m: Pick<SlackMessage, "ts" | "threadTs">) => !!m.threadTs && m.threadTs !== m.ts;

// ── Merging ──────────────────────────────────────────────────────────

/** The incoming message, but for fields with a write in flight, which keep the page's values. */
function mergeOne(known: ShownMessage | undefined, incoming: SlackMessage): ShownMessage {
  const fields = pendingFields.get(messageKey(incoming.conversationId, incoming.ts));
  if (!known || !fields) return incoming;
  const next = { ...incoming } as Record<string, unknown>;
  const was = known as Record<string, unknown>;
  for (const field of fields.keys()) {
    if (field in was) next[field] = was[field];
    else delete next[field];
  }
  return next as ShownMessage;
}

/** Messages with `incoming` merged in by ts (de-duplicated), oldest first. */
function mergeList(list: ShownMessage[], incoming: SlackMessage[]): ShownMessage[] {
  if (incoming.length === 0) return list;
  const byKey = new Map(list.map((m) => [m.ts, m]));
  for (const m of incoming) byKey.set(m.ts, mergeOne(byKey.get(m.ts), m));
  return [...byKey.values()].sort(byTs);
}

/**
 * A read of the newest messages (or a thread's replies) in place of what the
 * page had for the same span: within it, Slack's answer is what's there (a
 * message it no longer lists was deleted while unseen); older messages stay,
 * as do newer ones that arrived since the read began and unsent ones. A page
 * that doesn't reach what the page had (more came than one page) replaces it.
 */
function mergeSpan(known: ShownMessage[], incoming: SlackMessage[], more: boolean): { messages: ShownMessage[]; gap: boolean } {
  const sorted = [...incoming].sort(byTs);
  const locals = known.filter((m) => isLocal(m.ts));
  const real = known.filter((m) => !isLocal(m.ts));
  if (sorted.length === 0) return { messages: known, gap: false };
  const first = sorted[0].ts;
  const last = sorted[sorted.length - 1].ts;
  const newestKnown = real[real.length - 1]?.ts;
  if (more && newestKnown && compareTs(first, newestKnown) > 0) {
    return { messages: [...mergeList([], sorted), ...locals], gap: true };
  }
  const kept = real.filter((m) => compareTs(m.ts, first) < 0 || compareTs(m.ts, last) > 0);
  const knownByTs = new Map(real.map((m) => [m.ts, m]));
  const inSpan = sorted.map((m) => mergeOne(knownByTs.get(m.ts), m));
  return { messages: [...[...kept, ...inSpan].sort(byTs), ...locals], gap: false };
}

function setHistory(conversationId: string, patch: Partial<MessageList>): void {
  const was = state.history.get(conversationId) ?? { messages: [], more: false, loaded: false };
  publish({ history: new Map(state.history).set(conversationId, { ...was, ...patch }) });
}

function setThread(key: string, patch: Partial<ThreadData>): void {
  const was = state.threads.get(key) ?? { replies: [], more: false, loaded: false };
  publish({ threads: new Map(state.threads).set(key, { ...was, ...patch }) });
}

/** Changes a message wherever it shows (its conversation, its thread's parent or replies). */
function patchMessage(conversationId: string, ts: string, change: (m: ShownMessage) => ShownMessage): void {
  const list = state.history.get(conversationId);
  let history = state.history;
  if (list?.messages.some((m) => m.ts === ts)) {
    history = new Map(history).set(conversationId, {
      ...list,
      messages: list.messages.map((m) => (m.ts === ts ? change(m) : m)),
    });
  }
  let threads = state.threads;
  for (const [key, thread] of state.threads) {
    if (!key.startsWith(`${conversationId}:`)) continue;
    const parentHit = thread.parent?.ts === ts;
    const replyHit = thread.replies.some((m) => m.ts === ts);
    if (!parentHit && !replyHit) continue;
    if (threads === state.threads) threads = new Map(threads);
    threads.set(key, {
      ...thread,
      parent: parentHit ? change(thread.parent!) : thread.parent,
      replies: replyHit ? thread.replies.map((m) => (m.ts === ts ? change(m) : m)) : thread.replies,
    });
  }
  if (history !== state.history || threads !== state.threads) publish({ history, threads });
}

/** A message as the page knows it, wherever it shows. */
export function findMessage(d: SlackData, conversationId: string, ts: string): ShownMessage | undefined {
  const inList = d.history.get(conversationId)?.messages.find((m) => m.ts === ts);
  if (inList) return inList;
  for (const [key, thread] of d.threads) {
    if (!key.startsWith(`${conversationId}:`)) continue;
    if (thread.parent?.ts === ts) return thread.parent;
    const reply = thread.replies.find((m) => m.ts === ts);
    if (reply) return reply;
  }
  return undefined;
}

/** A message that arrived (an event, a post's answer): into its conversation and/or thread; a new reply counts on its parent. */
function addMessage(message: SlackMessage): void {
  const { conversationId } = message;
  if (inConversation(message)) {
    const list = state.history.get(conversationId);
    // A conversation not read yet has nothing to add to: its first read brings it.
    if (list?.loaded) setHistory(conversationId, { messages: mergeList(list.messages, [message]) });
  }
  if (message.threadTs) {
    const key = threadKey(conversationId, message.threadTs);
    const thread = state.threads.get(key);
    if (thread?.loaded) {
      if (isReply(message)) setThread(key, { replies: mergeList(thread.replies, [message]) });
      else setThread(key, { parent: mergeOne(thread.parent, message) });
    }
    if (isReply(message)) countReply(message);
  }
}

/** A reply the page hadn't seen: its parent's count, people and latest reply follow (until Slack's own word on the parent). */
function countReply(reply: SlackMessage): void {
  const key = messageKey(reply.conversationId, reply.ts);
  if (countedReplies.has(key)) return;
  countedReplies.add(key);
  patchMessage(reply.conversationId, reply.threadTs!, (parent) => {
    const users = parent.replyUserIds ?? [];
    return {
      ...parent,
      replyCount: (parent.replyCount ?? 0) + 1,
      latestReply: newer(parent.latestReply, reply.ts),
      replyUserIds: reply.userId && !users.includes(reply.userId) ? [...users, reply.userId] : users,
    };
  });
}

/** A message gone (deleted, or never sent): out of its conversation and threads. */
function dropMessage(conversationId: string, ts: string): void {
  const list = state.history.get(conversationId);
  let history = state.history;
  if (list?.messages.some((m) => m.ts === ts))
    history = new Map(history).set(conversationId, { ...list, messages: list.messages.filter((m) => m.ts !== ts) });
  let threads = state.threads;
  for (const [key, thread] of state.threads) {
    if (!key.startsWith(`${conversationId}:`) || !thread.replies.some((m) => m.ts === ts)) continue;
    if (threads === state.threads) threads = new Map(threads);
    threads.set(key, { ...thread, replies: thread.replies.filter((m) => m.ts !== ts) });
  }
  if (history !== state.history || threads !== state.threads) publish({ history, threads });
}

// ── Conversations and read state ─────────────────────────────────────

const READ_FIELDS = ["lastRead", "latest", "unread", "unreadMore", "mentions"] as const;

/** A conversation Slack sent, keeping the read state the page has where the incoming one doesn't say (or a mark is in flight). */
function mergeConversation(known: SlackConversation | undefined, incoming: SlackConversation): SlackConversation {
  if (!known) return incoming;
  const next = { ...incoming } as Record<string, unknown>;
  const was = known as Record<string, unknown>;
  const held = marking.has(incoming.id);
  for (const field of READ_FIELDS) if (next[field] === undefined || held) next[field] = was[field];
  for (const field of READ_FIELDS) if (next[field] === undefined) delete next[field];
  return next as SlackConversation;
}

function upsertConversations(list: SlackConversation[]): void {
  if (list.length === 0) return;
  const conversations = new Map(state.conversations);
  for (const c of list) conversations.set(c.id, mergeConversation(conversations.get(c.id), c));
  publish({ conversations });
}

function patchConversation(id: string, patch: Partial<SlackConversation>): void {
  const known = state.conversations.get(id);
  if (!known) return;
  const next = { ...known } as Record<string, unknown>;
  for (const [field, value] of Object.entries(patch)) {
    if (value === undefined) delete next[field];
    else next[field] = value;
  }
  publish({ conversations: new Map(state.conversations).set(id, next as SlackConversation) });
}

const selfId = () => state.workspace?.selfId;

/** Whether a message mentions you (by name, or @here/@channel/@everyone). */
export function mentionsYou(text: string, self: string | undefined): boolean {
  return (!!self && text.includes(`<@${self}`)) || /<!(here|channel|everyone)(\|[^>]*)?>/.test(text);
}

/**
 * Unread messages from others after `lastRead`, counted from what the page
 * has of the conversation; undefined when that doesn't reach back to `lastRead`
 * (it can't tell).
 */
function countFromHistory(c: SlackConversation, lastRead: string): Pick<SlackConversation, "unread" | "unreadMore" | "mentions"> | undefined {
  const list = state.history.get(c.id);
  if (!list?.loaded) return undefined;
  const real = list.messages.filter((m) => !isLocal(m.ts));
  const reaches = !list.more || (real[0] && compareTs(real[0].ts, lastRead) <= 0);
  if (!reaches) return undefined;
  const self = selfId();
  const unread = real.filter((m) => compareTs(m.ts, lastRead) > 0 && m.userId !== self && !m.subtype?.endsWith("_join"));
  const dm = c.kind === "im" || c.kind === "mpim";
  return {
    unread: Math.min(unread.length, UNREAD_CAP),
    unreadMore: unread.length > UNREAD_CAP,
    mentions: dm ? Math.min(unread.length, UNREAD_CAP) : unread.filter((m) => mentionsYou(m.text, self)).length,
  };
}

/** The read state once you've read to `lastRead`: nothing unread when it reaches the newest message, else counted where the page can. */
function readStateAt(c: SlackConversation, lastRead: string): Partial<SlackConversation> {
  const newest = newer(c.latest, newestTs(c.id));
  if (!newest || compareTs(lastRead, newest) >= 0) return { lastRead, unread: 0, unreadMore: false, mentions: 0 };
  return { lastRead, ...(countFromHistory(c, lastRead) ?? {}) };
}

/** The newest message the page has of a conversation. */
function newestTs(conversationId: string): string | undefined {
  const real = state.history.get(conversationId)?.messages.filter((m) => !isLocal(m.ts));
  return real?.[real.length - 1]?.ts;
}

/** A new message's effect on its conversation's read state: yours reads to it; another's is unread past `lastRead`. */
function noteArrival(message: SlackMessage): void {
  const c = state.conversations.get(message.conversationId);
  if (!c || !inConversation(message)) return;
  const latest = newer(c.latest, message.ts);
  if (message.userId && message.userId === selfId()) {
    patchConversation(c.id, { latest, ...(marking.has(c.id) ? {} : readStateAt({ ...c, latest }, newer(c.lastRead, message.ts)!)) });
    return;
  }
  const unseen = c.lastRead !== undefined && compareTs(message.ts, c.lastRead) > 0 && (!c.latest || compareTs(message.ts, c.latest) > 0);
  if (!unseen || c.unread === undefined) return patchConversation(c.id, { latest });
  const dm = c.kind === "im" || c.kind === "mpim";
  const count = c.unread + 1;
  patchConversation(c.id, {
    latest,
    unread: Math.min(count, UNREAD_CAP),
    unreadMore: c.unreadMore || count > UNREAD_CAP,
    ...(c.mentions !== undefined && (dm || mentionsYou(message.text, selfId())) ? { mentions: c.mentions + 1 } : {}),
  });
}

function mergeUnreads(u: SlackUnreads): void {
  const conversations = new Map(state.conversations);
  for (const entry of u.conversations) {
    const known = conversations.get(entry.id);
    if (!known || marking.has(entry.id)) continue;
    const next = { ...known } as Record<string, unknown>;
    for (const field of READ_FIELDS) if (entry[field] !== undefined) next[field] = entry[field];
    conversations.set(entry.id, next as SlackConversation);
  }
  publish({ conversations, unreadsLoaded: true, unreadsPending: u.pending });
}

// ── Reads ────────────────────────────────────────────────────────────

/** Notes whether Slack answered; true when it returned data. */
function accept<T>(answer: T | SlackUnavailable): answer is T {
  if (isUnavailable(answer)) {
    publish({ unavailable: answer });
    return false;
  }
  if (state.unavailable) publish({ unavailable: undefined });
  return true;
}

/** Loads the workspace (people, conversations, custom emoji, live mode); `fresh` skips the server's cache. */
export async function loadWorkspace(fresh = false): Promise<void> {
  const answer = await slackRead<SlackWorkspace>("workspace", fresh ? { fresh: "1" } : {});
  if (!accept(answer)) return;
  const conversations = new Map<string, SlackConversation>();
  for (const c of answer.conversations) conversations.set(c.id, mergeConversation(state.conversations.get(c.id), c));
  // One opened since (a DM started, one Activity opened) stays until Slack's next word.
  for (const [id, c] of state.conversations) if (!conversations.has(id)) conversations.set(id, c);
  publish({
    workspace: answer,
    users: new Map(answer.users.map((u) => [u.id, u])),
    conversations,
    live: answer.live,
  });
}

/** Loads one conversation (one not in the workspace's list: opened from Activity or a link). */
export async function loadConversation(id: string): Promise<SlackConversation | undefined> {
  const answer = await slackRead<{ conversation: SlackConversation }>("conversation", { id });
  if (!accept(answer)) return undefined;
  upsertConversations([answer.conversation]);
  return answer.conversation;
}

/** Loads a conversation's newest messages (once, unless `fresh`: then they're read again in place). */
export function loadHistory(conversationId: string, fresh = false): Promise<void> {
  if (!fresh && state.history.get(conversationId)?.loaded) return Promise.resolve();
  let load = historyLoads.get(conversationId);
  if (!load) {
    load = (async () => {
      let answer: SlackHistory | SlackUnavailable;
      try {
        answer = await slackRead<SlackHistory>("history", { conversation: conversationId });
      } catch (e) {
        setHistory(conversationId, { error: errorMessage(e) || "Slack didn't answer." });
        throw e;
      }
      if (!accept(answer)) return setHistory(conversationId, { error: answer.reason });
      const shown = answer.messages.filter(inConversation);
      const was = state.history.get(conversationId);
      if (!was?.loaded) {
        setHistory(conversationId, { messages: mergeList(was?.messages.filter((m) => isLocal(m.ts)) ?? [], shown), more: answer.more, loaded: true, error: undefined });
      } else {
        const { messages, gap } = mergeSpan(was.messages, shown, answer.more);
        const hadReal = was.messages.some((m) => !isLocal(m.ts));
        setHistory(conversationId, { messages, more: gap || !hadReal ? answer.more : was.more, loaded: true, error: undefined });
      }
      for (const m of answer.messages) if (isReply(m)) countedReplies.add(messageKey(m.conversationId, m.ts));
    })().finally(() => historyLoads.delete(conversationId));
    historyLoads.set(conversationId, load);
  }
  return load;
}

/** Loads the page of messages before the oldest the page has. */
export async function loadOlder(conversationId: string): Promise<void> {
  const list = state.history.get(conversationId);
  if (!list?.loaded || !list.more || list.loadingOlder) return;
  const oldest = list.messages.find((m) => !isLocal(m.ts))?.ts;
  if (!oldest) return;
  setHistory(conversationId, { loadingOlder: true });
  try {
    const answer = await slackRead<SlackHistory>("history", { conversation: conversationId, before: oldest });
    if (!accept(answer)) return setHistory(conversationId, { loadingOlder: false, error: answer.reason });
    const now = state.history.get(conversationId)!;
    setHistory(conversationId, {
      messages: mergeList(now.messages, answer.messages.filter(inConversation)),
      more: answer.more,
      loadingOlder: false,
      error: undefined,
    });
  } catch (e) {
    setHistory(conversationId, { loadingOlder: false, error: errorMessage(e) || "Slack didn't answer." });
  }
}

/** Loads a thread (once, unless `fresh`: then read again in place). */
export function loadThread(conversationId: string, threadTs: string, fresh = false): Promise<void> {
  const key = threadKey(conversationId, threadTs);
  if (!fresh && state.threads.get(key)?.loaded) return Promise.resolve();
  let load = threadLoads.get(key);
  if (!load) {
    load = (async () => {
      let answer: SlackThread | SlackUnavailable;
      try {
        answer = await slackRead<SlackThread>("replies", { conversation: conversationId, ts: threadTs });
      } catch (e) {
        setThread(key, { error: errorMessage(e) || "Slack didn't answer." });
        throw e;
      }
      if (!accept(answer)) return setThread(key, { error: answer.reason });
      const was = state.threads.get(key);
      const replies = answer.replies.filter((m) => m.ts !== threadTs);
      for (const r of replies) countedReplies.add(messageKey(conversationId, r.ts));
      const merged = was?.loaded ? mergeSpan(was.replies, replies, false).messages : mergeList(was?.replies ?? [], replies);
      const parent = answer.parent ? mergeOne(was?.parent, answer.parent) : was?.parent;
      setThread(key, { parent, replies: merged, more: answer.more, loaded: true, error: undefined });
      // The parent as the conversation shows it too (its reply count, people…).
      if (answer.parent) patchMessage(conversationId, threadTs, (m) => mergeOne(m, answer.parent!));
    })().finally(() => threadLoads.delete(key));
    threadLoads.set(key, load);
  }
  return load;
}

/** Loads each conversation's read state from the server's tracker. */
export function loadUnreads(): Promise<void> {
  unreadsLoad ??= slackRead<SlackUnreads>("unreads")
    .then((answer) => {
      if (accept(answer)) mergeUnreads(answer);
    })
    .finally(() => {
      unreadsLoad = undefined;
    });
  return unreadsLoad;
}

const searches = new Map<string, { at: number; result: SlackSearch }>();

/** Searches every message (`q/search`); a term asked in the last minute isn't asked again unless `fresh`. */
export async function searchSlack(term: string, fresh = false): Promise<{ result?: SlackSearch; error?: string }> {
  const key = term.trim();
  const known = searches.get(key);
  if (!fresh && known && Date.now() - known.at < 60_000) return { result: known.result };
  try {
    const answer = await slackRead<SlackSearch>("search", { term: key });
    if (isUnavailable(answer)) return { error: answer.reason };
    searches.set(key, { at: Date.now(), result: answer });
    return { result: answer };
  } catch (e) {
    return { error: errorMessage(e) || "Slack didn't answer." };
  }
}

// ── Writes ───────────────────────────────────────────────────────────

const VERB: Record<SlackWriteName, string> = {
  post: "send that",
  edit: "save that edit",
  delete: "delete that",
  react: "add that reaction",
  unreact: "take that reaction away",
  mark: "mark that read",
  openDm: "open that conversation",
  share: "share those files",
};

async function send<N extends SlackWriteName>(name: N, input: SlackWriteInputs[N]): Promise<SlackWriteResult | undefined> {
  try {
    return (await slackWrite(name, input)) ?? {};
  } catch (e) {
    notify(`Slack didn't ${VERB[name]}: ${errorMessage(e) || "it didn't answer"}`);
    return undefined;
  }
}

function hold(conversationId: string, ts: string, fields: string[]): number {
  const key = messageKey(conversationId, ts);
  const marks = pendingFields.get(key) ?? new Map<string, number>();
  const mark = ++lastMark;
  for (const f of fields) marks.set(f, mark);
  pendingFields.set(key, marks);
  return mark;
}
function release(conversationId: string, ts: string, fields: string[], mark: number): string[] {
  const key = messageKey(conversationId, ts);
  const marks = pendingFields.get(key);
  const mine = fields.filter((f) => marks?.get(f) === mark);
  for (const f of mine) marks?.delete(f);
  if (marks?.size === 0) pendingFields.delete(key);
  return mine;
}

/** A message as you're sending it: shown at once, unsent, where it goes. */
function localMessage(conversationId: string, markdown: string, threadTs?: string): ShownMessage {
  return { ts: `local:${++localSerial}`, conversationId, ...(threadTs ? { threadTs } : {}), userId: selfId(), text: markdown, pending: true };
}

function showLocal(m: ShownMessage): void {
  if (m.threadTs) {
    const key = threadKey(m.conversationId, m.threadTs);
    setThread(key, { replies: [...(state.threads.get(key)?.replies ?? []), m] });
  } else {
    const list = state.history.get(m.conversationId);
    setHistory(m.conversationId, { messages: [...(list?.messages ?? []), m], loaded: list?.loaded ?? false });
  }
}

/** Sent (Slack's message takes its place) or refused (it goes). */
function settleLocal(local: ShownMessage, sent: SlackMessage | undefined): void {
  dropMessage(local.conversationId, local.ts);
  if (!sent) return;
  addMessage(sent);
  noteArrival(sent);
}

/**
 * Posts a message (Markdown, sent as `markdown_text`): it shows at once,
 * unsent, then as Slack has it; refused, it goes and the notice says why.
 * True once Slack has it.
 */
async function post(input: SlackWriteInputs["post"]): Promise<boolean> {
  const local = localMessage(input.conversationId, input.markdown, input.threadTs);
  showLocal(local);
  const answer = await send("post", input);
  settleLocal(local, answer?.message);
  return !!answer;
}

/** Shares uploaded files (with the composer's text as their comment): as `post`. */
async function share(input: SlackWriteInputs["share"]): Promise<boolean> {
  const local = localMessage(input.conversationId, input.markdown ?? "", input.threadTs);
  showLocal(local);
  const answer = await send("share", input);
  settleLocal(local, answer?.message);
  return !!answer;
}

/** Edits your message: the new text shows at once; refused, the old one comes back. */
async function edit(input: SlackWriteInputs["edit"]): Promise<boolean> {
  const before = findMessage(state, input.conversationId, input.ts);
  if (!before) return false;
  const fields = ["text", "blocks", "edited"];
  const mark = hold(input.conversationId, input.ts, fields);
  patchMessage(input.conversationId, input.ts, (m) => {
    const { blocks: _, ...rest } = m;
    return { ...rest, text: input.markdown, edited: `${Math.floor(Date.now() / 1000)}.000000` };
  });
  const answer = await send("edit", input);
  const mine = release(input.conversationId, input.ts, fields, mark);
  if (answer) {
    if (answer.message) patchMessage(input.conversationId, input.ts, (m) => mergeOne(m, answer.message!));
    return true;
  }
  const was = before as Record<string, unknown>;
  patchMessage(input.conversationId, input.ts, (m) => {
    const next = { ...m } as Record<string, unknown>;
    for (const f of mine) {
      if (f in was) next[f] = was[f];
      else delete next[f];
    }
    return next as ShownMessage;
  });
  return false;
}

/** Deletes your message: gone at once; refused, it comes back. */
async function remove(input: SlackWriteInputs["delete"]): Promise<boolean> {
  const before = findMessage(state, input.conversationId, input.ts);
  if (!before) return false;
  dropMessage(input.conversationId, input.ts);
  const answer = await send("delete", input);
  if (answer) return true;
  addMessage(before);
  return false;
}

/** Adds your reaction, or takes it away: shown at once; refused, put back. */
async function toggleReaction(conversationId: string, ts: string, name: string): Promise<boolean> {
  const message = findMessage(state, conversationId, ts);
  const self = selfId();
  if (!message || !self) return false;
  const before = message.reactions ?? [];
  const known = before.find((r) => r.name === name);
  const mine = !!known?.userIds.includes(self);
  const after: SlackReaction[] = mine
    ? before
        .map((r) => (r === known ? { ...r, count: r.count - 1, userIds: r.userIds.filter((u) => u !== self) } : r))
        .filter((r) => r.count > 0)
    : known
      ? before.map((r) => (r === known ? { ...r, count: r.count + 1, userIds: [...r.userIds, self] } : r))
      : [...before, { name, count: 1, userIds: [self] }];
  const mark = hold(conversationId, ts, ["reactions"]);
  patchMessage(conversationId, ts, (m) => ({ ...m, reactions: after }));
  const answer = await send(mine ? "unreact" : "react", { conversationId, ts, name });
  const held = release(conversationId, ts, ["reactions"], mark).length > 0;
  if (answer) {
    if (answer.reactions && held) patchMessage(conversationId, ts, (m) => ({ ...m, reactions: answer.reactions }));
    return true;
  }
  if (held) patchMessage(conversationId, ts, (m) => ({ ...m, reactions: before }));
  return false;
}

/**
 * Marks a conversation read up to `ts` (never back): its unread count goes at
 * once; refused, it comes back and the notice says why.
 */
async function markRead(conversationId: string, ts: string): Promise<boolean> {
  const c = state.conversations.get(conversationId);
  if (!c || isLocal(ts)) return false;
  if (c.lastRead && compareTs(ts, c.lastRead) <= 0 && !c.unread) return true;
  const target = newer(c.lastRead, ts)!;
  const before = Object.fromEntries(READ_FIELDS.map((f) => [f, c[f]])) as Partial<SlackConversation>;
  patchConversation(conversationId, readStateAt(c, target));
  marking.set(conversationId, target);
  const answer = await send("mark", { conversationId, ts: target });
  if (marking.get(conversationId) === target) marking.delete(conversationId);
  if (answer) return true;
  patchConversation(conversationId, before);
  return false;
}

/** Opens (or finds) a direct message with these people; its id, or undefined (with the notice) if Slack refused. */
async function openDm(userIds: string[]): Promise<string | undefined> {
  const answer = await send("openDm", { userIds });
  if (!answer?.conversation) return undefined;
  upsertConversations([answer.conversation]);
  return answer.conversation.id;
}

// ── Events ───────────────────────────────────────────────────────────

/** Applies one live event from the server. */
export function applyEvent(event: SlackEvent): void {
  switch (event.type) {
    case "message":
      addMessage(event.message);
      noteArrival(event.message);
      break;
    case "changed": {
      const m = event.message;
      if (findMessage(state, m.conversationId, m.ts)) patchMessage(m.conversationId, m.ts, (known) => mergeOne(known, m));
      else addMessage(m);
      break;
    }
    case "deleted":
      dropMessage(event.conversationId, event.ts);
      break;
    case "reaction":
      if (!pendingFields.get(messageKey(event.conversationId, event.ts))?.has("reactions"))
        patchMessage(event.conversationId, event.ts, (m) => ({ ...m, reactions: event.reactions }));
      break;
    case "marked": {
      const c = state.conversations.get(event.conversationId);
      if (c && !marking.has(c.id)) patchConversation(c.id, readStateAt(c, event.lastRead));
      break;
    }
    case "unreads":
      mergeUnreads(event.unreads);
      break;
    case "conversation":
      upsertConversations([event.conversation]);
      break;
    case "user":
      publish({ users: new Map(state.users).set(event.user.id, event.user) });
      break;
    case "live":
      publish({ live: event.live });
      break;
    case "resync":
      void resync();
      break;
  }
}

/** Reads again what shows (the open conversation and thread) and the read state: after a gap in the events. */
export async function resync(): Promise<void> {
  const { conversationId, threadTs } = open;
  await Promise.all([
    loadUnreads().catch(() => {}),
    conversationId && state.history.get(conversationId)?.loaded ? loadHistory(conversationId, true).catch(() => {}) : undefined,
    conversationId && threadTs && state.threads.get(threadKey(conversationId, threadTs))?.loaded
      ? loadThread(conversationId, threadTs, true).catch(() => {})
      : undefined,
  ]);
}

let stream: EventStream | undefined;
let everOpened = false;
let reopenTimer: ReturnType<typeof setTimeout> | undefined;

/** Listens to the server's live events; a reconnect reads again what shows (events may have been missed). */
export function connectEvents(): void {
  if (stream) return;
  clearTimeout(reopenTimer);
  publish({ stream: "connecting" });
  const s = openSlackEvents();
  stream = s;
  s.onopen = () => {
    if (stream !== s) return;
    const again = everOpened;
    everOpened = true;
    publish({ stream: "open" });
    if (again) void resync();
  };
  s.onmessage = (e) => {
    if (stream !== s) return;
    const event = parseEvent(e.data);
    if (event) applyEvent(event);
  };
  s.onerror = () => {
    if (stream !== s) return;
    publish({ stream: "down" });
    // EventSource tries again by itself, unless the server refused it (closed): then a while later.
    if ((s as { readyState?: number }).readyState === 2) {
      s.close();
      stream = undefined;
      reopenTimer = setTimeout(connectEvents, REOPEN_MS);
    }
  };
}

export function disconnectEvents(): void {
  clearTimeout(reopenTimer);
  stream?.close();
  stream = undefined;
  everOpened = false;
  publish({ stream: "off" });
}

/** Whether changes arrive by themselves (Socket Mode, and the stream open); else the page polls. */
export const isLive = (d: SlackData) => d.live?.mode === "socket" && d.stream === "open";

/**
 * One poll, only while changes don't arrive live (no app token, the socket or
 * the stream down) and Slack isn't paused (`retryAt` ahead): the open
 * conversation's newest messages, the open thread, and the read state.
 */
export function pollTick(now: number = Date.now()): Promise<void> {
  if (polling || isLive(state)) return polling ?? Promise.resolve();
  const retryAt = state.unavailable?.retryAt;
  if (retryAt !== undefined && retryAt > now) return Promise.resolve();
  polling = resync().finally(() => {
    polling = undefined;
  });
  return polling;
}

type Visibility = Pick<Document, "hidden" | "addEventListener" | "removeEventListener">;

/**
 * Keeps the store current while the view shows: live events, and a poll every
 * `every` ms while they don't arrive live, skipped while the page is hidden
 * (and once as it shows again). Returns the stop.
 */
export function keepSlackCurrent(doc: Visibility = document, every = POLL_EVERY_MS): () => void {
  connectEvents();
  const tick = () => {
    if (!doc.hidden) void pollTick();
  };
  const timer = setInterval(tick, every);
  doc.addEventListener("visibilitychange", tick);
  return () => {
    clearInterval(timer);
    doc.removeEventListener("visibilitychange", tick);
    disconnectEvents();
  };
}

/** While `active` (Slack shows), keeps the store current (`keepSlackCurrent`). */
export function useSlackLive(active: boolean): void {
  useEffect(() => (active ? keepSlackCurrent() : undefined), [active]);
}

// ── The store ────────────────────────────────────────────────────────

export const slackStore = {
  getState: (): SlackData => state,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  applyEvent,
  post,
  share,
  edit,
  remove,
  toggleReaction,
  markRead,
  openDm,
  /** Says something went wrong, in the app's notice (as a refused write does). */
  notice: (message: string) => notify(message),
  /** What shows (polling and resync read it again). */
  setOpen(next: { conversationId?: string; threadTs?: string }): void {
    open = { ...next };
  },
  setWorkspace(workspace: SlackWorkspace): void {
    publish({
      workspace,
      users: new Map(workspace.users.map((u) => [u.id, u])),
      conversations: new Map(workspace.conversations.map((c) => [c.id, c])),
      live: workspace.live,
      unavailable: undefined,
    });
  },
  /** Back to empty (tests). */
  reset(): void {
    disconnectEvents();
    state = empty();
    pendingFields.clear();
    marking.clear();
    countedReplies.clear();
    historyLoads.clear();
    threadLoads.clear();
    searches.clear();
    unreadsLoad = undefined;
    polling = undefined;
    open = {};
    for (const fn of [...listeners]) fn();
  },
};

/** Select from the store; the component redraws when the selected value changes. */
export function useSlack<T>(select: (d: SlackData) => T): T {
  return useSyncExternalStore(slackStore.subscribe, () => select(slackStore.getState()));
}

// ── Selections ───────────────────────────────────────────────────────

/** Whether a conversation needs you: unread and not muted (a muted one only for mentions). */
export const needsYou = (c: SlackConversation) => (!!c.unread && !c.isMuted) || !!c.mentions;

/** A person's name, else their id. */
export const userName = (d: SlackData, id: string | undefined) => (id ? d.users.get(id)?.name ?? id : "Someone");

/** A conversation as people name it: `#name` for channels, else the person's (people's) name. */
export const conversationTitle = (d: Pick<SlackData, "users">, c: SlackConversation | undefined) => titleWith(d.users, c);

/** As `conversationTitle`, from the people alone. */
export function titleWith(users: Map<string, SlackUser>, c: SlackConversation | undefined): string {
  if (!c) return "Conversation";
  if (c.kind === "channel" || c.kind === "private") return `#${c.name}`;
  if (c.kind === "im" && c.userId) return users.get(c.userId)?.name ?? c.name;
  if (c.kind === "mpim" && c.userIds?.length) return c.userIds.map((id) => users.get(id)?.name ?? id).join(", ");
  return c.name;
}
