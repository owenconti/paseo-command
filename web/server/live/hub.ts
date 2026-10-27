/** The hub: one feed per host, kept matching the hosts to follow. */
import { dropHost } from "../fleet";
import { release } from "../daemon";
import type { LiveClient } from "./client";
import { Feed, type FeedOptions } from "./feed";
import { endWatches, resumeWatches, suspendWatches } from "./sessions";
import { LIVE } from "./tuning";
import { unwatchArchive, watchArchive } from "../subagentArchive";

export type HostSpec = {
  key: string;
  label: string;
  /** Identifies how to reach it; a change restarts the feed and its sessions. */
  target: string;
  connect: () => Promise<LiveClient>;
  /** False: keep its last rows (stale) but don't contact it. */
  contact: boolean;
  registry?: FeedOptions["registry"];
  dropped?: () => void;
};

const feeds = new Map<
  string,
  { feed: Feed; target: string; contact: boolean }
>();
let onChange: () => void = () => {};
/** What runs after any change readers could see (the push stream's schedule). */
export function setOnChange(fn: () => void) {
  onChange = fn;
}
/** Session watches following agent records, per host. */
const agentListeners = new Map<string, Set<(ids: string[]) => void>>();
export function onAgents(key: string, fn: (ids: string[]) => void) {
  let set = agentListeners.get(key);
  if (!set) agentListeners.set(key, (set = new Set()));
  const listeners = set;
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
    if (!listeners.size && agentListeners.get(key) === listeners)
      agentListeners.delete(key);
  };
}
export function clearAgentListeners() {
  agentListeners.clear();
}

export function feedOf(key: string) {
  return feeds.get(key)?.feed;
}
export function feedStates() {
  return Object.fromEntries([...feeds].map(([k, { feed }]) => [k, feed.state]));
}

/**
 * Make the feeds (and the sessions watching each host) match the hosts
 * that should be followed. Hosts missing from `hosts` are forgotten (their
 * rows go, their sessions end); hosts not to be contacted keep their rows,
 * stale, and their sessions are suspended; a changed target restarts both.
 */
export function syncFeeds(hosts: HostSpec[]) {
  const wanted = new Map(hosts.map((h) => [h.key, h]));
  let changed = false;
  // A remote target that may no longer be contacted loses its connection,
  // including one still being made.
  const retire = (key: string, target: string) => {
    if (key !== "local") release(target);
  };
  for (const [key, { feed, target }] of [...feeds]) {
    if (wanted.has(key)) continue;
    feed.stop();
    retire(key, target);
    feeds.delete(key);
    dropHost(key);
    endWatches(key, "This host is no longer registered.");
    changed = true;
  }
  for (const spec of hosts) {
    const held = feeds.get(spec.key);
    if (held && held.target === spec.target) {
      if (held.contact === spec.contact) continue;
      changed = true;
      if (!spec.contact) {
        held.contact = false;
        held.feed.stop();
        retire(spec.key, held.target);
        suspendWatches(spec.key, `${spec.label} can't be contacted right now.`);
      } else {
        replace(spec);
        resumeWatches(spec.key);
      }
      continue;
    }
    if (held) {
      held.feed.stop();
      retire(spec.key, held.target);
      suspendWatches(spec.key, "The host's address changed.");
    }
    replace(spec);
    if (held && spec.contact) resumeWatches(spec.key);
    changed = true;
  }
  if (changed) onChange();
}

/** Publish every host's rows again (the archived subagents changed). */
export function republishFeeds() {
  for (const { feed } of feeds.values()) feed.republish();
}

function replace(spec: HostSpec) {
  // Archived subagents written by another process (the CLI) apply here too.
  watchArchive(republishFeeds);
  const previous = feeds.get(spec.key)?.feed;
  const feed = new Feed({
    key: spec.key,
    label: spec.label,
    connect: spec.connect,
    registry: spec.registry,
    dropped: spec.dropped,
    changed: () => onChange(),
    agentsChanged: (ids) => {
      for (const fn of agentListeners.get(spec.key) ?? []) fn(ids);
    },
  });
  // A restarted feed keeps showing what it had (stale) until it reconnects.
  if (previous) {
    for (const [id, e] of previous.active.entries)
      feed.active.entries.set(id, e);
    for (const [id, e] of previous.workspaces.entries)
      feed.workspaces.entries.set(id, e);
    for (const [id, e] of previous.projects.entries)
      feed.projects.entries.set(id, e);
    // Its request numbers mean nothing to the new feed: older than anything it asks.
    feed.background.adopt(previous.background);
    feed.adoptExclusions(previous);
    if (previous.loaded) feed.loaded = true;
  }
  feeds.set(spec.key, { feed, target: spec.target, contact: spec.contact });
  if (spec.contact) feed.start();
  else feed.stop();
}

/** Resync the feed of a host after a mutation, bounded; never throws. */
export async function settle(key: string) {
  const feed = feeds.get(key)?.feed;
  if (!feed || feed.state !== "live") return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const ok = await Promise.race([
    feed.resync(true).then(
      () => true,
      () => false,
    ),
    new Promise<boolean>((r) => {
      timer = setTimeout(() => r(false), LIVE.settleMs);
    }),
  ]);
  clearTimeout(timer);
  return ok;
}

/** Stop every feed and forget them (shutdown or reload). */
export function stopFeeds() {
  unwatchArchive();
  for (const { feed } of feeds.values()) feed.stop();
  feeds.clear();
}
