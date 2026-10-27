import type { Agent, Host } from "./types";
import type { FleetState } from "./live";
const PREFIX = "remote:";
/** Local IDs retain their original storage keys; remote agents cannot collide
 * with them or with equal daemon IDs registered on another host. */
export function agentIdParts(clientId: string): { id: string; host?: string } {
  if (clientId.startsWith(PREFIX)) {
    const separator = clientId.indexOf(":", PREFIX.length);
    if (separator > PREFIX.length)
      try {
        return {
          host: decodeURIComponent(clientId.slice(PREFIX.length, separator)),
          id: decodeURIComponent(clientId.slice(separator + 1)),
        };
      } catch {
        /* Invalid external data stays an opaque local ID. */
      }
  }
  return { id: clientId };
}
export function agentClientId(id: string, host?: string) {
  const parsed = agentIdParts(id);
  if (parsed.host && (!host || host === parsed.host)) return id;
  return host
    ? `${PREFIX}${encodeURIComponent(host)}:${encodeURIComponent(id)}`
    : id;
}
export const daemonAgentId = (agent: Pick<Agent, "id" | "daemonId">) =>
  agent.daemonId ?? agentIdParts(agent.id).id;
const normalized = new WeakMap<object, Agent>();
export function qualifyAgent<T extends Agent>(agent: T): T {
  if (!agent.host || agent.daemonId) return agent;
  const hit = normalized.get(agent);
  if (hit) return hit as T;
  const row = {
    ...agent,
    id: agentClientId(agent.id, agent.host),
    daemonId: agent.id,
  };
  normalized.set(agent, row);
  return row;
}
export function qualifyPermission<T extends { agentId: string; host?: string }>(
  permission: T,
): T {
  if (!permission.host) return permission;
  const id = agentClientId(permission.agentId, permission.host);
  return id === permission.agentId
    ? permission
    : { ...permission, agentId: id };
}
/** Resolve a client ID into the unchanged daemon HTTP protocol. The host
 * encoded in an identity wins only when it agrees with any explicit host. */
export function agentApiPath(
  path: string,
  body?: unknown,
): { path: string; body?: unknown } {
  const match = /^(agents\/)([^/?]+)(.*)$/.exec(path);
  if (!match) return { path, body };
  const parts = agentIdParts(match[2]);
  if (!parts.host) return { path, body };
  const url = new URL(
    `${match[1]}${encodeURIComponent(parts.id)}${match[3]}`,
    "http://paseo.invalid/",
  );
  const bodyHost =
    body && typeof body === "object" && "host" in body
      ? (body as { host?: unknown }).host
      : undefined;
  const existingHost = bodyHost ?? url.searchParams.get("host");
  if (existingHost && existingHost !== parts.host)
    throw new Error("This agent belongs to a different host.");
  if (body && typeof body === "object")
    return {
      path: url.pathname.slice(1) + url.search,
      body: { ...body, host: parts.host },
    };
  url.searchParams.set("host", parts.host);
  return { path: url.pathname.slice(1) + url.search, body };
}

export const UNKNOWN_AGENT_DESTINATION =
  "This older queued message has no confirmed host. Check the intended conversation and host, then edit it or send it as a new message.";
/** A partial reset, failed host, or host still loading cannot establish that
 * a raw daemon ID has only one owner. Even a complete fleet cannot establish
 * the destination of a queue item originally saved without that identity. */
export function hasCompleteAgentOwners(state: FleetState, hosts: Host[]) {
  return (
    state.live &&
    !state.failed.has("agents") &&
    state.groups.hosts.has("") &&
    hosts.length > 0 &&
    hosts.every(
      (host) =>
        (host.state ?? (host.status === "online" ? "online" : "offline")) ===
          "online" &&
        (state.groups.agents.get(host.local ? "local" : host.serverId)?.rev ??
          -1) >= 0,
    )
  );
}

/** Fence unqualified legacy sends before publishing any fleet rows. Copy
 * other legacy state only after all registered hosts have authoritative data.
 * A migrated hostless queue still requires an explicit new-message decision. */
/** A queued message as stored, possibly by an older version of the app. */
export type StoredQueued = {
  target?: string;
  destinationUnknown?: boolean;
  sending?: unknown;
  uncertain?: boolean;
  error?: string;
  images?: unknown;
  owner?: unknown;
  imagesLost?: boolean;
  [field: string]: unknown;
};
const migrationListeners = new Set<(moved: Record<string, string>) => void>();
export function onAgentIdentityMigration(
  listener: (moved: Record<string, string>) => void,
) {
  migrationListeners.add(listener);
  return () => void migrationListeners.delete(listener);
}
export function migrateAgentStorage(
  agents: Agent[],
  storage: Storage = localStorage,
  { complete = false }: { complete?: boolean } = {},
) {
  const owners = new Map<string, Agent[]>();
  for (const agent of agents) {
    const raw = daemonAgentId(agent);
    owners.set(raw, [...(owners.get(raw) ?? []), agent]);
  }
  const moved: Record<string, string> = {};
  for (const [raw, rows] of owners) {
    const key = `paseo-command:queue:${raw}`,
      value = storage.getItem(key);
    if (value) {
      const queue = JSON.parse(value);
      if (Array.isArray(queue)) {
        let changed = false;
        const fenced = queue.map((item: StoredQueued) => {
          if (item.target || item.destinationUnknown) return item;
          changed = true;
          return {
            ...item,
            sending: undefined,
            uncertain: true,
            destinationUnknown: true,
            error: UNKNOWN_AGENT_DESTINATION,
          };
        });
        if (changed) storage.setItem(key, JSON.stringify(fenced));
      }
    }
    if (!complete || rows.length !== 1) continue;
    if (!rows[0].host) continue;
    const target = agentClientId(raw, rows[0].host);
    if (target === raw) continue;
    for (const prefix of ["draft:", "queue:", "queue-sent:"]) {
      const sourceKey = `paseo-command:${prefix}${raw}`,
        targetKey = `paseo-command:${prefix}${target}`;
      const source = storage.getItem(sourceKey);
      if (source === null || storage.getItem(targetKey) !== null) continue;
      let value = source;
      if (prefix === "queue:") {
        const queue = JSON.parse(source);
        if (!Array.isArray(queue)) continue;
        // A durable local/other-host destination must never be reassigned just
        // because that owner is absent from this particular fleet snapshot.
        if (
          queue.some(
            (item: StoredQueued) =>
              item.target && item.target !== target && !item.destinationUnknown,
          )
        )
          continue;
        value = JSON.stringify(
          queue.map((item: StoredQueued) => {
            const next = { ...item, target };
            if (next.sending) {
              delete next.sending;
              next.uncertain = true;
              next.error =
                "It may have been sent before this app upgraded. Check the conversation before sending again.";
            }
            if (next.images) {
              delete next.owner;
              next.imagesLost = true;
              next.error = `${next.destinationUnknown ? UNKNOWN_AGENT_DESTINATION + " " : next.uncertain ? "It may already have been sent. " : ""}Its images are unavailable after upgrading. Edit it to attach them again, or send without them as a new message.`;
            }
            return next;
          }),
        );
      }
      storage.setItem(targetKey, value);
      if (storage.getItem(targetKey) === value) {
        storage.removeItem(sourceKey);
        moved[raw] = target;
      }
    }
    // Attention entries have no side effects until a real matching fleet row
    // names the same turn; moving the identity preserves notification receipts.
    for (const name of [
      "finished",
      "seen",
      "attention:finished",
      "attention:seen",
      "attention:missing",
      "attention:notified",
    ]) {
      const key = `paseo-command:${name}`,
        value = storage.getItem(key);
      if (!value) continue;
      const map = JSON.parse(value);
      if (!map || typeof map !== "object" || Array.isArray(map)) continue;
      let changed = false;
      for (const entry of Object.keys(map)) {
        const next =
          entry === raw
            ? target
            : name === "attention:notified" && entry.startsWith(`${raw}:`)
              ? target + entry.slice(raw.length)
              : null;
        if (!next || next in map) continue;
        map[next] = map[entry];
        delete map[entry];
        changed = true;
      }
      if (changed) {
        storage.setItem(key, JSON.stringify(map));
        moved[raw] = target;
      }
    }
  }
  if (Object.keys(moved).length)
    for (const listener of migrationListeners) listener(moved);
  return moved;
}
