/**
 * Slack's named reads: the workspace (you, people, your conversations, custom
 * emoji), a conversation's history, a thread's replies, one conversation, and
 * message search. Each throws a SlackError when Slack can't answer; the
 * workspace is kept for ten minutes (`fresh` asks again). Every read is
 * demand: it wakes the unread queue and the socket.
 */
import type {
  SlackConversation,
  SlackHistory,
  SlackMessage,
  SlackSearch,
  SlackSearchHit,
  SlackThread,
  SlackUser,
  SlackWorkspace,
} from "../../src/slack/types";
import { SlackError, slackCall, slackUserToken } from "./client";
import { noteSlackDemand } from "./events";
import { conversationOf, httpsUrl, listOf, messageOf, recOf, strOf, tsOf, userOf, type People } from "./normalize";
import { slackLive } from "./live";
import { mergeUnreads, noteHistory, noteLastRead, trackSlackConversations } from "./unreads";

export const SLACK_READS = {
  workspaceTtlMs: 10 * 60_000,
  pageSize: 200,
  /** At most this many pages of people and of conversations (4,000 each). */
  maxPages: 20,
  historySize: 50,
  repliesSize: 200,
  searchSize: 50,
};

export const CONVERSATION_ID = /^[CDG][A-Z0-9]{2,20}$/;
export const USER_ID = /^[UWB][A-Z0-9]{2,20}$/;
export const TS_PATTERN = /^\d{9,11}\.\d{6}$/;

type Self = { token: string; selfId: string; teamId: string; teamName: string; url: string };
let self: Self | undefined;
type Kept = { token: string; at: number; value: Omit<SlackWorkspace, "live">; handles: Map<string, string> };
let kept: Kept | undefined;
let loading: { token: string; promise: Promise<Omit<SlackWorkspace, "live">> } | undefined;

/**
 * People messages name who aren't the workspace's members (a shared channel's,
 * from another organisation), by id: as a message's own profile or users.info
 * gave them, or null when Slack didn't know them. Kept an hour.
 */
const strangers = new Map<string, { at: number; user: SlackUser | null }>();
const STRANGERS = { keepMs: 60 * 60_000, lookupsPerRead: 20, atOnce: 5 };

/** Forgets what the reads kept (tests). */
export function resetSlackReads(): void {
  self = undefined;
  kept = undefined;
  loading = undefined;
  strangers.clear();
}

/** Someone from elsewhere a read named (a shared channel's), as Slack described them; undefined if none has. */
export const slackStranger = (id: string): SlackUser | undefined => strangers.get(id)?.user ?? undefined;

/** Learns people from the profile Slack attaches to some messages (a shared channel's especially). */
function learnProfiles(raw: unknown[]): void {
  for (const m of raw.map(recOf)) {
    const id = strOf(m.user);
    const profile = recOf(m.user_profile);
    if (!id || !Object.keys(profile).length || strangers.get(id)?.user) continue;
    const user = userOf({ id, name: profile.name, profile });
    if (user) strangers.set(id, { at: Date.now(), user });
  }
}

/**
 * The people messages name (senders, repliers, reactors) whom the workspace
 * doesn't list: from their messages' own profiles, else looked up once each
 * (users.info, at most 20 a read, a few at a time). Slack's refusals other
 * than "no such person" leave them for the next read.
 */
async function strangersIn(messages: SlackMessage[], raw: unknown[]): Promise<SlackUser[]> {
  if (!kept) await readWorkspace().catch(() => undefined);
  const members = new Set(kept?.value.users.map((u) => u.id));
  const ids = new Set<string>();
  for (const m of messages)
    for (const id of [m.userId, ...(m.replyUserIds ?? []), ...(m.reactions ?? []).flatMap((r) => r.userIds)])
      if (id && !members.has(id)) ids.add(id);
  if (!ids.size) return [];
  learnProfiles(raw);
  const now = Date.now();
  const ask = [...ids]
    .filter((id) => {
      const known = strangers.get(id);
      return !known || now - known.at > STRANGERS.keepMs;
    })
    .slice(0, STRANGERS.lookupsPerRead);
  for (let i = 0; i < ask.length; i += STRANGERS.atOnce)
    await Promise.all(
      ask.slice(i, i + STRANGERS.atOnce).map(async (id) => {
        try {
          const r = await slackCall("users.info", { user: id });
          strangers.set(id, { at: Date.now(), user: userOf(r.user) });
        } catch (e) {
          if (e instanceof SlackError && (e.code === "user_not_found" || e.code === "users_not_found"))
            strangers.set(id, { at: Date.now(), user: null });
        }
      }),
    );
  return [...ids].map((id) => strangers.get(id)?.user ?? null).filter(nonNull);
}

/** You and your workspace (`auth.test`), kept per token. */
export async function slackSelf(): Promise<Self> {
  const token = slackUserToken() ?? "";
  if (self && self.token === token) return self;
  const a = await slackCall("auth.test");
  const selfId = strOf(a.user_id);
  if (!USER_ID.test(selfId)) throw new SlackError("failed", "Slack didn't say who you are.");
  self = {
    token,
    selfId,
    teamId: strOf(a.team_id),
    teamName: strOf(a.team).slice(0, 120),
    url: httpsUrl(a.url) ?? "https://slack.com/",
  };
  return self;
}

/** Every page of a cursor-paged list method, up to `SLACK_READS.maxPages`. */
async function paged(method: string, params: Record<string, string | number | boolean>, key: string): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor = "";
  for (let page = 0; page < SLACK_READS.maxPages; page++) {
    const r = await slackCall(method, { ...params, limit: SLACK_READS.pageSize, ...(cursor ? { cursor } : {}) });
    const items = r[key];
    if (Array.isArray(items)) out.push(...items);
    cursor = strOf(recOf(r.response_metadata).next_cursor);
    if (!cursor) break;
  }
  return out;
}

const nonNull = <T>(v: T | null): v is T => v !== null;

/** People by id and handle, for naming DMs and group DMs. */
function peopleOf(selfId: string, users: SlackUser[], handles: Map<string, string>): People {
  return { selfId, byId: new Map(users.map((u) => [u.id, u])), byHandle: handles };
}

/** Custom emoji: name → an https image address, or "alias:other". */
function emojiOf(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(recOf(raw))) {
    if (!/^[a-z0-9_+'-]{1,100}$/.test(name) || typeof value !== "string") continue;
    if (/^alias:[a-z0-9_+'-]{1,100}$/.test(value)) out[name] = value;
    else if (httpsUrl(value)) out[name] = httpsUrl(value)!;
  }
  return out;
}

/** The workspace: you, people, your conversations with their known read state, custom emoji and how live it is. */
export async function readWorkspace(fresh = false): Promise<SlackWorkspace> {
  noteSlackDemand();
  const token = slackUserToken() ?? "";
  if (!fresh && kept && kept.token === token && Date.now() - kept.at < SLACK_READS.workspaceTtlMs) return withState(kept.value);
  // Reads at the same moment share one sweep (a cold start would otherwise page everything several times over).
  if (loading?.token !== token) {
    const promise = loadWorkspace(token).finally(() => {
      if (loading?.promise === promise) loading = undefined;
    });
    loading = { token, promise };
  }
  return withState(await loading.promise);
}

async function loadWorkspace(token: string): Promise<Omit<SlackWorkspace, "live">> {
  const me = await slackSelf();
  const rawUsers = await paged("users.list", {}, "members");
  const handles = new Map<string, string>();
  for (const u of rawUsers.map(recOf)) if (typeof u.id === "string" && typeof u.name === "string") handles.set(u.name, u.id);
  const users = rawUsers.map(userOf).filter(nonNull);
  const people = peopleOf(me.selfId, users, handles);
  // Everything users.conversations lists is one you're in (Slack leaves is_member out of this method's answer).
  const rawConversations = await paged(
    "users.conversations",
    { types: "public_channel,private_channel,mpim,im", exclude_archived: true },
    "channels",
  );
  const conversations = rawConversations.map((c) => conversationOf({ ...recOf(c), is_member: true }, people)).filter(nonNull);
  let emoji: Record<string, string> = {};
  try {
    emoji = emojiOf((await slackCall("emoji.list")).emoji);
  } catch (e) {
    // Custom emoji are a nicety: a token without emoji:read still shows the rest.
    if (!(e instanceof SlackError) || e.kind === "no-key") throw e;
  }
  const value = { teamId: me.teamId, teamName: me.teamName, url: me.url, selfId: me.selfId, users, conversations, emoji };
  kept = { token, at: Date.now(), value, handles };
  trackSlackConversations(conversations, me.selfId, true);
  return value;
}

/** The kept workspace with the unread tracker's state and the socket's liveness laid over it. */
function withState(value: Omit<SlackWorkspace, "live">): SlackWorkspace {
  return { ...value, conversations: value.conversations.map(mergeUnreads), live: slackLive() };
}

/** The workspace kept now, without asking Slack (undefined before the first read). */
export const keptWorkspace = (): Omit<SlackWorkspace, "live"> | undefined =>
  kept && kept.token === (slackUserToken() ?? "") ? kept.value : undefined;

/** Puts a changed or new person into the kept workspace. */
export function keepUser(user: SlackUser): void {
  if (!kept) return;
  const users = kept.value.users.filter((u) => u.id !== user.id);
  kept.value = { ...kept.value, users: [...users, user] };
}

/** Puts a changed or new conversation into the kept workspace (and the unread tracker). */
export function keepConversation(conversation: SlackConversation): void {
  if (!kept) return;
  const others = kept.value.conversations.filter((c) => c.id !== conversation.id);
  kept.value = { ...kept.value, conversations: [...others, conversation] };
  trackSlackConversations([conversation], kept.value.selfId);
}

/** Builds a conversation from Slack's record with the kept people (names for DMs and group DMs). */
export function conversationFrom(raw: unknown): SlackConversation | null {
  const value = kept?.value;
  return conversationOf(raw, peopleOf(value?.selfId ?? self?.selfId ?? "", value?.users ?? [], kept?.handles ?? new Map()));
}

const checkConversation = (id: string) => {
  if (!CONVERSATION_ID.test(id)) throw new SlackError("invalid", "Unknown conversation.");
};
const checkTs = (ts: string | undefined, name: string) => {
  if (ts !== undefined && !TS_PATTERN.test(ts)) throw new SlackError("invalid", `${name} must be a message ts.`);
};

/** A conversation's messages, oldest first, 50 at a time; `before` is the oldest ts already shown (exclusive). */
export async function readHistory(conversationId: string, before?: string): Promise<SlackHistory> {
  checkConversation(conversationId);
  checkTs(before, "before");
  noteSlackDemand();
  const r = await slackCall("conversations.history", {
    channel: conversationId,
    limit: SLACK_READS.historySize,
    ...(before ? { latest: before, inclusive: false } : {}),
  });
  const raw = listOf(r.messages);
  const messages = raw
    .map((m) => messageOf(m, conversationId))
    .filter(nonNull)
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  if (!before) noteHistory(conversationId, messages);
  const users = await strangersIn(messages, raw);
  return { messages, more: r.has_more === true, ...(users.length ? { users } : {}) };
}

/** A thread: its parent and replies, oldest first; `after` is the newest reply already shown (exclusive). */
export async function readReplies(conversationId: string, ts: string, after?: string): Promise<SlackThread> {
  checkConversation(conversationId);
  checkTs(ts, "ts");
  if (!ts) throw new SlackError("invalid", "ts must be a message ts.");
  checkTs(after, "after");
  noteSlackDemand();
  const r = await slackCall("conversations.replies", {
    channel: conversationId,
    ts,
    limit: SLACK_READS.repliesSize,
    ...(after ? { oldest: after, inclusive: false } : {}),
  });
  const raw = listOf(r.messages);
  const all = raw.map((m) => messageOf(m, conversationId)).filter(nonNull);
  const parent = all.find((m) => m.ts === ts);
  const replies = all
    .filter((m) => m.ts !== ts && (!after || Number(m.ts) > Number(after)))
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const users = await strangersIn(all, raw);
  return { ...(parent ? { parent } : {}), replies, more: r.has_more === true, ...(users.length ? { users } : {}) };
}

/** One conversation, with where you've read to (`conversations.info` gives user tokens `last_read`). */
export async function readConversation(id: string): Promise<SlackConversation> {
  checkConversation(id);
  noteSlackDemand();
  if (!kept) await readWorkspace().catch(() => undefined);
  const r = await slackCall("conversations.info", { channel: id, include_num_members: true });
  const conversation = conversationFrom(r.channel);
  if (!conversation) throw new SlackError("failed", "Slack didn't describe that conversation.");
  if (conversation.lastRead) noteLastRead(id, conversation.lastRead, conversation.latest);
  return mergeUnreads(conversation);
}

/** Messages matching `term` across the workspace, newest first (`search.messages`, user tokens only). */
export async function readSearch(raw: string): Promise<SlackSearch> {
  const term = raw.trim();
  if (!term || term.length > 500) throw new SlackError("invalid", "Search for 1 to 500 characters.");
  noteSlackDemand();
  const r = await slackCall("search.messages", {
    query: term,
    sort: "timestamp",
    sort_dir: "desc",
    count: SLACK_READS.searchSize,
    highlight: false,
  });
  const box = recOf(r.messages);
  const matches = listOf(box.matches);
  const messages = matches.map(searchHitOf).filter(nonNull);
  const users = await strangersIn(messages, matches);
  return { term, messages, total: typeof box.total === "number" ? box.total : messages.length, ...(users.length ? { users } : {}) };
}

/** One `search.messages` match as a message, with its conversation, permalink and (from it) its thread. */
export function searchHitOf(raw: unknown): SlackSearchHit | null {
  const m = recOf(raw);
  const conversationId = strOf(recOf(m.channel).id);
  if (!CONVERSATION_ID.test(conversationId)) return null;
  const message: SlackMessage | null = messageOf(m, conversationId);
  if (!message) return null;
  const permalink = httpsUrl(m.permalink);
  let threadTs = message.threadTs;
  if (!threadTs && permalink) threadTs = tsOf(new URL(permalink).searchParams.get("thread_ts"));
  return { ...message, ...(threadTs ? { threadTs } : {}), ...(permalink ? { permalink } : {}) };
}
