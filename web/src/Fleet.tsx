import { motion } from "framer-motion";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Archive,
  LoaderCircle,
  Bot,
  Box,
  Check,
  CheckCheck,
  ChevronDown,
  CloudOff,
  GitBranch,
  ListFilter,
  Pencil,
  Plus,
  Server,
  Trash2,
  X,
} from "lucide-react";
import { ago, compactAgo, readStore, writeStore } from "./api";
import { UsageCard } from "./UsageCard";
import type {
  Agent,
  Host,
  PendingPermission,
  Project,
  Selection,
  UsageReport,
  Workspace,
} from "./types";
import { UNREAD, isWorking, sameHost, shownStatus } from "./types";
import { Badge, ProviderIcon } from "./ui";
import { agentRenameTarget, requestRename } from "./renames";
import { projectKey, workspaceKey } from "./workspaces";
import { rovingKeyDown } from "./focus";
import { placePopover } from "./popover";
import {
  ATTENTION_GROUP,
  UNREAD_GROUP,
  DEFAULT_VIEW,
  GROUPS,
  ORDERS,
  hostOrder,
  projectOrder,
  workspaceOrder,
  needsAttention,
  sanitizeView,
  showHosts,
  type AgentGroup,
  type Filter,
  type FleetView,
} from "./fleetView";
import { agentName, hostText, pathText, placeText } from "./names";
import { hostWorldKey, nativeAvailable, postNative } from "./worldBridge";
import { soundEvent } from "./soundCues";

export type { Filter } from "./fleetView";
/** Rows rendered at a time (more as the list scrolls). */
const ROW_PAGE = 150;
export type Tab = "Agents" | "Workspaces" | "Projects" | "Hosts";
const TABS = ["Agents", "Workspaces", "Projects", "Hosts"] as const;
/** The `host` field items on this host carry ("" for the local daemon). */
const hostId = (h: Host) => (h.local ? "" : h.serverId);
const onHost = (item: { host?: string }, host: string | null) =>
  host === null || (item.host || "") === host;
const FILTER_HINTS: Record<Filter, string> = {
  all: "Active agents: everything not archived",
  attention:
    "Agents with a question for you: approvals, plans and open questions",
  unread: "Agents that finished with a reply you haven't read yet",
  running: "Agents working now, themselves or through a subagent",
  idle: "Agents not running with nothing new for you (idle or failed)",
};
const FILTERS = [
  ["all", "Active"],
  ["attention", "Needs you"],
  ["unread", "Unread"],
  ["running", "Running"],
  ["idle", "Idle"],
] as const;

/** How the agent list is grouped and ordered, and which groups are
 *  collapsed; remembered across reloads. */
export function useFleetView() {
  const [view, setViewState] = useState(() =>
    sanitizeView(readStore("fleet-view", null)),
  );
  const [collapsed, setCollapsedState] = useState(
    () =>
      new Set(
        readStore<unknown[]>("fleet-collapsed", []).filter(
          (k): k is string => typeof k === "string",
        ),
      ),
  );
  const setView = useCallback((next: FleetView) => {
    setViewState(next);
    writeStore("fleet-view", next);
  }, []);
  const setCollapsed = useCallback((keys: string[], value: boolean) => {
    setCollapsedState((current) => {
      const next = new Set(current);
      for (const k of keys) {
        if (value) next.add(k);
        else next.delete(k);
      }
      // Groups come and go (agents archived, projects removed): keep the newest.
      const kept = [...next].slice(-300);
      writeStore("fleet-collapsed", kept);
      return new Set(kept);
    });
  }, []);
  return { view, setView, collapsed, setCollapsed };
}
export type FleetViewState = ReturnType<typeof useFleetView>;

const viewSummary = (v: FleetView) =>
  `${v.group === "none" ? "Not grouped" : `Grouped by ${GROUPS.find(([g]) => g === v.group)![1].toLowerCase()}`}, ${ORDERS.find(([o]) => o === v.order)![1].toLowerCase()}`;

/** The "view options" popover: group by, order by, collapse all. */
function ViewOptions({
  state,
  groupKeys,
}: {
  state: FleetViewState;
  groupKeys: string[];
}) {
  const { view, setView, collapsed, setCollapsed } = state;
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!anchor.current?.contains(e.target as Node)) close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      close(true);
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    // Focus starts on the current grouping.
    menu.current
      ?.querySelector<HTMLElement>("[aria-checked=true]")
      ?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, close]);
  // Placed by the shared popover rules (popover.ts): towards the side with
  // more room, inside whatever clips it (the rail, the bottom sheet), capped
  // to that room and scrolling.
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    return placePopover(el);
  }, []);
  const anyCollapsed = groupKeys.some((k) => collapsed.has(k));
  const changed =
    view.group !== DEFAULT_VIEW.group || view.order !== DEFAULT_VIEW.order;
  const option = (
    checked: boolean,
    label: string,
    hint: string,
    onPick: () => void,
  ) => (
    <button
      key={label}
      role="menuitemradio"
      aria-checked={checked}
      aria-description={hint}
      tabIndex={-1}
      className={checked ? "checked" : ""}
      onClick={onPick}
    >
      <b>{label}</b>
      {checked && <Check size={13} aria-hidden="true" />}
    </button>
  );
  return (
    <span
      ref={anchor}
      className="menu-anchor view-anchor"
      onBlur={(e) => {
        // Tabbing out closes it.
        if (
          open &&
          e.relatedTarget &&
          !anchor.current?.contains(e.relatedTarget as Node)
        )
          close(false);
      }}
    >
      <button
        ref={trigger}
        className={`view-trigger ${changed ? "changed" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`View options: ${viewSummary(view)}`}
        data-tip={`View options — ${viewSummary(view)}`}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <ListFilter size={14} />
      </button>
      {open && (
        <div
          ref={placeMenu}
          id={id}
          role="menu"
          aria-label="View options"
          className="popover-menu right view-menu"
          onKeyDown={(e) => {
            if (e.key === "Tab" || e.key === "Escape") return;
            // Keys pressed in the menu are the menu's (not J/K/N/D shortcuts).
            e.stopPropagation();
            const all = [
              ...(menu.current?.querySelectorAll<HTMLElement>(
                "[role^=menuitem]",
              ) || []),
            ];
            const i = all.indexOf(document.activeElement as HTMLElement);
            const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: -1 }[
              e.key as "Home"
            ];
            if (to === undefined || !all.length) return;
            e.preventDefault();
            all[(to + all.length) % all.length].focus();
          }}
        >
          <p className="menu-label" id={`${id}-group`}>
            Group by
          </p>
          <div role="group" aria-labelledby={`${id}-group`}>
            {GROUPS.map(([g, label]) =>
              option(
                view.group === g,
                label,
                g === "none"
                  ? "List agents without groups"
                  : `Group agents by ${label.toLowerCase()}`,
                () => setView({ ...view, group: g }),
              ),
            )}
          </div>
          <hr />
          <p className="menu-label" id={`${id}-order`}>
            Order by
          </p>
          <div role="group" aria-labelledby={`${id}-order`}>
            {ORDERS.map(([o, label]) =>
              option(
                view.order === o,
                label,
                `Order agents: ${label.toLowerCase()}`,
                () => setView({ ...view, order: o }),
              ),
            )}
          </div>
          {groupKeys.length > 0 && (
            <>
              <hr />
              <button
                role="menuitem"
                tabIndex={-1}
                aria-description={
                  anyCollapsed
                    ? "Show every group's agents"
                    : "Hide every group's agents, keeping their headings"
                }
                onClick={() => {
                  setCollapsed(groupKeys, !anyCollapsed);
                  close(true);
                }}
              >
                <b>
                  {anyCollapsed ? "Expand all groups" : "Collapse all groups"}
                </b>
              </button>
            </>
          )}
        </div>
      )}
    </span>
  );
}

const hostState = (h: Host) =>
  h.state ?? (h.status === "online" ? "online" : "offline");
const STATE_TEXT = {
  online: "online",
  loading: "loading",
  slow: "slow to answer",
  stale: "not answering; showing last-known data",
  offline: "offline",
};
function hostTitle(h: Host) {
  const parts = [
    `${h.local ? placeText(h.label, "local") : hostText(h)} · ${STATE_TEXT[hostState(h)]}`,
  ];
  // Errors can quote IDs (hosts', requests'): not shown.
  if (h.error)
    parts.push(placeText(h.error, "The last request failed.", [h.serverId]));
  if (h.lastOkAt && hostState(h) !== "online")
    parts.push(`last answered ${ago(h.lastOkAt)}`);
  if (h.retryAt)
    parts.push(
      `retrying in ${Math.max(1, Math.round((h.retryAt - Date.now()) / 1000))}s`,
    );
  return parts.join("\n");
}

/** The panel header's tools: usage and the settings gear. */
export function FleetTools({
  usage,
  settings,
}: {
  usage: UsageReport[];
  /** The settings control (sounds, music, notifications), after usage. */
  settings?: ReactNode;
}) {
  return (
    <span className="panel-tools">
      {usage.length > 0 && <UsageCard reports={usage} />}
      {settings}
    </span>
  );
}

/** The fleet list's head: dispatching a new agent. */
export function FleetSummary({ onDispatch }: { onDispatch: () => void }) {
  return (
    <section className="fleet-summary" aria-label="Fleet status">
      <button
        className="primary dispatch-button summary-dispatch"
        onClick={onDispatch}
        aria-description="Dispatch a new agent (⌘N / D)"
      >
        <Plus size={15} aria-hidden="true" />
        Dispatch agent
      </button>
    </section>
  );
}

export function Fleet({
  hostFilter,
  setHostFilter,
  tab,
  setTab,
  filter,
  setFilter,
  attention: allAttention,
  unreadRows: allUnreadRows,
  groups: allGroups,
  workspaces: allWorkspaces,
  realWorkspaceIds,
  projects: allProjects,
  hosts,
  agents,
  agentsAt,
  permissions,
  permissionAgents,
  asking,
  unread,
  finishedAt,
  selection,
  select,
  onApprove,
  onMarkRead,
  onArchiveWorkspace,
  archiving = new Set<string>(),
  onRemoveProject,
  removingProjects = new Set<string>(),
  onDispatch,
  onAddProject,
  workspaceOf,
  projectOf,
  counts: allCounts,
  loading,
  online,
  busy,
  viewState,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  filter: Filter;
  setFilter: (f: Filter) => void;
  attention: Agent[];
  /** Pinned unread rows, listed below those needing you. */
  unreadRows: Agent[];
  groups: AgentGroup[];
  workspaces: Workspace[];
  realWorkspaceIds: Set<string>;
  projects: Project[];
  hosts: Host[];
  /** Active agents, for each host's count. */
  agents: Agent[];
  agentsAt: (workspaceId: string) => Agent[];
  permissions: PendingPermission[];
  /** Approvals, questions and replies waiting on you. */
  permissionAgents: Set<string>;
  /** Those whose last reply waits on you (no request pending). */
  asking: Set<string>;
  unread: Set<string>;
  finishedAt: Record<string, number>;
  selection: Selection;
  select: (s: Selection) => void;
  /** The host the lists are narrowed to ("" for local), shared with the map. */
  hostFilter: string | null;
  setHostFilter: (id: string | null) => void;

  onApprove: (p: PendingPermission, allow: boolean) => void;
  onMarkRead: (ids: string[]) => void;
  onArchiveWorkspace: (w: Workspace) => void;
  /** Workspaces (by key) being archived in the background. */
  archiving?: Set<string>;
  onRemoveProject: (p: Project) => void;
  /** Projects (by key) being removed in the background. */
  removingProjects?: Set<string>;
  onDispatch: (target?: { projectId?: string; workspaceId?: string }) => void;
  /** Open the Add project panel. */
  onAddProject: () => void;
  workspaceOf: (a: Agent) => Workspace | undefined;
  projectOf: (a: Agent) => Project | undefined;
  counts: Record<Filter, number>;
  loading: boolean;
  online: boolean;
  busy: boolean;
  viewState: FleetViewState;
}) {
  const { view, collapsed, setCollapsed } = viewState;
  const listId = useId();
  // Choosing a host in the Hosts tab (or on the map) narrows the other tabs to it.
  const filteredHost = hosts.find((h) => hostId(h) === hostFilter);
  useEffect(() => {
    if (hostFilter !== null && !filteredHost) setHostFilter(null);
  }, [hostFilter, filteredHost]);
  const attention = allAttention.filter((a) => onHost(a, hostFilter));
  const unreadRows = allUnreadRows.filter((a) => onHost(a, hostFilter));
  const groups =
    hostFilter === null
      ? allGroups
      : allGroups
          .map((g) => ({
            ...g,
            agents: g.agents.filter((a) => onHost(a, hostFilter)),
          }))
          .filter((g) => g.agents.length);
  const workspaces = allWorkspaces
    .filter((w) => onHost(w, hostFilter))
    .sort(workspaceOrder);
  const projects = allProjects
    .filter((p) => onHost(p, hostFilter))
    .sort(projectOrder);
  const counts = (() => {
    if (hostFilter === null) return allCounts;
    const here = agents.filter((a) => onHost(a, hostFilter));
    const running = here.filter((a) => isWorking(a)).length;
    const asks = (a: Agent) => needsAttention(a, permissionAgents);
    const fresh = (a: Agent) => unread.has(a.id) && !asks(a);
    return {
      all: here.length,
      attention: here.filter(asks).length,
      unread: here.filter(fresh).length,
      running,
      // Nothing new: not working, nothing to read or answer.
      idle: here.filter((a) => !isWorking(a) && !fresh(a) && !asks(a)).length,
    };
  })();
  const sortedHosts = [...hosts].sort(hostOrder);
  const chooseHost = (h: Host) => {
    const id = hostId(h);
    setHostFilter(hostFilter === id ? null : id);
    // Focus its island or galaxy region (a no-op outside the native app).
    if (nativeAvailable()) soundEvent("focused");
    postNative({
      type: "camera",
      command: {
        type: "focus",
        target: { kind: "host", key: hostWorldKey(h) },
      },
    });
  };
  // Every agent is listed, rendered a page at a time as the list is
  // scrolled (a thousand rows at once would stall the page); the selected
  // agent is always rendered.
  const all = [...attention, ...unreadRows, ...groups.flatMap((g) => g.agents)];
  const [rendered, setRendered] = useState(ROW_PAGE);
  const selectedAt =
    selection?.type === "agent"
      ? all.findIndex((a) => a.id === selection.id)
      : -1;
  const limit = Math.max(rendered, selectedAt + 1);
  let budget = limit;
  const take = (agents: Agent[]) => {
    const shown = agents.slice(0, Math.max(0, budget));
    budget -= agents.length;
    return shown;
  };
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = more.current;
    if (!el) return;
    const watch = new IntersectionObserver(
      (entries) =>
        entries.some((e) => e.isIntersecting) &&
        setRendered((n) => n + ROW_PAGE),
      { root: el.closest(".registry-list"), rootMargin: "400px" },
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, [limit, all.length, tab]);
  const agentCount =
    attention.length +
    unreadRows.length +
    groups.reduce((n, g) => n + g.agents.length, 0);
  // A row leaves out what its group heading already says.
  const multiHost = showHosts(groups);
  const row = (a: Agent, pinned = false) => {
    const ws = workspaceOf(a);
    const project = projectOf(a);
    const permission = permissions.find((p) => p.agentId === a.id);
    const waiting = permissionAgents.has(a.id);
    const fresh = unread.has(a.id);
    // What the badge says: a question first, then an unread reply.
    const shown = asking.has(a.id)
      ? "waiting on you"
      : waiting
      ? "awaiting approval"
      : fresh
        ? UNREAD
        : shownStatus(a);
    const g = view.group;
    const meta: [string, ReactNode][] = [];
    if (project && (pinned || g === "host" || g === "status" || g === "none"))
      meta.push([
        "project",
        <span className="row-project">
          <Box size={9} />
          {placeText(project.name, "Project")}
        </span>,
      ]);
    if (ws && (pinned || g !== "workspace"))
      meta.push([
        "branch",
        <>
          <GitBranch size={9} />
          <span className="row-branch">
            {placeText(ws.name || ws.branch, "workspace")}
          </span>
        </>,
      ]);
    if (a.hostLabel && (pinned || g === "status" || g === "none"))
      meta.push([
        "host",
        <>
          <Server size={9} />
          {hostText(a)}
        </>,
      ]);
    if (a.stale) meta.push(["stale", <span className="row-stale">stale</span>]);
    meta.push([
      "time",
      <span className="row-time">
        {fresh && finishedAt[a.id]
          ? ago(finishedAt[a.id])
          : compactAgo(a.created)}
      </span>,
    ]);
    return (
      <div
        key={a.id}
        className={`fleet-row ${selection?.id === a.id ? "selected" : ""} ${fresh ? "unread" : ""} ${a.stale ? "stale" : ""}`}
        aria-description={
          a.stale
            ? `${hostText(a)} isn't answering; this is its last-known state.`
            : undefined
        }
      >
        <button
          className="registry-row"
          // The full title (rows truncate it), and what the row says.
          aria-description={[
            agentName(a, ws?.branch),
            `${asking.has(a.id) ? "Its reply waits on you" : waiting ? "Awaiting approval" : fresh ? "Unread reply" : shownStatus(a)}${project ? ` · ${placeText(project.name)}` : ""}${ws ? ` · ${placeText(ws.name || ws.branch)}` : ""}${a.hostLabel ? ` · ${hostText(a)}` : ""}`,
            ...(a.stale
              ? [
                  `${hostText(a)} isn't answering; this is its last-known state.`,
                ]
              : []),
          ].join("\n")}

          onClick={() => select({ type: "agent", id: a.id })}
        >
          <span className="avatar">
            <ProviderIcon provider={a.provider} />
            {fresh && <span className="unread-dot" aria-label="Unread" />}
          </span>
          <span className="row-name">
            <b>{agentName(a, ws?.branch)}</b>
            <small>
              {meta.map(([key, part], i) => (
                <Fragment key={key}>
                  {i > 0 && <span>·</span>}
                  {part}
                </Fragment>
              ))}
            </small>
          </span>
          <Badge status={shown} />
        </button>
        {waiting && permission?.id && /question/i.test(permission.name) ? (
          <span className="row-actions">
            <button
              className="answer"
              aria-description="Open the agent to answer its question"
              onClick={() => select({ type: "agent", id: a.id })}
            >
              Answer
            </button>
          </span>
        ) : waiting && permission?.id ? (
          <span className="row-actions">
            <button
              className="approve"
              data-tip={`Approve ${permission.name}`}
              aria-label="Approve"
              disabled={busy}
              onClick={() => onApprove(permission, true)}
            >
              <Check size={13} />
            </button>
            <button
              data-tip={`Deny ${permission.name}`}
              aria-label="Deny"
              disabled={busy}
              onClick={() => onApprove(permission, false)}
            >
              <X size={13} />
            </button>
          </span>
        ) : fresh ? (
          <span className="row-actions">
            <button
              data-tip="Mark as read"
              aria-label="Mark as read"
              onClick={() => onMarkRead([a.id])}
            >
              <Check size={13} />
            </button>
          </span>
        ) : online && !a.stale ? (
          <span className="row-actions">
            <button
              // What its name is: its own title, or its workspace's.
              data-tip={`Rename ${agentRenameTarget(a).kind}`}
              aria-label={`Rename ${agentName(a, ws?.branch)}`}
              onClick={() => {
                // Opens the agent with its name being edited.
                const target = agentRenameTarget(a);
                requestRename(target.kind, target.key);
                select({ type: "agent", id: a.id });
              }}
            >
              <Pencil size={13} />
            </button>
          </span>
        ) : null}
      </div>
    );
  };
  const toggle = (key: string, name: string, controls: string) => {
    const shut = collapsed.has(key);
    return (
      <button
        className="group-toggle"
        aria-expanded={!shut}
        aria-controls={controls}
        aria-label={`${shut ? "Expand" : "Collapse"} ${name}`}
        data-tip={`${shut ? "Expand" : "Collapse"} ${name}`}
        onClick={() => setCollapsed([key], !shut)}
      >
        <ChevronDown size={12} />
      </button>
    );
  };
  return (
    <section className="registry" aria-label="Fleet">
      <RegistryTabs
        tab={tab}
        setTab={setTab}
        counts={{
          Agents: agentCount,
          Workspaces: workspaces.length,
          Projects: projects.length,
          Hosts: hosts.length,
        }}
      />
      {filteredHost && tab !== "Hosts" && (
        <div className="host-filter" role="status">
          <Server size={12} aria-hidden="true" />
          <span>
            Only <b>{hostText(filteredHost)}</b>
          </span>
          <button
            className="icon-btn"
            data-tip="Show every host"
            aria-label="Show every host"
            onClick={() => setHostFilter(null)}
          >
            <X size={13} />
          </button>
        </div>
      )}
      {tab === "Agents" && (
        <div className="filter-bar">
          <div
            className="filter-chips"
            role="radiogroup"
            aria-label="Agent filter"
            onKeyDown={(e) => rovingKeyDown(e, (i) => setFilter(FILTERS[i][0]))}
          >
            {FILTERS.map(([f, label]) => (
              <button
                key={f}
                role="radio"
                aria-checked={filter === f}
                tabIndex={filter === f ? 0 : -1}
                aria-description={FILTER_HINTS[f]}
                onClick={() => setFilter(f)}
              >
                {label}
                <small>{counts[f]}</small>
              </button>
            ))}
          </div>
          <ViewOptions
            state={viewState}
            groupKeys={[
              ...(attention.length ? [ATTENTION_GROUP] : []),
              ...(unreadRows.length ? [UNREAD_GROUP] : []),
              ...groups.filter((g) => g.label).map((g) => g.key),
            ]}
          />
        </div>
      )}
      {tab === "Projects" && projects.length > 0 && (
        <div className="filter-bar project-bar">
          <button
            className="secondary add-project-btn"
            aria-description="Add an existing folder, a new folder or a GitHub clone as a project"
            disabled={!online}
            onClick={onAddProject}
          >
            <Plus size={13} />
            Add project
          </button>
        </div>
      )}
      <div className="registry-list" role="tabpanel">
        {tab === "Agents" ? (
          <>
            {attention.length > 0 && (
              <div className="fleet-group attention-group">
                <div className="group-head">
                  {toggle(ATTENTION_GROUP, "Needs you", `${listId}-attention`)}
                  <span
                    className="group-title"
                    aria-description="Approvals, plans and open questions"
                  >
                    Needs you
                  </span>
                  <small>
                    {attention.length}
                    <span className="sr-only">
                      {" "}
                      {attention.length === 1 ? "agent" : "agents"}
                    </span>
                  </small>
                </div>
                <div
                  id={`${listId}-attention`}
                  hidden={collapsed.has(ATTENTION_GROUP)}
                >
                  {take(attention).map((a) => row(a, true))}
                </div>
              </div>
            )}
            {unreadRows.length > 0 && (
              <div className="fleet-group unread-group">
                <div className="group-head">
                  {toggle(UNREAD_GROUP, "Unread", `${listId}-unread`)}
                  <span className="dot unread" aria-hidden="true" />
                  <span
                    className="group-title"
                    aria-description="Finished with a reply you haven't read yet"
                  >
                    Unread
                  </span>
                  <small>
                    {unreadRows.length}
                    <span className="sr-only">
                      {" "}
                      {unreadRows.length === 1 ? "agent" : "agents"}
                    </span>
                  </small>
                  <button
                    className="link-btn"
                    aria-description="Mark every unread agent here as read"
                    onClick={() => onMarkRead(unreadRows.map((a) => a.id))}
                  >
                    <CheckCheck size={12} />
                    Mark all read
                  </button>
                </div>
                <div
                  id={`${listId}-unread`}
                  hidden={collapsed.has(UNREAD_GROUP)}
                >
                  {take(unreadRows).map((a) => row(a, true))}
                </div>
              </div>
            )}
            {groups.map((g, i) => {
              if (budget <= 0) return null;
              const rows = take(g.agents);
              if (!g.label)
                return (
                  <Fragment key={g.key}>{rows.map((a) => row(a))}</Fragment>
                );
              const id = `${listId}-g${i}`;
              const host =
                view.group !== "host" &&
                g.host &&
                (g.host !== "local" || multiHost)
                  ? g.host
                  : undefined;
              const name = host ? `${g.label} on ${host}` : g.label;
              return (
                <div
                  className={`fleet-group ${collapsed.has(g.key) ? "collapsed" : ""}`}
                  key={g.key}
                >
                  <div className="group-head">
                    {toggle(g.key, name, id)}
                    {g.tone && (
                      <span className={`dot ${g.tone}`} aria-hidden="true" />
                    )}
                    {g.select ? (
                      <button
                        className="group-title"
                        aria-description={`Open ${g.select.type} ${name}`}
                        onClick={() => select(g.select!)}
                      >
                        {g.label}
                      </button>
                    ) : (
                      <span className="group-title">{g.label}</span>
                    )}
                    {g.detail && (
                      <span className="group-detail">{g.detail}</span>
                    )}
                    {host && (
                      <span
                        className={`host-chip ${g.agents.some((a) => a.stale) ? "stale" : ""}`}
                        aria-description={`On ${host === "local" ? "this machine’s daemon" : `host ${host}`}`}
                      >
                        <Server size={9} />
                        <span>{host}</span>
                      </span>
                    )}
                    <small>
                      {g.agents.length}
                      <span className="sr-only">
                        {" "}
                        {g.agents.length === 1 ? "agent" : "agents"}
                      </span>
                    </small>
                    {g.dispatch && (
                      <button
                        className="icon-btn group-add"
                        data-tip={`Dispatch to ${name}`}
                        aria-label={`Dispatch to ${name}`}
                        onClick={() => onDispatch(g.dispatch)}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                  </div>
                  <div id={id} hidden={collapsed.has(g.key)}>
                    {rows.map((a) => row(a))}
                  </div>
                </div>
              );
            })}
            {all.length > limit && (
              <div className="more-rows" ref={more} role="status">
                Showing {limit} of {all.length} · scroll for more
              </div>
            )}
          </>
        ) : tab === "Workspaces" ? (
          workspaces.map((w) => {
            const wsKey = workspaceKey(w);
            // Shown names, without IDs.
            const wName = placeText(w.name, "Workspace");
            const wBranch = placeText(w.branch);
            const wProject = placeText(w.project, "Project");
            const wHost = w.host ? hostText(w) : "";
            const fleet = agentsAt(wsKey);
            const running = fleet.filter((a) => isWorking(a)).length;
            const leaving = archiving.has(wsKey);
            return (
              <div
                key={wsKey}
                className={`fleet-row ${selection?.id === wsKey ? "selected" : ""}${leaving ? " archiving" : ""}`}
              >
                <button
                  className="registry-row"
                  aria-description={`Open workspace ${w.name !== w.branch && w.name ? wName : wBranch || wName}${w.branch && w.branch !== w.name ? ` (${wBranch})` : ""} · ${wProject}${wHost ? ` · ${wHost}` : ""}`}

                  onClick={() => select({ type: "workspace", id: wsKey })}
                >
                  <span className="registry-icon">
                    <GitBranch size={16} />
                  </span>
                  <span className="row-name">
                    <b>
                      {w.name !== w.branch && w.name ? wName : wBranch || wName}
                    </b>
                    <small>
                      {w.branch && w.branch !== w.name ? `${wBranch} · ` : ""}
                      {wProject}
                      {wHost ? ` · ${wHost}` : ""}
                    </small>
                  </span>
                  {leaving ? (
                    <span className="badge slate archiving-badge">
                      <LoaderCircle size={11} className="spinning" />
                      Archiving…
                    </span>
                  ) : (
                    <span className={`badge ${running ? "green" : "slate"}`}>
                      {running
                        ? `${running} running`
                        : `${fleet.length} ${fleet.length === 1 ? "agent" : "agents"}`}
                    </span>
                  )}
                </button>
                <span className="row-actions">
                  <button
                    data-tip="Dispatch an agent into this workspace"
                    aria-label={`Dispatch into ${wName}`}
                    onClick={() =>
                      onDispatch(
                        realWorkspaceIds.has(wsKey)
                          ? { workspaceId: wsKey }
                          : {
                              projectId: (() => {
                                const p = projects.find(
                                  (p) => p.name === w.project && sameHost(p, w),
                                );
                                return p && projectKey(p);
                              })(),
                            },
                      )
                    }
                  >
                    <Plus size={13} />
                  </button>
                  {realWorkspaceIds.has(wsKey) && (
                    <button
                      data-tip={`Rename workspace ${wName}`}
                      aria-label={`Rename workspace ${wName}`}
                      disabled={!online}
                      onClick={() => {
                        // Opens the workspace with its name being edited.
                        requestRename("workspace", wsKey);
                        select({ type: "workspace", id: wsKey });
                      }}
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {realWorkspaceIds.has(wsKey) && (
                    <button
                      className="archive"
                      data-tip={
                        leaving
                          ? `Archiving ${wName}…`
                          : `Archive workspace ${wName}`
                      }
                      aria-label={`Archive workspace ${wName}`}
                      disabled={busy || !online || leaving}
                      onClick={() => onArchiveWorkspace(w)}
                    >
                      <Archive size={13} />
                    </button>
                  )}
                </span>
              </div>
            );
          })
        ) : tab === "Hosts" ? (
          sortedHosts.map((h) => {
            const id = hostId(h);
            const state = hostState(h);
            const name = h.local ? placeText(h.label, "local") : hostText(h);
            const [, ...problems] = hostTitle(h).split("\n");
            const hostAgents = agents.filter((a) => onHost(a, id)).length;
            const workspaceCount = allWorkspaces.filter((w) =>
              onHost(w, id),
            ).length;
            const chosen = hostFilter === id;
            return (
              <div
                key={h.serverId}
                className={`fleet-row host-entry ${chosen ? "selected" : ""}`}
              >
                <button
                  className="registry-row"
                  aria-pressed={chosen}
                  aria-label={`Host ${name}: ${STATE_TEXT[state]}`}
                  aria-description={`${hostTitle(h)}\n${chosen ? "Show every host again" : "Focus this host in the world and show only its agents, workspaces and projects"}`}
                  onClick={() => chooseHost(h)}
                >
                  <span className="registry-icon">
                    <Server size={16} />
                  </span>
                  <span className="row-name">
                    <b>{name}</b>
                    <small>
                      {hostAgents} {hostAgents === 1 ? "agent" : "agents"} ·{" "}
                      {workspaceCount}{" "}
                      {workspaceCount === 1 ? "workspace" : "workspaces"}
                    </small>
                    {problems.length > 0 && (
                      <small className="host-problem">
                        {problems.join(" · ")}
                      </small>
                    )}
                  </span>
                  <span
                    className={`badge ${state === "online" ? "green" : state === "offline" ? "red" : "amber"}`}
                  >
                    {state}
                  </span>
                </button>
              </div>
            );
          })
        ) : (
          projects.map((p) => {
            const pName = placeText(p.name, "Project");
            const pHost = p.host ? hostText(p) : "";
            const docks = workspaces.filter(
              (w) => w.project === p.name && sameHost(w, p),
            ).length;
            const leaving = removingProjects.has(projectKey(p));
            return (
              <div
                key={projectKey(p)}
                className={`fleet-row ${selection?.id === projectKey(p) ? "selected" : ""}`}
              >
                <button
                  className="registry-row"
                  aria-description={`Open project ${pName}${pHost ? ` on ${pHost}` : ""}\n${pathText(p.path, [p.projectId])}`}

                  onClick={() => select({ type: "project", id: projectKey(p) })}
                >
                  <span className="registry-icon">
                    <Box size={16} />
                  </span>
                  <span className="row-name">
                    <b>{pName}</b>
                    <small>
                      {pathText(p.path.replace(/^\/(Users|home)\/[^/]+/, "~"), [
                        p.projectId,
                      ])}
                      {pHost ? ` · ${pHost}` : ""}
                    </small>
                  </span>
                  <span className="badge slate">
                    {docks} {docks === 1 ? "workspace" : "workspaces"}
                  </span>
                </button>
                <span className="row-actions">
                  <button
                    data-tip={`Dispatch to ${pName}`}
                    aria-label={`Dispatch to ${pName}`}
                    onClick={() => onDispatch({ projectId: projectKey(p) })}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    data-tip={`Rename project ${pName}`}
                    aria-label={`Rename project ${pName}`}
                    disabled={!online || leaving}
                    onClick={() => {
                      // Opens the project with its name being edited.
                      requestRename("project", projectKey(p));
                      select({ type: "project", id: projectKey(p) });
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="archive"
                    data-tip={
                      leaving ? `Removing ${pName}…` : `Remove project ${pName}`
                    }
                    aria-label={`Remove project ${pName}`}
                    disabled={!online || leaving}
                    onClick={() => onRemoveProject(p)}
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            );
          })
        )}
        {!(tab === "Agents"
          ? agentCount
          : tab === "Workspaces"
            ? workspaces.length
            : tab === "Hosts"
              ? hosts.length
              : projects.length) &&
          (loading ? (
            <div aria-busy="true" aria-label="Connecting to Paseo">
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="skeleton-row" key={i}>
                  <i />
                  <span>
                    <i />
                    <i />
                  </span>
                  <i />
                </div>
              ))}
            </div>
          ) : !online ? (
            // An unreachable daemon is not an empty fleet.
            <div className="empty-state">
              <span className="empty-icon">
                <CloudOff size={18} />
              </span>
              <b>Can’t reach the Paseo daemon</b>
              <p>The fleet will appear here once it reconnects.</p>
            </div>
          ) : tab === "Agents" && filter === "attention" ? (
            <div className="empty-state positive">
              <span className="empty-icon">
                <CheckCheck size={18} />
              </span>
              <b>All clear</b>
              <p>Nothing needs you right now.</p>
            </div>
          ) : tab === "Agents" && filter !== "all" ? (
            <div className="empty-state">
              <span className="empty-icon">
                <Bot size={18} />
              </span>
              <b>No {filter} agents</b>
              <p>Switch filters to see the rest of the fleet.</p>
              <button
                className="secondary"
                aria-description="Show every active agent"
                onClick={() => setFilter("all")}
              >
                Show all active
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">
                {tab === "Hosts" ? (
                  <Server size={18} />
                ) : tab === "Projects" ? (
                  <Box size={18} />
                ) : tab === "Workspaces" ? (
                  <GitBranch size={18} />
                ) : (
                  <Bot size={18} />
                )}
              </span>
              <b>
                {tab === "Agents"
                  ? "No active agents"
                  : tab === "Workspaces"
                    ? "No workspaces yet"
                    : tab === "Hosts"
                      ? "No hosts yet"
                      : "No projects yet"}
              </b>
              <p>
                {tab === "Hosts"
                  ? "Hosts connected to Paseo appear here with their health."
                  : tab === "Projects"
                    ? "Add a folder, a new folder or a GitHub clone; its first agent puts it on the map."
                    : "Dispatch an agent to put it to work on a project."}
              </p>
              {tab === "Projects" && (
                <button
                  className="primary"
                  aria-description="Add an existing folder, a new folder or a GitHub clone as a project"
                  onClick={onAddProject}
                >
                  <Plus size={14} />
                  Add project
                </button>
              )}
              {(tab === "Agents" || tab === "Workspaces") && (
                <button
                  className="primary"
                  aria-description="Dispatch a new agent (⌘N / D)"
                  onClick={() => onDispatch()}
                >
                  <Plus size={14} />
                  Dispatch agent
                </button>
              )}
            </div>
          ))}
      </div>
      <div className="registry-footer">
        <span>
          <kbd>J</kbd>
          <kbd>K</kbd> move
        </span>
        <span>
          <kbd>N</kbd> next needing you
        </span>
        <span>
          <kbd>D</kbd> dispatch
        </span>
        {window.__PASEO_UNITY__ && (
          <span>
            <kbd>F</kbd> fit world
          </span>
        )}
      </div>
    </section>
  );
}

/** Measure the labels even in compact mode, so resizing restores words as soon
 * as they fit. Counts, font changes and split-pane widths all participate. */
function RegistryTabs({
  tab,
  setTab,
  counts,
}: {
  tab: Tab;
  setTab: (tab: Tab) => void;
  counts: Record<Tab, number>;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const node = element.current!;
    const measure = () => {
      const buttons = Array.from(node.querySelectorAll("button"));
      const required =
        buttons.reduce(
          (sum, button) =>
            sum +
            button.querySelector(".registry-tab-label")!.getBoundingClientRect()
              .width +
            button.querySelector("small")!.getBoundingClientRect().width +
            10,
          0,
        ) + 36;
      setCompact(required > node.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    node
      .querySelectorAll(".registry-tab-label, small")
      .forEach((label) => observer.observe(label));
    let active = true;
    void document.fonts.ready.then(() => {
      if (active) measure();
    });
    measure();
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [counts.Agents, counts.Workspaces, counts.Projects, counts.Hosts]);
  const icons = {
    Agents: Bot,
    Workspaces: GitBranch,
    Projects: Box,
    Hosts: Server,
  };
  return (
    <div
      ref={element}
      className="tabs registry-tabs"
      data-icons={compact}
      role="tablist"
      aria-label="Registry type"
      onKeyDown={(e) => rovingKeyDown(e, (i) => setTab(TABS[i]))}
    >
      {TABS.map((t) => {
        const Icon = icons[t];
        return (
          <button
            key={t}
            role="tab"
            aria-label={`${t} ${counts[t]}`}
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            data-tip={compact ? t : undefined}
            aria-description={`Show ${t.toLowerCase()} (← → to switch)`}
            onClick={() => setTab(t)}
          >
            <span className="registry-tab-label" aria-hidden="true">
              {t}
            </span>
            <Icon className="registry-tab-icon" size={17} aria-hidden="true" />
            <small aria-hidden="true">{counts[t]}</small>
            {tab === t && (
              <motion.span className="tab-underline" layoutId="tab" />
            )}
          </button>
        );
      })}
    </div>
  );
}
