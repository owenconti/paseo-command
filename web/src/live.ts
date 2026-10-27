import {
  agentClientId,
  agentIdParts,
  qualifyAgent,
  qualifyPermission,
} from "./agentIdentity";
import {
  activeAgents,
  agentExcluded,
  archiveAgent,
  onAgentArchived,
} from "./activeAgents";
import type { Agent, PendingPermission } from "./types";
/**
 * The tab's one live connection: a WebSocket to `/api/ws` carrying the
 * fleet and every session this tab watches. (WebSockets don't take one of
 * the browser's six HTTP/1.1 connections per origin, so any number of tabs
 * and sessions leaves reads and commands their connections.)
 *
 * The fleet arrives as a reset and then per-host patches. Every message and
 * read names the revision of the (resource, host) group it carries; per
 * group, anything older than what is shown is dropped, so a slow read can't
 * undo a newer push, nor a push a newer read. When the connection drops,
 * every row is marked stale at once, reads poll slowly as a fallback (their
 * own stale marks are the server's), and it reconnects with backoff; the
 * reset replaces everything, and sessions are asked for again.
 */
export type Resource =
  "agents" | "projects" | "workspaces" | "permissions" | "hosts";
export const RESOURCES: Resource[] = [
  "agents",
  "projects",
  "workspaces",
  "permissions",
  "hosts",
];
/**
 * A row as the server sends it. Only the fields kept here are named; the
 * app reads each resource as its own type (Agent, Project, Host...).
 */
export type LiveRow = {
  id?: string;
  projectId?: string;
  workspaceId?: string;
  agentId?: string;
  serverId?: string;
  host?: string;
  state?: string;
  stale?: boolean;
  [field: string]: unknown;
};
/** A fleet reset: every resource's rows by host, with their revisions. */
export type FleetReset = {
  data?: Partial<Record<Resource, Record<string, unknown>>>;
  revs?: Partial<Record<Resource, Record<string, number>>>;
  status?: unknown;
  statusRev?: number;
};
/** A change to one (resource, host) group. */
export type FleetPatch = {
  resource?: string;
  host?: unknown;
  rev: number;
  remove?: string[];
  upsert?: LiveRow[];
  order?: unknown;
};
const keyOf: Record<Resource, (r: LiveRow) => string | undefined> = {
  agents: (r) => r.id,
  projects: (r) => r.projectId,
  workspaces: (r) => r.workspaceId,
  permissions: (r) => `${r.agentId}:${r.id}`,
  hosts: (r) => r.serverId,
};
/** A row's host group: rows from remote hosts carry their server id. */
const groupOf = (resource: Resource, row: LiveRow) =>
  resource === "hosts" ? "" : row.host ? String(row.host) : "local";

type Group = { order: string[]; rows: Map<string, LiveRow>; rev: number };
export type FleetState = {
  /** Per resource: host → rows in order, with the revision shown. */
  groups: Record<Resource, Map<string, Group>>;
  status: unknown;
  statusRev: number;
  /** Resources no read has vouched for while disconnected. */
  failed: Set<Resource | "status">;
  live: boolean;
};
export function emptyFleet(): FleetState {
  return {
    groups: Object.fromEntries(
      RESOURCES.map((r) => [r, new Map<string, Group>()]),
    ) as FleetState["groups"],
    status: null,
    statusRev: -1,
    failed: new Set(),
    live: false,
  };
}
const revOf = (s: FleetState, resource: Resource, host: string) =>
  s.groups[resource].get(host)?.rev ?? -1;

function group(resource: Resource, rows: unknown, rev: number): Group {
  const g: Group = { order: [], rows: new Map(), rev };
  const list: LiveRow[] = Array.isArray(rows) ? rows : [];
  for (const r of resource === "agents"
    ? activeAgents(list as Agent[])
    : list) {
    const id = keyOf[resource](r);
    if (!id || g.rows.has(id)) continue;
    g.order.push(id);
    g.rows.set(id, r);
  }
  return g;
}

/** Apply a reset: everything is replaced. */
export function applyReset(
  state: FleetState,
  msg: FleetReset | null | undefined,
) {
  for (const resource of RESOURCES) {
    const byHost = new Map<string, Group>();
    for (const [host, rows] of Object.entries(msg?.data?.[resource] ?? {}))
      byHost.set(
        host,
        group(resource, rows, msg?.revs?.[resource]?.[host] ?? 0),
      );
    state.groups[resource] = byHost;
  }
  state.status = msg?.status ?? null;
  state.statusRev = msg?.statusRev ?? 0;
  state.failed.clear();
  state.live = true;
  return [...RESOURCES, "status"] as (Resource | "status")[];
}

/** Apply one patch; false when it is older than what is shown. */
export function applyPatch(
  state: FleetState,
  msg: FleetPatch | null | undefined,
) {
  const resource = msg?.resource as Resource;
  if (!msg || !RESOURCES.includes(resource)) return false;
  const host = String(msg.host ?? "");
  if (msg.rev < revOf(state, resource, host)) return false;
  const g = state.groups[resource].get(host) ?? {
    order: [],
    rows: new Map(),
    rev: -1,
  };
  const rows = new Map(g.rows);
  for (const id of msg.remove ?? []) rows.delete(id);
  const added: string[] = [];
  for (const r of msg.upsert ?? []) {
    // The server keys every row it sends.
    const id = keyOf[resource](r) as string;
    if (resource === "agents" && agentExcluded(r as Agent)) {
      archiveAgent(id, r.host || (host === "local" ? undefined : host));
      rows.delete(id);
      continue;
    }
    if (!rows.has(id)) added.push(id);
    rows.set(id, r);
  }
  const order: string[] = Array.isArray(msg.order)
    ? msg.order.filter((id: string) => rows.has(id))
    : [...g.order.filter((id) => rows.has(id)), ...added];
  state.groups[resource] = new Map(state.groups[resource]).set(host, {
    order,
    rows,
    rev: msg.rev,
  });
  state.failed.delete(resource);
  return true;
}

/**
 * Apply a read: its rows grouped by host, each group at the revision the
 * server named for it (`revs`). Groups the read doesn't have are dropped
 * only when its host list is at least as new as the one shown.
 */
export function applyRead(
  state: FleetState,
  resource: Resource | "status",
  value: unknown,
  revs: Record<string, number> | undefined,
) {
  state.failed.delete(resource);
  if (resource === "status") {
    const rev = revs?.[""] ?? -1;
    if (rev < state.statusRev) return false;
    state.statusRev = rev;
    state.status = value;
    return true;
  }
  const byHost: Record<string, LiveRow[]> = {};
  const list: LiveRow[] = Array.isArray(value) ? value : [];
  for (const r of list) (byHost[groupOf(resource, r)] ??= []).push(r);
  const next = new Map(state.groups[resource]);
  let changed = false;
  for (const [host, rows] of Object.entries(byHost)) {
    const rev = revs?.[host] ?? -1;
    if (rev < revOf(state, resource, host)) continue;
    next.set(host, group(resource, rows, rev));
    changed = true;
  }
  // Hosts the read has a revision for but no rows: empty as of that revision.
  for (const [host, rev] of Object.entries(revs ?? {})) {
    if (host === "*" || byHost[host] || rev < revOf(state, resource, host))
      continue;
    next.set(host, group(resource, [], rev));
    changed = true;
  }
  const hostsRev = revs?.["*"];
  if (hostsRev !== undefined && hostsRev >= revOf(state, "hosts", ""))
    for (const host of [...next.keys()])
      if (!(host in (revs ?? {}))) {
        next.delete(host);
        changed = true;
      }
  state.groups[resource] = next;
  return changed;
}

/**
 * One resource's rows, local first. While disconnected, rows that no read
 * has vouched for are stale.
 */
export function rowsOf(state: FleetState, resource: Resource): LiveRow[] {
  const groups = [...state.groups[resource].entries()].sort(
    ([a], [b]) => Number(b === "local") - Number(a === "local"),
  );
  const rawRows = groups.flatMap(([, g]) =>
    g.order.map((id) => g.rows.get(id)!),
  );
  const rows: LiveRow[] =
    resource === "agents"
      ? (rawRows as Agent[]).map(qualifyAgent)
      : resource === "permissions"
        ? (rawRows as PendingPermission[]).map(qualifyPermission)
        : rawRows;
  if (state.live || !state.failed.has(resource)) return rows;
  if (resource === "hosts")
    return rows.map((h) =>
      h.state === "offline" ? h : { ...h, state: "stale" },
    );
  return rows.map((r) => (r.stale ? r : { ...r, stale: true }));
}

export const LIVE_CLIENT = {
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  /** Fallback reads while disconnected. */
  pollMs: 10000,
  pollHiddenMs: 30000,
  /** How long a connection must stay up before its backoff is forgotten. */
  stableMs: 5000,
};

type Reader = (
  path: string,
) => Promise<{ value: unknown; revs?: Record<string, number> }>;
/** A GET with the revisions of what it carries. */
export const read: Reader = async (path) => {
  const res = await fetch(`/api/${path}`);
  const value = await res.json();
  if (!res.ok) throw new Error(value?.error || "Request failed");
  let revs: Record<string, number> | undefined;
  try {
    revs = JSON.parse(res.headers.get("X-Paseo-Rev") || "null") ?? undefined;
  } catch {
    revs = undefined;
  }
  return { value, revs };
};

/** What a socket needs to look like (a browser WebSocket, or a test double). */
export type SocketLike = {
  send(text: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  readyState: number;
};
/** Where a fleet change came from. */
export type FleetSource = "patch" | "read" | "reset" | "lost";
export type FleetHandlers = {
  /** `source`: a push of one change ("patch"), a read, a whole-fleet reset
   * (connecting, reconnecting or catching up) or the connection dropping. */
  changed: (
    state: FleetState,
    resources: (Resource | "status")[],
    source: FleetSource,
  ) => void;
  errors?: (failures: string[]) => void;
  connection?: (live: boolean) => void;
};
export type SessionHandlers = {
  /** `detail`, `timeline` or `state`, as the server sends them. */
  event: (event: string, data: unknown) => void;
  /** The connection itself went down (true) or came back (false). */
  down: (down: boolean) => void;
};

/** The tab's live connection. */
export class LiveConnection {
  readonly state = emptyFleet();
  private socket?: SocketLike;
  private fleet = new Set<FleetHandlers>();
  private sessions = new Map<
    string,
    { agentId: string; host?: string; h: SessionHandlers }
  >();
  private failures = 0;
  /** Failures are forgotten only once a connection has stayed up a while. */
  private stable?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  private poll?: ReturnType<typeof setTimeout>;
  private refreshing?: Promise<void>;
  private closed = false;
  private sids = 0;
  constructor(
    private readonly options: {
      socket?: () => SocketLike;
      read?: Reader;
      hidden?: () => boolean;
    } = {},
  ) {}

  private open() {
    if (this.closed || this.socket) return;
    const make =
      this.options.socket ??
      (() => {
        const scheme = location.protocol === "https:" ? "wss" : "ws";
        return new WebSocket(
          `${scheme}://${location.host}/api/ws`,
        ) as unknown as SocketLike;
      });
    let socket: SocketLike;
    try {
      socket = make();
    } catch {
      return this.lost();
    }
    this.socket = socket;
    const mine = () => this.socket === socket && !this.closed;
    socket.onopen = () => {
      if (!mine()) return;
      for (const [sid, s] of this.sessions) this.ask(sid, s);
    };
    socket.onmessage = (e) => {
      if (!mine()) return;
      let msg: { event?: string; data?: unknown } | null;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.receive(msg?.event, msg?.data);
    };
    socket.onclose = socket.onerror = () => {
      if (!mine()) return;
      this.socket = undefined;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      this.lost();
    };
  }

  private receive(event: string | undefined, data: unknown) {
    if (event === "reset") {
      // A connection that delivers a reset and then drops at once (a
      // payload it can't take) keeps backing off rather than looping.
      if (this.stable) clearTimeout(this.stable);
      this.stable = setTimeout(() => {
        this.stable = undefined;
        this.failures = 0;
      }, LIVE_CLIENT.stableMs);
      if (this.poll) clearTimeout(this.poll);
      this.poll = undefined;
      const changed = applyReset(this.state, data as FleetReset | null);
      for (const h of this.fleet) {
        h.connection?.(true);
        h.errors?.([]);
        h.changed(this.state, changed, "reset");
      }
      for (const s of this.sessions.values()) s.h.down(false);
    } else if (event === "patch") {
      const patch = data as FleetPatch | null;
      if (patch && applyPatch(this.state, patch))
        for (const h of this.fleet)
          h.changed(this.state, [patch.resource as Resource], "patch");
    } else if (event === "status") {
      const status = data as { rev: number; status?: unknown };
      if (status.rev < this.state.statusRev) return;
      this.state.statusRev = status.rev;
      this.state.status = status.status ?? null;
      for (const h of this.fleet) h.changed(this.state, ["status"], "patch");
    } else if (event === "session") {
      const message = data as {
        sid?: string;
        event: string;
        data?: { Archived?: unknown };
      } | null;
      const session = this.sessions.get(message?.sid ?? "");
      if (
        message &&
        session &&
        !agentExcluded({ id: session.agentId, host: session.host, status: "" })
      ) {
        if (message.event === "detail" && message.data?.Archived)
          archiveAgent(session.agentId, session.host);
        else session.h.event(message.event, message.data);
      }
    }
  }
  /** Whether the connection is up (pushes arrive). */
  get connected() {
    return this.state.live;
  }

  /** The connection dropped: stale rows, fallback reads, reconnect with backoff. */
  private lost() {
    if (this.stable) clearTimeout(this.stable);
    this.stable = undefined;
    const wasLive = this.state.live;
    this.state.live = false;
    for (const r of [...RESOURCES, "status"] as const) this.state.failed.add(r);
    if (wasLive || this.failures === 0)
      for (const h of this.fleet) {
        h.connection?.(false);
        h.changed(this.state, [...RESOURCES, "status"], "lost");
      }
    for (const s of this.sessions.values()) s.h.down(true);
    if (this.closed) return;
    this.failures++;
    void this.refresh();
    this.schedulePoll();
    const delay = Math.min(
      LIVE_CLIENT.backoffMaxMs,
      LIVE_CLIENT.backoffBaseMs * 2 ** Math.max(0, this.failures - 1),
    );
    this.retry = setTimeout(() => {
      this.retry = undefined;
      this.open();
    }, delay);
  }

  private schedulePoll() {
    if (this.closed || this.state.live || this.poll || !this.fleet.size) return;
    const hidden = this.options.hidden ?? (() => document.hidden);
    this.poll = setTimeout(
      () => {
        this.poll = undefined;
        if (this.closed || this.state.live) return;
        void this.refresh().finally(() => this.schedulePoll());
      },
      hidden() ? LIVE_CLIENT.pollHiddenMs : LIVE_CLIENT.pollMs,
    );
  }

  /** Read the fleet now, ordered against pushes by revision. */
  refresh() {
    const get = this.options.read ?? read;
    return (this.refreshing ??= (async () => {
      const paths: (Resource | "status")[] = [...RESOURCES, "status"];
      const results = await Promise.allSettled(paths.map((p) => get(p)));
      if (this.closed) return;
      const changed: (Resource | "status")[] = [];
      const errors: string[] = [];
      results.forEach((r, i) => {
        const resource = paths[i];
        if (r.status === "fulfilled") {
          if (applyRead(this.state, resource, r.value.value, r.value.revs))
            changed.push(resource);
        } else {
          errors.push(`${resource}: ${(r.reason as Error)?.message}`);
          if (!this.state.live) {
            this.state.failed.add(resource);
            if (resource === "status") this.state.status = null;
            changed.push(resource);
          }
        }
      });
      for (const h of this.fleet) {
        h.errors?.(errors);
        if (changed.length) h.changed(this.state, changed, "read");
      }
    })().finally(() => (this.refreshing = undefined)));
  }

  /** Follow the fleet. Returns how to stop. */
  subscribeFleet(h: FleetHandlers) {
    this.fleet.add(h);
    this.closed = false;
    // Something to show at once: what this tab already has, else a read.
    if (this.state.live)
      h.changed(this.state, [...RESOURCES, "status"], "reset");
    else void this.refresh();
    this.open();
    return () => {
      this.fleet.delete(h);
      this.maybeClose();
    };
  }

  private ask(sid: string, s: { agentId: string; host?: string }) {
    try {
      this.socket?.send(
        JSON.stringify({
          type: "watch",
          sid,
          agentId: agentIdParts(s.agentId).id,
          ...(s.host || agentIdParts(s.agentId).host
            ? { host: s.host || agentIdParts(s.agentId).host }
            : {}),
        }),
      );
    } catch {
      // Asked again when the connection reopens.
    }
  }

  /** Watch a session over this connection. Returns how to stop. */
  watch(agentId: string, host: string | undefined, h: SessionHandlers) {
    host ||= agentIdParts(agentId).host;
    agentId = agentClientId(agentId, host);
    if (agentExcluded({ id: agentId, host, status: "" })) return () => {};
    const sid = `s${++this.sids}`;
    const s = { agentId, host, h };
    this.sessions.set(sid, s);
    const archived = onAgentArchived((id, archivedHost) => {
      if (
        agentClientId(id, archivedHost) !== agentId ||
        (archivedHost || "") !== (host || "")
      )
        return;
      this.sessions.delete(sid);
      try {
        this.socket?.send(JSON.stringify({ type: "unwatch", sid }));
      } catch {
        /* Connection is gone. */
      }
    });
    this.closed = false;
    this.open();
    if (this.socket?.readyState === 1) this.ask(sid, s);
    else if (!this.socket) h.down(true);
    return () => {
      archived();
      this.sessions.delete(sid);
      try {
        if (this.socket?.readyState === 1)
          this.socket.send(JSON.stringify({ type: "unwatch", sid }));
      } catch {
        // Gone with the connection.
      }
      this.maybeClose();
    };
  }

  private maybeClose() {
    if (this.fleet.size || this.sessions.size) return;
    this.close();
  }
  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    if (this.poll) clearTimeout(this.poll);
    if (this.stable) clearTimeout(this.stable);
    this.retry = this.poll = this.stable = undefined;
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
    this.state.live = false;
  }
}

let shared: LiveConnection | undefined;
/** The tab's connection (one per page). */
export function liveConnection() {
  return (shared ??= new LiveConnection());
}
// A hot-reloaded module mustn't leave its socket and timers behind.
import.meta.hot?.dispose(() => {
  shared?.close();
  shared = undefined;
});

/** Follow the fleet over the tab's connection. */
export function connectFleet(
  handlers: FleetHandlers,
  connection = liveConnection(),
) {
  const stop = connection.subscribeFleet(handlers);
  return {
    state: connection.state,
    refresh: () => connection.refresh(),
    close: stop,
  };
}
