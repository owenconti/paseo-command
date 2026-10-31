export type Agent = {
  /** Host-qualified client identity (local IDs keep their legacy value). */
  id: string;
  /** Unchanged daemon identifier for remote records. */
  daemonId?: string;
  shortId: string;
  name: string;
  /** The title set in the Paseo app (its workspace's), shown in place of `name`. */
  title?: string;
  provider: string;
  thinking?: string;
  status: string;
  cwd: string;
  projectId?: string;
  workspaceId?: string;
  branch?: string;
  created: string;
  host?: string;
  hostLabel?: string;
  /** Archived agents keep their last run status, so this flag is authoritative. */
  archived?: boolean;
  /** Last-known row from a host that isn't answering. */
  stale?: boolean;
  /** The daemon's own times (ISO), when its record could be read. */
  createdAt?: string;
  updatedAt?: string;
  lastUserMessageAt?: string | null;
  attentionTimestamp?: string | null;
  /** The daemon's verdict: its turn finished with a reply the user hasn't
   *  read (in this app or the Paseo app). Absent when the daemon doesn't
   *  report its attention flag; the app then tracks reads itself. */
  unread?: boolean;
  /** A listed subagent (it has a parent on its host): as in the Paseo app, it
   *  never notifies and isn't counted as needing you. */
  child?: boolean;
  /** One of its subagents (at any depth, listed or not) is running. */
  subagentsRunning?: boolean;
  /** Its subagents that aren't listed as agents themselves, running and
   *  finished, as the Paseo app's subagent dropdown lists them (a finished
   *  one stays until it is archived there): the provider's in-process
   *  subagents (Claude Code's Agent tool) and hidden daemon subagents.
   *  Absent when it has none. */
  subagents?: Subagent[];
};
/** A subagent of a listed agent, running or finished. */
export type Subagent = {
  id: string;
  /** What it was asked to do, else its kind. */
  name: string;
  /** The provider's subagent type ("general-purpose"), or a daemon agent's provider. */
  kind?: string;
  /** Running (or starting), else finished: completed, failed, canceled, or
   *  a hidden daemon child's idle or error. */
  status: string;
  /** In-process provider subagent, or a hidden daemon child agent. */
  source: "provider" | "agent";
  /** The subagent that dispatched it, when nested (an id in the same list). */
  parent?: string;
  /** Its facts line under the name, as the Paseo app's dropdown shows it
   *  ("general-purpose · Opus 5.5 · Medium · 145.7k tokens"). */
  detail?: string;
  /** A provider subagent run by a hidden daemon subagent: that agent's ID
   *  (its conversation is read from it). */
  owner?: string;
  startedAt?: string;
};
export type Project = {
  projectId: string;
  name: string;
  kind: string;
  path: string;
  host?: string;
  hostLabel?: string;
  stale?: boolean;
};
export type Workspace = {
  workspaceId: string;
  /** Stable owner supplied by Paseo; display names are not unique. */
  projectId?: string;
  project: string;
  name: string;
  isolation: string;
  cwd: string;
  background: boolean;
  branch: string;
  /** Its Paseo labels, by name. */
  labels?: string[];
  /** Its pull request as Paseo reports it (null: none); absent when unknown. */
  pr?: PullRequest | null;
  /** When the daemon created it (ISO), if known. */
  createdAt?: string;
  /** Its repository's GitHub page, from the checkout's remote, if on GitHub. */
  repo?: string;
  host?: string;
  hostLabel?: string;
  stale?: boolean;
};
export type PullRequest = {
  number: number;
  title: string;
  state: "open" | "draft" | "merged" | "closed";
  url: string;
  /** From gh only (Paseo doesn't report it). */
  body?: string;
  /** Its head's CI checks (Paseo's, else gh's); absent when unknown. */
  ci?: PrCi;
  /** Its merge queue standing; absent when unknown. */
  queue?: MergeQueue;
  /** Its review decision; absent when unknown or none. */
  review?: "pending" | "approved" | "changes_requested";
  /** Whether it conflicts with its base branch; absent while unknown. */
  conflicts?: boolean;
  /** Auto-merge, when it's on: GitHub merges it once its requirements pass. */
  autoMerge?: { method?: "merge" | "squash" | "rebase"; by?: string };
};
export type PrCheck = {
  name: string;
  status: "success" | "failure" | "pending" | "skipped" | "cancelled";
  url?: string;
};
export type PrCi = {
  state: "passing" | "failing" | "pending" | "none";
  /** Failing first, then pending; capped. */
  checks: PrCheck[];
};
export type MergeQueue = {
  /** The base branch merges through a merge queue. */
  enabled: boolean;
  /** The PR is in it. */
  queued: boolean;
  /** Entry details: from gh, on this machine's checkouts only. */
  state?: "queued" | "awaiting_checks" | "mergeable" | "unmergeable" | "locked";
  position?: number;
  enqueuedAt?: string;
  etaSeconds?: number;
};
export type Provider = {
  provider: string;
  label: string;
  status: string;
  defaultMode: string;
};
export type Model = {
  model: string;
  id: string;
  description?: string;
  thinkingOptionIds?: string[];
  defaultThinkingOptionId?: string;
};
/** A Paseo agent profile: a named provider, model, thinking, mode and features. */
export type Profile = {
  id: string;
  name: string;
  provider: string;
  model: string;
  thinking: string;
  mode: string;
  features: Record<string, string | number | boolean>;
  notes: string;
};
export type Mode = { id: string; label: string };
export type Host = {
  serverId: string;
  label: string;
  /** The daemon registry's connection status. */
  status: string;
  local: boolean;
  /** How this app's own requests to the host are going. */
  state?: "online" | "loading" | "slow" | "stale" | "offline";
  error?: string | null;
  lastOkAt?: number | null;
  retryAt?: number | null;
};
export type Permission = {
  id: string;
  name: string;
  description: string;
  /** Tool input or command, when the daemon provides it. */
  detail?: string;
  /** Proposed plan text for plan-approval requests. */
  plan?: string;
  kind?: string;
  /** AskUserQuestion-style prompts that need answers, not just approval. */
  questions?: {
    question: string;
    header: string;
    options: { label: string; description?: string }[];
    multiSelect: boolean;
    allowOther: boolean;
    allowEmpty: boolean;
  }[];
  actions?: { id: string; label: string; behavior: "allow" | "deny" }[];
};
export type PendingPermission = Permission & {
  agentId: string;
  host?: string;
};
export type UsageReport = {
  id: string;
  sourceId: string;
  sourceLabel: string;
  account?: { label?: string };
  report?: {
    status: string;
    planLabel?: string;
    windows?: {
      id: string;
      label: string;
      usedPct: number;
      resetsAt?: string;
      tone?: string;
    }[];
    balances?: {
      id: string;
      label: string;
      used?: number;
      remaining?: number;
      limit?: number;
      unit?: string;
      tone?: string;
      resetsAt?: string;
    }[];
  };
};
export type Detail = {
  Id: string;
  Name: string;
  Provider: string;
  Model: string;
  Thinking?: string;
  Status: string;
  Mode: string;
  Cwd: string;
  CreatedAt: string;
  UpdatedAt: string;
  /** When the current turn's prompt was sent; null before any follow-up,
   *  undefined when the daemon's live record couldn't be read. */
  LastUserMessageAt?: string | null;
  /** When the daemon flagged the agent for attention (finish/error/permission). */
  AttentionTimestamp?: string | null;
  Archived?: boolean;
  AvailableModes?: Mode[];
  ParentAgentId?: string | null;
  Worktree: unknown;
  PendingPermissions: Permission[];
  LastUsage: {
    InputTokens?: number;
    OutputTokens?: number;
    CachedTokens?: number;
    CostUsd?: number;
  } | null;
};
export type Health = {
  localDaemon: string;
  connectedDaemon: string;
  daemonVersion: string;
  hostname: string;
};
export type Selection = {
  type: "agent" | "workspace" | "project";
  id: string;
  host?: string;
  /** An agent's subagent whose conversation is open (its id in the agent's
   *  `subagents`); the agent stays the selection. */
  subagent?: string;
} | null;
export const isRunning = (status: string) => /running|starting/.test(status);
/** Working: running itself, or waiting on a running subagent (as the Paseo app shows it). */
export const isWorking = (a: { status: string; subagentsRunning?: boolean }) =>
  isRunning(a.status) || Boolean(a.subagentsRunning);
export const isWaiting = (status: string) =>
  /permission|waiting|approval/.test(status);
/** Archived. A closed agent (its session ended) is not: it reads as idle. */
export const isArchived = (a: { status: string; archived?: boolean }) =>
  Boolean(a.archived) || /archived/.test(a.status);
/** The status to show: archived agents otherwise read as "idle", and ones
 *  waiting on a running subagent as running. */
export const shownStatus = (a: {
  status: string;
  archived?: boolean;
  subagentsRunning?: boolean;
}) =>
  a.archived
    ? "archived"
    : a.subagentsRunning && !isRunning(a.status)
      ? "running"
      : a.status;
export const isFailed = (status: string) => /error|failed/.test(status);
/** The status shown for an agent with a reply the user hasn't read. */
export const UNREAD = "unread";
export const tone = (status: string) =>
  isWaiting(status)
    ? "amber"
    : status === UNREAD
      ? "unread"
      : isRunning(status)
        ? "green"
        : isFailed(status)
          ? "red"
          : "slate";
/** Projects and workspaces are matched by name, so names must be compared within one host. */
export const sameHost = (a: { host?: string }, b: { host?: string }) =>
  (a.host || "") === (b.host || "");
export const hostQuery = (host?: string) =>
  host ? `?host=${encodeURIComponent(host)}` : "";
export const providerName = (provider: string) => provider.split("/")[0];

/**
 * Rows from a host whose chip says it isn't answering are stale, whatever the
 * row itself says (the host list and the rows arrive from separate requests).
 */
export function markDegraded<T extends { host?: string; stale?: boolean }>(
  rows: T[],
  hosts: Host[],
): T[] {
  const degraded = new Set(
    hosts
      .filter((h) => !h.local && (h.state === "stale" || h.state === "offline"))
      .map((h) => h.serverId),
  );
  if (!degraded.size) return rows;
  return rows.map((r) =>
    r.host && degraded.has(r.host) && !r.stale ? { ...r, stale: true } : r,
  );
}
