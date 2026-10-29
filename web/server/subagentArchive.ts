/**
 * "Archive finished subagents", as the Paseo app's subagent dropdown does it
 * (its `createArchiveFinishedSubagents`), for one parent agent:
 *
 * - A hidden daemon child (an agent labelled `paseo.parent-agent-id`) that is
 *   idle or in error is archived with the daemon's own agent archive request
 *   (`archive_agent_request`, the SDK's `archiveAgent`).
 * - A provider subagent (in-process, inside the parent's turn) that
 *   completed, failed or was canceled has no daemon request at all: the
 *   daemon keeps it until the parent goes, and the Paseo app only hides it
 *   from its own dropdown (`hideFromTrack`). This app hides it the same way,
 *   in a small file in its data directory (`archived-subagents.json`), so
 *   the browser, the native app and `npm run subagents:archive` agree, and a
 *   reload keeps it hidden. A hidden one that runs again shows again, as in
 *   the Paseo app.
 *
 * Running subagents are never touched, nor a finished hidden child with
 * anything running under it.
 */
import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { FORK_LABEL } from "../src/forks/types";
import type { AgentRecord } from "./live/client";
import {
  archivedAgent,
  childAgent,
  rootAgent,
  unarchivedAgents,
} from "./live/hostRows";
import {
  finishedSubagent,
  runningSubagent,
  subagentOf,
  type SubagentRecord,
} from "./live/subagents";
import type { AgentEntry } from "./live/client";

// ── The hidden provider subagents ──────────────────────────────────────────
/** This app's data directory: `PASEO_COMMAND_DATA`, else the checkout's `.paseo-command`. */
export const dataDir = () =>
  process.env.PASEO_COMMAND_DATA ||
  join(process.env.PASEO_COMMAND_REPO || process.cwd(), ".paseo-command");
export const archiveFile = () => join(dataDir(), "archived-subagents.json");

type Entry = { host: string; owner: string; id: string; at: string };
/** Entries kept at most; the oldest go first. */
const MAX_ENTRIES = 5000;
const keyOf = (host: string, owner: string, id: string) =>
  `${host}\u0000${owner}\u0000${id}`;

/**
 * Provider subagents archived (hidden) here, per host ("local" or a remote's
 * server id) and owning agent. Re-read when the file changes (another
 * process, such as the CLI, wrote it), checked at most every `recheckMs`.
 */
export class ArchivedSubagents {
  private entries = new Map<string, Entry>();
  private stamp = "";
  private checkedAt = 0;
  recheckMs = 500;
  constructor(readonly file: string) {}
  private signature() {
    try {
      const s = statSync(this.file);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return "";
    }
  }
  /** Re-read the file if it changed; true if what is held changed. */
  refresh(force = false) {
    const now = Date.now();
    if (!force && now - this.checkedAt < this.recheckMs) return false;
    this.checkedAt = now;
    const stamp = this.signature();
    if (stamp === this.stamp) return false;
    this.stamp = stamp;
    const next = new Map<string, Entry>();
    try {
      const raw = stamp ? JSON.parse(readFileSync(this.file, "utf8")) : null;
      for (const e of Array.isArray(raw?.entries) ? raw.entries : [])
        if (
          typeof e?.host === "string" &&
          typeof e?.owner === "string" &&
          typeof e?.id === "string"
        )
          next.set(keyOf(e.host, e.owner, e.id), {
            host: e.host,
            owner: e.owner,
            id: e.id,
            at: typeof e.at === "string" ? e.at : "",
          });
    } catch {
      // Unreadable (mid-write by another process): keep what is held.
      this.stamp = "";
      return false;
    }
    const before = [...this.entries.keys()].join("\n");
    this.entries = next;
    return before !== [...next.keys()].join("\n");
  }
  has(host: string, owner: string, id: string) {
    this.refresh();
    return this.entries.has(keyOf(host, owner, id));
  }
  /** Hide these; returns how many were new. Written atomically. */
  add(host: string, list: { owner: string; id: string }[]) {
    this.refresh(true);
    let added = 0;
    const at = new Date().toISOString();
    for (const { owner, id } of list) {
      const key = keyOf(host, owner, id);
      if (this.entries.has(key)) continue;
      this.entries.set(key, { host, owner, id, at });
      added++;
    }
    if (!added) return 0;
    const kept = [...this.entries.values()].slice(-MAX_ENTRIES);
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ version: 1, entries: kept }, null, 1) + "\n",
    );
    renameSync(tmp, this.file);
    this.stamp = this.signature();
    this.checkedAt = Date.now();
    return added;
  }
  /** Every entry (tests, diagnostics). */
  list() {
    this.refresh(true);
    return [...this.entries.values()];
  }
}

let shared: ArchivedSubagents | undefined;
/** The store for the current data directory (tests change it per process). */
export function archivedSubagents() {
  const file = archiveFile();
  if (shared?.file !== file) shared = new ArchivedSubagents(file);
  return shared;
}
/** A provider subagent this app hides: archived here and not running again. */
export const hiddenSubagent = (host: string, s: SubagentRecord) =>
  !runningSubagent(s) && archivedSubagents().has(host, s.parentAgentId, s.id);

let watching: string | undefined;
/** Call `fn` when another process changes the file (polled every second). */
export function watchArchive(fn: () => void) {
  const file = archiveFile();
  if (watching === file) return;
  unwatchArchive();
  watching = file;
  watchFile(file, { interval: 1000, persistent: false }, () => {
    if (archivedSubagents().refresh(true)) fn();
  });
}
export function unwatchArchive() {
  if (watching) unwatchFile(watching);
  watching = undefined;
}

// ── Planning ───────────────────────────────────────────────────────────────
export type Candidate = {
  id: string;
  /** The daemon agent it belongs to: its own parent agent (a hidden child's
   *  parent, a provider subagent's owner). */
  owner: string;
  name: string;
  status: string;
  source: "provider" | "agent";
};
export type Plan = {
  /** Finished hidden daemon children to archive (deepest first). */
  archive: Candidate[];
  /** Finished provider subagents to hide. */
  dismiss: Candidate[];
  /** Left alone: running, or finished with something running under it. */
  keep: (Candidate & { reason: string })[];
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const parentOf = (a: AgentRecord) => text(a.labels?.["paseo.parent-agent-id"]);

/**
 * What "Archive finished subagents" takes for `parent`: its provider
 * subagents, and the hidden daemon subagents whose nearest listed ancestor it
 * is (with their own provider subagents), as its row lists them. A listed
 * descendant is its own agent and is left alone. Provider subagents already
 * hidden are skipped.
 */
export function planArchive(input: {
  parent: string;
  /** The host's unarchived agents. */
  agents: AgentRecord[];
  provider: (agentId: string) => SubagentRecord[];
  hidden?: (s: SubagentRecord) => boolean;
  serverId?: string;
}): Plan {
  const byId = new Map<string, AgentEntry>();
  for (const a of input.agents)
    // A reply fork's helper is the panel's own, closed or reopened there.
    if (a?.id && !archivedAgent(a) && !a.labels?.[FORK_LABEL])
      byId.set(a.id, { agent: a });
  // Hidden descendants: every agent whose parents up to `parent` are hidden.
  const depth = new Map<string, number>();
  const depthOf = (a: AgentRecord): number => {
    const known = depth.get(a.id);
    if (known !== undefined) return known;
    depth.set(a.id, -1);
    let d = -1;
    if (
      childAgent(a, input.serverId) &&
      !rootAgent(a, byId, input.serverId) &&
      a.id !== input.parent
    ) {
      const up = parentOf(a);
      if (up === input.parent) d = 1;
      else {
        const p = byId.get(up)?.agent;
        const pd = p ? depthOf(p) : -1;
        d = pd > 0 ? pd + 1 : -1;
      }
    }
    depth.set(a.id, d);
    return d;
  };
  const hiddenKids = [...byId.values()]
    .map((e) => e.agent)
    .filter((a) => depthOf(a) > 0);
  const owners = [input.parent, ...hiddenKids.map((a) => a.id)];
  const provider = new Map(
    owners.map((id) => [
      id,
      input.provider(id).filter((s) => !input.hidden?.(s)),
    ]),
  );
  // Whether anything under a hidden child (at any depth) is running.
  const kidsOf = (id: string) => hiddenKids.filter((a) => parentOf(a) === id);
  const busy = (id: string, seen = new Set<string>()): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return (
      (provider.get(id) ?? []).some(runningSubagent) ||
      kidsOf(id).some((k) => runningSubagent(k) || busy(k.id, seen))
    );
  };
  const plan: Plan = { archive: [], dismiss: [], keep: [] };
  for (const owner of owners)
    for (const s of provider.get(owner) ?? []) {
      const c: Candidate = {
        id: s.id,
        owner,
        name: text(s.description) || text(s.title) || "Subagent",
        status: text(s.status) || "running",
        source: "provider",
      };
      if (finishedSubagent(c)) plan.dismiss.push(c);
      else plan.keep.push({ ...c, reason: c.status });
    }
  for (const a of hiddenKids.sort((x, y) => depthOf(y) - depthOf(x))) {
    const c: Candidate = {
      id: a.id,
      owner: parentOf(a),
      name: text(a.title) || "Subagent",
      status: text(a.status),
      source: "agent",
    };
    if (!finishedSubagent(c)) plan.keep.push({ ...c, reason: c.status });
    else if (busy(a.id))
      plan.keep.push({ ...c, reason: "a subagent of it is running" });
    else plan.archive.push(c);
  }
  return plan;
}

// ── Archiving ──────────────────────────────────────────────────────────────
/** What archiving needs from a daemon client (the SDK's, or a fake). */
export interface ArchiveClient {
  fetchAgents(options: object): Promise<{
    entries?: AgentEntry[];
    pageInfo?: { nextCursor?: string | null } | null;
  }>;
  fetchAgent(
    agentId: string,
  ): Promise<{ agent?: AgentRecord | null } | null | undefined>;
  listProviderSubagents?(
    parentAgentId: string,
    options?: { timeout?: number },
  ): Promise<{ subagents?: unknown[]; error?: string | null }>;
  archiveAgent(agentId: string): Promise<unknown>;
  getLastServerInfoMessage?(): { serverId?: string } | null;
}
export type ArchiveReport = {
  parent: string;
  dryRun: boolean;
  /** Hidden daemon children archived (or, on a dry run, to archive). */
  archived: Candidate[];
  /** Provider subagents hidden (or to hide). */
  dismissed: Candidate[];
  /** Running (or with something running under them): left alone. */
  skipped: (Candidate & { reason: string })[];
  failed: (Candidate & { error: string })[];
};

/** Bound a daemon call. */
function bounded<T>(value: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    value,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} did not answer within ${ms / 1000}s.`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Archive the finished subagents of `parent` on one host (`host`: "local"
 * or a remote's server id). A dry run reads only. Each hidden child is read
 * again just before it is archived; one that started again is skipped.
 */
export async function archiveFinishedSubagents(input: {
  client: ArchiveClient;
  host: string;
  parent: string;
  dryRun?: boolean;
  /** Only these subagents (ids as listed); all of the agent's otherwise. */
  only?: Set<string>;
  store?: ArchivedSubagents;
  timeoutMs?: number;
}): Promise<ArchiveReport> {
  const { client, host, parent } = input;
  const ms = input.timeoutMs ?? 15000;
  const store = input.store ?? archivedSubagents();
  const agents = (
    await bounded(unarchivedAgents(client), ms, "The Paseo daemon")
  ).map((e) => e.agent);
  if (!agents.some((a) => a.id === parent)) {
    const own = await bounded(client.fetchAgent(parent), ms, "The daemon");
    if (!own?.agent) throw new Error(`Agent not found: ${parent}`);
    if (archivedAgent(own.agent))
      throw new Error(`Agent ${parent} is archived.`);
    agents.push(own.agent);
  }
  const serverId = client.getLastServerInfoMessage?.()?.serverId ?? undefined;
  // Provider subagents of the parent and of its hidden daemon subagents.
  const shape = planArchive({ parent, agents, provider: () => [], serverId });
  const owners = [
    parent,
    ...[...shape.archive, ...shape.keep]
      .filter((c) => c.source === "agent")
      .map((c) => c.id),
  ];
  const listed = new Map<string, SubagentRecord[]>();
  if (typeof client.listProviderSubagents === "function")
    for (const id of owners) {
      const r = await bounded(
        client.listProviderSubagents(id, { timeout: ms }),
        ms,
        "The Paseo daemon",
      );
      if (r?.error) {
        if (id === parent) throw new Error(r.error);
        continue;
      }
      listed.set(
        id,
        (Array.isArray(r?.subagents) ? r.subagents : [])
          .map(subagentOf)
          .filter((s): s is SubagentRecord => !!s && s.parentAgentId === id),
      );
    }
  const plan = planArchive({
    parent,
    agents,
    provider: (id) => listed.get(id) ?? [],
    hidden: (s) =>
      !runningSubagent(s) && store.has(host, s.parentAgentId, s.id),
    serverId,
  });
  if (input.only) {
    const only = input.only;
    plan.archive = plan.archive.filter((c) => only.has(c.id));
    plan.dismiss = plan.dismiss.filter((c) => only.has(c.id));
    plan.keep = plan.keep.filter((c) => only.has(c.id));
  }
  const report: ArchiveReport = {
    parent,
    dryRun: Boolean(input.dryRun),
    archived: [],
    dismissed: plan.dismiss,
    skipped: plan.keep,
    failed: [],
  };
  if (input.dryRun) {
    report.archived = plan.archive;
    return report;
  }
  // Children that started again keep every ancestor of theirs too.
  const up = new Map(agents.map((a) => [a.id, parentOf(a)]));
  const startedAgain = new Set<string>();
  const above = (id: string, ancestor: string) => {
    for (let at = up.get(id), n = 0; at && n < 100; at = up.get(at), n++)
      if (at === ancestor) return true;
    return false;
  };
  for (const c of plan.archive) {
    try {
      if ([...startedAgain].some((id) => above(id, c.id))) {
        report.skipped.push({ ...c, reason: "a subagent of it is running" });
        startedAgain.add(c.id);
        continue;
      }
      // Read it again now: never archive one that started running again.
      const now = (await bounded(client.fetchAgent(c.id), ms, "The daemon"))
        ?.agent;
      if (!now || archivedAgent(now)) continue;
      if (!finishedSubagent({ status: now.status, source: "agent" })) {
        report.skipped.push({
          ...c,
          status: text(now.status),
          reason: text(now.status),
        });
        startedAgain.add(c.id);
        continue;
      }
      const r = await bounded(client.archiveAgent(c.id), ms, "The daemon");
      const refused = (Object(r) as { error?: unknown }).error;
      if (refused) throw new Error(String(refused));
      report.archived.push(c);
    } catch (error) {
      report.failed.push({
        ...c,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  store.add(
    host,
    plan.dismiss.map((c) => ({ owner: c.owner, id: c.id })),
  );
  return report;
}

/** One line per subagent, for the CLI and logs. */
export function describeReport(r: ArchiveReport) {
  const line = (c: Candidate) =>
    `  ${c.source === "agent" ? "agent   " : "provider"} ${c.id}  ${c.status.padEnd(9)} ${c.name}`;
  const out: string[] = [];
  const total = r.archived.length + r.dismissed.length;
  out.push(
    r.dryRun
      ? `Would archive ${total} finished subagent${total === 1 ? "" : "s"} of ${r.parent}:`
      : `Archived ${total} finished subagent${total === 1 ? "" : "s"} of ${r.parent}:`,
  );
  for (const c of [...r.archived, ...r.dismissed]) out.push(line(c));
  if (!total) out.push("  (none)");
  if (r.skipped.length) {
    out.push(`Left alone (${r.skipped.length}, running):`);
    for (const c of r.skipped) out.push(`${line(c)}  [${c.reason}]`);
  }
  if (r.failed.length) {
    out.push(`Failed (${r.failed.length}):`);
    for (const c of r.failed) out.push(`${line(c)}  [${c.error}]`);
  }
  return out.join("\n");
}
