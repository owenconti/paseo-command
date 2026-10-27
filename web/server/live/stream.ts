/**
 * The push stream: every open channel, the fleet as last sent to them and
 * the patches that bring them up to date, and the routes that open
 * channels.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { WebSocket } from "ws";
import { listeners as fleetListeners } from "../fleet";
import { messageOf } from "../errors";
import { stamp } from "../versioned";
import { fieldOf, isRecord } from "./client";
import { Channel, SseChannel, WsChannel } from "./channel";
import { setOnChange } from "./hub";
import { unwatchSid, watch, type SessionSource } from "./sessions";
import { LIVE } from "./tuning";
import {
  currentView,
  resetMessage,
  rowOf,
  setSource,
  type Group,
  type Row,
  type View,
  type ViewSource,
} from "./view";

export const channels = new Set<Channel>();
/** What every fleet channel has been sent, per resource and host. */
let sent: View | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let tickTimer: ReturnType<typeof setInterval> | undefined;
let beatTimer: ReturnType<typeof setInterval> | undefined;

const fleetChannels = () => [...channels].filter((c) => c.fleet);
function currentFleetView() {
  if (fleetChannels().length) flush();
  return sent ?? currentView();
}

/** Compare the view with what was sent; send the difference to every fleet channel. */
export function flush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = undefined;
  const targets = fleetChannels();
  if (!targets.length) {
    sent = undefined;
    return;
  }
  const next = currentView();
  const before = sent;
  sent = next;
  if (!before) return;
  const now = Date.now();
  for (const [resource, byHost] of next.groups) {
    const was = before.groups.get(resource) ?? new Map<string, Group>();
    for (const host of new Set([...was.keys(), ...byHost.keys()])) {
      const a = was.get(host) ?? { order: [], rows: new Map(), rev: 0 };
      const b = byHost.get(host) ?? {
        order: [],
        rows: new Map(),
        rev: stamp(`${resource}|${host}`, []),
      };
      const upsert: Row[] = [];
      for (const id of b.order)
        if (a.rows.get(id) !== b.rows.get(id)) upsert.push(rowOf(b, id, now));
      const remove = a.order.filter((id) => !b.rows.has(id));
      const reordered =
        a.order.length !== b.order.length ||
        a.order.some((id, i) => b.order[i] !== id);
      if (!upsert.length && !remove.length && !reordered) continue;
      const patch = {
        rev: b.rev,
        resource,
        host,
        upsert,
        remove,
        ...(reordered ? { order: b.order } : {}),
      };
      for (const c of targets) c.send("patch", patch);
    }
  }
  if (next.status.rev !== before.status.rev)
    for (const c of targets)
      c.send("status", { rev: next.status.rev, status: next.status.value });
}

/** Coalesce changes into one patch. */
export function schedule() {
  if (!fleetChannels().length || flushTimer) return;
  flushTimer = setTimeout(flush, LIVE.coalesceMs);
  flushTimer.unref?.();
}

/** Wire the hub to the API's view of hosts. */
export function configureLive(v: ViewSource) {
  setSource(v);
  setOnChange(schedule);
  // A fetched snapshot landing (reads while a feed is down) is a change too.
  fleetListeners.snapshot = () => schedule();
}

/** Repeating work owned by the hub: cleared with it, on reload or shutdown. */
const intervals = new Set<ReturnType<typeof setInterval>>();
export function liveInterval(fn: () => void, ms: number) {
  const t = setInterval(fn, ms);
  t.unref?.();
  intervals.add(t);
  return () => {
    clearInterval(t);
    intervals.delete(t);
  };
}

function ensureTimers() {
  // Staleness that comes with age, and keep-alives for idle channels.
  tickTimer ??= setInterval(() => {
    if (fleetChannels().length) flush();
  }, LIVE.tickMs);
  tickTimer.unref?.();
  beatTimer ??= setInterval(() => {
    for (const c of [...channels]) c.heartbeat();
  }, LIVE.heartbeatMs);
  beatTimer.unref?.();
}
export function stopTimers() {
  if (tickTimer) clearInterval(tickTimer);
  if (beatTimer) clearInterval(beatTimer);
  if (flushTimer) clearTimeout(flushTimer);
  tickTimer = beatTimer = flushTimer = undefined;
}

function sseHeaders(res: ServerResponse) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`retry: 2000\n\n`);
}
/** A fleet channel's full picture: the fleet as a reset. */
export function sendFleetReset(c: Channel) {
  if (c.fleet) c.send("reset", resetMessage(currentFleetView()));
}
function join(c: Channel) {
  channels.add(c);
  ensureTimers();
  sendFleetReset(c);
}

/** `GET /api/live`: the fleet as a reset, then patches. */
export function streamFleet(req: IncomingMessage, res: ServerResponse) {
  sseHeaders(res);
  const c = new SseChannel(res, true);
  join(c);
  const drop = () => c.close();
  req.on("close", drop);
  res.on("close", drop);
  return c;
}

/** `GET /api/agents/:id/live`: one session, over SSE. */
export function streamSession(
  req: IncomingMessage,
  res: ServerResponse,
  s: SessionSource,
) {
  sseHeaders(res);
  const c = new SseChannel(res, false);
  join(c);
  watch(c, s);
  const drop = () => c.close();
  req.on("close", drop);
  res.on("close", drop);
  return c;
}

/** A browser's request to watch a session, as it sent it (validated by `resolve`). */
export type WatchRequest = {
  type: "watch";
  sid: string;
  agentId?: unknown;
  host?: unknown;
  [field: string]: unknown;
};
const isWatchRequest = (msg: unknown): msg is WatchRequest =>
  fieldOf(msg, "type") === "watch";

/**
 * `/api/ws`: one WebSocket per tab carrying the fleet and the sessions it
 * asks for (`{type:"watch"|"unwatch", sid, agentId, host?}`). `resolve`
 * turns a watch request into a session source (validated by the API) or
 * throws.
 */
export function socketChannel(
  ws: WebSocket,
  resolve: (msg: WatchRequest) => SessionSource,
) {
  const c = new WsChannel(ws);
  join(c);
  ws.on("message", (raw) => {
    let msg: unknown;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    const field = fieldOf(msg, "sid");
    const sid =
      typeof field === "string" && field.length <= 200 ? field : undefined;
    if (!sid || !isRecord(msg)) return;
    if (msg.type === "unwatch") return unwatchSid(c, sid);
    if (!isWatchRequest(msg)) return;
    const refuse = (error: string) =>
      c.send("session", {
        sid,
        event: "state",
        data: { live: false, error, refused: true },
      });
    if (c.watches.size >= LIVE.maxWatches)
      return refuse("Too many open sessions.");
    let s: SessionSource;
    try {
      s = resolve(msg);
    } catch (e) {
      return refuse(String(messageOf(e) || e));
    }
    if (!c.closed) watch(c, s, sid);
  });
  const drop = () => c.close();
  ws.on("close", drop);
  ws.on("error", drop);
  return c;
}

/** Channels connected right now (tests, diagnostics). */
export const pushClients = () => channels.size;
export const channelList = () => [...channels];

/** Close every channel and drop what the stream holds (shutdown or reload). */
export function stopStream() {
  for (const c of [...channels]) c.close();
  channels.clear();
  stopTimers();
  for (const t of intervals) clearInterval(t);
  intervals.clear();
  fleetListeners.snapshot = () => {};
  setSource(undefined);
  setOnChange(() => {});
  sent = undefined;
}
