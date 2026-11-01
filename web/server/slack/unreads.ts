/**
 * Each conversation's read state. Slack gives third-party apps no bulk unread
 * call, so the server keeps it: `conversations.info` says where you've read
 * to (`last_read`, for user tokens) and `conversations.history` since then
 * (100 at most) gives the unread messages from others, the mentions of you
 * among them (in DMs and group DMs every one counts). A paced queue checks one
 * conversation every 3 s (20 a minute, well inside Slack's Tier 3 50 a minute
 * per method), DMs and channels in turn, each by recent activity;
 * it runs only while Slack is enabled and something asked within the last few
 * minutes. Live events change the state at once. A state not yet known stays
 * undefined: never reported as 0. A conversation never read (`last_read` all
 * zeros) counts every message, unless it's a DM Slack keeps closed (not in
 * its sidebar), which counts none.
 */
import type { SlackConversation, SlackConversationKind, SlackMessage, SlackUnreads } from "../../src/slack/types";
import { SlackError, slackCall, slackEnabled, slackUserToken } from "./client";
import { emitSlack, onSlackDemand, slackWanted } from "./events";
import { isSpoken, listOf, messageOf, recOf, tsOf } from "./normalize";

export const UNREADS = {
  /** One conversation checked per interval: 30 a minute. */
  intervalMs: 2_000,
  /** At most this many unread messages are counted per conversation (`unreadMore` past it). */
  maxCount: 100,
  /** How long a check stays fresh: with live events, and while polling (DMs, then channels). */
  freshLiveMs: 15 * 60_000,
  freshDmMs: 60_000,
  freshChannelMs: 5 * 60_000,
  /** Pause after Slack refuses the token. */
  refusedPauseMs: 60_000,
  /** How long a conversation whose check failed (channel_not_found…) is left alone. */
  failedPauseMs: 10 * 60_000,
  emitDelayMs: 300,
};

/** An unread message from someone else, newest kept. */
export type UnreadMessage = { ts: string; userId?: string; text: string; mention: boolean; threadTs?: string };

type Entry = {
  id: string;
  kind: SlackConversationKind;
  archived: boolean;
  lastRead?: string;
  latest?: string;
  /** Known unread messages (newest `maxCount`), undefined until checked. */
  unread?: UnreadMessage[];
  /** More unread messages than `unread` holds. */
  more?: boolean;
  checkedAt?: number;
  /** Slack gave no `last_read` for it (not a member): nothing to count. */
  noReadState?: boolean;
  /** People in it, from `conversations.info` (users.conversations doesn't say). */
  memberCount?: number;
};

const entries = new Map<string, Entry>();
const urgent = new Set<string>();
let selfId = "";
let timer: ReturnType<typeof setTimeout> | undefined;
let pausedUntil = 0;
let emitTimer: ReturnType<typeof setTimeout> | undefined;
let checking = false;
let waiters: (() => void)[] = [];
/** The queue's next turn (after a check, by it or by Activity). */
let turnAt = 0;
/** The last never-checked conversation the queue took was a DM: a channel's turn next. */
let dmTurnTaken = false;
/** Conversations whose check failed lately (not a limit or refusal), until when they're left alone. */
const failedUntil = new Map<string, number>();

/** Forgets every conversation's state and stops the queue (tests). */
export function resetSlackUnreads(): void {
  entries.clear();
  urgent.clear();
  selfId = "";
  pausedUntil = 0;
  turnAt = 0;
  dmTurnTaken = false;
  failedUntil.clear();
  if (timer) clearTimeout(timer);
  if (emitTimer) clearTimeout(emitTimer);
  timer = emitTimer = undefined;
}

const newer = (a: string | undefined, b: string | undefined) => (a && (!b || Number(a) > Number(b)) ? a : b);
const isDm = (kind: SlackConversationKind) => kind === "im" || kind === "mpim";

/** Whether `m` mentions you: in DMs and group DMs every message does. */
const mentions = (kind: SlackConversationKind, text: string) => isDm(kind) || (!!selfId && text.includes(`<@${selfId}>`));

/** Whether a message is an unread one from someone else (said by a person or bot, not a join or topic change). */
const counts = (m: SlackMessage) =>
  isSpoken(m.subtype) && m.userId !== selfId && (!m.threadTs || m.threadTs === m.ts || m.subtype === "thread_broadcast");

const unreadOf = (kind: SlackConversationKind, m: SlackMessage): UnreadMessage => ({
  ts: m.ts,
  ...(m.userId ? { userId: m.userId } : {}),
  text: m.text.slice(0, 1000),
  mention: mentions(kind, m.text),
  ...(m.threadTs ? { threadTs: m.threadTs } : {}),
});

/** Tells the pages the state changed, at most once per `emitDelayMs`. */
function changed(): void {
  if (emitTimer) return;
  emitTimer = setTimeout(() => {
    emitTimer = undefined;
    emitSlack({ type: "unreads", unreads: slackUnreads() });
  }, UNREADS.emitDelayMs);
  emitTimer.unref?.();
}

/** Starts tracking conversations (you're in); `all` says this is every one, so others are forgotten. */
export function trackSlackConversations(list: SlackConversation[], self: string, all = false): void {
  if (self) selfId = self;
  const ids = new Set<string>();
  for (const c of list) {
    if (!c.isMember) continue;
    ids.add(c.id);
    const e = entries.get(c.id);
    if (e) {
      e.archived = c.isArchived;
      e.latest = newer(c.latest, e.latest);
    } else entries.set(c.id, { id: c.id, kind: c.kind, archived: c.isArchived, latest: c.latest });
  }
  if (all) for (const id of [...entries.keys()]) if (!ids.has(id)) entries.delete(id);
  wake();
}

/** A conversation with the known read state laid over it (unknown fields stay undefined). */
export function mergeUnreads(c: SlackConversation): SlackConversation {
  const e = entries.get(c.id);
  if (!e) return c;
  return { ...c, ...(c.memberCount === undefined && e.memberCount !== undefined ? { memberCount: e.memberCount } : {}), ...stateOf(e) };
}

function stateOf(e: Entry): Pick<SlackConversation, "lastRead" | "latest" | "unread" | "unreadMore" | "mentions"> {
  return {
    ...(e.lastRead ? { lastRead: e.lastRead } : {}),
    ...(e.latest ? { latest: e.latest } : {}),
    ...(e.unread
      ? {
          unread: e.unread.length,
          ...(e.more ? { unreadMore: true } : {}),
          mentions: e.unread.filter((m) => m.mention).length,
        }
      : {}),
  };
}

/** Every known conversation's read state, and how many are still being checked (not those whose check failed lately). */
export function slackUnreads(): SlackUnreads {
  const conversations: SlackUnreads["conversations"] = [];
  let pending = 0;
  const now = Date.now();
  for (const e of entries.values()) {
    if (!e.unread && !e.noReadState && !e.archived && (failedUntil.get(e.id) ?? 0) <= now) pending++;
    const state = stateOf(e);
    if (Object.keys(state).length) conversations.push({ id: e.id, ...state });
  }
  return { conversations, pending };
}

/** A conversation's unread messages from others (newest last), when known. */
export function unreadMessages(id: string): { kind: SlackConversationKind; lastRead?: string; messages?: UnreadMessage[]; more?: boolean } | undefined {
  const e = entries.get(id);
  return e ? { kind: e.kind, lastRead: e.lastRead, messages: e.unread?.slice(), more: e.more } : undefined;
}

/** Where you've read to in `id`, when known. */
export const lastReadOf = (id: string) => entries.get(id)?.lastRead;

/** Drops unread messages at or before `lastRead`; when it passes the oldest one held, nothing older remains. */
function readTo(e: Entry, lastRead: string): void {
  e.lastRead = newer(lastRead, e.lastRead) === lastRead ? lastRead : e.lastRead;
  if (!e.unread) return;
  const oldest = e.unread[0]?.ts;
  e.unread = e.unread.filter((m) => Number(m.ts) > Number(lastRead));
  if (e.more && (!oldest || Number(lastRead) >= Number(oldest))) e.more = false;
}

/** Slack said where you've read to (a read or `conversations.info`); `latest` is its newest message when known. */
export function noteLastRead(id: string, lastRead: string, latest?: string): void {
  const e = entries.get(id);
  if (!e) return;
  const before = e.lastRead;
  e.latest = newer(latest, e.latest);
  if (before === lastRead) return;
  e.lastRead = lastRead;
  if (e.unread) {
    if (!before || Number(lastRead) > Number(before)) readTo(e, lastRead);
    // Read state moved back (marked unread elsewhere): what's unread now is unknown until checked.
    else {
      e.unread = undefined;
      e.more = undefined;
      urgent.add(id);
    }
  } else urgent.add(id);
  changed();
  wake();
}

/** You read to `ts` (`*_marked` events and the `mark` write). */
export function noteMarked(id: string, ts: string): void {
  const e = entries.get(id);
  if (!e) return;
  if (!e.lastRead || Number(ts) >= Number(e.lastRead)) {
    e.lastRead = ts;
    readTo(e, ts);
  } else noteLastRead(id, ts);
  changed();
}

/** A conversation's newest messages (history's first page): its latest, and an exact recount when the page reaches back to `lastRead`. */
export function noteHistory(id: string, messages: SlackMessage[]): void {
  const e = entries.get(id);
  if (!e || !messages.length) return;
  e.latest = newer(messages[messages.length - 1].ts, e.latest);
  const oldest = messages[0].ts;
  if (e.lastRead && Number(oldest) <= Number(e.lastRead)) {
    const lastRead = e.lastRead;
    e.unread = messages.filter((m) => Number(m.ts) > Number(lastRead) && counts(m)).map((m) => unreadOf(e.kind, m));
    e.more = false;
    e.checkedAt = Date.now();
  }
  changed();
}

/** A live message: its conversation's latest, and an unread one when it's from someone else and the count is known. */
export function noteMessage(m: SlackMessage): void {
  const e = entries.get(m.conversationId);
  if (!e) return;
  const isReply = !!m.threadTs && m.threadTs !== m.ts && m.subtype !== "thread_broadcast";
  if (isReply) return;
  e.latest = newer(m.ts, e.latest);
  if (e.unread && counts(m) && (!e.lastRead || Number(m.ts) > Number(e.lastRead)) && !e.unread.some((u) => u.ts === m.ts)) {
    e.unread.push(unreadOf(e.kind, m));
    if (e.unread.length > UNREADS.maxCount) {
      e.unread.shift();
      e.more = true;
    }
  }
  changed();
}

/** A message was deleted: it's no longer unread. */
export function noteDeleted(id: string, ts: string): void {
  const e = entries.get(id);
  if (!e?.unread) return;
  const before = e.unread.length;
  e.unread = e.unread.filter((m) => m.ts !== ts);
  if (e.unread.length !== before) changed();
}

/** Checks one conversation now: where you've read to, then what's unread since. */
async function check(e: Entry): Promise<void> {
  const info = recOf((await slackCall("conversations.info", { channel: e.id, include_num_members: true })).channel);
  if (typeof info.num_members === "number" && Number.isFinite(info.num_members)) e.memberCount = info.num_members;
  // "0000000000.000000" when never read.
  const lastRead = tsOf(info.last_read);
  e.checkedAt = Date.now();
  e.latest = newer(tsOf(recOf(info.latest).ts), e.latest);
  if (!lastRead) {
    e.noReadState = true;
    return;
  }
  // Never read: a DM Slack keeps closed has nothing unread, as in Slack; else every message is.
  const never = !(Number(lastRead) > 0);
  if (never && isDm(e.kind) && info.is_open === false) {
    e.lastRead = lastRead;
    e.noReadState = false;
    e.unread = [];
    e.more = false;
    changed();
    return;
  }
  // Slack refuses a zero `oldest` (invalid_ts_oldest).
  const h = await slackCall("conversations.history", {
    channel: e.id,
    ...(never ? {} : { oldest: lastRead, inclusive: false }),
    limit: UNREADS.maxCount,
  });
  const messages = listOf(h.messages)
    .map((m) => messageOf(m, e.id))
    .filter((m): m is SlackMessage => !!m)
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  // A mark or message that arrived while asking wins over this older answer.
  if (e.lastRead && Number(e.lastRead) > Number(lastRead)) return;
  e.lastRead = lastRead;
  e.noReadState = false;
  e.unread = messages.filter(counts).map((m) => unreadOf(e.kind, m));
  e.more = h.has_more === true;
  if (messages.length) e.latest = newer(messages[messages.length - 1].ts, e.latest);
  changed();
}

/** How long `e`'s check stays fresh. */
function freshFor(e: Entry, live: boolean): number {
  if (live) return UNREADS.freshLiveMs;
  return isDm(e.kind) ? UNREADS.freshDmMs : UNREADS.freshChannelMs;
}

let liveNow = () => false;
/** The socket says whether events arrive (then checks stay fresh longer). */
export function setUnreadsLive(fn: () => boolean): void {
  liveNow = fn;
}

/**
 * The next conversation to check: asked-for first, then never checked (DMs and
 * channels in turn, each by activity, so channels aren't left until every
 * group DM is done), then the stalest.
 */
export function nextToCheck(now = Date.now()): string | undefined {
  for (const id of urgent) {
    if (entries.has(id)) return id;
    urgent.delete(id);
  }
  const all = [...entries.values()].filter((e) => !e.archived && (failedUntil.get(e.id) ?? 0) <= now);
  const byActivity = (a: Entry, b: Entry) =>
    Number(b.kind === "im") - Number(a.kind === "im") || Number(b.latest ?? 0) - Number(a.latest ?? 0);
  const fresh = all.filter((e) => e.checkedAt === undefined).sort(byActivity);
  if (fresh.length) {
    const dms = fresh.filter((e) => isDm(e.kind));
    const channels = fresh.filter((e) => !isDm(e.kind));
    const next = (dmTurnTaken ? channels[0] : dms[0]) ?? dms[0] ?? channels[0];
    return next.id;
  }
  const live = liveNow();
  const stale = all
    .filter((e) => !e.noReadState && now - (e.checkedAt ?? 0) > freshFor(e, live))
    .sort((a, b) => Number(isDm(b.kind)) - Number(isDm(a.kind)) || (a.checkedAt ?? 0) - (b.checkedAt ?? 0));
  return stale[0]?.id;
}

/** Whether the queue may ask Slack now (on, with a token, not paused after a limit or refusal). */
const mayAsk = () => Date.now() >= pausedUntil && slackEnabled() && !!slackUserToken();

/**
 * Checks one conversation under the queue's lock: a limit or refusal pauses the
 * whole queue; any other failure (channel_not_found…) leaves that conversation
 * alone for `failedPauseMs`. Each check uses up one of the queue's turns.
 */
async function runCheck(e: Entry): Promise<void> {
  checking = true;
  if (e.checkedAt === undefined) dmTurnTaken = isDm(e.kind);
  urgent.delete(e.id);
  try {
    await check(e);
    failedUntil.delete(e.id);
  } catch (err) {
    if (err instanceof SlackError && err.kind === "limited") pausedUntil = err.retryAt ?? Date.now() + 60_000;
    else if (err instanceof SlackError && (err.kind === "refused" || err.kind === "no-key"))
      pausedUntil = Date.now() + UNREADS.refusedPauseMs;
    else failedUntil.set(e.id, Date.now() + UNREADS.failedPauseMs);
    e.checkedAt = Date.now();
  } finally {
    checking = false;
    turnAt = Date.now() + UNREADS.intervalMs;
    const waiting = waiters;
    waiters = [];
    for (const fn of waiting) fn();
  }
}

/** Resolves once no check is running. */
const unlocked = () => (checking ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve());

/** One step of the queue: checks the next conversation, if any; answers its id. */
export async function tickSlackUnreads(): Promise<string | undefined> {
  if (checking || !mayAsk()) return undefined;
  const id = nextToCheck();
  const e = id ? entries.get(id) : undefined;
  if (!e) return undefined;
  await runCheck(e);
  return e.id;
}

/**
 * Checks the conversations named whose read state isn't known yet, at most `max` now (Activity): one at a
 * time under the queue's lock, stopping while the queue is paused, past any that fails, and skipping
 * those that failed lately. The queue's own next turn waits after them.
 */
export async function ensureLastRead(ids: string[], max = 3): Promise<void> {
  let n = 0;
  for (const id of ids) {
    if (n >= max) return;
    const e = entries.get(id);
    if (!e || e.lastRead || e.noReadState || (failedUntil.get(id) ?? 0) > Date.now()) continue;
    await unlocked();
    if (!mayAsk()) return;
    if (e.lastRead || e.noReadState) continue;
    n++;
    await runCheck(e);
  }
}

/** Starts the queue's timer if there is demand, Slack is on and it isn't running. */
function wake(): void {
  if (timer || !slackWanted() || !slackEnabled()) return;
  const step = () => {
    timer = undefined;
    if (!slackWanted() || !slackEnabled()) return;
    // A check Activity just made used this turn: wait for the next.
    const run = Date.now() < turnAt ? Promise.resolve(undefined) : tickSlackUnreads();
    void run.finally(() => {
      if (timer || !slackWanted()) return;
      timer = setTimeout(step, Math.max(UNREADS.intervalMs, turnAt - Date.now()));
      timer.unref?.();
    });
  };
  timer = setTimeout(step, UNREADS.intervalMs);
  timer.unref?.();
}

/** Whether the queue's timer is running (tests). */
export const unreadsRunning = () => !!timer;

onSlackDemand(wake);
