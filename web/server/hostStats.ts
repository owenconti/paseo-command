/**
 * Each host machine's load, from the host-stats Paseo plugin
 * (github.com/owenconti/paseo-cc-plugins) on its daemon: CPU, memory and disk
 * use, as whole-machine percents. A host without the plugin (or that can't
 * answer) is left out. Read-only: the plugin only reads the machine's figures.
 */
import type { HostStats } from "../../rendering/src/world";

export const HOST_STATS = {
  plugin: "host-stats",
  method: "stats.snapshot",
  /** How long CPU use is measured over, on the host. */
  sampleMs: 500,
  /** How long a host's figures are reused; the page polls at this rate. */
  ttlMs: 15000,
  /** How long a host that couldn't answer (no plugin, an older daemon) is left alone. */
  retryMs: 60000,
  timeoutMs: 8000,
};

/** The parts of the plugin's snapshot the map reads. */
type Snapshot = {
  cpu?: { usagePercent?: unknown };
  memory?: { usedPercent?: unknown };
  disks?: { usedPercent?: unknown }[];
};

const share = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : undefined;

/** The map's figures from a plugin snapshot, or null when it holds none. */
export function hostStatsOf(raw: unknown): HostStats | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Snapshot;
  const stats: HostStats = {};
  const cpu = share(s.cpu?.usagePercent);
  const memory = share(s.memory?.usedPercent);
  // The first filesystem is the root's (the plugin's default order).
  const disk = share(Array.isArray(s.disks) ? s.disks[0]?.usedPercent : undefined);
  if (cpu !== undefined) stats.cpu = cpu;
  if (memory !== undefined) stats.memory = memory;
  if (disk !== undefined) stats.disk = disk;
  return Object.keys(stats).length ? stats : null;
}

export type HostStatsDeps = {
  /** "local" and each online remote host's key. */
  hosts(): Promise<string[]>;
  /** Calls a plugin method on a host's daemon. */
  invoke(host: string, plugin: string, method: string, input: unknown): Promise<unknown>;
  now?: () => number;
};

type Entry = { at: number; stats: HostStats | null; pending?: Promise<HostStats | null> };
const cache = new Map<string, Entry>();
export function resetHostStats() {
  cache.clear();
}

function read(host: string, deps: HostStatsDeps, now: number): Promise<HostStats | null> {
  const hit = cache.get(host);
  if (hit?.pending) return hit.pending;
  if (hit && now - hit.at < (hit.stats ? HOST_STATS.ttlMs : HOST_STATS.retryMs))
    return Promise.resolve(hit.stats);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = Promise.race([
    deps.invoke(host, HOST_STATS.plugin, HOST_STATS.method, { sampleMs: HOST_STATS.sampleMs, limit: 1 }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), HOST_STATS.timeoutMs);
    }),
  ])
    .then(hostStatsOf, () => null)
    .finally(() => clearTimeout(timer))
    .then((stats) => {
      cache.set(host, { at: (deps.now ?? Date.now)(), stats });
      return stats;
    });
  cache.set(host, { at: hit?.at ?? 0, stats: hit?.stats ?? null, pending });
  return pending;
}

/** Each answering host's figures, keyed "local" or its server id. */
export async function hostStats(deps: HostStatsDeps): Promise<Record<string, HostStats>> {
  const now = (deps.now ?? Date.now)();
  const hosts = await deps.hosts().catch(() => ["local"]);
  const out: Record<string, HostStats> = {};
  await Promise.all(
    hosts.map(async (host) => {
      const stats = await read(host, deps, now);
      if (stats) out[host] = stats;
    }),
  );
  return out;
}

/** `GET /api/hoststats`: every reachable host's load, from the app's own daemons. */
export async function hostStatsRoute() {
  const { remoteHosts, sdk } = await import("./api/hosts");
  return hostStats({
    hosts: async () => ["local", ...(await remoteHosts()).filter((h) => h.online).map((h) => h.serverId)],
    invoke: async (host, plugin, method, input) => {
      const remote = host === "local" ? undefined : (await remoteHosts()).find((h) => h.serverId === host);
      if (host !== "local" && !remote) throw new Error("Unknown host");
      const client = await sdk(remote);
      return client.invokePluginRpc(plugin, method, input);
    },
  });
}
