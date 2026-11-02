/**
 * Activity's Slack source: unread DMs and group DMs (one item per
 * conversation, from the unread tracker), mentions of you (`search.messages`
 * for `<@you>`, kept a minute, and live ones from the socket), and replies
 * from others in threads you're in (you started or replied in them, or were
 * mentioned there; seen live by the socket). Slack keeps no read state for
 * threads that apps can read, and can't be told a message is unread, so those
 * are kept here, in the data directory's `slack-activity.json`, with the
 * threads you're in and the items marked done. Keys are
 * `slack:<conversationId>:<ts>`.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityItem, ActivityWriteName } from "../../src/activity/types";
import type { SlackConversation, SlackMessage, SlackRecentThread, SlackSearchHit, SlackUser, SlackWorkspace } from "../../src/slack/types";
import { dataDir } from "../subagentArchive";
import { SlackError, slackCall, slackUnavailable, slackUserToken } from "../slack/client";
import { noteSlackDemand } from "../slack/events";
import { tsTime } from "../slack/normalize";
import { keptWorkspace, readWorkspace, searchHitOf } from "../slack/reads";
import { ensureLastRead, lastReadOf, noteMarked, unreadMessages } from "../slack/unreads";
import { listOf, recOf } from "../slack/normalize";

export const SLACK_ACTIVITY = {
  mentionsTtlMs: 60_000,
  mentions: 30,
  liveMentions: 50,
  maxThreads: 300,
  maxKeys: 1000,
  /** A thread reply or mention whose read state can't be known shows unread only this recently. */
  unknownUnreadMs: 24 * 60 * 60_000,
  /** A read DM stays in Activity (as read) this long. */
  keepDmMs: 3 * 24 * 60 * 60_000,
  /** The sidebar's Recent: at most this many threads, and this many parents' first words asked of Slack a read. */
  recentThreads: 20,
  recentLookups: 3,
  /** A parent Slack wouldn't give isn't asked for again for this long. */
  lookupRetryMs: 60 * 60_000,
};

type Reply = { ts: string; userId?: string; text: string };
type Thread = { at: number; reply?: Reply; readTs?: string; latest?: string; text?: string; askedAt?: number };
type Record_ = {
  /**
   * Threads you're in, by `<conversationId>:<threadTs>`: when you joined, the newest reply from others, read to,
   * and for the sidebar's Recent the newest message from anyone, the parent's first words (once asked: "" when
   * Slack wouldn't say, then `askedAt`).
   */
  threads: Record<string, Thread>;
  /** DMs' newest unread message as last seen, so a read one stays a while. */
  dms: Record<string, Reply & { at: number }>;
  read: string[];
  unread: string[];
  done: string[];
};

export const slackActivityFile = () => join(dataDir(), "slack-activity.json");

const empty = (): Record_ => ({ threads: {}, dms: {}, read: [], unread: [], done: [] });

function load(): Record_ {
  try {
    const raw = recOf(JSON.parse(readFileSync(slackActivityFile(), "utf8")));
    const keys = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
    return {
      threads: recOf(raw.threads) as Record_["threads"],
      dms: recOf(raw.dms) as Record_["dms"],
      read: keys(raw.read),
      unread: keys(raw.unread),
      done: keys(raw.done),
    };
  } catch {
    return empty();
  }
}

function save(rec: Record_): void {
  const threads = Object.entries(rec.threads).sort((a, b) => b[1].at - a[1].at).slice(0, SLACK_ACTIVITY.maxThreads);
  const out: Record_ = {
    threads: Object.fromEntries(threads),
    dms: rec.dms,
    read: rec.read.slice(-SLACK_ACTIVITY.maxKeys),
    unread: rec.unread.slice(-SLACK_ACTIVITY.maxKeys),
    done: rec.done.slice(-SLACK_ACTIVITY.maxKeys),
  };
  mkdirSync(dataDir(), { recursive: true });
  const file = slackActivityFile();
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(out) + "\n", { mode: 0o600 });
    renameSync(tmp, file);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const add = (list: string[], key: string) => (list.includes(key) ? list : [...list, key]);
const drop = (list: string[], key: string) => list.filter((k) => k !== key);
const keyOf = (conversationId: string, ts: string) => `slack:${conversationId}:${ts}`;
const later = (a: string | undefined, b: string | undefined) => (a && (!b || Number(a) > Number(b)) ? a : b);

let mentionCache: { token: string; at: number; hits: SlackSearchHit[]; names: Map<string, string> } | undefined;
let liveMentions: SlackMessage[] = [];
let mentionLoad: { token: string; promise: Promise<{ hits: SlackSearchHit[]; names: Map<string, string> }> } | undefined;

/** Forgets the mentions kept (tests). */
export function resetSlackActivity(): void {
  mentionCache = undefined;
  mentionLoad = undefined;
  liveMentions = [];
}

/**
 * You're in this thread (you replied, or were mentioned there): its replies from others come to Activity.
 * `yours` is your reply's ts: the thread is newest and read to there.
 */
export function followSlackThread(conversationId: string, threadTs: string, yours?: string): void {
  const rec = load();
  const id = `${conversationId}:${threadTs}`;
  const known = rec.threads[id];
  if (known && !yours) return;
  const thread = (rec.threads[id] ??= { at: Date.now() });
  if (yours) {
    thread.latest = later(yours, thread.latest);
    thread.readTs = later(yours, thread.readTs);
  }
  save(rec);
}

/** A live message (from the socket): your thread replies follow the thread; others' replies and mentions of you are kept. */
export function noteSlackActivityMessage(m: SlackMessage, parentUserId?: string): void {
  const self = keptWorkspace()?.selfId;
  if (!self) return;
  const inThread = !!m.threadTs && m.threadTs !== m.ts;
  if (m.userId === self) {
    if (inThread) followSlackThread(m.conversationId, m.threadTs!, m.ts);
    return;
  }
  if (m.text.includes(`<@${self}>`) && !/^D/.test(m.conversationId)) {
    liveMentions = [m, ...liveMentions.filter((x) => x.ts !== m.ts)].slice(0, SLACK_ACTIVITY.liveMentions);
  }
  if (!inThread) return;
  const rec = load();
  const id = `${m.conversationId}:${m.threadTs}`;
  if (!rec.threads[id] && (parentUserId === self || m.text.includes(`<@${self}>`))) rec.threads[id] = { at: Date.now() };
  const thread = rec.threads[id];
  if (!thread) return;
  if (!thread.reply || Number(m.ts) > Number(thread.reply.ts)) {
    thread.reply = { ts: m.ts, ...(m.userId ? { userId: m.userId } : {}), text: m.text.slice(0, 1000) };
    thread.latest = later(m.ts, thread.latest);
    save(rec);
  }
}

/** Whether a thread's newest reply from others is unread: by its key's mark, else by where it's read to. */
function threadUnread(rec: Record_, conversationId: string, thread: Thread, self: string): boolean {
  const reply = thread.reply;
  if (!reply || reply.userId === self) return false;
  const key = keyOf(conversationId, reply.ts);
  if (rec.unread.includes(key)) return true;
  return !rec.read.includes(key) && (!thread.readTs || Number(reply.ts) > Number(thread.readTs));
}

/**
 * The sidebar's Recent threads: those you're in, newest first (by the newest
 * message from anyone, as seen), in conversations of the workspace, at most
 * `recentThreads`. A parent's first words come from `conversations.replies`
 * (one message), asked for at most `recentLookups` threads a read and kept;
 * Slack's limits and cooldowns stop the asking until a later read.
 */
export async function readRecentThreads(): Promise<SlackRecentThread[]> {
  if (!slackUserToken()) throw new SlackError("no-key", slackUnavailable());
  noteSlackDemand();
  const ws = await readWorkspace();
  const self = ws.selfId;
  const users = new Map(ws.users.map((u) => [u.id, u]));
  const known = new Set(ws.conversations.map((c) => c.id));
  const newest = (id: string, t: Thread) => later(later(t.latest, t.reply?.ts), id.split(":")[1])!;
  const pick = (rec: Record_) =>
    Object.entries(rec.threads)
      .filter(([id]) => known.has(id.split(":")[0]))
      .sort((a, b) => Number(newest(b[0], b[1])) - Number(newest(a[0], a[1])))
      .slice(0, SLACK_ACTIVITY.recentThreads);
  // Asked before the record is read for its answer: nothing awaits between that load and its save.
  const found = new Map<string, { text: string; latest?: string }>();
  const ask = pick(load())
    .filter(([, t]) => t.text === undefined || (!t.text && Date.now() - (t.askedAt ?? 0) > SLACK_ACTIVITY.lookupRetryMs))
    .slice(0, SLACK_ACTIVITY.recentLookups);
  for (const [id] of ask) {
    const [channel, ts] = id.split(":");
    try {
      const r = await slackCall("conversations.replies", { channel, ts, limit: 1 });
      const parent = recOf(listOf(r.messages)[0]);
      const latest = typeof parent.latest_reply === "string" && /^\d+\.\d+$/.test(parent.latest_reply) ? parent.latest_reply : undefined;
      found.set(id, { text: plainText(typeof parent.text === "string" ? parent.text : "", users).slice(0, 120), latest });
    } catch (e) {
      // Limited or cooling down: the rest wait for a later read. Gone (thread_not_found…): not asked again for a while.
      if (e instanceof SlackError && (e.kind === "limited" || e.kind === "no-key" || e.kind === "refused")) break;
      found.set(id, { text: "" });
    }
  }
  const rec = load();
  if (found.size) {
    for (const [id, got] of found) {
      const t = rec.threads[id];
      if (!t) continue;
      t.text = got.text;
      if (!got.text) t.askedAt = Date.now();
      t.latest = later(got.latest, t.latest);
    }
    save(rec);
  }
  return pick(rec).map(([id, t]) => {
    const [conversationId, threadTs] = id.split(":");
    const unread = threadUnread(rec, conversationId, t, self);
    return {
      conversationId,
      threadTs,
      latest: newest(id, t),
      ...(t.text ? { text: t.text } : {}),
      unread,
      ...(unread && t.reply?.text.includes(`<@${self}>`) ? { mention: true } : {}),
    };
  });
}

/** You read a thread you're in up to `ts` (the Slack tab showed it): its replies from others to there are read. */
export function readSlackThread(conversationId: string, threadTs: string, ts: string): void {
  const rec = load();
  const thread = rec.threads[`${conversationId}:${threadTs}`];
  if (!thread) return;
  thread.readTs = later(ts, thread.readTs);
  if (thread.reply && Number(thread.reply.ts) <= Number(ts)) rec.unread = drop(rec.unread, keyOf(conversationId, thread.reply.ts));
  save(rec);
}

/** Slack's mrkdwn as words: people and channels by name, links by their text, entities decoded; clipped to 300. */
export function plainText(text: string, users: Map<string, SlackUser>): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(\|[^>]*)?>/g, (_m, id: string) => `@${users.get(id)?.name ?? id}`)
    .replace(/<#[CG][A-Z0-9]+\|([^>]*)>/g, "#$1")
    .replace(/<!(here|channel|everyone)(\|[^>]*)?>/g, "@$1")
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]*)>/g, "$1")
    .replace(/<([^>|]+)\|([^>]+)>/g, "$2")
    .replace(/<([^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** The newest mentions of you, from search (kept a minute), and the names search gives their channels. */
async function mentionHits(self: string): Promise<{ hits: SlackSearchHit[]; names: Map<string, string> }> {
  const token = slackUserToken() ?? "";
  if (mentionCache && mentionCache.token === token && Date.now() - mentionCache.at < SLACK_ACTIVITY.mentionsTtlMs)
    return mentionCache;
  // Reads at the same moment share one search.
  if (mentionLoad?.token === token) return mentionLoad.promise;
  const promise = searchMentions(self, token).finally(() => {
    if (mentionLoad?.promise === promise) mentionLoad = undefined;
  });
  mentionLoad = { token, promise };
  return promise;
}

async function searchMentions(self: string, token: string): Promise<{ hits: SlackSearchHit[]; names: Map<string, string> }> {
  const r = await slackCall("search.messages", {
    query: `<@${self}>`,
    sort: "timestamp",
    sort_dir: "desc",
    count: SLACK_ACTIVITY.mentions,
    highlight: false,
  });
  const matches = listOf(recOf(r.messages).matches);
  const hits = matches.map(searchHitOf).filter((h): h is SlackSearchHit => !!h);
  const names = new Map<string, string>();
  for (const m of matches) {
    const c = recOf(m.channel);
    if (typeof c.id === "string" && typeof c.name === "string" && /^[\w.-]{1,80}$/.test(c.name)) names.set(c.id, c.name);
  }
  mentionCache = { token, at: Date.now(), hits, names };
  return mentionCache;
}

const isDm = (c?: SlackConversation) => c?.kind === "im" || c?.kind === "mpim";
const where = (c: SlackConversation | undefined, id: string, name?: string) =>
  c ? (c.kind === "channel" || c.kind === "private" ? `#${c.name}` : c.name) : name ? `#${name}` : id;

/** A message's address in Slack (search gives permalinks; others are built). */
function permalink(ws: SlackWorkspace, conversationId: string, ts: string, threadTs?: string): string {
  const base = `${ws.url.replace(/\/$/, "")}/archives/${conversationId}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${base}?thread_ts=${threadTs}&cid=${conversationId}` : base;
}

function actorOf(users: Map<string, SlackUser>, userId?: string, botName?: string): ActivityItem["actor"] {
  const u = userId ? users.get(userId) : undefined;
  if (u) return { name: u.name, ...(u.avatarUrl ? { avatarUrl: `/api/slack/avatar?user=${u.id}` } : {}) };
  return botName ? { name: botName } : undefined;
}

/** The Slack items for Activity; throws a SlackError (kind no-key/refused/limited/failed) when Slack can't answer. */
export async function readSlackActivity(): Promise<ActivityItem[]> {
  if (!slackUserToken()) throw new SlackError("no-key", slackUnavailable());
  noteSlackDemand();
  const ws = await readWorkspace();
  const self = ws.selfId;
  const users = new Map(ws.users.map((u) => [u.id, u]));
  const conversations = new Map(ws.conversations.map((c) => [c.id, c]));
  // (b) Mentions of you outside DMs: search's newest, and live ones since.
  // Search is a scope of its own (search:read) and a slower tier: without it, DMs and live mentions still show.
  const found = await mentionHits(self).catch((e: unknown) => {
    if (e instanceof SlackError && e.kind === "no-key") throw e;
    return { hits: [] as SlackSearchHit[], names: new Map<string, string>() };
  });
  const hits: SlackMessage[] = [...liveMentions, ...found.hits].filter(
    (m) => m.userId !== self && !isDm(conversations.get(m.conversationId)) && !/^D/.test(m.conversationId),
  );
  const unknown = [...new Set(hits.map((h) => h.conversationId))].filter((id) => !lastReadOf(id));
  await ensureLastRead(unknown).catch(() => undefined);
  // Everything Slack is asked is asked above: from here to the save nothing awaits, so the record
  // can't change underneath (writes, live messages and followed threads load and save it whole too).
  const rec = load();
  const done = new Set(rec.done);
  const unreadKeys = new Set(rec.unread);
  const readKeys = new Set(rec.read);
  const items = new Map<string, ActivityItem>();
  let changed = false;
  const put = (item: ActivityItem) => {
    if (!done.has(item.key) && !items.has(item.key)) items.set(item.key, item);
  };

  // (a) DMs and group DMs with unread messages; read ones stay a while, as read.
  for (const c of ws.conversations) {
    if (!isDm(c)) continue;
    const state = unreadMessages(c.id);
    const newest = state?.messages?.at(-1);
    if (newest) {
      const seen = rec.dms[c.id];
      if (!seen || seen.ts !== newest.ts) {
        rec.dms[c.id] = { ts: newest.ts, ...(newest.userId ? { userId: newest.userId } : {}), text: newest.text, at: Date.now() };
        changed = true;
      }
    }
    const shown = newest ?? rec.dms[c.id];
    if (!shown) continue;
    if (!newest && Date.now() - rec.dms[c.id].at > SLACK_ACTIVITY.keepDmMs) {
      delete rec.dms[c.id];
      changed = true;
      continue;
    }
    const key = keyOf(c.id, shown.ts);
    const lastRead = state?.lastRead;
    const unread = unreadKeys.has(key) || (!!newest && (!lastRead || Number(newest.ts) > Number(lastRead)));
    put({
      key,
      source: "slack",
      id: `${c.id}:${shown.ts}`,
      kind: "dm",
      title: c.name,
      subtitle: plainText(shown.text, users),
      subject: "message",
      actor: actorOf(users, shown.userId),
      at: tsTime(shown.ts),
      unread,
      url: permalink(ws, c.id, shown.ts),
      open: { kind: "slack", conversationId: c.id, ts: shown.ts },
    });
  }

  // (b) Mentions of you outside DMs (asked for above).
  for (const m of hits) {
    const key = keyOf(m.conversationId, m.ts);
    const c = conversations.get(m.conversationId);
    const inThread = !!m.threadTs && m.threadTs !== m.ts;
    if (inThread) {
      const id = `${m.conversationId}:${m.threadTs}`;
      if (!rec.threads[id]) {
        rec.threads[id] = { at: Date.now() };
        changed = true;
      }
    }
    const lastRead = lastReadOf(m.conversationId);
    const thread = inThread ? rec.threads[`${m.conversationId}:${m.threadTs}`] : undefined;
    const readHere = readKeys.has(key) || (!!thread?.readTs && Number(thread.readTs) >= Number(m.ts));
    // Thread replies and conversations whose read state is unknown: by Slack's channel read point when known, else only recent ones.
    const unread =
      unreadKeys.has(key) ||
      (!readHere &&
        (lastRead
          ? Number(m.ts) > Number(lastRead)
          : Date.now() - Number(m.ts) * 1000 < SLACK_ACTIVITY.unknownUnreadMs));
    put({
      key,
      source: "slack",
      id: `${m.conversationId}:${m.ts}`,
      kind: "mention",
      title: `${inThread ? "Thread in " : ""}${where(c, m.conversationId, found.names.get(m.conversationId))}`,
      subtitle: plainText(m.text, users),
      subject: "message",
      actor: actorOf(users, m.userId, m.botName),
      at: tsTime(m.ts),
      unread,
      url: (m as SlackSearchHit).permalink ?? permalink(ws, m.conversationId, m.ts, m.threadTs),
      open: { kind: "slack", conversationId: m.conversationId, ts: m.ts, ...(inThread ? { threadTs: m.threadTs } : {}) },
    });
  }

  // (c) Replies from others in threads you're in.
  for (const [id, thread] of Object.entries(rec.threads)) {
    const reply = thread.reply;
    if (!reply || reply.userId === self) continue;
    const [conversationId, threadTs] = id.split(":");
    const key = keyOf(conversationId, reply.ts);
    const c = conversations.get(conversationId);
    const unread = threadUnread(rec, conversationId, thread, self);
    put({
      key,
      source: "slack",
      id: `${conversationId}:${reply.ts}`,
      kind: "thread",
      title: `Thread in ${where(c, conversationId)}`,
      subtitle: plainText(reply.text, users),
      subject: "message",
      actor: actorOf(users, reply.userId),
      at: tsTime(reply.ts),
      unread,
      url: permalink(ws, conversationId, reply.ts, threadTs),
      open: { kind: "slack", conversationId, ts: reply.ts, threadTs },
    });
  }
  if (changed) save(rec);
  return [...items.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/**
 * Marks Slack items read or unread, or done (read, and left out of Activity
 * from then). Read moves Slack's own read point for DMs and mentions outside
 * threads (`conversations.mark`, never backwards past what's already read);
 * thread items are kept here. Unread is kept here only: Slack's API can't
 * mark a message unread.
 */
export async function writeSlackActivity(name: ActivityWriteName, items: ActivityItem[]): Promise<void> {
  const rec = load();
  const marks = new Map<string, string>();
  for (const item of items) {
    const open = item.open?.kind === "slack" ? item.open : undefined;
    const ts = open?.ts;
    if (!open || !ts) continue;
    if (name === "unread") {
      rec.unread = add(rec.unread, item.key);
      rec.read = drop(rec.read, item.key);
      continue;
    }
    rec.unread = drop(rec.unread, item.key);
    if (name === "done") rec.done = add(rec.done, item.key);
    const inThread = !!open.threadTs && open.threadTs !== ts;
    if (inThread) {
      const id = `${open.conversationId}:${open.threadTs}`;
      const thread = (rec.threads[id] ??= { at: Date.now() });
      thread.readTs = later(ts, thread.readTs);
      rec.read = add(rec.read, item.key);
    } else {
      if (item.kind === "mention") rec.read = add(rec.read, item.key);
      marks.set(open.conversationId, later(ts, marks.get(open.conversationId)) ?? ts);
    }
  }
  save(rec);
  let failure: unknown;
  for (const [conversationId, ts] of marks) {
    const lastRead = lastReadOf(conversationId);
    if (lastRead && Number(lastRead) >= Number(ts)) continue;
    try {
      await slackCall("conversations.mark", { channel: conversationId, ts }, { essential: true });
      noteMarked(conversationId, ts);
    } catch (e) {
      failure ??= e;
    }
  }
  if (failure) throw failure instanceof SlackError ? failure : new SlackError("failed", "Slack didn't mark it read.");
}
