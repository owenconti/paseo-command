import { useAsks } from "./useAsks";
import { useWorkingOn } from "./useWorkingOn";
import {
  hostWorldKey,
  macApp,
  nativeAvailable,
  nativeEvents,
  postAppMenu,
  postNative,
} from "./worldBridge";
import { installDispatchShortcut } from "./dispatchShortcut";
import {
  agentClientId,
  daemonAgentId,
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
import { RemoveProjectDialog } from "./RemoveProjectDialog";
import {
  dismissArchive,
  isArchiving,
  onArchiveSettled,
  startArchive,
  useArchiveJobs,
  type ArchiveJob,
} from "./archives";
import { SettingsControl } from "./SettingsControl";
import { setSoundSettings, useSoundSettings } from "./sounds";
import { setMusicSettings, useMusic } from "./music";
import { musicAvailable, musicCommand } from "./MusicBar";
import { openPresetEditor } from "./presetsStore";
import { copyText } from "./nativePlatform";
import { CommandPalette } from "./CommandPalette";
import { PresetsEditorHost } from "./PresetsEditor";
import { runAppCommand } from "./appCommands";
import type { Command } from "./palette";
import {
  linearKey,
  linearUrl,
  openExternal,
  useLinearIssue,
  useLinearWorkspace,
  usePullRequest,
} from "./links";
import { NewAgent, type DispatchTarget } from "./Dispatch";
import { useAppMode } from "./appMode";
import type { IssueContext } from "./linearIssues";
import { AddProject } from "./AddProject";
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
  requestRename,
  agentRenameTarget,
  withAgentRenames,
  withProjectRenames,
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
import { isRunning, isWorking, markDegraded, sameHost } from "./types";
import "@fontsource-variable/inter";
import "./style.css";
import "./app.css";
import "./themes.css";
import "./world-ui.css";
import { agentName, idLike, placeText, useKnownIds } from "./names";
import { PeersContext, type Peers } from "./peers";

installNativeLinks();
// The map surface (drawn by the macOS app) beside the inherited docked session layout.
const native = true;
const unity = true;
const NativeWorld = React.lazy(() =>
  import("./NativeWorld").then((module) => ({ default: module.NativeWorld })),
);
// The Linear tab, drawn over the map while the app's mode bar shows it.
const LinearView = React.lazy(() =>
  import("./LinearView").then((module) => ({ default: module.LinearView })),
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

/** Focus the chat input on screen (an agent's, a subagent's or a new one's);
 * false when none is shown. */
function focusComposer() {
  const composer = [
    ...document.querySelectorAll<HTMLTextAreaElement>("#composer"),
  ].find(
    (c) =>
      !c.disabled && !c.closest("[inert]") && c.getClientRects().length > 0,
  );
  composer?.focus();
  return !!composer;
}

function App() {
  const [liveAgents, setAgents] = useState<Agent[]>([]),
    [liveProjects, setProjects] = useState<Project[]>([]),
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
  const { projects, workspaces } = useMemo(
    () =>
      withProjectRenames(
        liveProjects,
        withRenames(liveWorkspaces, "workspace", workspaceKey, renames),
        renames,
      ),
    [liveProjects, liveWorkspaces, renames],
  );
  // Once saved, a rename is dropped when the fleet shows it (it may have
  // arrived before the answer).
  useEffect(() => {
    settleRenames(liveAgents, "agent", (a) => a.id);
    settleRenames(liveWorkspaces, "workspace", workspaceKey);
    settleRenames(liveProjects, "project", projectKey);
  }, [liveAgents, liveWorkspaces, liveProjects, renames]);
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
  // The app's Settings… (Cmd+,) opens the settings control in the
  // fleet sidebar: show the sidebar and expand the panel (SettingsControl opens).
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
    [addingProject, setAddingProject] = useState(false),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [archiveWorkspace, setArchiveWorkspace] = useState<Workspace | null>(
    null,
  );
  const [removeProject, setRemoveProject] = useState<Project | null>(null);
  // Projects (by key) whose removal is under way.
  const [removingProjects, setRemovingProjects] = useState<Set<string>>(
    () => new Set(),
  );
  /** A confirming dialog is open: it stays modal. */
  const confirming = !!archiveWorkspace || !!removeProject;
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
  const workingOn = useWorkingOn(active, permissionAgents);
  const asks = useAsks(active);
  // Idle agents whose last reply waits on you: they need you as approvals do.
  const askingKey = active
    .filter((a) => asks[a.id]?.waiting && !permissionAgents.has(a.id))
    .map((a) => a.id)
    .sort()
    .join("\n");
  const asking = useMemo(
    () => new Set(askingKey ? askingKey.split("\n") : []),
    [askingKey],
  );
  const needYou = useMemo(
    () => new Set([...permissionAgents, ...asking]),
    [permissionAgents, asking],
  );
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
    // Choosing anything leaves a new agent unstarted (its draft is kept).
    setDispatchTarget(null);
    setAddingProject(false);
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
  );
  const peers = useMemo<Peers>(() => {
    const byId = new Map(agents.map((a) => [daemonAgentId(a), a]));
    return {
      find: (id) => byId.get(id),
      open: (a) => choose({ type: "agent", id: a.id }),
    };
  }, [agents, choose]);
  /** Picking a host on the map selects it: the lists narrow to it and it
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
        permissionAgents: needYou,
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
      needYou,
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
    () => active.filter((a) => needsAttention(a, needYou)),
    [active, needYou],
  );
  // The tab title also counts unread finishes, as notifications do.
  const attentionCount = active.filter(
    (a) => needsAttention(a, needYou) || unread.has(a.id),
  ).length;
  const filterCounts = useMemo(() => {
    const running = active.filter((a) => isWorking(a)).length;
    const unreadCount = active.filter(
      (a) => unread.has(a.id) && !needsAttention(a, needYou),
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
          !needsAttention(a, needYou),
      ).length,
    };
  }, [active, attentionAgents, unread, needYou]);
  useEffect(() => {
    document.title = attentionCount
      ? `(${attentionCount}) Paseo Command`
      : "Paseo Command · Agent operations";
  }, [attentionCount]);
  const rank = useCallback(
    (a: Agent) => attentionRank(a, { permissionAgents: needYou, unread }),
    [needYou, unread],
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
  // The open agent's or workspace's PR and Linear issue, for G and L (the
  // same ones the session header's chips link to).
  const linkWorkspace = agent ? workspaceOf(agent) : workspace;
  const linkPr = usePullRequest(linkWorkspace ?? undefined);
  const issueKey =
    agent || workspace
      ? linearKey({
          branch: linkWorkspace?.branch || agent?.branch,
          prTitle: linkPr?.title,
          prBody: linkPr?.body,
          agentTitle: agent?.name,
        })
      : null;
  const linearSlugSetting = useLinearWorkspace();
  const linearIssue = useLinearIssue(issueKey);
  const issueUrl = issueKey
    ? (linearSlugSetting && linearUrl(linearSlugSetting, issueKey)) ||
      linearIssue?.url ||
      null
    : null;
  const online = health?.connectedDaemon === "reachable";
  // One detail view at a time: the selection is the active detail.
  const activeTarget = selection;
  const activeKey = addingProject
    ? "add-project"
    : dispatchTarget
    ? "new-agent"
    : activeTarget
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
      // The New agent view opens in the panel, in place of the conversation.
      setDispatchRevision((revision) => revision + 1);
      setAddingProject(false);
      setBrowsing(false);
      setFocusRevision((revision) => revision + 1);
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

  // The mode bar's tab (macOS app): Linear draws its issues in the map's place.
  const appMode = useAppMode();
  // From a Linear issue: New agent, where the host and project are chosen.
  const launchFromIssue = useCallback(
    (issue: IssueContext) => openDispatch({ issue }),
    [openDispatch],
  );

  // Cmd+N, and the native app's File > Dispatch Agent… (which takes the key
  // before WebKit), open the Dispatch Agent flow for the current selection
  // from any focus. An open dispatch keeps its draft; the archive dialog
  // stays modal.
  const newAgent = useRef(() => {});
  newAgent.current = () => {
    if (confirming) return;
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
      if (confirming) {
        if (e.key === "Escape") {
          setArchiveWorkspace(null);
          setRemoveProject(null);
        }
        return;
      }
      if (editing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Escape leaves a new agent (or project) unstarted, back to what was open.
      if (addingProject && e.key === "Escape") {
        setAddingProject(false);
        setBrowsing(!selection);
        return;
      }
      if (dispatchTarget && e.key === "Escape") {
        setDispatchTarget(null);
        setBrowsing(!selection);
        return;
      }
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
      } else if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        step(1);
      } else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        step(-1);
      } else if (key === "n") {
        e.preventDefault();
        nextAttention();
      } else if (key === "g" && linkPr) {
        e.preventDefault();
        openExternal(linkPr.url);
      } else if (key === "l" && issueKey) {
        e.preventDefault();
        if (issueUrl) openExternal(issueUrl);
        // Without a Linear workspace yet, the header chip asks for it.
        else document.querySelector<HTMLElement>("button.linear-chip")?.click();
      } else if (
        e.key === "Enter" ||
        (key === "r" && selection?.type === "agent")
      ) {
        if (focusComposer()) e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    confirming,
    dispatchTarget,
    addingProject,
    selection,
    select,
    step,
    nextAttention,
    openDispatch,
    linkPr,
    issueKey,
    issueUrl,
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
  // Removing a project archives its workspaces on the daemon, which can take
  // a while: the dialog closes at once and the outcome arrives as a notice.
  const openRemoveProject = (p: Project) => {
    if (removingProjects.has(projectKey(p))) return;
    select({ type: "project", id: projectKey(p) });
    setDispatchTarget(null);
    setRemoveProject(p);
  };
  const confirmRemoveProject = async () => {
    const p = removeProject;
    if (!p) return;
    setRemoveProject(null);
    const key = projectKey(p);
    const name = placeText(p.name, "Project");
    setRemovingProjects((s) => new Set(s).add(key));
    try {
      await api(`projects/${encodeURIComponent(p.projectId)}/remove`, {
        confirm: true,
        ...(p.host ? { host: p.host } : {}),
      });
      setProjects((previous) => previous.filter((x) => projectKey(x) !== key));
      setSelection((current) =>
        current?.type === "project" && current.id === key ? null : current,
      );
      setNotice(`Removed project ${name}. Its folder stays on disk.`);
    } catch (error) {
      soundEvent("actionFailed");
      setNotice(
        `Couldn’t remove ${name}: ${errorMessage(error) || "the request failed."}`,
      );
    } finally {
      setRemovingProjects((s) => {
        const next = new Set(s);
        next.delete(key);
        return next;
      });
    }
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
  const sounds = useSoundSettings();
  const radio = useMusic();
  const addProject = () => {
    setAddingProject(true);
    setBrowsing(false);
    setFocusRevision((revision) => revision + 1);
  };
  // The command palette (Cmd+K): what the app's keys and buttons do, for
  // what is open now, then (found by searching) every agent and place.
  const archivable =
    linkWorkspace && realWorkspaceIds.has(workspaceKey(linkWorkspace))
      ? linkWorkspace
      : undefined;
  const showList = (t: Tab, f?: Filter) => {
    setTab(t);
    if (f) setFilter(f);
    setBrowsing(true);
  };
  /** The open agent's own buttons and row actions, for the palette. */
  const agentCommands = (a: Agent): Command[] => {
    const name = agentName(a, workspaceOf(a)?.branch);
    const running = isRunning(a.status);
    const permission = permissions.find((p) => p.agentId === a.id);
    const asking =
      permission && (permission.kind === "question" || permission.questions?.length);
    const live = online && !a.stale;
    return [
      ...(permission && !asking
        ? [
            {
              id: "approve",
              group: "Actions",
              label: `Approve ${permission.name}`,
              keywords: "allow permission yes",
              run: () => void respond(permission, true),
            },
            {
              id: "deny",
              group: "Actions",
              label: `Deny ${permission.name}`,
              keywords: "reject permission no",
              run: () => void respond(permission, false),
            },
          ]
        : []),
      ...(unread.has(a.id)
        ? [
            {
              id: "read",
              group: "Actions",
              label: "Mark the agent as read",
              keywords: "unread seen",
              run: () => markRead([a.id]),
            },
          ]
        : []),
      ...(live && running
        ? [
            {
              id: "interrupt",
              group: "Actions",
              label: "Interrupt the agent",
              keywords: "stop cancel halt",
              run: () => runAppCommand("agent-interrupt"),
            },
          ]
        : []),
      ...(live
        ? [
            {
              id: "rename-agent",
              group: "Actions",
              label: `Rename “${name}”…`,
              keywords: "title name agent",
              run: () => {
                const target = agentRenameTarget(a);
                requestRename(target.kind, target.key);
              },
            },
            ...(!running
              ? [
                  {
                    id: "archive-agent",
                    group: "Actions",
                    label: `Archive “${name}”…`,
                    keywords: "remove delete agent",
                    run: () => runAppCommand("agent-archive"),
                  },
                ]
              : []),
          ]
        : []),
      {
        id: "open-paseo",
        group: "Actions",
        label: "Open the agent in Paseo",
        keywords: "app external",
        run: () => runAppCommand("agent-open-paseo"),
      },
      {
        id: "copy-agent-id",
        group: "Actions",
        label: "Copy the agent's ID",
        keywords: "clipboard identifier",
        run: () =>
          void copyText(daemonAgentId(a)).then(
            () => setNotice("Copied the agent's ID"),
            () => {},
          ),
      },
    ];
  };
  const paletteCommands: Command[] = [
    {
      id: "new-agent",
      group: "Actions",
      label: "New agent",
      keys: [["⌘", "N"]],
      keywords: "dispatch start worktree branch pull request PR",
      run: () => openDispatch(),
    },
    {
      id: "add-project",
      group: "Actions",
      label: "Add project",
      keywords: "clone folder repository",
      run: addProject,
    },
    ...(agent || dispatchTarget
      ? [
          {
            id: "composer",
            group: "Actions",
            label: agent
              ? "Reply to the selected agent"
              : "Focus the message box",
            keys: [["⌘", "L"]],
            keywords: "message composer type",
            run: focusComposer,
          },
        ]
      : []),
    ...(linkPr
      ? [
          {
            id: "pr",
            group: "Actions",
            label: `Open pull request #${linkPr.number}`,
            keys: [["G"]],
            keywords: "github pr",
            run: () => openExternal(linkPr.url),
          },
        ]
      : []),
    ...(issueKey
      ? [
          {
            id: "linear",
            group: "Actions",
            label: `Open Linear issue ${issueKey}`,
            keys: [["L"]],
            run: () =>
              issueUrl
                ? openExternal(issueUrl)
                : document
                    .querySelector<HTMLElement>("button.linear-chip")
                    ?.click(),
          },
        ]
      : []),
    ...(unread.size
      ? [
          {
            id: "read-all",
            group: "Actions",
            label: "Mark all as read",
            keywords: "unread clear",
            run: () => markRead([...unread]),
          },
        ]
      : []),
    ...(archivable && !archiving.has(workspaceKey(archivable))
      ? [
          {
            id: "archive",
            group: "Actions",
            label: `Archive workspace “${placeText(archivable.name, "workspace")}”…`,
            keywords: "remove delete",
            run: () => openArchive(archivable),
          },
        ]
      : []),
    ...(project && online && !removingProjects.has(projectKey(project))
      ? [
          {
            id: "rename-project",
            group: "Actions",
            label: `Rename project “${placeText(project.name, "project")}”…`,
            keywords: "title name",
            run: () => requestRename("project", projectKey(project)),
          },
          {
            id: "remove-project",
            group: "Actions",
            label: `Remove project “${placeText(project.name, "project")}”…`,
            keywords: "delete archive unregister",
            run: () => openRemoveProject(project),
          },
        ]
      : []),
    ...(agent ? agentCommands(agent) : []),
    ...(workspace &&
    online &&
    realWorkspaceIds.has(workspaceKey(workspace))
      ? [
          {
            id: "rename-workspace",
            group: "Actions",
            label: `Rename workspace “${placeText(workspace.name, "workspace")}”…`,
            keywords: "title name",
            run: () => requestRename("workspace", workspaceKey(workspace)),
          },
        ]
      : []),
    ...(errors.length
      ? [
          {
            id: "retry",
            group: "Actions",
            label: "Retry reaching Paseo",
            keywords: "refresh reconnect",
            run: () => void refresh(),
          },
        ]
      : []),
    {
      id: "next",
      group: "Navigate",
      label: "Next agent",
      keys: [["J"]],
      run: () => step(1),
    },
    {
      id: "previous",
      group: "Navigate",
      label: "Previous agent",
      keys: [["K"]],
      run: () => step(-1),
    },
    {
      id: "next-attention",
      group: "Navigate",
      label: "Next agent that needs you",
      keys: [["N"]],
      keywords: "attention approval question",
      run: nextAttention,
    },
    ...(selection
      ? [
          {
            id: "back",
            group: "Navigate",
            label: selection.subagent
              ? "Back to the parent agent"
              : "Close the open item",
            keys: [["Esc"]],
            keywords: "back deselect",
            run: () =>
              select(
                selection.subagent
                  ? { ...selection, subagent: undefined }
                  : null,
              ),
          },
        ]
      : []),
    ...(macApp()
      ? [
          {
            id: "fit",
            group: "Navigate",
            label: "Fit the whole map",
            keys: [["F"]],
            keywords: "zoom home world",
            run: () => runAppCommand("fit-world"),
          },
        ]
      : []),
    ...(["Agents", "Workspaces", "Projects", "Hosts"] as const).map((t) => ({
      id: `tab-${t}`,
      group: "Lists",
      label: `Show ${t.toLowerCase()}`,
      keywords: "tab list",
      run: () => showList(t),
    })),
    ...(
      [
        [
          "attention",
          "Show agents that need you",
          "approvals questions attention",
        ],
        ["unread", "Show unread agents", "finished"],
        ["running", "Show running agents", "working busy"],
        ["idle", "Show idle agents", ""],
        ["all", "Show all active agents", "filter"],
      ] as const
    ).map(([f, label, keywords]) => ({
      id: `filter-${f}`,
      group: "Lists",
      label,
      keywords: `filter ${keywords}`,
      run: () => showList("Agents", f),
    })),
    ...(hostFilter !== null
      ? [
          {
            id: "all-hosts",
            group: "Lists",
            label: "Show every host",
            keywords: "filter clear",
            run: () => setHostFilter(null),
          },
        ]
      : []),
    {
      id: "panel",
      group: "App",
      label: "Show or hide the panel",
      keys: [["⌘", "B"]],
      keywords: "sidebar collapse react conquer",
      run: () => runAppCommand("toggle-panel"),
    },
    ...(macApp()
      ? [
          {
            id: "terminal",
            group: "App",
            label: "Show or hide the terminal",
            keys: [["⌃", "`"]],
            keywords: "shell console",
            run: () => postAppMenu("terminal"),
          },
          ...(
            [
              ["terminal-dock", "Move the terminal (right or bottom)", "dock side bottom right", undefined],
              ["terminal-maximize", "Maximize the terminal", "full expand restore", ["⇧", "⌘", "↩"]],
              ["terminal-unsplit", "Unsplit terminals", "panes merge split", undefined],
              ["terminal-bigger", "Bigger terminal text", "zoom font size larger", ["⌘", "+"]],
              ["terminal-smaller", "Smaller terminal text", "zoom font size", ["⌘", "−"]],
              ["terminal-actual", "Actual terminal text size", "zoom font reset", ["⌘", "0"]],
              ["mode-next", "Next in the map's place: map, browser, Linear", "switch rotate cycle mode tab conquer linear command", ["⌘", "`"]],
              ["conquer", "Show the browser (Conquer)", "conquer browser mode web", undefined],
              ["conquer-tab", "New Conquer tab", "browser web open", undefined],
              ["conquer-sidebar", "Show or hide Conquer’s tab sidebar", "browser tabs collapse", ["⌘", "S"]],
              ["zen-cookies", "Import Zen cookies into Conquer", "browser sign in login sessions confirmation", undefined],
            ] as const
          ).map(([action, label, keywords, keys]) => ({
            id: action,
            group: "App",
            label,
            keys: keys && [[...keys]],
            keywords,
            run: () => postAppMenu(action),
          })),
          ...(appMode !== "linear"
            ? [
                {
                  id: "linear-show",
                  group: "App",
                  label: "Show your Linear issues",
                  keywords: "linear issues tickets assigned tasks mode tab",
                  run: () => postAppMenu("linear"),
                },
              ]
            : [
                {
                  id: "linear-sidebar",
                  group: "App",
                  label: "Show or hide the Linear issue list",
                  keys: [["⌘", "S"]],
                  keywords: "linear sidebar list collapse panel",
                  run: () => runAppCommand("linear-sidebar"),
                },
                {
                  id: "linear-refresh",
                  group: "App",
                  label: "Refresh Linear issues",
                  keywords: "linear issues reload update",
                  run: () => runAppCommand("linear-refresh"),
                },
              ]),
          ...(appMode !== "command"
            ? [
                {
                  id: "command-show",
                  group: "App",
                  label: "Show the map",
                  keywords: "command atlas world mode tab",
                  run: () => postAppMenu("command"),
                },
              ]
            : []),
          {
            id: "restart",
            group: "App",
            label: "Restart app",
            keywords: "reload update refresh latest build",
            run: () => postAppMenu("reload"),
          },
        ]
      : []),
    {
      id: "sounds",
      group: "App",
      label: sounds.enabled ? "Turn sounds off" : "Turn sounds on",
      keywords: "audio mute volume",
      run: () => setSoundSettings({ enabled: !sounds.enabled }),
    },
    ...(attention.notifications !== "unsupported" &&
    attention.notifications !== "denied"
      ? [
          {
            id: "notifications",
            group: "App",
            label:
              attention.notifications === "granted"
                ? "Turn desktop notifications off"
                : "Turn desktop notifications on",
            keywords: "bell alerts",
            run: () => void attention.requestNotifications(),
          },
        ]
      : []),
    {
      id: "settings",
      group: "App",
      label: "Settings",
      keywords: "preferences sounds music notifications linear",
      run: () => {
        setBrowsing(true);
        setRevealRevision((revision) => revision + 1);
        runAppCommand("show-settings");
      },
    },
    {
      id: "presets",
      group: "App",
      label: "Edit preset prompts…",
      keywords: "presets templates settings",
      run: openPresetEditor,
    },
    {
      id: "radio",
      group: "App",
      label: radio.enabled ? "Turn the lofi radio off" : "Turn the lofi radio on",
      keywords: "music stream audio",
      run: () => setMusicSettings({ enabled: !radio.enabled }),
    },
    ...(musicAvailable()
      ? (
          [
            ["playpause", "Play or pause Apple Music"],
            ["next", "Next track in Apple Music"],
            ["previous", "Previous track in Apple Music"],
          ] as const
        ).map(([name, label]) => ({
          id: `music-${name}`,
          group: "App",
          label,
          keywords: "music song skip",
          run: () => musicCommand(name),
        }))
      : []),
    {
      id: "games",
      group: "App",
      label: "Open the mini games",
      keys: [["B"]],
      keywords: "play game break",
      run: () => runAppCommand("show-games"),
    },
    ...(!(unity && floatingVisibility.collapsed)
      ? [
          {
            id: "releases",
            group: "App",
            label: "What's new",
            keywords: "release notes version update changelog",
            run: () => runAppCommand("show-releases"),
          },
        ]
      : []),
    {
      id: "shortcuts",
      group: "App",
      label: "Keyboard shortcuts",
      keys: [["?"]],
      keywords: "keys help",
      run: () => runAppCommand("show-shortcuts"),
    },
    ...active.map((a) => {
      const ws = workspaceOf(a);
      return {
        id: `agent:${a.id}`,
        group: "Agents",
        label: agentName(a, ws?.branch),
        detail: [ws?.project, placeText(ws?.name, "")]
          .filter(Boolean)
          .join(" · "),
        searchOnly: true,
        run: () => choose({ type: "agent", id: a.id }),
      };
    }),
    ...listedWorkspaces.map((w) => ({
      id: `workspace:${workspaceKey(w)}`,
      group: "Workspaces",
      label: placeText(w.name, "Workspace"),
      detail: [w.project, w.branch !== w.name ? w.branch : ""]
        .filter(Boolean)
        .join(" · "),
      searchOnly: true,
      run: () => choose({ type: "workspace", id: workspaceKey(w) }),
    })),
    ...projects.map((p) => ({
      id: `project:${projectKey(p)}`,
      group: "Projects",
      label: placeText(p.name, "Project"),
      searchOnly: true,
      run: () => choose({ type: "project", id: projectKey(p) }),
    })),
    ...(hosts.length > 1
      ? hosts.map((h) => ({
          id: `host:${h.serverId}`,
          group: "Hosts",
          label: h.label || (h.local ? "This computer" : "Host"),
          detail: h.local ? "local" : undefined,
          keywords: "host filter",
          searchOnly: true,
          run: () => {
            setHostFilter(h.local ? "" : h.serverId);
            setBrowsing(true);
            if (nativeAvailable()) soundEvent("focused");
            postNative({
              type: "camera",
              command: {
                type: "focus",
                target: { kind: "host", key: hostWorldKey(h) },
              },
            });
          },
        }))
      : []),
  ];
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
                workingOn={workingOn}
                hosts={hosts}
                projects={projects}
                workspaces={workspaces}
                agents={active}
                permissions={permissionAgents}
                questions={questionAgents}
                asking={asking}
                unread={unread}
                selection={selection}
                focusRevision={focusRevision}
                select={choose}
                host={hostFilter}
                chooseHost={chooseHost}
                hover={() => {}}
                onNotice={setNotice}
                blocked={confirming}
                loaded={!loading}
              />
            </React.Suspense>
            {appMode === "linear" && (
              <React.Suspense fallback={null}>
                <LinearView onLaunch={launchFromIssue} />
              </React.Suspense>
            )}
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
            addingProject
              ? "Add project"
              : dispatchTarget
              ? "New agent"
              : activeTarget
                ? detailLabel(activeTarget)
                : "Active session"
          }
          hasActive={!!activeTarget || !!dispatchTarget || addingProject}
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
              settings={
                <SettingsControl
                  notifications={attention.notifications}
                  onNotifications={() => void attention.requestNotifications()}
                />
              }
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
              data-browsing={
                browsing || (!activeTarget && !dispatchTarget && !addingProject)
              }
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
                  permissionAgents={needYou}
                  asking={asking}
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
                  onRemoveProject={openRemoveProject}
                  removingProjects={removingProjects}
                  onDispatch={openDispatch}
                  onAddProject={addProject}
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
                  {addingProject ? (
                    <AddProject
                      hosts={hosts}
                      projects={projects}
                      initialHost={hostFilter}
                      online={online}
                      onClose={() => {
                        setAddingProject(false);
                        setBrowsing(!selection);
                      }}
                      onNotice={setNotice}
                      onAdded={async (projectId, host) => {
                        await refresh();
                        // A new project has no workspace (so no place on the
                        // map): its first agent makes one.
                        openDispatch({ projectId: projectKey({ projectId, host }) });
                      }}
                    />
                  ) : dispatchTarget ? (
                    <NewAgent
                      key={`dispatch-${dispatchRevision}`}
                      projects={projects}
                      workspaces={workspaces}
                      providers={providers}
                      hosts={hosts}
                      initial={dispatchTarget}
                      fallback={busiestProject}
                      online={online}
                      onClose={() => {
                        setDispatchTarget(null);
                        setBrowsing(!selection);
                      }}
                      onNotice={setNotice}
                      onDispatched={async (rawId, host) => {
                        const id = rawId ? agentClientId(rawId, host) : undefined;
                        soundEvent("dispatched");
                        setDispatchTarget(null);
                        await refresh();
                        if (id) select({ type: "agent", id });
                        else setBrowsing(!selection);
                      }}
                    />
                  ) : agent && subagent ? (
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
                    <PeersContext.Provider value={peers}>
                      <Session
                        workingOn={workingOn[agent.id]}
                        asks={asks[agent.id]}
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
                        onFreshDraft={(a, settings) => {
                          const ws = workspaceOf(a);
                          const p = projectOf(a);
                          select(null);
                          openDispatch({
                            ...(ws && realWorkspaceIds.has(workspaceKey(ws))
                              ? { workspaceId: workspaceKey(ws) }
                              : p
                                ? { projectId: projectKey(p) }
                                : {}),
                            settings,
                          });
                        }}
                        onNewAgent={() => openDispatch()}
                        onOpenSubagent={(id) =>
                          choose({ type: "agent", id: agent.id, subagent: id })
                        }
                        position={position}
                      />
                    </PeersContext.Provider>
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
                      online={online}
                      onBack={onBack}
                      onDispatch={() =>
                        openDispatch({ projectId: projectKey(project) })
                      }
                      onRemove={() => openRemoveProject(project)}
                      removing={removingProjects.has(projectKey(project))}
                      onNotice={setNotice}
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
          {removeProject && (
            <RemoveProjectDialog
              project={removeProject}
              workspaces={listedWorkspaces.filter(
                (w) =>
                  realWorkspaceIds.has(workspaceKey(w)) &&
                  w.project === removeProject.name &&
                  sameHost(w, removeProject),
              )}
              agents={active.filter((a) => projectOf(a) === removeProject)}
              onCancel={() => setRemoveProject(null)}
              onConfirm={() => void confirmRemoveProject()}
            />
          )}
        </AnimatePresence>
        <PresetsEditorHost />
        <CommandPalette
          commands={paletteCommands}
          blocked={confirming}
        />
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
