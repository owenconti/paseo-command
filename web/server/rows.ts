/**
 * The daemon's SDK records, shaped into the rows the browser has always
 * received (the shapes the CLI's `--json` listings used to produce), so the
 * UI is unaffected by the transport. Pure and unit tested.
 */
import { homedir } from "node:os";
import type {
  PaseoAgent,
  PaseoAgentListResult,
  PaseoProject,
  PaseoProviderModelsResult,
  PaseoProviderSnapshotResult,
  PaseoWorkspace,
} from "@getpaseo/client";
import { prFromRuntime } from "./links";

/**
 * The SDK's records as read here: any field may be missing (older daemons,
 * partial updates), so every read is guarded.
 */
type Loose<T> = Partial<T> | null | undefined;
type Placement = Loose<PaseoAgentListResult["entries"][number]["project"]>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
/** "default" and blanks mean "no explicit model", as the CLI treats them. */
function modelId(value: unknown) {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return !v || v.toLowerCase() === "default" ? null : v;
}

/** "13 minutes ago", as `paseo ls` reports it. */
export function relativeTime(iso: unknown, now = Date.now()) {
  const then = Date.parse(str(iso));
  if (!Number.isFinite(then)) return "";
  const s = Math.floor((now - then) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} minutes ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

/** `~/…` paths from older listings, expanded against this machine's home. */
export const normalizePath = (path: string) =>
  path.replace(/^~\//, homedir() + "/");

/**
 * One agent's row. `placement` is the directory entry's project placement
 * (absent on some updates); `created` is left to whoever renders it, since a
 * relative time goes stale while the row doesn't.
 */
export function agentRow(agent: Loose<PaseoAgent>, placement?: Placement) {
  const model =
    modelId(agent?.runtimeInfo?.model) ?? modelId(agent?.model) ?? null;
  const provider = str(agent?.provider);
  const id = str(agent?.id);
  const branch = placement?.checkout?.currentBranch;
  return {
    id,
    shortId: id.slice(0, 7),
    name: typeof agent?.title === "string" && agent.title ? agent.title : "-",
    provider: model ? `${provider}/${model}` : provider,
    thinking: agent?.effectiveThinkingOptionId ?? "auto",
    status: str(agent?.status),
    cwd: str(agent?.cwd),
    createdAt: str(agent?.createdAt),
    // The daemon's activity times, for ordering by recent activity.
    ...(str(agent?.updatedAt) ? { updatedAt: str(agent?.updatedAt) } : {}),
    lastUserMessageAt: str(agent?.lastUserMessageAt) || null,
    attentionTimestamp: str(agent?.attentionTimestamp) || null,
    ...(agent?.workspaceId ? { workspaceId: String(agent.workspaceId) } : {}),
    ...(typeof branch === "string" && branch ? { branch } : {}),
    ...(agent?.archivedAt ? { archived: true } : {}),
  };
}

export function workspaceRow(w: Loose<PaseoWorkspace>) {
  const branch =
    w?.gitRuntime?.currentBranch ?? w?.project?.checkout?.currentBranch;
  // Its PR as Paseo reports it (null: none); left out when Paseo can't tell.
  const pr = prFromRuntime(w?.githubRuntime);
  return {
    workspaceId: str(w?.id),
    projectId: str(w?.projectId),
    project: str(w?.projectDisplayName),
    // As the Paseo app names a workspace: its title, else its name.
    name: str(w?.title) || str(w?.name),
    isolation: w?.workspaceKind === "worktree" ? "worktree" : "local",
    cwd: str(w?.workspaceDirectory ?? w?.projectRootPath),
    background: w?.background === true,
    branch: typeof branch === "string" ? branch : "",
    // Its Paseo labels, by name (colours are in the host's label catalog).
    ...(Array.isArray(w?.labels) && w.labels.length
      ? { labels: w.labels.filter((l: unknown) => typeof l === "string") }
      : {}),
    ...(pr !== undefined ? { pr } : {}),
    ...(str(w?.createdAt) ? { createdAt: str(w?.createdAt) } : {}),
  };
}

export function projectRow(p: Loose<PaseoProject>) {
  return {
    projectId: str(p?.projectId),
    name: str(p?.projectDisplayName),
    kind: str(p?.projectKind),
    path: str(p?.projectRootPath),
  };
}

/**
 * Which registered project an agent belongs to: its workspace's project,
 * else the daemon's placement (its key is the project id), else a project
 * rooted at its checkout or main repository.
 */
export function placeAgent(
  row: ReturnType<typeof agentRow>,
  placement: Placement,
  projects: { projectId: string; path: string }[],
  workspaces: { workspaceId: string; projectId: string }[],
) {
  const known = (id: unknown) =>
    typeof id === "string" && projects.some((p) => p.projectId === id)
      ? id
      : undefined;
  const ws = row.workspaceId
    ? workspaces.find((w) => w.workspaceId === row.workspaceId)
    : undefined;
  const roots = [
    row.cwd,
    placement?.checkout?.mainRepoRoot,
    placement?.checkout?.worktreeRoot,
  ].filter((p): p is string => typeof p === "string" && Boolean(p));
  return (
    known(ws?.projectId) ??
    known(placement?.projectKey) ??
    projects.find((p) => p.path && roots.includes(p.path))?.projectId
  );
}

/** `permit ls`: every pending request of every agent. */
export function permissionRows(agents: Loose<PaseoAgent>[]) {
  const out: {
    id: string;
    agentId: string;
    agentShortId: string;
    name: string;
    description: string;
    /** The daemon's request kind: "question" asks for answers, not approval. */
    kind: string;
  }[] = [];
  for (const a of agents)
    for (const p of Array.isArray(a?.pendingPermissions)
      ? a.pendingPermissions
      : [])
      if (p && typeof p.id === "string")
        out.push({
          id: p.id,
          agentId: str(a?.id),
          agentShortId: str(a?.id).slice(0, 7),
          name: str(p.name) || str(p.title) || "Permission request",
          description: str(p.description) || "-",
          kind: str((p as { kind?: unknown }).kind) || "tool",
        });
  return out;
}

/** `provider ls`. */
export function providerRows(snapshot: Loose<PaseoProviderSnapshotResult>) {
  return (Array.isArray(snapshot?.entries) ? snapshot.entries : []).map(
    (e) => ({
      provider: str(e?.provider),
      label: str(e?.label) || str(e?.provider),
      status: e?.status === "ready" ? "available" : str(e?.status),
      enabled: e?.enabled ? "Enabled" : "Disabled",
      defaultMode: str(e?.defaultModeId) || "default",
      modes: (Array.isArray(e?.modes) ? e.modes : [])
        .map((m) => str(m?.label))
        .join(", "),
    }),
  );
}

/** `provider models <provider>`. */
export function modelRows(result: Loose<PaseoProviderModelsResult>) {
  if (result?.error) throw new Error(String(result.error));
  return (Array.isArray(result?.models) ? result.models : []).map((m) => ({
    model: str(m?.label),
    id: str(m?.id),
    description: str(m?.description),
    thinkingOptionIds: (Array.isArray(m?.thinkingOptions)
      ? m.thinkingOptions
      : []
    ).map((o) => str(o?.id)),
    defaultThinkingOptionId: m?.defaultThinkingOptionId ?? null,
  }));
}

/** `inspect <id>`: everything it reported comes from the live record. */
export function inspectOf(agent: Loose<PaseoAgent>) {
  if (!agent) return null;
  const usage = agent.lastUsage;
  return {
    Id: agent.id,
    Name: agent.title ?? "-",
    Provider: agent.provider,
    Model: modelId(agent.runtimeInfo?.model) ?? modelId(agent.model) ?? "-",
    Thinking: agent.effectiveThinkingOptionId ?? "auto",
    Status: agent.status,
    Archived: agent.archivedAt != null,
    ArchivedAt: agent.archivedAt ?? null,
    Mode: agent.currentModeId ?? "default",
    Cwd: agent.cwd,
    CreatedAt: agent.createdAt,
    UpdatedAt: agent.updatedAt,
    LastUsage: usage
      ? {
          InputTokens: usage.inputTokens ?? 0,
          OutputTokens: usage.outputTokens ?? 0,
          CachedTokens: usage.cachedInputTokens ?? 0,
          CostUsd: usage.totalCostUsd ?? 0,
        }
      : null,
    AvailableModes: Array.isArray(agent.availableModes)
      ? agent.availableModes.map((m) => ({ id: m.id, label: m.label }))
      : null,
    PendingPermissions: (agent.pendingPermissions ?? []).map((p) => ({
      id: p.id,
      name: p.name ?? "unknown",
    })),
    Worktree: agent.labels?.["paseo.worktree"] ?? null,
    ParentAgentId: agent.labels?.["paseo.parent-agent-id"] ?? null,
  };
}

/** The `--provider claude/opus` shorthand, as `paseo run` resolves it. */
export function providerAndModel(provider: string, model?: string) {
  const slash = provider.indexOf("/");
  if (slash === -1) return { provider, model };
  const p = provider.slice(0, slash),
    m = provider.slice(slash + 1);
  if (!p || !m) throw new Error("Invalid provider");
  if (model && model !== m) throw new Error("Conflicting model values");
  return { provider: p, model: m };
}
