/** Tunables; tests shrink them. */
export const LIVE = {
  /** Re-read everything this often while live, to heal missed events. */
  resyncMs: 60000,
  /** First reconnect delay after a feed or watch drops; doubles up to the max. */
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  /** The local daemon restarts quickly; never wait long on it. */
  localBackoffMaxMs: 4000,
  /** Changes within this window go out as one patch. */
  coalesceMs: 25,
  /** Timeline events within this window cost one re-read. */
  timelineDebounceMs: 80,
  timelineLimit: 300,
  /** Keep-alive interval for idle channels. */
  heartbeatMs: 15000,
  /** Re-evaluate time-based staleness for push clients this often. */
  tickMs: 5000,
  /** How long a mutation's response waits for the feed to resync. */
  settleMs: 1500,
  /** A channel past this much unsent output stops getting messages. */
  maxBufferedBytes: 1 << 20,
  /** A channel past this much is closed; it reconnects for a reset. */
  hardBufferedBytes: 8 << 20,
  /** How often a congested WebSocket is checked for having drained. */
  drainPollMs: 50,
  /** Sessions one channel may watch at once. */
  maxWatches: 8,
};

/** The reconnect delay after `failures` consecutive failures, capped at `max`. */
export const backoff = (failures: number, max: number) =>
  Math.min(max, LIVE.backoffBaseMs * 2 ** Math.max(0, failures - 1));
