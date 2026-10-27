import { projectKey, workspaceKey } from "./workspaces";
import { hostText, placeText } from "./names";
import type { Agent, Project, Workspace } from "./types";
import { isArchived, isFailed, isWorking } from "./types";

export type Filter = "all" | "attention" | "unread" | "running" | "idle";
export type GroupBy = "project" | "host" | "status" | "workspace" | "none";
export type OrderBy = "attention" | "recent" | "created" | "name" | "status";
export type FleetView = { group: GroupBy; order: OrderBy };
export const DEFAULT_VIEW: FleetView = { group: "project", order: "attention" };

export const GROUPS: readonly (readonly [GroupBy, string])[] = [
  ["project", "Project"],
  ["host", "Host"],
  ["status", "Status"],
  ["workspace", "Workspace / branch"],
  ["none", "None"],
];
export const ORDERS: readonly (readonly [OrderBy, string])[] = [
  ["attention", "Needs you first"],
  ["recent", "Recent activity"],
  ["created", "Newest first"],
  ["name", "Name"],
  ["status", "Status"],
];

export function sanitizeView(value: unknown): FleetView {
  const v = (value ?? {}) as Partial<FleetView>;
  return {
    group: GROUPS.some(([g]) => g === v.group) ? v.group! : DEFAULT_VIEW.group,
    order: ORDERS.some(([o]) => o === v.order) ? v.order! : DEFAULT_VIEW.order,
  };
}

export type AgentGroup = {
  /** Unique across hosts and grouping modes (also the collapse key). */
  key: string;
  label: string;
  /** Secondary text, e.g. the project a branch belongs to. */
  detail?: string;
  /** Host shown beside the label ("local" for this machine's daemon). */
  host?: string;
  /** What the title selects, if anything (host-qualified keys). */
  select?: { type: "project" | "workspace"; id: string };
  /** Where "+" dispatches to (host-qualified keys). */
  dispatch?: { projectId?: string; workspaceId?: string };
  /** Status groups: the tone of their dot. */
  tone?: "amber" | "unread" | "red" | "green" | "slate";
  agents: Agent[];
};

/** The fleet as listed: J/K and N walk this same order. */
export type FleetList = {
  /** Pinned "Needs you" rows (only when ordering needs-you first). */
  attention: Agent[];
  /** Pinned "Unread" rows, below them (only when ordering needs-you first). */
  unread: Agent[];
  groups: AgentGroup[];
};

export const ATTENTION_GROUP = "attention";
export const UNREAD_GROUP = "unread";

export function needsAttention(a: Agent, permissionAgents: Set<string>) {
  // Only a question for you: an approval, plan or open question. Finished and
  // failed agents are idle. A listed subagent never counts (as in the Paseo
  // app); its row still shows any approval it waits on.
  if (a.child) return false;
  return permissionAgents.has(a.id);
}

/**
 * The agents with a reply you haven't read. The daemon's flag decides where
 * the daemon reports one (`Agent.unread`), so reading in this app or the
 * Paseo app clears it in both; otherwise this app's own record of finishes
 * and reads (`local`) does. The agent being viewed is being read, and one
 * whose flag was just cleared here (`cleared`: its attention time then)
 * stays read until the daemon reports a later finish. Listed subagents,
 * failed agents and working ones never count.
 */
export function unreadAgents(
  agents: Agent[],
  local: Set<string>,
  viewing?: string,
  cleared: Record<string, string | null> = {},
) {
  const out = new Set<string>();
  for (const a of agents) {
    // A failure is its own state (Failed), whether or not it was seen.
    if (
      a.child ||
      a.id === viewing ||
      isArchived(a) ||
      isFailed(a.status) ||
      isWorking(a)
    )
      continue;
    if (typeof a.unread === "boolean") {
      if (
        a.unread &&
        !(
          Object.hasOwn(cleared, a.id) &&
          cleared[a.id] === (a.attentionTimestamp ?? null)
        )
      )
        out.add(a.id);
    } else if (local.has(a.id)) out.add(a.id);
  }
  return out;
}

/** Whether an agent reads as Unread: in the set, and not a listed subagent
 *  or one working on a later turn. */
export const isUnreadIn = (a: Agent, unread: Set<string>) =>
  unread.has(a.id) && !a.child && !isWorking(a);

const UNITS: Record<string, number> = {
  second: 1e3,
  minute: 6e4,
  hour: 36e5,
  day: 864e5,
  week: 6048e5,
  month: 2592e6,
  year: 31536e6,
};
/** When an agent was created: Paseo lists say "13 minutes ago"; ISO dates
 *  also work. Unknown is -Infinity (oldest). */
export function createdAt(text: string, now = Date.now()): number {
  const t = text?.trim().toLowerCase() ?? "";
  if (/^(just now|now|a few seconds ago)$/.test(t)) return now;
  const m =
    /^(\d+|an?)\s+(second|minute|hour|day|week|month|year)s?(?: ago)?$/.exec(t);
  if (m) return now - (/^\d/.test(m[1]) ? Number(m[1]) : 1) * UNITS[m[2]];
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

const time = (v: string | null | undefined) => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
};
/** Creation: the daemon's time, else the list's relative text. */
export const bornAt = (a: Agent, now = Date.now()) =>
  a.createdAt ? time(a.createdAt) : createdAt(a.created, now);
/**
 * An agent's last activity, from the daemon's own record: its last update,
 * last prompt or last attention (finish, failure, request), whichever is
 * latest, or a finish this app saw; failing all of those, its creation.
 * Running agents are ordered as active now (see agentOrder).
 */
export function lastActive(
  a: Agent,
  finishedAt: Record<string, number> = {},
  now = Date.now(),
) {
  const t = Math.max(
    time(a.updatedAt),
    time(a.lastUserMessageAt),
    time(a.attentionTimestamp),
    finishedAt[a.id] ?? -Infinity,
  );
  return t > -Infinity ? t : bornAt(a, now);
}

type Context = {
  permissionAgents: Set<string>;
  unread: Set<string>;
  finishedAt: Record<string, number>;
  projectOf: (a: Agent) => Project | undefined;
  workspaceOf: (a: Agent) => Workspace | undefined;
  /** Registered workspaces (host-qualified keys); others are synthetic, made
   *  for a project's checkout, and dispatch to the project. */
  realWorkspaces?: Set<string>;
  now?: number;
};

/** Approvals and questions, then unread replies, failures, running, idle, archived. */
export function attentionRank(
  a: Agent,
  { permissionAgents, unread }: Pick<Context, "permissionAgents" | "unread">,
) {
  return permissionAgents.has(a.id) && !a.child
    ? 0
    : isUnreadIn(a, unread)
      ? 1
      : isFailed(a.status)
        ? 2
        : isWorking(a)
          ? 3
          : isArchived(a)
            ? 5
            : 4;
}

const names = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Compares agents for an ordering; ties fall back to recency, then name, then ID. */
export function agentOrder(order: OrderBy, ctx: Context) {
  const now = ctx.now ?? Date.now();
  const created = new Map<string, number>();
  const born = (a: Agent) => {
    let v = created.get(a.id);
    if (v === undefined) created.set(a.id, (v = bornAt(a, now)));
    return v;
  };
  const active = (a: Agent) =>
    isWorking(a) ? now : lastActive(a, ctx.finishedAt, now);
  const rank = (a: Agent) => attentionRank(a, ctx);
  const byName = (a: Agent, b: Agent) =>
    names.compare(a.title || a.name, b.title || b.name) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const byRecent = (a: Agent, b: Agent) =>
    active(b) - active(a) || byName(a, b);
  switch (order) {
    case "attention":
    case "status":
      // "Status" lists every state in order; "needs you first" also pins them.
      return (a: Agent, b: Agent) => rank(a) - rank(b) || byRecent(a, b);
    case "recent":
      return byRecent;
    case "created":
      return (a: Agent, b: Agent) => born(b) - born(a) || byName(a, b);
    case "name":
      return byName;
  }
}

/** Status groups, in the order they are listed. */
const STATUS_GROUPS = [
  { key: "needs-you", label: "Needs you", tone: "amber" },
  { key: "unread", label: "Unread", tone: "unread" },
  { key: "failed", label: "Failed", tone: "red" },
  { key: "running", label: "Running", tone: "green" },
  { key: "idle", label: "Idle", tone: "slate" },
] as const;
const statusGroup = (a: Agent, ctx: Context) =>
  needsAttention(a, ctx.permissionAgents)
    ? 0
    : isUnreadIn(a, ctx.unread)
      ? 1
      : isFailed(a.status)
        ? 2
        : isWorking(a)
          ? 3
          : 4;

// Labels never show IDs (a host without a label has only its server ID).
const hostName = (a: { host?: string; hostLabel?: string }) =>
  a.host ? hostText(a) : "local";

function groupOf(
  a: Agent,
  view: FleetView,
  ctx: Context,
): Omit<AgentGroup, "agents"> {
  switch (view.group) {
    case "none":
      return { key: "all", label: "" };
    case "status": {
      const s = STATUS_GROUPS[statusGroup(a, ctx)];
      return { key: `status:${s.key}`, label: s.label, tone: s.tone };
    }
    case "host":
      return { key: `host:${a.host || ""}`, label: hostName(a) };
    case "workspace": {
      const ws = ctx.workspaceOf(a);
      const p = ctx.projectOf(a);
      if (!ws)
        return {
          key: `workspace:none:${a.host || ""}`,
          label: "Outside any workspace",
          host: hostName(a),
        };
      return {
        key: `workspace:${workspaceKey(ws)}`,
        label: placeText(ws.name || ws.branch, "Workspace"),
        detail: placeText(ws.project),
        host: hostName(a),
        select: { type: "workspace", id: workspaceKey(ws) },
        dispatch: ctx.realWorkspaces?.has(workspaceKey(ws))
          ? { workspaceId: workspaceKey(ws) }
          : p
            ? { projectId: projectKey(p) }
            : undefined,
      };
    }
    case "project": {
      const p = ctx.projectOf(a);
      if (!p)
        return {
          key: `project:none:${a.host || ""}`,
          label: "Other directories",
          host: hostName(a),
        };
      return {
        key: `project:${projectKey(p)}`,
        label: placeText(p.name, "Project"),
        host: hostName(p),
        select: { type: "project", id: projectKey(p) },
        dispatch: { projectId: projectKey(p) },
      };
    }
  }
}

/** Agents filtered, ordered and grouped as the fleet lists them. */
export function groupAgents({
  agents,
  filter,
  search,
  view = DEFAULT_VIEW,
  collapsed = new Set<string>(),
  ...ctx
}: Context & {
  agents: Agent[];
  filter: Filter;
  search: string;
  view?: FleetView;
  collapsed?: Set<string>;
}): FleetList & {
  /** The listed agents in order, skipping collapsed groups. */
  order: Agent[];
} {
  const { permissionAgents, unread, projectOf, workspaceOf } = ctx;
  const isUnread = (a: Agent) =>
    isUnreadIn(a, unread) && !needsAttention(a, permissionAgents);
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (a: Agent) => {
    if (!terms.length) return true;
    const ws = workspaceOf(a);
    const hay =
      `${a.title || ""} ${a.name} ${a.shortId} ${a.provider} ${a.cwd} ${a.status} ${hostName(a)} ${ws?.branch || ""} ${ws?.name || ""} ${projectOf(a)?.name || ""}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  };
  const pool = agents.filter((a) => {
    if (!matches(a)) return false;
    const closed = isArchived(a);
    if (closed) return false;
    if (filter === "attention") return needsAttention(a, permissionAgents);
    if (filter === "unread") return isUnread(a);
    if (filter === "running") return isWorking(a);
    if (filter === "idle")
      return (
        !isWorking(a) && !isUnread(a) && !needsAttention(a, permissionAgents)
      );
    return true;
  });
  const compare = agentOrder(view.order, ctx);
  pool.sort(compare);
  // Needs-you-first pins them, then unread replies, above the groups
  // (status groups have their own).
  const pinned =
    view.order === "attention" &&
    view.group !== "status" &&
    (filter === "all" || filter === "attention" || filter === "unread");
  const attention = pinned
    ? pool.filter((a) => needsAttention(a, permissionAgents))
    : [];
  const unreadRows = pinned ? pool.filter(isUnread) : [];
  const rest = pinned
    ? pool.filter((a) => !attention.includes(a) && !unreadRows.includes(a))
    : pool;
  // Every matching agent is listed; nothing is capped.
  const groups = new Map<string, AgentGroup>();
  for (const a of rest) {
    const g = groupOf(a, view, ctx);
    if (!groups.has(g.key)) groups.set(g.key, { ...g, agents: [] });
    groups.get(g.key)!.agents.push(a);
  }
  const sorted = [...groups.values()];
  const leftover = (g: AgentGroup) => Number(/:none:/.test(g.key));
  sorted.sort((a, b) => {
    if (view.group === "status")
      return (
        STATUS_GROUPS.findIndex((s) => `status:${s.key}` === a.key) -
        STATUS_GROUPS.findIndex((s) => `status:${s.key}` === b.key)
      );
    return (
      leftover(a) - leftover(b) ||
      (view.order === "name"
        ? names.compare(a.label, b.label) ||
          names.compare(a.host || "", b.host || "")
        : // Each group sits where its first agent would in a flat list.
          compare(a.agents[0], b.agents[0])) ||
      (a.key < b.key ? -1 : 1)
    );
  });
  // The same repository on several hosts is listed together, from where its
  // first group falls, so the copies read as one project in several places.
  if (view.group === "project") {
    const clustered: AgentGroup[] = [];
    for (const g of sorted)
      if (!clustered.includes(g))
        clustered.push(
          g,
          ...sorted.filter(
            (t) => t !== g && g.select && t.select && t.label === g.label,
          ),
        );
    sorted.splice(0, sorted.length, ...clustered);
  }
  const order = [
    ...(collapsed.has(ATTENTION_GROUP) ? [] : attention),
    ...(collapsed.has(UNREAD_GROUP) ? [] : unreadRows),
    ...sorted.flatMap((g) => (collapsed.has(g.key) ? [] : g.agents)),
  ];
  return { attention, unread: unreadRows, groups: sorted, order };
}

/**
 * The group labels need their host when the list spans hosts: the same
 * repository on two machines is two groups, and would otherwise read as a
 * duplicate.
 */
export const showHosts = (groups: AgentGroup[]) =>
  new Set(groups.filter((g) => g.host).map((g) => g.host)).size > 1;

/**
 * N: the next agent needing you after the selection, in the listed order;
 * those the list doesn't show (filtered, searched or collapsed away) follow,
 * most urgent first.
 */
export function nextNeedingYou(
  listed: Agent[],
  needing: Agent[],
  selected: string | undefined,
  rank: (a: Agent) => number,
): Agent | undefined {
  const need = new Set(needing.map((a) => a.id));
  const seen = new Set<string>();
  const cycle = [
    ...listed.filter((a) => need.has(a.id)),
    ...[...needing].sort((a, b) => rank(a) - rank(b)),
  ].filter((a) => !seen.has(a.id) && seen.add(a.id));
  if (!cycle.length) return undefined;
  const at = cycle.findIndex((a) => a.id === selected);
  const next = cycle[(at + 1) % cycle.length];
  return next.id === selected ? undefined : next;
}
