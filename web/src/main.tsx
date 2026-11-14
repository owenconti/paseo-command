import { modalOpen } from "./focus";
import { isTyping } from "./worldShortcut";
import "./mermaid/mermaid.css";
import { mermaidPalette, useMermaidCommands } from "./mermaidCommands";
import { useMapBridge } from "./mapBridge";
import { conversationOrder } from "./conversationOrder";
import {
  browserFollowsSetting,
  setBrowserFollows,
  setBrowserOpen,
  setBrowserTools,
  useBrowserFollows,
  useBrowserOpen,
  useBrowserTools,
} from "./browser/settings";
import { browserDo, browserKey, onBrowserEvent, postBrowserHost, tabLabel, useBoardBrowsers } from "./browser/browserBridge";
import { useAsks } from "./useAsks";
import { useWorkingOn } from "./useWorkingOn";
import {
  macApp,
  nativeEvents,
  postAppActivity,
  postAppLink,
  postAppMenu,
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
import { ReleasePoolDialog } from "./ReleasePoolDialog";
import { onPoolJobEnd, releasePoolBox, usePool } from "./poolStore";
import {
  archiveWorkspace as archiveWithPool,
  onPoolArchiveNotice,
  onReleaseAsk,
  releaseAfterArchive,
  type ReleaseAsk,
} from "./poolArchive";
import { idleBoxes, jobRunning, jobText, type PoolBox } from "./pool";
import {
  dismissArchive,
  isArchiving,
  onArchiveSettled,
  useArchiveJobs,
  type ArchiveJob,
} from "./archives";
import { SettingsPage } from "./SettingsPage";
import { closeSettings, openSettings, useSettingsShown } from "./settingsStore";
import { usePageTextKeys } from "./pageText";
import { setSoundSettings, useSoundSettings } from "./sounds";
import { setMusicSettings, useMusic } from "./music";
import { setIntegration, useIntegrations } from "./integrationSettings";
import { openPresetEditor } from "./presetsStore";
import { copyText } from "./nativePlatform";
import { CommandPalette } from "./CommandPalette";
import { PresetsEditorHost } from "./PresetsEditor";
import { ProfilesEditorHost } from "./ProfilesEditor";
import { openProfileEditor } from "./profilesStore";
import { isBranchChangesShortcut, isFilesShortcut, onAppCommand, runAppCommand, type AppCommand } from "./appCommands";
import type { Command, Page } from "./palette";
import {
  linearKey,
  linearUrl,
  openExternal,
  useLinearIssue,
  useLinearWorkspace,
  usePullRequest,
} from "./links";
import { NewAgent, POOL, type DispatchTarget, type DraftSettings } from "./Dispatch";
import { installPageRefresh } from "./pageRefresh";
import { appTabs, modeKey, shownModes, useAppMode, type AppMode } from "./appMode";
import type { ActivityViewState } from "./activity/ActivityView";
import type { GithubViewState } from "./github/GitHubView";
import { openFilesChanges } from "./files/open";
import type { FilesViewState } from "./files/FilesView";
import { pendingLabel } from "./github/localComments";
import { useLocalComments } from "./github/localCommentsStore";
import { openGithubPlace, prPlaceOf } from "./github/place";
import { paseoMatches, type PaseoMatch, type PrHead } from "./github/paseo";
import { MODE_LABEL as CHANGES_MODE_LABEL, SCOPE_TITLE as PR_SCOPE_TITLE, TAB_LABEL as PR_TAB_LABEL } from "./github/names";
import type { MergeAction } from "./github/merge";
import { FILTERS as PR_FILTERS, fieldLabel as prFieldLabel, filtersSet as prFiltersSet, ME as PR_ME, PEOPLE_FIELDS as PR_PEOPLE_FIELDS, VALUE_FIELDS as PR_VALUE_FIELDS } from "./github/filters";
import { useActivityUnread } from "./activity/store";
import { SOURCE_LABEL } from "./activity/rows";
import { createGithubToken } from "./GithubTokenSetup";
import { useAppUpdate } from "./releases";
import { AddProject } from "./AddProject";
import {
  attentionRank,
  needsAttention,
  nextNeedingYou,
  unreadAgents,
} from "./fleetView";
import { ProjectView, WorkspaceView } from "./PlaceView";
import { FloatingPanel } from "./FloatingPanel";
import { AppPanel } from "./AppPanel";
import { CrewDetail } from "./crew/CrewDetail";
import { CrewMap } from "./crew/CrewMap";
import { Session } from "./Session";
import { SubagentSession } from "./Subagents";
import {
  api,
  errorMessage,
  readStore,
  writeStore,
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
// The palette's page for each of the mode bar's places (its entries for the page on screen win ties).
const MODE_PAGES: Record<AppMode, Page> = {
  command: "Command",
  conquer: "Conquer",
  activity: "Activity",
  github: "GitHub",
  files: "Files",
  terminal: "Terminal",
  settings: "Settings",
};
// The map's place (Crew, on the Command tab) beside the docked session panel (the other tabs').
const native = true;
const unity = true;
/** The browser attached to the open agent, beside its conversation on Crew (src/browser/). */
const BoardBrowser = React.lazy(() =>
  import("./browser/BoardBrowser").then((module) => ({ default: module.BoardBrowser })),
);
// The Activity tab (GitHub and Linear notifications), drawn over the map while the app's mode bar shows it.
const ActivityView = React.lazy(() =>
  import("./activity/ActivityView").then((module) => ({ default: module.ActivityView })),
);
// The GitHub tab (pull requests to review, the selected workspace's changes), likewise.
const GitHubView = React.lazy(() =>
  import("./github/GitHubView").then((module) => ({ default: module.GitHubView })),
);
// The Files tab (the selected workspace's files, read only), likewise.
const FilesView = React.lazy(() =>
  import("./files/FilesView").then((module) => ({ default: module.FilesView })),
);

/** Keeps the mode bar's Activity tab showing the feed's unread count (macOS app only). */
function ActivityBadge() {
  const unread = useActivityUnread();
  useEffect(() => {
    postAppActivity(unread ?? 0);
  }, [unread]);
  return null;
}

/** ⌘K's words for the open PR's merge box actions. */
const PR_ACTION_WORDS: Record<MergeAction["kind"], string> = {
  merge: "merge squash rebase commit land ship confirm",
  auto: "auto-merge automerge auto merge when ready checks pass enable",
  "auto-off": "auto-merge automerge disable turn off cancel stop",
  queue: "merge queue enqueue add when ready land",
  dequeue: "merge queue dequeue remove leave",
  ready: "ready for review undraft publish draft",
  draft: "convert to draft work in progress wip",
  update: "update branch behind base sync main merge rebase out of date",
  close: "close pull request reject abandon comment",
  reopen: "reopen pull request open again",
  "delete-branch": "delete branch remove head ref cleanup",
};
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

/** The workspace selected on the map or in the panel (or the open agent's): the Files tab's, and its PR's for ⌘K. */
type SelectedWorkspace = {
  id: string;
  host?: string;
  name: string;
  branch?: string;
  /** Its PR, as the panel knows it. */
  pr?: { number: number; url: string; title: string } | null;
};

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
  // Rises with each new choice: the session panel shows it, opening if it was hidden.
  const [focusRevision, setFocusRevision] = useState(initial.selection ? 1 : 0);
  const [dispatchRevision, setDispatchRevision] = useState(0);
  const [floatingVisibility, setFloatingVisibility] = useState({
    compact: true,
    collapsed:
      unity &&
      readStore<{ collapsed?: boolean } | null>("unity-panel", null)
        ?.collapsed === true,
  });
  const [selection, setSelection] = useState<Selection>(initial.selection);
  // Kept in the URL: a new selection is a new history entry (Back returns to
  // the last); a subagent's opening or closing replaces the current one.
  const shownPlace = useRef(placeKey(initial.selection));
  useEffect(() => {
    const search = urlSearch({ selection });
    if (search === location.search) return;
    const place = placeKey(selection);
    const url = `${location.pathname}${search}${location.hash}`;
    if (place !== shownPlace.current) history.pushState(null, "", url);
    else history.replaceState(null, "", url);
    shownPlace.current = place;
  }, [selection]);
  useEffect(() => {
    const restore = () => {
      const state = readUrlState();
      shownPlace.current = placeKey(state.selection);
      setSelection(state.selection);
      if (state.selection) setFocusRevision((revision) => revision + 1);
    };
    addEventListener("popstate", restore);
    return () => removeEventListener("popstate", restore);
  }, []);
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
  // A claimed pool box whose release is being confirmed (`ask`: after its last workspace was archived).
  const [releaseBox, setReleaseBox] = useState<PoolBox | null>(null);
  const [releaseAsk, setReleaseAsk] = useState<ReleaseAsk | null>(null);
  // Projects (by key) whose removal is under way.
  const [removingProjects, setRemovingProjects] = useState<Set<string>>(
    () => new Set(),
  );
  /** A confirming dialog is open: it stays modal. */
  const confirming = !!archiveWorkspace || !!removeProject || !!releaseBox;
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
  const {
    integrations,
    loaded: integrationsLoaded,
    saving: integrationsSaving,
  } = useIntegrations();
  const asks = useAsks(active, integrations.typesafe);
  // Pool boxes (src/pool.ts): claimed from New agent, released from its host in the crew.
  const pool = usePool(integrations.pool);
  const poolBoxes = integrations.pool && pool?.enabled && !pool.problem ? pool.boxes : [];
  const poolJob = jobRunning(pool?.job) ? pool!.job : null;
  useEffect(
    () =>
      onPoolJobEnd((job) => {
        if (job.phase === "failed") soundEvent("actionFailed");
        setNotice(jobText(job));
        void liveFleet.current?.refresh();
      }),
    [],
  );
  const openReleasePool = (box: PoolBox) => {
    if (poolJob) return setNotice(jobText(poolJob));
    setReleaseBox(box);
  };
  // Archiving a pool box's last workspace releases it, asking first when its checkout had unpushed work.
  useEffect(() => {
    const offAsk = onReleaseAsk((ask) => {
      setReleaseAsk(ask);
      setReleaseBox(ask.box);
    });
    const offNotice = onPoolArchiveNotice((message, failed) => {
      if (failed) soundEvent("actionFailed");
      setNotice(message);
    });
    return () => {
      offAsk();
      offNotice();
    };
  }, []);
  const keepClaimed = (ask: ReleaseAsk) =>
    setNotice(`${ask.box.label} stays claimed. Release it from its host in the crew once its work is pushed.`);
  const cancelReleasePool = () => {
    if (releaseAsk) keepClaimed(releaseAsk);
    setReleaseBox(null);
    setReleaseAsk(null);
  };
  const confirmReleasePool = async () => {
    const box = releaseBox;
    if (!box) return;
    setReleaseBox(null);
    if (releaseAsk) {
      setReleaseAsk(null);
      return releaseAfterArchive(releaseAsk);
    }
    try {
      await releasePoolBox(box.id);
      setNotice(`Releasing ${box.label}…`);
    } catch (error) {
      soundEvent("actionFailed");
      setNotice(`Couldn’t release ${box.label}: ${errorMessage(error) || "the request failed."}`);
    }
  };
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
  // The mode bar's tab (macOS app): Activity, GitHub and Settings draw in the map's place.
  const appMode = useAppMode();
  const settingsShown = useSettingsShown(appMode);
  // The map's frame: Crew's place on the Command tab; its rectangle goes to the macOS app (mapBridge.ts).
  const worldFrame = useRef<HTMLDivElement>(null);
  // The open agent's browser, beside its conversation on Crew (src/browser/BoardBrowser.tsx): B, kept as you step
  // from agent to agent.
  const browserOpen = useBrowserOpen();
  // Agents' own browser tools open and drive its tabs (Settings → Browser): the macOS app is told, and registers
  // with the daemons as their browser while it is on.
  const browserTools = useBrowserTools();
  const browserFollows = useBrowserFollows();
  const boardBrowsers = useBoardBrowsers();
  useEffect(() => {
    if (macApp()) postBrowserHost(browserTools);
  }, [browserTools]);
  // Crew, the map, on the Command tab (a chat app in the map's place, in a browser too): its drawer is where what is
  // open shows, and the session panel is gone while it does. Beside the other tabs the session panel shows it instead.
  const crewShown = appMode === "command" && !settingsShown;
  // Reading an agent's conversation views it: Crew's drawer, or the session panel while it isn't hidden.
  const viewing =
    selection?.type === "agent" && (crewShown || !floatingVisibility.collapsed)
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
  // J/K, ‹ › and N walk a stable roster: host, project, workspace, then age (reading a reply never reorders it).
  const navigationOrder = useMemo(() => conversationOrder(active), [active]);
  const order = navigationOrder;
  const attentionAgents = useMemo(
    () => active.filter((a) => needsAttention(a, needYou)),
    [active, needYou],
  );
  // The tab title also counts unread finishes, as notifications do.
  const attentionCount = active.filter(
    (a) => needsAttention(a, needYou) || unread.has(a.id),
  ).length;
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
      if (!navigationOrder.length) return;
      const index = navigationOrder.findIndex((a) => a.id === selection?.id);
      const next =
        index < 0
          ? delta > 0
            ? 0
            : navigationOrder.length - 1
          : (index + delta + navigationOrder.length) % navigationOrder.length;
      choose({ type: "agent", id: navigationOrder[next].id });
    },
    [navigationOrder, selection, choose],
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
  // Its workspace's pending diff comments, for ⌘K's Apply and Show.
  const agentComments = useLocalComments(agent?.host, agent?.workspaceId);
  // On Crew (the macOS app's: it draws the pages) the open agent's browser stands beside its conversation.
  const crewBrowsing = crewShown && macApp() && !!agent && !selection?.subagent;
  const browserShown = crewBrowsing && browserOpen;
  const agentBrowser = agent ? boardBrowsers.browsers[browserKey(agent.host, daemonAgentId(agent))] : undefined;
  const browserTab = agentBrowser?.tabs.find((t) => t.id === agentBrowser.current) ?? agentBrowser?.tabs[0];
  const toggleBrowser = () => setBrowserOpen(!browserShown);
  // B, outside a text field: the open agent's browser, shown or hidden.
  const boardKeys = useRef({ crew: crewBrowsing, browserShown, toggleBrowser });
  Object.assign(boardKeys.current, { crew: crewBrowsing, browserShown, toggleBrowser });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const now = boardKeys.current;
      if (e.key.toLowerCase() !== "b" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat || e.defaultPrevented) return;
      if (!now.crew || modalOpen() || isTyping(e.target as HTMLElement | null)) return;
      e.preventDefault();
      now.toggleBrowser();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // An agent opened a tab with its browser tools: the open agent's shows it (Settings → Browser); another's says so,
  // once in a while.
  const browserWatch = useRef({ agents, open: crewBrowsing ? agent : undefined, said: new Map<string, number>() });
  Object.assign(browserWatch.current, { agents, open: crewBrowsing ? agent : undefined });
  useEffect(
    () =>
      onBrowserEvent((event) => {
        if (event.type !== "opened") return;
        const now = browserWatch.current;
        const opener = now.agents.find((a) => (a.host || "local") === event.host && daemonAgentId(a) === event.agent);
        if (!opener) return;
        if (now.open?.id === opener.id) {
          if (!browserFollowsSetting()) return;
          browserDo("select", { tab: event.tab });
          setBrowserOpen(true);
          return;
        }
        if (Date.now() - (now.said.get(opener.id) ?? 0) < 30000) return;
        now.said.set(opener.id, Date.now());
        setNotice(`${agentName(opener)} opened a page in its browser.`);
      }),
    [],
  );
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
  // Nothing is open: Crew shows its map alone, and the session panel isn't shown beside the other tabs.
  const detailEmpty = !addingProject && !dispatchTarget && !agent && !workspace && !project;
  const panelAbsent = crewShown || detailEmpty;
  // The open project's repository on GitHub, for G: its workspaces' remote.
  const projectRepo = project
    ? listedWorkspaces.find(
        (w) =>
          w.repo &&
          w.projectId === project.projectId &&
          (w.host ?? "") === (project.host ?? ""),
      )?.repo
    : undefined;
  // The open agent's or workspace's PR and Linear issue, for G and L (the
  // same ones the session header's chips link to).
  const linkWorkspace = agent ? workspaceOf(agent) : workspace;
  const linkPr = usePullRequest(linkWorkspace ?? undefined);
  const issueKey =
    (agent || workspace) && integrations.linear
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

  /** Where a new agent starts when nothing names a place: the selection's workspace, else its project. */
  const contextTarget = useCallback(
    (): DispatchTarget => {
      const a =
        selection?.type === "agent"
          ? agents.find((x) => x.id === selection.id)
          : undefined;
      const ws = a ? workspaceOf(a) : workspace;
      if (ws && realWorkspaceIds.has(workspaceKey(ws)))
        return { workspaceId: workspaceKey(ws) };
      const p = a
        ? projectOf(a)
        : project ||
          projects.find((x) => x.name === ws?.project && ws && sameHost(x, ws));
      return p ? { projectId: projectKey(p) } : {};
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
  /** New agent: in what is open's place (Crew's drawer, or the session panel beside the other tabs). */
  const openDispatch = useCallback(
    (target?: DispatchTarget) => {
      setDispatchRevision((revision) => revision + 1);
      setAddingProject(false);
      setFocusRevision((revision) => revision + 1);
      setDispatchTarget(target ?? contextTarget());
    },
    [contextTarget],
  );
  // The Activity tab's filter and selected item, for ⌘K's entries for them.
  const [activityView, setActivityView] = useState<ActivityViewState | undefined>();
  const showActivity = appTabs(integrations).activity;
  // The GitHub tab's place and open PR, for ⌘K's entries for them.
  const [githubView, setGithubView] = useState<GithubViewState | undefined>();
  // The workspace whose files and changes the Files tab shows: the selected one, or the selected agent's.
  const githubWorkspace = useMemo<SelectedWorkspace | undefined>(() => {
    const a = selection?.type === "agent" ? agents.find((x) => x.id === selection.id) : undefined;
    const ws = a ? workspaceOf(a) : workspace;
    if (!ws || !realWorkspaceIds.has(workspaceKey(ws))) return undefined;
    return {
      id: ws.workspaceId,
      ...(ws.host ? { host: ws.host } : {}),
      name: placeText(ws.name, "Workspace"),
      branch: ws.branch,
      pr: ws.pr ? { number: ws.pr.number, url: ws.pr.url, title: ws.pr.title } : ws.pr,
    };
  }, [selection, agents, workspaceOf, workspace, realWorkspaceIds]);
  // What the macOS app hears of the map's place: the fleet is in, the Terminal tab's workspace, where the place is.
  useMapBridge(!loading, githubWorkspace, worldFrame);
  // The Paseo workspaces with a PR's branch checked out (the PR view's Open Paseo agent).
  const paseoFor = useCallback(
    (pr: PrHead) =>
      paseoMatches(
        pr,
        listedWorkspaces.filter((w) => realWorkspaceIds.has(workspaceKey(w))),
        (w) => agentsAt(workspaceKey(w)),
        hosts,
      ),
    [listedWorkspaces, realWorkspaceIds, agentsAt, hosts],
  );
  // Its most recent agent (else the workspace) in the panel, on the map.
  const openPaseo = useCallback(
    (m: PaseoMatch) => {
      choose(m.agent ? { type: "agent", id: m.agent.id } : { type: "workspace", id: workspaceKey(m.workspace) });
      postAppMenu("command");
    },
    [choose],
  );
  // The PR view's Open in agent: New agent on the pull request (its worktree), the host or pool box chosen there.
  const openPrInAgent = useCallback(
    (pr: { repo: string; number: number; title?: string; url?: string; headRef?: string }) => {
      openDispatch({
        pr: {
          repo: pr.repo,
          number: pr.number,
          ...(pr.title ? { title: pr.title } : {}),
          ...(pr.url ? { url: pr.url } : {}),
          ...(pr.headRef ? { head: pr.headRef } : {}),
        },
      });
      postAppMenu("command");
    },
    [openDispatch],
  );
  // The workspace's changes in the Files tab's Changes.
  const showWorkspaceChanges = useCallback(() => {
    openFilesChanges();
    postAppMenu("files");
  }, []);
  // ⇧⌘G (the macOS app's View → Show Branch Changes, from anywhere but Conquer with the keyboard;
  // in a browser, the page's own key): the selected workspace's, or agent's, changes in the Files tab.
  const branchChanges = useRef(() => {});
  branchChanges.current = () => {
    if (!githubWorkspace) setNotice("Select a workspace or agent to see its branch's changes.");
    else if (!macApp()) setNotice("The Files tab, with its Changes, is in the macOS app.");
    else showWorkspaceChanges();
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // In the macOS app the View menu takes the key first (Conquer's find previous while it has the keyboard).
      if (macApp() || !isBranchChangesShortcut(e) || e.defaultPrevented) return;
      e.preventDefault();
      branchChanges.current();
    };
    window.addEventListener("keydown", key);
    const offCommand = onAppCommand("branch-changes", () => branchChanges.current());
    return () => {
      window.removeEventListener("keydown", key);
      offCommand();
    };
  }, []);
  // The Files tab's state, for ⌘K's entries for it.
  const [filesView, setFilesView] = useState<FilesViewState | undefined>();
  // The Files tab's Changes: Review #N opens the PR in the GitHub tab (while it's on); Compare on GitHub in Conquer.
  const openChangesPr = useCallback((repo: string, number: number) => {
    openGithubPlace({ kind: "pr", repo, number, tab: "files" });
    postAppMenu("github");
  }, []);
  const openInConquer = useCallback((url: string) => {
    if (macApp()) postAppLink(url, true);
    else window.open(url, "_blank", "noopener");
  }, []);
  // ⇧⌘E: the macOS app's View → Show Files shows the tab; in a browser, the page says it's the app's.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (macApp() || !isFilesShortcut(e) || e.defaultPrevented) return;
      e.preventDefault();
      setNotice("The Files tab is in the macOS app.");
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  // GitHub, Activity, Files and Settings share one text size (⌘+ ⌘− ⌘0, `pageText.ts`).
  const pageShown =
    settingsShown ||
    appMode === "files" ||
    (appMode === "github" && integrations.github) ||
    (appMode === "activity" && showActivity);
  usePageTextKeys(pageShown);
  // ⌘R: the shown page's own refresh (`pageRefresh.ts`), never a reload of the web page.
  useEffect(() => installPageRefresh(), []);
  const appUpdate = useAppUpdate();

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
          if (releaseAsk) keepClaimed(releaseAsk);
          setReleaseBox(null);
          setReleaseAsk(null);
        }
        return;
      }
      // On Crew, Escape closes what is open beside the map (a subagent goes back to its agent first), from its
      // message box too, once menus, pickers and previews in it have closed.
      if (
        crewShown &&
        e.key === "Escape" &&
        !e.defaultPrevented &&
        !e.metaKey && !e.ctrlKey && !e.altKey &&
        (selection || dispatchTarget || addingProject) &&
        (target === document.body || target.closest(".crew-map")) &&
        !modalOpen() &&
        ![...document.querySelectorAll(".popover-menu, .autocomplete, .lightbox, .inline-confirm")].some((layer) => !layer.closest("[inert]"))
      ) {
        e.preventDefault();
        if (selection?.subagent) return select({ ...selection, subagent: undefined });
        setDispatchTarget(null);
        setAddingProject(false);
        select(null);
        return;
      }
      if (editing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Escape leaves a new agent (or project) unstarted, back to what was open.
      if (addingProject && e.key === "Escape") {
        setAddingProject(false);
        return;
      }
      if (dispatchTarget && e.key === "Escape") {
        setDispatchTarget(null);
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
        // A subagent's conversation goes back to its agent's; an agent's
        // conversation stays open.
        if (selection?.subagent) select({ ...selection, subagent: undefined });
        else if (selection && selection.type !== "agent") select(null);
      } else if (key === "d") {
        e.preventDefault();
        openDispatch();
      } else if (key === "j" || e.key === "ArrowDown" || (e.key === "ArrowRight" && !e.shiftKey && appMode === "command" && !settingsShown)) {
        e.preventDefault();
        step(1);
      } else if (key === "k" || e.key === "ArrowUp" || (e.key === "ArrowLeft" && !e.shiftKey && appMode === "command" && !settingsShown)) {
        e.preventDefault();
        step(-1);
      } else if (key === "n") {
        e.preventDefault();
        nextAttention();
      } else if (key === "g" && linkPr) {
        e.preventDefault();
        openExternal(linkPr.url);
      } else if (key === "g" && projectRepo) {
        e.preventDefault();
        openExternal(projectRepo);
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
    projectRepo,
    issueKey,
    issueUrl,
    crewShown,
    appMode,
    settingsShown,
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
  /** Confirm archiving a workspace. `keep` leaves the selection (archiving from Crew's map keeps what is open). */
  const openArchive = (w: Workspace, keep = false) => {
    if (isArchiving(workspaceKey(w))) return;
    if (!keep) select({ type: "workspace", id: workspaceKey(w) });
    setDispatchTarget(null);
    setArchiveWorkspace(w);
  };
  const confirmArchive = () => {
    if (!archiveWorkspace) return;
    archiveWithPool(archiveWorkspace, integrations.pool);
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

  // Back (and Esc) lets what is open go: Crew's map, or the session panel closing beside the other tabs.
  const onBack = useCallback(() => select(null), [select]);
  const sounds = useSoundSettings();
  const radio = useMusic();
  const addProject = () => {
    setAddingProject(true);
    setFocusRevision((revision) => revision + 1);
  };
  // The command palette (Cmd+K): what the app's keys and buttons do, for
  // what is open now, then (found by searching) every agent and place.
  const archivable =
    linkWorkspace && realWorkspaceIds.has(workspaceKey(linkWorkspace))
      ? linkWorkspace
      : undefined;
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
              page: "Command" as const,
              label: `Approve ${permission.name}`,
              keywords: "allow permission yes",
              run: () => void respond(permission, true),
            },
            {
              id: "deny",
              group: "Actions",
              page: "Command" as const,
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
              page: "Command" as const,
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
              page: "Command" as const,
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
              page: "Command" as const,
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
                    page: "Command" as const,
                    label: `Archive “${name}”…`,
                    keywords: "remove delete agent",
                    // Its conversation asks.
                    run: () => runAppCommand("agent-archive"),
                  },
                ]
              : []),
          ]
        : []),
      ...(asking && !selection?.subagent
        ? [
            {
              id: "toggle-question",
              group: "Actions",
              page: "Command" as const,
              label: "Collapse or expand the agent’s question",
              keywords: "fold unfold hide show question ask card minimise",
              run: () => runAppCommand("agent-question-toggle"),
            },
          ]
        : []),
      ...(a.workspaceId && agentComments.pending.length && !selection?.subagent
        ? [
            ...(live
              ? [
                  {
                    id: "apply-diff-comments",
                    group: "Actions",
                    page: "Command" as const,
                    label: `Apply pending diff comments (${agentComments.pending.length})`,
                    keywords: "apply pending diff comments review send address changes local",
                    run: () => runAppCommand("diff-comments-apply"),
                  },
                ]
              : []),
            {
              id: "show-diff-comments",
              group: "Actions",
              page: "Command" as const,
              label: "Show pending diff comments",
              keywords: "pending diff comments review list discard local",
              run: () => runAppCommand("diff-comments-show"),
            },
          ]
        : []),
      {
        id: "open-paseo",
        group: "Actions",
        page: "Command" as const,
        label: "Open the agent in Paseo",
        keywords: "app external",
        run: () => runAppCommand("agent-open-paseo"),
      },
      {
        id: "copy-agent-id",
        group: "Actions",
        page: "Command" as const,
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
  // The mode bar's tabs shown, in order, for ⌘`'s entry.
  const modeNames: Record<AppMode, string> = {
    command: "crew",
    conquer: "browser",
    activity: "Activity",
    github: "GitHub",
    files: "Files",
    terminal: "terminal",
    settings: "Settings",
  };
  const modeTabs = shownModes(integrations).map((mode) => [mode, modeNames[mode]] as const);
  // A tab's ⌘1…⌘6, in the macOS app.
  const tabKeys = (mode: AppMode) => (macApp() ? [modeKey(integrations, mode)] : undefined);
  const diagramCommand = useMermaidCommands();
  // The open agent's browser, beside its conversation on Crew.
  const where = "";
  const browserOf = "the browser";
  const browserEntries = agent && crewBrowsing
    ? [
        {
          id: "world-talk-browser",
          group: "Actions",
          page: "Command" as const,
          label: browserShown ? `Hide the browser${where}` : `Show ${agentName(agent, workspaceOf(agent)?.branch)}’s browser${where}`,
          keys: browserShown ? [["B"], ["⇧", "⌘", "W"]] : [["B"]],
          keywords: "crew browser web page tab preview site localhost attached agent close beside conversation",
          run: toggleBrowser,
        },
        ...(browserShown
          ? [
              { id: "board-browser-new", group: "Actions", page: "Command" as const, label: `Open a new tab in ${browserOf}`, keywords: "crew browser web page tab add", run: () => runAppCommand("board-browser-new") },
              { id: "board-browser-address", group: "Actions", page: "Command" as const, label: `Type an address in ${browserOf}`, keywords: "crew browser url location go to navigate", run: () => runAppCommand("board-browser-address") },
              { id: "board-browser-fill", group: "Actions", page: "Command" as const, label: "Make the browser fill the view, or show the conversation again", keywords: "crew browser expand maximize bigger full size restore", run: () => runAppCommand("board-browser-fill") },
              ...(browserTab
                ? [
                    { id: "board-browser-reload", group: "Actions", page: "Command" as const, label: `Reload ${tabLabel(browserTab)} in ${browserOf}`, keywords: "crew browser refresh page", run: () => runAppCommand("board-browser-reload") },
                    ...(browserTab.back ? [{ id: "board-browser-back", group: "Actions", page: "Command" as const, label: `Go back in ${browserOf}`, keywords: "crew browser previous page history", run: () => runAppCommand("board-browser-back") }] : []),
                    ...(browserTab.forward ? [{ id: "board-browser-forward", group: "Actions", page: "Command" as const, label: `Go forward in ${browserOf}`, keywords: "crew browser next page history", run: () => runAppCommand("board-browser-forward") }] : []),
                    { id: "board-browser-close-tab", group: "Actions", page: "Command" as const, label: `Close ${tabLabel(browserTab)} in ${browserOf}`, keywords: "crew browser tab remove", run: () => runAppCommand("board-browser-close-tab") },
                    ...(browserTab.url ? [{ id: "board-browser-conquer", group: "Navigate", page: "Conquer" as const, label: "Open the browser’s page in Conquer", keywords: "crew browser tab move own logins", run: () => runAppCommand("board-browser-conquer") }] : []),
                  ]
                : []),
            ]
          : []),
      ]
    : [];
  const paletteCommands: Command[] = [
    ...mermaidPalette(diagramCommand),
    {
      id: "new-agent",
      group: "Actions",
      page: "Command" as const,
      label: "New agent",
      keys: [["⌘", "N"]],
      keywords: "dispatch start worktree branch pull request PR",
      run: () => openDispatch(),
    },
    // A pool box (Settings → Pool boxes): New agent on a new one, and releasing each claimed one.
    ...(poolBoxes.length && !poolJob && idleBoxes(poolBoxes).length
      ? [
          {
            id: "new-agent-pool",
            group: "Actions",
            page: "Command" as const,
            label: "New agent on a new pool box",
            keywords: "dispatch claim sprite pool box remote",
            run: () => openDispatch({ host: POOL }),
          },
        ]
      : []),
    ...(!poolJob
      ? poolBoxes
          .filter((b) => b.status === "claimed")
          .map((b) => ({
            id: `release-pool-${b.id}`,
            group: "Actions",
            page: "Command" as const,
            label: `Release pool box “${b.label}”…`,
            keywords: "pool box sprite restore unclaim",
            run: () => openReleasePool(b),
          }))
      : []),
    {
      id: "add-project",
      group: "Actions",
      page: "Command" as const,
      label: "Add project",
      keywords: "clone folder repository",
      run: addProject,
    },
    ...(agent || dispatchTarget
      ? [
          {
            id: "composer",
            group: "Actions",
            page: "Command" as const,
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
            page: "Command" as const,
            label: `Open pull request #${linkPr.number}`,
            keys: [["G"]],
            keywords: "github pr",
            run: () => openExternal(linkPr.url),
          },
        ]
      : []),
    ...(projectRepo
      ? [
          {
            id: "repo",
            group: "Actions",
            page: "Command" as const,
            label: `Open ${project?.name || "the project"} on GitHub`,
            keys: [["G"]],
            keywords: "github repository repo",
            run: () => openExternal(projectRepo),
          },
        ]
      : []),
    ...(issueKey
      ? [
          {
            id: "linear",
            group: "Actions",
            page: "Command" as const,
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
            page: "Command" as const,
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
            page: "Command" as const,
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
            page: "Command" as const,
            label: `Rename project “${placeText(project.name, "project")}”…`,
            keywords: "title name",
            run: () => requestRename("project", projectKey(project)),
          },
          {
            id: "remove-project",
            group: "Actions",
            page: "Command" as const,
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
            page: "Command" as const,
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
            page: "Command" as const,
            label: "Retry reaching Paseo",
            keywords: "refresh reconnect",
            run: () => void refresh(),
          },
        ]
      : []),
    {
      id: "next",
      group: "Navigate",
      page: "Command" as const,
      label: "Next agent",
      // Right steps too while Command shows.
      keys: appMode === "command" && !settingsShown ? [["J"], ["→"]] : [["J"]],
      run: () => step(1),
    },
    {
      id: "previous",
      group: "Navigate",
      page: "Command" as const,
      label: "Previous agent",
      keys: appMode === "command" && !settingsShown ? [["K"], ["←"]] : [["K"]],
      run: () => step(-1),
    },
    {
      id: "next-attention",
      group: "Navigate",
      page: "Command" as const,
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
            page: "Command" as const,
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
    // The open agent's browser beside its conversation on Crew (the macOS app's).
    ...(crewBrowsing ? browserEntries : []),
    // Crew's filter (Crew draws no world to fit).
    ...(crewShown
      ? [
          {
            id: "crew-filter",
            group: "Navigate",
            page: "Command" as const,
            label: "Filter the crew…",
            keywords: "crew roster find search agents workspaces filter",
            run: () => runAppCommand("crew-filter"),
          },
        ]
      : []),
    // The session panel, beside the other tabs while something is open (Crew's drawer has it on the Command tab).
    ...(!panelAbsent
      ? [
          {
            id: "panel",
            group: "App",
            page: "App" as const,
            label: "Show or hide the panel",
            keys: [["⌘", "B"]],
            keywords: "sidebar collapse react conquer",
            run: () => runAppCommand("toggle-panel"),
          },
        ]
      : []),
    ...(macApp()
      ? [
          // ⌃` shows the Terminal tab from anywhere and, in it, goes back to the side before it.
          appMode !== "terminal"
            ? {
                id: "terminal-tab",
                group: "App",
                page: "Terminal" as const,
                label: "Show terminal",
                keys: [["⌃", "`"], ...(tabKeys("terminal") ?? [])],
                keywords: "terminal tab shell console open toggle mode full size map place",
                run: () => postAppMenu("terminal-tab"),
              }
            : {
                id: "terminal",
                group: "App",
                page: "Terminal" as const,
                label: "Leave the terminal tab",
                keys: [["⌃", "`"]],
                keywords: "terminal back shell console toggle hide",
                run: () => postAppMenu("terminal"),
              },
          ...(
            [
              ...(appMode === "terminal"
                ? ([["terminal-unsplit", "Unsplit terminals", "panes merge split", undefined]] as const)
                : []),
              [
                "terminal-bigger",
                "Bigger terminal text",
                "zoom font size larger",
                ["⌘", "+"],
              ],
              [
                "terminal-smaller",
                "Smaller terminal text",
                "zoom font size",
                ["⌘", "−"],
              ],
              [
                "terminal-actual",
                "Actual terminal text size",
                "zoom font reset",
                ["⌘", "0"],
              ],
              [
                "mode-next",
                `Next in the map's place: ${modeTabs.map(([, name]) => name).join(", ")}`,
                `switch rotate cycle mode tab conquer command ${modeTabs.map(([mode]) => mode).join(" ")}`,
                ["⌘", "`"],
              ],
              [
                "conquer",
                "Show the browser (Conquer)",
                "conquer browser mode web",
                modeKey(integrations, "conquer"),
              ],
              ["conquer-tab", "New Conquer tab", "browser web open", undefined],
              [
                "conquer-sidebar",
                "Show or hide Conquer’s tab sidebar",
                "browser tabs collapse",
                ["⌘", "S"],
              ],
              [
                "zen-cookies",
                "Import Zen cookies into Conquer",
                "browser sign in login sessions confirmation",
                undefined,
              ],
            ] as const
          )
            .map(([action, label, keywords, keys]) => ({
            id: action,
            group: "App",
            page: action.startsWith("terminal")
              ? ("Terminal" as const)
              : action === "mode-next"
                ? ("App" as const)
                : ("Conquer" as const),
            label,
            keys: keys && [[...keys]],
            keywords,
            run: () => postAppMenu(action),
          })),
          ...(appMode === "conquer"
            ? [
                {
                  id: "conquer-reload",
                  group: "App",
                  page: "Conquer" as const,
                  label: "Reload Conquer page",
                  keys: [["⌘", "R"]],
                  keywords: "browser web refresh reload page",
                  run: () => postAppMenu("conquer-reload"),
                },
                {
                  id: "conquer-reload-without-cache",
                  group: "App",
                  page: "Conquer" as const,
                  label: "Reload Conquer page without cache",
                  keys: [["⇧", "⌘", "R"]],
                  keywords: "browser web refresh reload page hard bypass cache origin",
                  run: () => postAppMenu("conquer-reload-without-cache"),
                },
              ]
            : []),
          ...(appMode !== "command"
            ? [
                {
                  id: "command-show",
                  group: "App",
                  page: "Command" as const,
                  label: "Show the crew",
                  keys: tabKeys("command"),
                  keywords: "command crew map agents mode tab",
                  run: () => postAppMenu("command"),
                },
              ]
            : []),
          {
            id: "restart",
            group: "App",
            page: "App" as const,
            label: "Restart app",
            keywords: "reload update refresh latest build",
            run: () => postAppMenu("reload"),
          },
          // The released app only: dev copies update by being rebuilt.
          ...(appUpdate?.canCheck
            ? [
                {
                  id: "check-updates",
                  group: "App",
                  page: "App" as const,
                  label: "Check for updates",
                  keywords: "update version upgrade latest release sparkle",
                  run: () => postAppMenu("check-updates"),
                },
              ]
            : []),
        ]
      : []),
    ...(integrations.github
      ? [
          {
            id: "github-create-token",
            group: "App",
            page: "Settings" as const,
            label: "Create a classic GitHub token (opens GitHub with its scopes ticked)",
            keywords: "github token pat personal access classic create setup scopes key",
            run: createGithubToken,
          },
        ]
      : []),
    ...(integrations.github && appMode !== "github"
      ? [
          {
            id: "github-show",
            group: "App",
            page: "GitHub" as const,
            label: "Show GitHub (pull requests)",
            keys: tabKeys("github"),
            keywords: "github pull requests prs review diff code mode tab",
            run: () => postAppMenu("github"),
          },
        ]
      : []),
    ...(macApp() && githubWorkspace && !(appMode === "files" && filesView?.changes)
      ? [
          {
            id: "files-workspace-changes",
            group: "Actions",
            page: "Files" as const,
            label: `Show ${githubWorkspace.name}’s changes against main`,
            keys: [["⇧", "⌘", "G"]],
            keywords: "files diff changes branch main compare git review workspace uncommitted committed",
            run: showWorkspaceChanges,
          },
        ]
      : []),
    ...(() => {
      const pr = integrations.github && githubWorkspace?.pr ? prPlaceOf(githubWorkspace.pr.url) : null;
      const open = githubView?.place.kind === "pr" && githubView.place.repo === pr?.repo && githubView.place.number === pr?.number;
      return pr && !(appMode === "github" && open)
        ? [
            {
              id: "github-workspace-pr",
              group: "Actions",
              page: "GitHub" as const,
              label: `Review ${githubWorkspace!.name}’s pull request #${pr.number}`,
              keywords: "github pull request pr review diff files approve workspace",
              run: () => {
                openGithubPlace({ ...pr, tab: "files" });
                postAppMenu("github");
              },
            },
          ]
        : [];
    })(),
    ...(() => {
      const pr = integrations.github && appMode === "github" ? githubView?.pr : undefined;
      const matches = pr ? paseoFor(pr) : [];
      return matches.map((m) => ({
        id: `github-open-paseo:${m.workspace.host ?? ""}:${m.workspace.workspaceId}`,
        group: "Actions",
        page: "GitHub" as const,
        label: matches.length > 1 ? `Open the Paseo agent for this pull request in ${m.label}` : "Open the Paseo agent for this pull request",
        keywords: `github pull request pr paseo agent workspace branch map command open ${m.agent?.name ?? ""} ${m.workspace.name}`,
        run: () => openPaseo(m),
      }));
    })(),
    ...(() => {
      const pr = integrations.github && appMode === "github" ? githubView?.pr : undefined;
      return pr?.open
        ? [
            {
              id: "github-open-in-agent",
              group: "Actions",
              page: "GitHub" as const,
              label: "Open the pull request in a new agent…",
              keywords: "github pull request pr new agent dispatch worktree checkout host pool box claim",
              run: () => openPrInAgent(pr),
            },
          ]
        : [];
    })(),
    ...(integrations.github && appMode === "github" && githubView
      ? (() => {
          const v = githubView;
          const place = v.place;
          const command = (id: AppCommand, label: string, keywords: string, keys?: string[], arg?: unknown, group = "App") => ({
            id: arg === undefined ? id : `${id}:${typeof arg === "object" ? JSON.stringify(arg) : String(arg)}`,
            group,
            page: "GitHub" as const,
            label,
            ...(keys ? { keys: [keys] } : {}),
            keywords: `github ${keywords}`,
            run: () => runAppCommand(id, arg),
          });
          return [
            // ⌘R: what's shown (`pageRefresh.ts`); Refresh GitHub asks again for everything the tab has read.
            command("page-refresh", place.kind === "commits" ? "Refresh main history" : place.kind === "pr" ? "Refresh the pull request" : "Refresh the pull requests", "reload update sync checks comments list", ["⌘", "R"]),
            command("github-refresh", "Refresh GitHub", "reload update sync pull requests everything all counts repositories"),
            command("github-sidebar", "Show or hide the GitHub sidebar", "sidebar navigation collapse panel repositories", ["⌘", "S"]),
            ...(["review", "assigned", "mine", "involved"] as const)
              .filter((scope) => !(place.kind === "prs" && place.scope === scope))
              .map((scope) =>
                command("github-go", `Go to ${PR_SCOPE_TITLE[scope].toLowerCase()} in GitHub`, `pull requests list ${scope}`, undefined, { kind: "prs", scope }, "Navigate"),
              ),
            ...v.repos
              .filter((r) => !(place.kind === "repo" && place.repo.toLowerCase() === r.repo.toLowerCase()))
              .map((r) =>
                command("github-go", `Open ${r.repo}’s pull requests`, `repository repo pull requests list ${r.repo}${r.favourite ? " favourite starred" : ""}`, undefined, { kind: "repo", repo: r.repo }, "Navigate"),
              ),
            ...v.repos.filter((r) => !(place.kind === "commits" && place.repo === r.repo && !place.sha)).map((r) => command("github-go", `Monitor ${r.repo}’s main commits`, "main branch commit log history monitor changes", undefined, { kind: "commits", repo: r.repo }, "Navigate")),
            ...(v.repo && !v.repos.some((r) => r.repo === v.repo!.name) ? [command("github-go", `Monitor ${v.repo.name}’s main commits`, "main branch commit log history monitor changes", undefined, { kind: "commits", repo: v.repo.name }, "Navigate")] : []),
            ...(place.kind === "commits" ? [
              command("github-back", place.sha ? "Back to main history" : "Back to the repository’s pull requests", "back main commits history repository list", ["Esc"]),
              command("github-go", "Show the repository’s pull requests", "main history back pulls", undefined, { kind: "repo", repo: place.repo }, "Navigate"),
              command("github-open-browser", place.sha ? "Open the commit on GitHub" : "Open main history on GitHub", "browser conquer external main commit"),
              command("github-copy-link", place.sha ? "Copy the commit link" : "Copy the main history link", "copy link url sha history", ["⇧", "⌘", "C"]),
            ] : []),
            ...(v.history?.more && !v.history.loading && place.kind === "commits" && !place.sha ? [command("github-history-older", "Load older main commits", "history paginate next page earlier changes")] : []),
            ...(v.history?.newer ? [command("github-history-latest", "Show latest main commits", "history new arrivals monitor")] : []),
            ...(place.kind === "commits" && v.history ? v.history.rows.filter((r) => r.sha !== place.sha).map((r) => command("github-go", `Open commit ${r.sha.slice(0, 7)}: ${r.title}`, "main commit diff changes", undefined, { kind: "commits", repo: place.repo, sha: r.sha }, "Navigate")) : []),
            command("github-find-repo", "Find a GitHub repository…", "search find repository repo organization org owner open star favourite"),
            ...(v.repo
              ? [
                  command(
                    "github-star",
                    v.repo.starred ? `Unstar ${v.repo.name}` : `Star ${v.repo.name} as a favourite`,
                    "favourite star unstar repository repo",
                    ["S"],
                    { kind: "repo", name: v.repo.name, starred: !v.repo.starred },
                  ),
                  command(
                    "github-star",
                    v.repo.ownerStarred ? `Unstar the ${v.repo.owner} organization` : `Star the ${v.repo.owner} organization as a favourite`,
                    "favourite star unstar organization org owner",
                    undefined,
                    { kind: "org", name: v.repo.owner, starred: !v.repo.ownerStarred },
                  ),
                ]
              : []),
            ...(place.kind === "repo" && v.filters
              ? (() => {
                  const f = v.filters;
                  return [
                    command("github-filter", "Filter the repository’s pull requests…", "filter state author reviewer assignee review draft ci checks", ["F"]),
                    command("github-open-browser", "Open the repository’s pull requests on GitHub", "browser conquer web open external repository"),
                    command("github-copy-link", "Copy the repository’s pull requests link", "copy link url address clipboard share github.com pulls repository", ["⇧", "⌘", "C"]),
                    ...PR_VALUE_FIELDS.flatMap((field) =>
                      (Object.entries(PR_FILTERS[field].values) as [string, { text: string }][])
                        .filter(([value]) => f[field] !== value)
                        .map(([value, { text }]) =>
                          command(
                            "github-set-filter",
                            field === "state" ? `Show ${text.toLowerCase()} pull requests` : `Filter by ${PR_FILTERS[field].label === "CI" ? "CI" : PR_FILTERS[field].label.toLowerCase()}: ${text}`,
                            `filter ${field} ${value} ${text}`,
                            undefined,
                            { field, value },
                          ),
                        ),
                    ),
                    ...PR_PEOPLE_FIELDS.map((field) =>
                      command("github-filter", `Filter by ${prFieldLabel(field).toLowerCase()}…`, `filter people person ${field} who contributors collaborators`, undefined, field),
                    ),
                    ...(
                      [
                        ["author", "Show only your pull requests", "mine yours author"],
                        ["reviewer", "Show pull requests you review", "review reviewer requested reviewed mine"],
                        ["assignee", "Show pull requests assigned to you", "assigned assignee mine"],
                      ] as const
                    )
                      .filter(([field]) => !(f[field]?.length === 1 && f[field]![0] === PR_ME))
                      .map(([field, label, keywords]) => command("github-set-filter", label, `filter ${field} me you ${keywords}`, undefined, { field, value: [PR_ME] })),
                    ...[...PR_VALUE_FIELDS, ...PR_PEOPLE_FIELDS]
                      .filter((field) => field !== "state" && (Array.isArray(f[field]) ? f[field]!.length : f[field]))
                      .map((field) =>
                        command(
                          "github-set-filter",
                          field === "author" ? "Show everyone’s pull requests" : `Remove the ${prFieldLabel(field) === "CI" ? "CI" : prFieldLabel(field).toLowerCase()} filter`,
                          `filter clear remove ${field}`,
                          undefined,
                          { field, value: null },
                        ),
                      ),
                    ...(prFiltersSet(f) ? [command("github-set-filter", "Clear the pull request filters", "filter clear reset all", undefined, "clear")] : []),
                  ];
                })()
              : []),
            ...(v.diff
              ? [
                  command("github-next-file", "Next file in the diff", "diff file next down", ["J"]),
                  command("github-prev-file", "Previous file in the diff", "diff file previous up", ["K"]),
                  command("github-layout", v.layout === "split" ? "Unified diff" : "Split diff", "diff layout side by side split unified", ["U"]),
                  command("github-files", v.listShown ? "Hide the diff’s file list" : "Show the diff’s file list", "diff files list tree sidebar", ["F"]),
                  command("github-filter-files", "Filter the diff’s files", "diff files filter search find path name fuzzy go to file", ["T"]),
                  command("github-find", "Find in the diff", "diff search find text content lines match", ["⌘", "F"]),
                  ...(place.kind === "pr" ? [
                  command(
                    "github-diff-sidebar",
                    v.listShown && v.sidebar === "comments" ? "Show the diff’s files" : "Show the diff’s comments",
                    "diff comments list threads review inline sidebar files switch",
                    ["⇧", "C"],
                  )
                  ] : []),
                  ...(v.comments > 0
                    ? [
                        command("github-next-comment", "Next comment in the diff", "diff comment thread next review inline", ["N"]),
                        command("github-prev-comment", "Previous comment in the diff", "diff comment thread previous review inline", ["⇧", "N"]),
                      ]
                    : []),
                ]
              : []),
            ...(place.kind === "pr"
              ? [
                  command("github-back", "Back to the pull request list", "back list close", ["Esc"]),
                  command("github-copy-link", "Copy the pull request’s link", "copy link url address clipboard share github.com pr", ["⇧", "⌘", "C"]),
                  ...(["conversation", "files", "commits", "checks"] as const)
                    .filter((t) => t !== place.tab)
                    .map((t) =>
                      command("github-tab", `Show the pull request’s ${PR_TAB_LABEL[t].toLowerCase()}`, `pull request tab ${t}`, [String(["conversation", "files", "commits", "checks"].indexOf(t) + 1)], t),
                    ),
                  ...(v.pr
                    ? [
                        command("github-open-browser", "Open the pull request on GitHub", "browser conquer web open external"),
                        command("github-comment", "Comment on the pull request", "comment conversation reply write", ["C"]),
                        ...(place.tab === "conversation"
                          ? [
                              v.conversationOrder === "newest"
                                ? command("github-conversation-order", "Show the conversation oldest first", "conversation order sort oldest first chronological timeline comments", undefined, "oldest")
                                : command("github-conversation-order", "Show the conversation newest first", "conversation order sort newest first recent latest reverse timeline comments", undefined, "newest"),
                            ]
                          : []),
                        ...(v.pr.threads && v.pr.threads.resolved > 0
                          ? [
                              v.pr.threads.showResolved
                                ? command("github-threads", "Fold resolved conversations", "resolved threads line comments review conversation fold hide collapse", undefined, "hide-resolved")
                                : command("github-threads", "Show resolved conversations", "resolved threads line comments review conversation show expand unfold", undefined, "show-resolved"),
                            ]
                          : []),
                        ...(v.pr.threads && v.pr.threads.reviews > 0
                          ? [
                              ...(v.pr.threads.folded < v.pr.threads.reviews
                                ? [command("github-threads", "Fold every review’s line comments", "fold collapse hide reviews line comments threads conversation", undefined, "fold")]
                                : []),
                              ...(v.pr.threads.folded > 0
                                ? [command("github-threads", "Show every review’s line comments", "unfold expand show reviews line comments threads conversation", undefined, "unfold")]
                                : []),
                            ]
                          : []),
                        command("github-assignees", "Assign…", "assign assignee assignees unassign people person owner pull request"),
                        ...v.pr.actions.map((a) => command("github-merge", a.label, `pull request ${PR_ACTION_WORDS[a.action.kind]}`, undefined, a.action)),
                        ...(v.pr.open
                          ? [
                              command("github-reviewers", "Request review…", "request review reviewer reviewers re-request remove people team ask pull request"),
                              command("github-review", v.pr.pending ? `Submit your review (${v.pr.pending} pending)…` : "Submit your review…", "review submit finish comment", ["R"]),
                              ...(!v.pr.viewerIsAuthor
                                ? [
                                    command("github-review", "Approve the pull request…", "review approve lgtm accept", undefined, "APPROVE"),
                                    command("github-review", "Request changes on the pull request…", "review request changes reject block", undefined, "REQUEST_CHANGES"),
                                  ]
                                : []),
                            ]
                          : []),
                        ...(place.tab === "files" ? [command("github-viewed", "Mark this file viewed or not", "viewed reviewed file done check", ["V"])] : []),
                      ]
                    : []),
                ]
              : []),
          ];
        })()
      : []),
    ...(appMode !== "files"
      ? [
          {
            id: "files-show",
            group: "App",
            page: "Files" as const,
            label: githubWorkspace ? `Show files (${githubWorkspace.name})` : "Show files",
            keys: [["⇧", "⌘", "E"], ...(tabKeys("files") ?? [])],
            keywords: "files explorer tree browse source code open read workspace folder mode tab",
            run: () => postAppMenu("files"),
          },
        ]
      : []),
    ...(appMode === "files" && filesView
      ? (() => {
          const v = filesView;
          const command = (id: AppCommand, label: string, keywords: string, keys?: string[], group = "App", arg?: unknown) => ({
            id: arg === undefined ? id : `${id}:${String(arg)}`,
            group,
            page: "Files" as const,
            label,
            ...(keys ? { keys: [keys] } : {}),
            keywords: `files ${keywords}`,
            run: () => runAppCommand(id, arg),
          });
          return v.workspace
            ? [
                command("files-quick-open", "Go to file…", "open quick find name path fuzzy go to file", ["⌘", "P"], "Navigate"),
                command("files-filter", "Filter the files", "tree filter search find path name", ["T"]),
                command("files-ignored", v.showIgnored ? "Hide ignored files" : "Show ignored files", "gitignore ignored hidden .git node_modules build toggle"),
                command("files-sidebar", "Show or hide the Files sidebar", "sidebar tree collapse panel", ["⌘", "S"]),
                v.changes
                  ? command("page-refresh", "Refresh the changes", "reload update sync diff changes", ["⌘", "R"])
                  : command("page-refresh", "Refresh the files", "reload update sync tree file", ["⌘", "R"]),
                ...(v.changes
                  ? [
                      command("files-diff-next", "Next file in the changes", "diff file next down changes", ["J"]),
                      command("files-diff-prev", "Previous file in the changes", "diff file previous up changes", ["K"]),
                      command("files-diff-layout", v.layout === "split" ? "Unified diff" : "Split diff", "diff layout side by side split unified changes", ["U"]),
                      command("files-diff-list", v.listShown ? "Hide the diff’s file list" : "Show the diff’s file list", "diff files list tree changes", ["F"]),
                      command("files-diff-filter", "Filter the diff’s files", "diff files filter search find path name fuzzy go to file changes", ["T"]),
                      command("files-diff-find", "Find in the diff", "diff search find text content lines match changes", ["⌘", "F"]),
                      command(
                        "files-diff-sidebar",
                        v.listShown && v.sidebar === "comments" ? "Show the diff’s files" : "Show the diff’s pending comments",
                        "diff comments pending list sidebar files switch changes",
                        ["⇧", "C"],
                      ),
                      ...(v.comments > 0
                        ? [
                            command("files-diff-next-comment", "Next pending comment in the changes", "diff comment pending next changes", ["N"]),
                            command("files-diff-prev-comment", "Previous pending comment in the changes", "diff comment pending previous changes", ["⇧", "N"]),
                          ]
                        : []),
                      ...(["all", "base", "uncommitted"] as const)
                        .filter((m) => m !== v.changesMode)
                        .map((m) =>
                          command("files-changes-mode", `Show ${CHANGES_MODE_LABEL[m].toLowerCase()} changes`, `diff changes mode ${m} committed uncommitted branch`, ["M"], "App", m),
                        ),
                    ]
                  : []),
                ...(v.tabs > 0 && !v.changes ? [command("files-close-tab", "Close the file’s tab", "close tab file editor", macApp() ? ["⌘", "W"] : ["⌃", "W"], "Navigate")] : []),
                ...(v.reopenable ? [command("files-reopen-tab", "Reopen the closed tab", "reopen restore undo closed tab file", ["⇧", "⌘", "T"], "Navigate")] : []),
                ...(v.tabs > 1
                  ? [
                      command("files-next-tab", "Next tab", "next tab right step cycle file", ["⌃", "Tab"], "Navigate"),
                      command("files-previous-tab", "Previous tab", "previous tab left step cycle file", ["⌃", "⇧", "Tab"], "Navigate"),
                      command("files-close-other-tabs", "Close other tabs", "close others other tabs keep only this file", undefined, "Navigate"),
                    ]
                  : []),
                // The user's editor (Settings → Files, the macOS app's): in it, or back in the viewer.
                ...(v.canEditor && v.editor !== "shown"
                  ? [command("files-open-editor", "Open in editor", "editor nvim vim terminal edit lsp open external")]
                  : []),
                ...(v.canEditor && v.editor === "shown"
                  ? [command("files-open-viewer", "Open in viewer", "viewer built-in read view highlight")]
                  : []),
                ...(v.file ? [command("files-copy-path", "Copy the file’s path", "copy path clipboard name")] : []),
                ...(v.text ? [command("files-find", v.markdown === "preview" ? "Find in the preview" : "Find in the file", "search find text content lines match", ["⌘", "F"])] : []),
                ...(v.text && v.editor !== "shown" && !v.changes ? [command("files-wrap", v.wrap ? "Don’t wrap lines" : "Wrap lines", "wrap long lines soft word wrap overflow scroll sideways")] : []),
                ...(v.markdown === "preview" && v.editor !== "shown" && !v.changes
                  ? [command("files-markdown-source", "Show the Markdown source", "markdown md source raw text code preview toggle")]
                  : []),
                ...(v.markdown === "source" && v.editor !== "shown" && !v.changes
                  ? [command("files-markdown-preview", "Show the preview", "markdown md preview rendered render formatted readme toggle")]
                  : []),
                ...(v.file && v.change && v.change !== "deleted" && !v.changes
                  ? [command("files-show-changes", "Show the file’s changes", "diff changes branch compare modified against main")]
                  : []),
              ]
            : [];
        })()
      : []),
    ...(showActivity && appMode !== "activity"
      ? [
          {
            id: "activity-show",
            group: "App",
            page: "Activity" as const,
            label: "Show Activity (GitHub and Linear notifications)",
            keys: tabKeys("activity"),
            keywords: "activity notifications inbox feed github linear mentions reviews mode tab",
            run: () => postAppMenu("activity"),
          },
        ]
      : []),
    ...(showActivity && appMode === "activity" && activityView
      ? [
          {
            id: "activity-refresh",
            group: "App",
            page: "Activity" as const,
            label: "Refresh activity",
            keys: [["⌘", "R"]],
            keywords: "activity notifications reload update sync",
            run: () => runAppCommand("page-refresh"),
          },
          ...(["all", ...(["github", "linear"] as const).filter((source) => integrations[source])] as const)
            .filter((filter) => filter !== activityView.filter)
            .map((filter) => ({
              id: `activity-filter:${filter}`,
              group: "App",
              page: "Activity" as const,
              label: filter === "all" ? "Show all activity" : `Show only ${SOURCE_LABEL[filter]} activity`,
              keywords: `activity filter source ${filter} notifications`,
              run: () => runAppCommand("activity-filter", filter),
            })),
          ...(activityView.filter !== "unread"
            ? [
                {
                  id: "activity-unread-only",
                  group: "App",
                  page: "Activity" as const,
                  label: "Show only unread activity",
                  keywords: "activity filter unread new notifications",
                  run: () => runAppCommand("activity-unread-only"),
                },
              ]
            : []),
          ...(activityView.selected
            ? [
                {
                  id: "activity-open",
                  group: "App",
                  page: "Activity" as const,
                  label: "Open the notification",
                  keys: [["Enter"]],
                  keywords: "activity notification open go view",
                  run: () => runAppCommand("activity-open"),
                },
                activityView.selected.unread
                  ? {
                      id: "activity-read",
                      group: "App",
                      page: "Activity" as const,
                      label: "Mark the notification read",
                      keys: [["U"]],
                      keywords: "activity notification read seen",
                      run: () => runAppCommand("activity-read"),
                    }
                  : null,
                !activityView.selected.unread && activityView.selected.canUnread
                  ? {
                      id: "activity-unread",
                      group: "App",
                      page: "Activity" as const,
                      label: "Mark the notification unread",
                      keys: [["U"]],
                      keywords: "activity notification unread new",
                      run: () => runAppCommand("activity-unread"),
                    }
                  : null,
                {
                  id: "activity-done",
                  group: "App",
                  page: "Activity" as const,
                  label: "Mark the notification done",
                  keys: [["E"]],
                  keywords: "activity notification done archive dismiss remove",
                  run: () => runAppCommand("activity-done"),
                },
              ].filter((command) => command !== null)
            : []),
          ...(activityView.unread > 0
            ? [
                {
                  id: "activity-read-all",
                  group: "App",
                  page: "Activity" as const,
                  label: "Mark all shown activity read",
                  keys: [["⇧", "U"]],
                  keywords: "activity notifications read all clear unread",
                  run: () => runAppCommand("activity-read-all"),
                },
              ]
            : []),
          ...(activityView.shown > 0
            ? [
                {
                  id: "activity-done-all",
                  group: "App",
                  page: "Activity" as const,
                  label: "Mark all shown activity done",
                  keys: [["⇧", "E"]],
                  keywords: "activity notifications done all clear archive dismiss remove",
                  run: () => runAppCommand("activity-done-all"),
                },
              ]
            : []),
        ]
      : []),
    {
      id: "sounds",
      group: "App",
      page: "Settings" as const,
      label: sounds.enabled ? "Turn sounds off" : "Turn sounds on",
      keywords: "audio mute volume",
      run: () => setSoundSettings({ enabled: !sounds.enabled }),
    },
    ...(macApp()
      ? [
          {
            id: "board-browser-tools",
            group: "App",
            page: "Settings" as const,
            label: browserTools
              ? "Stop agents’ browser tools opening tabs in their browser here"
              : "Let agents’ browser tools open tabs in their browser here",
            keywords: "crew browser host agent tool browser_new_tab automation paseo attach web page",
            run: () => setBrowserTools(!browserTools),
          },
          {
            id: "board-browser-follows",
            group: "App",
            page: "Settings" as const,
            label: browserFollows
              ? "Don’t show the browser when the open agent opens a tab"
              : "Show the browser when the open agent opens a tab",
            keywords: "crew browser open tab automatically follow agent",
            run: () => setBrowserFollows(!browserFollows),
          },
        ]
      : []),
    ...(attention.notifications !== "unsupported" &&
    attention.notifications !== "denied"
      ? [
          {
            id: "notifications",
            group: "App",
            page: "Settings" as const,
            label:
              attention.notifications === "granted"
                ? "Turn desktop notifications off"
                : "Turn desktop notifications on",
            keywords: "bell alerts",
            run: () => void attention.requestNotifications(),
          },
        ]
      : []),
    ...(pageShown
      ? (
          [
            ["page-text-bigger", "Bigger text", ["⌘", "+"], "zoom in font size larger"],
            ["page-text-smaller", "Smaller text", ["⌘", "−"], "zoom out font size"],
            ["page-text-actual", "Actual text size", ["⌘", "0"], "zoom reset font size default"],
          ] as const
        ).map(([id, label, keys, words]) => ({
          id,
          group: "App",
          page: "App" as const,
          label,
          keys: [[...keys]],
          keywords: `${words} github activity settings page`,
          run: () => runAppCommand(id),
        }))
      : []),
    // In the macOS app Settings is the bar's gear (⌘,); in a browser a page that closes again.
    ...(!settingsShown
      ? [
          {
            id: "settings",
            group: "App",
            page: "Settings" as const,
            label: "Settings",
            keys: macApp() ? [["⌘", ","]] : undefined,
            keywords:
              "preferences integrations api keys secrets sounds music notifications linear github typesafe gear",
            run: () => openSettings(),
          },
        ]
      : !macApp()
        ? [
            {
              id: "settings",
              group: "App",
              page: "Settings" as const,
              label: "Close settings",
              keys: [["Esc"]],
              keywords: "preferences integrations back",
              run: closeSettings,
            },
          ]
        : []),
    ...(integrationsLoaded && !integrationsSaving
      ? (
          [
            ["linear", "Linear"],
            ["github", "GitHub notifications"],
            ["typesafe", "TypeSafe"],
          ] as const
        ).map(([name, label]) => ({
          id: `integration-${name}`,
          group: "App",
          page: "Settings" as const,
          label: `${integrations[name] ? "Disable" : "Enable"} ${label}`,
          keywords: `settings optional integrations ${name} ${name === "typesafe" ? "questions reply suggestions" : ""}`,
          run: () => {
            openSettings();
            void setIntegration(name, !integrations[name]);
          },
        }))
      : []),
    ...([ ["linear", "Linear", "API key"], ["typesafe", "TypeSafe", "API key"] ] as const)
      .filter(([name]) => integrations[name])
      .map(([name, label, what]) => ({
        id: `manage-${name}-key`,
        group: "App",
        page: "Settings" as const,
        label: `Manage ${label} ${what}…`,
        keywords: `settings ${name} secrets credentials api key token save replace remove`,
        run: () => openSettings(name),
      })),
    {
      id: "presets",
      group: "App",
      page: "Settings" as const,
      label: "Edit preset prompts…",
      keywords: "presets templates settings",
      run: openPresetEditor,
    },
    {
      id: "profiles",
      group: "App",
      page: "Settings" as const,
      label: "Edit agent profiles…",
      keywords: "profiles paseo provider model thinking mode new agent settings",
      run: () => openProfileEditor(),
    },
    {
      id: "terminal-settings",
      group: "App",
      page: "Settings" as const,
      label: "Terminal settings…",
      keywords: "terminal font family size line height spacing letter nerd font icons glyphs editor settings",
      run: () => openSettings("terminal"),
    },
    {
      id: "radio",
      group: "App",
      page: "Settings" as const,
      label: radio.enabled ? "Turn the lofi radio off" : "Turn the lofi radio on",
      keywords: "music stream audio",
      run: () => setMusicSettings({ enabled: !radio.enabled }),
    },
    {
      id: "games",
      group: "App",
      page: "App" as const,
      label: "Open the mini games",
      keys: [["⌘", "⇧", "B"]],
      keywords: "play game break",
      run: () => runAppCommand("show-games"),
    },
    ...(!(unity && floatingVisibility.collapsed)
      ? [
          {
            id: "releases",
            group: "App",
            page: "App" as const,
            label: "What's new",
            keywords: "release notes version update changelog",
            run: () => runAppCommand("show-releases"),
          },
        ]
      : []),
    {
      id: "shortcuts",
      group: "App",
      page: "App" as const,
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
        page: "Command" as const,
        kind: "Agent",
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
      page: "Command" as const,
      kind: "Workspace",
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
      page: "Command" as const,
      kind: "Project",
      label: placeText(p.name, "Project"),
      searchOnly: true,
      run: () => choose({ type: "project", id: projectKey(p) }),
    })),
  ];
  // The tabs' Show entries in the mode bar's order (Command, Files, GitHub, Conquer, Activity),
  // in the places they take among the rest.
  const tabEntries = ["command-show", "files-show", "github-show", "conquer", "activity-show"];
  const tabSlots = paletteCommands.flatMap((c, i) => (tabEntries.includes(c.id) ? [i] : []));
  tabSlots
    .map((i) => paletteCommands[i])
    .sort((a, b) => tabEntries.indexOf(a.id) - tabEntries.indexOf(b.id))
    .forEach((c, n) => (paletteCommands[tabSlots[n]] = c));
  const position = {
    index: agent ? navigationOrder.findIndex((a) => a.id === agent.id) : -1,
    total: navigationOrder.length,
    prev: () => step(-1),
    next: () => step(1),
  };

  // What the panel's detail shows (a conversation, New agent, a workspace or project, Add project), or, on Crew,
  // its conversation side (one copy at a time: the panel's is empty while Crew shows).
  const detailView = (
    <>
                  {addingProject ? (
                    <AddProject
                      hosts={hosts}
                      projects={projects}
                      initialHost={null}
                      online={online}
                      onClose={() => setAddingProject(false)}
                      onNotice={setNotice}
                      onAdded={async (projectId, host) => {
                        await refresh();
                        // A new project has no workspace (so no place on the
                        // map): its first agent makes one.
                        openDispatch({
                          projectId: projectKey({ projectId, host }),
                        });
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
                      onChanges={macApp() ? showWorkspaceChanges : undefined}
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
                          ? "Choose another from the crew."
                          : "Pick an agent in the crew to open its conversation."}
                      </p>
                    </div>
                  )}
    </>
  );

  return (
    <MotionConfig reducedMotion="user" transition={spring}>
      <main
        className={`command-app${native ? ` native-command${unity ? " unity-command" : ""}` : ""}`}
        aria-label="Paseo Command"
      >
        {native && (
          <div className="native-world-frame" ref={worldFrame}>
            {crewShown && (
              <CrewMap
                hosts={hosts}
                projects={projects}
                workspaces={workspaces}
                agents={active}
                permissions={permissionAgents}
                questions={questionAgents}
                asking={asking}
                unread={unread}
                selection={selection}
                select={choose}
                workingOn={workingOn}
                detail={detailView}
                empty={detailEmpty}
                loaded={!loading}
                blocked={confirming}
                onDispatch={() => openDispatch()}
                onAddProject={addProject}
                onArchive={(w) => openArchive(w, true)}
                archiving={archiving}
                {...(poolBoxes.length ? { pool: { boxes: poolBoxes, job: poolJob, release: openReleasePool } } : {})}
                {...(crewBrowsing ? { browser: { shown: browserShown, tabs: agentBrowser?.tabs.length ?? 0, toggle: toggleBrowser } } : {})}
              />
            )}
            {browserShown && agent && (
              <React.Suspense fallback={null}>
                <BoardBrowser
                  agent={agent}
                  name={agentName(agent, workspaceOf(agent)?.branch)}
                  blocked={confirming}
                  github={integrations.github}
                  onClose={() => setBrowserOpen(false)}
                  onNotice={setNotice}
                />
              </React.Suspense>
            )}
            {integrations.github && appMode === "github" && (
              <React.Suspense fallback={null}>
                <GitHubView onNotice={setNotice} onViewState={setGithubView} paseoFor={paseoFor} onOpenPaseo={openPaseo} onOpenInAgent={openPrInAgent} />
              </React.Suspense>
            )}
            {appMode === "files" && (
              <React.Suspense fallback={null}>
                <FilesView
                  workspace={githubWorkspace}
                  onNotice={setNotice}
                  onViewState={setFilesView}
                  {...(integrations.github ? { onOpenPr: openChangesPr, onExternal: openInConquer } : {})}
                />
              </React.Suspense>
            )}
            {showActivity && macApp() && <ActivityBadge />}
            {showActivity && appMode === "activity" && (
              <React.Suspense fallback={null}>
                <ActivityView onNotice={setNotice} onViewState={setActivityView} />
              </React.Suspense>
            )}
            {settingsShown && (
              <SettingsPage
                notifications={attention.notifications}
                onNotifications={() => void attention.requestNotifications()}
              />
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
          suppressed={panelAbsent}
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
          onVisibility={setFloatingVisibility}
          usage={usage}
          attention={permissions.length}
          onAttention={nextAttention}
        >
          <AppPanel>
            {/* Beside the other tabs, what is open shows here exactly as in Crew's drawer on the Command tab. */}
            {!crewShown && !detailEmpty && (
              <CrewDetail
                hosts={hosts}
                projects={projects}
                workspaces={workspaces}
                agents={active}
                permissions={permissionAgents}
                questions={questionAgents}
                asking={asking}
                unread={unread}
                selection={selection}
                select={choose}
                workingOn={workingOn}
                detail={detailView}
              />
            )}
          </AppPanel>
        </FloatingPanel>
        <div className="toast-stack">
          <AnimatePresence initial={false}>
            {archiveJobs.map((job) => (
              <ArchiveToast key={job.key} job={job} pool={integrations.pool} />
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
          {releaseBox && (
            <ReleasePoolDialog
              key="release-pool"
              box={releaseBox}
              agents={active.filter((a) =>
                hosts.some((h) => h.label === releaseBox.label && h.serverId === a.host),
              )}
              warning={releaseAsk?.warning}
              onCancel={cancelReleasePool}
              onConfirm={() => void confirmReleasePool()}
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
        <ProfilesEditorHost hosts={hosts} providers={providers} />
        <CommandPalette
          commands={paletteCommands}
          shown={settingsShown ? "Settings" : MODE_PAGES[appMode]}
          blocked={confirming}
        />
        <TooltipLayer />
      </main>
    </MotionConfig>
  );
}
/** A background workspace archive: in progress, done, or failed with Retry. */
function ArchiveToast({ job, pool }: { job: ArchiveJob; pool: boolean }) {
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
          onClick={() => archiveWithPool(job.workspace, pool)}
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
