/**
 * Live push from every host to the browser.
 *
 * Each host has one feed (live/feed.ts): SDK subscriptions to its agents,
 * workspaces and project updates, plus unarchived agents outside the active
 * scope, held under one versioning discipline (server/versioned.ts): the
 * daemon's own directory sequences for everything it can sequence, and
 * request order for background agents, which it can't. A feed that drops
 * marks its rows stale at once, reconnects with backoff and resubscribes; a
 * periodic delta read heals anything a subscription could have missed. The
 * hub (live/hub.ts) keeps one feed per host to follow.
 *
 * Rows (live/hostRows.ts) are published into fleet.ts's snapshots, so reads
 * and pushes share one view and one stale marking, and go to the browser
 * over channels (live/channel.ts, live/stream.ts): a WebSocket per tab
 * (`/api/ws`) carrying the fleet and the sessions that tab watches, or
 * Server-Sent Events (`/api/live`, `/api/agents/:id/live`). Every fleet
 * message names the revision of the (resource, host) view it carries,
 * stamped when that view was captured (live/view.ts); reads carry the same
 * revisions, so the browser drops anything older than what it shows. A
 * channel that stops reading is never buffered without bound: past a budget
 * its messages are dropped and, once it drains, it gets a fresh reset; far
 * past it, it is closed and reconnects.
 *
 * Session timelines (live/sessions.ts, live/timeline.ts) are watched per
 * agent, shared by every viewer, released with the last one.
 *
 * This module is the public entry: importers use it, not the modules behind it.
 */
import { resetRevisions, lastRevision } from "./versioned";
import { clearAgentListeners, stopFeeds } from "./live/hub";
import { stopWatches } from "./live/sessions";
import { stopStream } from "./live/stream";

export { LIVE } from "./live/tuning";
export {
  MISSING_CWD,
  missingCwd,
  type AgentEntry,
  type AgentRecord,
  type LiveClient,
} from "./live/client";
export {
  allWorkspaces,
  archivedAgent,
  childAgent,
  hostRows,
  rootAgent,
  serverIdOf,
  unarchivedAgents,
} from "./live/hostRows";
export {
  ProviderSubagents,
  type SubagentRecord,
  type SubagentRow,
} from "./live/subagents";
export { Feed, type FeedOptions, type FeedState } from "./live/feed";
export {
  feedOf,
  feedStates,
  republishFeeds,
  settle,
  syncFeeds,
  type HostSpec,
} from "./live/hub";
export {
  capture,
  captureExtras,
  withCreated,
  type Row,
  type ViewHost,
  type ViewSource,
} from "./live/view";
export { Channel } from "./live/channel";
export {
  channelList,
  configureLive,
  flush,
  liveInterval,
  pushClients,
  schedule,
  socketChannel,
  streamFleet,
  streamSession,
  type WatchRequest,
} from "./live/stream";
export { watchOf, watchedTimelines, type SessionSource } from "./live/sessions";

/** The newest revision handed out (tests, diagnostics). */
export const currentRevision = lastRevision;

/**
 * Close every channel and subscription: the server is shutting down or its
 * module is being replaced. Browsers see the connection end and back off.
 */
export function stopLive() {
  stopFeeds();
  stopWatches();
  stopStream();
}

/** Everything back to empty (tests). */
export function resetLive() {
  stopLive();
  clearAgentListeners();
  resetRevisions();
}

// One hub per process: a reloaded module stops the one it replaces.
const KEY: unique symbol = Symbol.for("paseo-command.live");
type Hub = { stop: () => void };
const registry = globalThis as typeof globalThis & { [KEY]?: Hub };
registry[KEY]?.stop();
registry[KEY] = { stop: stopLive };
