import { agentClientId, onAgentIdentityMigration } from "./agentIdentity";
import {
  notificationsSupported,
  notificationPermission,
  requestNotificationPermission,
  showNotification,
} from "./nativePlatform";
import { agentExcluded, onAgentArchived } from "./activeAgents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, readStore, writeStore } from "./api";
import {
  LIMITS,
  Notifier,
  completionOf,
  isUnread,
  mergeFinished,
  mergeStamps,
  prune,
  sanitizeFinished,
  sanitizeStamps,
  withoutExpired,
  type AttentionEvent,
  type AttentionState,
  type Finished,
  type NotifierDeps,
  type Seen,
} from "./attentionState";
import type { Agent, Detail } from "./types";
import { hostQuery, isArchived, isFailed, isRunning } from "./types";
import { agentName, currentName } from "./names";

const supported = notificationsSupported();
/** Desktop notifications turned off with the bell, for every tab. */
const MUTED_KEY = "desktop-notifications-off";
const mutedNotifications = () => readStore<boolean>(MUTED_KEY, false) === true;
const PREFIX = "paseo-command:";
const KEY = {
  finished: "attention:finished",
  seen: "attention:seen",
  missing: "attention:missing",
  notified: "attention:notified",
} as const;
const tab =
  globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
/** Retry delays for naming a completion while the daemon can't (ms). */
const RETRY = [1500, 3000, 6000, 12000, 30000, 60000];
const PRUNE_EVERY = 300000;
const DETAIL_TIMEOUT = 15000;
const PENDING_CAP = 50;
const PENDING_PARALLEL = 4;
const PENDING_MAX_AGE = 86400000;
const PENDING_MISSING = 600000;

// Earlier builds stored `id → observed ms` under "finished"/"seen".
const readFinished = () =>
  sanitizeFinished(readStore(KEY.finished, null) ?? readStore("finished", {}));
const readSeen = () =>
  sanitizeStamps(readStore(KEY.seen, null) ?? readStore("seen", {}));
const readMissing = () => sanitizeStamps(readStore(KEY.missing, {}));
const readState = (): AttentionState => ({
  finished: readFinished(),
  seen: readSeen(),
  missing: readMissing(),
});

/**
 * Every tab shares the attention state, so read-modify-write cycles run under
 * a cross-tab lock where the browser has one (all current ones do), in the
 * order they were requested.
 */
function exclusive(run: () => void) {
  const locks = globalThis.navigator?.locks;
  if (!locks) return run();
  void locks
    .request(`${PREFIX}attention`, async () => run())
    .catch(() => {
      // A lock that can't be taken (the page is unloading) changes nothing.
    });
}

function channel(name: string) {
  try {
    return typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel(`${PREFIX}${name}`);
  } catch {
    return null;
  }
}

type StateMessage =
  { t: "finished"; changes: Finished } | { t: "seen"; changes: Seen };

/** A finish seen (or caught up) but not yet named by the daemon. */
type Pending = {
  agent: Agent;
  notify: boolean;
  since: number;
  attempt: number;
  due: number;
  inFlight?: AbortController;
  /** When the agent dropped out of the fleet (polling pauses meanwhile). */
  missingSince?: number;
  /** Catch-up: only a finish after this time (the app's last visit) counts. */
  after?: number;
};

/**
 * Paseo lists carry no turn information, so finishes are observed from status
 * transitions between polls; the agent's detail then names the completion
 * (see attentionState.ts) so all tabs agree on it. Until it can be named, a
 * finish stays pending and is retried, whatever later polls show. Read state
 * is shared through localStorage (merged, never overwritten) and a
 * BroadcastChannel; notifications go through the Notifier so exactly one tab
 * shows each.
 */
export function useAttention(
  agents: Agent[],
  permissions: { id: string; agentId: string }[],
  viewing: string | undefined,
  activate: (id: string) => void,
) {
  const [finished, setFinished] = useState<Finished>(readFinished);
  const [seen, setSeen] = useState<Seen>(readSeen);
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >(supported ? notificationPermission() : "unsupported");
  // Turned off in the app (a page can't revoke the browser's permission).
  // Read afresh when delivering, since another tab may have changed it.
  const [muted, setMuted] = useState(mutedNotifications);
  const activateRef = useRef(activate);
  activateRef.current = activate;
  const viewingRef = useRef(viewing);
  viewingRef.current = viewing;
  const finishedRef = useRef(finished);
  finishedRef.current = finished;
  const seenRef = useRef(seen);
  seenRef.current = seen;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const permissionsRef = useRef(permissions);
  permissionsRef.current = permissions;
  const stateChannel = useRef<BroadcastChannel | null>(null);
  const notifier = useRef<Notifier | null>(null);
  useEffect(
    () =>
      onAgentIdentityMigration((moved) => {
        const remap = <T>(current: Record<string, T>) =>
          Object.fromEntries(
            Object.entries(current).map(([id, value]) => [
              moved[id] ?? id,
              value,
            ]),
          );
        setFinished(remap);
        setSeen(remap);
      }),
    [],
  );
  useEffect(
    () =>
      onAgentArchived((id, host) => {
        const clientId = agentClientId(id, host);
        pending.current.get(clientId)?.inFlight?.abort();
        pending.current.delete(clientId);
      }),
    [],
  );

  const apply = useCallback((m: StateMessage) => {
    if (m.t === "finished") setFinished((c) => mergeFinished(c, m.changes));
    else setSeen((c) => mergeStamps(c, m.changes));
  }, []);

  /** Apply locally at once, merge into storage, and tell the other tabs. */
  const record = useCallback(
    (m: StateMessage) => {
      apply(m);
      try {
        stateChannel.current?.postMessage(m);
      } catch {
        // No peers to tell.
      }
      exclusive(() => {
        const state = readState();
        const next =
          m.t === "finished"
            ? { ...state, finished: mergeFinished(state.finished, m.changes) }
            : { ...state, seen: mergeStamps(state.seen, m.changes) };
        if (next.finished === state.finished && next.seen === state.seen)
          return;
        // Keep the cap between the periodic prunes, too.
        const bounded =
          Object.keys(next.finished).length > LIMITS.cap ||
          Object.keys(next.seen).length > LIMITS.cap
            ? prune(next, Date.now())
            : next;
        writeStore(KEY.finished, bounded.finished);
        writeStore(KEY.seen, bounded.seen);
        writeStore(KEY.missing, bounded.missing);
      });
    },
    [apply],
  );

  // Other tabs' finishes and reads: storage events, or the channel.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === `${PREFIX}${KEY.finished}`)
        setFinished((c) => mergeFinished(c, readFinished()));
      if (e.key === null || e.key === `${PREFIX}${KEY.seen}`)
        setSeen((c) => mergeStamps(c, readSeen()));
    };
    window.addEventListener("storage", onStorage);
    const ch = channel("attention-state");
    if (ch) ch.onmessage = (e) => e.data && apply(e.data as StateMessage);
    stateChannel.current = ch;
    return () => {
      window.removeEventListener("storage", onStorage);
      ch?.close();
      stateChannel.current = null;
    };
  }, [apply]);

  // Notification delivery across tabs.
  useEffect(() => {
    const ch = channel("notify");
    const n = new Notifier({
      tab,
      locks: (globalThis.navigator?.locks ?? null) as NotifierDeps["locks"],
      channel: ch as NotifierDeps["channel"],
      ledger: {
        read: () => {
          try {
            const raw = localStorage.getItem(`${PREFIX}${KEY.notified}`);
            return sanitizeStamps(raw ? JSON.parse(raw) : {});
          } catch {
            return null;
          }
        },
        write: (value) => writeStore(KEY.notified, value),
      },
      now: () => Date.now(),
      clock: () => performance.now(),
      startedAt: Date.now(),
      visible: () => document.visibilityState === "visible",
      // Still worth telling, judged by the latest fleet and permissions.
      relevant: (ev) => {
        const agent = agentsRef.current.find((a) => a.id === ev.agentId);
        if (!agent || isArchived(agent)) return false;
        if (ev.kind !== "approval") return true;
        return permissionsRef.current.some(
          (p) => p.agentId === ev.agentId && p.id === ev.request,
        );
      },
      acknowledged: (ev) =>
        ev.turn !== undefined &&
        (mergeStamps(seenRef.current, readSeen())[ev.agentId] ?? -Infinity) >=
          ev.turn,
      deliver: (ev) => {
        if (!supported || notificationPermission() !== "granted" || mutedNotifications())
          return;
        showNotification(
          ev.title,
          ev.body,
          ev.key,
          () => {
            if (
              agentsRef.current.some(
                (agent) => agent.id === ev.agentId && !agentExcluded(agent),
              )
            )
              activateRef.current(ev.agentId);
          },
          ev.agentId,
        );
      },
    });
    n.start();
    notifier.current = n;
    return () => {
      n.stop();
      ch?.close();
      notifier.current = null;
    };
  }, []);

  // Which agent this tab visibly shows: no tab notifies about it.
  useEffect(() => {
    const beat = () =>
      notifier.current?.setPresence(document.hidden ? null : (viewing ?? null));
    const leave = () => notifier.current?.setPresence(null);
    beat();
    const timer = setInterval(beat, 15000);
    document.addEventListener("visibilitychange", beat);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
      window.removeEventListener("pagehide", leave);
    };
  }, [viewing]);

  const announce = useCallback((ev: AttentionEvent) => {
    if (supported && notificationPermission() === "granted" && !mutedNotifications())
      void notifier.current?.announce(ev);
  }, []);

  // Finishes waiting to be named; resolved independently of later polls.
  const pending = useRef(new Map<string, Pending>());
  const settle = useCallback(
    async (id: string, p: Pending) => {
      const controller = new AbortController();
      p.inFlight = controller;
      let d: Detail | null = null;
      let gone = false;
      try {
        d = await api<Detail>(
          `agents/${id}${hostQuery(p.agent.host)}`,
          undefined,
          AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(DETAIL_TIMEOUT),
          ]),
        );
      } catch (e) {
        gone = e instanceof ApiError && e.status === 404;
      }
      p.inFlight = undefined;
      // Replaced, dropped or paused meanwhile: this answer is stale.
      if (pending.current.get(id) !== p || p.missingSince !== undefined) return;
      // Removed, or running a newer turn: this finish can no longer be named.
      if (gone || (d && isRunning(d.Status))) {
        pending.current.delete(id);
        return;
      }
      const c = d && completionOf(d);
      if (!d || !c) {
        p.due = Date.now() + RETRY[Math.min(p.attempt++, RETRY.length - 1)];
        return;
      }
      pending.current.delete(id);
      if (p.after !== undefined && !(Date.parse(d.UpdatedAt) > p.after)) return;
      if (!p.notify && c.turn <= (readSeen()[id] ?? -Infinity)) return;
      record({ t: "finished", changes: { [id]: c } });
      if (!p.notify) return;
      const failed = isFailed(d.Status);
      announce({
        key: `${id}:${failed ? "failed" : "finished"}:${c.turn}`,
        kind: failed ? "failed" : "finished",
        agentId: id,
        turn: c.turn,
        // Named, never by ID.
        title: failed ? "Agent failed" : "Agent finished",
        // A rename after this, before delivery, still shows this name.
        body: currentName(p.agent, agentsRef.current),
      });
    },
    [record, announce],
  );
  const resolve = useCallback(() => {
    const now = Date.now();
    let busy = [...pending.current.values()].filter((p) => p.inFlight).length;
    for (const [id, p] of pending.current) {
      // A day without an answer, or ten minutes gone from the fleet: the
      // agent or its host is gone for good.
      if (
        now - p.since > PENDING_MAX_AGE ||
        (p.missingSince !== undefined && now - p.missingSince > PENDING_MISSING)
      ) {
        p.inFlight?.abort();
        pending.current.delete(id);
        continue;
      }
      if (p.inFlight || p.missingSince !== undefined || p.due > now) continue;
      if (busy >= PENDING_PARALLEL) break;
      busy++;
      void settle(id, p);
    }
  }, [settle]);
  const queue = useCallback(
    (agent: Agent, notify: boolean, after?: number) => {
      const was = pending.current.get(agent.id);
      was?.inFlight?.abort();
      pending.current.delete(agent.id);
      // An observed finish supersedes a catch-up check.
      const observed = notify || (was !== undefined && was.after === undefined);
      pending.current.set(agent.id, {
        agent,
        notify: notify || !!was?.notify,
        since: was?.since ?? Date.now(),
        attempt: 0,
        due: 0,
        after: observed ? undefined : after,
      });
      // Bounded: the oldest unresolved finishes give way.
      for (const [id, p] of pending.current) {
        if (pending.current.size <= PENDING_CAP) break;
        p.inFlight?.abort();
        pending.current.delete(id);
      }
      resolve();
    },
    [resolve],
  );
  useEffect(() => {
    const timer = setInterval(resolve, 1000);
    return () => clearInterval(timer);
  }, [resolve]);
  // The fleet is the authority on removal: archived agents' finishes are
  // dropped; an agent missing from it (deleted, or its host away) stops being
  // polled, and is dropped if it doesn't return within ten minutes.
  // Before the first poll the fleet is empty for want of data, not agents.
  const fleetLoaded = useRef(false);
  useEffect(() => {
    if (agents.length) fleetLoaded.current = true;
    if (!fleetLoaded.current) return;
    const now = Date.now();
    const byId = new Map(agents.map((a) => [a.id, a]));
    for (const [id, p] of pending.current) {
      const a = byId.get(id);
      if (agentExcluded(p.agent) || (a && isArchived(a))) {
        p.inFlight?.abort();
        pending.current.delete(id);
      } else if (!a) {
        p.inFlight?.abort();
        p.missingSince ??= now;
      } else if (p.missingSince !== undefined) {
        p.missingSince = undefined;
        p.due = 0;
      }
    }
  }, [agents]);

  const previous = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!agents.length) return;
    const before = previous.current;
    previous.current = new Map(agents.map((a) => [a.id, a.status]));
    if (!before) return;
    for (const agent of agents) {
      const was = before.get(agent.id);
      if (!was || was === agent.status) continue;
      if (
        (isRunning(was) && !isRunning(agent.status)) ||
        isFailed(agent.status)
      )
        queue(agent, true);
    }
  }, [agents, queue]);

  const previousPermissions = useRef<Set<string> | null>(null);
  useEffect(() => {
    // Permissions arrive with the first agents poll; before that the empty list
    // is "not loaded", and approvals already pending then are not news.
    if (!agents.length) return;
    const now = new Set(permissions.map((p) => `${p.agentId}:${p.id}`));
    const before = previousPermissions.current;
    previousPermissions.current = now;
    if (!before) return;
    for (const p of permissions) {
      if (before.has(`${p.agentId}:${p.id}`)) continue;
      const agent = agents.find((a) => a.id === p.agentId);
      if (agent)
        announce({
          // The request ID names the event in every tab.
          key: `${agent.id}:approval:${p.id || "pending"}`,
          kind: "approval",
          request: p.id,
          agentId: agent.id,
          title: "Approval needed",
          body: agentName(agent),
        });
    }
  }, [permissions, agents, announce]);

  // Forget agents long finished or missing from the fleet for days; bounded.
  // Only entries this prune found expired are removed from the tab's state:
  // anything recorded since its snapshot (a catch-up queued behind it) stays.
  const runPrune = useCallback(() => {
    const fleet = agentsRef.current;
    if (!fleet.length) return;
    const live = new Set(fleet.map((a) => a.id));
    exclusive(() => {
      const state = readState();
      const next = prune(state, Date.now(), live);
      if (next.finished !== state.finished)
        writeStore(KEY.finished, next.finished);
      if (next.seen !== state.seen) writeStore(KEY.seen, next.seen);
      if (next.missing !== state.missing) writeStore(KEY.missing, next.missing);
      // Both setters see the latest local state; apply the prune to it.
      setFinished(
        (c) => withoutExpired({ finished: c, seen: {} }, state, next).finished,
      );
      setSeen(
        (c) => withoutExpired({ finished: {}, seen: c }, state, next).seen,
      );
    });
  }, []);
  const pruned = useRef(false);
  useEffect(() => {
    if (pruned.current || !agents.length) return;
    pruned.current = true;
    runPrune();
  }, [agents, runPrune]);
  useEffect(() => {
    const timer = setInterval(runPrune, PRUNE_EVERY);
    return () => clearInterval(timer);
  }, [runPrune]);

  // Catch up on agents that finished while every tab was closed.
  const lastActive = useRef(readStore<number>("lastActive", 0));
  useEffect(() => {
    const beat = () => writeStore("lastActive", Date.now());
    beat();
    const timer = setInterval(beat, 20000);
    window.addEventListener("pagehide", beat);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", beat);
    };
  }, []);
  const caughtUp = useRef(false);
  useEffect(() => {
    const since = lastActive.current;
    if (caughtUp.current || !agents.length || !since) return;
    caughtUp.current = true;
    const queueUp = agents.filter(
      (a) => !isArchived(a) && !isRunning(a.status),
    );
    const changes: Finished = {};
    const worker = async () => {
      for (let a = queueUp.shift(); a; a = queueUp.shift()) {
        try {
          const d = await api<Detail>(
            `agents/${a.id}${hostQuery(a.host)}`,
            undefined,
            AbortSignal.timeout(DETAIL_TIMEOUT),
          );
          if (isRunning(d.Status) || !(Date.parse(d.UpdatedAt) > since))
            continue;
          const c = completionOf(d);
          // Not nameable now: keep it pending (no notification) and retry.
          if (!c) queue(a, false, since);
          else if (c.turn > (readSeen()[a.id] ?? -Infinity)) changes[a.id] = c;
        } catch (e) {
          // A vanished agent isn't flagged; anything else is retried later
          // (the pending queue checks the finish time against the last read).
          if (!(e instanceof ApiError && e.status === 404))
            queue(a, false, since);
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]).then(() => {
      if (Object.keys(changes).length) record({ t: "finished", changes });
    });
  }, [agents, record, queue]);

  // Viewing an agent acknowledges its latest completion.
  useEffect(() => {
    if (!viewing) return;
    const stamp = () => {
      if (document.hidden) return;
      const c = finishedRef.current[viewing];
      if (c && isUnread(finishedRef.current, seenRef.current, viewing))
        record({ t: "seen", changes: { [viewing]: c.turn } });
    };
    stamp();
    document.addEventListener("visibilitychange", stamp);
    return () => document.removeEventListener("visibilitychange", stamp);
  }, [viewing, finished, seen, record]);

  useEffect(() => {
    const sync = () => setPermission(notificationPermission());
    window.addEventListener("paseo:notification-permission", sync);
    return () =>
      window.removeEventListener("paseo:notification-permission", sync);
  }, []);

  // Permission granted (or revoked) in another tab or the browser's settings.
  useEffect(() => {
    if (!supported) return;
    const sync = () => setPermission(notificationPermission());
    let status: PermissionStatus | undefined;
    let gone = false;
    navigator.permissions
      ?.query({ name: "notifications" })
      .then((s) => {
        if (gone) return;
        status = s;
        s.onchange = sync;
      })
      .catch(() => {});
    document.addEventListener("visibilitychange", sync);
    return () => {
      gone = true;
      if (status) status.onchange = null;
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  const unread = useMemo(
    () =>
      new Set(
        Object.keys(finished).filter(
          (id) => id !== viewing && isUnread(finished, seen, id),
        ),
      ),
    [finished, seen, viewing],
  );
  const finishedAt = useMemo(
    () =>
      Object.fromEntries(Object.entries(finished).map(([id, c]) => [id, c.at])),
    [finished],
  );
  const markSeen = useCallback(
    (ids: string[]) => {
      const changes: Seen = {};
      for (const id of ids)
        if (finishedRef.current[id]) changes[id] = finishedRef.current[id].turn;
      if (Object.keys(changes).length) record({ t: "seen", changes });
    },
    [record],
  );
  /** The bell: asks for permission first, then turns notifications on and off. */
  const requestNotifications = useCallback(async () => {
    if (!supported) return;
    const current = notificationPermission();
    if (current === "granted") {
      const next = !mutedNotifications();
      writeStore(MUTED_KEY, next);
      setMuted(next);
      return;
    }
    const granted = await requestNotificationPermission();
    setPermission(granted);
    if (granted === "granted") {
      writeStore(MUTED_KEY, false);
      setMuted(false);
    }
  }, []);
  useEffect(() => {
    const sync = () => setMuted(mutedNotifications());
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  return {
    unread,
    finishedAt,
    markSeen,
    notifications: permission === "granted" && muted ? ("off" as const) : permission,
    requestNotifications,
  };
}
