/** What is served: groups of rows per resource and host, each with a revision. */
import { view } from "../fleet";
import { relativeTime } from "../rows";
import { stamp } from "../versioned";

/** A served row: only the fields that identify it are named. */
export type Row = {
  id?: string;
  projectId?: string;
  workspaceId?: string;
  agentId?: string;
  serverId?: string;
  createdAt?: unknown;
  [field: string]: unknown;
};
/** The resources pushed, and each row's identity within a host. */
const RESOURCES: Record<string, (row: Row) => string | undefined> = {
  agents: (r) => r.id,
  projects: (r) => r.projectId,
  workspaces: (r) => r.workspaceId,
  permissions: (r) => `${r.agentId}:${r.id}`,
  hosts: (r) => r.serverId,
};
export type ViewHost = {
  key: string;
  serverId?: string;
  label?: string;
  contact: boolean;
};
/** Host chips and the daemon status. */
export type Extras = { hosts: Row[]; status: unknown };
/** What the push stream shows: supplied by the API (it owns the registry). */
export type ViewSource = {
  /** Hosts in display order: "local" first. */
  hosts: () => ViewHost[];
  /** Host chips and daemon status, computed as the reads compute them. */
  extras: () => Extras;
};
let source: ViewSource | undefined;
export function setSource(v: ViewSource | undefined) {
  source = v;
}

/**
 * One host's rows for a resource as they stand right now, tagged as reads
 * return them, with the revision of exactly this content.
 */
export function capture(resource: string, h: ViewHost) {
  const v = view(h.key, resource, h.contact);
  // Snapshots hold rows as hostRows (or a fan-out read) shaped them.
  const held = (v?.rows ?? []) as Row[];
  const rows: Row[] = held.map((r) => ({
    ...r,
    ...(h.key !== "local" ? { host: h.serverId, hostLabel: h.label } : {}),
    ...(v?.stale ? { stale: true } : {}),
  }));
  return { rows, rev: stamp(`${resource}|${h.key}`, rows) };
}
/** The chips and the daemon status, with their revisions. */
export function captureExtras(extras: Extras) {
  return {
    hosts: { rows: extras.hosts, rev: stamp("hosts|", extras.hosts) },
    status: {
      value: extras.status ?? null,
      rev: stamp("status", extras.status ?? null),
    },
  };
}
/** `created` is relative, so it's added when sent, never stamped. */
export const withCreated = (row: Row, now = Date.now()): Row =>
  row.createdAt !== undefined
    ? { ...row, created: relativeTime(row.createdAt, now) }
    : row;

/** One host's rows for a resource, as JSON by id, in order. */
export type Group = { order: string[]; rows: Map<string, string>; rev: number };
export type View = {
  groups: Map<string, Map<string, Group>>;
  status: { value: unknown; rev: number };
};
export function currentView(): View {
  const groups = new Map<string, Map<string, Group>>();
  if (!source) return { groups, status: { value: null, rev: 0 } };
  const hosts = source.hosts();
  const extras = captureExtras(source.extras());
  for (const resource of Object.keys(RESOURCES)) {
    const byHost = new Map<string, Group>();
    const add = (key: string, c: { rows: Row[]; rev: number }) => {
      const keyOf = RESOURCES[resource];
      const g: Group = { order: [], rows: new Map(), rev: c.rev };
      for (const r of c.rows) {
        const id = keyOf(r);
        if (!id || g.rows.has(id)) continue;
        g.order.push(id);
        g.rows.set(id, JSON.stringify(r));
      }
      byHost.set(key, g);
    };
    if (resource === "hosts") add("", extras.hosts);
    else for (const h of hosts) add(h.key, capture(resource, h));
    groups.set(resource, byHost);
  }
  return { groups, status: extras.status };
}
/** A row of a group, as sent. */
export const rowOf = (g: Group, id: string, now: number): Row =>
  withCreated(JSON.parse(g.rows.get(id)!), now);
export function resetMessage(v: View) {
  const now = Date.now();
  const data: Record<string, Record<string, Row[]>> = {};
  const revs: Record<string, Record<string, number>> = {};
  for (const [resource, byHost] of v.groups) {
    data[resource] = {};
    revs[resource] = {};
    for (const [host, g] of byHost) {
      data[resource][host] = g.order.map((id) => rowOf(g, id, now));
      revs[resource][host] = g.rev;
    }
  }
  return { revs, data, status: v.status.value, statusRev: v.status.rev };
}
