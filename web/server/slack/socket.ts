/**
 * Slack's Socket Mode: live events over a WebSocket opened with the app
 * token (`apps.connections.open` gives a `wss` address). Every envelope is
 * acknowledged at once; `disconnect` (Slack's routine refresh) reconnects at
 * once, a dropped socket after a backoff (1 s doubling to 60 s). Events
 * become `SlackEvent`s for the pages and update the kept workspace and the
 * unread tracker. It runs only while Slack is enabled, an app token exists
 * and something wants Slack (a page listening, or a read or Activity within
 * the last few minutes); otherwise it closes. Without it the pages poll.
 */
import type { SlackEvent, SlackMessage } from "../../src/slack/types";
import { noteSlackActivityMessage } from "../activity/slack";
import { SLACK, SlackError, slackAppToken, slackCall, slackEnabled, type SlackSocket } from "./client";
import { emitSlack, onSlackDemand, slackWanted } from "./events";
import { setSlackLive } from "./live";
import { messageOf, reactionsOf, recOf, strOf, tsOf, userOf } from "./normalize";
import { conversationFrom, keepConversation, keepUser, keptWorkspace, slackSelf } from "./reads";
import { noteDeleted, noteMarked, noteMessage, setUnreadsLive } from "./unreads";

export const SOCKET = {
  minBackoffMs: 1_000,
  maxBackoffMs: 60_000,
  /** How often to see whether the socket is still wanted. */
  idleCheckMs: 30_000,
  /** From asking for a connection to Slack's hello: longer, and the attempt is given up and tried again. */
  connectTimeoutMs: 30_000,
  /** How often to ping Slack and look for silence. */
  pingMs: 10_000,
  /** No frame at all (message, ping or pong) for this long: the connection is dead. */
  staleMs: 30_000,
};

let socket: SlackSocket | undefined;
/** The connection Slack asked to replace (`disconnect`), kept until the new one says hello. */
let retiring: SlackSocket | undefined;
let state: "idle" | "connecting" | "open" = "idle";
let backoff = SOCKET.minBackoffMs;
let retry: ReturnType<typeof setTimeout> | undefined;
let idleTimer: ReturnType<typeof setInterval> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
let watchdog: ReturnType<typeof setInterval> | undefined;
/** When the current socket last heard anything. */
let heardAt = 0;
/** An open connection was lost: the next hello asks the pages to read again (events may have been missed). */
let gap = false;
/** Bumped on every close, so a late answer from an old connection is ignored. */
let generation = 0;

/** Whether events arrive live now (a routine refresh keeps the old connection until the new one is up). */
export const slackSocketOpen = () => state === "open" || !!retiring;
setUnreadsLive(slackSocketOpen);

/** Closes the socket and forgets everything (tests). */
export function resetSlackSocket(): void {
  stop();
  gap = false;
  backoff = SOCKET.minBackoffMs;
}

function quietly(s: SlackSocket | undefined, code?: number): void {
  try {
    s?.close(code);
  } catch {
    // Already closed.
  }
}

function clearTimers(): void {
  if (deadline) clearTimeout(deadline);
  if (watchdog) clearInterval(watchdog);
  deadline = watchdog = undefined;
}

function stop(reason?: string): void {
  generation++;
  clearTimers();
  if (retry) clearTimeout(retry);
  if (idleTimer) clearInterval(idleTimer);
  retry = idleTimer = undefined;
  const s = socket;
  const old = retiring;
  socket = retiring = undefined;
  state = "idle";
  quietly(s, 1000);
  quietly(old, 1000);
  if (reason) setSlackLive({ mode: "polling", reason });
}

/** Opens the socket if Slack, an app token and demand are all there; closes it when not. */
export function ensureSlackSocket(): void {
  if (!slackEnabled() || !slackAppToken() || !slackWanted()) {
    if (state !== "idle" || retry || retiring)
      stop(slackEnabled() && slackAppToken() ? "Live updates pause while Slack isn't in use." : undefined);
    return;
  }
  if (state !== "idle" || retry) return;
  void connect();
}

/** Gives up this connection (and any being replaced) and tries again after the backoff, doubling it up to a minute. */
function later(reason: string): void {
  const gen = ++generation;
  if (state === "open" || retiring) gap = true;
  clearTimers();
  const s = socket;
  const old = retiring;
  socket = retiring = undefined;
  state = "idle";
  quietly(s);
  quietly(old);
  setSlackLive({ mode: "polling", reason });
  if (retry) clearTimeout(retry);
  retry = setTimeout(() => {
    retry = undefined;
    if (gen === generation) ensureSlackSocket();
  }, backoff);
  retry.unref?.();
  backoff = Math.min(backoff * 2, SOCKET.maxBackoffMs);
}

async function connect(): Promise<void> {
  state = "connecting";
  const gen = generation;
  // A connection that never says hello (a stalled request, handshake or greeting) is given up.
  if (deadline) clearTimeout(deadline);
  deadline = setTimeout(() => {
    deadline = undefined;
    if (gen === generation && state === "connecting") later("Slack didn't answer the live connection; trying again.");
  }, SOCKET.connectTimeoutMs);
  deadline.unref?.();
  let url: string;
  try {
    const r = await slackCall("apps.connections.open", {}, { token: "app", essential: true });
    url = strOf(r.url);
    if (!/^wss:\/\//.test(url)) throw new SlackError("failed", "Slack didn't give a socket address.");
  } catch (e) {
    if (gen !== generation) return;
    const message = e instanceof SlackError && e.kind === "refused" ? "Slack refused the app token." : "Couldn't connect to Slack for live updates.";
    return later(message);
  }
  if (gen !== generation) return;
  let s: SlackSocket;
  try {
    s = SLACK.connect(url);
  } catch {
    return later("Couldn't connect to Slack for live updates.");
  }
  socket = s;
  heardAt = Date.now();
  idleTimer ??= setInterval(() => ensureSlackSocket(), SOCKET.idleCheckMs);
  idleTimer.unref?.();
  const live = () => s === socket || s === retiring;
  const heard = () => {
    if (s === socket) heardAt = Date.now();
  };
  s.on("message", (data) => {
    if (!live()) return;
    heard();
    void onEnvelope(s, data);
  });
  s.on("ping", heard);
  s.on("pong", heard);
  s.on("close", () => {
    if (s === retiring) {
      retiring = undefined;
      return;
    }
    if (s !== socket) return;
    later("The live connection to Slack dropped; reconnecting.");
  });
  s.on("error", () => {
    if (s === retiring) {
      retiring = undefined;
      quietly(s);
      return;
    }
    if (s !== socket) return;
    later("The live connection to Slack failed; reconnecting.");
  });
}

/** Pings Slack now and then; silence past `staleMs` means the connection is dead (no close ever comes). */
function watch(s: SlackSocket): void {
  if (watchdog) clearInterval(watchdog);
  watchdog = setInterval(() => {
    if (s !== socket) return;
    if (Date.now() - heardAt > SOCKET.staleMs) return later("The live connection to Slack went quiet; reconnecting.");
    try {
      s.ping?.();
    } catch {
      // The close handler reconnects.
    }
  }, SOCKET.pingMs);
  watchdog.unref?.();
}

async function onEnvelope(s: SlackSocket, data: unknown): Promise<void> {
  let envelope: Record<string, unknown>;
  try {
    envelope = recOf(JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data)));
  } catch {
    return;
  }
  const id = strOf(envelope.envelope_id);
  if (id) {
    try {
      s.send(JSON.stringify({ envelope_id: id }));
    } catch {
      // The close handler reconnects.
    }
  }
  switch (envelope.type) {
    case "hello": {
      if (s !== socket) return;
      if (deadline) clearTimeout(deadline);
      deadline = undefined;
      state = "open";
      heardAt = Date.now();
      watch(s);
      backoff = SOCKET.minBackoffMs;
      // The connection being replaced can go now that this one is up.
      const old = retiring;
      retiring = undefined;
      quietly(old, 1000);
      setSlackLive({ mode: "socket" });
      // Only after a real drop could events have been missed; a routine refresh overlaps.
      if (gap) emitSlack({ type: "resync" });
      gap = false;
      return;
    }
    case "disconnect": {
      // Slack refreshes connections now and then: open the new one first, close this one once it says hello.
      if (s !== socket || state !== "open") return;
      retiring = s;
      socket = undefined;
      clearTimers();
      state = "idle";
      backoff = SOCKET.minBackoffMs;
      if (!slackEnabled() || !slackAppToken() || !slackWanted()) return stop();
      void connect();
      return;
    }
    case "events_api":
      try {
        await onEvent(recOf(recOf(envelope.payload).event));
      } catch {
        // An event that can't be followed up is dropped; the next read catches up.
      }
      return;
  }
}

const channelOf = (e: Record<string, unknown>) => strOf(e.channel) || strOf(recOf(e.item).channel);

/** One Events API event, as `SlackEvent`s and updates to what's kept. */
export async function onEvent(e: Record<string, unknown>): Promise<void> {
  switch (e.type) {
    case "message":
      return onMessage(e);
    case "reaction_added":
    case "reaction_removed": {
      const item = recOf(e.item);
      const conversationId = strOf(item.channel);
      const ts = tsOf(item.ts);
      if (item.type !== "message" || !conversationId || !ts) return;
      try {
        const r = await slackCall("reactions.get", { channel: conversationId, timestamp: ts, full: true });
        emitSlack({ type: "reaction", conversationId, ts, reactions: reactionsOf(recOf(r.message).reactions) ?? [] });
      } catch {
        emitSlack({ type: "resync" });
      }
      return;
    }
    case "channel_marked":
    case "group_marked":
    case "im_marked":
    case "mpim_marked": {
      const conversationId = channelOf(e);
      const ts = tsOf(e.ts);
      if (!conversationId || !ts) return;
      noteMarked(conversationId, ts);
      emitSlack({ type: "marked", conversationId, lastRead: ts });
      return;
    }
    case "user_change": {
      const user = userOf(e.user);
      if (!user) return;
      keepUser(user);
      emitSlack({ type: "user", user });
      return;
    }
    case "channel_rename":
    case "group_rename": {
      const raw = recOf(e.channel);
      const known = keptWorkspace()?.conversations.find((c) => c.id === strOf(raw.id));
      const name = strOf(raw.name).slice(0, 120);
      if (!known || !name) return;
      const conversation = { ...known, name };
      keepConversation(conversation);
      emitSlack({ type: "conversation", conversation });
      return;
    }
    case "member_joined_channel": {
      const me = await slackSelf().catch(() => undefined);
      if (!me || strOf(e.user) !== me.selfId) return;
      const r = await slackCall("conversations.info", { channel: strOf(e.channel), include_num_members: true });
      // You've just joined it.
      const conversation = conversationFrom({ ...recOf(r.channel), is_member: true });
      if (!conversation) return;
      keepConversation(conversation);
      emitSlack({ type: "conversation", conversation });
      return;
    }
  }
}

function onMessage(e: Record<string, unknown>): void {
  const conversationId = strOf(e.channel);
  if (!conversationId) return;
  let event: SlackEvent | undefined;
  switch (e.subtype) {
    case "message_changed":
    case "message_replied": {
      const message = messageOf(e.message, conversationId);
      if (message) event = { type: "changed", message };
      break;
    }
    case "message_deleted": {
      const ts = tsOf(e.deleted_ts);
      if (!ts) return;
      const threadTs = tsOf(recOf(e.previous_message).thread_ts);
      noteDeleted(conversationId, ts);
      event = { type: "deleted", conversationId, ts, ...(threadTs && threadTs !== ts ? { threadTs } : {}) };
      break;
    }
    default: {
      const message: SlackMessage | null = messageOf(e, conversationId);
      if (!message) return;
      noteMessage(message);
      noteSlackActivityMessage(message, strOf(e.parent_user_id) || undefined);
      event = { type: "message", message };
    }
  }
  if (event) emitSlack(event);
}

onSlackDemand(ensureSlackSocket);
