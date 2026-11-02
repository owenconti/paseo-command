import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "framer-motion";
import { Archive, Box, ChevronRight, ListTodo, PanelLeftOpen, Pencil, RefreshCcw, RefreshCw, Search, Trash2, X } from "lucide-react";
import { errorMessage, readStore, removeStore, writeStore } from "../api";
import { onAppCommand, runAppCommand, type AppCommand } from "../appCommands";
import { linearIssueOfLink } from "../appLinks";
import { modalOpen } from "../focus";
import { useSecretRevision } from "../integrationSettings";
import { isTyping } from "../worldShortcut";
import { CreateIssue, type CreateInitial } from "./CreateIssue";
import { CycleFacts, CycleList } from "./Cycles";
import { DEFAULT_DISPLAY, GROUPINGS, readListView, writeFilters, type Display, type Grouping } from "./display";
import { Inbox, markAllRead } from "./Inbox";
import { unreadCount } from "./inboxRows";
import { InitiativeList } from "./InitiativeList";
import { IssueDetail } from "./IssueDetail";
import { IssueList, type IssueListNav, type IssueListState, type SaveViewAction } from "./IssueList";
import { linearKeyAction, type LinearKey } from "./keys";
import { currentPlace, resume, step, visit, type PlaceHistory } from "./history";
import { checkPlace, DEFAULT_PLACE, focusedFrom, placeScope, readPlace, writePlace, type LinearPlace } from "./place";
import { cycleName } from "./bits";
import { clearProjectView, ProjectFacts, ProjectList, type ProjectListState } from "./ProjectList";
import type { IssueContext } from "./prompt";
import { Sidebar, viewPlace } from "./Sidebar";
import { DeleteViewDialog, ViewDialog, ViewIcon, type ViewDialogMode, type ViewSource } from "./ViewDialog";
import { baseOfScope, DEFAULT_PROJECT_DISPLAY, intersectFilters, resolveIssueFilter, type ProjectDisplay } from "./viewFilter";
import {
  linearStore,
  loadCycles,
  loadNotifications,
  loadScope,
  loadSearch,
  loadViewProjects,
  loadViews,
  loadWorkspace,
  searchScope,
  setLinearNotice,
  useLinear,
  useLinearSync,
} from "./store";
import type { IssueScope, LinearCustomView, LinearIssue } from "./types";

/** Where the tab has been, kept while the page lives (so it outlasts showing the map or Conquer). */
let placeHistory: PlaceHistory | undefined;

/** The sidebar's width: its default, and the least it and the rest of the view keep. */
const LIST = { width: 320, min: 200, detailMin: 320 };
const listMax = (viewWidth: number) => Math.max(LIST.min, viewWidth - LIST.detailMin);
const clampList = (width: number, viewWidth: number) =>
  Math.round(Math.min(listMax(viewWidth), Math.max(LIST.min, width)));
/** The open issue beside the list: the least it keeps, and the least the list keeps beside it. */
const DETAIL = { min: 360, listMin: 320 };
/** From this width the open issue shows beside the list; narrower, in its place. */
const BESIDE_MIN = 1100;

/** How long the archive's Undo stays offered. */
const UNDO_MS = 10_000;

/** The keys that edit or copy from the open issue, by the command its ⌘K entry runs. */
const ISSUE_KEYS: Partial<Record<LinearKey, AppCommand>> = {
  status: "linear-status",
  priority: "linear-priority",
  assign: "linear-assignee",
  assignMe: "linear-assign-me",
  labels: "linear-labels",
  project: "linear-project",
  cycle: "linear-cycle",
  copyBranch: "linear-copy-branch",
  copyLink: "linear-copy-link",
};
/** What ⌘K needs to know of the open issue, to offer only what works on it. */
export type LinearOpenIssue = {
  key: string;
  subscribed: boolean;
  hasBranch: boolean;
  hasLink: boolean;
  hasCycles: boolean;
  hasEstimates: boolean;
  hasMilestones: boolean;
  mine: boolean;
};
/** What ⌘K needs to know of the view: its teams' places, the archive Undo offered, whether a list shows. */
export type LinearViewState = {
  /** Each team, whether it triages and runs cycles, and its current cycle's id. */
  teams: { id: string; name: string; triageEnabled: boolean; cyclesEnabled: boolean; currentCycleId?: string }[];
  /** The issue whose archive Undo is offered (its bar shows). */
  undoKey?: string;
  /** A list of issues shows, so / searches it, F filters it and its display can change. */
  canSearch: boolean;
  /** Your saved views, by name: of issues or projects, and the project a project's own view is in. */
  views: { id: string; name: string; model: "issue" | "project"; project?: string }[];
  /** What shows can be saved as a view (a list whose filters a view can say). */
  canSaveView: boolean;
  /** The view shown, which ⌘K offers to edit or delete. */
  shownView?: { id: string; name: string };
  /** The Inbox's unread rows, while it shows (⌘K offers marking them read). */
  inboxUnread?: number;
  /** Whether there's somewhere to go back or forward to. */
  canBack: boolean;
  canForward: boolean;
  /** The list's layout, groupings and whether it's filtered, while one shows. */
  list?: Pick<IssueListState, "layout" | "grouping" | "subGrouping" | "filtered">;
};

/** Layers in the view that keep their own keys while open. */
const LAYERS = ".popover-menu, .autocomplete, .lightbox, .inline-confirm";

const MY_TITLE = { assigned: "Assigned to you", created: "Created by you", subscribed: "Subscribed" };
const TEAM_TITLE = { triage: "Triage", active: "Active", backlog: "Backlog", all: "All issues" };

/**
 * The Linear tab, in the map's place (the macOS app's mode bar): Linear's
 * navigation in a sidebar (your issues, each team's views, projects,
 * initiatives), the place's list, and the open issue beside it (or in its
 * place when narrow), from which an agent can be launched. Everything shows
 * from the page's Linear store, kept current by sync while the view shows.
 * An issue's properties are edited in place (the detail's pickers, a row's
 * context menu), saved to Linear at once. As Conquer's tab sidebar, the
 * sidebar's inner edge resizes it and ⌘S hides or shows it (both remembered),
 * and the place comes back after a reload. New issue (the sidebar, ⌘K) opens
 * Create issue in the place's team; an archived issue leaves with Undo
 * offered in a bar at the view's foot; a deleted one leaves every list.
 * While the keyboard is in the view (not typing), Linear's keys work
 * (`keys.ts`), and the page's own letters and arrows (J/K, N, D…) stand down.
 */
export function LinearView({
  onLaunch,
  onNotice,
  onIssueOpen,
  onReady,
  onViewState,
}: {
  onLaunch: (issue: IssueContext) => void;
  onNotice: (message: string) => void;
  /** The open issue, or undefined (⌘K offers editing it, commenting on it, archiving it…, copying what it has). */
  onIssueOpen?: (issue: LinearOpenIssue | undefined) => void;
  /** Whether Linear's workspace is in, so an issue can be created (⌘K offers it). */
  onReady?: (ready: boolean) => void;
  /** The view's places and offers, for ⌘K (undefined once it goes). */
  onViewState?: (state: LinearViewState | undefined) => void;
}) {
  useLinearSync(true);
  // A write Linear refuses says why in the app's notice.
  useEffect(() => setLinearNotice(onNotice), [onNotice]);
  const ws = useLinear((d) => d.workspace);
  const unavailable = useLinear((d) => d.unavailable);
  const loadedScopes = useLinear((d) => d.loadedScopes);
  const cappedScopes = useLinear((d) => d.cappedScopes);
  const [place, setPlaceState] = useState<LinearPlace>(() => {
    const remembered = readPlace();
    placeHistory = resume(placeHistory, remembered);
    return remembered;
  });
  // Back and forward (⌘[ ⌘], the sidebar's arrows): redrawn as the history moves.
  const [, setHistoryMoved] = useState(0);
  /** Goes to `next`: a new history entry, or in the current one's place with `replace`. */
  const setPlace = useCallback((next: LinearPlace, replace = false) => {
    setPlaceState(next);
    writePlace(next);
    placeHistory = visit(placeHistory!, next, replace);
    setHistoryMoved((n) => n + 1);
  }, []);
  /** Corrects the place (a team, view or issue that's gone), in its history entry's place. */
  const correctPlace = useCallback((fix: (was: LinearPlace) => LinearPlace) => {
    setPlaceState((was) => {
      const next = fix(was);
      if (next === was) return was;
      writePlace(next);
      placeHistory = visit(placeHistory!, next, true);
      return next;
    });
  }, []);
  const goHistory = useCallback((by: -1 | 1) => {
    const moved = step(placeHistory!, by);
    if (!moved) return;
    placeHistory = moved;
    const next = currentPlace(moved);
    setPlaceState(next);
    writePlace(next);
    setHistoryMoved((n) => n + 1);
  }, []);
  /** Closes a focused issue: Back, as a browser's, else (nothing before it) to the place it came from. */
  const leaveFocused = useCallback(() => {
    if (placeHistory!.at > 0) goHistory(-1);
    else setPlace(focusedFrom(currentPlace(placeHistory!)), true);
  }, [goHistory, setPlace]);
  const canBack = placeHistory!.at > 0;
  const canForward = placeHistory!.at < placeHistory!.stack.length - 1;
  const placeTeamId = "teamId" in place ? place.teamId : undefined;
  const teamCycles = useLinear((d) => (placeTeamId ? d.cycles.get(placeTeamId) : undefined));
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [scopeErrors, setScopeErrors] = useState<Partial<Record<IssueScope, string>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  const [view, setView] = useState<HTMLElement | null>(null);
  const [listWidth, setListWidth] = useState(() => readStore("linear:listWidth", LIST.width));
  const [listHidden, setListHidden] = useState(() => readStore("linear:listHidden", false));
  const [viewWidth, setViewWidth] = useState(0);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const width = viewWidth ? clampList(listWidth, viewWidth) : listWidth;
  const resizeTo = (next: number) => {
    const w = viewWidth ? clampList(next, viewWidth) : next;
    setListWidth(w);
    writeStore("linear:listWidth", w);
  };
  // The open issue's width beside the list, once its edge is dragged (else it shares the room with the list).
  const [detailWidth, setDetailWidth] = useState<number | null>(() => readStore<number | null>("linear:detailWidth", null));
  const detailDrag = useRef<{ x: number; width: number } | null>(null);
  const detailMax = Math.max(DETAIL.min, viewWidth - (listHidden ? 0 : width) - DETAIL.listMin);
  const clampDetail = (w: number) => Math.round(viewWidth ? Math.min(detailMax, Math.max(DETAIL.min, w)) : Math.max(DETAIL.min, w));
  const detailW = detailWidth === null ? null : clampDetail(detailWidth);
  const resizeDetail = (next: number | null) => {
    const w = next === null ? null : clampDetail(next);
    setDetailWidth(w);
    if (w === null) removeStore("linear:detailWidth");
    else writeStore("linear:detailWidth", w);
  };
  /** The open issue's width as shown now (its edge may not have been dragged yet). */
  const shownDetailWidth = () =>
    detailW ?? view?.querySelector<HTMLElement>(".linear-detail")?.getBoundingClientRect().width ?? DETAIL.min;
  const toggleList = () =>
    setListHidden((hidden) => {
      writeStore("linear:listHidden", !hidden);
      return !hidden;
    });

  const loadWs = useCallback(
    (fresh: boolean) =>
      loadWorkspace(fresh).then(
        () => setWorkspaceError(undefined),
        (e) => {
          setWorkspaceError(errorMessage(e));
          throw e;
        },
      ),
    [],
  );
  const loadPlace = useCallback((scope: IssueScope, fresh: boolean) => {
    setScopeErrors(({ [scope]: _, ...rest }) => rest as Partial<Record<IssueScope, string>>);
    return loadScope(scope, fresh).catch((e) => {
      setScopeErrors((was) => ({ ...was, [scope]: errorMessage(e) }));
      throw e;
    });
  }, []);

  useEffect(() => {
    loadWs(false).catch(() => {});
    loadViews().catch(() => {});
    // The sidebar counts what's unread.
    loadNotifications().catch(() => {});
  }, [loadWs]);
  // A view you can no longer see (deleted, unshared) goes back to the default place; one of projects lists its projects.
  const views = useLinear((d) => d.views);
  useEffect(() => {
    if (!views) return;
    correctPlace((was) => {
      if (was.screen !== "view" && was.screen !== "projectView") return was;
      const view = views.find((v) => v.id === was.viewId);
      if (!view) return DEFAULT_PLACE;
      const right = viewPlace(view);
      return right.screen === was.screen ? was : { ...right, ...(was.issue ? { issue: was.issue } : {}) };
    });
  }, [views, correctPlace]);
  // Once the workspace is in, a remembered team or project it doesn't have goes back to the default.
  useEffect(() => {
    if (!ws) return;
    correctPlace((was) => {
      const checked = checkPlace(was, ws);
      return JSON.stringify(checked) === JSON.stringify(was) ? was : checked;
    });
  }, [ws, correctPlace]);
  const scope = placeScope(place);
  useEffect(() => {
    if (scope) loadPlace(scope, false).catch(() => {});
  }, [scope, loadPlace]);
  const nav = useRef<IssueListNav | null>(null);
  // The issues a list shows: the place's scope, or a search's.
  const searchTerm = place.screen === "search" ? place.query.trim() : undefined;
  const listScope = scope ?? (searchTerm !== undefined ? searchScope(searchTerm) : null);

  // A search asks Linear once typing pauses, for two characters or more.
  const [searchState, setSearchState] = useState<{ term: string; error?: string }>();
  const searchable = searchTerm !== undefined && searchTerm.length >= 2;
  // Refresh asks again; otherwise a term asked in the last minute isn't.
  const searchedRevision = useRef(revision);
  useEffect(() => {
    if (!searchable) return;
    let gone = false;
    const fresh = searchedRevision.current !== revision;
    searchedRevision.current = revision;
    const timer = setTimeout(() => {
      loadSearch(searchTerm!, fresh).then(({ error }) => {
        if (!gone) setSearchState({ term: searchTerm!, error });
      });
    }, 300);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [searchTerm, searchable, revision]);
  const searchMembers = useLinear((d) => (searchable ? d.members.get(searchScope(searchTerm!)) : undefined));
  const searchRank = useMemo(() => new Map(searchMembers?.map((id, n) => [id, n])), [searchMembers]);
  /** The last search's words, for the search button to come back to. */
  const lastSearch = useRef(place.screen === "search" ? place.query : "");
  if (place.screen === "search") lastSearch.current = place.query;
  // Into the search's field once it shows (the button, ⌘K).
  const [findRevision, setFindRevision] = useState(0);
  const find = useCallback(() => {
    setPlace({ screen: "search", query: lastSearch.current });
    setFindRevision((n) => n + 1);
  }, [setPlace]);
  useEffect(() => {
    if (findRevision) nav.current?.filter();
  }, [findRevision]);
  useEffect(() => onAppCommand("linear-find", find), [find]);

  // A project view's projects, by its filter.
  const projectViewId = place.screen === "projectView" ? place.viewId : undefined;
  useEffect(() => {
    if (projectViewId) loadViewProjects(projectViewId).catch(() => {});
  }, [projectViewId]);
  const viewProjects = useLinear((d) => (projectViewId ? d.viewProjects.get(projectViewId) : undefined));

  // A cycle's title and days: its team's cycles (a past one isn't among the workspace's).
  const cycleTeam = place.screen === "cycle" ? place.teamId : undefined;
  useEffect(() => {
    if (cycleTeam) loadCycles(cycleTeam).catch(() => {});
  }, [cycleTeam]);

  const refresh = () => {
    setRefreshing(true);
    setRevision((r) => r + 1);
    // The open issue is asked for again by its view, as `revision` changes.
    Promise.all([
      loadWs(true),
      loadViews(true),
      scope ? loadPlace(scope, true) : undefined,
      cycleTeam ? loadCycles(cycleTeam, true) : undefined,
      projectViewId ? loadViewProjects(projectViewId, true) : undefined,
    ])
      .catch((e) => onNotice(`Couldn’t refresh Linear: ${errorMessage(e)}`))
      .finally(() => setRefreshing(false));
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => onAppCommand("linear-refresh", () => refreshRef.current()), []);
  // A Linear key saved, replaced or removed in Settings: ask Linear again at once.
  const secretRevision = useSecretRevision("linearApiKey");
  useEffect(() => {
    if (secretRevision) refreshRef.current();
  }, [secretRevision]);

  useEffect(() => {
    if (!view) return;
    const watch = new ResizeObserver(() => setViewWidth(view.clientWidth));
    watch.observe(view);
    return () => watch.disconnect();
  }, [view]);
  // ⌘S, as in Conquer, ⌘[ ⌘] (back and forward) and ⌘+ ⌘− ⌘0 (the text size): while Linear shows, the page has the keys.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toggleList();
        return;
      }
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "[" || e.key === "]") && !modalOpen()) {
        e.preventDefault();
        goHistory(e.key === "[" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", key);
    const offs = [
      onAppCommand("linear-sidebar", toggleList),
      onAppCommand("linear-back", () => goHistory(-1)),
      onAppCommand("linear-forward", () => goHistory(1)),
    ];
    return () => {
      window.removeEventListener("keydown", key);
      offs.forEach((off) => off());
    };
  }, []);

  // ⌘K's edits only once the open issue is in the store (its properties show).
  const issueKnown = useLinear((d) => !!place.issue && d.byKey.has(place.issue));
  const issueOpen = issueKnown && !!ws;
  const openKey = issueOpen ? place.issue : undefined;
  const openIssueRecord = useLinear((d) => {
    const id = openKey && d.byKey.get(openKey);
    return id ? d.issues.get(id) : undefined;
  });
  const viewerId = ws?.viewerId;
  const subscribed = !!viewerId && !!openIssueRecord?.subscriberIds.includes(viewerId);
  const hasBranch = !!openIssueRecord?.branchName;
  const hasLink = !!openIssueRecord?.url;
  const openTeam = ws?.teams.find((t) => t.id === openIssueRecord?.teamId);
  const hasCycles = !!openTeam?.cyclesEnabled;
  const hasEstimates = !!openTeam?.estimates.length;
  const hasMilestones = !!ws?.projects.find((p) => p.id === openIssueRecord?.projectId)?.milestones.length;
  const mine = !!viewerId && openIssueRecord?.assigneeId === viewerId;
  useEffect(() => {
    onIssueOpen?.(
      openKey
        ? { key: openKey, subscribed, hasBranch, hasLink, hasCycles, hasEstimates, hasMilestones, mine }
        : undefined,
    );
  }, [openKey, subscribed, hasBranch, hasLink, hasCycles, hasEstimates, hasMilestones, mine, onIssueOpen]);
  // A reload (sync's "more") asks for the open issue too; a view shown is asked again as issues change.
  useEffect(() => {
    linearStore.setOpenIssue(place.issue);
    return () => linearStore.setOpenIssue(undefined);
  }, [place.issue]);
  useEffect(() => {
    linearStore.setShownScope(listScope ?? undefined);
    return () => linearStore.setShownScope(undefined);
  }, [listScope]);
  useEffect(() => () => onIssueOpen?.(undefined), [onIssueOpen]);
  useEffect(() => {
    onReady?.(!!ws);
  }, [ws, onReady]);
  useEffect(() => () => onReady?.(false), [onReady]);

  // Create issue: in the place's team (or project), or under an issue.
  // Each opening is its own dialog (by `serial`), not the one still animating out.
  const [creating, setCreatingState] = useState<(CreateInitial & { serial: number }) | null>(null);
  const serial = useRef(0);
  const setCreating = useCallback(
    (initial: CreateInitial | null) => setCreatingState(initial && { ...initial, serial: ++serial.current }),
    [],
  );
  const placeRef = useRef(place);
  placeRef.current = place;
  const createHere = useCallback(() => {
    const p = placeRef.current;
    const workspace = linearStore.getState().workspace;
    if (!workspace) return;
    if (p.screen === "team" || p.screen === "cycles") setCreating({ teamId: p.teamId });
    else if (p.screen === "cycle") setCreating({ teamId: p.teamId, cycleId: p.cycleId });
    else if (p.screen === "project") {
      const project = workspace.projects.find((x) => x.id === p.projectId);
      setCreating({ projectId: p.projectId, teamId: project?.teamIds[0] });
    } else setCreating({});
  }, [setCreating]);
  useEffect(() => onAppCommand("linear-create", createHere), [createHere]);
  const subIssue = (parent: LinearIssue) =>
    setCreating({ teamId: parent.teamId, parentId: parent.id, projectId: parent.projectId });

  // Archive leaves Undo in a bar for a while; Delete only says when Linear refused.
  const [undo, setUndo] = useState<{ id: string; key: string; phase: "archiving" | "archived" | "restoring" }>();
  useEffect(() => {
    if (undo?.phase !== "archived") return;
    const timer = setTimeout(() => setUndo((u) => (u === undo ? undefined : u)), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);
  /** Closes `key` if it's the open issue (it was archived or deleted). */
  const closeIssue = (key: string) =>
    correctPlace((was) => {
      if (was.issue !== key) return was;
      if (was.screen === "issue") return focusedFrom(was);
      const { issue: _, ...rest } = was;
      return rest as LinearPlace;
    });
  // The issue stays open until Linear has archived it; refused, it stays and the notice says why.
  const archive = async (issue: LinearIssue) => {
    setUndo({ id: issue.id, key: issue.key, phase: "archiving" });
    const done = await linearStore.write("issueArchive", { id: issue.id });
    if (done) closeIssue(issue.key);
    setUndo((u) => (u?.id !== issue.id ? u : done ? { ...u, phase: "archived" } : undefined));
  };
  const unarchive = async () => {
    if (undo?.phase !== "archived") return;
    const was = undo;
    setUndo({ ...was, phase: "restoring" });
    const done = await linearStore.write("issueUnarchive", { id: was.id });
    setUndo((u) => (u?.id !== was.id ? u : done ? undefined : { ...was, phase: "archived" }));
  };
  const remove = async (issue: LinearIssue) => {
    const done = await linearStore.write("issueDelete", { id: issue.id });
    if (done) {
      closeIssue(issue.key);
      linearStore.removeIssue(issue.id);
    }
    return done;
  };

  const unarchiveRef = useRef(unarchive);
  unarchiveRef.current = unarchive;
  useEffect(() => onAppCommand("linear-undo-archive", () => void unarchiveRef.current()), []);

  useEffect(() => {
    const offs = [
      onAppCommand("linear-search", () => nav.current?.filter()),
      onAppCommand("linear-filter", () => nav.current?.filterBy()),
      onAppCommand("linear-display", () => nav.current?.display()),
      onAppCommand("linear-clear-filters", () => nav.current?.clearFilters()),
      onAppCommand("linear-layout", (arg) => {
        if (arg === "list" || arg === "board") nav.current?.setLayout(arg);
      }),
      onAppCommand("linear-sub-group", (arg) => {
        if (typeof arg === "string" && (GROUPINGS as string[]).includes(arg)) nav.current?.setSubGrouping(arg as Grouping);
      }),
      onAppCommand("linear-swap-groupings", () => nav.current?.swapGroupings()),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  const [listState, setListState] = useState<IssueListState>();
  // ⌘K's places: checked as a remembered one is (an unknown team goes to the default).
  useEffect(
    () =>
      onAppCommand("linear-go", (arg) => {
        const next = checkPlace(arg, linearStore.getState().workspace);
        setPlace(next);
      }),
    [setPlace],
  );
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    // Only the view's own elements: not its dialogs and menus elsewhere on the page.
    if (!e.currentTarget.contains(target) || !e.key || modalOpen()) return;
    const layered = [...e.currentTarget.querySelectorAll(LAYERS)].some((layer) => !layer.closest("[inert]"));
    const { key, metaKey, shiftKey, ctrlKey, altKey } = e;
    const action =
      e.defaultPrevented || layered ? null : linearKeyAction({ key, metaKey, shiftKey, ctrlKey, altKey, target });
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(target);
    const run = action && keyAction(action, target, key);
    if (run) {
      e.preventDefault();
      e.stopPropagation();
    } else if (plain && (/^[a-z]$/i.test(e.key) || e.key.startsWith("Arrow"))) e.stopPropagation();
  };
  /** Does what `action` asks; false when it doesn't apply here (the key goes on as usual). */
  const keyAction = (action: LinearKey, target: HTMLElement, key: string): boolean => {
    const issueOpenNow = !!placeRef.current.issue;
    switch (action) {
      case "down":
      case "up":
        nav.current?.move(action === "down" ? 1 : -1);
        return true;
      case "open":
        // Other buttons and links keep their own Enter (O still opens).
        if (
          key === "Enter" &&
          target.closest("button,a,summary,[role=button],[role=tab],[role=menuitem]") &&
          !target.closest(".linear-row")
        )
          return false;
        nav.current?.open();
        return true;
      case "back": {
        // With no issue open, Esc stops here: the page's own would clear the map's (hidden) selection.
        if (!issueOpenNow) return true;
        if (placeRef.current.screen === "issue") {
          leaveFocused();
          return true;
        }
        const key = placeRef.current.issue!;
        // The keyboard stays in the view as the issue goes: on its row, else the view.
        if (target.closest(".linear-detail"))
          (view?.querySelector<HTMLElement>(`.linear-row[data-key="${key}"]`) ?? view)?.focus({ preventScroll: true });
        closeIssue(key);
        return true;
      }
      case "create":
        createHere();
        return true;
      case "filter":
        nav.current?.filter();
        return true;
      case "filterBy":
        nav.current?.filterBy();
        return true;
      default: {
        const command = ISSUE_KEYS[action];
        if (command && issueOpenNow) runAppCommand(command);
        return true;
      }
    }
  };

  // ⌘K's places, Undo and list search, offered only while they'd work.
  const teams = ws?.teams;
  const undoKey = undo?.phase === "archived" ? undo.key : undefined;
  // A view's own display, as set in Linear, until it's changed here.
  const shownView =
    place.screen === "view" || place.screen === "projectView" ? views?.find((v) => v.id === place.viewId) : undefined;
  const isSearch = place.screen === "search";
  const placeDisplay = useMemo<Display>(
    () =>
      isSearch
        ? { ...DEFAULT_DISPLAY, grouping: "none", ordering: "relevance" }
        : { ...DEFAULT_DISPLAY, ...shownView?.display },
    [isSearch, shownView?.display],
  );
  // A board needs the width: an issue opens in its place, as in Linear.
  // The place's layout: as its list said, else as kept (the list may not show, the issue in its place).
  const listKey = place.screen === "search" ? "search" : listScope;
  const layout = !listKey
    ? undefined
    : listState?.key === listKey
      ? listState.layout
      : readListView(listKey, placeDisplay).display.layout;
  const boardShown = layout === "board";
  const wide = (viewWidth === 0 || viewWidth >= BESIDE_MIN) && !boardShown;
  const canSearch = !!ws && !!listScope && (!place.issue || wide);

  // Views: what the place shows, as a view would keep it (its base, its filters ∩ the list's, the display shown).
  const [projectListState, setProjectListState] = useState<ProjectListState>();
  const projectListKey =
    place.screen === "projects" ? "projects" : place.screen === "projectView" ? `projectView:${place.viewId}` : undefined;
  const projectDisplay = useMemo<ProjectDisplay>(
    () => ({ ...DEFAULT_PROJECT_DISPLAY, ...shownView?.projectDisplay }),
    [shownView?.projectDisplay],
  );
  const viewSource = useMemo<ViewSource | undefined>(() => {
    if (!ws) return undefined;
    if (projectListKey) {
      if (shownView && !shownView.projectFilter) return undefined;
      const local = projectListState?.key === projectListKey ? projectListState : undefined;
      return {
        model: "project",
        projectFilter: intersectFilters(shownView?.projectFilter ?? {}, local?.filters ?? {}),
        projectDisplay: local?.display ?? projectDisplay,
      };
    }
    if (!scope || !listKey) return undefined;
    const local = listState?.key === listKey ? listState : undefined;
    const start = shownView
      ? shownView.filter
        ? resolveIssueFilter(shownView.filter, ws.states)
        : null
      : baseOfScope(scope);
    if (!start) return undefined;
    return {
      model: "issue",
      filter: { base: start.base, filters: intersectFilters(start.filters, local?.filters ?? {}) },
      display: local?.display ?? readListView(listKey, placeDisplay).display,
    };
  }, [ws, projectListKey, shownView, projectListState, projectDisplay, scope, listKey, listState, placeDisplay]);
  /** Whether the list shows other filters or display than its place's own. */
  const shownChanged = projectListKey
    ? projectListState?.key === projectListKey && projectListState.changed
    : listState?.key === listKey && !!listState?.changed;
  const shownViewEditable = !!shownView && (shownView.model === "project" ? !!shownView.projectFilter : !!shownView.filter);
  // The view dialogs; each opening its own (by `serial`), not one still animating out.
  type Dialog = (ViewDialogMode | { kind: "delete"; viewId: string }) & { serial: number };
  const [dialog, setDialogState] = useState<Dialog | null>(null);
  const setDialog = (next: ViewDialogMode | { kind: "delete"; viewId: string } | null) =>
    setDialogState(next && { ...next, serial: ++serial.current });
  const viewSourceRef = useRef(viewSource);
  viewSourceRef.current = viewSource;
  const openCreateView = () => {
    const source = viewSourceRef.current;
    if (!source) return;
    const p = placeRef.current;
    const teamId = source.model === "issue" ? source.filter.base.teamId : undefined;
    const projectId = p.screen === "project" ? p.projectId : shownView?.projectId;
    setDialog({ kind: "create", source, ...(teamId ? { teamId } : {}), ...(projectId ? { projectId } : {}) });
  };
  const openEditView = (viewId: string, useShown: boolean) =>
    setDialog({
      kind: "edit",
      viewId,
      ...(viewId === shownView?.id && shownChanged && viewSourceRef.current ? { shown: viewSourceRef.current, useShown } : {}),
    });
  const viewCommands = useRef({ create: openCreateView, edit: () => {}, remove: () => {} });
  viewCommands.current = {
    create: openCreateView,
    edit: () => shownView && openEditView(shownView.id, shownChanged),
    remove: () => shownView && setDialog({ kind: "delete", viewId: shownView.id }),
  };
  useEffect(() => {
    const offs = [
      onAppCommand("linear-save-view", () => viewCommands.current.create()),
      onAppCommand("linear-edit-view", () => viewCommands.current.edit()),
      onAppCommand("linear-delete-view", () => viewCommands.current.remove()),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  /** Deletes a view, after the dialog confirmed: the place leaves it first (for its project's, or the default). */
  const deleteView = (view: LinearCustomView) => {
    const p = placeRef.current;
    if ((p.screen === "view" || p.screen === "projectView") && p.viewId === view.id)
      setPlace(view.projectId ? { screen: "project", projectId: view.projectId } : view.model === "project" ? { screen: "projects" } : DEFAULT_PLACE);
    void linearStore.deleteView(view.id);
  };
  // A view saved with what its list showed: the list starts again from the view (its own filters and display put away).
  const [listRevision, setListRevision] = useState(0);
  const viewSaved = (view: LinearCustomView) => {
    if (view.model === "project") clearProjectView(`projectView:${view.id}`);
    else {
      writeFilters(`view:${view.id}`, {});
      removeStore(`linear:display:view:${view.id}`);
    }
    setListRevision((n) => n + 1);
  };
  const saveAction: SaveViewAction | undefined = !viewSource
    ? undefined
    : shownView
      ? shownViewEditable
        ? { label: "Save to view", tip: "Save these filters and display to the view", run: () => openEditView(shownView.id, true) }
        : undefined
      : { label: "Save as view", tip: "Save these filters and display as a Linear view", run: openCreateView };
  const viewPlaces = JSON.stringify(
    views
      ?.filter((v) => !v.id.startsWith("pending-"))
      .map((v) => ({
        id: v.id,
        name: v.name,
        model: v.model,
        ...(v.projectId ? { project: ws?.projects.find((p) => p.id === v.projectId)?.name ?? "a project" } : {}),
      })) ?? [],
  );
  const inboxShown = place.screen === "inbox";
  const canSaveView = !!viewSource && !shownView;
  const shownViewPlace =
    shownView && !shownView.id.startsWith("pending-") ? JSON.stringify({ id: shownView.id, name: shownView.name }) : undefined;
  // ⌘K's Mark all read: here, as the Inbox gives way to an issue opened from it when narrow.
  useEffect(() => onAppCommand("linear-inbox-read-all", markAllRead), []);
  const inboxUnread = useLinear((d) =>
    inboxShown && d.notificationsLoaded ? unreadCount(d.notifications.values(), Date.now()) : undefined,
  );
  const currentCycles = ws?.cycles.filter((c) => c.isActive);
  const teamPlaces = JSON.stringify(
    teams?.map((t) => [
      t.id,
      t.name,
      t.triageEnabled,
      t.cyclesEnabled,
      currentCycles?.find((c) => c.teamId === t.id)?.id,
    ]) ?? [],
  );
  useEffect(() => {
    const list = JSON.parse(teamPlaces) as [string, string, boolean, boolean, string | null][];
    onViewState?.({
      teams: list.map(([id, name, triageEnabled, cyclesEnabled, currentCycleId]) => ({
        id,
        name,
        triageEnabled,
        cyclesEnabled,
        ...(currentCycleId ? { currentCycleId } : {}),
      })),
      undoKey,
      canSearch,
      views: JSON.parse(viewPlaces) as LinearViewState["views"],
      canSaveView,
      ...(shownViewPlace ? { shownView: JSON.parse(shownViewPlace) as { id: string; name: string } } : {}),
      canBack,
      canForward,
      ...(inboxUnread !== undefined ? { inboxUnread } : {}),
      ...(canSearch && listState?.key === listKey ? {
            list: {
              layout: listState.layout,
              grouping: listState.grouping,
              subGrouping: listState.subGrouping,
              filtered: listState.filtered,
            },
          } : {}),
    });
  }, [teamPlaces, viewPlaces, inboxUnread, canBack, canForward, undoKey, canSearch, listState, listKey, canSaveView, shownViewPlace, onViewState]);
  useEffect(() => () => onViewState?.(undefined), [onViewState]);

  if (!ws && (unavailable || workspaceError))
    return (
      <section className="linear-view linear-unavailable" aria-label="Linear" ref={setView}>
        <ListTodo size={28} strokeWidth={1.5} aria-hidden="true" />
        <h2>{unavailable ? "Linear isn’t connected" : "Linear didn’t answer"}</h2>
        <p>{unavailable?.reason ?? workspaceError}</p>
        <button className="secondary" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={12} aria-hidden="true" />
          Try again
        </button>
      </section>
    );

  const beside = wide;
  const openIssue = place.issue;
  // Moving through a list (↑/↓, J/K) changes the open issue in its history entry; choosing one is a new entry.
  const open = (key: string, how?: "step") => setPlace({ ...place, issue: key }, how === "step");
  const close = () => {
    if (place.screen === "issue") return leaveFocused();
    const { issue: _, ...rest } = place;
    setPlace(rest as LinearPlace);
  };
  const openProject = (projectId: string) => setPlace({ screen: "project", projectId });
  // An issue focused from outside the tab stands alone, in the list's place.
  const showList = !openIssue || (beside && place.screen !== "issue");
  const team = "teamId" in place ? ws?.teams.find((t) => t.id === place.teamId) : undefined;
  const cycleId = place.screen === "cycle" ? place.cycleId : undefined;
  const cycle = cycleId
    ? (teamCycles?.find((c) => c.id === cycleId) ?? ws?.cycles.find((c) => c.id === cycleId))
    : undefined;
  const project = place.screen === "project" ? ws?.projects.find((p) => p.id === place.projectId) : undefined;
  // A project's own views, under its summary.
  const ownViews = project ? (views ?? []).filter((v) => v.projectId === project.id && !v.id.startsWith("pending-")) : [];
  const viewProject = shownView?.projectId ? ws?.projects.find((p) => p.id === shownView.projectId) : undefined;
  const viewActions =
    shownView && !shownView.id.startsWith("pending-") ? (
      <span className="linear-view-actions">
        <button
          className="icon-btn"
          aria-label={`Edit the view ${shownView.name}`}
          data-tip="Edit view"
          onClick={() => openEditView(shownView.id, shownChanged)}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          className="icon-btn"
          aria-label={`Delete the view ${shownView.name}`}
          data-tip="Delete view"
          onClick={() => setDialog({ kind: "delete", viewId: shownView.id })}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </span>
    ) : undefined;
  const sharedWith = (v: LinearCustomView) =>
    !v.shared ? "Only you" : v.teamId ? `Shared with ${ws?.teams.find((t) => t.id === v.teamId)?.name ?? "a team"}` : "Shared with the workspace";
  const viewAbout = shownView && (
    <p className="linear-view-about">
      {shownView.description && <span>{shownView.description}</span>}
      <span className="linear-view-owner">
        {sharedWith(shownView)}
        {ws?.users.find((u) => u.id === shownView.ownerId) && ` · by ${ws.users.find((u) => u.id === shownView.ownerId)!.name}`}
        {!shownViewEditable && " · Filtered as set in Linear"}
      </span>
    </p>
  );

  const main = () => {
    if (place.screen === "search") {
      const short = !searchable;
      const answered = searchState?.term === searchTerm;
      return (
        <IssueList
          key={listRevision}
          title={
            <>
              <Search size={16} aria-hidden="true" className="linear-view-icon" />
              <span className="page-head-name">Search</span>
            </>
          }
          scope={listScope!}
          rank={searchRank}
          viewKey="search"
          defaultDisplay={placeDisplay}
          openKey={openIssue}
          onOpen={open}
          opensBeside={beside}
          loading={searchable && !searchMembers && !(answered && searchState?.error)}
          error={answered ? searchState?.error : undefined}
          emptyNote={short ? "Type two or more characters to search every issue in Linear." : "No issues match."}
          nav={nav}
          onListState={setListState}
          search={{
            value: place.query,
            // Typing changes the search's history entry.
            onChange: (query) => setPlace({ screen: "search", query }, true),
            label: "Search all issues in Linear",
            placeholder: "Search all issues",
          }}
        />
      );
    }
    if (place.screen === "inbox")
      return <Inbox openKey={openIssue} onOpen={open} onProject={openProject} revision={revision} nav={nav} />;
    if (place.screen === "projects")
      return (
        <ProjectList
          key={listRevision}
          onProject={openProject}
          viewKey="projects"
          saveView={saveAction}
          onListState={setProjectListState}
        />
      );
    if (place.screen === "projectView")
      return (
        <ProjectList
          key={listRevision}
          onProject={openProject}
          title={
            <>
              <ViewIcon view={shownView ?? { model: "project", color: "" }} size={16} />
              <span className="page-head-name">{shownView?.name ?? "View"}</span>
            </>
          }
          projects={viewProjects}
          loading={!viewProjects}
          viewKey={projectListKey}
          defaultDisplay={projectDisplay}
          actions={viewActions}
          saveView={saveAction}
          onListState={setProjectListState}
        >
          {viewAbout}
        </ProjectList>
      );
    if (place.screen === "initiatives") return <InitiativeList onProject={openProject} />;
    const teamCrumb = (
      <>
        <span className="linear-crumb page-crumb">{team?.name ?? "Team"}</span>
        <ChevronRight size={14} className="linear-crumb-sep" aria-hidden="true" />
      </>
    );
    if (place.screen === "cycles")
      return (
        <CycleList
          teamId={place.teamId}
          title={<>{teamCrumb}<span className="page-head-name">Cycles</span></>}
          revision={revision}
          onCycle={(cycleId) => setPlace({ screen: "cycle", teamId: place.teamId, cycleId })}
        />
      );
    const title =
      place.screen === "my" ? (
        MY_TITLE[place.tab]
      ) : place.screen === "team" ? (
        <>
          {teamCrumb}
          <span className="page-head-name">{TEAM_TITLE[place.tab]}</span>
        </>
      ) : place.screen === "view" ? (
        <>
          {viewProject && (
            <>
              <button className="link-btn linear-crumb page-crumb" onClick={() => setPlace({ screen: "projects" })}>
                Projects
              </button>
              <ChevronRight size={14} className="linear-crumb-sep" aria-hidden="true" />
              <button className="link-btn linear-crumb page-crumb" onClick={() => openProject(viewProject.id)}>
                {viewProject.name}
              </button>
              <ChevronRight size={14} className="linear-crumb-sep" aria-hidden="true" />
            </>
          )}
          <ViewIcon view={shownView ?? { model: "issue", color: "" }} size={16} />
          <span className="page-head-name">{shownView?.name ?? "View"}</span>
        </>
      ) : place.screen === "cycle" ? (
        <>
          {teamCrumb}
          <button className="link-btn linear-crumb page-crumb" onClick={() => setPlace({ screen: "cycles", teamId: place.teamId })}>
            Cycles
          </button>
          <ChevronRight size={14} className="linear-crumb-sep" aria-hidden="true" />
          <span className="page-head-name">{cycle ? cycleName(cycle) : "Cycle"}</span>
        </>
      ) : (
        <>
          <button className="link-btn linear-crumb page-crumb" onClick={() => setPlace({ screen: "projects" })}>
            Projects
          </button>
          <ChevronRight size={14} className="linear-crumb-sep" aria-hidden="true" />
          <span className="page-head-name">{project?.name ?? "Project"}</span>
        </>
      );
    return (
      <IssueList
        key={listRevision}
        title={title}
        scope={scope!}
        actions={viewActions}
        saveView={saveAction}
        openKey={openIssue}
        onOpen={open}
        opensBeside={beside}
        loading={!loadedScopes.has(scope!) && !scopeErrors[scope!]}
        capped={cappedScopes.has(scope!)}
        error={scopeErrors[scope!]}
        nav={nav}
        teamId={place.screen === "cycle" ? place.teamId : shownView?.teamId}
        defaultDisplay={placeDisplay}
        onListState={setListState}
      >
        {viewAbout}
        {project && (
          <div className="linear-project-summary">
            <Box size={14} style={{ color: project.color }} aria-hidden="true" />
            <ProjectFacts project={project} ws={ws} />
          </div>
        )}
        {ownViews.length > 0 && (
          <nav className="linear-project-views" aria-label={`${project!.name}’s views`}>
            <span className="linear-project-views-label">Views</span>
            {ownViews.map((v) => (
              <button key={v.id} className="linear-project-view" onClick={() => setPlace(viewPlace(v))}>
                <ViewIcon view={v} size={12} />
                {v.name}
              </button>
            ))}
          </nav>
        )}
        {place.screen === "cycle" && (
          <div className="linear-project-summary">
            <RefreshCcw size={14} aria-hidden="true" className="linear-cycle-icon" />
            <CycleFacts cycle={cycle} scope={`cycle:${place.cycleId}`} />
          </div>
        )}
      </IssueList>
    );
  };

  const columns = [
    listHidden ? null : `${width}px`,
    showList ? "minmax(0, 1fr)" : null,
    openIssue ? (showList ? (detailW !== null ? `${detailW}px` : `minmax(${DETAIL.min}px, 1.2fr)`) : "minmax(0, 1fr)") : null,
  ].filter(Boolean);
  return (
    <section
      className={`linear-view${listHidden ? " sidebar-hidden" : ""}${showList ? "" : " issue-only"}`}
      aria-label="Linear"
      ref={setView}
      style={{ gridTemplateColumns: columns.join(" ") }}
      // A click on the view's background keeps the keyboard in it, for its keys.
      tabIndex={-1}
      onKeyDown={onKey}
      // A link to an issue inside the tab (a description, a comment) opens it here, as a row does;
      // the app would otherwise route it as one from outside.
      onClickCapture={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
        const link = (e.target as Element).closest?.("a[href]");
        const key = link instanceof HTMLAnchorElement ? linearIssueOfLink(link.href) : null;
        if (!key) return;
        e.preventDefault();
        open(key);
      }}
      // A mouse's back and forward buttons.
      onMouseUp={(e) => {
        if (e.button !== 3 && e.button !== 4) return;
        e.preventDefault();
        goHistory(e.button === 3 ? -1 : 1);
      }}
    >
      <nav className="linear-sidebar" id="linear-sidebar" aria-label="Linear navigation" hidden={listHidden}>
        <Sidebar
          place={place}
          onPlace={setPlace}
          onHide={toggleList}
          onRefresh={refresh}
          refreshing={refreshing}
          onCreate={ws ? createHere : undefined}
          onSearch={find}
          onBack={canBack ? () => goHistory(-1) : undefined}
          onForward={canForward ? () => goHistory(1) : undefined}
          onEditView={(viewId) => openEditView(viewId, false)}
          onDeleteView={(viewId) => setDialog({ kind: "delete", viewId })}
        />
        <div
          className="linear-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the Linear sidebar"
          aria-controls="linear-sidebar"
          aria-valuemin={LIST.min}
          aria-valuemax={viewWidth ? listMax(viewWidth) : undefined}
          aria-valuenow={width}
          aria-description="Drag, or use the arrow keys, to change the sidebar's width. Shift resizes faster; double-click restores the default."
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, width };
          }}
          onPointerMove={(e) => {
            if (drag.current) resizeTo(drag.current.width + e.clientX - drag.current.x);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onLostPointerCapture={() => (drag.current = null)}
          onDoubleClick={() => resizeTo(LIST.width)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            resizeTo(width + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 64 : 16));
          }}
        />
      </nav>
      {listHidden && (
        <button
          className="icon-btn linear-show-list"
          aria-label="Show the Linear sidebar"
          data-tip="Show the sidebar (⌘S)"
          onClick={toggleList}
        >
          <PanelLeftOpen size={14} aria-hidden="true" />
        </button>
      )}
      {showList && (
        <div className="linear-main">
          {unavailable && (
            <p className="linear-banner" role="status">
              {unavailable.reason}
              {unavailable.retryAt ? ` Trying again ${new Date(unavailable.retryAt).toLocaleTimeString()}.` : ""}
            </p>
          )}
          {main()}
          {openIssue && (
            <div
              className="linear-resize"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the open issue"
              aria-controls="linear-detail"
              aria-valuemin={DETAIL.min}
              aria-valuemax={viewWidth ? detailMax : undefined}
              aria-valuenow={detailW ?? undefined}
              aria-description="Drag, or use the arrow keys, to change the width of the open issue beside the list. Shift resizes faster; double-click shares the room again."
              tabIndex={0}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.currentTarget.setPointerCapture(e.pointerId);
                detailDrag.current = { x: e.clientX, width: shownDetailWidth() };
              }}
              onPointerMove={(e) => {
                if (detailDrag.current) resizeDetail(detailDrag.current.width - (e.clientX - detailDrag.current.x));
              }}
              onPointerUp={() => (detailDrag.current = null)}
              onPointerCancel={() => (detailDrag.current = null)}
              onLostPointerCapture={() => (detailDrag.current = null)}
              onDoubleClick={() => resizeDetail(null)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                resizeDetail(shownDetailWidth() + (e.key === "ArrowLeft" ? 1 : -1) * (e.shiftKey ? 64 : 16));
              }}
            />
          )}
        </div>
      )}
      {openIssue && (
        <IssueDetail
          key={openIssue}
          issueKey={openIssue}
          onOpen={open}
          onClose={close}
          closeLabel={showList ? "Close" : "Back"}
          onLaunch={onLaunch}
          revision={revision}
          onNotice={onNotice}
          onSubIssue={subIssue}
          onArchive={(issue) => void archive(issue)}
          onDelete={remove}
          leaving={undo?.phase === "archiving" && undo.key === openIssue}
        />
      )}
      {undo && (
        <div className="linear-undo" role="status">
          <Archive size={13} aria-hidden="true" />
          <span>
            {undo.phase === "archiving"
              ? `Archiving ${undo.key}…`
              : undo.phase === "restoring"
                ? `Restoring ${undo.key}…`
                : `${undo.key} archived`}
          </span>
          {undo.phase === "archived" && (
            <>
              <button type="button" className="link-btn" onClick={() => void unarchive()}>
                Undo
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Dismiss"
                data-tip="Dismiss"
                onClick={() => setUndo(undefined)}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
      {createPortal(
        <AnimatePresence>
          {creating && (
            <CreateIssue
              key={creating.serial}
              initial={creating}
              onClose={(created) => {
                setCreating(null);
                if (created) setPlace({ ...placeRef.current, issue: created.key });
              }}
            />
          )}
          {dialog && dialog.kind !== "delete" && (
            <ViewDialog
              key={dialog.serial}
              mode={dialog}
              onClose={(saved, tookShown) => {
                setDialog(null);
                if (!saved) return;
                if (dialog.kind === "create") setPlace(viewPlace(saved));
                else if (tookShown) viewSaved(saved);
              }}
            />
          )}
          {dialog?.kind === "delete" && (
            <DeleteViewDialog
              key={dialog.serial}
              viewId={dialog.viewId}
              onConfirm={(view) => {
                setDialog(null);
                deleteView(view);
              }}
              onClose={() => setDialog(null)}
            />
          )}
        </AnimatePresence>,
        document.querySelector("main.command-app") ?? document.body,
      )}
    </section>
  );
}
