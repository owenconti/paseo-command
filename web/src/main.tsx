import { nativeAvailable, nativeEvents, postNative } from "./worldBridge";
import { installAppReloadShortcut } from "./appReload";
import { installDispatchShortcut } from "./dispatchShortcut";
import {
  agentClientId,
  hasCompleteAgentOwners,
  migrateAgentStorage,
} from "./agentIdentity";
import { activeAgents, onAgentArchived } from "./activeAgents";
import { installNativeLinks } from "./nativePlatform";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion, MotionConfig } from "framer-motion";
import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  MessageSquare,
  RotateCw,
  X,
} from "lucide-react";
import { ArchiveWorkspaceDialog } from "./ArchiveWorkspaceDialog";
import {
  dismissArchive,
  isArchiving,
  onArchiveSettled,
  startArchive,
  useArchiveJobs,
  type ArchiveJob,
} from "./archives";
import { SoundControl } from "./SoundControl";
import { DispatchDialog, type DispatchTarget } from "./Dispatch";
import {
  Fleet,
  FleetSummary,
  FleetTools,
  useFleetView,
  type Filter,
  type Tab,
} from "./Fleet";
import {
  attentionRank,
  groupAgents,
  needsAttention,
  nextNeedingYou,
  unreadAgents,
} from "./fleetView";
import { ProjectView, WorkspaceView } from "./PlaceView";
import { FloatingPanel } from "./FloatingPanel";
import { AppPanel, useCompactLayout } from "./AppPanel";
import { Session } from "./Session";
import { SubagentSession } from "./Subagents";
import {
  api,
  errorMessage,
  readStore,
  retainRows,
  retainSnapshot,
} from "./api";
import { connectFleet, rowsOf, type Resource } from "./live";
import { EVENT_OF_CUE, LiveCueWatcher, soundEvent } from "./soundCues";
import "./sounds";
import { useAttention } from "./attention";
import { useQueueRunner } from "./queue";
import { TooltipLayer } from "./Tooltip";
import { setKnownIds } from "./display";
import {
  settleRenames,
  useRenames,
  withAgentRenames,
  withRenames,
} from "./renames";
import { withLocalWorkspaces, projectKey, workspaceKey } from "./workspaces";
import { readUrlState, selectionKey as placeKey, urlSearch } from "./urlState";
import type {
  Agent,
  Health,
  Host,
  PendingPermission,
  Project,
  Provider,
  Selection,
  UsageReport,
  Workspace,
} from "./types";
import { isWorking, markDegraded, sameHost } from "./types";
import "@fontsource-variable/inter";
import "./style.css";
import "./app.css";
import "./themes.css";
import "./world-ui.css";
import { agentName, idLike, placeText, useKnownIds } from "./names";

installNativeLinks();
// Browser-hosted Phaser renderer uses the inherited docked session layout.
const native = true;
const unity = true;
// Cmd+R loads the latest build of the app; it never just reloads this page.
// Browser reload remains the browser's normal Cmd+R behavior.
const NativeWorld = React.lazy(() =>
  import("./NativeWorld").then((module) => ({ default: module.NativeWorld })),
);

const spring = { type: "spring" as const, stiffness: 300, damping: 30 };
function parsePermissions(value: unknown): PendingPermission[] {
  // Daemon versions name the fields differently.
  const rows: Record<string, unknown>[] = Array.isArray(value) ? value : [];
  return rows
    .map((p) => ({
      id: String(p.id || p.requestId || p.request_id || p.Id || ""),
      agentId: String(p.agentId || p.agent || p.AgentId || p.agent_id || ""),
      name: String(
        p.name || p.toolName || p.tool_name || p.title || "Permission request",
      ),
      description: String(p.description || p.message || ""),
      host: p.host as string | undefined,
      kind: typeof p.kind === "string" ? p.kind : undefined,
    }))
    .filter((p) => p.agentId);
}

function App() {
  const [liveAgents, setAgents] = useState<Agent[]>([]),
    [projects, setProjects] = useState<Project[]>([]),
    [liveWorkspaces, setWorkspaces] = useState<Workspace[]>([]),
    [providers, setProviders] = useState<Provider[]>([]),
    [hosts, setHosts] = useState<Host[]>([]),
    [usage, setUsage] = useState<UsageReport[]>([]),
    [permissions, setPermissions] = useState<PendingPermission[]>([]),
    [health, setHealth] = useState<Health | null>(null);
  // Renames show at once, everywhere the rows are read (the list, headers,
  // the world), until the fleet has them (src/renames.ts).
  const renames = useRenames();
  const agents = useMemo(
    () => withAgentRenames(liveAgents, renames),
    [liveAgents, renames],
  );
  const workspaces = useMemo(
    () => withRenames(liveWorkspaces, "workspace", workspaceKey, renames),
    [liveWorkspaces, renames],
  );
  // Once saved, a rename is dropped when the fleet shows it (it may have
  // arrived before the answer).
  useEffect(() => {
    settleRenames(liveAgents, "agent", (a) => a.id);
    settleRenames(liveWorkspaces, "workspace", workspaceKey);
  }, [liveAgents, liveWorkspaces, renames]);
  // Every ID the app knows (agents', workspaces', projects', hosts') stays
  // out of every label; the UI re-renders when the set changes, before
  // the browser paints.
  useLayoutEffect(
    () =>
      setKnownIds([
        // IDs can be plain words ("atlas", "long"), which must stay in
        // names: only ID-like ones.
        ...[
          ...agents.flatMap((a) => [a.id, a.shortId]),
          ...workspaces.map((w) => w.workspaceId),
          ...projects.map((p) => p.projectId),
          ...hosts.map((h) => h.serverId),
        ].filter(idLike),
      ]),
    [agents, workspaces, projects, hosts],
  );
  useKnownIds();
  // Where the user was, from the page's query (a refresh returns there).
  const [initial] = useState(() => readUrlState());
  // A selection from the URL is framed on the map once it is drawn.
  const [focusRevision, setFocusRevision] = useState(initial.selection ? 1 : 0);
  const [dispatchRevision, setDispatchRevision] = useState(0);
  const [browsing, setBrowsing] = useState(initial.browsing);
  // The app's Settings… (Cmd+,) opens the interface sounds control in the
  // fleet sidebar: show the sidebar and expand the panel (SoundControl opens).
  const [revealRevision, setRevealRevision] = useState(0);
  useEffect(() => {
    if (!native) return;
    return nativeEvents((event) => {
      if (event.type !== "menu" || event.action !== "settings") return;
      setBrowsing(true);
      setRevealRevision((revision) => revision + 1);
    });
  }, []);
  const compact = useCompactLayout();
  const [floatingVisibility, setFloatingVisibility] = useState({
    compact: true,
    collapsed:
      unity &&
      readStore<{ collapsed?: boolean } | null>("unity-panel", null)
        ?.collapsed === true,
  });
  // The host the lists are narrowed to ("" for local): chosen in the Hosts
  // tab or by picking its land on the map, where it shows as selected.
  const [hostFilter, setHostFilter] = useState<string | null>(initial.hostFilter);
  const defaultTab: Tab = unity ? "Workspaces" : "Agents";
  const [selection, setSelection] = useState<Selection>(initial.selection),
    [tab, setTab] = useState<Tab>(initial.tab ?? defaultTab),
    [filter, setFilter] = useState<Filter>(initial.filter ?? "all");
  // Kept in the URL: a new selection is a new history entry (Back returns to
  // the last); tabs, filters and the list's toggle replace the current one.
  const shownPlace = useRef(placeKey(initial.selection));
  useEffect(() => {
    const search = urlSearch(
      { selection, tab, filter, hostFilter, browsing },
      { tab: defaultTab },
    );
    if (search === location.search) return;
    const place = placeKey(selection);
    const url = `${location.pathname}${search}${location.hash}`;
    if (place !== shownPlace.current) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
    shownPlace.current = place;
  }, [selection, tab, filter, hostFilter, browsing, defaultTab]);
  useEffect(() => {
    const restore = () => {
      const state = readUrlState();
      shownPlace.current = placeKey(state.selection);
      setSelection(state.selection);
      setBrowsing(state.browsing);
      setTab(state.tab ?? defaultTab);
      setFilter(state.filter ?? "all");
      setHostFilter(state.hostFilter);
      if (state.selection) setFocusRevision((revision) => revision + 1);
    };
    addEventListener("popstate", restore);
    return () => removeEventListener("popstate", restore);
  }, [defaultTab]);
  const [errors, setErrors] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [dispatchTarget, setDispatchTarget] = useState<DispatchTarget | null>(null),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [archiveWorkspace, setArchiveWorkspace] = useState<Workspace | null>(
    null,
  );
  useEffect(
    () =>
      onAgentArchived((id, host) => {
        const qualified = agentClientId(id, host);
        setAgents((rows) => rows.filter((a) => a.id !== qualified));
        setSelection((value) =>
          value?.type === "agent" && value.id === qualified ? null : value,
        );
        setPermissions((rows) => rows.filter((p) => p.agentId !== qualified));
      }),
    [],
  );
  const permissionAgents = useMemo(
    () => new Set(permissions.map((p) => p.agentId)),
    [permissions],
  );
  const questionAgents = useMemo(
    () =>
      new Set(
        permissions
          .filter((p) => p.kind === "question" || p.questions?.length)
          .map((p) => p.agentId),
      ),
    [permissions],
  );
  const active = useMemo(() => activeAgents(agents), [agents]);
  const listedWorkspaces = useMemo(
    () => withLocalWorkspaces(projects, workspaces, active),
    [projects, workspaces, active],
  );
  const realWorkspaceIds = useMemo(
    () => new Set(workspaces.map(workspaceKey)),
    [workspaces],
  );
  // The agent's own workspace first, as the world places it: one checkout can
  // be registered as several workspaces.
  const workspaceOf = useCallback(
    (a: Agent) =>
      (a.workspaceId &&
        listedWorkspaces.find(
          (w) => w.workspaceId === a.workspaceId && sameHost(w, a),
        )) ||
      listedWorkspaces.find(
        (w) =>
          w.cwd.replace(/\/+$/, "") === a.cwd.replace(/\/+$/, "") &&
          sameHost(w, a),
      ),
    [listedWorkspaces],
  );
  const projectOf = useCallback(
    (a: Agent) => {
      const ws = workspaceOf(a);
      return (
        projects.find((p) => p.projectId === a.projectId && sameHost(p, a)) ||
        (ws
          ? projects.find((p) => p.name === ws.project && sameHost(p, ws))
          : undefined)
      );
    },
    [projects, workspaceOf],
  );
  const agentsAt = useCallback(
    (key: string) =>
      active.filter((a) => {
        const ws = workspaceOf(a);
        return ws && workspaceKey(ws) === key;
      }),
    [active, workspaceOf],
  );

  // The fleet is pushed (src/live.ts); reads only fill in until the first
  // reset, back it up while the stream is down, and confirm a command.
  const liveFleet = useRef<ReturnType<typeof connectFleet> | null>(null);
  const refresh = useCallback(async () => {
    await liveFleet.current?.refresh();
  }, []);
  useEffect(() => {
    const keep = <T,>(set: React.Dispatch<React.SetStateAction<T>>, next: T) =>
      set((previous) => retainSnapshot(previous, next));
    // Preserve row identity across live updates.
    const keepRows = <T,>(
      set: React.Dispatch<React.SetStateAction<T[]>>,
      next: T[],
    ) => set((previous) => retainRows(previous, next));
    const sounds = new LiveCueWatcher();
    const live = connectFleet({
      changed: (state, resources, source) => {
        const hostRows = rowsOf(state, "hosts") as Host[];
        // Rows from a host whose chip says it isn't answering are stale.
        const rows = (r: Resource) => markDegraded(rowsOf(state, r), hostRows);
        // Agents' live transitions sound; snapshots only set the baseline.
        if (
          resources.includes("agents") ||
          resources.includes("permissions") ||
          resources.includes("hosts")
        ) {
          const cue = sounds.observe(
            activeAgents(rows("agents") as Agent[]),
            parsePermissions(rows("permissions")),
            source,
            state.live,
            performance.now(),
          );
          if (cue) soundEvent(EVENT_OF_CUE[cue]);
        }
        if (resources.includes("agents") || resources.includes("hosts")) {
          try {
            migrateAgentStorage(
              activeAgents(rows("agents") as Agent[]),
              localStorage,
              { complete: hasCompleteAgentOwners(state, hostRows) },
            );
          } catch {
            setNotice(
              "Some older saved state could not be upgraded. Keep this browser’s storage so it can be retried.",
            );
          }
        }
        for (const r of resources) {
          if (r === "agents")
            keepRows(setAgents, activeAgents(rows("agents") as Agent[]));
          else if (r === "projects")
            keepRows(setProjects, rows("projects") as Project[]);
          else if (r === "workspaces")
            keepRows(setWorkspaces, rows("workspaces") as Workspace[]);
          else if (r === "permissions")
            keep(setPermissions, parsePermissions(rows("permissions")));
          else if (r === "hosts") keep(setHosts, hostRows);
          else if (r === "status")
            keep(setHealth, state.status as Health | null);
        }
        // Degradation follows the host chips.
        if (resources.includes("hosts") && !resources.includes("agents")) {
          keepRows(setAgents, activeAgents(rows("agents") as Agent[]));
          keepRows(setProjects, rows("projects") as Project[]);
          keepRows(setWorkspaces, rows("workspaces") as Workspace[]);
        }
        setLoading(false);
      },
      errors: (failures) => keep(setErrors, failures),
    });
    liveFleet.current = live;
    // Providers aren't pushed; they change rarely.
    const providers = () =>
      api<Provider[]>("providers")
        .then((rows) => Array.isArray(rows) && keep(setProviders, rows))
        .catch(() => {});
    providers();
    const timer = setInterval(providers, 300000);
    return () => {
      live.close();
      clearInterval(timer);
      if (liveFleet.current === live) liveFleet.current = null;
    };
  }, []);
  useEffect(() => {
    const load = () =>
      api<UsageReport[]>("usage")
        .then(
          (rows) =>
            Array.isArray(rows) && setUsage((p) => retainSnapshot(p, rows)),
        )
        .catch(() => {});
    load();
    const timer = setInterval(load, 300000);
    return () => clearInterval(timer);
  }, []);
  const busiestProject = useMemo(() => {
    const top = [...projects]
      .filter((p) => !p.host)
      .sort(
        (a, b) =>
          active.filter((x) => projectOf(x) === b).length -
          active.filter((x) => projectOf(x) === a).length,
      )[0];
    return top && projectKey(top);
  }, [projects, active, projectOf]);
  const select = useCallback((s: Selection) => {
    if (s) setFocusRevision((revision) => revision + 1);
    setSelection(s);
    setBrowsing(!s);
  }, []);
  const selected = useRef<Selection>(null);
  selected.current = selection;
  /** The user chose something (in the list, the world or a notification). */
  const choose = useCallback(
    (s: Selection) => {
      const was = selected.current;
      if (
        s &&
        (s.type !== was?.type || s.id !== was.id || s.subagent !== was.subagent)
      )
        soundEvent("selected");
      select(s);
    },
    [select],
  );  /** Picking a host on the map selects it: the lists narrow to it and it
   * takes the map's highlight from whatever was selected. */
  const chooseHost = useCallback(
    (id: string) => {
      soundEvent("selected");
      setHostFilter(id === "local" ? "" : id);
      choose(null);
    },
    [choose],
  );

  const previousAgentIds = useRef(new Set<string>());
  useEffect(() => {
    const ids = new Set(agents.map((a) => a.id));
    const removed = new Set(
      [...previousAgentIds.current].filter((id) => !ids.has(id)),
    );
    previousAgentIds.current = ids;
    if (!removed.size) return;
    if (selection?.type === "agent" && removed.has(selection.id)) select(null);
  }, [agents, selection, select]);
  const viewing =
    selection?.type === "agent" &&
    !(unity && floatingVisibility.collapsed) &&
    !((unity ? floatingVisibility.compact : compact) && browsing)
      ? selection.id
      : undefined;
  // As in the Paseo app, listed subagents never notify or count as unread.
  const notifying = useMemo(() => agents.filter((a) => !a.child), [agents]);
  const notifyingPermissions = useMemo(() => {
    const children = new Set(agents.filter((a) => a.child).map((a) => a.id));
    return children.size
      ? permissions.filter((p) => !children.has(p.agentId))
      : permissions;
  }, [agents, permissions]);
  const attention = useAttention(
    notifying,
    notifyingPermissions,
    viewing,
    (id) => choose({ type: "agent", id }),
  );
  // Agents whose daemon attention flag this tab has just cleared, with the
  // attention time it cleared: they read as read until the daemon's push
  // arrives, or until a later finish is flagged.
  const [cleared, setCleared] = useState<Record<string, string | null>>({});
  // Unread replies: the daemon's flag where it reports one, else this app's
  // own record of finishes and reads.
  const unreadNow = unreadAgents(agents, attention.unread, viewing, cleared);
  const unreadKey = [...unreadNow].sort().join("\n");
  // Preserve the unread set until its members change.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by its members
  const unread = useMemo(() => unreadNow, [unreadKey]);
  const { markSeen } = attention;
  const agentsNow = useRef(agents);
  agentsNow.current = agents;
  /** Mark agents read here and, where the daemon flagged them, in Paseo too. */
  const markRead = useCallback(
    (ids: string[]) => {
      markSeen(ids);
      const flagged = agentsNow.current.filter(
        (a) => ids.includes(a.id) && a.unread,
      );
      if (!flagged.length) return;
      setCleared((c) => ({
        ...c,
        ...Object.fromEntries(
          flagged.map((a) => [a.id, a.attentionTimestamp ?? null]),
        ),
      }));
      for (const a of flagged)
        void api(`agents/${a.id}/read`, a.host ? { host: a.host } : {}).catch(
          () =>
            // Still unread on the daemon: show it so.
            setCleared((c) => {
              if (c[a.id] !== (a.attentionTimestamp ?? null)) return c;
              const rest = { ...c };
              delete rest[a.id];
              return rest;
            }),
        );
    },
    [markSeen],
  );
  // Viewing an agent reads its reply, once per flagged finish (a failed
  // clear isn't retried until the agent is opened again).
  const viewed = viewing ? agents.find((a) => a.id === viewing) : undefined;
  const viewedKey = viewed?.unread
    ? `${viewed.id}\n${viewed.attentionTimestamp ?? ""}`
    : "";
  const viewedId = viewed?.id;
  useEffect(() => {
    if (!viewedKey || !viewedId) return;
    let done = false;
    const read = () => {
      if (done || document.hidden) return;
      done = true;
      markRead([viewedId]);
    };
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [viewedKey, viewedId, markRead]);
  // Queued messages go out as their agents become idle, whatever is open.
  useQueueRunner({
    agents,
    online: health?.connectedDaemon === "reachable",
    permissionAgents,
    onSent: refresh,
    onFailed: (message) => {
      soundEvent("actionFailed");
      setNotice(message);
    },
  });
  const fleetView = useFleetView();
  const { finishedAt } = attention;
  // J/K walk the list as shown: its grouping, order and collapsed groups.
  const fleet = useMemo(
    () =>
      groupAgents({
        agents,
        filter,
        search: "",
        permissionAgents,
        unread,
        finishedAt,
        projectOf,
        workspaceOf,
        realWorkspaces: realWorkspaceIds,
        view: fleetView.view,
        collapsed: fleetView.collapsed,
      }),
    [
      agents,
      filter,
      permissionAgents,
      unread,
      finishedAt,
      projectOf,
      workspaceOf,
      realWorkspaceIds,
      fleetView.view,
      fleetView.collapsed,
    ],
  );
  const order = fleet.order;
  const attentionAgents = useMemo(
    () => active.filter((a) => needsAttention(a, permissionAgents)),
    [active, permissionAgents],
  );
  // The tab title also counts unread finishes, as notifications do.
  const attentionCount = active.filter(
    (a) => needsAttention(a, permissionAgents) || unread.has(a.id),
  ).length;
  const filterCounts = useMemo(() => {
    const running = active.filter((a) => isWorking(a)).length;
    const unreadCount = active.filter(
      (a) => unread.has(a.id) && !needsAttention(a, permissionAgents),
    ).length;
    return {
      all: active.length,
      attention: attentionAgents.length,
      unread: unreadCount,
      running,
      // Nothing new: not working, nothing to read or answer.
      idle: active.filter(
        (a) =>
          !isWorking(a) &&
          !unread.has(a.id) &&
          !needsAttention(a, permissionAgents),
      ).length,
    };
  }, [active, attentionAgents, unread, permissionAgents]);
  useEffect(() => {
    document.title = attentionCount
      ? `(${attentionCount}) Paseo Command`
      : "Paseo Command · Agent operations";
  }, [attentionCount]);
  const rank = useCallback(
    (a: Agent) => attentionRank(a, { permissionAgents, unread }),
    [permissionAgents, unread],
  );

  const step = useCallback(
    (delta: number) => {
      if (!order.length) return;
      const index = order.findIndex((a) => a.id === selection?.id);
      const next =
        index < 0
          ? delta > 0
            ? 0
            : order.length - 1
          : (index + delta + order.length) % order.length;
      choose({ type: "agent", id: order[next].id });
    },
    [order, selection, choose],
  );
  const nextAttention = useCallback(() => {
    // In the listed order, cycling, then any the list doesn't show.
    const next = nextNeedingYou(order, attentionAgents, selection?.id, rank);
    if (next) choose({ type: "agent", id: next.id });
    else setNotice("All clear — nothing needs you right now.");
  }, [order, attentionAgents, selection, choose, rank]);

  const agent =
    selection?.type === "agent"
      ? agents.find((a) => a.id === selection.id)
      : undefined;
  // An open subagent conversation; gone (archived) falls back to the agent's.
  const subagent = selection?.subagent
    ? agent?.subagents?.find((s) => s.id === selection.subagent)
    : undefined;
  const workspace =
    selection?.type === "workspace"
      ? listedWorkspaces.find((w) => workspaceKey(w) === selection.id)
      : undefined;
  const project =
    selection?.type === "project"
      ? projects.find((p) => projectKey(p) === selection.id)
      : undefined;
  const online = health?.connectedDaemon === "reachable";
  // One detail view at a time: the selection is the active detail.
  const activeTarget = selection;
  const activeKey = activeTarget
    ? `${activeTarget.type}:${activeTarget.id}`
    : null;
  const detailLabel = (target: NonNullable<Selection>) => {
    if (target.type === "agent") {
      const row = agents.find((a) => a.id === target.id);
      return row ? agentName(row) : "Agent unavailable";
    }
    if (target.type === "workspace")
      return placeText(
        listedWorkspaces.find((w) => workspaceKey(w) === target.id)?.name,
        "Workspace",
      );
    return placeText(
      projects.find((p) => projectKey(p) === target.id)?.name,
      "Project",
    );
  };

  const openDispatch = useCallback(
    (target?: DispatchTarget) => {
      setDispatchRevision((revision) => revision + 1);
      if (target) return setDispatchTarget(target);
      const a =
        selection?.type === "agent"
          ? agents.find((x) => x.id === selection.id)
          : undefined;
      const ws = a ? workspaceOf(a) : workspace;
      if (ws && realWorkspaceIds.has(workspaceKey(ws)))
        return setDispatchTarget({ workspaceId: workspaceKey(ws) });
      const p = a
        ? projectOf(a)
        : project ||
          projects.find((x) => x.name === ws?.project && ws && sameHost(x, ws));
      setDispatchTarget(p ? { projectId: projectKey(p) } : {});
    },
    [
      selection,
      agents,
      workspaceOf,
      projectOf,
      workspace,
      project,
      projects,
      realWorkspaceIds,
    ],
  );

  // Cmd+N, and the native app's File > Dispatch Agent… (which takes the key
  // before WebKit), open the Dispatch Agent flow for the current selection
  // from any focus. An open dispatch keeps its draft; the archive dialog
  // stays modal.
  const newAgent = useRef(() => {});
  newAgent.current = () => {
    if (archiveWorkspace || dispatchTarget) return;
    openDispatch();
  };
  useEffect(() => {
    const offKey = installDispatchShortcut(window, () => newAgent.current());
    const offMenu = native
      ? nativeEvents((event) => {
          if (event.type === "menu" && event.action === "dispatch")
            newAgent.current();
        })
      : undefined;
    return () => {
      offKey();
      offMenu?.();
    };
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // Chrome autofill dispatches keydown events without a key.
      if (!e.key) return;
      const editing = target.matches("input,textarea,select,[contenteditable]");
      if (archiveWorkspace) {
        if (e.key === "Escape") setArchiveWorkspace(null);
        return;
      }
      // Dispatch owns Escape while its dialog is open.
      if (dispatchTarget) return;
      if (editing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Buttons, links and toggles keep their own Enter/Space behaviour.
      if (
        e.key === "Enter" &&
        target.closest("button,a,summary,[role=button],[role=radio],[role=tab]")
      )
        return;
      const key = e.key.toLowerCase();
      if (e.key === "Escape") {
        // Escape closes the innermost layer first (menus, pickers, image
        // previews) before navigating back.
        if (
          [
            ...document.querySelectorAll(
              ".popover-menu, .autocomplete, .lightbox, .inline-confirm",
            ),
          ].some((layer) => !layer.closest("[inert]"))
        )
          return;
        // A subagent's conversation goes back to its agent's, then the fleet.
        if (selection?.subagent) select({ ...selection, subagent: undefined });
        else if (selection) select(null);
      } else if (key === "d") {
        e.preventDefault();
        openDispatch();
      } else if (
        key === "t" &&
        (selection?.type === "agent" || selection?.type === "workspace")
      ) {
        // A new agent in the open agent's (or workspace's) workspace.
        e.preventDefault();
        openDispatch();
      } else if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        step(-1);
      } else if (key === "n") {
        e.preventDefault();
        nextAttention();
      } else if (
        (key === "r" || e.key === "Enter") &&
        selection?.type === "agent"
      ) {
        const composer =
          document.querySelector<HTMLTextAreaElement>("#composer");
        if (composer && !composer.disabled) {
          e.preventDefault();
          composer.focus();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    archiveWorkspace,
    dispatchTarget,
    selection,
    select,
    step,
    nextAttention,
    openDispatch,
  ]);
  // A file dropped outside the session would otherwise make
  // the browser navigate away to open it.
  useEffect(() => {
    const keep = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => {
      window.removeEventListener("dragover", keep);
      window.removeEventListener("drop", keep);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const respond = async (p: PendingPermission, allow: boolean) => {
    setBusy(true);
    try {
      await api(`agents/${p.agentId}/${allow ? "allow" : "deny"}`, {
        requestId: p.id,
        ...(p.host ? { host: p.host } : {}),
      });
      setPermissions((rows) => rows.filter((x) => x.id !== p.id));
      setNotice(allow ? `Approved ${p.name}` : `Denied ${p.name}`);
      await refresh();
    } catch (e) {
      soundEvent("actionFailed");
      setNotice(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  // Workspace archives run in the background (src/archives.ts): confirming
  // closes the dialog at once and the user carries on; the outcome arrives
  // as a toast. The same workspace is never archived twice at once.
  const archiveJobs = useArchiveJobs();
  const archiving = useMemo(
    () =>
      new Set(
        archiveJobs.filter((j) => j.status === "archiving").map((j) => j.key),
      ),
    [archiveJobs],
  );
  const openArchive = (w: Workspace) => {
    if (isArchiving(workspaceKey(w))) return;
    select({ type: "workspace", id: workspaceKey(w) });
    setDispatchTarget(null);
    setArchiveWorkspace(w);
  };
  const confirmArchive = () => {
    if (!archiveWorkspace) return;
    startArchive(archiveWorkspace);
    setArchiveWorkspace(null);
  };
  // Settle a finished archive with whatever is current now (the user may
  // have moved on, and the app may have re-rendered since it started).
  const settleArchive = useRef<(job: ArchiveJob) => void>(() => {});
  settleArchive.current = (job) => {
    if (job.status === "failed") {
      soundEvent("actionFailed");
      return;
    }
    setWorkspaces((previous) =>
      previous.filter((w) => workspaceKey(w) !== job.key),
    );
    // Leave the archived workspace (or one of its agents) only if it is
    // still what's open.
    const open = selected.current;
    const openAgent =
      open?.type === "agent" ? agents.find((a) => a.id === open.id) : null;
    const openWorkspace = openAgent ? workspaceOf(openAgent) : null;
    if (
      (open?.type === "workspace" && open.id === job.key) ||
      (openWorkspace && workspaceKey(openWorkspace) === job.key)
    )
      select(null);
    void refresh();
  };
  useEffect(() => onArchiveSettled((job) => settleArchive.current(job)), []);

  const onBack = useCallback(
    () => (unity ? setBrowsing(true) : select(null)),
    [select],
  );
  const position = {
    index: agent ? order.findIndex((a) => a.id === agent.id) : -1,
    total: order.length,
    prev: () => step(-1),
    next: () => step(1),
  };

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      <main
        className={`command-app${native ? ` native-command${unity ? " unity-command" : ""}` : ""}`}
        aria-label="Paseo Command"
      >
        {native && (
          <div className="native-world-frame">
            <React.Suspense fallback={null}>
              <NativeWorld
                hosts={hosts}
                projects={projects}
                workspaces={workspaces}
                agents={active}
                permissions={permissionAgents}
                questions={questionAgents}
                unread={unread}
                selection={selection}
                focusRevision={focusRevision}
                select={choose}
                host={hostFilter}
                chooseHost={chooseHost}
                hover={() => {}}
                onNotice={setNotice}
                blocked={!!archiveWorkspace || !!dispatchTarget}
              />
            </React.Suspense>
          </div>
        )}
        {errors.length > 0 && (
          <div className="connection-error" role="alert">
            <CircleAlert size={16} />
            <div>
              <b>Can’t reach part of Paseo</b>
              {placeText(errors[0], "A request failed.")}
              {errors.length > 1 && ` (+${errors.length - 1} more)`}
            </div>
            <button
              aria-description="Ask Paseo again now"
              className="secondary"
              onClick={() => void refresh()}
            >
              <RotateCw size={12} />
              Retry
            </button>
          </div>
        )}
        <FloatingPanel
          enabled={unity}
          activeKey={activeKey}
          activeLabel={
            activeTarget ? detailLabel(activeTarget) : "Active session"
          }
          hasActive={!!activeTarget}
          openRevision={focusRevision}
          revealRevision={revealRevision}
          browsing={browsing}
          onBrowse={() => {
            setTab("Workspaces");
            setBrowsing(true);
          }}
          onActive={() => {
            if (activeTarget) setBrowsing(false);
          }}
          onVisibility={setFloatingVisibility}
          tools={
            <FleetTools
              usage={usage}
              notifications={attention.notifications}
              onNotifications={() => void attention.requestNotifications()}
              sounds={<SoundControl />}
            />
          }
          attention={permissions.length}
          onAttention={() => {
            setTab("Agents");
            setFilter("attention");
            setBrowsing(true);
          }}
        >
          <AppPanel>
            <div
              className="app-workspace"
              data-browsing={browsing || !activeTarget}
            >
              <aside className="fleet-sidebar" aria-label="Fleet sidebar">
                <FleetSummary onDispatch={() => openDispatch()} />
                <Fleet
                  tab={tab}
                  setTab={setTab}
                  filter={filter}
                  setFilter={setFilter}
                  attention={fleet.attention}
                  unreadRows={fleet.unread}
                  groups={fleet.groups}
                  workspaces={listedWorkspaces}
                  realWorkspaceIds={realWorkspaceIds}
                  projects={projects}
                  hosts={hosts}
                  agents={active}
                  agentsAt={agentsAt}
                  permissions={permissions}
                  permissionAgents={permissionAgents}
                  unread={unread}
                  finishedAt={attention.finishedAt}
                  selection={selection}
                  select={choose}
                  hostFilter={hostFilter}
                  setHostFilter={setHostFilter}

                  onApprove={(p, allow) => void respond(p, allow)}
                  onMarkRead={markRead}
                  onArchiveWorkspace={openArchive}
                  archiving={archiving}
                  onDispatch={openDispatch}
                  workspaceOf={workspaceOf}
                  projectOf={projectOf}
                  counts={filterCounts}
                  loading={loading}
                  online={online}
                  busy={busy}
                  viewState={fleetView}
                />
              </aside>
              <section
                className="chat-workspace"
                aria-label="Open conversations"
              >
                <div className="detail-content" id="detail-panel">
                  {agent && subagent ? (
                    <SubagentSession
                      key={`${agent.id}:${subagent.id}`}
                      agent={agent}
                      subagent={subagent}
                      parentName={agentName(agent, workspaceOf(agent)?.branch)}
                      onParent={() => choose({ type: "agent", id: agent.id })}
                      onOpen={(id) =>
                        choose({ type: "agent", id: agent.id, subagent: id })
                      }
                      onNotice={setNotice}
                    />
                  ) : agent ? (
                    <Session
                      key={agent.id}
                      agent={agent}
                      workspace={workspaceOf(agent)}
                      waiting={permissionAgents.has(agent.id)}
                      online={online}
                      onBack={onBack}
                      onSelectWorkspace={() => {
                        const ws = workspaceOf(agent);
                        if (ws)
                          choose({ type: "workspace", id: workspaceKey(ws) });
                      }}
                      onNotice={setNotice}
                      onChanged={refresh}
                      onFreshDraft={(a) => {
                        const ws = workspaceOf(a);
                        const p = projectOf(a);
                        select(null);
                        openDispatch(
                          ws && realWorkspaceIds.has(workspaceKey(ws))
                            ? { workspaceId: workspaceKey(ws) }
                            : p
                              ? { projectId: projectKey(p) }
                              : {},
                        );
                      }}
                      onNewAgent={() => openDispatch()}
                      onOpenSubagent={(id) =>
                        choose({ type: "agent", id: agent.id, subagent: id })
                      }
                      position={position}
                    />
                  ) : workspace ? (
                    <WorkspaceView
                      workspace={workspace}
                      agents={agentsAt(workspaceKey(workspace))}
                      real={realWorkspaceIds.has(workspaceKey(workspace))}
                      busy={busy}
                      online={online}
                      onBack={onBack}
                      onDispatch={() => openDispatch()}
                      onArchive={() => openArchive(workspace)}
                      archiving={archiving.has(workspaceKey(workspace))}
                      onNotice={setNotice}
                      select={choose}

                      permissionAgents={permissionAgents}
                      unread={unread}
                    />
                  ) : project ? (
                    <ProjectView
                      project={project}
                      workspaces={listedWorkspaces.filter(
                        (w) =>
                          w.project === project.name && sameHost(w, project),
                      )}
                      agentsAt={agentsAt}
                      agents={active.filter((a) => projectOf(a) === project)}
                      onBack={onBack}
                      onDispatch={() =>
                        openDispatch({ projectId: projectKey(project) })
                      }
                      select={choose}

                      permissionAgents={permissionAgents}
                      unread={unread}
                    />
                  ) : (
                    <div className="chat-empty">
                      <MessageSquare
                        size={28}
                        strokeWidth={1.5}
                        aria-hidden="true"
                      />
                      <h2>
                        {activeTarget
                          ? "This item is no longer available"
                          : "Open a conversation"}
                      </h2>
                      <p>
                        {activeTarget
                          ? "Choose another item from the sidebar."
                          : "Select an agent from the sidebar to open its conversation."}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </AppPanel>
        </FloatingPanel>
        <div className="toast-stack">
          <AnimatePresence initial={false}>
            {archiveJobs.map((job) => (
              <ArchiveToast key={job.key} job={job} />
            ))}
          </AnimatePresence>
          <AnimatePresence>
            {notice && (
              <motion.div
                className="toast panel"
                role="status"
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 15 }}
              >
                <Info size={15} />
                {/* Messages (some from the server) never show IDs. */}
                {placeText(
                  notice,
                  "Something happened; details are in the session.",
                )}
                <button
                  data-tip="Dismiss"
                  className="icon-btn"
                  onClick={() => setNotice("")}
                  aria-label="Dismiss notification"
                >
                  <X size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <AnimatePresence>
          {archiveWorkspace && (
            <ArchiveWorkspaceDialog
              workspace={archiveWorkspace}
              agents={active.filter(
                (a) =>
                  a.cwd === archiveWorkspace.cwd &&
                  sameHost(a, archiveWorkspace),
              )}
              onCancel={() => setArchiveWorkspace(null)}
              onConfirm={confirmArchive}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {dispatchTarget && (
            <DispatchDialog
              key={`dispatch-${dispatchRevision}`}
              projects={projects}
              workspaces={workspaces}
              providers={providers}
              hosts={hosts}
              initial={dispatchTarget}
              fallback={busiestProject}
              online={online}
              onClose={() => setDispatchTarget(null)}
              onNotice={setNotice}
              onDispatched={async (rawId, host) => {
                const id = rawId ? agentClientId(rawId, host) : undefined;
                soundEvent("dispatched");
                setDispatchTarget(null);
                await refresh();
                if (id) select({ type: "agent", id });
              }}
            />
          )}
        </AnimatePresence>
        <TooltipLayer />
      </main>
    </MotionConfig>
  );
}
/** A background workspace archive: in progress, done, or failed with Retry. */
function ArchiveToast({ job }: { job: ArchiveJob }) {
  const name = placeText(job.workspace.name, "workspace");
  useEffect(() => {
    if (job.status !== "archived") return;
    const timer = setTimeout(() => dismissArchive(job.key), 5000);
    return () => clearTimeout(timer);
  }, [job.status, job.key]);
  const failed = job.status === "failed";
  return (
    <motion.div
      className={`toast panel archive-toast${failed ? " failed" : ""}`}
      role={failed ? "alert" : "status"}
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 15 }}
    >
      {job.status === "archiving" ? (
        <LoaderCircle size={15} className="spinning" />
      ) : failed ? (
        <CircleAlert size={15} />
      ) : (
        <CircleCheck size={15} />
      )}
      <span>
        {job.status === "archiving"
          ? `Archiving “${name}”…`
          : failed
            ? `Couldn’t archive “${name}”: ${placeText(job.error, "the request failed.")}`
            : `Archived workspace “${name}”`}
      </span>
      {failed && (
        <button
          className="secondary"
          aria-description={`Try archiving ${name} again`}
          onClick={() => startArchive(job.workspace)}
        >
          <RotateCw size={12} />
          Retry
        </button>
      )}
      {job.status !== "archiving" && (
        <button
          data-tip="Dismiss"
          className="icon-btn"
          onClick={() => dismissArchive(job.key)}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      )}
    </motion.div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
