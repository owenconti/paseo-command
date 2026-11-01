/**
 * Test support: in-memory Paseo daemons behind the SDK's client interface.
 *
 * A FakeDaemon holds agents, workspaces, projects, a host registry and
 * timelines, answers the SDK calls the app makes, and pushes the updates a
 * real daemon would (sequenced when asked, per subscription). Every call is
 * logged, and anything it doesn't simulate is refused. Knobs make calls
 * slow, hang or fail, drop connections, and replay, duplicate or reorder
 * pushed events, so tests can exercise the ordering guards.
 *
 * Nothing here talks to a real daemon: `install()` points the app's
 * connector at a FakeNetwork, where unknown targets refuse to connect.
 */
import { createServer, type Server } from "node:http";
import { connector } from "./daemon";
import { handleApi, handleUpgrade } from "./api";
import { applyPatch, applyReset, emptyFleet, rowsOf } from "../src/live";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Agent = Record<string, any> & { id: string };
type Workspace = Record<string, any> & { id: string };
type Observer = {
  snapshot(s: any): void;
  update(m: any): void;
  error?(e: unknown): void;
};

export type Call = { method: string; args: any[]; target: string };

let ids = 0;
/** Pull requests every fake project's GitHub search finds. */
const FAKE_PRS = [
  { kind: "pr", number: 42, title: "Add the review flag", url: "https://github.com/acme/app/pull/42", state: "open", body: null, labels: [], headRefName: "review-flag" },
  { kind: "pr", number: 57, title: "Fix the harbour lights", url: "https://github.com/acme/app/pull/57", state: "open", body: null, labels: [], headRefName: "harbour-lights" },
];
const iso = (t = Date.now()) => new Date(t).toISOString();

/** A subscription handle shaped like the SDK's OwnedSubscription. */
class FakeSubscription {
  subscriptionId: string | null = null;
  ready: Promise<any>;
  observers = new Set<Observer>();
  released = false;
  snapshot: any;
  private resolve!: (v: any) => void;
  private reject!: (e: any) => void;
  constructor(
    readonly client: FakeClient,
    readonly kind: string,
    readonly query: any,
  ) {
    this.ready = new Promise((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.ready.catch(() => {});
  }
  start(snapshot: any) {
    if (this.released) return;
    this.subscriptionId = `sub_${++ids}`;
    this.snapshot = { ...snapshot, subscriptionId: this.subscriptionId };
    for (const o of this.observers) o.snapshot(this.snapshot);
    this.resolve(this.snapshot);
  }
  fail(error: unknown) {
    this.reject(error);
    for (const o of this.observers) o.error?.(error);
  }
  deliver(message: any) {
    if (this.released || !this.subscriptionId) return;
    for (const o of this.observers) o.update(message);
  }
  subscribe(o: Observer) {
    if (this.released) throw new Error("Subscription released");
    this.observers.add(o);
    if (this.snapshot) o.snapshot(this.snapshot);
    return () => this.observers.delete(o);
  }
  async release() {
    this.released = true;
    this.observers.clear();
    this.client.subs.delete(this);
    this.reject(new Error("Subscription released"));
  }
}

export class FakeDaemon {
  agents = new Map<string, Agent>();
  workspaces = new Map<string, Workspace>();
  /** The workspace label catalog: `{ name, color }`. */
  workspaceLabels: { name: string; color: string }[] = [];
  projects = new Map<string, any>();
  /** The host's folders (absolute paths), for browsing and adding projects. */
  home = "/home/review";
  folders = new Set(["/", "/home", "/home/review", "/home/review/code"]);
  /**
   * Checkouts' diffs and status, by cwd (`getCheckoutDiff`, `getCheckoutStatus`):
   * `diffs` by compare mode; a checkout not set here isn't a git repository.
   */
  checkouts = new Map<string, { diffs: Partial<Record<string, any[]>>; status: Record<string, unknown>; tooLarge?: boolean }>();
  /** Terminals: what each has printed, the input it was sent, and who watches. */
  terminals = new Map<
    string,
    {
      id: string;
      name: string;
      cwd: string;
      workspaceId?: string;
      printed: string;
      input: any[];
      watchers: Set<(event: any) => void>;
    }
  >();
  /** Print to a terminal, as its shell would: watchers see it live. */
  print(terminalId: string, text: string) {
    const t = this.terminals.get(terminalId)!;
    t.printed += text;
    for (const w of t.watchers) w({ terminalId, subscriptionId: "sub", type: "output", data: Buffer.from(text) });
  }
  /** The local daemon's host registry (remote hosts it knows). */
  registry: any[] = [];
  timelines = new Map<string, any[]>();
  /** Provider subagents (in-process, inside an agent's turn), by parent agent. */
  subagents = new Map<string, Map<string, any>>();
  /** Provider subagents' conversations, by `parent\0subagent`. */
  subagentTimelines = new Map<string, any[]>();
  /** Creations by idempotency key (`ws:` / `agent:`). */
  idempotent = new Map<string, any>();
  epoch = "epoch-1";
  /** One directory sync per daemon process; a restart starts a new generation. */
  sync = new FakeDirectorySync();
  clients = new Set<FakeClient>();
  calls: Call[] = [];
  /** Per-method delay in ms, or "hang". */
  delay: Record<string, number | "hang"> = {};
  /** Methods that fail (with this message). */
  fail: Record<string, string> = {};
  /** Delay pushed events by this long (an event arriving after the RPC answer). */
  eventDelayMs = 0;
  /** Deliver every pushed event twice. */
  duplicateEvents = false;
  /** Refuse new connections. */
  down = false;
  /** The handshake's feature flags. */
  features: Record<string, boolean> = {
    agentForkContext: true,
    agentForkContextCursor: true,
    agentProfiles: true,
  };
  /** What an agent's next finished turn says (waitForFinish's lastMessage). */
  replies = new Map<string, string>();
  providers = [
    {
      provider: "claude",
      label: "Claude",
      status: "ready",
      enabled: true,
      defaultModeId: "default",
      modes: [],
    },
    {
      provider: "codex",
      label: "Codex",
      status: "unavailable",
      enabled: true,
      modes: [],
    },
  ];
  /** The daemon config's agent profiles. */
  agentProfiles: Record<string, unknown>[] = [];
  constructor(
    readonly serverId: string,
    readonly label = serverId,
  ) {}

  // ── State helpers ────────────────────────────────────────────────────────
  addProject(p: { projectId: string; path: string; name?: string }) {
    const project = {
      projectId: p.projectId,
      projectKey: p.projectId,
      projectDisplayName: p.name ?? p.projectId,
      projectRootPath: p.path,
      projectKind: "git",
    };
    this.projects.set(p.projectId, project);
    this.pushProject("upsert", project);
    return project;
  }
  renameProject(projectId: string, name: string) {
    const project = {
      ...this.projects.get(projectId),
      projectDisplayName: name,
    };
    this.projects.set(projectId, project);
    this.pushProject("upsert", project);
    for (const ws of [...this.workspaces.values()])
      if (ws.projectId === projectId) {
        const next = { ...ws, projectDisplayName: name };
        this.workspaces.set(ws.id, next);
        this.pushWorkspace("upsert", next);
      }
    return project;
  }
  removeProject(projectId: string) {
    const project = this.projects.get(projectId);
    this.projects.delete(projectId);
    if (project) this.pushProject("remove", project);
  }
  addWorkspace(w: {
    id: string;
    projectId: string;
    cwd: string;
    name?: string;
    branch?: string;
    title?: string | null;
    /** The daemon's forge facts (its PR for the branch), as Paseo reports them. */
    githubRuntime?: unknown;
  }) {
    const project = this.projects.get(w.projectId);
    const ws = {
      id: w.id,
      projectId: w.projectId,
      projectDisplayName: project?.projectDisplayName ?? w.projectId,
      projectRootPath: project?.projectRootPath ?? w.cwd,
      workspaceDirectory: w.cwd,
      workspaceKind:
        w.cwd === project?.projectRootPath ? "local_checkout" : "worktree",
      name: w.name ?? w.id,
      title: w.title ?? null,
      background: false,
      status: "done",
      gitRuntime: { currentBranch: w.branch ?? "main" },
      ...(w.githubRuntime !== undefined
        ? { githubRuntime: w.githubRuntime }
        : {}),
    };
    this.workspaces.set(w.id, ws);
    this.pushWorkspace("upsert", ws);
    return ws;
  }
  /** Rename a workspace, as the Paseo app's rename does: pushed. */
  setWorkspaceTitle(id: string, title: string | null) {
    const ws = { ...this.workspaces.get(id)!, title };
    this.workspaces.set(id, ws);
    this.pushWorkspace("upsert", ws);
  }
  addAgent(a: Partial<Agent> & { id: string }) {
    const now = Date.now();
    const agent: Agent = {
      provider: "claude",
      model: "opus",
      status: "idle",
      title: a.id,
      cwd: "/repo",
      workspaceId: null,
      createdAt: iso(now - 60000),
      updatedAt: iso(now),
      archivedAt: null,
      currentModeId: "default",
      availableModes: [
        { id: "default", label: "Default" },
        { id: "plan", label: "Plan" },
      ],
      pendingPermissions: [],
      labels: {},
      runtimeInfo: { model: null },
      ...a,
    };
    this.agents.set(agent.id, agent);
    this.pushAgent(agent);
    return agent;
  }
  /** Change an agent the way the daemon does: new update time, pushed. */
  touch(id: string, patch: Partial<Agent>, push = true) {
    const prev = this.agents.get(id);
    if (!prev) throw new Error(`no agent ${id}`);
    const at = Math.max(Date.now(), Date.parse(prev.updatedAt) + 1);
    const next = { ...prev, ...patch, updatedAt: iso(at) };
    this.agents.set(id, next);
    if (push) this.pushAgent(next);
    return next;
  }
  /**
   * A turn ends as the daemon ends one: idle (or failed), flagged for the
   * user's attention with the reason, and pushed. The flag stays until a
   * client clears it (`clearAgentAttention`), whatever later turns do.
   */
  finishTurn(id: string, reason: "finished" | "error" = "finished") {
    return this.touch(id, {
      status: reason === "error" ? "error" : "idle",
      requiresAttention: true,
      attentionReason: reason,
      attentionTimestamp: iso(),
    });
  }
  /** Agents the active scope covers: unarchived, in an active workspace. */
  inActiveScope(a: Agent) {
    return (
      !a.archivedAt &&
      Boolean(a.workspaceId) &&
      this.workspaces.has(a.workspaceId)
    );
  }
  placement(a: Agent) {
    const ws = a.workspaceId ? this.workspaces.get(a.workspaceId) : undefined;
    if (!ws) return null;
    return {
      projectKey: ws.projectId,
      projectName: ws.projectDisplayName,
      checkout: {
        cwd: a.cwd,
        currentBranch: ws.gitRuntime?.currentBranch ?? null,
        mainRepoRoot: ws.projectRootPath,
      },
    };
  }
  // ── Pushing ──────────────────────────────────────────────────────────────
  private each(kind: string, fn: (s: FakeSubscription, c: FakeClient) => void) {
    for (const c of this.clients)
      if (c.connected) for (const s of c.subs) if (s.kind === kind) fn(s, c);
  }
  /** Deliver (possibly late, possibly twice) to a subscription. */
  send(s: FakeSubscription, message: any) {
    const go = () => {
      s.deliver(message);
      if (this.duplicateEvents) s.deliver(message);
    };
    if (this.eventDelayMs) setTimeout(go, this.eventDelayMs);
    else go();
  }
  /** As the daemon's session does: each subscription's update is sequenced by its connection. */
  pushAgent(agent: Agent) {
    this.each("agents", (s, c) => {
      const q = s.query ?? {};
      const sync = q.sync !== undefined;
      const inScope =
        q.scope === "active"
          ? this.inActiveScope(agent)
          : !agent.archivedAt || q.filter?.includeArchived;
      const entry = inScope
        ? { agent: { ...agent }, project: this.placement(agent) }
        : null;
      const payload = entry
        ? { kind: "upsert", agent: entry.agent, project: entry.project }
        : { kind: "remove", agentId: agent.id };
      const background = Boolean(
        q.includeBackground || q.filter?.includeBackground,
      );
      this.send(s, {
        type: "agent_update",
        payload: c.sync.sequence(
          "agents",
          payload,
          entry,
          agent.id,
          sync,
          background,
        ),
      });
    });
  }
  pushWorkspace(kind: "upsert" | "remove", ws: Workspace) {
    this.each("workspaces", (s, c) => {
      const sync = s.query?.sync !== undefined;
      const payload =
        kind === "upsert"
          ? { kind, workspace: { ...ws } }
          : { kind, id: ws.id };
      this.send(s, {
        type: "workspace_update",
        payload: c.sync.sequence(
          "workspaces",
          payload,
          kind === "upsert" ? { ...ws } : null,
          ws.id,
          sync,
          false,
        ),
      });
    });
  }
  /** A project change, to connections that asked for project events. */
  pushProject(kind: "upsert" | "remove", project: any) {
    for (const c of this.clients) {
      if (!c.connected) continue;
      if (
        ![...c.subs].some(
          (s) =>
            s.kind === "events" && s.query?.events?.includes("project.update"),
        )
      )
        continue;
      const payload =
        kind === "upsert"
          ? { kind, project: { ...project } }
          : { kind, projectId: project.projectId };
      const message = {
        type: "project.update",
        payload: c.sync.sequence(
          "projects",
          payload,
          kind === "upsert" ? { ...project } : null,
          project.projectId,
          true,
          false,
        ),
      };
      const go = () => {
        c.emit("project.update", message);
        if (this.duplicateEvents) c.emit("project.update", message);
      };
      if (this.eventDelayMs) setTimeout(go, this.eventDelayMs);
      else go();
    }
  }
  /**
   * Start or change a provider subagent (`status`: running, completed, failed,
   * canceled), as the daemon does: listed per parent and pushed as
   * `agent.provider_subagents.update` to sessions that asked for it.
   */
  setSubagent(
    parentAgentId: string,
    s: {
      id: string;
      status?: string;
      title?: string;
      description?: string;
      subtitle?: string | null;
      parentSubagentId?: string | null;
    },
    push = true,
  ) {
    let held = this.subagents.get(parentAgentId);
    if (!held) this.subagents.set(parentAgentId, (held = new Map()));
    const prev = held.get(s.id);
    const now = Date.now();
    const subagent = {
      parentSubagentId: null,
      provider: "claude",
      title: "general-purpose",
      description: s.id,
      status: "running",
      createdAt: prev?.createdAt ?? iso(now),
      toolCallId: s.id,
      cwd: null,
      subtitle: null,
      ...prev,
      ...s,
      parentAgentId,
      updatedAt: iso(
        Math.max(now, prev ? Date.parse(prev.updatedAt) + 1 : now),
      ),
    };
    held.set(s.id, subagent);
    if (push) this.pushSubagent({ kind: "upsert", subagent: { ...subagent } });
    return subagent;
  }
  /** Append a row to a provider subagent's conversation (projected rows, as
   *  the daemon's provider-subagent store keeps them), pushed as a
   *  `timeline` update. */
  pushSubagentTimeline(parentAgentId: string, id: string, item: any) {
    const key = `${parentAgentId}\0${id}`;
    const rows = this.subagentTimelines.get(key) ?? [];
    const seq = rows.length + 1;
    const row = {
      item,
      timestamp: iso(),
      seq,
      seqStart: seq,
      seqEnd: seq,
      sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    };
    rows.push(row);
    this.subagentTimelines.set(key, rows);
    this.pushSubagent({
      kind: "timeline",
      parentAgentId,
      subagentId: id,
      provider: "claude",
      item,
      timestamp: row.timestamp,
      seq,
      epoch: `sub-${parentAgentId}-${id}`,
    });
    return seq;
  }
  removeSubagent(parentAgentId: string, id: string) {
    this.subagents.get(parentAgentId)?.delete(id);
    this.subagentTimelines.delete(`${parentAgentId}\0${id}`);
    this.pushSubagent({ kind: "remove", parentAgentId, subagentId: id });
  }
  pushSubagent(payload: any) {
    for (const c of this.clients) {
      if (!c.connected) continue;
      if (
        ![...c.subs].some(
          (s) =>
            s.kind === "events" &&
            s.query?.events?.includes("agent.provider_subagents.update"),
        )
      )
        continue;
      const message = { type: "agent.provider_subagents.update", payload };
      const go = () => {
        c.emit("agent.provider_subagents.update", message);
        if (this.duplicateEvents)
          c.emit("agent.provider_subagents.update", message);
      };
      if (this.eventDelayMs) setTimeout(go, this.eventDelayMs);
      else go();
    }
  }
  pushRegistry() {
    this.each("hosts", (s) =>
      this.send(s, {
        type: "hosts.changed",
        payload: {
          subscriptionId: s.subscriptionId,
          directory: this.directory(),
        },
      }),
    );
  }
  /** Per agent, the next timeline sequence (rows keep seqStart; updates move seqEnd). */
  nextSeq = new Map<string, number>();
  private seqFor(agentId: string) {
    const seq = this.nextSeq.get(agentId) ?? 1;
    this.nextSeq.set(agentId, seq + 1);
    return seq;
  }
  private streamed(agentId: string, item: any, seq: number) {
    for (const c of this.clients)
      if (c.connected)
        for (const t of c.timelines)
          if (t.agentId === agentId && !t.released)
            t.handler({
              type: "agent_stream",
              payload: {
                agentId,
                event: { type: "timeline", item },
                seq,
                epoch: this.epoch,
                timestamp: iso(),
              },
            });
  }
  /** Append a row (as the daemon's timeline store does). Returns its seqStart. */
  pushTimeline(agentId: string, item: any) {
    const entries = this.timelines.get(agentId) ?? [];
    const seq = this.seqFor(agentId);
    entries.push({
      item,
      timestamp: iso(),
      seqStart: seq,
      seqEnd: seq,
      sourceSeqRanges: [{ startSeq: seq, endSeq: seq }],
    });
    this.timelines.set(agentId, entries);
    this.streamed(agentId, item, seq);
    return seq;
  }
  /**
   * Update a row in place (a tool's lifecycle): it keeps its position
   * (seqStart) and its latest change moves (seqEnd), as the daemon's
   * canonical projection does.
   */
  updateTimeline(agentId: string, seqStart: number, patch: any) {
    const entries = this.timelines.get(agentId) ?? [];
    const row = entries.find((e) => e.seqStart === seqStart);
    if (!row) throw new Error(`no row ${seqStart}`);
    const seq = this.seqFor(agentId);
    row.item = { ...row.item, ...patch };
    row.seqEnd = seq;
    (row.sourceSeqRanges ??= []).push({ startSeq: seq, endSeq: seq });
    this.streamed(agentId, row.item, seq);
  }
  /** A rewind: a new epoch with these rows. */
  newEpoch(agentId: string, epoch: string, items: any[] = []) {
    this.epoch = epoch;
    this.timelines.set(agentId, []);
    for (const item of items) this.pushTimeline(agentId, item);
  }
  directory() {
    return {
      self: { serverId: this.serverId, label: this.label },
      hosts: this.registry.map((h) => ({ ...h })),
    };
  }

  // ── Listings (as the daemon's session answers them) ─────────────────────
  activeEntries() {
    return [...this.agents.values()]
      .filter((a) => this.inActiveScope(a))
      .sort(
        (a, b) =>
          Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
          a.id.localeCompare(b.id),
      )
      .map((a) => ({ agent: { ...a }, project: this.placement(a) }));
  }
  listAgents(q: any = {}, sync?: FakeDirectorySync) {
    if (q.sync !== undefined) {
      // As the daemon: sequenced reads need the active scope and no filter.
      if (q.scope !== "active" || q.filter)
        throw Object.assign(
          new Error(
            "Sequenced agent directory reads require scope=active and no filter.",
          ),
          {
            code: "invalid_request",
          },
        );
      return sync!.read(
        "agents",
        this.activeEntries(),
        q.sync,
        Boolean(q.includeBackground),
      );
    }
    let rows = [...this.agents.values()];
    if (q.scope === "active") rows = rows.filter((a) => this.inActiveScope(a));
    else if (!q.filter?.includeArchived)
      rows = rows.filter((a) => !a.archivedAt);
    const labels = Object.entries(q.filter?.labels ?? {});
    if (labels.length)
      rows = rows.filter((a) => labels.every(([k, v]) => a.labels?.[k] === v));
    rows.sort(
      (a, b) =>
        Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
        a.id.localeCompare(b.id),
    );
    const limit = q.page?.limit ?? 200;
    const start = q.page?.cursor ? Number(q.page.cursor) : 0;
    const page = rows.slice(start, start + limit);
    const more = start + limit < rows.length;
    return {
      entries: page.map((a) => ({
        agent: { ...a },
        project: this.placement(a),
      })),
      pageInfo: {
        nextCursor: more ? String(start + limit) : null,
        prevCursor: null,
        hasMore: more,
      },
    };
  }
  listWorkspaces(q: any = {}, sync?: FakeDirectorySync) {
    const rows = [...this.workspaces.values()]
      .filter((w) => q.includeBackground || !w.background)
      .map((w) => ({ ...w }));
    if (q.sync !== undefined) {
      if (q.filter)
        throw Object.assign(
          new Error(
            "Sequenced workspace directory reads do not support filters.",
          ),
          {
            code: "invalid_request",
          },
        );
      const r = sync!.read("workspaces", rows, q.sync, false);
      return { ...r, emptyProjects: [] };
    }
    return {
      entries: rows,
      emptyProjects: [],
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
    };
  }
  listProjectsFor(q: any = {}, sync?: FakeDirectorySync) {
    const rows = [...this.projects.values()].map((p) => ({ ...p }));
    if (q?.sync !== undefined) {
      const r = sync!.read("projects", rows, q.sync, false);
      return { projects: r.entries, sync: r.sync };
    }
    return { projects: rows };
  }

  client(target: string) {
    const c = new FakeClient(this, target);
    this.clients.add(c);
    return c;
  }
  /** Restart: every connection drops and the directory starts a new generation. */
  restart() {
    this.dropAll("daemon restarted");
    this.sync = new FakeDirectorySync();
  }
  /** Drop every connection, as a daemon restart or network loss would. */
  dropAll(reason = "connection lost") {
    for (const c of [...this.clients]) c.drop(reason);
  }
  openClients() {
    return [...this.clients].filter((c) => c.connected).length;
  }
  subscriptions() {
    let n = 0;
    for (const c of this.clients)
      if (c.connected)
        n += c.subs.size + [...c.timelines].filter((t) => !t.released).length;
    return n;
  }
  callsOf(method: string) {
    return this.calls.filter((c) => c.method === method);
  }
}

class FakeTimeline {
  released = false;
  ready: Promise<void>;
  subscriptionId = `tl_${++ids}`;
  constructor(
    readonly client: FakeClient,
    readonly agentId: string,
    readonly handler: (m: any) => void,
  ) {
    this.ready = client.gate("subscribeAgentTimeline").then(() => undefined);
    this.ready.catch(() => {});
  }
  async release() {
    this.released = true;
    this.client.timelines.delete(this);
  }
}

/**
 * The daemon's directory sync (server/directory-sync in @getpaseo/server),
 * ported: one per daemon process, shared by every session, with one
 * generation and, per collection, a sequence of latest-state changes with
 * tombstones (the oldest trimmed past 5000, which expires cursors before
 * them). Reads replace the collection with the current listing and answer a
 * snapshot or, given a cursor still covered in the same generation, the
 * changes after it.
 */
class VersionedCollection {
  values = new Map<string, { seq: number; fp: string; value: any }>();
  tombstones = new Map<string, number>();
  next = 0;
  expiredThroughSeq = 0;
  constructor(
    readonly idOf: (v: any) => string,
    readonly maxTombstones = 5000,
  ) {}
  replace(value: any) {
    const id = this.idOf(value);
    const fp = JSON.stringify(value);
    if (this.values.get(id)?.fp === fp) return;
    this.values.set(id, { seq: ++this.next, fp, value });
    this.tombstones.delete(id);
  }
  remove(id: string) {
    if (!this.values.delete(id)) return;
    this.tombstones.delete(id);
    this.tombstones.set(id, ++this.next);
    while (this.tombstones.size > this.maxTombstones) {
      const [oldest, seq] = this.tombstones.entries().next().value!;
      this.tombstones.delete(oldest);
      this.expiredThroughSeq = Math.max(this.expiredThroughSeq, seq);
    }
  }
  replaceAll(values: any[]) {
    const keep = new Set<string>();
    for (const v of values) {
      keep.add(this.idOf(v));
      this.replace(v);
    }
    for (const id of [...this.values.keys()])
      if (!keep.has(id)) this.remove(id);
  }
  seqOf(id: string) {
    return this.values.get(id)?.seq ?? this.tombstones.get(id) ?? null;
  }
  sorted() {
    return [...this.values.values()].sort((a, b) => a.seq - b.seq);
  }
}
export class FakeDirectorySync {
  generation = `gen-${Math.random().toString(36).slice(2, 10)}`;
  collections = {
    agents: new VersionedCollection((e) => e.agent.id),
    workspaces: new VersionedCollection((w) => w.id),
    projects: new VersionedCollection((p) => p.projectId),
  };
  generationFor(background: boolean) {
    return background ? `${this.generation}:background` : this.generation;
  }
  read(
    kind: keyof FakeDirectorySync["collections"],
    listing: any[],
    cursor: any,
    background: boolean,
  ) {
    const c = this.collections[kind];
    c.replaceAll(listing);
    const generation = this.generationFor(background);
    const sameGeneration = cursor?.generation === generation;
    const expired =
      sameGeneration &&
      cursor?.afterSeq !== undefined &&
      (cursor.afterSeq < c.expiredThroughSeq || cursor.afterSeq > c.next);
    const changes =
      sameGeneration && cursor?.afterSeq !== undefined && !expired;
    const values = changes
      ? c.sorted().filter((v) => v.seq > cursor.afterSeq)
      : c.sorted();
    const reason = changes
      ? undefined
      : expired
        ? "cursor_expired"
        : cursor?.generation === undefined || cursor?.afterSeq === undefined
          ? "no_cursor"
          : "generation_changed";
    return {
      entries: values.map((v) => ({ ...v.value, syncSeq: v.seq })),
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
      sync: {
        generation,
        headSeq: c.next,
        mode: changes ? "changes" : "snapshot",
        ...(reason ? { reason } : {}),
        removals: changes
          ? [...c.tombstones]
              .filter(([, seq]) => seq > cursor.afterSeq)
              .map(([id, seq]) => ({ id, seq }))
          : [],
      },
    };
  }
  /** Sequence one change for a subscription, as the daemon does per delivery. */
  sequence(
    kind: keyof FakeDirectorySync["collections"],
    payload: any,
    value: any,
    id: string,
    include: boolean,
    background: boolean,
  ) {
    const c = this.collections[kind];
    if (value) c.replace(value);
    else c.remove(id);
    const seq = c.seqOf(id);
    return include && seq !== null
      ? { ...payload, generation: this.generationFor(background), seq }
      : payload;
  }
}

/** One connection to a FakeDaemon, with the SDK client's interface. */
export class FakeClient {
  connected = false;
  closed = false;
  subs = new Set<FakeSubscription>();
  timelines = new Set<FakeTimeline>();
  private statusListeners = new Set<(s: any) => void>();
  private eventHandlers = new Map<string, Set<(m: any) => void>>();
  private pending = new Set<(e: Error) => void>();
  /** The daemon's directory sync, shared by every session (as the real one). */
  get sync() {
    return this.daemon.sync;
  }
  constructor(
    readonly daemon: FakeDaemon,
    readonly target: string,
  ) {}
  get isConnected() {
    return this.connected;
  }
  /** The handshake's server info, once connected (as the SDK). */
  getLastServerInfoMessage() {
    return this.connected
      ? { serverId: this.daemon.serverId, features: { ...this.daemon.features } }
      : null;
  }

  /** Log a call, apply its knob, and fail when the connection drops meanwhile. */
  async gate(method: string, ...args: any[]) {
    const d = this.daemon;
    d.calls.push({ method, args, target: this.target });
    if (!this.connected && method !== "connect")
      throw new Error("Not connected");
    const delay = d.delay[method];
    if (delay !== undefined)
      await new Promise<void>((resolve, reject) => {
        if (delay === "hang") {
          this.pending.add(reject);
          return;
        }
        const t = setTimeout(() => {
          this.pending.delete(reject);
          resolve();
        }, delay);
        this.pending.add((e) => {
          clearTimeout(t);
          reject(e);
        });
      });
    if (!this.connected && method !== "connect")
      throw new Error("The daemon connection was lost");
    if (d.fail[method])
      throw Object.assign(new Error(d.fail[method]), { code: "failed" });
  }

  async connect() {
    if (this.daemon.down)
      throw new Error(`connect ECONNREFUSED ${this.target}`);
    await this.gate("connect");
    if (this.daemon.down)
      throw new Error(`connect ECONNREFUSED ${this.target}`);
    this.connected = true;
    this.status({ status: "connected" });
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    const was = this.connected;
    this.connected = false;
    this.subs.clear();
    this.timelines.clear();
    for (const r of this.pending) r(new Error("Client closed"));
    this.pending.clear();
    if (was) this.status({ status: "disposed" });
    this.daemon.clients.delete(this);
  }
  /** Simulate the socket dropping. */
  drop(reason = "connection lost") {
    if (!this.connected) return;
    this.connected = false;
    for (const r of this.pending) r(new Error(reason));
    this.pending.clear();
    for (const s of this.subs) s.fail(new Error(reason));
    this.subs.clear();
    this.timelines.clear();
    this.status({ status: "disconnected", reason });
  }
  private status(s: any) {
    for (const l of [...this.statusListeners]) l(s);
  }
  subscribeConnectionStatus(fn: (s: any) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }
  on(type: string, fn: (m: any) => void) {
    let set = this.eventHandlers.get(type);
    if (!set) this.eventHandlers.set(type, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }
  emit(type: string, message: any) {
    for (const fn of this.eventHandlers.get(type) ?? []) fn(message);
  }

  private observe(
    kind: string,
    query: any,
    snapshot: () => any,
    method: string,
  ) {
    const s = new FakeSubscription(this, kind, query);
    this.subs.add(s);
    void this.gate(method, query).then(
      () => {
        if (!this.connected) return s.fail(new Error("Not connected"));
        let value;
        try {
          value = snapshot();
        } catch (e) {
          // As the SDK: a refused subscription request fails the handle.
          this.subs.delete(s);
          return s.fail(e);
        }
        s.start(value);
      },
      (e) => {
        this.subs.delete(s);
        s.fail(e);
      },
    );
    return s;
  }
  observeAgents(q: any = {}) {
    return this.observe(
      "agents",
      q,
      () => this.daemon.listAgents(q, this.sync),
      "observeAgents",
    );
  }
  observeWorkspaces(q: any = {}) {
    return this.observe(
      "workspaces",
      q,
      () => this.daemon.listWorkspaces(q, this.sync),
      "observeWorkspaces",
    );
  }
  observeHosts() {
    return this.observe(
      "hosts",
      {},
      () => this.daemon.directory(),
      "observeHosts",
    );
  }
  observeEvents(events: string[]) {
    return this.observe(
      "events",
      { events },
      () => ({ events }),
      "observeEvents",
    );
  }
  subscribeAgentTimeline(agentId: string, handler: (m: any) => void) {
    const t = new FakeTimeline(this, agentId, handler);
    this.timelines.add(t);
    return t;
  }

  // ── Reads ────────────────────────────────────────────────────────────────
  async listProviderSubagents(parentAgentId: string) {
    await this.gate("listProviderSubagents", parentAgentId);
    return {
      requestId: `req_${++ids}`,
      parentAgentId,
      subagents: [
        ...(this.daemon.subagents.get(parentAgentId)?.values() ?? []),
      ].map((s) => ({ ...s })),
      error: null,
    };
  }
  /** As the daemon answers `agent.provider_subagents.timeline.get.request`
   *  (projected rows; the SDK throws the daemon's error). */
  async fetchProviderSubagentTimeline(
    parentAgentId: string,
    subagentId: string,
    options: any = {},
  ) {
    await this.gate(
      "fetchProviderSubagentTimeline",
      parentAgentId,
      subagentId,
      options,
    );
    const descriptor = this.daemon.subagents
      .get(parentAgentId)
      ?.get(subagentId);
    if (!descriptor) throw new Error("Provider subagent not found");
    const key = `${parentAgentId}\0${subagentId}`;
    const epoch = `sub-${parentAgentId}-${subagentId}`;
    const all = this.daemon.subagentTimelines.get(key) ?? [];
    const direction = options.direction ?? "tail";
    const limit = options.limit ?? 200;
    const max = all.length;
    const before =
      direction === "before" && options.cursor?.epoch === epoch
        ? options.cursor.seq
        : max + 1;
    const eligible = all.filter((r) => r.seqStart < before);
    const rows = eligible.slice(-limit);
    const first = rows[0]?.seqStart ?? null;
    const last = rows[rows.length - 1]?.seqEnd ?? null;
    return {
      requestId: `req_${++ids}`,
      parentAgentId,
      subagentId,
      provider: descriptor.provider,
      direction,
      epoch,
      projection: "projected",
      startCursor: first === null ? null : { epoch, seq: first },
      endCursor: last === null ? null : { epoch, seq: last },
      reset: false,
      staleCursor: false,
      gap: false,
      window: { minSeq: all.length ? 1 : 0, maxSeq: max, nextSeq: max + 1 },
      hasOlder: first !== null && first > 1,
      hasNewer: false,
      rows: rows.map((r) => ({ ...r })),
      error: null,
    };
  }
  async fetchAgents(q: any = {}) {
    await this.gate("fetchAgents", q);
    return this.daemon.listAgents(q, this.sync);
  }
  async fetchWorkspaces(q: any = {}) {
    await this.gate("fetchWorkspaces", q);
    return this.daemon.listWorkspaces(q, this.sync);
  }
  async listWorkspaceLabels() {
    await this.gate("listWorkspaceLabels");
    return {
      labels: this.daemon.workspaceLabels.map((l) => ({ ...l })),
      sync: {
        mode: "snapshot",
        generation: this.daemon.epoch,
        headSeq: 0,
        removals: [],
      },
    };
  }
  /** As the daemon does: a new name joins the catalog; the workspace's change is pushed. */
  async setWorkspaceLabel(o: {
    workspaceId: string;
    label: { name: string; color: string };
    assigned: boolean;
  }) {
    await this.gate("setWorkspaceLabel", o);
    const ws = this.daemon.workspaces.get(o.workspaceId);
    if (!ws) throw new Error("Workspace not found");
    const key = o.label.name.toLowerCase();
    let label = this.daemon.workspaceLabels.find(
      (l) => l.name.toLowerCase() === key,
    );
    if (!label && o.assigned)
      this.daemon.workspaceLabels.push((label = { ...o.label }));
    const others = ((ws.labels ?? []) as string[]).filter(
      (n) => n.toLowerCase() !== key,
    );
    const labels = o.assigned ? [...others, label!.name] : others;
    const next = { ...ws, labels };
    this.daemon.workspaces.set(ws.id, next);
    this.daemon.pushWorkspace("upsert", next);
    return { label: label ?? o.label, workspaceLabels: labels };
  }
  /** As the daemon does (the Paseo app's workspace rename): the title is
   *  stored and the workspace's change pushed; the SDK throws a refusal. */
  async setWorkspaceTitle(workspaceId: string, title: string | null) {
    await this.gate("setWorkspaceTitle", workspaceId, title);
    if (!this.daemon.workspaces.has(workspaceId))
      throw new Error("Workspace not found");
    const next = title?.trim() ? title.trim() : null;
    this.daemon.setWorkspaceTitle(workspaceId, next);
    return { title: next };
  }
  /** As the daemon does (the Paseo app's agent rename): a name becomes the
   *  agent's title, labels merge, and the change is pushed. */
  async updateAgent(
    agentId: string,
    updates: { name?: string; labels?: Record<string, string> },
  ) {
    await this.gate("updateAgent", agentId, updates);
    const agent = this.daemon.agents.get(agentId);
    if (!agent || agent.archivedAt) throw new Error("Agent not found");
    this.daemon.touch(agentId, {
      ...(updates.name !== undefined ? { title: updates.name } : {}),
      ...(updates.labels
        ? { labels: { ...agent.labels, ...updates.labels } }
        : {}),
    });
  }
  async listProjects(q: any = {}) {
    await this.gate("listProjects", q);
    return this.daemon.listProjectsFor(
      typeof q === "object" ? q : {},
      this.sync,
    );
  }
  async getCheckoutDiff(cwd: string, compare: { mode: string; baseRef?: string }) {
    await this.gate("getCheckoutDiff", cwd, compare);
    const c = this.daemon.checkouts.get(cwd);
    if (!c) return { cwd, files: [], error: { code: "NOT_GIT_REPO", message: "Not a git repository" }, requestId: "r" };
    return { cwd, files: c.diffs[compare.mode] ?? [], error: null, ...(c.tooLarge ? { diffTooLarge: true } : {}), requestId: "r" };
  }
  async getCheckoutStatus(cwd: string) {
    await this.gate("getCheckoutStatus", cwd);
    const c = this.daemon.checkouts.get(cwd);
    if (!c) return { cwd, isGit: false, error: null, requestId: "r" };
    return { cwd, isGit: true, error: null, requestId: "r", ...c.status };
  }
  async listTerminals(cwd?: string, _requestId?: string, options: { workspaceId?: string } = {}) {
    await this.gate("listTerminals", cwd, options);
    return {
      cwd,
      requestId: "r",
      terminals: [...this.daemon.terminals.values()]
        .filter((t) => (!cwd || t.cwd === cwd) && (!options.workspaceId || t.workspaceId === options.workspaceId))
        .map(({ id, name, cwd }) => ({ id, name, cwd })),
    };
  }
  async createTerminal(cwd: string, name?: string, _requestId?: string, options: any = {}) {
    await this.gate("createTerminal", cwd, options);
    const id = `term-${++ids}`;
    const t = { id, name: name ?? `Terminal ${this.daemon.terminals.size + 1}`, cwd, workspaceId: options.workspaceId, printed: "$ ", input: [], watchers: new Set<(e: any) => void>() };
    this.daemon.terminals.set(id, t);
    return { terminal: { id, name: t.name, cwd, workspaceId: t.workspaceId }, error: null, requestId: "r" };
  }
  async killTerminal(terminalId: string) {
    await this.gate("killTerminal", terminalId);
    const t = this.daemon.terminals.get(terminalId);
    this.daemon.terminals.delete(terminalId);
    for (const w of t?.watchers ?? []) w({ terminalId, subscriptionId: "sub", type: "exit" });
    return { terminalId, success: !!t, requestId: "r" };
  }
  /** Input is recorded and typed text echoed, as a shell's line discipline would. */
  sendTerminalInput(terminalId: string, message: any) {
    this.daemon.calls.push({ method: "sendTerminalInput", args: [terminalId, message], target: this.target });
    const t = this.daemon.terminals.get(terminalId);
    if (!t) return;
    t.input.push(message);
    if (message.type === "input") this.daemon.print(terminalId, message.data);
  }
  /** The terminal's screen so far (as a restore), then its output live. */
  observeTerminal(terminalId: string, receive: (event: any) => void, options: any = {}) {
    this.daemon.calls.push({ method: "observeTerminal", args: [terminalId, options], target: this.target });
    const t = this.daemon.terminals.get(terminalId);
    const observers = new Set<any>();
    const watcher = (event: any) => {
      if (event.type === "exit") for (const o of observers) o.update({ type: "terminal_stream_exit", payload: { terminalId } });
      else receive(event);
    };
    const payload = { subscriptionId: "sub", slot: 0, error: t ? null : "Terminal not found" };
    queueMicrotask(() => {
      for (const o of observers) o.snapshot(payload);
      if (!t) return;
      receive({ terminalId, subscriptionId: "sub", type: "restore", data: Buffer.from(t.printed) });
      t.watchers.add(watcher);
    });
    return {
      subscriptionId: "sub",
      ready: Promise.resolve(payload),
      subscribe(o: any) {
        observers.add(o);
        return () => observers.delete(o);
      },
      release: async () => {
        t?.watchers.delete(watcher);
      },
    };
  }
  async listHosts() {
    await this.gate("listHosts");
    return this.daemon.directory();
  }
  async getDaemonStatus() {
    await this.gate("getDaemonStatus");
    return {
      serverId: this.daemon.serverId,
      version: "0.13.0-fake",
      listen: "127.0.0.1:1",
    };
  }
  async fetchAgent(agentId: string) {
    await this.gate("fetchAgent", agentId);
    const a = this.daemon.agents.get(agentId);
    return a ? { agent: { ...a }, project: this.daemon.placement(a) } : null;
  }
  /**
   * As the daemon's timeline store (agent-timeline-store, timeline-
   * projection) and the SDK: an error (an unknown agent included) is thrown;
   * a tail includes earlier rows updated within it; a `before` page holds the
   * rows positioned before the cursor; an `after` page holds the entries
   * changed (or created) after the cursor, in the order of their first such
   * change, and ends where its changes stop being contiguous; a cursor from
   * another epoch resolves to this epoch's tail with `reset` and
   * `staleCursor`.
   */
  async fetchAgentTimeline(agentId: string, options: any = {}) {
    await this.gate("fetchAgentTimeline", agentId, options);
    const a = this.daemon.agents.get(agentId);
    if (!a) throw new Error(`Agent not found: ${agentId}`);
    const epoch = this.daemon.epoch;
    const rows = [...(this.daemon.timelines.get(agentId) ?? [])].sort(
      (x, y) => x.seqStart - y.seqStart,
    );
    const next = this.daemon.nextSeq.get(agentId) ?? 1;
    const window = {
      minSeq: rows[0]?.seqStart ?? 0,
      maxSeq: next - 1,
      nextSeq: next,
    };
    const cursor = options?.cursor;
    const staleCursor = cursor !== undefined && cursor.epoch !== epoch;
    // A change cursor from before what is retained: the daemon answers its
    // tail, as a reset.
    const gap =
      !staleCursor &&
      options?.direction === "after" &&
      cursor !== undefined &&
      rows.length > 0 &&
      cursor.seq < window.minSeq - 1;
    const direction =
      staleCursor || gap ? "tail" : (options?.direction ?? "tail");
    const limit = options?.limit || rows.length || 1;
    let entries: any[] = [];
    let startSeq: number | null = null;
    let endSeq: number | null = window.maxSeq;
    let hasOlder = false;
    const sources = (r: any): { startSeq: number; endSeq: number }[] =>
      r.sourceSeqRanges ?? [{ startSeq: r.seqStart, endSeq: r.seqEnd }];
    if (direction === "after") {
      const from = (cursor?.seq ?? window.minSeq - 1) + 1;
      const firstIn = (r: any) => {
        const hits = sources(r)
          .filter((x) => x.endSeq >= from)
          .map((x) => Math.max(x.startSeq, from));
        return hits.length ? Math.min(...hits) : null;
      };
      const eligible = rows
        .map((r, index) => ({ r, index, first: firstIn(r) }))
        .filter((x) => x.first !== null)
        .sort((x, y) => x.first! - y.first! || x.index - y.index);
      const selected = eligible.slice(0, limit);
      entries = selected.sort((x, y) => x.index - y.index).map((x) => x.r);
      startSeq = entries.length ? Math.max(window.minSeq, from) : null;
      endSeq = !entries.length
        ? null
        : selected.length < eligible.length
          ? eligible[selected.length].first! - 1
          : window.maxSeq;
      hasOlder = Math.max(window.minSeq, from) > window.minSeq;
    } else if (direction === "before") {
      endSeq = Math.min(window.maxSeq, (cursor?.seq ?? window.maxSeq + 1) - 1);
      // Nothing that far back: no cursors at all.
      if (endSeq < window.minSeq) endSeq = null;
      const eligible =
        endSeq === null ? [] : rows.filter((r) => r.seqStart <= endSeq!);
      entries = eligible.slice(Math.max(0, eligible.length - limit));
      startSeq = entries[0]?.seqStart ?? null;
      hasOlder = entries.length < eligible.length;
    } else if (rows.length) {
      let start = Math.max(0, rows.length - limit);
      for (let i = start - 1; i >= 0; i--)
        if (rows[i].seqEnd >= rows[start].seqStart) start = i;
      entries = rows.slice(start);
      startSeq = entries[0]?.seqStart ?? null;
      hasOlder = start > 0;
    }
    return {
      agent: { ...a },
      epoch,
      direction: options?.direction ?? "tail",
      reset: staleCursor || gap,
      staleCursor,
      gap,
      window,
      startCursor: startSeq === null ? null : { epoch, seq: startSeq },
      endCursor: endSeq === null ? null : { epoch, seq: endSeq },
      entries: entries.map((e) => ({
        ...e,
        item: { ...e.item },
        sourceSeqRanges: sources(e).map((x: any) => ({ ...x })),
      })),
      hasOlder,
      hasNewer:
        direction === "before" && endSeq === null
          ? Math.min(window.maxSeq, (cursor?.seq ?? window.maxSeq + 1) - 1) <
            window.maxSeq
          : endSeq !== null && endSeq < window.maxSeq,
      error: null,
    };
  }
  async getProvidersSnapshot() {
    await this.gate("getProvidersSnapshot");
    return { entries: this.daemon.providers };
  }
  async getDaemonConfig() {
    await this.gate("getDaemonConfig");
    return { requestId: "config", config: { agentProfiles: this.daemon.agentProfiles } };
  }
  async patchDaemonConfig(patch: any) {
    await this.gate("patchDaemonConfig", patch);
    if (patch?.agentProfiles) this.daemon.agentProfiles = patch.agentProfiles;
    return { requestId: "config", config: { agentProfiles: this.daemon.agentProfiles } };
  }
  async listProviderModels(provider: string) {
    await this.gate("listProviderModels", provider);
    return {
      models: [
        { id: "opus", label: "Opus", thinkingOptions: [{ id: "high" }] },
      ],
    };
  }
  async listUsageReports() {
    await this.gate("listUsageReports");
    return {
      reports: [
        { id: "u1", sourceId: "claude", sourceLabel: "Claude", icon: "x" },
      ],
    };
  }
  async listCommands(agentId: string) {
    await this.gate("listCommands", agentId);
    const a = this.daemon.agents.get(agentId);
    return { commands: [{ name: `for-${a?.model}` }] };
  }
  async listProviderFeatures(draft: any) {
    await this.gate("listProviderFeatures", draft);
    return { features: [] };
  }
  async getDirectorySuggestions(o: any) {
    await this.gate("getDirectorySuggestions", o);
    if (o?.query === "~/") {
      const home = this.daemon.home;
      const paths = [...this.daemon.folders].filter(
        (f) => f.startsWith(`${home}/`) && !f.slice(home.length + 1).includes("/"),
      );
      return {
        directories: paths,
        entries: paths.map((path) => ({ path, kind: "directory" })),
      };
    }
    return { entries: [{ path: "src/a.ts", kind: "file" }] };
  }
  /** As the daemon's file explorer: `path` (absolute here) under `cwd`. */
  async listDirectory(cwd: string, path: string) {
    await this.gate("listDirectory", cwd, path);
    const dir = path.startsWith("/") ? path : `${cwd}/${path}`;
    if (!this.daemon.folders.has(dir))
      throw new Error(`ENOENT: no such file or directory, stat '${dir}'`);
    const prefix = dir === "/" ? "/" : `${dir}/`;
    return {
      path: dir.slice(1),
      entries: [...this.daemon.folders]
        .filter(
          (f) =>
            f !== "/" && f.startsWith(prefix) && !f.slice(prefix.length).includes("/"),
        )
        .map((f) => ({
          name: f.slice(prefix.length),
          path: f.slice(1),
          kind: "directory",
          size: 0,
          modifiedAt: iso(),
        }))
        .concat([
          { name: "notes.txt", path: `${prefix.slice(1)}notes.txt`, kind: "file", size: 1, modifiedAt: iso() },
        ]),
    };
  }
  async searchGitHub(o: any) {
    await this.gate("searchGitHub", o);
    const q = String(o.query || "").replace(/^#/, "").toLowerCase();
    return {
      items: FAKE_PRS.filter(
        (pr) => !q || String(pr.number) === q || pr.title.toLowerCase().includes(q),
      ),
      error: null,
    };
  }

  // ── Mutations ────────────────────────────────────────────────────────────
  private agent(id: string) {
    const a = this.daemon.agents.get(id);
    if (!a) throw new Error(`Agent not found: ${id}`);
    return a;
  }
  /** As the daemon's clear_agent_attention: the flag drops, and is pushed. */
  async clearAgentAttention(agentId: string | string[]) {
    await this.gate("clearAgentAttention", agentId);
    for (const id of Array.isArray(agentId) ? agentId : [agentId]) {
      const a = this.daemon.agents.get(id);
      if (a?.requiresAttention)
        this.daemon.touch(id, {
          requiresAttention: false,
          attentionReason: null,
        });
    }
  }
  async sendMessage(agentId: string, text: string, options: any = {}) {
    await this.gate("sendMessage", agentId, text, options);
    this.agent(agentId);
    this.daemon.touch(agentId, {
      status: "running",
      pendingPermissions: [],
      lastUserMessageAt: iso(),
    });
    return {};
  }
  /** The conversation up to a message (or a timeline position), as text. */
  async buildAgentForkContext(agentId: string, options: any = {}) {
    await this.gate("buildAgentForkContext", agentId, options);
    this.agent(agentId);
    const rows = this.daemon.timelines.get(agentId) ?? [];
    const lines: string[] = [];
    for (const row of rows) {
      const it = row.item;
      if (it.type === "user_message" || it.type === "assistant_message")
        lines.push(`${it.type === "user_message" ? "User" : "Assistant"}: ${it.text}`);
      if (options.boundaryMessageId && it.messageId === options.boundaryMessageId) break;
      if (options.boundaryCursor && row.seqStart >= options.boundaryCursor.seq) break;
    }
    return {
      requestId: "fork-ctx",
      agentId,
      attachment: {
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        title: "Conversation",
        text: lines.join("\n"),
      },
      error: null,
    };
  }
  /** A turn's end: idle, with the reply the test set in `replies`. */
  async waitForFinish(agentId: string, _timeout?: number) {
    await this.gate("waitForFinish", agentId);
    this.agent(agentId);
    const final = this.daemon.touch(agentId, { status: "idle" });
    return {
      status: "idle",
      final,
      error: null,
      lastMessage: this.daemon.replies.get(agentId) ?? null,
    };
  }
  sendAgentMessage(agentId: string, text: string, options: any = {}) {
    return this.sendMessage(agentId, text, options);
  }
  async cancelAgent(agentId: string) {
    await this.gate("cancelAgent", agentId);
    this.agent(agentId);
    this.daemon.touch(agentId, { status: "idle", pendingPermissions: [] });
  }
  async archiveAgent(agentId: string) {
    await this.gate("archiveAgent", agentId);
    const at = iso();
    this.daemon.touch(agentId, {
      archivedAt: at,
      status: "closed",
      pendingPermissions: [],
    });
    return { archivedAt: at };
  }
  async setAgentMode(agentId: string, mode: string) {
    await this.gate("setAgentMode", agentId, mode);
    const a = this.agent(agentId);
    this.daemon.touch(agentId, {
      currentModeId: mode,
      ...(mode === "bypassPermissions"
        ? { pendingPermissions: [] }
        : { pendingPermissions: a.pendingPermissions }),
    });
    return null;
  }
  async setAgentModel(agentId: string, model: string | null) {
    await this.gate("setAgentModel", agentId, model);
    this.daemon.touch(agentId, { model });
  }
  async setAgentThinkingOption(agentId: string, t: string | null) {
    await this.gate("setAgentThinkingOption", agentId, t);
    this.daemon.touch(agentId, {
      thinkingOptionId: t,
      effectiveThinkingOptionId: t,
    });
    return null;
  }
  async setAgentFeature(agentId: string, featureId: string, value: unknown) {
    await this.gate("setAgentFeature", agentId, featureId, value);
    const a = this.agent(agentId);
    this.daemon.touch(agentId, {
      featureValues: { ...(a.featureValues ?? {}), [featureId]: value },
    });
  }
  async respondToPermissionAndWait(
    agentId: string,
    requestId: string,
    response: any,
  ) {
    await this.gate("respondToPermissionAndWait", agentId, requestId, response);
    const a = this.agent(agentId);
    this.daemon.touch(agentId, {
      status: "running",
      pendingPermissions: (a.pendingPermissions ?? []).filter(
        (p: any) => p.id !== requestId,
      ),
    });
    return { agentId, requestId };
  }
  /** Register a folder, as the daemon's project.add. */
  private register(path: string) {
    const known = [...this.daemon.projects.values()].find(
      (p) => p.projectRootPath === path,
    );
    if (known) return known;
    const name = path.split("/").pop() || path;
    return this.daemon.addProject({ projectId: `prj_${++ids}`, path, name });
  }
  async addProject(cwd: string) {
    await this.gate("addProject", cwd);
    if (!this.daemon.folders.has(cwd))
      return {
        project: null,
        error: `Directory not found: ${cwd}`,
        errorCode: "directory_not_found",
      };
    return { project: this.register(cwd), error: null, errorCode: null };
  }
  async createProjectDirectory(input: { parentPath: string; name: string }) {
    await this.gate("createProjectDirectory", input);
    const fail = (error: string, errorCode: string) => ({
      directoryPath: null,
      project: null,
      error,
      errorCode,
    });
    if (!this.daemon.folders.has(input.parentPath))
      return fail("Parent directory not found", "parent_directory_not_found");
    const path = `${input.parentPath === "/" ? "" : input.parentPath}/${input.name}`;
    if (this.daemon.folders.has(path))
      return fail("A directory with that name already exists", "directory_exists");
    this.daemon.folders.add(path);
    return {
      directoryPath: path,
      project: this.register(path),
      error: null,
      errorCode: null,
    };
  }
  async cloneGithubProject(input: { repo: string; targetDirectory: string }) {
    await this.gate("cloneGithubProject", input);
    const name = input.repo
      .replace(/\.git$/, "")
      .split("/")
      .pop();
    const path = `${input.targetDirectory}/${name}`;
    if (!this.daemon.folders.has(input.targetDirectory) || this.daemon.folders.has(path))
      return {
        repo: input.repo,
        checkoutPath: null,
        project: null,
        error: `git clone failed: destination path '${name}' already exists`,
      };
    this.daemon.folders.add(path);
    return { repo: input.repo, checkoutPath: path, project: this.register(path), error: null };
  }
  async createWorkspace(input: any) {
    await this.gate("createWorkspace", input);
    // As the daemon: a repeated idempotency key answers with what it made.
    const again =
      input.idempotencyKey &&
      this.daemon.idempotent.get(`ws:${input.idempotencyKey}`);
    if (again) return { workspace: again };
    const source = input.source;
    const project = [...this.daemon.projects.values()].find(
      (p) => p.projectRootPath === (source.path ?? source.cwd),
    );
    if (!project) return { workspace: null, error: "Not a registered project" };
    const id = `wks_${++ids}`;
    // A pull request's worktree takes its head branch.
    const branch =
      source.action === "checkout"
        ? (source.refName ?? FAKE_PRS.find(
            (pr) => pr.number === (source.checkoutSource?.number ?? source.githubPrNumber),
          )?.headRefName)
        : source.branchName;
    if (source.action === "checkout" && !branch)
      return { workspace: null, error: "Pull request not found" };
    const cwd =
      source.kind === "worktree"
        ? `${project.projectRootPath}-${branch}`
        : project.projectRootPath;
    const ws = this.daemon.addWorkspace({
      id,
      projectId: project.projectId,
      cwd,
      branch: branch ?? "main",
    });
    if (input.idempotencyKey)
      this.daemon.idempotent.set(`ws:${input.idempotencyKey}`, ws);
    return { workspace: ws };
  }
  async createAgent(options: any) {
    await this.gate("createAgent", options);
    const again =
      options.idempotencyKey &&
      this.daemon.idempotent.get(`agent:${options.idempotencyKey}`);
    if (again) return this.daemon.agents.get(again.id) ?? again;
    const id = `new-${++ids}`;
    const agent = this.daemon.addAgent({
      id,
      provider: options.provider,
      model: options.model ?? null,
      title: options.title ?? null,
      cwd: options.cwd,
      workspaceId: options.workspaceId,
      status: "running",
      currentModeId: options.modeId ?? "default",
      thinkingOptionId: options.thinkingOptionId ?? null,
      labels: options.labels ?? {},
      initialPrompt: options.initialPrompt,
      attachments: options.attachments,
      callerAgentId: options.callerAgentId,
      createdAt: iso(),
    });
    if (options.idempotencyKey)
      this.daemon.idempotent.set(`agent:${options.idempotencyKey}`, agent);
    return agent;
  }
  /** As the daemon does: a custom name for the project, pushed. */
  async renameProject(projectId: string, customName: string | null) {
    await this.gate("renameProject", projectId, customName);
    if (!this.daemon.projects.has(projectId)) throw new Error("Project not found");
    const path = this.daemon.projects.get(projectId).projectRootPath as string;
    this.daemon.renameProject(projectId, customName || path.split("/").pop() || path);
    return { customName };
  }
  /** As the daemon does: its active workspaces archived, then unregistered. */
  async removeProject(projectId: string) {
    await this.gate("removeProject", projectId);
    if (!this.daemon.projects.has(projectId)) throw new Error("Project not found");
    const removedWorkspaceIds: string[] = [];
    for (const ws of [...this.daemon.workspaces.values()])
      if (ws.projectId === projectId) {
        await this.archiveWorkspace(ws.id);
        removedWorkspaceIds.push(ws.id);
      }
    this.daemon.removeProject(projectId);
    return { removedWorkspaceIds };
  }
  async archiveWorkspace(workspaceId: string) {
    await this.gate("archiveWorkspace", workspaceId);
    const ws = this.daemon.workspaces.get(workspaceId);
    if (!ws) return { error: "Workspace not found" };
    this.daemon.workspaces.delete(workspaceId);
    this.daemon.pushWorkspace("remove", ws);
    const at = iso();
    for (const a of this.daemon.agents.values())
      if (a.workspaceId === workspaceId && !a.archivedAt)
        this.daemon.touch(a.id, {
          archivedAt: at,
          status: "closed",
          pendingPermissions: [],
        });
    return { archivedAt: at };
  }
  async uploadFile(input: any) {
    await this.gate("uploadFile", input.fileName);
    return {
      file: {
        type: "uploaded_file",
        id: "f1",
        fileName: input.fileName,
        mimeType: input.mimeType,
        size: input.bytes.length,
        path: "/tmp/f1",
      },
    };
  }
}

/** Targets → daemons. Unknown targets refuse to connect. */
export class FakeNetwork {
  daemons = new Map<string, FakeDaemon>();
  created: FakeClient[] = [];
  refused: string[] = [];
  add(target: string, daemon: FakeDaemon) {
    this.daemons.set(target, daemon);
    return daemon;
  }
  connect(target: string): any {
    const daemon = this.daemons.get(target);
    if (!daemon) {
      this.refused.push(target);
      return {
        isConnected: false,
        connect: async () => {
          throw new Error(`BLOCKED unknown target ${target}`);
        },
        close: async () => {},
      };
    }
    const c = daemon.client(target);
    this.created.push(c);
    return c;
  }
  /** Connections still open across every daemon. */
  open() {
    return this.created.filter((c) => c.connected).length;
  }
}

/** Point the app at a fake network (and back again). */
export function install(network: FakeNetwork) {
  const original = connector.create;
  const env = process.env.PASEO_COMMAND_DAEMON;
  process.env.PASEO_COMMAND_DAEMON = "127.0.0.1:6767";
  connector.create = ((target: string) => network.connect(target)) as any;
  return () => {
    connector.create = original;
    if (env === undefined) delete process.env.PASEO_COMMAND_DAEMON;
    else process.env.PASEO_COMMAND_DAEMON = env;
  };
}

/** A local daemon on the default loopback target, with a remote registered. */
export function fleet() {
  const network = new FakeNetwork();
  const local = network.add(
    "127.0.0.1:6767",
    new FakeDaemon("srv_local", "Review Mac"),
  );
  return { network, local };
}
export function register(
  local: FakeDaemon,
  network: FakeNetwork,
  serverId: string,
  target: string,
  status = "online",
) {
  const remote = network.add(target, new FakeDaemon(serverId, serverId));
  local.registry.push({
    registrationId: `hst_${serverId}`,
    serverId,
    label: serverId,
    enabled: true,
    status,
    targetDescription: target,
    error: null,
  });
  local.pushRegistry();
  return remote;
}

// ── HTTP helpers ───────────────────────────────────────────────────────────
/** Call the API in-process. Never reaches a real daemon (see install). */
export async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const { Readable } = await import("node:stream");
  let status = 0,
    result = "";
  const head: Record<string, string> = {};
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, {
    url: `/api/${path}`,
    method,
    headers: {
      host: "127.0.0.1:5173",
      origin: "http://127.0.0.1:5173",
      "content-type": "application/json",
      ...headers,
    },
  });
  const res = {
    setHeader(k: string, v: string) {
      head[k.toLowerCase()] = v;
    },
    set statusCode(v: number) {
      status = v;
    },
    get statusCode() {
      return status;
    },
    end(s: string) {
      result = s ?? "";
    },
  };
  const t0 = Date.now();
  await handleApi(req as any, res as any, () => {});
  let data: any;
  try {
    data = JSON.parse(result);
  } catch {
    data = result;
  }
  return { status, data, ms: Date.now() - t0, headers: head };
}
export const get = (p: string) => call("GET", p);
export const post = (p: string, b: unknown) => call("POST", p, b);

/** A real HTTP server around the API, for streams. */
export async function serve(): Promise<{
  url: string;
  server: Server;
  close: () => Promise<void>;
}> {
  const server = createServer(
    (req, res) =>
      void handleApi(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
  );
  server.on("upgrade", (req, socket, head) => {
    if (!handleUpgrade(req, socket, head)) socket.destroy();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  return {
    url: `http://127.0.0.1:${port}`,
    server,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

export type SseEvent = { event: string; data: any; at: number };
/** Read an SSE stream; `next(pred)` waits for a matching event. */
export async function sse(url: string) {
  const controller = new AbortController();
  const res = await fetch(url, {
    signal: controller.signal,
    headers: { accept: "text/event-stream" },
  });
  const events: SseEvent[] = [];
  const waiters = new Set<() => void>();
  let ended = false;
  void (async () => {
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.*)$/m.exec(chunk)?.[1];
          const data = /^data: (.*)$/m.exec(chunk)?.[1];
          if (event && data)
            events.push({ event, data: JSON.parse(data), at: Date.now() });
          for (const w of [...waiters]) w();
        }
      }
    } catch {
      // Aborted.
    }
    ended = true;
    for (const w of [...waiters]) w();
  })();
  let cursor = 0;
  const next = (pred: (e: SseEvent) => boolean = () => true, ms = 5000) =>
    new Promise<SseEvent>((resolve, reject) => {
      const check = () => {
        while (cursor < events.length) {
          const e = events[cursor++];
          if (pred(e)) {
            cleanup();
            resolve(e);
            return true;
          }
        }
        if (ended) {
          cleanup();
          reject(new Error("stream ended"));
          return true;
        }
        return false;
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `no matching event within ${ms}ms; saw ${events
              .slice(-5)
              .map((e) => e.event)
              .join(",")}`,
          ),
        );
      }, ms);
      const cleanup = () => {
        clearTimeout(timer);
        waiters.delete(check as any);
      };
      if (!check()) waiters.add(check as any);
    });
  /** Like `next`, but searches everything received so far too. */
  const seen = (pred: (e: SseEvent) => boolean, ms = 5000) => {
    const hit = events.find(pred);
    if (hit) return Promise.resolve(hit);
    cursor = events.length;
    return next(pred, ms);
  };
  return {
    status: res.status,
    events,
    next,
    seen,
    get ended() {
      return ended;
    },
    close: () => controller.abort(),
  };
}

/** Apply a fleet stream's events with the browser's own reducer (src/live.ts). */
export function fleetState() {
  const state = emptyFleet();
  return {
    apply(e: SseEvent) {
      if (e.event === "reset") applyReset(state, e.data);
      else if (e.event === "patch") applyPatch(state, e.data);
      else if (e.event === "status" && e.data.rev >= state.statusRev) {
        state.statusRev = e.data.rev;
        state.status = e.data.status;
      }
    },
    // Tests read rows loosely, as the app's components would after narrowing.
    rows(resource: string): any[] {
      return rowsOf(state, resource as any);
    },
    state,
  };
}

/** A raw GET with exactly these headers (fetch won't send Host or Origin). */
export async function rawGet(url: string, headers: Record<string, string>) {
  const { request } = await import("node:http");
  return new Promise<number>((resolve, reject) => {
    const req = request(url, { headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
      req.destroy();
    });
    req.on("error", reject);
    req.end();
  });
}

/** Wait until `fn` is truthy. */
export async function until(fn: () => unknown, ms = 5000, what = "condition") {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(10);
  }
}
