/** Shaping one host's SDK records into the rows the browser shows. */
import {
  agentRow,
  permissionRows,
  placeAgent,
  projectRow,
  workspaceRow,
} from "../rows";
import type {
  AgentEntry,
  AgentRecord,
  LiveClient,
  ProjectRecord,
  WorkspaceRecord,
} from "./client";
import { FORK_LABEL } from "../../src/forks/types";
import {
  runningSubagent,
  subagentRow,
  type SubagentRecord,
  type SubagentRow,
} from "./subagents";

const atOf = (iso: unknown) => {
  const t = Date.parse(typeof iso === "string" ? iso : "");
  return Number.isFinite(t) ? t : 0;
};
const label = (agent: AgentRecord | undefined, name: string) => {
  const v = agent?.labels?.[name];
  return typeof v === "string" ? v.trim() : "";
};
/**
 * Whether the Paseo app lists this agent (its `isWorkspaceRootAgent`): a
 * subagent, labelled with a parent on the same host, is listed only when it
 * works in another workspace than its parent.
 */
export function rootAgent(
  agent: AgentRecord,
  byId: Map<string, AgentEntry>,
  serverId?: string,
) {
  if (!childAgent(agent, serverId)) return true;
  const parent = byId.get(label(agent, "paseo.parent-agent-id"))?.agent;
  return Boolean(
    agent.workspaceId &&
    parent?.workspaceId &&
    agent.workspaceId !== parent.workspaceId,
  );
}
/**
 * Whether the agent has a parent on this host (the Paseo app's `parentAgentId`).
 * The app never notifies about one, nor counts it as needing you.
 */
export function childAgent(agent: AgentRecord | undefined, serverId?: string) {
  if (!label(agent, "paseo.parent-agent-id")) return false;
  const parentServer = label(agent, "paseo.parent-server-id");
  return !(parentServer && serverId && parentServer !== serverId);
}
/**
 * Whether the agent has a reply the user hasn't read, by the daemon's own
 * flag (the one the Paseo app shows and clears when the agent is opened in
 * either app): its turn finished and it isn't working, waiting on a request
 * or failed now, and no prompt has been sent since. Undefined when the
 * daemon doesn't report the flag. A listed subagent is never unread, as it
 * never notifies.
 */
export function unreadAgent(
  agent: AgentRecord,
  child: boolean,
  working: boolean,
): boolean | undefined {
  if (typeof agent.requiresAttention !== "boolean") return undefined;
  return (
    agent.requiresAttention &&
    agent.attentionReason === "finished" &&
    !child &&
    !working &&
    !/running|starting|initializing|error|failed/.test(
      String(agent.status ?? ""),
    ) &&
    !(
      Array.isArray(agent.pendingPermissions) && agent.pendingPermissions.length
    ) &&
    // A prompt sent after the flagged finish answered it: the reply was read.
    !(atOf(agent.lastUserMessageAt) > atOf(agent.attentionTimestamp))
  );
}
/** The host's server id, from the daemon's handshake. */
export const serverIdOf = (
  client: Pick<LiveClient, "getLastServerInfoMessage"> | undefined,
): string | undefined =>
  client?.getLastServerInfoMessage?.()?.serverId ?? undefined;

/** Archived agents are never shown. A closed one (its session ended, not
 *  archived) is still listed, as the Paseo app lists it. */
export const archivedAgent = (agent: AgentRecord | null | undefined) =>
  Boolean(agent?.archivedAt || agent?.archived) ||
  /archived/i.test(String(agent?.status ?? ""));

/**
 * Every fan-out resource for one host, from its SDK records. Agents are
 * `{ agent, project }` entries; active ones win over background rows for an id.
 * Subagents the Paseo app doesn't list are left out (see `rootAgent`).
 */
export function hostRows(input: {
  active: AgentEntry[];
  inactive: AgentEntry[];
  workspaces: WorkspaceRecord[];
  projects: ProjectRecord[];
  serverId?: string;
  /** An agent's provider subagents, running and finished (the daemon lists
   *  a finished one until it is archived); none when not tracked. */
  subagents?: (agentId: string) => SubagentRecord[];
  /** Provider subagents archived in this app ("Archive finished
   *  subagents"): left out, as the Paseo app leaves them out of its dropdown. */
  hidden?: (s: SubagentRecord) => boolean;
}) {
  const projects = input.projects.map(projectRow);
  const workspaces = input.workspaces.map(workspaceRow);
  const byId = new Map<string, AgentEntry>();
  for (const e of input.inactive) if (e?.agent?.id) byId.set(e.agent.id, e);
  for (const e of input.active) if (e?.agent?.id) byId.set(e.agent.id, e);
  for (const [id, e] of byId) if (archivedAgent(e.agent)) byId.delete(id);
  // A reply fork's helper is the panel's own: never on the map, in lists,
  // counted as work or asking for attention.
  for (const [id, e] of byId) if (label(e.agent, FORK_LABEL)) byId.delete(id);
  const entries = [...byId.values()].filter((e) =>
    rootAgent(e.agent, byId, input.serverId),
  );
  // Agents with a subagent (at any depth) running, as the Paseo app shows them working.
  const busy = new Set<string>();
  for (const e of byId.values()) {
    if (!/running|starting/.test(String(e.agent.status))) continue;
    let at: AgentRecord | undefined = e.agent;
    while (childAgent(at, input.serverId)) {
      const parent = label(at, "paseo.parent-agent-id");
      if (busy.has(parent)) break;
      busy.add(parent);
      at = byId.get(parent)?.agent;
      if (!at) break;
    }
  }
  // Each listed agent's subagents, as the Paseo app's subagent dropdown
  // lists them (running and finished, until archived): its own provider
  // subagents, plus hidden daemon subagents (and theirs) whose nearest listed
  // ancestor it is, each nested one naming the subagent that dispatched it.
  // A listed subagent is its own row, so it is never counted again here.
  const listed = new Set(entries.map((e) => e.agent.id));
  const live = new Map<string, SubagentRow[]>();
  const add = (id: string, rows: SubagentRow[]) => {
    if (rows.length) live.set(id, [...(live.get(id) ?? []), ...rows]);
  };
  // A hidden daemon subagent's own provider subagents are nested under it.
  const provider = (id: string, nestedUnder?: string) =>
    (input.subagents?.(id) ?? [])
      .filter((s) => !input.hidden?.(s))
      .map(subagentRow)
      .map((row) =>
        nestedUnder
          ? {
              ...row,
              owner: id,
              ...(row.parent ? {} : { parent: nestedUnder }),
            }
          : row,
      );
  for (const id of listed) add(id, provider(id));
  for (const e of byId.values()) {
    if (listed.has(e.agent.id)) continue;
    let owner = "";
    let at: AgentRecord | undefined = e.agent;
    const seen = new Set<string>();
    while (at && childAgent(at, input.serverId) && !seen.has(at.id)) {
      seen.add(at.id);
      owner = label(at, "paseo.parent-agent-id");
      if (listed.has(owner)) break;
      at = byId.get(owner)?.agent;
    }
    if (!listed.has(owner)) continue;
    const direct = label(e.agent, "paseo.parent-agent-id");
    const detail = [
      e.agent.provider,
      e.agent.model ?? e.agent.runtimeInfo?.model,
      e.agent.effectiveThinkingOptionId ?? e.agent.thinkingOptionId,
    ]
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean)
      .join(" · ");
    add(owner, [
      {
        id: e.agent.id,
        name:
          (typeof e.agent.title === "string" && e.agent.title.trim()) ||
          "Subagent",
        ...(e.agent.provider ? { kind: String(e.agent.provider) } : {}),
        status: String(e.agent.status ?? ""),
        source: "agent" as const,
        ...(direct && direct !== owner ? { parent: direct } : {}),
        ...(detail ? { detail } : {}),
        ...(typeof e.agent.createdAt === "string"
          ? { startedAt: e.agent.createdAt }
          : {}),
      },
      ...provider(e.agent.id, e.agent.id),
    ]);
  }
  // Unarchived agents only: running, then idle, newest first.
  const rank = (e: AgentEntry) =>
    e.agent.status === "running" ? 0 : e.agent.status === "idle" ? 1 : 2;
  entries.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      atOf(b.agent.createdAt) - atOf(a.agent.createdAt) ||
      String(a.agent.id).localeCompare(String(b.agent.id)),
  );
  // As the Paseo app names a chat: its workspace's title. Only for an agent
  // alone there, so agents sharing a workspace stay told apart.
  const shared = new Map<string, number>();
  for (const e of entries)
    if (e.agent.workspaceId)
      shared.set(
        e.agent.workspaceId,
        (shared.get(e.agent.workspaceId) ?? 0) + 1,
      );
  const agents = entries.map((e) => {
    const row = agentRow(e.agent, e.project);
    const projectId = placeAgent(row, e.project, projects, workspaces);
    const ws =
      shared.get(row.workspaceId ?? "") === 1
        ? input.workspaces.find((w) => w?.id === row.workspaceId)
        : undefined;
    const title = typeof ws?.title === "string" ? ws.title.trim() : "";
    const child = childAgent(e.agent, input.serverId);
    const subagents = live.get(row.id);
    const subagentsRunning =
      busy.has(row.id) || Boolean(subagents?.some(runningSubagent));
    const unread = unreadAgent(e.agent, child, subagentsRunning);
    return {
      ...row,
      ...(projectId ? { projectId } : {}),
      ...(title ? { title } : {}),
      ...(child ? { child } : {}),
      ...(subagentsRunning ? { subagentsRunning } : {}),
      ...(subagents ? { subagents } : {}),
      ...(unread !== undefined ? { unread } : {}),
    };
  });
  return {
    agents,
    projects,
    workspaces: workspaces.filter((w) => w.workspaceId),
    permissions: permissionRows(entries.map((e) => e.agent)),
  };
}

/** Unarchived directory entries, as a feed holds them. */
export const agentItems = (entries: AgentEntry[] | undefined) =>
  (Array.isArray(entries) ? entries : [])
    .filter((e) => e?.agent?.id && !archivedAgent(e.agent))
    .map((e) => ({
      id: e.agent.id,
      value: { agent: e.agent, project: e.project ?? null },
      seq: e.syncSeq,
    }));

/** Only unarchived agents, including background agents, page by page. */
export async function unarchivedAgents(
  client: Pick<LiveClient, "fetchAgents">,
) {
  const out: AgentEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const r = await client.fetchAgents({
      filter: { includeArchived: false, includeBackground: true },
      sort: [{ key: "created_at", direction: "desc" }],
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    out.push(
      ...(Array.isArray(r?.entries)
        ? r.entries.filter((e) => !archivedAgent(e.agent))
        : []),
    );
    cursor = r?.pageInfo?.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}

/** Every workspace, page by page (as `workspace ls`). */
export async function allWorkspaces(
  client: Pick<LiveClient, "fetchWorkspaces">,
) {
  const out: WorkspaceRecord[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const r = await client.fetchWorkspaces({
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    out.push(...(Array.isArray(r?.entries) ? r.entries : []));
    cursor = r?.pageInfo?.nextCursor ?? undefined;
    if (!cursor) break;
  }
  return out;
}
