import type { AgentRecord as LiveAgentRecord } from "../live/client";
import type { PaseoAgent } from "@getpaseo/client";
import {
  attentionFields,
  changesWindow,
  shapePermissions,
  timelineWindow,
} from "../daemon";
import { forget, remember, rememberPage, scopeOf } from "../fleet";
import {
  MISSING_CWD,
  archivedAgent,
  feedOf,
  missingCwd,
  watchOf,
  type SessionSource,
} from "../live";
import { inspectOf } from "../rows";
import { messageOf } from "../errors";
import {
  HostOffline,
  hostKey,
  resolveHost,
  sdk,
  timed,
  type DaemonClient,
  type Remote,
} from "./hosts";
import { query } from "./validate";
import { rememberTimelineImages } from "../attachment";

/**
 * The daemon's record of an agent: read from the SDK, or as the host's feed
 * last had it pushed (where any field may be missing).
 */
export type AgentRecord = LiveAgentRecord & {
  featureValues?: Record<string, unknown>;
};
/** An issue or pull request from a GitHub search (the SDK leaves them untyped). */
type GitHubItem = {
  kind?: unknown;
  number?: unknown;
  title?: unknown;
  url?: unknown;
  state?: unknown;
  body?: unknown;
  baseRefName?: unknown;
  headRefName?: unknown;
};

/**
 * The daemon's live record of an agent: the host's feed has it pushed;
 * otherwise a socket read (a few ms), briefly shared so the session
 * header, composer config and @file search cost one call. File and GitHub
 * searches use its cwd, never a client path.
 */
export function agentSnapshot(
  client: DaemonClient,
  agentId: string,
  host?: Remote,
): Promise<AgentRecord> {
  const feed = feedOf(hostKey(host));
  const pushed = feed?.state === "live" ? feed.agent(agentId) : undefined;
  if (feed?.excluded(agentId))
    return Promise.reject(
      Object.assign(new Error("Archived agents are excluded."), {
        refused: true,
      }),
    );
  if (pushed) return Promise.resolve(pushed);
  return remember(`${scopeOf(host?.target)}|agent:${agentId}`, 1000, () =>
    timed(client.fetchAgent(agentId), undefined, client).then((r) => {
      if (!r?.agent) throw new Error("Agent not found");
      if (archivedAgent(r.agent))
        throw Object.assign(new Error("Archived agents are excluded."), {
          refused: true,
        });
      return r.agent;
    }),
  );
}
/** The timeline epoch last read per agent (scope|agent). */
const epochs = new Map<string, string>();
export function resetEpochs() {
  epochs.clear();
}
export async function agentGet(
  action: string,
  agentId: string,
  host: Remote | undefined,
  url: URL,
) {
  const client = await sdk(host);
  const scope = scopeOf(host?.target);
  await agentSnapshot(client, agentId, host);
  switch (action) {
    case "timeline": {
      const raw = url.searchParams.get("limit") ?? "300";
      if (!/^\d{1,3}$/.test(raw) || +raw < 1 || +raw > 600)
        throw new Error("Invalid limit");
      // Older pages: before an item (its sequence) in the epoch it came
      // from. Change pages: every entry changed after a sequence.
      const before = url.searchParams.get("before");
      const after = url.searchParams.get("after");
      const until = url.searchParams.get("until");
      if (
        until !== null &&
        (after === null || !/^\d{1,12}$/.test(until) || +until <= +after)
      )
        throw new Error("Invalid timeline cursor");
      const epoch = url.searchParams.get("epoch");
      const seq = before ?? after;
      if (
        (seq !== null || epoch !== null) &&
        (!seq ||
          (before !== null && after !== null) ||
          !/^\d{1,12}$/.test(seq) ||
          !epoch ||
          epoch.length > 200 ||
          epoch.includes("\0"))
      )
        throw new Error("Invalid timeline cursor");
      const page: {
        direction: "before" | "after" | "tail";
        cursor?: { epoch: string; seq: number };
      } = seq
        ? {
            direction: before ? "before" : "after",
            cursor: { epoch: epoch!, seq: Number(seq) },
          }
        : { direction: "tail" };
      // Shared by overlapping reads (several tabs, a refresh after a
      // command). Pages and change pages are kept a little longer, so tabs
      // repairing the same session share the daemon's reads; every answer
      // says when it was read (`asOf`), so the browser never takes a late
      // one as more current than it is. Commands and epoch changes forget
      // them.
      const key = `${scope}|timeline:${agentId}:${raw}${seq ? `:${epoch}:${page.direction}:${seq}${until ? `:${until}` : ""}` : ""}`;
      const load = async () => {
        let t;
        try {
          t = await timed(
            client.fetchAgentTimeline(agentId, {
              ...page,
              limit: +raw,
              projection: "canonical",
            }),
            undefined,
            client,
          );
        } catch (error) {
          // The SDK throws the daemon's error. A deleted worktree is an
          // expected state, not a failure; anything else is (redacted).
          if (missingCwd(error))
            return { items: [], hasOlder: false, unavailable: MISSING_CWD };
          throw error;
        }
        // Any read that sees a new epoch drops the old one's cached pages.
        if (typeof t?.epoch === "string") {
          const id = `${scope}|${agentId}`;
          const was = epochs.get(id);
          epochs.set(id, t.epoch);
          if (was !== undefined && was !== t.epoch)
            forget(host?.target, [`timeline:${agentId}:`]);
        }
        // The newest rows within the byte budget, the daemon range they
        // certify, and whether the daemon answered another epoch's tail
        // (a stale cursor): the browser then replaces, never merges.
        if (after) {
          const win = changesWindow(
            t,
            Number(after),
            until ? Number(until) : Infinity,
          );
          rememberTimelineImages(win.items, !host);
          return win;
        }
        const { page: _page, pageFrom: _pageFrom, ...win } = timelineWindow(t);
        rememberTimelineImages(win.items, !host);
        return win;
      };
      return seq ? rememberPage(key, load) : remember(key, 1000, load);
    }
    case "commands":
      return remember(`${scope}|commands:${agentId}`, 60000, () =>
        timed(client.listCommands(agentId), undefined, client).then((r) => ({
          error: r.error ?? null,
          commands: (Array.isArray(r.commands) ? r.commands : []).map((c) => ({
            name: String(c.name),
            description: String(c.description || ""),
            argumentHint: String(c.argumentHint || ""),
            kind: c.kind === "skill" ? "skill" : "command",
          })),
        })),
      );
    case "config": {
      const agent = await agentSnapshot(client, agentId, host);
      // Daemons always report an agent's provider and cwd; only the pushed
      // record's type leaves them optional.
      const draft = {
        provider: agent.provider!,
        cwd: agent.cwd!,
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.runtimeInfo?.modeId
          ? { modeId: agent.runtimeInfo.modeId }
          : {}),
        ...(agent.thinkingOptionId
          ? { thinkingOptionId: agent.thinkingOptionId }
          : {}),
        ...(agent.featureValues ? { featureValues: agent.featureValues } : {}),
      };
      const features = await timed(client.listProviderFeatures(draft))
        .then((r) => (Array.isArray(r.features) ? r.features : []))
        .catch(() => []);
      return {
        provider: agent.provider,
        model: agent.model ?? agent.runtimeInfo?.model ?? null,
        thinking:
          agent.effectiveThinkingOptionId ?? agent.thinkingOptionId ?? null,
        mode: agent.runtimeInfo?.modeId ?? null,
        status: agent.status,
        features,
        featureValues: agent.featureValues ?? {},
      };
    }
    case "files": {
      const agent = await agentSnapshot(client, agentId, host);
      const r = await timed(
        client.getDirectorySuggestions({
          cwd: agent.cwd,
          query: query(url),
          includeFiles: true,
          includeDirectories: true,
          limit: 20,
        }),
      );
      return {
        entries: (r.entries || []).map((e) => ({
          path: String(e.path),
          kind: e.kind,
        })),
        error: r.error ?? null,
      };
    }
    case "github": {
      const agent = await agentSnapshot(client, agentId, host);
      const r = await timed(
        client.searchGitHub({
          cwd: agent.cwd!,
          query: query(url),
          limit: 15,
        }),
      );
      return {
        items: ((r.items || []) as GitHubItem[]).map((i) => ({
          kind: i.kind === "pr" ? "pr" : "issue",
          number: i.number,
          title: i.title,
          url: i.url,
          state: i.state,
          body: typeof i.body === "string" ? i.body.slice(0, 60000) : null,
          baseRefName: i.baseRefName ?? null,
          headRefName: i.headRefName ?? null,
        })),
        error: r.error ?? null,
      };
    }
  }
  return undefined;
}

/** What the session header reads from a live record (pushed, or read over the socket). */
export interface LiveAgent {
  id?: string;
  title?: string | null;
  provider?: string;
  cwd?: string;
  model?: string | null;
  runtimeInfo?: { model?: string | null; modeId?: string | null };
  thinkingOptionId?: string | null;
  effectiveThinkingOptionId?: string | null;
  status?: string;
  archivedAt?: string | null;
  currentModeId?: string | null;
  availableModes?: unknown;
  pendingPermissions?: unknown;
  labels?: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
  lastUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalCostUsd?: number;
  };
  lastUserMessageAt?: string | null;
  attentionTimestamp?: string | null;
}
/** A pending request as an older header copy describes it. */
type HeldPermission = {
  id?: unknown;
  requestId?: unknown;
  request_id?: unknown;
  name?: unknown;
  toolName?: unknown;
  tool_name?: unknown;
  description?: unknown;
  message?: unknown;
};
/** A header built before (`inspectOf`, or a copy held by the browser). */
export type AgentHeader = {
  Id?: unknown;
  Name?: unknown;
  Provider?: unknown;
  Model?: unknown;
  Thinking?: unknown;
  Status?: unknown;
  Archived?: unknown;
  ArchivedAt?: unknown;
  Mode?: unknown;
  AvailableModes?: unknown;
  ParentAgentId?: unknown;
  Cwd?: unknown;
  CreatedAt?: unknown;
  UpdatedAt?: unknown;
  Worktree?: unknown;
  LastUsage?: {
    InputTokens?: unknown;
    OutputTokens?: unknown;
    CachedTokens?: unknown;
    CostUsd?: unknown;
  } | null;
  PendingPermissions?: HeldPermission[];
};
const isMode = (m: unknown): m is { id: string; label?: unknown } =>
  Boolean(m) && typeof (m as { id?: unknown }).id === "string";
/**
 * The session header's agent record, all from the daemon's live record
 * (pushed by the feed, or read over the socket).
 */
export function agentDetail(
  d: AgentHeader | null | undefined,
  live: LiveAgent | null | undefined,
) {
  d ??= {};
  const modes: unknown[] = Array.isArray(live?.availableModes)
    ? live.availableModes
    : Array.isArray(d.AvailableModes)
      ? d.AvailableModes
      : [];
  const usage = live?.lastUsage;
  return {
    Id: live?.id ?? d.Id,
    Name: live?.title ?? d.Name,
    Provider: live?.provider ?? d.Provider,
    Model: live?.model ?? live?.runtimeInfo?.model ?? d.Model,
    Thinking:
      live?.effectiveThinkingOptionId ?? live?.thinkingOptionId ?? d.Thinking,
    Status: live?.status ?? d.Status,
    Archived: live ? Boolean(live.archivedAt) : d.Archived,
    ArchivedAt: live ? (live.archivedAt ?? null) : d.ArchivedAt,
    Mode: live?.currentModeId ?? d.Mode,
    AvailableModes: modes.filter(isMode).map((m) => ({
      id: m.id,
      label: typeof m.label === "string" ? m.label : m.id,
    })),
    ParentAgentId:
      d.ParentAgentId ?? live?.labels?.["paseo.parent-agent-id"] ?? null,
    Cwd: d.Cwd ?? live?.cwd,
    CreatedAt: d.CreatedAt ?? live?.createdAt,
    UpdatedAt: live?.updatedAt ?? d.UpdatedAt,
    // Turn identity for attention: only the live record knows these. Absent
    // (undefined) means unknown, which differs from null (no follow-up yet).
    ...attentionFields(live),
    Worktree: d.Worktree ?? null,
    LastUsage: usage
      ? {
          InputTokens: usage.inputTokens ?? d.LastUsage?.InputTokens,
          OutputTokens: usage.outputTokens ?? d.LastUsage?.OutputTokens,
          CachedTokens: usage.cachedInputTokens ?? d.LastUsage?.CachedTokens,
          CostUsd: usage.totalCostUsd ?? d.LastUsage?.CostUsd,
        }
      : (d.LastUsage ?? null),
    // The daemon's own record describes pending permissions in detail.
    PendingPermissions: live
      ? shapePermissions(live.pendingPermissions)
      : (d.PendingPermissions || []).map((p) => ({
          id: p.id || p.requestId || p.request_id,
          name: p.name || p.toolName || p.tool_name || "Permission request",
          description: p.description || p.message || "",
        })),
  };
}
/** The header for a live record. */
// A pushed record's status is the daemon's own; inspectOf only copies it.
export const detailOf = (agent: LiveAgent) =>
  agentDetail(inspectOf(agent as Partial<PaseoAgent>), agent);
export async function agentDetailFor(agentId: string, host?: Remote) {
  const client = await sdk(host);
  return detailOf(await agentSnapshot(client, agentId, host));
}

/**
 * The session header and conversation for a host that may not be
 * contacted: what is held, marked stale, or an explicit unavailable answer.
 * Never a connection.
 */
export function heldSession(
  action: "detail" | "timeline",
  agentId: string,
  offline: HostOffline,
) {
  const key = offline.host.serverId;
  if (action === "detail") {
    const agent = feedOf(key)?.agent(agentId);
    if (!agent) throw offline;
    return { ...detailOf(agent), Stale: true };
  }
  const w = watchOf(`${key}|${agentId}`);
  const items = w ? w.order.map((id) => JSON.parse(w.items.get(id)!)) : [];
  return items.length
    ? {
        items,
        hasOlder: w!.hasOlder,
        from: w!.from,
        to: w!.to,
        stale: true,
        ...(w!.epoch ? { epoch: w!.epoch } : {}),
      }
    : { items: [], hasOlder: false, unavailable: offline.message };
}

/**
 * A session to watch. Its host is resolved again on every connection
 * attempt: it must still be registered, confirmed and online, and the
 * target is the one registered now. An unregistered host ends the watch.
 */
export function sessionSource(
  agentId: string,
  serverId?: string,
): SessionSource {
  const key = serverId ?? "local";
  let target: string | undefined;
  return {
    hostKey: key,
    agentId,
    resolve: async () => {
      let host: Remote | undefined;
      try {
        // Re-checks registration, confirmation and the contact policy.
        host = await resolveHost(serverId, "read");
      } catch (error) {
        if (/Unknown host/.test(String(messageOf(error))))
          throw Object.assign(new Error("This host is no longer registered."), {
            refused: true,
          });
        throw error;
      }
      target = host?.target;
      const client = await sdk(host);
      await agentSnapshot(client, agentId, host);
      return () => sdk(host);
    },
    detail: detailOf,
    epochChanged: () => forget(target, [`timeline:${agentId}:`]),
  };
}
