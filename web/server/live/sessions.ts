/**
 * Session timelines, watched per agent, shared by every viewer and released
 * with the last one. A watch re-resolves its host's registration on every
 * attempt, is suspended while the host may not be contacted, and treats any
 * failed read as a disconnection: viewers are told (they poll meanwhile) and
 * it reconnects with backoff until a complete read succeeds.
 */
import { TUNING } from "../fleet";
import { errorText } from "../wire";
import type { Channel } from "./channel";
import { fieldOf, within, type AgentRecord, type LiveClient } from "./client";
import { feedOf, onAgents } from "./hub";
import { chunks, fetchTimeline } from "./timeline";
import { LIVE, backoff } from "./tuning";

export type SessionSource = {
  hostKey: string;
  agentId: string;
  /**
   * Called on every connection attempt: re-checks the host's registration
   * and returns how to reach it now, or throws (offline, unregistered).
   */
  resolve: () => Promise<() => Promise<LiveClient>>;
  /** The header's detail from an agent record. */
  detail(agent: AgentRecord): object;
  /** The agent's timeline started a new epoch (a rewind): drop what is cached of the old one. */
  epochChanged?: () => void;
};
export type Watch = {
  key: string;
  source: SessionSource;
  /** Viewers, with the id each knows the session by. */
  sids: Map<Channel, string>;
  items: Map<string, string>;
  order: string[];
  epoch?: string;
  unavailable?: string;
  /** Older items exist beyond what is held (paged on demand). */
  hasOlder: boolean;
  /** The daemon range the window certifies. */
  from: number;
  to: number;
  /** Every row sent to viewers that is still on the daemon's page, as sent. */
  sent: Map<string, string>;
  /** Newest-started read: only its answer may be published. */
  seq: number;
  timer?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
  fetching?: Promise<void>;
  again: boolean;
  failures: number;
  release?: () => void;
  stopped: boolean;
  suspended: boolean;
  live: boolean;
  error: string;
  detail: string;
  /** Without a live feed: the read whose record the header shows. */
  detailSeq: number;
  /** Bumped per message, so a viewer can order them. */
  rev: number;
};
const watches = new Map<string, Watch>();

/** Live timelines being watched (tests, diagnostics). */
export const watchedTimelines = () => [...watches.keys()];
export const watchOf = (key: string) => watches.get(key);

/** Send a session message to every viewer, or only to `only`. */
export function tell(w: Watch, event: string, data: object, only?: Channel) {
  const msg = { ...data, rev: ++w.rev };
  const targets = only ? [[only, w.sids.get(only)] as const] : [...w.sids];
  for (const [c, sid] of targets) {
    if (!c) continue;
    if (c.multiplexed) c.send("session", { sid, event, data: msg });
    else c.send(event, msg);
  }
}
/** Everything a viewer needs to start from what the others have. */
export function resendWatch(w: Watch, c: Channel) {
  if (w.unavailable)
    tell(
      w,
      "timeline",
      {
        reset: true,
        items: [],
        unavailable: w.unavailable,
        from: 0,
        to: 0,
        hasOlder: false,
      },
      c,
    );
  else if (w.order.length || w.epoch)
    for (const msg of chunks(
      w.order.map((id) => JSON.parse(w.items.get(id)!)),
      (items, i, n) => ({
        epoch: w.epoch,
        from: w.from,
        to: w.to,
        hasOlder: w.hasOlder,
        items,
        reset: true,
        part: i,
        parts: n,
      }),
    ))
      tell(w, "timeline", msg, c);
  if (w.detail !== "null") tell(w, "detail", JSON.parse(w.detail), c);
  tell(
    w,
    "state",
    w.live ? { live: true } : { live: false, error: w.error },
    c,
  );
}

export function watch(
  c: Channel,
  s: SessionSource,
  sid = `${s.hostKey}|${s.agentId}`,
) {
  const key = `${s.hostKey}|${s.agentId}`;
  // A viewer renaming its session is a new subscription.
  unwatchSid(c, sid);
  let w = watches.get(key);
  if (!w) {
    w = {
      key,
      source: s,
      sids: new Map(),
      items: new Map(),
      order: [],
      seq: 0,
      hasOlder: false,
      from: 0,
      to: 0,
      sent: new Map(),
      again: false,
      failures: 0,
      stopped: false,
      suspended: false,
      live: false,
      error: "Connecting…",
      detail: "null",
      detailSeq: 0,
      rev: 0,
    };
    watches.set(key, w);
    w.sids.set(c, sid);
    c.watches.set(key, w);
    void connectWatch(w);
    return;
  }
  w.sids.set(c, sid);
  c.watches.set(key, w);
  // Join: this viewer starts from what the others have.
  resendWatch(w, c);
}
export function unwatch(c: Channel, key: string) {
  const w = watches.get(key);
  c.watches.delete(key);
  if (!w) return;
  w.sids.delete(c);
  if (!w.sids.size) stopWatch(w);
}
export function unwatchSid(c: Channel, sid: string) {
  for (const [key, w] of [...c.watches])
    if (w.sids.get(c) === sid) unwatch(c, key);
}

function closeWatch(w: Watch) {
  if (w.timer) clearTimeout(w.timer);
  if (w.retry) clearTimeout(w.retry);
  w.timer = w.retry = undefined;
  w.again = false;
  w.release?.();
  w.release = undefined;
}
function stopWatch(w: Watch) {
  w.stopped = true;
  closeWatch(w);
  if (watches.get(w.key) === w) watches.delete(w.key);
}
/** Stop every watch (shutdown or reload). */
export function stopWatches() {
  for (const w of [...watches.values()]) stopWatch(w);
}
function down(w: Watch, error: string) {
  w.live = false;
  w.error = error;
  tell(w, "state", { live: false, error });
}
/** This session may not be watched at all: tell its viewers, and end it. */
function refuseWatch(w: Watch, error: string) {
  tell(w, "state", { live: false, error, refused: true });
  for (const c of [...w.sids.keys()]) c.watches.delete(w.key);
  w.sids.clear();
  stopWatch(w);
}
/** The host may not be contacted: disconnect and wait to be resumed. */
export function suspendWatches(hostKey: string, why: string) {
  for (const w of watches.values())
    if (w.key.startsWith(`${hostKey}|`) && !w.stopped) {
      closeWatch(w);
      w.suspended = true;
      down(w, why);
    }
}
export function resumeWatches(hostKey: string) {
  for (const w of watches.values())
    if (w.key.startsWith(`${hostKey}|`) && !w.stopped) {
      closeWatch(w);
      w.suspended = false;
      w.failures = 0;
      void connectWatch(w);
    }
}
export function endWatches(hostKey: string, why: string) {
  for (const w of [...watches.values()])
    if (w.key.startsWith(`${hostKey}|`)) refuseWatch(w, why);
}
export function endAgentWatches(hostKey: string, agentId: string) {
  const w = watches.get(`${hostKey}|${agentId}`);
  if (!w) return;
  refuseWatch(w, "Archived agents are excluded.");
}

export function pushDetail(w: Watch, detail: object) {
  if (fieldOf(detail, "Archived")) {
    endAgentWatches(w.source.hostKey, w.source.agentId);
    return;
  }
  const json = JSON.stringify(detail);
  if (json === w.detail) return;
  w.detail = json;
  tell(w, "detail", detail);
}
/** The header from the feed's ordered store, when it holds the agent. */
export function detailFromFeed(w: Watch) {
  const feed = feedOf(w.source.hostKey);
  if (feed?.state !== "live") return false;
  const agent = feed.agent(w.source.agentId);
  if (!agent) return false;
  pushDetail(w, w.source.detail(agent));
  return true;
}

async function connectWatch(w: Watch) {
  if (w.stopped || w.suspended) return;
  closeWatch(w);
  const releases: (() => void)[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    for (const r of releases.splice(0)) {
      try {
        r();
      } catch {
        // Gone with its socket.
      }
    }
  };
  w.release = close;
  const s = w.source;
  /** Any failure: viewers poll meanwhile; reconnect with backoff. */
  const retry = (error: unknown) => {
    if (closed) return;
    close();
    if (w.release === close) w.release = undefined;
    if (w.stopped || w.suspended) return;
    if (fieldOf(error, "refused")) {
      // Not a disconnection: this session may not be watched at all.
      return refuseWatch(w, errorText(error));
    }
    w.failures++;
    down(w, errorText(error, "Disconnected"));
    const delay = backoff(w.failures, LIVE.backoffMaxMs);
    w.retry = setTimeout(() => {
      w.retry = undefined;
      void connectWatch(w);
    }, delay);
    w.retry.unref?.();
  };
  try {
    // The registration is re-checked on every attempt.
    const connect = await s.resolve();
    if (closed || w.stopped || w.suspended) return close();
    const client = await connect();
    if (closed || w.stopped || w.suspended) return close();
    if (typeof client.subscribeConnectionStatus === "function")
      releases.push(
        client.subscribeConnectionStatus((st) => {
          if (
            st?.status &&
            st.status !== "connected" &&
            st.status !== "connecting"
          )
            retry(new Error("The daemon connection closed."));
        }),
      );
    // One read at a time; events during it ask for one more after. Any
    // failed read is a disconnection, recovered by reconnecting.
    const read = (): Promise<void> => {
      const reading = fetchTimeline(w, client).then(
        () => {
          if (closed || w.stopped) return;
          if (!w.live) {
            w.live = true;
            w.failures = 0;
            w.error = "";
            tell(w, "state", { live: true });
          }
        },
        (e) => retry(e),
      );
      const tracked: Promise<void> = reading.finally(() => {
        if (w.fetching === tracked) w.fetching = undefined;
        if (w.again && !closed && !w.stopped) {
          w.again = false;
          refetch();
        }
      });
      w.fetching = tracked;
      return tracked;
    };
    const refetch = () => {
      if (w.timer || closed) return;
      if (w.fetching) {
        w.again = true;
        return;
      }
      w.timer = setTimeout(() => {
        w.timer = undefined;
        if (!closed) void read();
      }, LIVE.timelineDebounceMs);
      w.timer.unref?.();
    };
    releases.push(() => {
      if (w.timer) clearTimeout(w.timer);
      w.timer = undefined;
      w.again = false;
      w.fetching = undefined;
    });
    const sub = client.subscribeAgentTimeline(s.agentId, (m) => {
      if (w.stopped || closed) return;
      const type = fieldOf(m, "type");
      if (type === "agent.timeline.error")
        return retry(
          new Error(
            String(
              fieldOf(fieldOf(m, "payload"), "error") || "Timeline unavailable",
            ),
          ),
        );
      if (type === "agent.timeline.replacement") w.epoch = undefined;
      refetch();
    });
    releases.push(() => void sub.release?.().catch?.(() => {}));
    releases.push(
      onAgents(s.hostKey, (ids) => {
        if (ids.includes(s.agentId)) detailFromFeed(w);
      }),
    );
    await within(sub.ready, TUNING.sdkReadMs, "The timeline", client);
    if (closed || w.stopped) return close();
    detailFromFeed(w);
    await read();
  } catch (error) {
    retry(error);
  }
}
