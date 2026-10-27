/**
 * One host's feed: SDK subscriptions to its agents, workspaces and project
 * updates, plus unarchived agents outside the active scope, held under one
 * versioning discipline (server/versioned.ts).
 */
import { TUNING, publish, recordHealth, setLive } from "../fleet";
import { discard } from "../daemon";
import { errorCode, errorMessage, messageOf } from "../errors";
import { Directory, Listing } from "../versioned";
import {
  asUpdate,
  fieldOf,
  updateOf,
  within,
  type AgentRecord,
  type AgentsPage,
  type DirectorySync,
  type DirectoryUpdate,
  type HeldAgent,
  type LiveClient,
  type ProjectRecord,
  type ProjectsPage,
  type WorkspaceRecord,
  type WorkspacesPage,
} from "./client";
import {
  agentItems,
  archivedAgent,
  hostRows,
  serverIdOf,
  unarchivedAgents,
} from "./hostRows";
import { endAgentWatches } from "./sessions";
import { ProviderSubagents } from "./subagents";
import { hiddenSubagent } from "../subagentArchive";
import { LIVE, backoff } from "./tuning";

export type FeedState = "connecting" | "live" | "down" | "stopped";

export type FeedOptions = {
  /** Health and snapshot key: "local" or the remote serverId. */
  key: string;
  label: string;
  connect: () => Promise<LiveClient>;
  /** Called after any change readers could see. */
  changed: () => void;
  /** Called with the ids of agents whose records changed. */
  agentsChanged?: (ids: string[]) => void;
  /**
   * The local daemon's host registry. `begin` numbers a statement before it
   * is requested; `commit` hands it over with that number.
   */
  registry?: {
    begin(): number;
    commit(directory: unknown, version: number): void;
  };
  /** The feed went down: reads cached from before can't stand in for it. */
  dropped?: () => void;
};

/** Bound a read without discarding its client (unlike `within`). */
function timeout<T>(value: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    value,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timed out")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const syncOf = (payload: { sync?: DirectorySync | null } | undefined) => ({
  generation: payload?.sync?.generation,
  headSeq: payload?.sync?.headSeq,
  mode: payload?.sync?.mode,
  removals: payload?.sync?.removals,
});
const projectItems = (r: ProjectsPage | undefined) =>
  (Array.isArray(r?.projects) ? r.projects : [])
    .filter((p) => p?.projectId)
    .map((p) => ({ id: p.projectId, value: p, seq: p.syncSeq }));

/** One host's subscriptions and collections. */
export class Feed {
  state: FeedState = "connecting";
  /** Agents in the active scope (sequenced). */
  readonly active = new Directory<HeldAgent>();
  /** Unarchived agents outside the active workspace scope. */
  readonly background = new Listing<HeldAgent>();
  // A confirmed archive fences late upserts even after a host reconnects.
  private archived = new Set<string>();
  excluded(id: string) {
    return this.archived.has(id);
  }
  exclude(id: string) {
    this.archived.add(id);
    this.background.forget(id);
    endAgentWatches(this.key, id);
    this.changedAgents([id]);
    if (this.loaded) this.publishRows();
  }
  adoptExclusions(previous: Feed) {
    for (const id of previous.archived) this.archived.add(id);
  }
  readonly workspaces = new Directory<WorkspaceRecord>();
  readonly projects = new Directory<ProjectRecord>();
  /** Provider subagents (in-process, inside an agent's turn), by parent. */
  readonly subagents = new ProviderSubagents();
  /** The daemon can't list provider subagents (older daemons, fakes). */
  private noSubagents = false;
  /** True once the feed has had a complete picture (rows worth showing). */
  loaded = false;
  client?: LiveClient;
  error = "";
  private releases: (() => void)[] = [];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private failures = 0;
  /** Bumped per connection: callbacks from an older one are ignored. */
  private epoch = 0;
  private resyncing?: Promise<void>;
  /**
   * The daemon refused sequenced reads (older daemons): packets are
   * numbered on arrival instead (one socket delivers in order), and a read
   * yields to anything that arrived after it was requested.
   */
  plain = false;
  private arrivals = 0;

  constructor(readonly options: FeedOptions) {}

  get key() {
    return this.options.key;
  }

  start() {
    if (this.state === "stopped") return;
    void this.open();
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }
  private clearTimers() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }
  private release() {
    for (const r of this.releases.splice(0)) {
      try {
        r();
      } catch {
        // Already gone with its socket.
      }
    }
  }

  /** The record of an agent this feed holds, if any. */
  agent(id: string) {
    if (this.excluded(id)) return undefined;
    const agent = this.active.get(id)?.agent ?? this.background.get(id)?.agent;
    return archivedAgent(agent) ? undefined : agent;
  }
  /** Number a read of an agent's record before it is requested. */
  issue() {
    return this.background.issue();
  }
  /**
   * An agent record read outside the subscription (a timeline answer), as
   * of request `req`. Only the background collection takes it: the active scope is pushed.
   */
  offer(agent: AgentRecord, req: number) {
    if (
      !agent?.id ||
      this.excluded(agent.id) ||
      archivedAgent(agent) ||
      this.active.entries.has(agent.id)
    )
      return false;
    const prev = this.background.get(agent.id);
    const changed = this.background.one(req, agent.id, {
      agent,
      project: prev?.project ?? null,
    });
    if (changed) {
      this.changedAgents([agent.id]);
      if (this.loaded) this.publishRows();
    }
    return changed;
  }

  /** Publish the rows again (what this app hides changed). */
  republish() {
    if (this.loaded) this.publishRows();
  }
  /** `requestedAt`: these rows come from reads requested then. */
  private publishRows(requestedAt?: number) {
    const rows = hostRows({
      active: this.active.values().filter((e) => !this.excluded(e.agent.id)),
      inactive: this.background
        .values()
        .filter((e) => !this.excluded(e.agent.id)),
      workspaces: this.workspaces.values(),
      projects: this.projects.values(),
      serverId: serverIdOf(this.client),
      subagents: (id) => this.subagents.held(id),
      hidden: (s) => hiddenSubagent(this.key, s),
    });
    for (const [resource, list] of Object.entries(rows))
      publish(this.key, resource, list, requestedAt);
    this.options.changed();
  }
  private changedAgents(ids: string[]) {
    if (ids.length) this.options.agentsChanged?.(ids);
  }
  private cursor<T>(d: Directory<T>) {
    return this.plain ? {} : { sync: d.cursor() };
  }

  private async open() {
    const epoch = ++this.epoch;
    const startedAt = Date.now();
    this.noSubagents = false;
    const current = () => epoch === this.epoch && this.state !== "stopped";
    this.state = "connecting";
    try {
      const client = await this.options.connect();
      if (!current()) return;
      this.client = client;
      const down = (why: string) => {
        if (current()) this.down(new Error(why), epoch);
      };
      if (typeof client.subscribeConnectionStatus === "function")
        this.releases.push(
          client.subscribeConnectionStatus((s) => {
            if (
              s?.status &&
              s.status !== "connected" &&
              s.status !== "connecting"
            )
              down(s.reason || "The daemon connection closed.");
          }),
        );
      const mark = this.arrivals;
      const agents = client.observeAgents({
        scope: "active",
        includeBackground: true,
        ...(this.plain ? {} : { sync: {} }),
      });
      const workspaces = client.observeWorkspaces(
        this.plain ? {} : { sync: {} },
      );
      this.releases.push(
        () => void agents.release().catch(() => {}),
        () => void workspaces.release().catch(() => {}),
      );
      const onError = (e: unknown) => {
        if (errorCode(e) === "invalid_request" && !this.plain)
          this.plain = true;
        down(String(messageOf(e) || "Subscription failed"));
      };
      this.releases.push(
        agents.subscribe({
          snapshot: (s) => current() && this.agentRead(s, mark, true),
          update: (m) => current() && this.agentEvent(m),
          error: onError,
        }),
        workspaces.subscribe({
          snapshot: (s) => current() && this.workspaceRead(s, mark, true),
          update: (m) => current() && this.workspaceEvent(m),
          error: onError,
        }),
      );
      // The local daemon's registry, so hosts come and go without polling.
      const registry = this.options.registry;
      if (registry) {
        try {
          const version = registry.begin();
          const hosts = client.observeHosts?.();
          if (hosts) {
            this.releases.push(() => void hosts.release().catch(() => {}));
            hosts.ready?.catch?.(() => {});
            this.releases.push(
              hosts.subscribe({
                // The snapshot answers a request made at subscription time.
                snapshot: (d) => {
                  if (current() && d) registry.commit(d, version);
                },
                // A change is the daemon's statement on arrival.
                update: (m) => {
                  const directory = fieldOf(fieldOf(m, "payload"), "directory");
                  if (
                    current() &&
                    fieldOf(m, "type") === "hosts.changed" &&
                    directory
                  )
                    registry.commit(directory, registry.begin());
                },
                error: () => {},
              }),
            );
          }
        } catch {
          // The registry heartbeat still reads it.
        }
      }
      try {
        const events = client.observeEvents?.([
          "project.update",
          "agent.provider_subagents.update",
        ]);
        if (events) {
          this.releases.push(() => void events.release().catch(() => {}));
          events.ready?.catch?.(() => {});
        }
      } catch {
        // Older daemons broadcast project updates unasked.
      }
      if (typeof client.on === "function")
        this.releases.push(
          client.on("project.update", (m) => {
            if (current()) this.projectEvent(m);
          }),
          client.on("agent.provider_subagents.update", (m) => {
            if (current() && this.subagents.event(m) && this.loaded)
              this.publishRows();
          }),
        );
      await within(
        Promise.all([
          agents.ready,
          workspaces.ready,
          this.readProjects(client, epoch),
          this.readBackground(client, epoch),
        ]),
        TUNING.sdkReadMs,
        this.options.label,
        client,
      );
      if (!current()) return;
      this.state = "live";
      this.loaded = true;
      this.failures = 0;
      this.error = "";
      setLive(this.key, true);
      recordHealth(this.key, startedAt);
      this.publishRows(startedAt);
      void this.readSubagents(client, epoch);
      this.scheduleResync(epoch);
    } catch (error) {
      if (current()) this.down(error, epoch, startedAt);
    }
  }

  private down(error: unknown, epoch: number, startedAt = Date.now()) {
    if (epoch !== this.epoch || this.state === "stopped") return;
    this.epoch++;
    this.release();
    this.clearTimers();
    const client = this.client;
    this.client = undefined;
    // A socket that stopped delivering must not serve the next request.
    if (client) discard(client);
    this.state = "down";
    this.error = String(messageOf(error) || error || "Disconnected");
    setLive(this.key, false);
    recordHealth(this.key, startedAt, error);
    this.options.dropped?.();
    this.failures++;
    const max =
      this.key === "local" ? LIVE.localBackoffMaxMs : LIVE.backoffMaxMs;
    const delay = backoff(this.failures, max);
    this.options.changed();
    this.later(delay, () => this.start());
  }

  /** Stop for good (host removed, offline, or the server closing). */
  stop() {
    this.epoch++;
    this.state = "stopped";
    this.release();
    this.clearTimers();
    const client = this.client;
    this.client = undefined;
    if (client) discard(client);
    setLive(this.key, false);
  }

  private scheduleResync(epoch: number) {
    this.later(LIVE.resyncMs, () => {
      if (epoch !== this.epoch) return;
      void this.resync()
        .catch(() => {})
        .finally(() => {
          if (epoch === this.epoch) this.scheduleResync(epoch);
        });
    });
  }

  /**
   * Re-read every collection now: what changed after each cursor, the
   * projects, and background agents. Shared while one is running; `fresh` (after a
   * mutation) waits for a running one and starts another, so its reads are
   * requested after the mutation. A failure means what is held can't be
   * vouched for: the feed goes down (its rows stale, the host failing) and
   * reconnects to an authoritative snapshot.
   */
  resync(fresh = false): Promise<void> {
    const running = this.resyncing;
    if (fresh && running)
      return running.catch(() => {}).then(() => this.resync(false));
    const client = this.client;
    if (this.state !== "live" || !client) return Promise.resolve();
    const epoch = this.epoch;
    return (this.resyncing ??= (async () => {
      const requestedAt = Date.now();
      const mark = this.arrivals;
      const [agents, workspaces] = await within(
        Promise.all([
          client.fetchAgents({
            scope: "active",
            includeBackground: true,
            ...this.cursor(this.active),
          }),
          client.fetchWorkspaces(this.cursor(this.workspaces)),
          this.readProjects(client, epoch),
          this.readBackground(client, epoch),
        ]),
        TUNING.sdkReadMs,
        this.options.label,
        client,
      );
      if (epoch !== this.epoch) return;
      this.agentRead(agents, mark, false);
      this.workspaceRead(workspaces, mark, false);
      // Even unchanged, these rows now vouch for everything up to the request.
      this.publishRows(requestedAt);
      void this.readSubagents(client, epoch);
    })()
      .catch((error) => {
        this.down(error, epoch);
        throw error;
      })
      .finally(() => (this.resyncing = undefined)));
  }

  // ── Feeding the collections ──────────────────────────────────────────────
  /** Plain mode numbers packets on arrival; a read sits at its request mark. */
  private plainVersion() {
    return { generation: `plain:${this.epoch}`, seq: ++this.arrivals };
  }
  private readMeta(
    payload: { sync?: DirectorySync | null } | undefined,
    mark: number,
    _first: boolean,
  ) {
    if (!this.plain) return syncOf(payload);
    return {
      // A first read starts a fresh plain generation.
      generation: `plain:${this.epoch}`,
      headSeq: mark,
      mode: "snapshot" as const,
      removals: [],
    };
  }
  private versionOf(p: DirectoryUpdate) {
    return this.plain
      ? this.plainVersion()
      : { generation: p.generation, seq: p.seq };
  }

  private agentRead(
    payload: AgentsPage | undefined,
    mark: number,
    first: boolean,
  ) {
    const meta = this.readMeta(payload, mark, first);
    const archivedRemovals = (
      Array.isArray(payload?.entries) ? payload.entries : []
    ).flatMap((entry) =>
      archivedAgent(entry.agent) && typeof entry.syncSeq === "number"
        ? [{ id: entry.agent.id, seq: entry.syncSeq }]
        : [],
    );
    const r = this.active.read({
      ...meta,
      removals: [...(meta.removals ?? []), ...archivedRemovals],
      items: agentItems(payload?.entries).filter((e) => !this.excluded(e.id)),
    });
    if (r.resync) void this.resync().catch(() => {});
    this.afterAgents(r.changed, !first);
  }
  private afterAgents(ids: string[], publishNow = true) {
    if (!ids.length) return;
    // Do not fetch a removed agent by ID: it may have just been archived.
    // Drop its old background row immediately, then refresh only unarchived rows.
    const removed = ids.filter((id) => !this.active.entries.has(id));
    for (const id of removed) this.background.forget(id);
    if (removed.length && this.client) {
      const epoch = this.epoch;
      void this.readBackground(this.client, epoch).catch((error) =>
        this.down(error, epoch),
      );
    }
    this.changedAgents(ids);
    if (publishNow && this.loaded) this.publishRows();
  }

  private agentEvent(m: unknown) {
    const p = updateOf(m, "agent_update");
    if (!p) return;
    let outcome;
    if (p.kind === "upsert" && p.agent?.id && this.excluded(p.agent.id)) return;
    if (p.kind === "upsert" && p.agent?.id && archivedAgent(p.agent)) {
      outcome = this.active.event(
        "remove",
        p.agent.id,
        undefined,
        this.versionOf(p),
      );
      if (outcome.accepted) this.afterAgents([p.agent.id]);
    } else if (p.kind === "upsert" && p.agent?.id) {
      const held = this.active.get(p.agent.id);
      outcome = this.active.event(
        "upsert",
        p.agent.id,
        {
          agent: p.agent,
          // Some updates omit the placement; keep the last known one.
          project:
            p.project === undefined ? (held?.project ?? null) : p.project,
        },
        this.versionOf(p),
      );
      if (outcome.changed) this.afterAgents([p.agent.id]);
    } else if (p.kind === "remove" && p.agentId) {
      outcome = this.active.event(
        "remove",
        p.agentId,
        undefined,
        this.versionOf(p),
      );
      if (outcome.accepted) this.afterAgents([p.agentId]);
    }
    if (outcome?.resync) void this.resync().catch(() => {});
  }

  private workspaceRead(
    payload: WorkspacesPage | undefined,
    mark: number,
    first: boolean,
  ) {
    const items = (Array.isArray(payload?.entries) ? payload.entries : [])
      .filter((w) => w?.id)
      .map((w) => ({ id: w.id, value: w, seq: w.syncSeq }));
    const r = this.workspaces.read({
      ...this.readMeta(payload, mark, first),
      items,
    });
    if (r.resync) void this.resync().catch(() => {});
    if (r.changed.length && !first && this.loaded) this.publishRows();
  }

  private workspaceEvent(m: unknown) {
    const p = updateOf(m, "workspace_update");
    if (!p) return;
    let outcome;
    if (p.kind === "upsert" && p.agent?.id && this.excluded(p.agent.id)) return;
    if (p.kind === "upsert" && p.workspace?.id)
      outcome = this.workspaces.event(
        "upsert",
        p.workspace.id,
        p.workspace,
        this.versionOf(p),
      );
    else if (p.kind === "remove" && p.id) {
      outcome = this.workspaces.event(
        "remove",
        p.id,
        undefined,
        this.versionOf(p),
      );
      // Projects have their own sequence: an accepted removal that names
      // project changes is followed by reading them, never by writing them
      // from this stream.
      if (outcome.accepted && (p.removedProjectId || p.emptyProject))
        void this.refreshProjects();
    }
    if (outcome?.resync) void this.resync().catch(() => {});
    if (outcome?.changed && this.loaded) this.publishRows();
  }

  private projectEvent(m: unknown) {
    // Older daemons broadcast the payload itself.
    const p = asUpdate(fieldOf(m, "payload") ?? m);
    let outcome;
    if (p.kind === "upsert" && p.agent?.id && this.excluded(p.agent.id)) return;
    if (p.kind === "upsert" && p.project?.projectId)
      outcome = this.projects.event(
        "upsert",
        p.project.projectId,
        p.project,
        this.versionOf(p),
      );
    else if (p.kind === "remove" && p.projectId)
      outcome = this.projects.event(
        "remove",
        p.projectId,
        undefined,
        this.versionOf(p),
      );
    if (outcome?.resync) void this.refreshProjects();
    if (outcome?.changed && this.loaded) this.publishRows();
  }

  private async refreshProjects() {
    const client = this.client;
    if (!client) return;
    const epoch = this.epoch;
    try {
      await within(
        this.readProjects(client, epoch),
        TUNING.sdkReadMs,
        this.options.label,
        client,
      );
    } catch (error) {
      // The projects held can't be vouched for.
      this.down(error, epoch);
    }
  }
  private async readProjects(client: LiveClient, epoch: number) {
    const mark = this.arrivals;
    const r = await client.listProjects(this.cursor(this.projects));
    if (epoch !== this.epoch) return;
    let out = this.projects.read({
      ...this.readMeta(r, mark, false),
      items: projectItems(r),
    });
    if (out.resync && !this.plain) {
      // A delta the daemon couldn't serve: read everything.
      const full = await client.listProjects({ sync: {} });
      if (epoch !== this.epoch) return;
      out = this.projects.read({ ...syncOf(full), items: projectItems(full) });
    }
    if (out.changed.length && this.loaded) this.publishRows();
  }

  /**
   * Every held agent's provider subagents, listed. Pushes keep them current
   * between listings; this heals anything missed. Never fatal: subagents
   * only refine rows, so a failed listing keeps what is held.
   */
  private async readSubagents(client: LiveClient, epoch: number) {
    if (this.noSubagents || typeof client.listProviderSubagents !== "function")
      return;
    const ids = new Set(
      [...this.active.values(), ...this.background.values()]
        .map((e) => e.agent.id)
        .filter((id) => !this.excluded(id)),
    );
    let changed = this.subagents.retain(ids);
    const queue = [...ids];
    const worker = async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        if (epoch !== this.epoch || this.noSubagents) return;
        const mark = this.subagents.issue();
        try {
          const r = await timeout(
            client.listProviderSubagents!(id, { timeout: TUNING.sdkReadMs }),
            TUNING.sdkReadMs,
          );
          if (epoch !== this.epoch) return;
          if (typeof r?.error === "string" && r.error) continue;
          if (this.subagents.listing(id, r?.subagents, mark)) changed = true;
        } catch (error) {
          // A daemon that doesn't answer it (older daemons) isn't asked
          // again until the feed reconnects.
          if (
            /unknown|unsupported|invalid|timed out/i.test(errorMessage(error))
          )
            this.noSubagents = true;
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (changed && epoch === this.epoch && this.loaded) this.publishRows();
  }

  /** Unarchived agents, numbered by when the read was requested. */
  private async readBackground(client: LiveClient, epoch: number) {
    const req = this.background.issue();
    const entries = await unarchivedAgents(client);
    if (epoch !== this.epoch) return;
    const changed = this.background.listing(
      req,
      agentItems(entries).map(({ id, value }) => ({ id, value })),
    );
    if (changed.length) {
      this.changedAgents(changed);
      if (this.loaded) this.publishRows();
    }
  }
}
