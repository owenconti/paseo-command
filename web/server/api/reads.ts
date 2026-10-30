import { TUNING, fromHost, remember, scopeOf, upstream, view } from "../fleet";
import {
  allWorkspaces,
  capture,
  captureExtras,
  hostRows,
  serverIdOf,
  unarchivedAgents,
  withCreated,
} from "../live";
import type { Row } from "../live/view";
import { modelRows, profileRows, providerRows } from "../rows";
import {
  hostChips,
  hostKey,
  localClient,
  registryNow,
  remoteHosts,
  remotesOf,
  sdk,
  timed,
  type Remote,
} from "./hosts";

// ── Fan-out reads ──────────────────────────────────────────────────────────
// Each read costs a few milliseconds over the socket; share what overlaps.
const LIVE_TTL = 3500,
  REMOTE_TTL = 6000;
type Resource = "agents" | "projects" | "workspaces" | "permissions";
/**
 * A host's fan-out rows from one round of SDK reads, used while its live
 * feed is down (or before it is up). Only these real calls record health.
 */
function rowsOf(host?: Remote) {
  return remember(
    `${scopeOf(host?.target)}|rows`,
    host ? REMOTE_TTL : LIVE_TTL,
    () =>
      upstream(hostKey(host), async () => {
        const client = await sdk(host);
        const ms = host ? TUNING.remoteReadMs : TUNING.localReadMs;
        const [agents, workspaces, projects] = await Promise.all([
          timed(unarchivedAgents(client), ms, client),
          timed(allWorkspaces(client), ms, client),
          timed(client.listProjects(), ms, client),
        ]);
        return hostRows({
          active: [],
          inactive: agents,
          workspaces,
          projects: Array.isArray(projects?.projects) ? projects.projects : [],
          serverId: serverIdOf(client),
        });
      }),
  );
}
/**
 * Local rows (untagged) followed by rows from every remote host, with the
 * revision of each host's group. Hosts are independent: a live host answers
 * from its feed at once; otherwise the local daemon is awaited, a remote
 * host never holds up the response beyond TUNING.deadlineMs, and a failing
 * or slow host keeps its last-known rows, marked `stale: true`. Every group
 * is captured from the store after all waiting, at once, so its revision is
 * that of exactly what is sent.
 */
export async function aggregate(resource: Resource) {
  const pick = (host?: Remote) => () =>
    rowsOf(host).then((r): unknown[] => r[resource]);
  const [local, hosts] = await Promise.all([
    fromHost("local", resource, pick(), { wait: "settle" }).then(
      () => undefined,
      (error: unknown) => error,
    ),
    remoteHosts().then(
      (hosts) =>
        Promise.all(
          hosts.map((h) =>
            fromHost(h.serverId, resource, pick(h), {
              wait: "deadline",
              fetch: h.online,
            }).catch(() => {}),
          ),
        ).then(() => hosts),
      () => [] as Awaited<ReturnType<typeof remoteHosts>>,
    ),
  ]);
  const now = Date.now();
  const revs: Record<string, number> = {};
  const rows: Row[] = [];
  const mine = capture(resource, { key: "local", contact: true });
  revs.local = mine.rev;
  // The registry as the push stream sees it, now.
  for (const h of remotesOf(registryNow())) {
    if (!hosts.some((x) => x.serverId === h.serverId)) continue;
    const theirs = capture(resource, {
      key: h.serverId,
      serverId: h.serverId,
      label: h.label,
      contact: h.online,
    });
    revs[h.serverId] = theirs.rev;
    rows.push(...theirs.rows);
  }
  revs["*"] = captureExtras({
    hosts: hostChips(registryNow()),
    status: null,
  }).hosts.rev;
  if (local !== undefined && !view("local", resource) && !rows.length)
    throw local;
  return {
    rows: [...mine.rows, ...rows].map((r) => withCreated(r, now)),
    revs,
  };
}

function stripIcons(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIcons);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "icon")
        .map(([k, v]) => [k, stripIcons(v)]),
    );
  return value;
}
// Usage is collected from provider accounts and changes slowly. Once there is an
// answer, serve it and refresh in the background; a failed refresh keeps it.
let usageRows: unknown | undefined;
export function usage() {
  const refresh = remember("local|usage", 300000, async () => {
    const client = await localClient();
    const r = await timed(client.listUsageReports(), undefined, client);
    return Array.isArray(r?.reports) ? r.reports : [];
  }).then((rows) => {
    usageRows = stripIcons(rows);
    return usageRows;
  });
  refresh.catch(() => {});
  return usageRows ? Promise.resolve(usageRows) : refresh.catch(() => []);
}
export function resetUsage() {
  usageRows = undefined;
}
export function providers(host?: Remote) {
  return remember(`${scopeOf(host?.target)}|providers`, 30000, async () => {
    const client = await sdk(host);
    return providerRows(
      await timed(client.getProvidersSnapshot(), undefined, client),
    );
  });
}
/**
 * The host's agent profiles: named provider, model, thinking, mode and
 * feature bundles kept in its daemon config (Paseo's Settings → Profiles).
 */
export function profiles(host?: Remote) {
  return remember(`${scopeOf(host?.target)}|profiles`, 30000, async () => {
    const client = await sdk(host);
    const r = await timed(client.getDaemonConfig(), undefined, client);
    return profileRows(r?.config?.agentProfiles);
  });
}
export function models(provider: string, host?: Remote) {
  return remember(
    `${scopeOf(host?.target)}|models:${provider}`,
    600000,
    async () => {
      const client = await sdk(host);
      return modelRows(
        await timed(client.listProviderModels(provider), undefined, client),
      );
    },
  );
}
export function projectsOf(host?: Remote) {
  return remember(`${scopeOf(host?.target)}|projects`, 3500, async () => {
    const client = await sdk(host);
    const r = await timed(client.listProjects(), undefined, client);
    return hostRows({
      active: [],
      inactive: [],
      workspaces: [],
      projects: Array.isArray(r?.projects) ? r.projects : [],
    }).projects;
  });
}
/** The host's active workspaces, read from the daemon now (never cached). */
export async function currentWorkspaces(host?: Remote) {
  const client = await sdk(host);
  const rows = await timed(allWorkspaces(client), undefined, client);
  return hostRows({ active: [], inactive: [], workspaces: rows, projects: [] })
    .workspaces;
}
/** The host's workspace label catalog. */
export async function labelCatalog(host?: Remote) {
  const client = await sdk(host);
  const r = await timed(client.listWorkspaceLabels(), undefined, client);
  return (Array.isArray(r?.labels) ? r.labels : []).map((l) => ({
    name: String(l.name),
    color: String(l.color),
  }));
}
