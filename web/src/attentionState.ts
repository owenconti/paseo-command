/**
 * Pure pieces of the attention state that every open tab shares.
 *
 * A completion is named by the daemon, never by when a tab happened to see
 * it: `turn` is the start of the turn that finished (its prompt's time, or
 * the agent's creation for the first turn), the same in every tab however
 * late or out of order its polls arrive. Reading an agent acknowledges that
 * turn, so another tab observing the same finish later can't make it unread
 * again; only a later turn can.
 */
export type Completion = {
  /** Identity: the finished turn's start (daemon clock, ms). */
  turn: number;
  /** When it finished, for display (daemon clock, ms). */
  at: number;
};
export type Finished = Record<string, Completion>;
/** Agent ID → the turn last acknowledged. */
export type Seen = Record<string, number>;
/** Agent ID → when it was first found missing from the fleet. */
export type Missing = Record<string, number>;
export type Stamps = Record<string, number>;

export const DAY = 86400000;
export const LIMITS = {
  /** Completions older than this are forgotten, read or not. */
  maxAge: 30 * DAY,
  /** Agents continuously missing from the fleet (archived elsewhere, host gone) this long. */
  missingAge: 2 * DAY,
  /** Most agents remembered. */
  cap: 400,
  /** Notification claims are remembered this long, and at most this many. */
  ledgerAge: 7 * DAY,
  ledgerCap: 1000,
  /** A tab that hasn't refreshed its presence for this long has gone. */
  presenceAge: 45000,
};

/**
 * The completion a finished agent's detail describes, or null while it can't
 * be named. `LastUserMessageAt` undefined means the daemon's live record was
 * unavailable (null means no follow-up yet: the first turn, named by
 * CreatedAt). Nothing else stands in for it: a bookkeeping time such as
 * UpdatedAt would name the same completion differently in another tab.
 */
export function completionOf(d: {
  CreatedAt?: string;
  UpdatedAt?: string;
  LastUserMessageAt?: string | null;
  AttentionTimestamp?: string | null;
}): Completion | null {
  if (d.LastUserMessageAt === undefined) return null;
  const turn = Date.parse(d.LastUserMessageAt ?? d.CreatedAt ?? "");
  const at = Date.parse(d.AttentionTimestamp || d.UpdatedAt || "");
  if (!Number.isFinite(turn)) return null;
  return { turn, at: Number.isFinite(at) ? Math.max(at, turn) : turn };
}

/** Later turns win; for the same turn, the earliest reported finish. */
export function mergeFinished(a: Finished, b: Finished): Finished {
  let out: Finished | null = null;
  for (const [id, c] of Object.entries(b)) {
    const cur = a[id];
    const better =
      !cur || c.turn > cur.turn || (c.turn === cur.turn && c.at < cur.at);
    if (!better) continue;
    out ??= { ...a };
    out[id] = c;
  }
  return out || a;
}

/** Per-key maximum: acknowledgements only move forward. */
export function mergeStamps(a: Stamps, b: Stamps): Stamps {
  let out: Stamps | null = null;
  for (const [id, at] of Object.entries(b)) {
    if (!Number.isFinite(at) || at <= (a[id] ?? -Infinity)) continue;
    out ??= { ...a };
    out[id] = at;
  }
  return out || a;
}

export function isUnread(finished: Finished, seen: Seen, id: string) {
  const c = finished[id];
  return !!c && c.turn > (seen[id] ?? -Infinity);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

export function sanitizeStamps(value: unknown): Stamps {
  const out: Stamps = {};
  if (!isObject(value)) return out;
  for (const [id, at] of Object.entries(value))
    if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
  return out;
}

/** Accepts the current shape and the earlier `id → observed ms` one. */
export function sanitizeFinished(value: unknown): Finished {
  const out: Finished = {};
  if (!isObject(value)) return out;
  for (const [id, c] of Object.entries(value)) {
    if (typeof c === "number" && Number.isFinite(c) && c > 0)
      out[id] = { turn: c, at: c };
    else if (
      isObject(c) &&
      typeof c.turn === "number" &&
      Number.isFinite(c.turn) &&
      typeof c.at === "number" &&
      Number.isFinite(c.at)
    )
      out[id] = { turn: c.turn, at: c.at };
  }
  return out;
}

export type AttentionState = {
  finished: Finished;
  seen: Seen;
  missing: Missing;
};

/**
 * Bounds the stored state. With the fleet (`live`, archived agents included),
 * agents absent from it get a first-missing time and are dropped only after
 * being missing for `missingAge` continuously; one that reappears is cleared.
 * Agents are dropped from every map together, so a read result is never
 * resurrected as unread by forgetting only its acknowledgement.
 */
export function prune(
  state: AttentionState,
  now: number,
  live?: Set<string>,
  limits = LIMITS,
): AttentionState {
  const { finished, seen } = state;
  const ids = new Set([...Object.keys(finished), ...Object.keys(seen)]);
  const missing: Missing = {};
  for (const id of ids) {
    const since = state.missing[id];
    if (live) {
      if (!live.has(id)) missing[id] = since ?? now;
    } else if (since !== undefined) missing[id] = since;
  }
  const latest = (id: string) =>
    Math.max(
      finished[id]?.at ?? -Infinity,
      finished[id]?.turn ?? -Infinity,
      seen[id] ?? -Infinity,
    );
  const keep = new Set(
    [...ids]
      .filter((id) => now - latest(id) <= limits.maxAge)
      .filter(
        (id) =>
          missing[id] === undefined || now - missing[id] <= limits.missingAge,
      )
      .sort((a, b) => latest(b) - latest(a))
      .slice(0, limits.cap),
  );
  const pick = <T>(map: Record<string, T>): Record<string, T> =>
    Object.keys(map).every((id) => keep.has(id))
      ? map
      : Object.fromEntries(Object.entries(map).filter(([id]) => keep.has(id)));
  const nextMissing = pick(missing);
  const sameMissing =
    Object.keys(nextMissing).length === Object.keys(state.missing).length &&
    Object.entries(nextMissing).every(([id, at]) => state.missing[id] === at);
  return {
    finished: pick(finished),
    seen: pick(seen),
    missing: sameMissing ? state.missing : nextMissing,
  };
}

/**
 * Applies a prune to a tab's in-memory state: removes only the entries the
 * prune found expired in its storage snapshot, and only where the tab's entry
 * is no newer than that snapshot's. Anything recorded since (a catch-up
 * queued behind the prune) is kept.
 */
export function withoutExpired(
  local: { finished: Finished; seen: Seen },
  snapshot: AttentionState,
  pruned: AttentionState,
): { finished: Finished; seen: Seen } {
  let finished: Finished | null = null;
  for (const [id, c] of Object.entries(snapshot.finished))
    if (
      !(id in pruned.finished) &&
      local.finished[id] &&
      local.finished[id].turn <= c.turn
    ) {
      finished ??= { ...local.finished };
      delete finished[id];
    }
  let seen: Seen | null = null;
  for (const [id, turn] of Object.entries(snapshot.seen))
    if (
      !(id in pruned.seen) &&
      local.seen[id] !== undefined &&
      local.seen[id] <= turn
    ) {
      seen ??= { ...local.seen };
      delete seen[id];
    }
  return { finished: finished || local.finished, seen: seen || local.seen };
}

/** A notification-worthy event, named so every tab names it the same way. */
export type AttentionEvent = {
  /** `agent:kind:identity`, e.g. "a1:finished:1729…" or "a1:approval:req_9". */
  key: string;
  kind: "finished" | "failed" | "approval";
  agentId: string;
  /** The permission request, for approvals. */
  request?: string;
  /** The completion's turn, when it is one (checked against acknowledgements). */
  turn?: number;
  title: string;
  body: string;
};

export function trimLedger(
  ledger: Stamps,
  now: number,
  limits = LIMITS,
): Stamps {
  const entries = Object.entries(ledger).filter(
    ([, at]) => now - at < limits.ledgerAge,
  );
  if (
    entries.length === Object.keys(ledger).length &&
    entries.length <= limits.ledgerCap
  )
    return ledger;
  return Object.fromEntries(
    entries.sort((a, b) => b[1] - a[1]).slice(0, limits.ledgerCap),
  );
}

// ── Cross-tab notification delivery ────────────────────────────────────────

type Locks = {
  request(
    name: string,
    options: { signal?: AbortSignal },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
};
type Channel = {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: unknown }) => void) | null;
  close(): void;
};
type Message =
  | { t: "delivered"; keys: string[] }
  | { t: "history?" }
  | { t: "presence"; tab: string; agent: string | null }
  | { t: "presence?" };

export type NotifierDeps = {
  tab: string;
  /** navigator.locks, when available (every browser this app supports). */
  locks?: Locks | null;
  /** A BroadcastChannel shared by the tabs, when available. */
  channel?: Channel | null;
  /** Shared ledger of delivered keys; read() is null when storage fails. */
  ledger: { read(): Stamps | null; write(value: Stamps): boolean };
  /** Wall clock, for ledger ages. */
  now(): number;
  /** This tab's monotonic clock (performance.now), for presence. */
  clock(): number;
  /** Shows the notification. */
  deliver(ev: AttentionEvent): void;
  /** Whether the user has already read this completion. */
  acknowledged(ev: AttentionEvent): boolean;
  /** Whether the event still matters now (request open, agent still there). */
  relevant(ev: AttentionEvent): boolean;
  /** Without Web Locks: whether this tab is the one that may notify. */
  visible(): boolean;
  /** How long a deliverer keeps the event's lock after announcing it. */
  holdMs?: number;
  /** Longest wait for an event's lock; an event older than this is stale. */
  waitMs?: number;
  /** How long a new tab waits for peers' delivery history. */
  historyMs?: number;
  /** When this tab started (wall clock, ms), against turns' start times. */
  startedAt?: number;
};

/**
 * Shows each notification exactly once across tabs, without a leader.
 *
 * Every tab detects events itself, so delivery never depends on another tab
 * surviving, waking up, or handing over. For each event a tab takes that
 * event's own Web Lock (waiting while another tab holds it) and, holding it,
 * delivers only if the event still matters (the request is still open, the
 * agent still there, it hasn't been read, no visible tab shows the agent) and
 * its key is in neither the storage ledger nor the deliveries this tab knows
 * of. Deliveries are recorded in the ledger and broadcast to peers, and the
 * deliverer keeps the lock briefly so waiting tabs receive the broadcast
 * first. A tab that starts (or reloads) asks live peers for their delivery
 * history before deciding anything, so failing storage doesn't make it
 * repeat what a surviving tab delivered. A tab that dies before recording a
 * delivery releases the lock to a waiting tab.
 *
 * Peers' history is best effort: an unanswered request (a peer paused,
 * frozen or slow) proves nothing. So when the ledger isn't working, this tab
 * can't confirm that an earlier completion wasn't already announced, and it
 * stays silent for completions whose turn began before it started (replays,
 * catch-up); they still show as unread. Turns that begin after it started,
 * and approvals (a reload's first poll takes pending ones as its baseline),
 * notify as usual.
 *
 * Without Web Locks (no supported browser lacks them) only a visible tab
 * notifies: simple, and at worst two side-by-side windows both show one.
 * Presence is aged by each receiver's own monotonic clock.
 */
export class Notifier {
  private known = new Map<string, number>();
  private presence = new Map<string, { agent: string; at: number }>();
  private own: string | null = null;
  private stopped = false;
  private abort = new AbortController();
  private ready: Promise<void> = Promise.resolve();
  /** Whether the shared ledger reads and writes (else history is unconfirmed). */
  private ledgerOk = true;

  constructor(private deps: NotifierDeps) {}

  start() {
    const { channel } = this.deps;
    // Probe the ledger by rewriting it as it is.
    const ledger = this.deps.ledger.read();
    this.ledgerOk = !!ledger && this.deps.ledger.write(ledger);
    if (!channel) return;
    channel.onmessage = (e) => this.receive(e.data as Message);
    this.post({ t: "presence?" });
    this.post({ t: "history?" });
    const wait = this.deps.historyMs ?? 300;
    this.ready = new Promise((r) => setTimeout(r, wait));
  }

  stop() {
    this.setPresence(null);
    this.stopped = true;
    this.abort.abort();
    if (this.deps.channel) this.deps.channel.onmessage = null;
  }

  /** What this tab visibly shows (null when hidden or closed). */
  setPresence(agent: string | null) {
    if (this.stopped) return;
    this.own = agent;
    this.post({ t: "presence", tab: this.deps.tab, agent });
  }

  watched(agent: string) {
    if (this.own === agent) return true;
    const now = this.deps.clock();
    for (const p of this.presence.values())
      if (p.agent === agent && now - p.at < LIMITS.presenceAge) return true;
    return false;
  }

  /** This tab observed an event; resolves once it has been decided here. */
  async announce(ev: AttentionEvent): Promise<void> {
    await this.ready;
    if (this.stopped || this.delivered(ev.key)) return;
    const { locks } = this.deps;
    if (!locks) {
      if (this.deps.visible()) this.decide(ev);
      return;
    }
    const wait = this.deps.waitMs ?? 120000;
    const signal = AbortSignal.any([
      this.abort.signal,
      AbortSignal.timeout(wait),
    ]);
    await locks
      .request(`paseo-command:notify:${ev.key}`, { signal }, async () => {
        const told = this.decide(ev);
        if (told === null) return;
        // Let the broadcast reach waiting tabs before they get the lock. If
        // no other tab can learn of this delivery (no storage, no channel),
        // outlast their wait instead, so they give up rather than repeat it.
        const hold = this.deps.holdMs ?? 3000;
        await new Promise((r) => setTimeout(r, told ? hold : wait + hold));
      })
      .catch(() => {});
  }

  /**
   * Delivers if still due. Returns null if nothing was recorded, else whether
   * other tabs can learn of the delivery.
   */
  private decide(ev: AttentionEvent): boolean | null {
    if (this.stopped || this.delivered(ev.key)) return null;
    // Waiting for the lock doesn't extend relevance: check against now.
    if (!this.deps.relevant(ev)) return null;
    if (!this.confirmable(ev)) return null;
    const told = this.record(ev.key);
    if (!this.deps.acknowledged(ev) && !this.watched(ev.agentId))
      this.deps.deliver(ev);
    return told;
  }

  /**
   * Whether this tab can rule out an earlier delivery of the event: always,
   * unless the ledger is failing and the completion's turn predates the tab.
   */
  private confirmable(ev: AttentionEvent) {
    if (this.ledgerOk || ev.turn === undefined) return true;
    return ev.turn >= (this.deps.startedAt ?? -Infinity);
  }

  private delivered(key: string) {
    if (this.known.has(key)) return true;
    const ledger = this.deps.ledger.read();
    return !!ledger && Object.hasOwn(ledger, key);
  }

  private remember(key: string, at: number) {
    this.known.delete(key);
    this.known.set(key, at);
    while (this.known.size > LIMITS.ledgerCap)
      this.known.delete(this.known.keys().next().value!);
  }

  /**
   * Marks a key delivered here, in storage (best effort) and for peers.
   * Returns whether any other tab can learn of it.
   */
  private record(key: string) {
    const now = this.deps.now();
    this.remember(key, now);
    const ledger = this.deps.ledger.read();
    const stored =
      !!ledger &&
      this.deps.ledger.write(trimLedger({ ...ledger, [key]: now }, now));
    this.ledgerOk = stored;
    this.post({ t: "delivered", keys: [key] });
    return stored || !!this.deps.channel;
  }

  private post(m: Message) {
    try {
      this.deps.channel?.postMessage(m);
    } catch {
      // A closed channel just means no peers to tell.
    }
  }

  private receive(m: Message) {
    if (!m || this.stopped) return;
    if (m.t === "delivered") {
      const now = this.deps.now();
      for (const key of m.keys.slice(-LIMITS.ledgerCap))
        this.remember(key, now);
    } else if (m.t === "history?") {
      if (this.known.size)
        this.post({ t: "delivered", keys: [...this.known.keys()] });
    } else if (m.t === "presence") {
      if (m.agent)
        this.presence.set(m.tab, { agent: m.agent, at: this.deps.clock() });
      else this.presence.delete(m.tab);
    } else if (m.t === "presence?")
      this.post({ t: "presence", tab: this.deps.tab, agent: this.own });
  }
}
