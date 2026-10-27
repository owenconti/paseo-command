import type { HostDirectory, HostSummary } from "@getpaseo/client";
import { daemon, discard, loopbackTarget, release } from "../daemon";
import { TUNING, forget, hostHealth, isLive, remember } from "../fleet";
import { feedOf, syncFeeds } from "../live";
import { admissionClosed } from "../proc";
import { redactText } from "../redact";
import { PaseoError, paseo } from "./cli";
import { id } from "./validate";

/** The SDK client for a daemon, as `daemon()` opens it. */
export type DaemonClient = Awaited<ReturnType<typeof daemon>>;

/**
 * Bound an SDK request; the SDK's own default is 60s. A read that times out
 * also discards its client (pass it), so a wedged socket isn't reused.
 */
export function timed<T>(
  value: Promise<T>,
  ms = TUNING.sdkReadMs,
  client?: unknown,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    value,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (client) discard(client);
        reject(
          new PaseoError(
            `The Paseo daemon did not answer within ${Math.round(ms / 1000)}s.`,
            "",
            true,
          ),
        );
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// ── The local daemon ───────────────────────────────────────────────────────
/**
 * Where the local daemon listens. Only the CLI knows: it reads the daemon's
 * home directory, which this app never does. Asked once, again after a
 * connection to the answer fails (a restart may move it), and at most every
 * `LOCAL.rediscoverMs`. `PASEO_COMMAND_DAEMON` (host:port) skips the CLI.
 */
export const LOCAL = { rediscoverMs: 2000 };
let listen: { target?: Promise<string>; at: number } = { at: 0 };
function localTarget(): Promise<string> {
  const fixed = process.env.PASEO_COMMAND_DAEMON;
  if (fixed) return Promise.resolve(loopbackTarget(fixed));
  if (listen.target) return listen.target;
  if (Date.now() - listen.at < LOCAL.rediscoverMs && listen.at)
    return Promise.reject(
      new Error("The local daemon isn't answering. Retrying shortly."),
    );
  listen.at = Date.now();
  const found = paseo(["status"], false, undefined, REGISTRY.timeoutMs).then(
    (s) =>
      loopbackTarget(String((s as { listen?: unknown } | null)?.listen || "")),
  );
  listen.target = found;
  found.catch(() => {
    if (listen.target === found) listen.target = undefined;
  });
  return found;
}
/** The SDK client for the local daemon (over loopback). */
export async function localClient() {
  const target = await localTarget();
  try {
    // Nothing new is opened once the app is shutting down.
    return await daemon(target, () => !admissionClosed());
  } catch (error) {
    // It may have restarted elsewhere: look again next time.
    if (!process.env.PASEO_COMMAND_DAEMON) listen = { at: listen.at };
    throw error;
  }
}

// ── The host registry ──────────────────────────────────────────────────────
type HostInfo = {
  serverId: string;
  label: string;
  status: string;
  local: boolean;
};
export type Registry = {
  localId?: string;
  hosts: HostInfo[];
  /** serverId -> daemon-provided targetDescription, for enabled remote hosts only. */
  targets: Map<string, string>;
  /** serverId -> the daemon's own last connection error, if any. */
  errors: Map<string, string>;
  /** When the daemon last confirmed these registrations (0: never). */
  confirmedAt: number;
};
/** The local daemon's identity and version, as the status bar shows them. */
type LocalStatus = {
  serverId?: string;
  hostname?: string;
  daemonVersion?: string | null;
  localDaemon: string;
  connectedDaemon: string;
};
type HostRow = ReturnType<typeof hostRow>;
// The registry comes from the local daemon. Once known it's served while it
// refreshes in the background, and the last good copy survives a hiccup there
// so remote hosts don't vanish with it.
let lastStatus: LocalStatus | undefined,
  lastHostRows: HostRow[] | undefined,
  /** When `lastHostRows` was last confirmed by the daemon; 0 once a refresh fails. */
  hostRowsAt = 0,
  statusOk = false;
/** The local daemon's identity and version (getDaemonStatus + its registry's self). */
function statusCall() {
  const call = remember(
    "local|host-status",
    10000,
    async (): Promise<LocalStatus> => {
      const client = await localClient();
      const [s, directory] = await Promise.all([
        timed(client.getDaemonStatus(), REGISTRY.timeoutMs, client),
        timed(client.listHosts(), REGISTRY.timeoutMs, client).catch(() => null),
      ]);
      return {
        serverId: s?.serverId,
        hostname: directory?.self?.label,
        daemonVersion: s?.version,
        localDaemon: "running",
        connectedDaemon: "reachable",
      };
    },
  );
  call.then(
    (v) => {
      lastStatus = v;
      statusOk = true;
    },
    () => (statusOk = false),
  );
  return call;
}
/** The local daemon's status: the last answer while a refresh runs. */
export async function localStatus() {
  const call = statusCall();
  return lastStatus ?? call;
}
/** A host registration as the browser and the registry checks see it. */
function hostRow(h: HostSummary) {
  const error: unknown = h?.error;
  const message = (error as { message?: unknown } | null)?.message;
  return {
    serverId: h?.serverId,
    label: h?.label,
    enabled: h?.enabled,
    status: h?.status,
    targetDescription: h?.targetDescription,
    error:
      typeof error === "string"
        ? error
        : typeof message === "string"
          ? message
          : null,
  };
}
const isDirectory = (v: unknown): v is HostDirectory =>
  typeof v === "object" &&
  v !== null &&
  Array.isArray((v as { hosts?: unknown }).hosts);
/** The `listHosts` call currently running, if any. */
let registryRunning: Promise<unknown> | undefined;
/**
 * One order for every statement about the registry: a read is numbered when
 * it is requested, a pushed change when it arrives. Only a statement newer
 * than the last one committed may change the registrations or their
 * confirmation, so neither a late read nor a late push can restore a host
 * that a newer statement removed, or re-confirm what a newer failure
 * withdrew.
 */
let registryClock = 0;
let registryCommitted = 0;
const beginRegistry = () => ++registryClock;
/**
 * The registry, read from the local daemon, recording each real answer (or
 * failure) in that order. The confirmation is stamped with when the read
 * started, inside the call, so a cache hit never makes an old registry look
 * freshly confirmed.
 */
function registryCall() {
  const call = remember("local|hosts", 10000, () => {
    const version = beginRegistry();
    const startedAt = Date.now();
    const running = (async () => {
      const client = await localClient();
      const directory = await timed(
        client.listHosts(),
        REGISTRY.timeoutMs,
        client,
      );
      if (!isDirectory(directory))
        throw new Error("The daemon returned no host registry.");
      return directory;
    })();
    registryRunning = running;
    const done = () => {
      if (registryRunning === running) registryRunning = undefined;
    };
    running.then(done, done);
    return running.then(
      (directory) => {
        commitRegistry(directory, version, startedAt);
        return directory.hosts;
      },
      (error) => {
        // The daemon couldn't confirm its registrations: whatever was
        // confirmed before may since have been removed, so it no longer
        // authorises anything, and remote feeds stop contacting hosts.
        if (version > registryCommitted) {
          registryCommitted = version;
          hostRowsAt = 0;
          followHosts();
        }
        throw error;
      },
    );
  });
  call.catch(() => {});
  return call;
}
function commitRegistry(directory: HostDirectory, version: number, at: number) {
  if (version <= registryCommitted) return false;
  registryCommitted = version;
  lastHostRows = directory.hosts.map(hostRow);
  hostRowsAt = at;
  if (directory.self?.serverId && lastStatus)
    lastStatus = { ...lastStatus, serverId: directory.self.serverId };
  followHosts();
  return true;
}
/**
 * The registry from the local daemon's subscription: its snapshot (numbered
 * when subscribed) and each change (numbered on arrival). A read started
 * before a change is older than it, so a cached or running read can't
 * answer for the registry any more: the next one asks again.
 */
const pushedRegistry = {
  begin: beginRegistry,
  commit(directory: unknown, version: number) {
    if (!isDirectory(directory)) return;
    if (commitRegistry(directory, version, Date.now()))
      forget(undefined, ["hosts"]);
  },
};
/** The registry as last known, without waiting for anything. */
export function registryNow(): Registry {
  const known = lastStatus;
  const localId =
    typeof known?.serverId === "string" && known.serverId
      ? known.serverId
      : undefined;
  const localLive = isLive("local");
  const hosts: HostInfo[] = [
    {
      serverId: localId || "local",
      label:
        (typeof known?.hostname === "string" && known.hostname) ||
        "This machine",
      status:
        localLive || (statusOk && known?.connectedDaemon === "reachable")
          ? "online"
          : "offline",
      local: true,
    },
  ];
  const targets = new Map<string, string>();
  const errors = new Map<string, string>();
  for (const h of lastHostRows ?? []) {
    if (!h?.enabled || typeof h.serverId !== "string" || !h.serverId) continue;
    if (h.serverId === localId) continue;
    hosts.push({
      serverId: h.serverId,
      label: typeof h.label === "string" && h.label ? h.label : h.serverId,
      status: typeof h.status === "string" ? h.status : "unknown",
      local: false,
    });
    if (typeof h.targetDescription === "string" && h.targetDescription)
      targets.set(h.serverId, h.targetDescription);
    if (typeof h.error === "string" && h.error)
      errors.set(h.serverId, redactText(h.error).slice(0, 200));
  }
  return { localId, hosts, targets, errors, confirmedAt: hostRowsAt };
}
/**
 * The registry as last known, refreshing behind. `wait` (default) waits for
 * what isn't known yet; callers with their own deadline pass false.
 */
export async function hostRegistry(wait = true): Promise<Registry> {
  const status = statusCall();
  const hostsCall = registryCall();
  if (wait)
    await Promise.allSettled([
      ...(lastStatus === undefined ? [status] : []),
      ...(lastHostRows === undefined ? [hostsCall] : []),
    ]);
  return registryNow();
}
export type Remote = { serverId: string; label: string; target: string };
/**
 * Requests that name a host act on a registration the daemon confirmed
 * within `maxAge` (shorter for commands). A registry that can't be confirmed
 * is refused, never replaced by the last-known copy kept for display.
 * Waiting on the registry is bounded by `waitMs` in total, and concurrent
 * requests share one revalidation.
 */
export const REGISTRY = {
  maxAge: { write: 10000, read: 60000 },
  waitMs: 3000,
  /** Registry reads are local; a hung one gives up well before reads do. */
  timeoutMs: 5000,
};
let revalidation: Promise<void> | undefined;
/**
 * One forced registry refresh at a time, shared by everyone who needs it. A
 * refresh already running is joined, never overlapped by a newer one.
 */
function revalidate() {
  return (revalidation ??= (async () => {
    if (registryRunning) await registryRunning.catch(() => {});
    else {
      forget(undefined, ["hosts"]);
      await registryCall().catch(() => {});
    }
  })().finally(() => (revalidation = undefined)));
}
/**
 * The registry, confirmed within the access's max age; throws otherwise.
 * - Both join a refresh that is already running, so a failure it is about
 *   to report can't be outrun by an older confirmation.
 * - A read with a confirmation inside its window then uses it; it never
 *   starts a refresh to wait on.
 * - A write also refreshes a registry that is due (cached for 10s).
 * - Otherwise the registry is revalidated (shared). All waiting is bounded.
 */
async function confirmedRegistry(access: "read" | "write"): Promise<Registry> {
  const maxAge = REGISTRY.maxAge[access];
  const confirmed = () => hostRowsAt > 0 && Date.now() - hostRowsAt <= maxAge;
  const deadline = Date.now() + REGISTRY.waitMs;
  const upTo = (p: Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      p.catch(() => {}),
      new Promise((r) => {
        timer = setTimeout(r, Math.max(0, deadline - Date.now()));
      }),
    ]).finally(() => clearTimeout(timer));
  };
  // Identity (the local serverId) comes from the daemon's status; discovering
  // it is inside the same deadline as everything else.
  const identity = lastStatus === undefined ? upTo(statusCall()) : undefined;
  if (access === "write") await upTo(registryCall());
  else if (registryRunning) await upTo(registryRunning);
  if (!confirmed()) await upTo(revalidate());
  await identity;
  // Re-checked last: the confirmation must still be fresh after the waits.
  if (!confirmed())
    throw new Error(
      "Couldn't confirm the host's registration with the local daemon. Try again shortly.",
    );
  return registryNow();
}
/**
 * Resolve a client-supplied host (a serverId) to a daemon target. Absent or local
 * → undefined. Raw endpoints are never accepted from the client.
 * Fails closed: an unconfirmed or removed registration is refused.
 */
export async function resolveHost(
  raw: unknown,
  access: "read" | "write" = "read",
): Promise<Remote | undefined> {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const serverId = id(raw);
  const registry = await confirmedRegistry(access);
  if (
    serverId === registry.localId ||
    (!registry.localId && serverId === "local")
  )
    return undefined;
  const target = registry.targets.get(serverId);
  if (!target) throw new Error("Unknown host");
  const label =
    registry.hosts.find((h) => h.serverId === serverId)?.label || serverId;
  const host = { serverId, label, target };
  // One contact policy for every request, as for feeds and watches: a host
  // the registry doesn't say is online is never opened.
  if (
    !remotesOf(registryNow()).some((h) => h.serverId === serverId && h.online)
  )
    throw new HostOffline(host);
  return host;
}
/** A registered host that may not be contacted right now. */
export class HostOffline extends Error {
  constructor(readonly host: Remote) {
    super(
      `${host.label} is offline. It will be contacted again once its registration says it's back.`,
    );
  }
}
/** Health key: remote serverId, or "local" for this machine's daemon. */
export const hostKey = (host?: Remote) => host?.serverId ?? "local";

/**
 * Every enabled remote host with a target. Offline ones are listed but not
 * contacted, and nor is any host while the registry can't be confirmed: their
 * last-known rows are shown, stale, without reaching an unverified target.
 */
export function remotesOf(registry: Registry) {
  const confirmed =
    registry.confirmedAt > 0 &&
    Date.now() - registry.confirmedAt <= REGISTRY.maxAge.read;
  return registry.hosts
    .filter((h) => !h.local)
    .flatMap((h) => {
      const target = registry.targets.get(h.serverId);
      return target
        ? [
            {
              serverId: h.serverId,
              label: h.label,
              target,
              online: confirmed && h.status === "online",
            },
          ]
        : [];
    });
}
export async function remoteHosts() {
  return remotesOf(await hostRegistry());
}

/**
 * The SDK client for a host: the local daemon over loopback, or a
 * registered remote. The contact policy is checked again once connected
 * (the registry may have changed while connecting): a host that may no
 * longer be contacted at that target loses the connection, and nothing is
 * sent to it.
 */
export async function sdk(host?: Remote): Promise<DaemonClient> {
  if (!host) return localClient();
  let client;
  try {
    // No new connection unless the host may be contacted at this target.
    client = await daemon(
      host.target,
      () => stillContactable(host) && !admissionClosed(),
    );
  } catch (error) {
    if (!stillContactable(host)) throw new HostOffline(host);
    throw error;
  }
  if (!stillContactable(host)) {
    release(host.target);
    throw new HostOffline(host);
  }
  return client;
}
function stillContactable(host: Remote) {
  return remotesOf(registryNow()).some(
    (h) => h.serverId === host.serverId && h.target === host.target && h.online,
  );
}

// ── Following the hosts ────────────────────────────────────────────────────
let following = false;
/** Start following (true), or false if already following. */
export function follow() {
  if (following) return false;
  following = true;
  return true;
}
export function unfollow() {
  following = false;
}
/** Make the live feeds match the registry (and start the local one). */
export function followHosts() {
  if (!following) return;
  const registry = registryNow();
  syncFeeds([
    {
      key: "local",
      label: "The local daemon",
      target: "local",
      connect: localClient,
      contact: true,
      registry: pushedRegistry,
      dropped: () => forget(undefined, ["rows"]),
    },
    ...remotesOf(registry).map((h) => ({
      key: h.serverId,
      label: h.label,
      target: h.target,
      connect: () =>
        sdk({ serverId: h.serverId, label: h.label, target: h.target }),
      contact: h.online,
      dropped: () => forget(h.target, ["rows"]),
    })),
  ]);
}
/** Wait (bounded) until the registry is known, so a reset has the hosts. */
export function registryKnown() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    hostRegistry(),
    new Promise((r) => {
      timer = setTimeout(r, REGISTRY.waitMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function hostChips(registry: Registry) {
  return registry.hosts.map((h) => {
    const health = hostHealth(
      h.local ? "local" : h.serverId,
      h.status === "online",
    );
    return {
      ...h,
      ...health,
      error: health.error ?? registry.errors.get(h.serverId) ?? null,
    };
  });
}
export function statusView() {
  const s = lastStatus;
  const feed = feedOf("local");
  const reachable = feed
    ? feed.state === "live" || (feed.state === "connecting" && statusOk)
    : statusOk;
  if (!s || !reachable) return null;
  return {
    localDaemon: s.localDaemon,
    connectedDaemon: s.connectedDaemon,
    daemonVersion: s.daemonVersion,
    hostname: s.hostname,
  };
}

/** Forget the local daemon's address, its status and the registry (tests). */
export function resetRegistry() {
  lastStatus = lastHostRows = undefined;
  hostRowsAt = 0;
  revalidation = registryRunning = undefined;
  registryClock = registryCommitted = 0;
  statusOk = false;
  listen = { at: 0 };
}
