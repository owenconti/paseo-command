/**
 * What the live layer needs from a daemon client and the records it reads,
 * named as the Paseo protocol names them. The SDK's client satisfies these
 * shapes; tests satisfy them with fakes. Records are the SDK's, with every
 * field but the id optional (older daemons, partial updates).
 */
import type {
  PaseoAgent,
  PaseoAgentListResult,
  PaseoProject,
  PaseoWorkspace,
} from "@getpaseo/client";
import { discard } from "../daemon";
import { errorMessage } from "../errors";

/** An agent as the daemon reports it. */
export type AgentRecord = Partial<PaseoAgent> & {
  id: string;
  /** Set by some older daemons instead of `archivedAt`. */
  archived?: boolean;
  [field: string]: unknown;
};
/** Where the daemon places an agent: its project and checkout. */
export type Placement = Partial<
  PaseoAgentListResult["entries"][number]["project"]
> | null;
/** A directory entry: the agent and its project placement. */
export interface AgentEntry {
  agent: AgentRecord;
  project?: Placement;
  syncSeq?: number;
}
/** An agent as a feed holds it. */
export type HeldAgent = { agent: AgentRecord; project: Placement };
export type WorkspaceRecord = Partial<PaseoWorkspace> & {
  id: string;
  syncSeq?: number;
  [field: string]: unknown;
};
export type ProjectRecord = Partial<PaseoProject> & {
  projectId: string;
  syncSeq?: number;
  [field: string]: unknown;
};

/** The daemon's sequencing of a directory read. */
export interface DirectorySync {
  generation?: string;
  headSeq?: number;
  mode?: "snapshot" | "changes";
  removals?: { id: string; seq: number }[];
}
export interface PageInfo {
  nextCursor?: string | null;
}
export interface AgentsPage {
  entries?: AgentEntry[];
  pageInfo?: PageInfo | null;
  sync?: DirectorySync | null;
}
export interface WorkspacesPage {
  entries?: WorkspaceRecord[];
  pageInfo?: PageInfo | null;
  sync?: DirectorySync | null;
}
export interface ProjectsPage {
  projects?: ProjectRecord[];
  sync?: DirectorySync | null;
}
export interface TimelinePage {
  agent?: AgentRecord | null;
  [field: string]: unknown;
}

/** A pushed directory change (`agent_update`, `workspace_update`, `project.update`). */
export interface DirectoryUpdate {
  kind?: string;
  agent?: AgentRecord;
  agentId?: string;
  project?: ProjectRecord | null;
  projectId?: string;
  workspace?: WorkspaceRecord;
  id?: string;
  removedProjectId?: string | null;
  emptyProject?: boolean;
  generation?: string;
  seq?: number;
}

/** A subscription the SDK owns: a snapshot, then updates. */
export interface Observation<T> {
  readonly ready: Promise<unknown>;
  subscribe(observer: {
    snapshot(value: T): void;
    update(message: unknown): void;
    error?(error: unknown): void;
  }): () => void;
  release(): Promise<void>;
}
export interface TimelineSubscription {
  readonly ready: Promise<unknown>;
  release?(): Promise<unknown>;
}
export interface ConnectionStatus {
  status?: string;
  reason?: string;
}

/**
 * A daemon client as the live layer uses it. Optional members are probed
 * at runtime: older daemons and test fakes lack some of them.
 */
export interface LiveClient {
  subscribeConnectionStatus?(
    listener: (status: ConnectionStatus) => void,
  ): () => void;
  observeAgents(options: object): Observation<AgentsPage>;
  observeWorkspaces(options: object): Observation<WorkspacesPage>;
  observeHosts?(): Observation<unknown> | undefined;
  observeEvents?(events: string[]): Observation<unknown> | undefined;
  on?(
    type: "project.update" | "agent.provider_subagents.update",
    handler: (message: unknown) => void,
  ): () => void;
  fetchAgents(options: object): Promise<AgentsPage>;
  fetchWorkspaces(options: object): Promise<WorkspacesPage>;
  listProjects(options: object): Promise<ProjectsPage>;
  fetchAgentTimeline(agentId: string, options: object): Promise<TimelinePage>;
  subscribeAgentTimeline(
    agentId: string,
    handler: (message: unknown) => void,
  ): TimelineSubscription;
  getLastServerInfoMessage?(): { serverId?: string } | null;
  /** One agent's provider subagents (in-process, not daemon agents). */
  listProviderSubagents?(
    parentAgentId: string,
    options?: { timeout?: number },
  ): Promise<{ subagents?: unknown[]; error?: string | null }>;
}

// ── Reading untyped values ─────────────────────────────────────────────────
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;
/** A property of any value, as `value?.[name]` reads it. */
export function fieldOf(value: unknown, name: string): unknown {
  return (typeof value === "object" || typeof value === "function") &&
    value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined;
}
/** A pushed payload, read as a directory change: anything else reads as empty. */
export const asUpdate = (payload: unknown): DirectoryUpdate =>
  isRecord(payload) ? payload : {};
/** A message's payload as a directory change, if it has the given type. */
export function updateOf(message: unknown, type: string) {
  if (fieldOf(message, "type") !== type) return undefined;
  return asUpdate(fieldOf(message, "payload"));
}

export const MISSING_CWD =
  "This agent's working directory no longer exists, so Paseo can't read its timeline.";
export const missingCwd = (e: unknown) =>
  /working directory does not exist/i.test(errorMessage(e));

/** Bound a daemon read; a read that times out discards its client. */
export function within<T>(
  value: Promise<T>,
  ms: number,
  what: string,
  client?: unknown,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    value,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        if (client) discard(client);
        reject(new Error(`${what} did not answer within ${ms / 1000}s.`));
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
