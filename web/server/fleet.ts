/**
 * Per-host isolation for everything that fans out across hosts.
 *
 * Every read goes through one memo cache (in-flight calls are shared, freshness
 * counts from when the answer arrived) whose keys start with the daemon they
 * came from, so a mutation can drop exactly the keys it could have changed.
 *
 * Each host's fan-out rows are kept as a last-known snapshot. A remote host never
 * holds up a response once it has answered at least once: its snapshot is served
 * while a refresh runs in the background, and rows are marked `stale` whenever
 * they may not be current (old, last refresh failed, host failing or offline,
 * or dropped by a mutation and not yet replaced). Failing hosts back off
 * exponentially instead of spawning a CLI process on every poll.
 *
 * Host health comes only from real upstream calls (see `upstream`): a value
 * served from the memo says nothing about whether the host is answering.
 */

/** Tunables; tests shrink them. */
export const TUNING = {
  /** Longest a fan-out waits for a remote host that has no usable snapshot. */
  deadlineMs: 1500,
  /** Longest the local daemon holds a response when it has a snapshot to serve. */
  localDeadlineMs: 3000,
  /** In-flight fetches older than this make a host "slow". */
  slowAfterMs: 1500,
  /** Snapshots older than this are marked stale. */
  staleAfterMs: 30000,
  backoffBaseMs: 2000,
  backoffMaxMs: 60000,
  /** The local daemon recovers quickly after a restart; never wait long on it. */
  localBackoffMaxMs: 4000,
  /** Hard limits for one CLI read. An unroutable host otherwise takes ~15s. */
  remoteReadMs: 8000,
  localReadMs: 15000,
  /** Mutations may legitimately take longer (e.g. creating a worktree). */
  writeMs: 30000,
  /** SDK requests default to a 60s timeout; reads should give up much sooner. */
  sdkReadMs: 10000,
};

// ── Memo cache ─────────────────────────────────────────────────────────────
/** `bytes`: a timeline page's size, counted against PAGES.maxBytes. */
type Entry = { expires: number; value: Promise<unknown>; bytes?: number };
const memo = new Map<string, Entry>();
/** Bytes of the timeline pages held (entries with `bytes`). */
let pageBytes = 0;
/**
 * The one way an entry goes (expiry, eviction, invalidation, replacement,
 * failure, reset): its value and its accounting leave together. With
 * `entry`, only if that entry is still the one held.
 */
function release(key: string, entry?: Entry) {
  const held = memo.get(key);
  if (!held || (entry && held !== entry)) return;
  memo.delete(key);
  if (held.bytes !== undefined) pageBytes -= held.bytes;
}
/** The last successful value per key, kept past expiry for stale-while-revalidate. */
const lastGood = new Map<string, { value: unknown; at: number }>();

let sweptAt = 0;
/** Per-agent keys accumulate as agents are viewed; drop long-expired ones. */
function sweep(now: number) {
  if (now - sweptAt < 60000) return;
  sweptAt = now;
  for (const [key, entry] of memo)
    if (entry.expires < now - 60000) release(key);
  for (const [key, good] of lastGood)
    if (good.at < now - 600000) lastGood.delete(key);
}

/**
 * Every invalidation, in order, so a load can tell whether one that covers
 * its key happened while it was running. Bounded: a load older than the
 * oldest record kept is treated as covered.
 */
let forgetSeq = 0;
const forgets: { seq: number; match: (full: string) => boolean }[] = [];
const FORGETS_KEPT = 500;
function forgottenSince(full: string, since: number) {
  if (since === forgetSeq) return false;
  if (!forgets.length || forgets[0].seq > since + 1) return true;
  return forgets.some((f) => f.seq > since && f.match(full));
}

/**
 * `key` must start with its daemon scope (`local|` or `<target>|`).
 *
 * A load that was running when a matching `forget` happened (a mutation
 * settled meanwhile) is never stored: its callers get the answer they asked
 * for, but the cache doesn't keep it, so it can't be served after the
 * mutation as if it were current.
 */
export function remember<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
  options: {
    lastGood?: boolean;
    stored?: (key: string, value: T) => void;
  } = {},
): Promise<T> {
  sweep(Date.now());
  const existing = memo.get(key);
  // Held under its own key, so it holds a T.
  if (existing && existing.expires > Date.now())
    return existing.value as Promise<T>;
  if (existing) release(key, existing);
  const began = epoch;
  const since = forgetSeq;
  // The callbacks run after `entry` exists: a promise never settles synchronously.
  const value = load().then(
    (v) => {
      if (forgottenSince(key, since)) {
        // Superseded by a mutation while running: answer, don't keep.
        entry.expires = 0;
        release(key, entry);
        return v;
      }
      entry.expires = Date.now() + ttl;
      if (memo.get(key) === entry && began === epoch) {
        if (options.lastGood !== false)
          lastGood.set(key, { value: v, at: Date.now() });
        options.stored?.(key, v);
      }
      return v;
    },
    (e) => {
      release(key, entry);
      throw e;
    },
  );
  const entry: Entry = { expires: Infinity, value };
  memo.set(key, entry);
  return value;
}

/**
 * Timeline pages (older pages, change pages): remembered like everything
 * else (so commands and epoch changes forget them, in flight too), but
 * never kept past expiry, and bounded in bytes, oldest dropped first.
 */
export const PAGES = { ttlMs: 15000, maxBytes: 32 * 1024 * 1024 };
let pageExpiryTimer: ReturnType<typeof setTimeout> | undefined;
let pageExpiryAt = Infinity;
/** Expired pages go at once (they are never served stale). */
function expirePages(now: number) {
  for (const [key, entry] of memo)
    if (entry.bytes !== undefined && entry.expires <= now) release(key);
}
/** One payload-free timer survives an early callback after a clock adjustment. */
function armPageExpiry() {
  let next = Infinity;
  for (const entry of memo.values())
    if (entry.bytes !== undefined) next = Math.min(next, entry.expires);
  if (pageExpiryTimer && pageExpiryAt === next) return;
  if (pageExpiryTimer) clearTimeout(pageExpiryTimer);
  pageExpiryTimer = undefined;
  pageExpiryAt = next;
  if (!Number.isFinite(next)) return;
  pageExpiryTimer = setTimeout(
    () => {
      pageExpiryTimer = undefined;
      pageExpiryAt = Infinity;
      expirePages(Date.now());
      armPageExpiry();
    },
    Math.min(0x7fffffff, Math.max(1, next - Date.now() + 1)),
  );
  pageExpiryTimer.unref?.();
}
export function rememberPage<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  expirePages(Date.now());
  return remember(key, PAGES.ttlMs, load, {
    lastGood: false,
    stored: (k, v) => {
      const entry = memo.get(k)!;
      entry.bytes = Buffer.byteLength(JSON.stringify(v ?? null));
      pageBytes += entry.bytes;
      expirePages(Date.now());
      // Oldest first, until within the bound (the newest always stays).
      for (const [held, e] of memo) {
        if (pageBytes <= PAGES.maxBytes) break;
        if (held !== k && e.bytes !== undefined) release(held);
      }
      // No entry/promise is captured, so eviction also releases its payload.
      armPageExpiry();
    },
  });
}
/** Test and diagnostics view of the page cache. */
export function pageCacheStats() {
  let entries = 0;
  for (const e of memo.values()) if (e.bytes !== undefined) entries++;
  return { entries, bytes: pageBytes };
}

/** The last value `remember` produced for a key, and its age, even if expired. */
export function peek(key: string): { value: unknown; age: number } | undefined {
  const good = lastGood.get(key);
  return good && { value: good.value, age: Date.now() - good.at };
}

export const scopeOf = (target?: string) => target ?? "local";

/**
 * Drop keys in one daemon's scope: exact names, or prefixes ending in ":".
 * Their last-good values go too, so nothing dropped is served stale-while-
 * revalidating.
 */
export function forget(target: string | undefined, keys: string[]) {
  const scope = `${scopeOf(target)}|`;
  const match = (full: string) => {
    if (!full.startsWith(scope)) return false;
    const key = full.slice(scope.length);
    return keys.some(
      (k) => key === k || (k.endsWith(":") && key.startsWith(k)),
    );
  };
  for (const full of [...memo.keys()]) if (match(full)) release(full);
  for (const full of [...lastGood.keys()])
    if (match(full)) lastGood.delete(full);
  forgets.push({ seq: ++forgetSeq, match });
  if (forgets.length > FORGETS_KEPT) forgets.shift();
}

/** Test and diagnostics view of what is cached. */
export function cachedKeys() {
  return [...memo.keys()];
}

/** Every key with a cached or last-good value (anything that could be served). */
export function knownKeys() {
  return [...new Set([...memo.keys(), ...lastGood.keys()])];
}

let epoch = 0;
export function resetFleet() {
  epoch++;
  if (pageExpiryTimer) clearTimeout(pageExpiryTimer);
  pageExpiryTimer = undefined;
  pageExpiryAt = Infinity;
  for (const key of [...memo.keys()]) release(key);
  lastGood.clear();
  forgets.length = 0;
  forgetSeq = 0;
  health.clear();
  snapshots.clear();
  pending.clear();
  generations.clear();
  live.clear();
}

// ── Host health ────────────────────────────────────────────────────────────
type Health = {
  failures: number;
  failedAt: number;
  retryAt: number;
  error: string;
  lastOkAt: number;
};
const health = new Map<string, Health>();
function healthOf(host: string) {
  let h = health.get(host);
  if (!h) {
    h = { failures: 0, failedAt: 0, retryAt: 0, error: "", lastOkAt: 0 };
    health.set(host, h);
  }
  return h;
}

/** A short, safe reason for a host chip. */
export function reasonOf(error: unknown) {
  // A RunError (CLI) or any other thrown value.
  const e = error as
    | { detail?: unknown; timedOut?: unknown; message?: unknown }
    | null
    | undefined;
  const detail = String(e?.detail || "")
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  const text = e?.timedOut
    ? String(e.message)
    : detail || String(e?.message || "Request failed");
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

function failed(host: string, startedAt: number, error: unknown) {
  const h = healthOf(host);
  h.error = reasonOf(error);
  // Parallel calls launched before the first failure was known count once.
  if (startedAt >= h.failedAt || !h.failures) h.failures++;
  h.failedAt = Date.now();
  const max = host === "local" ? TUNING.localBackoffMaxMs : TUNING.backoffMaxMs;
  h.retryAt =
    h.failedAt + Math.min(max, TUNING.backoffBaseMs * 2 ** (h.failures - 1));
}

function succeeded(host: string, startedAt: number) {
  const h = healthOf(host);
  // An answer to a call that began before a later failure was recorded
  // doesn't prove the host has recovered.
  if (h.failures && startedAt < h.failedAt) return;
  h.failures = 0;
  h.retryAt = 0;
  h.error = "";
  h.lastOkAt = Date.now();
}

/**
 * Run one real call to a host and record how it went. Only these outcomes
 * change host health and backoff; wrap the upstream call, never a cache read.
 */
export function upstream<T>(host: string, call: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  const began = epoch;
  return call().then(
    (v) => {
      if (began === epoch) succeeded(host, startedAt);
      return v;
    },
    (error) => {
      if (began === epoch) failed(host, startedAt, error);
      throw error;
    },
  );
}

/** Throws while a host is backing off, so callers fail fast instead of hanging. */
export function assertReachable(host: string, label = host) {
  const h = health.get(host);
  if (h && h.retryAt > Date.now())
    throw new Error(
      `${label} is unreachable${h.error ? ` (${h.error})` : ""}. Retrying in ${Math.ceil((h.retryAt - Date.now()) / 1000)}s.`,
    );
}

// ── Snapshots ──────────────────────────────────────────────────────────────
/** Told whenever a fetched snapshot lands or fails (the push stream). */
export const listeners = { snapshot: () => {} };

type Snapshot = {
  rows: unknown[];
  at: number;
  /** Dropped by a mutation and not yet replaced. */
  dirty: boolean;
  /** When the latest mutation dropped it. */
  dirtyAt?: number;
  /** The latest refresh of this resource failed. */
  failed: boolean;
  /**
   * A read that timed out waiting on this fetch: what is shown meanwhile is
   * stale until that fetch (or a newer one) lands. Kept on the snapshot so
   * any later capture sees the outcome, not a fresh clock sample.
   */
  overdue?: object;
};
const snapshots = new Map<string, Snapshot>();
const pending = new Map<
  string,
  { value: Promise<unknown[]>; startedAt: number; generation: number }
>();
const generations = new Map<string, number>();

/**
 * Hosts whose snapshots a live subscription keeps current (see live.ts).
 * While live, a snapshot is current however old it is, unless a mutation
 * dropped it and the subscription hasn't replaced it yet.
 */
const live = new Set<string>();
export function setLive(host: string, on: boolean) {
  if (on) live.add(host);
  else live.delete(host);
}
export const isLive = (host: string) => live.has(host);

/**
 * A live subscription's rows for one resource. They supersede any fetch in
 * flight (it can't land over them). They clear a mutation's dirty mark only
 * when they come from a listing requested after that mutation settled
 * (`requestedAt`): rows moved on by events alone may not show it yet.
 */
export function publish(
  host: string,
  resource: string,
  rows: unknown[],
  requestedAt?: number,
) {
  const key = `${host}|${resource}`;
  generations.set(key, (generations.get(key) ?? 0) + 1);
  pending.delete(key);
  const prev = snapshots.get(key);
  const dirty = Boolean(
    prev?.dirty &&
    !(requestedAt !== undefined && requestedAt >= (prev.dirtyAt ?? 0)),
  );
  snapshots.set(key, {
    rows,
    at: Date.now(),
    dirty,
    ...(dirty ? { dirtyAt: prev!.dirtyAt } : {}),
    failed: false,
  });
}

/** Forget a host's snapshots (it left the registry). */
export function dropHost(host: string) {
  const prefix = `${host}|`;
  for (const key of [...snapshots.keys()])
    if (key.startsWith(prefix)) {
      snapshots.delete(key);
      generations.set(key, (generations.get(key) ?? 0) + 1);
      pending.delete(key);
    }
  live.delete(host);
  health.delete(host);
}

/**
 * Record a real outcome for a host from outside a fan-out read (a live
 * subscription connecting, or dropping).
 */
export function recordHealth(host: string, startedAt: number, error?: unknown) {
  if (error === undefined) succeeded(host, startedAt);
  else failed(host, startedAt, error);
}

/** One host's rows as they stand, without fetching (the push stream's view). */
export function view(host: string, resource: string, contact = true) {
  const key = `${host}|${resource}`;
  const s = snapshots.get(key);
  if (!s) return undefined;
  return { rows: s.rows, stale: staleness(host, s, contact, key) };
}
function staleness(host: string, s: Snapshot, contact: boolean, key?: string) {
  const h = health.get(host);
  if (live.has(host) && contact) return s.dirty;
  // The local daemon is waited on for a bounded time: past it, what is
  // shown instead is stale until the read lands.
  const running = key ? pending.get(key) : undefined;
  const overdue =
    host === "local" &&
    running !== undefined &&
    (s.overdue === running ||
      Date.now() - running.startedAt >= TUNING.localDeadlineMs);
  return (
    !contact ||
    s.dirty ||
    s.failed ||
    overdue ||
    (h?.failures ?? 0) > 0 ||
    Date.now() - s.at >= TUNING.staleAfterMs
  );
}

/** Which cache keys each fan-out resource is built from. */
const RESOURCES: Record<string, string[]> = {
  agents: ["agents", "agents-unarchived", "projects", "workspaces"],
  projects: ["projects"],
  workspaces: ["workspaces"],
  permissions: ["permissions"],
};

/**
 * After a mutation, drop the host's cache keys and make the next fan-out wait
 * (up to the deadline) for fresh rows instead of serving the snapshot.
 */
export function invalidate(
  host: string,
  target: string | undefined,
  keys: string[],
) {
  forget(target, keys);
  for (const [resource, deps] of Object.entries(RESOURCES)) {
    if (!deps.some((d) => keys.includes(d))) continue;
    const key = `${host}|${resource}`;
    const snap = snapshots.get(key);
    if (snap) {
      snap.dirty = true;
      snap.dirtyAt = Date.now();
    }
    // A fetch already in flight may predate the mutation; never let it land.
    generations.set(key, (generations.get(key) ?? 0) + 1);
    pending.delete(key);
  }
}

function start(host: string, resource: string, load: () => Promise<unknown[]>) {
  const key = `${host}|${resource}`;
  const running = pending.get(key);
  if (running) return running;
  const startedAt = Date.now();
  const generation = generations.get(key) ?? 0;
  const began = epoch;
  const current = () =>
    began === epoch && (generations.get(key) ?? 0) === generation;
  const value = (async () => load())().then(
    (rows) => {
      rows = Array.isArray(rows) ? rows : [];
      if (current()) {
        snapshots.set(key, {
          rows,
          at: Date.now(),
          dirty: false,
          failed: false,
        });
        listeners.snapshot();
      }
      return rows;
    },
    (error) => {
      const snap = snapshots.get(key);
      if (current() && snap) {
        snap.failed = true;
        listeners.snapshot();
      }
      throw error;
    },
  );
  const slot = { value, startedAt, generation };
  pending.set(key, slot);
  value
    .finally(() => {
      if (pending.get(key) === slot) pending.delete(key);
    })
    .catch(() => {});
  return slot;
}

const TIMED_OUT = Symbol("timed out");
function within<T>(value: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    value,
    new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * One host's rows for a fan-out resource.
 *
 * - `wait: "settle"` (the local daemon): wait for the fetch, but once there is
 *   a snapshot, for at most `localDeadlineMs`; on failure or timeout serve the
 *   snapshot (stale), or throw if there is none.
 * - `wait: "deadline"` (remote hosts): a current snapshot is returned at once
 *   and revalidated in the background; otherwise wait until `deadlineMs` after
 *   the fetch started, then return the old snapshot (stale) or nothing, leaving
 *   the fetch running. A host that is failing is never waited on.
 * - `fetch: false` (registry says offline): never contact the host; whatever
 *   snapshot there is, is stale.
 *
 * A fetch superseded by a mutation while this call waited on it is never
 * returned; the call waits for (or falls back from) the fresh one instead.
 */
export async function fromHost(
  host: string,
  resource: string,
  load: () => Promise<unknown[]>,
  options: { wait: "settle" | "deadline"; fetch?: boolean },
  retried = false,
): Promise<{ rows: unknown[]; stale: boolean }> {
  const key = `${host}|${resource}`;
  const h = healthOf(host);
  const backingOff = h.retryAt > Date.now();
  const contact = options.fetch !== false;
  const snap = () => snapshots.get(key);
  // A live subscription keeps this snapshot current: no fetch at all.
  if (contact && live.has(host) && snap() && !snap()!.dirty)
    return { rows: snap()!.rows, stale: false };
  const revalidateOnly =
    options.wait === "deadline" &&
    !pending.has(key) &&
    snapshots.has(key) &&
    !snap()!.dirty &&
    !snap()!.failed &&
    !h.failures &&
    Date.now() - snap()!.at < TUNING.staleAfterMs;
  if (contact && !backingOff && revalidateOnly) {
    // A current snapshot answers now; its refresh is spawned after this
    // response, never in its path.
    const began = epoch;
    setImmediate(() => {
      if (began === epoch) start(host, resource, load).value.catch(() => {});
    });
    return { rows: snap()!.rows, stale: false };
  }
  const slot = !contact || backingOff ? undefined : start(host, resource, load);
  const attempt = slot?.value;
  attempt?.catch(() => {});
  // Anything other than a current answer from a reachable host is stale.
  const stale = () => {
    const s = snap();
    return Boolean(s && staleness(host, s, contact, key));
  };
  const current = () => Boolean(snap() && !stale());
  let fellBack = false;
  const superseded = () =>
    slot !== undefined && (generations.get(key) ?? 0) !== slot.generation;
  const settledWithin = async (ms: number) => {
    const result = await within(attempt!, Math.max(0, ms)).catch(
      (): typeof TIMED_OUT => TIMED_OUT,
    );
    if (result === TIMED_OUT) return undefined;
    if (superseded())
      return retried
        ? undefined
        : fromHost(host, resource, load, options, true);
    // A load can be answered from the memo without any real call: while the
    // host has failures on record, that answer isn't proof it's current.
    return { rows: result, stale: h.failures > 0 };
  };
  if (attempt) {
    if (options.wait === "settle") {
      if (!snap()) {
        // Nothing to show yet: wait for the daemon (bounded by its own timeout).
        try {
          const rows = await attempt;
          if (!superseded()) return { rows, stale: h.failures > 0 };
          if (!retried) return fromHost(host, resource, load, options, true);
        } catch (error) {
          if (!snap()) throw error;
        }
      } else {
        const left = TUNING.localDeadlineMs - (Date.now() - slot!.startedAt);
        const done = await settledWithin(left);
        if (done) return done;
        // The daemon didn't answer in time: what we show instead is stale,
        // for this answer and every capture until the fetch lands.
        fellBack = true;
        const held = snap();
        if (held && pending.get(key) === slot) held.overdue = slot;
      }
    } else if (!current() && !h.failures) {
      // The deadline runs from when the attempt started: polls that join an
      // attempt already past it don't wait again.
      const done = await settledWithin(
        TUNING.deadlineMs - (Date.now() - slot!.startedAt),
      );
      if (done) return done;
    }
  } else if (options.wait === "settle" && !snap())
    assertReachable(host, "The local daemon");
  const s = snap();
  return s
    ? { rows: s.rows, stale: fellBack || stale() }
    : { rows: [], stale: false };
}

export type HostState = "online" | "loading" | "slow" | "stale" | "offline";

/** What a host chip should show, from the fan-outs' own experience of the host. */
export function hostHealth(host: string, registryOnline: boolean) {
  const h = health.get(host);
  if (registryOnline && live.has(host) && !h?.failures)
    return {
      state: "online" as HostState,
      error: null,
      lastOkAt: h?.lastOkAt || null,
      retryAt: null,
    };
  const now = Date.now();
  const prefix = `${host}|`;
  const snaps = [...snapshots].filter(([k]) => k.startsWith(prefix));
  const oldestPending = Math.min(
    ...[...pending]
      .filter(([k]) => k.startsWith(prefix))
      .map(([, p]) => p.startedAt),
  );
  const oldestSnapshot = Math.min(...snaps.map(([, s]) => s.at));
  let state: HostState;
  if (!registryOnline || (h?.failures && !snaps.length)) state = "offline";
  else if (h?.failures || snaps.some(([, s]) => s.failed)) state = "stale";
  else if (now - oldestPending > TUNING.slowAfterMs) state = "slow";
  else if (!snaps.length) state = "loading";
  else if (now - oldestSnapshot > TUNING.staleAfterMs) state = "stale";
  else state = "online";
  return {
    state,
    error: h?.error || null,
    lastOkAt: h?.lastOkAt || null,
    retryAt: h && h.retryAt > now ? h.retryAt : null,
  };
}
