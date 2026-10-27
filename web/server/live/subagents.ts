/**
 * A host's provider subagents: the in-process subagents a provider runs inside
 * one daemon agent's turn (Claude Code's Agent tool, for example). They are
 * not daemon agents, so the agent directory never lists them. The daemon
 * reports them per parent agent (`listProviderSubagents`) and pushes their
 * changes to sessions that asked for `agent.provider_subagents.update`.
 *
 * The daemon keeps a finished subagent (completed, failed or canceled) in its
 * listing until the user archives it in the Paseo app ("Archive finished
 * subagents" removes it), so a parent's held set is what the Paseo app's
 * subagent dropdown lists: running and finished alike.
 *
 * Pushes and listings race, so neither simply overwrites the other: a record
 * only replaces an older one (by the daemon's `updatedAt`), and a listing only
 * drops a held record that arrived before the listing was requested.
 */
import { fieldOf, isRecord } from "./client";

/** A provider subagent as the daemon reports it (read defensively). */
export type SubagentRecord = {
  id: string;
  parentAgentId: string;
  parentSubagentId?: string | null;
  provider?: string;
  title?: string | null;
  description?: string | null;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  [field: string]: unknown;
};
/** A subagent (running or finished) as a row carries it to the browser. */
export type SubagentRow = {
  id: string;
  /** What it was asked to do (its description), else its kind. */
  name: string;
  /** Its kind: the provider's subagent type, or a daemon agent's provider. */
  kind?: string;
  /** The daemon's status: running (or starting), or finished (completed,
   *  failed, canceled; a hidden daemon child's idle or error). */
  status: string;
  /** A provider subagent inside the turn, or a hidden daemon child agent. */
  source: "provider" | "agent";
  /** The subagent that dispatched it, when it is nested (an id on this same
   *  row); absent when the row's agent dispatched it. */
  parent?: string;
  /** Its facts line, as the Paseo app's subagent dropdown shows it under the
   *  name: the daemon's subtitle for a provider subagent ("general-purpose ·
   *  Opus 5.5 · Medium · 145.7k tokens"), a hidden child's provider, model
   *  and thinking. */
  detail?: string;
  /** For a provider subagent: the daemon agent whose turn runs it (whose
   *  timeline API reads its conversation), when that isn't the row's own
   *  agent (one run by a hidden daemon subagent). */
  owner?: string;
  startedAt?: string;
};

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const at = (iso: unknown) => {
  const t = Date.parse(text(iso));
  return Number.isFinite(t) ? t : 0;
};

/** A record from a listing or push, if it names itself and its parent. */
export function subagentOf(value: unknown): SubagentRecord | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id),
    parentAgentId = text(value.parentAgentId);
  return id && parentAgentId
    ? ({ ...value, id, parentAgentId } as SubagentRecord)
    : undefined;
}

export const runningSubagent = (s: { status?: unknown }) =>
  /running|starting|initializing/.test(text(s.status));
/**
 * Whether the Paseo app's "Archive finished subagents" takes it
 * (`isFinishedSubagent`): a provider subagent that completed, failed or was
 * canceled, or a hidden daemon child that is idle or in error.
 */
export const finishedSubagent = (s: {
  status?: unknown;
  source: "provider" | "agent";
}) =>
  s.source === "agent"
    ? /^(idle|error)$/.test(text(s.status))
    : /^(completed|failed|canceled)$/.test(text(s.status));

/** A provider subagent, as its parent's row carries it. */
export function subagentRow(s: SubagentRecord): SubagentRow {
  const kind = text(s.title),
    parent = text(s.parentSubagentId),
    detail = text(s.subtitle);
  return {
    id: s.id,
    name: text(s.description) || kind || "Subagent",
    ...(kind ? { kind } : {}),
    status: text(s.status) || "running",
    source: "provider",
    ...(parent && parent !== s.id ? { parent } : {}),
    ...(detail ? { detail } : {}),
    ...(text(s.createdAt) ? { startedAt: text(s.createdAt) } : {}),
  };
}

type Held = { record: SubagentRecord; arrival: number };

export class ProviderSubagents {
  private byParent = new Map<string, Map<string, Held>>();
  private arrivals = 0;

  /** Number a listing before it is requested. */
  issue() {
    return this.arrivals;
  }
  /** Every subagent of one parent the daemon still lists (running and
   *  finished, until archived), oldest first. */
  held(parentAgentId: string): SubagentRecord[] {
    const held = this.byParent.get(parentAgentId);
    if (!held) return [];
    return [...held.values()]
      .map((h) => h.record)
      .sort(
        (a, b) => at(a.createdAt) - at(b.createdAt) || a.id.localeCompare(b.id),
      );
  }
  /** The running subagents of one parent, oldest first. */
  running(parentAgentId: string): SubagentRecord[] {
    return this.held(parentAgentId).filter(runningSubagent);
  }
  private signature(parentAgentId: string) {
    return JSON.stringify(this.held(parentAgentId).map(subagentRow));
  }
  private put(record: SubagentRecord, arrival: number) {
    let held = this.byParent.get(record.parentAgentId);
    if (!held) this.byParent.set(record.parentAgentId, (held = new Map()));
    const prev = held.get(record.id);
    if (prev && at(prev.record.updatedAt) > at(record.updatedAt)) return;
    held.set(record.id, { record, arrival });
  }
  /** A pushed `agent.provider_subagents.update`; true if a parent's set changed. */
  event(message: unknown): boolean {
    if (fieldOf(message, "type") !== "agent.provider_subagents.update")
      return false;
    const payload = fieldOf(message, "payload");
    const kind = fieldOf(payload, "kind");
    if (kind === "upsert") {
      const record = subagentOf(fieldOf(payload, "subagent"));
      if (!record) return false;
      const before = this.signature(record.parentAgentId);
      this.put(record, ++this.arrivals);
      return before !== this.signature(record.parentAgentId);
    }
    if (kind === "remove") {
      const parent = text(fieldOf(payload, "parentAgentId")),
        id = text(fieldOf(payload, "subagentId"));
      const held = this.byParent.get(parent);
      if (!held?.has(id)) return false;
      const before = this.signature(parent);
      held.delete(id);
      if (!held.size) this.byParent.delete(parent);
      ++this.arrivals;
      return before !== this.signature(parent);
    }
    // Timeline items carry no status.
    return false;
  }
  /**
   * One parent's complete listing, requested at `mark`. Records pushed since
   * then stand unless the listing has a newer one.
   */
  listing(parentAgentId: string, values: unknown, mark: number): boolean {
    const before = this.signature(parentAgentId);
    const held = this.byParent.get(parentAgentId);
    const listed = (Array.isArray(values) ? values : [])
      .map(subagentOf)
      .filter(
        (s): s is SubagentRecord => !!s && s.parentAgentId === parentAgentId,
      );
    const ids = new Set(listed.map((s) => s.id));
    if (held)
      for (const [id, h] of held)
        if (!ids.has(id) && h.arrival <= mark) held.delete(id);
    for (const s of listed) this.put(s, mark);
    if (!this.byParent.get(parentAgentId)?.size)
      this.byParent.delete(parentAgentId);
    return before !== this.signature(parentAgentId);
  }
  /** Drop parents no longer held (archived or gone). */
  retain(parentIds: Set<string>) {
    let changed = false;
    for (const id of [...this.byParent.keys()])
      if (!parentIds.has(id)) {
        changed ||= this.held(id).length > 0;
        this.byParent.delete(id);
      }
    return changed;
  }
  clear() {
    this.byParent.clear();
  }
}
