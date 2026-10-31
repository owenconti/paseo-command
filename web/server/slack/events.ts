/**
 * The Slack server's event hub and demand. Pages listen on `GET /api/slack/events`
 * (server-sent events, one `SlackEvent` JSON object each, `live` first, a
 * `: ping` comment every 25 s); the server's own parts (Activity) listen in
 * process. Demand is when something last asked for Slack (a page's read, the
 * events stream, Activity): the unread queue and the socket run only while
 * there is some, so nothing reaches Slack while the app sits idle.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SlackEvent, SlackLive } from "../../src/slack/types";

export const SLACK_EVENTS = { pingMs: 25_000, demandMs: 5 * 60_000 };

type Listener = (event: SlackEvent) => void;
const pages = new Set<Listener>();
const internal = new Set<Listener>();
const wakers = new Set<() => void>();
let demandAt = 0;

/** Sends `event` to every page and in-process listener. */
export function emitSlack(event: SlackEvent): void {
  for (const fn of [...pages, ...internal]) {
    try {
      fn(event);
    } catch {
      // A listener's failure never stops the others.
    }
  }
}

/** Listens in process (Activity); never counts as a page. Returns the way to stop. */
export function onSlackEvent(fn: Listener): () => void {
  internal.add(fn);
  return () => void internal.delete(fn);
}

/** Pages listening now. */
export const slackListeners = () => pages.size;

/** Something asked for Slack: wakes the unread queue and the socket. */
export function noteSlackDemand(): void {
  demandAt = Date.now();
  for (const fn of wakers) fn();
}

/** Whether something asked within the last few minutes, or a page is listening. */
export const slackWanted = () => pages.size > 0 || Date.now() - demandAt < SLACK_EVENTS.demandMs;

/** Called on each demand (the unread queue and the socket register here). */
export function onSlackDemand(fn: () => void): () => void {
  wakers.add(fn);
  return () => void wakers.delete(fn);
}

/** Forgets demand and listeners (tests). */
export function resetSlackEvents(): void {
  pages.clear();
  internal.clear();
  demandAt = 0;
}

/** `GET /api/slack/events`: `live` first, then every event, a ping comment every 25 s; the listener goes on close. */
export function streamSlackEvents(req: IncomingMessage, res: ServerResponse, live: SlackLive): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`retry: 2000\n\n`);
  const send: Listener = (event) => void res.write(`data: ${JSON.stringify(event)}\n\n`);
  send({ type: "live", live });
  pages.add(send);
  const ping = setInterval(() => res.write(": ping\n\n"), SLACK_EVENTS.pingMs);
  ping.unref?.();
  let closed = false;
  const drop = () => {
    if (closed) return;
    closed = true;
    clearInterval(ping);
    pages.delete(send);
  };
  req.on("close", drop);
  res.on("close", drop);
  noteSlackDemand();
}
