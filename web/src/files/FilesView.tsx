import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  GitBranch,
  GitCompare,
  PanelLeftOpen,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { File, Virtualizer } from "@pierre/diffs/react";
import { readStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { modalOpen, useFocusTrap } from "../focus";
import { copyText } from "../nativePlatform";
import { usePageTitleTip } from "../pageHead";
import { ResizeEdge } from "../ResizeEdge";
import { useTheme } from "../theme";
import { plainText } from "../ui";
import { isTyping } from "../worldShortcut";
import { macApp } from "../worldBridge";
import { invalidate } from "../github/api";
import type { DiffLayout, DiffViewHandle } from "../github/DiffView";
import { CHANGES_MODES, type ChangesMode } from "../github/types";
import { ChangesView } from "./ChangesView";
import { checkChangesAsk, takeChangesAsk } from "./open";
import { clearFindMarks, FIND_CSS, FindBar, revealMatch, useFindPaint } from "../github/DiffFind";
import { findInText, sameMatch, type FindMatch, type FindOptions } from "../github/diffSearch";
import { Marked } from "../github/DiffView";
import { DIFF_THEMES, DiffWorkers } from "../github/diffWorkers";
import { hashText } from "../github/rows";
import { allPath, changedPath, ensure, load, peek, prefetch, readPath, reload, treePath, useFilesVersion, type FilesWorkspace } from "./api";
import { filterRows, parentsOf, rankPaths, sizeLabel, treeRows, type Listing, type TreeRow } from "./tree";
import { keptKey as keyOf, readKept, RECENT, writeKept, type Kept } from "./kept";
import { closeOtherTabs, closeTab, moveTab, NO_TABS, openTab, pinTab, reopenTab, scrollTab, stepTab, tabLabels, type FileTab, type TabsState } from "./tabs";
import { FILE_LIMITS, type FileChange, type FileChanges, type FileList, type FileRead, type FileTree } from "./types";
import "../github/github.css";
import "./files.css";

/** The workspace whose files show: the selected one, or the selected agent's. */
export type FilesWorkspaceInfo = FilesWorkspace & { name: string };

/** What ⌘K needs to know. */
export type FilesViewState = {
  workspace?: string;
  /** The open file, and whether it's changed (Show changes). */
  file?: string;
  change?: FileChange;
  /** A text file shows (⌘F). */
  text: boolean;
  showIgnored: boolean;
  sidebarHidden: boolean;
  /** Open tabs, and whether a closed one can come back (⇧⌘T). */
  tabs: number;
  reopenable: boolean;
  /** The workspace's Changes show in the tabs' place, and how many files are changed. */
  changes: boolean;
  changed: number;
  changesMode: ChangesMode;
  /** The Changes' diff: split or unified, its file list shown. */
  layout: DiffLayout;
  listShown: boolean;
};

const PANELS = { sidebar: 280, sidebarMin: 180, mainMin: 420 };
/** Asked again while shown: the tree and the open file every so often (agents keep writing). */
const POLL_MS = 15_000;
/** Where a tab's scroll is saved, once it settles. */
const SCROLL_SAVE_MS = 300;

const readKeptOf = (ws: FilesWorkspace): Kept => readKept(readStore<unknown>("files:workspaces", {}), ws);
const writeKeptOf = (ws: FilesWorkspace, kept: Kept) => writeStore("files:workspaces", writeKept(readStore<unknown>("files:workspaces", {}), ws, kept));
const NO_KEPT: Kept = { open: [], recent: [], tabs: NO_TABS };

const CHANGE_LABEL: Record<FileChange, string> = { added: "Added", deleted: "Deleted", modified: "Modified", renamed: "Renamed" };

/**
 * The Files page, in the map's place (the macOS app's mode bar): the selected
 * workspace's files, read only, through its host's daemon (so remote hosts'
 * too). The sidebar is the tree (directories read as they open; `.gitignore`d
 * files and `.git` hidden unless asked), its "Filter files…" fuzzy over every
 * path; the main column the open file, highlighted by @pierre/diffs (Shiki in
 * its workers, drawn only where in view), with ⌘F to find in it, Copy path
 * and, when it's changed, Show changes. Changes, first in the tabs' row, shows
 * the workspace's branch against main in their place (`ChangesView`, no GitHub
 * needed), a changed file's dot in the tree opening it there, each of its files
 * opening back here. ⌘P opens any file by name. As the other pages', the
 * sidebar's inner edge resizes it and ⌘S hides it.
 */
export function FilesView({
  workspace,
  onNotice,
  onViewState,
  onOpenPr,
  onExternal,
}: {
  workspace?: FilesWorkspaceInfo;
  onNotice: (message: string) => void;
  onViewState?: (state: FilesViewState | undefined) => void;
  /** The Changes' Review #N (its PR in the GitHub tab) and Compare on GitHub: absent while GitHub is off. */
  onOpenPr?: (repo: string, number: number) => void;
  onExternal?: (url: string) => void;
}) {
  useFilesVersion();
  const wsKey = workspace ? keyOf(workspace) : "";
  const [kept, setKeptState] = useState<Kept>(() => (workspace ? readKeptOf(workspace) : NO_KEPT));
  // Another workspace: its own folders and file.
  const shownKey = useRef(wsKey);
  if (shownKey.current !== wsKey) {
    shownKey.current = wsKey;
    setKeptState(workspace ? readKeptOf(workspace) : NO_KEPT);
  }
  const setKept = useCallback(
    (change: (k: Kept) => Kept) =>
      setKeptState((k) => {
        const next = change(k);
        if (workspace && next !== k) writeKeptOf(workspace, next);
        return next;
      }),
    [wsKey],
  );
  const open = useMemo(() => new Set(kept.open), [kept.open]);
  const file = kept.tabs.active;
  const [showIgnored, setShowIgnoredState] = useState(() => readStore<boolean>("files:showIgnored", false) === true);
  const setShowIgnored = (on: boolean) => {
    setShowIgnoredState(on);
    writeStore("files:showIgnored", on);
  };

  // ── Reads ──
  const listingOf = (dir: string): Listing => {
    if (!workspace) return undefined;
    const e = peek(treePath(workspace, dir));
    if (e?.data) return (e.data as FileTree).entries;
    return e?.error ? { error: e.error } : undefined;
  };
  const rootEntry = workspace ? peek(treePath(workspace, "")) : undefined;
  const all = workspace ? (peek(allPath(workspace))?.data as FileList | undefined) : undefined;
  const changedData = workspace ? peek(changedPath(workspace))?.data : undefined;
  const changes = useMemo(() => {
    const m = new Map<string, FileChange>();
    const files = (changedData as FileChanges | undefined)?.files;
    if (Array.isArray(files)) for (const f of files) m.set(f.path, f.change);
    return m;
  }, [changedData]);
  // The changed files' folders, marked in the tree too.
  const changedDirs = useMemo(() => new Set([...changes.keys()].flatMap(parentsOf)), [changes]);

  // ── The filter ──
  const filterInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState("");
  const [asked, setAsked] = useState("");
  useEffect(() => {
    if (!filter.trim()) return setAsked("");
    const t = setTimeout(() => setAsked(filter.trim()), 60);
    return () => clearTimeout(t);
  }, [filter]);
  const filtered = useMemo(() => (asked && all ? filterRows(all.files, asked) : null), [asked, all]);
  const rows: TreeRow[] = filter.trim() ? (filtered?.rows ?? []) : treeRows(listingOf, open, showIgnored);

  // Each open folder shown, and the root, read (again once old); the list for the filter and ⌘P soon after.
  const needed = filter.trim() ? [] : ["", ...rows.filter((r) => r.open).map((r) => r.path)];
  const neededKey = needed.join("\0");
  useEffect(() => {
    if (!workspace) return;
    for (const dir of neededKey.split("\0")) ensure(treePath(workspace, dir), POLL_MS);
    ensure(changedPath(workspace), POLL_MS);
  }, [wsKey, neededKey, rootEntry?.at]);
  useEffect(() => {
    if (!workspace) return;
    const t = setTimeout(() => ensure(allPath(workspace), 30_000), filter ? 0 : 400);
    return () => clearTimeout(t);
  }, [wsKey, !!filter]);
  // While shown: the folders in view and the changed files asked again every so often.
  const neededNow = useRef(needed);
  neededNow.current = needed;
  useEffect(() => {
    if (!workspace) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      for (const dir of neededNow.current) void load(treePath(workspace, dir), true);
      void load(changedPath(workspace), true);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [wsKey]);

  // ── The tree's cursor and keys ──
  const [cursor, setCursor] = useState<string | undefined>(file);
  const [picked, setPicked] = useState<string | undefined>();
  useEffect(() => setPicked(filtered?.best), [filtered]);
  const treeRef = useRef<HTMLDivElement>(null);
  const reveal = (path: string) =>
    requestAnimationFrame(() => document.getElementById(rowId(path))?.scrollIntoView({ block: "nearest" }));

  const toggle = (dir: string, to?: boolean) =>
    setKept((k) => {
      const isOpen = k.open.includes(dir);
      const want = to ?? !isOpen;
      if (want === isOpen) return k;
      return { ...k, open: want ? [...k.open, dir] : k.open.filter((p) => p !== dir && !p.startsWith(`${dir}/`)) };
    });
  /** Opens a file in a tab: a preview (a single click), or kept (`pin`: a double-click). */
  const openFile = useCallback(
    (path: string, pin = false) => {
      setKept((k) => {
        const parents = parentsOf(path).filter((p) => !k.open.includes(p));
        const { changes: _, ...rest } = k;
        return {
          ...rest,
          tabs: openTab(k.tabs, path, pin),
          open: [...k.open, ...parents],
          recent: [path, ...k.recent.filter((p) => p !== path)].slice(0, RECENT),
        };
      });
      setCursor(path);
      reveal(path);
    },
    [setKept],
  );
  // ── Tabs ──
  const setTabs = useCallback((change: (t: TabsState) => TabsState) => setKept((k) => {
    const tabs = change(k.tabs);
    return tabs === k.tabs ? k : { ...k, tabs };
  }), [setKept]);
  // ── Changes, in the tabs' place (kept per workspace) ──
  const showingChanges = !!kept.changes;
  const setChangesShown = useCallback(
    (on: boolean) =>
      setKept((k) => {
        if (!!k.changes === on) return k;
        const { changes: _, ...rest } = k;
        return on ? { ...rest, changes: true } : rest;
      }),
    [setKept],
  );
  const showTab = useCallback((path: string) => {
    setChangesShown(false);
    setTabs((t) => (t.tabs.some((x) => x.path === path) ? { ...t, active: path } : t));
    setCursor(path);
    reveal(path);
  }, [setTabs, setChangesShown]);
  // ⌘W closes the shown file's tab; Changes, never closed, stays.
  const closeActive = useCallback(() => {
    if (!showingChanges) setTabs((t) => (t.active ? closeTab(t, t.active) : t));
  }, [setTabs, showingChanges]);
  const reopen = useCallback(() => {
    setChangesShown(false);
    setTabs(reopenTab);
  }, [setTabs, setChangesShown]);
  // From Changes, stepping goes back to the shown tab.
  const step = useCallback((by: 1 | -1) => {
    if (showingChanges) setChangesShown(false);
    else setTabs((t) => stepTab(t, by));
  }, [setTabs, setChangesShown, showingChanges]);
  const closeOthers = useCallback(() => setTabs((t) => (t.active ? closeOtherTabs(t, t.active) : t)), [setTabs]);
  const [changesMode, setChangesModeState] = useState<ChangesMode>(() => {
    const kept = readStore<string>("github:changesMode", "all") as ChangesMode;
    return CHANGES_MODES.includes(kept) ? kept : "all";
  });
  const setChangesMode = useCallback((m: ChangesMode) => {
    setChangesModeState(m);
    writeStore("github:changesMode", m);
  }, []);
  // The diff's layout and file list, one setting with the GitHub tab's.
  const [layout, setLayoutState] = useState<DiffLayout>(() => (readStore<string>("github:layout", "unified") === "split" ? "split" : "unified"));
  const setLayout = useCallback((l: DiffLayout) => {
    setLayoutState(l);
    writeStore("github:layout", l);
  }, []);
  const [listShown, setListShownState] = useState(() => readStore<boolean>("github:fileList", true) !== false);
  const setListShown = useCallback((shown: boolean) => {
    setListShownState(shown);
    writeStore("github:fileList", shown);
  }, []);
  const diffHandle = useRef<DiffViewHandle | null>(null);
  // A file to scroll the Changes to once they show (a changed file's dot, Show changes, ⌘K).
  const [changesAt, setChangesAt] = useState<string | undefined>();
  const showChanges = useCallback(
    (path?: string) => {
      setChangesShown(true);
      if (path) {
        // All changes, so the file is there.
        setChangesMode("all");
        setChangesAt(path);
      }
    },
    [setChangesShown, setChangesMode],
  );
  // Asked from elsewhere (⇧⌘G, a workspace's Changes, pending comments, an old GitHub place) before the page showed.
  useEffect(() => {
    const ask = takeChangesAsk();
    if (ask) showChanges(ask.path);
  }, []);
  const filterDiffFiles = () => {
    if (diffHandle.current?.filterFiles()) return;
    setListShown(true);
    requestAnimationFrame(() => diffHandle.current?.filterFiles());
  };
  const cycleMode = () => setChangesMode(CHANGES_MODES[(CHANGES_MODES.indexOf(changesMode) + 1) % CHANGES_MODES.length]!);
  // The shown tab's folders open and its row in view, as it changes.
  const shownTab = useRef(file);
  useEffect(() => {
    if (!file || shownTab.current === file) return;
    shownTab.current = file;
    setCursor(file);
    setKept((k) => {
      const parents = parentsOf(file).filter((p) => !k.open.includes(p));
      return parents.length ? { ...k, open: [...k.open, ...parents] } : k;
    });
    reveal(file);
  }, [file]);

  const onTreeKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const at = rows.findIndex((r) => r.path === cursor);
    const row = rows[at];
    const move = (i: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (!next) return;
      setCursor(next.path);
      reveal(next.path);
      if (next.kind === "file" && workspace) prefetch(readPath(workspace, next.path));
    };
    let handled = true;
    if (e.key === "ArrowDown" || e.key === "j") move(at + 1);
    else if (e.key === "ArrowUp" || e.key === "k") move(at < 0 ? 0 : at - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(rows.length - 1);
    else if (e.key === "ArrowRight" && row?.kind === "directory") {
      if (!row.open) toggle(row.path, true);
      else move(at + 1);
    } else if (e.key === "ArrowLeft" && row) {
      if (row.kind === "directory" && row.open && !filter.trim()) toggle(row.path, false);
      else {
        const parent = parentsOf(row.path).pop();
        if (parent) move(rows.findIndex((r) => r.path === parent));
      }
    } else if ((e.key === "Enter" || e.key === " ") && row) {
      if (row.kind === "file") openFile(row.path);
      else if (!filter.trim()) toggle(row.path);
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  const onFilterKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const files = rows.filter((r) => r.kind === "file");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      if (!files.length) return;
      const at = files.findIndex((f) => f.path === picked);
      const next = at < 0 ? 0 : (at + (e.key === "ArrowDown" ? 1 : -1) + files.length) % files.length;
      setPicked(files[next]!.path);
      reveal(files[next]!.path);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const path = picked ?? files[0]?.path;
      if (path) openFile(path);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (filter) setFilter("");
      else filterInput.current?.blur();
    }
  };
  const focusFilter = useCallback(() => {
    setSidebarHidden(false);
    requestAnimationFrame(() => {
      filterInput.current?.focus();
      filterInput.current?.select();
    });
  }, []);

  // ── The sidebar's width and ⌘S ──
  const [view, setView] = useState<HTMLElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    if (!view) return;
    const watch = new ResizeObserver(() => setViewWidth(view.clientWidth));
    watch.observe(view);
    return () => watch.disconnect();
  }, [view]);
  const [sidebarWidth, setSidebarWidth] = useState(() => readStore<number>("files:sidebarWidth", PANELS.sidebar));
  const sidebarMax = Math.max(PANELS.sidebarMin, (viewWidth || 1600) - PANELS.mainMin);
  const sidebarW = Math.round(Math.min(sidebarMax, Math.max(PANELS.sidebarMin, sidebarWidth)));
  const [sidebarHidden, setSidebarHiddenState] = useState(() => readStore<boolean>("files:sidebarHidden", false) === true);
  const setSidebarHidden = (hidden: boolean) => {
    setSidebarHiddenState(hidden);
    writeStore("files:sidebarHidden", hidden);
  };
  const toggleSidebar = useCallback(() => setSidebarHiddenState((h) => (writeStore("files:sidebarHidden", !h), !h)), []);
  // Hidden, the sidebar leaves a button to show it: first in the tab row, else
  // (no workspace, so no row) over the page's corner, as the GitHub tab's.
  const showSidebarButton = (className: string) => (
    <button className={`icon-btn ${className}`} aria-label="Show the Files sidebar" data-tip="Show the sidebar (⌘S)" onClick={toggleSidebar}>
      <PanelLeftOpen size={14} aria-hidden="true" />
    </button>
  );
  const resizeSidebar = (w: number | null) => {
    const next = w === null ? PANELS.sidebar : Math.round(Math.min(sidebarMax, Math.max(PANELS.sidebarMin, w)));
    setSidebarWidth(next);
    writeStore("files:sidebarWidth", next);
  };

  // ── Quick-open (⌘P) ──
  const [quick, setQuick] = useState(false);
  const viewer = useRef<{ find: () => void } | null>(null);
  // ⌘S, ⌘P, and (in the viewer) ⌘F: while Files shows, the page has them, and they go no further. The tabs':
  // ⌘W closes the shown one (in the macOS app its menu takes ⌘W ahead of the window's Close and sends
  // `files-close-tab`; a browser keeps ⌘W, so ⌃W too), ⇧⌘T reopens, ⌃Tab / ⌃⇧Tab and ⌥⌘→ / ⌥⌘← step.
  const tabKeys = useRef({ closeActive, reopen, step });
  tabKeys.current = { closeActive, reopen, step };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (modalOpen()) return;
      const k = e.key.toLowerCase();
      const t = tabKeys.current;
      const cmd = e.metaKey && !e.ctrlKey;
      if (cmd && !e.altKey && !e.shiftKey && k === "s") toggleSidebar();
      else if (cmd && !e.altKey && !e.shiftKey && k === "p") setQuick(true);
      else if (cmd && !e.altKey && !e.shiftKey && k === "w" && !macApp()) t.closeActive();
      else if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && k === "w" && !isTyping(e.target as HTMLElement)) t.closeActive();
      else if (cmd && !e.altKey && e.shiftKey && k === "t") t.reopen();
      else if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === "Tab") t.step(e.shiftKey ? -1 : 1);
      else if (cmd && e.altKey && !e.shiftKey && (e.key === "ArrowRight" || e.key === "ArrowLeft")) t.step(e.key === "ArrowRight" ? 1 : -1);
      else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [toggleSidebar]);

  const refresh = () => {
    if (!workspace) return;
    reload(treePath(workspace, ""), readPath(workspace, ""), allPath(workspace), changedPath(workspace));
    if (showingChanges) invalidate("changes?");
  };
  const copyPath = (path: string) =>
    void copyText(path).then(
      () => onNotice(`Copied ${path}`),
      () => onNotice("Couldn’t copy the path"),
    );

  // ⌘K's commands.
  const current = useRef({ file, openFile, focusFilter, toggleSidebar, setShowIgnored, showIgnored, refresh, copyPath, showChanges, closeActive, reopen, step, closeOthers, showingChanges, layout, listShown, filterDiffFiles, cycleMode });
  current.current = { file, openFile, focusFilter, toggleSidebar, setShowIgnored, showIgnored, refresh, copyPath, showChanges, closeActive, reopen, step, closeOthers, showingChanges, layout, listShown, filterDiffFiles, cycleMode };
  useEffect(() => {
    const c = () => current.current;
    const offs = [
      onAppCommand("files-quick-open", () => setQuick(true)),
      onAppCommand("files-filter", () => c().focusFilter()),
      onAppCommand("files-sidebar", () => c().toggleSidebar()),
      onAppCommand("files-ignored", () => c().setShowIgnored(!c().showIgnored)),
      onAppCommand("files-refresh", () => c().refresh()),
      onAppCommand("files-find", () => viewer.current?.find()),
      onAppCommand("files-copy-path", () => {
        const f = c().file;
        if (f) c().copyPath(f);
      }),
      onAppCommand("files-show-changes", () => {
        const f = c().file;
        if (f) c().showChanges(f);
      }),
      onAppCommand("files-changes", (arg) => {
        const ask = checkChangesAsk(arg) ?? {};
        // Asked of the page as it shows: taken here, not again as it mounts.
        takeChangesAsk();
        c().showChanges(ask.path);
      }),
      onAppCommand("files-changes-mode", (arg) => {
        if (CHANGES_MODES.includes(arg as ChangesMode)) setChangesMode(arg as ChangesMode);
        else c().cycleMode();
      }),
      onAppCommand("files-diff-layout", () => setLayout(c().layout === "split" ? "unified" : "split")),
      onAppCommand("files-diff-list", () => setListShown(!c().listShown)),
      onAppCommand("files-diff-filter", () => {
        if (c().showingChanges) c().filterDiffFiles();
      }),
      onAppCommand("files-diff-find", () => {
        if (c().showingChanges) diffHandle.current?.find();
      }),
      onAppCommand("files-diff-next", () => diffHandle.current?.step(1)),
      onAppCommand("files-diff-prev", () => diffHandle.current?.step(-1)),
      onAppCommand("files-open", (arg) => {
        if (typeof arg === "string" && arg) c().openFile(arg, true);
      }),
      onAppCommand("files-close-tab", () => c().closeActive()),
      onAppCommand("files-reopen-tab", () => c().reopen()),
      onAppCommand("files-next-tab", () => c().step(1)),
      onAppCommand("files-previous-tab", () => c().step(-1)),
      onAppCommand("files-close-other-tabs", () => c().closeOthers()),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const read = workspace && file ? peek(readPath(workspace, file)) : undefined;
  const text = !!read?.data && "text" in (read.data as FileRead);
  const change = file ? changes.get(file) : undefined;
  const tabCount = kept.tabs.tabs.length;
  const reopenable = kept.tabs.closed.some((p) => !kept.tabs.tabs.some((t) => t.path === p));
  useEffect(() => {
    onViewState?.({
      ...(workspace ? { workspace: workspace.name } : {}),
      ...(file ? { file } : {}),
      ...(change ? { change } : {}),
      text,
      showIgnored,
      sidebarHidden,
      tabs: tabCount,
      reopenable,
      changes: showingChanges,
      changed: changes.size,
      changesMode,
      layout,
      listShown,
    });
  }, [workspace?.name, file, change, text, showIgnored, sidebarHidden, tabCount, reopenable, showingChanges, changes.size, changesMode, layout, listShown, onViewState]);
  const activeTab = kept.tabs.tabs.find((t) => t.path === file);
  // A tab's scroll, kept once it settles; using the file (scrolling, clicking, keys, find) keeps a preview tab.
  const onScrolled = useCallback((path: string, top: number) => setTabs((t) => scrollTab(t, path, top)), [setTabs]);
  const onUse = useCallback((path: string) => setTabs((t) => pinTab(t, path)), [setTabs]);
  useEffect(() => () => onViewState?.(undefined), [onViewState]);

  // Keys in the view (not typing): T filters (the Changes' files while they show), Esc stands here (the page's
  // own would clear the hidden map's selection). In Changes, as the GitHub tab's diff: J/K, U, F and M.
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!e.key || modalOpen() || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(target)) return;
    const lower = e.key.toLowerCase();
    const onButton = !!target.closest("button,a,[role=button],input,label");
    const inTree = !!target.closest(".fv-sidebar");
    let handled = true;
    if (showingChanges && !inTree && (lower === "j" || e.key === "ArrowDown") && !onButton) diffHandle.current?.step(1);
    else if (showingChanges && !inTree && (lower === "k" || e.key === "ArrowUp") && !onButton) diffHandle.current?.step(-1);
    else if (showingChanges && lower === "u") setLayout(layout === "split" ? "unified" : "split");
    else if (showingChanges && lower === "f") setListShown(!listShown);
    else if (showingChanges && lower === "m") cycleMode();
    else if (showingChanges && lower === "t" && !inTree) filterDiffFiles();
    else if (lower === "t") focusFilter();
    else if (e.key !== "Escape") handled = false;
    if (handled) e.preventDefault();
    if (/^[a-z]$/i.test(e.key) || e.key.startsWith("Arrow") || e.key === "Escape") e.stopPropagation();
  };

  const rootError = rootEntry?.error && !rootEntry.data ? rootEntry.error : undefined;
  const count = filtered?.count ?? 0;
  return (
    <DiffWorkers>
      <section
        className={`files-view${sidebarHidden ? " sidebar-hidden" : ""}`}
        aria-label="Files"
        ref={setView}
        style={{ gridTemplateColumns: sidebarHidden ? "minmax(0, 1fr)" : `${sidebarW}px minmax(0, 1fr)` }}
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <nav className="gh-sidebar fv-sidebar" id="files-sidebar" aria-label="Files of the workspace" hidden={sidebarHidden}>
          <div className="gh-sidebar-head">
            <h2>Files</h2>
            <button
              className={`icon-btn${showIgnored ? " on" : ""}`}
              aria-pressed={showIgnored}
              aria-label={showIgnored ? "Hide ignored files" : "Show ignored files"}
              data-tip={showIgnored ? "Hide ignored files and .git" : "Show ignored files and .git"}
              onClick={() => setShowIgnored(!showIgnored)}
            >
              {showIgnored ? <Eye size={13} aria-hidden="true" /> : <EyeOff size={13} aria-hidden="true" />}
            </button>
            <button className="icon-btn" aria-label="Open a file by name" data-tip="Open a file by name (⌘P)" disabled={!workspace} onClick={() => setQuick(true)}>
              <Search size={13} aria-hidden="true" />
            </button>
            <button className="icon-btn" aria-label="Refresh the files" data-tip="Refresh" disabled={!workspace} onClick={refresh}>
              <RefreshCw size={13} aria-hidden="true" className={rootEntry?.loading ? "spinning" : undefined} />
            </button>
          </div>
          {workspace && (
            <p className="fv-workspace" title={workspace.name}>
              <FolderTree size={12} aria-hidden="true" />
              <span>{workspace.name}</span>
            </p>
          )}
          {workspace && (
            <label className="gh-repo-search-field fv-filter">
              <Search size={13} aria-hidden="true" />
              <input
                {...plainText}
                ref={filterInput}
                type="search"
                value={filter}
                spellCheck={false}
                aria-label="Filter files"
                placeholder="Filter files…"
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={onFilterKey}
              />
              {filter && (
                <button className="icon-btn" aria-label="Clear the filter" data-tip="Clear (Esc)" onClick={() => (setFilter(""), filterInput.current?.focus())}>
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </label>
          )}
          {filter.trim() && (
            <p className="gd-list-head fv-count" role="status">
              {!all ? "Listing files…" : `${count.toLocaleString()} of ${all.files.length.toLocaleString()}${all.capped ? "+" : ""}`}
            </p>
          )}
          <div
            ref={treeRef}
            className="fv-tree"
            role="tree"
            aria-label="Files"
            tabIndex={0}
            aria-activedescendant={cursor && rows.some((r) => r.path === cursor) ? rowId(cursor) : undefined}
            onKeyDown={onTreeKey}
            onFocus={() => {
              if (!cursor || !rows.some((r) => r.path === cursor)) setCursor(rows[0]?.path);
            }}
          >
            {!workspace ? null : rootError ? (
              <p className="gd-list-none">{rootError}</p>
            ) : !rootEntry?.data && !filter.trim() ? (
              <p className="gd-list-none">Reading the files…</p>
            ) : filter.trim() && all && !count ? (
              <p className="gd-list-none">No file matches “{filter.trim()}”.</p>
            ) : (
              rows.map((r) => (
                <TreeItem
                  key={r.path}
                  row={r}
                  current={r.path === file}
                  cursor={r.path === cursor}
                  picked={!!filter.trim() && r.path === picked}
                  changed={r.kind === "file" ? changes.get(r.path) : changedDirs.has(r.path) ? "modified" : undefined}
                  onShowChanges={() => showChanges(r.path)}
                  onClick={() => {
                    setCursor(r.path);
                    if (r.kind === "file") openFile(r.path);
                    else if (!filter.trim()) toggle(r.path);
                  }}
                  onDoubleClick={() => r.kind === "file" && openFile(r.path, true)}
                  onHover={() => r.kind === "file" && workspace && prefetch(readPath(workspace, r.path))}
                />
              ))
            )}
          </div>
          <ResizeEdge
            label="Resize the Files sidebar"
            controls="files-sidebar"
            value={sidebarW}
            min={PANELS.sidebarMin}
            max={sidebarMax}
            grows="right"
            onResize={resizeSidebar}
            onReset={() => resizeSidebar(null)}
          />
        </nav>
        {sidebarHidden && !workspace && showSidebarButton("gh-show-sidebar")}
        <div className="gh-main">
          {!workspace ? (
            <Empty icon={<FolderTree size={26} strokeWidth={1.5} aria-hidden="true" />} title="No workspace selected">
              Select a workspace (or one of its agents) on the map or in the panel to see its files.
            </Empty>
          ) : (
            <>
          <div className="fv-tabbar">
            {sidebarHidden && showSidebarButton("fv-show-sidebar")}
            <button
              className={`fv-changes-btn${showingChanges ? " active" : ""}`}
              aria-pressed={showingChanges}
              data-tip={showingChanges ? (file ? "Back to the file" : "The branch against main") : "The branch against main (⇧⌘G)"}
              onClick={() => (showingChanges ? file && setChangesShown(false) : showChanges())}
            >
              <GitBranch size={12} aria-hidden="true" />
              <span>Changes</span>
              {changes.size > 0 && (
                <span className="fv-changes-count" aria-label={`${changes.size} changed ${changes.size === 1 ? "file" : "files"}`}>
                  {changes.size}
                </span>
              )}
            </button>
            {kept.tabs.tabs.length > 0 && (
              <FileTabs
                tabs={kept.tabs.tabs}
                active={showingChanges ? undefined : file}
                changes={changes}
                onShow={showTab}
                onClose={(path) => setTabs((t) => closeTab(t, path))}
                onPin={(path) => setTabs((t) => pinTab(t, path))}
                onMove={(path, to) => setTabs((t) => moveTab(t, path, to))}
              />
            )}
          </div>
          {showingChanges ? (
            <ChangesView
              key={wsKey}
              workspace={workspace}
              mode={changesMode}
              setMode={setChangesMode}
              layout={layout}
              setLayout={setLayout}
              listShown={listShown}
              setListShown={setListShown}
              {...(onOpenPr ? { onOpenPr } : {})}
              {...(onExternal ? { onExternal } : {})}
              onOpenFile={(path) => openFile(path, true)}
              handle={diffHandle}
              onNotice={onNotice}
              showPath={changesAt}
              onShown={() => setChangesAt(undefined)}
            />
          ) : !file ? (
            <div className="gh-main-inner">
              <Empty icon={<FileCode2 size={26} strokeWidth={1.5} aria-hidden="true" />} title={workspace.name}>
                Choose a file in the tree, or press ⌘P to open one by name. Changes shows the branch against main.
              </Empty>
            </div>
          ) : (
            <FileViewer
              key={`${wsKey}|${file}`}
              workspace={workspace}
              path={file}
              change={change}
              onShowChanges={showChanges}
              onCopyPath={copyPath}
              handle={viewer}
              scroll={activeTab?.scroll}
              onScrolled={onScrolled}
              onUse={activeTab?.preview ? onUse : undefined}
            />
          )}
            </>
          )}
        </div>
        {quick && workspace && (
          <QuickOpen
            files={all}
            recent={kept.recent ?? []}
            onClose={() => setQuick(false)}
            onOpen={(path) => {
              setQuick(false);
              setFilter("");
              openFile(path);
            }}
            onHover={(path) => prefetch(readPath(workspace, path))}
          />
        )}
      </section>
    </DiffWorkers>
  );
}

const rowId = (path: string) => `fv-row-${path}`;

function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="gh-empty">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}

/**
 * The open files' tabs above the viewer, as an editor's: the shown one marked, a
 * preview's name in italics, the name with as much of its folder as tells clashing
 * names apart, a changed dot and ×. A click shows one, a double-click keeps a
 * preview, a middle-click closes; they reorder by drag; the row scrolls sideways
 * (a mouse wheel too) and keeps the shown tab in view.
 */
function FileTabs({
  tabs,
  active,
  changes,
  onShow,
  onClose,
  onPin,
  onMove,
}: {
  tabs: FileTab[];
  active?: string;
  changes: Map<string, FileChange>;
  onShow: (path: string) => void;
  onClose: (path: string) => void;
  onPin: (path: string) => void;
  onMove: (path: string, to: number) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const labels = useMemo(() => tabLabels(tabs.map((t) => t.path)), [tabs]);
  const [dragging, setDragging] = useState<string | undefined>();
  /** Where a dragged tab would go: before the tab at this index (the length: at the end). */
  const [dropAt, setDropAt] = useState<number | undefined>();
  useLayoutEffect(() => {
    strip.current?.querySelector<HTMLElement>(".fv-tab.active")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, tabs.length]);
  const endDrag = () => {
    setDragging(undefined);
    setDropAt(undefined);
  };
  const drop = () => {
    const from = tabs.findIndex((t) => t.path === dragging);
    if (dragging && from >= 0 && dropAt !== undefined) onMove(dragging, dropAt > from ? dropAt - 1 : dropAt);
    endDrag();
  };
  return (
    <div
      ref={strip}
      className="fv-tabs"
      role="tablist"
      aria-label="Open files"
      onWheel={(e) => {
        if (!e.deltaX && e.deltaY && strip.current) strip.current.scrollLeft += e.deltaY;
      }}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        // Past the last tab: the end.
        if (e.target === strip.current) setDropAt(tabs.length);
      }}
      onDrop={(e) => {
        if (!dragging) return;
        e.preventDefault();
        drop();
      }}
    >
      {tabs.map((t, i) => {
        const label = labels.get(t.path) ?? { name: t.path };
        const changed = changes.get(t.path);
        const shown = t.path === active;
        return (
          <div
            key={t.path}
            role="tab"
            aria-selected={shown}
            tabIndex={shown ? 0 : -1}
            title={t.preview ? `${t.path} (preview: double-click to keep it open)` : t.path}
            className={`fv-tab${shown ? " active" : ""}${t.preview ? " preview" : ""}${t.path === dragging ? " dragging" : ""}${dropAt === i ? " drop-before" : ""}${dropAt === tabs.length && i === tabs.length - 1 ? " drop-after" : ""}`}
            data-path={t.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/x-paseo-file-tab", t.path);
              setDragging(t.path);
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = "move";
              const r = e.currentTarget.getBoundingClientRect();
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
            }}
            onDragEnd={endDrag}
            onMouseDown={(e) => {
              // No autoscroll on a middle-click.
              if (e.button === 1) e.preventDefault();
            }}
            onAuxClick={(e) => {
              if (e.button !== 1) return;
              e.preventDefault();
              onClose(t.path);
            }}
            onClick={() => onShow(t.path)}
            onDoubleClick={() => onPin(t.path)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onShow(t.path);
              }
            }}
          >
            <FileText size={12} aria-hidden="true" className="fv-tab-icon" />
            <span className="fv-tab-name">{label.name}</span>
            {label.dir && <span className="fv-tab-dir">{label.dir}</span>}
            {changed && <span className={`fv-changed ${changed}`} aria-label={CHANGE_LABEL[changed]} />}
            <button
              className="fv-tab-close"
              tabIndex={-1}
              aria-label={`Close ${label.name}`}
              data-tip={shown ? (macApp() ? "Close (⌘W)" : "Close (⌃W)") : "Close"}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.path);
              }}
            >
              <X size={11} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TreeItem({
  row,
  current,
  cursor,
  picked,
  changed,
  onClick,
  onDoubleClick,
  onHover,
  onShowChanges,
}: {
  row: TreeRow;
  current: boolean;
  cursor: boolean;
  picked: boolean;
  changed?: FileChange;
  onClick: () => void;
  onDoubleClick: () => void;
  onHover: () => void;
  /** A changed file's dot: its changes, in Changes. */
  onShowChanges: () => void;
}) {
  const marks = useMemo(() => new Set(row.marks ?? []), [row.marks]);
  const Icon = row.kind === "directory" ? (row.open ? FolderOpen : Folder) : FileText;
  return (
    <div
      id={rowId(row.path)}
      role="treeitem"
      aria-level={row.depth + 1}
      aria-selected={current}
      aria-expanded={row.kind === "directory" ? !!row.open : undefined}
      className={`fv-row${current ? " current" : ""}${cursor ? " cursor" : ""}${picked ? " picked" : ""}${row.ignored ? " ignored" : ""}`}
      style={{ paddingLeft: `calc(var(--space-2) + ${row.depth} * 12px * var(--lz))` }}
      title={row.path}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        (e.currentTarget.closest("[role=tree]") as HTMLElement | null)?.focus({ preventScroll: true });
        onClick();
      }}
      onDoubleClick={onDoubleClick}
      onMouseEnter={onHover}
    >
      {row.kind === "directory" ? (
        row.open ? (
          <ChevronDown size={12} aria-hidden="true" className="fv-chevron" />
        ) : (
          <ChevronRight size={12} aria-hidden="true" className="fv-chevron" />
        )
      ) : (
        <span className="fv-chevron" aria-hidden="true" />
      )}
      <Icon size={13} aria-hidden="true" className={`fv-icon ${row.kind}`} />
      <span className="fv-name">
        <Marked text={row.name} marks={marks} />
      </span>
      {row.loading && <span className="fv-note">…</span>}
      {row.error && <CircleAlert size={12} aria-label={row.error} className="fv-error" />}
      {changed && row.kind === "file" ? (
        <button
          className={`fv-changed fv-changed-btn ${changed}`}
          tabIndex={-1}
          aria-label={`${CHANGE_LABEL[changed]}: show its changes`}
          data-tip={`${CHANGE_LABEL[changed]}: show the changes`}
          onClick={(e) => {
            e.stopPropagation();
            onShowChanges();
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      ) : (
        changed && <span className={`fv-changed ${changed}`} aria-label="Has changes" data-tip="Has changes" />
      )}
    </div>
  );
}

/**
 * The open file: its head (its path, size and lines, Copy path, Show changes
 * when changed, Find, Refresh), then its lines drawn by @pierre/diffs's
 * `File` under its `Virtualizer`, so only the lines in view are drawn. Not
 * text, an image or past the limit: said so, politely.
 */
function FileViewer({
  workspace,
  path,
  change,
  onShowChanges,
  onCopyPath,
  handle,
  scroll,
  onScrolled,
  onUse,
}: {
  workspace: FilesWorkspace;
  path: string;
  change?: FileChange;
  onShowChanges: (path: string) => void;
  onCopyPath: (path: string) => void;
  handle: React.RefObject<{ find: () => void } | null>;
  /** Where the tab was scrolled to, restored once its lines are drawn. */
  scroll?: number;
  onScrolled: (path: string, top: number) => void;
  /** A preview tab: using the file keeps it. */
  onUse?: (path: string) => void;
}) {
  const titleTip = usePageTitleTip<HTMLHeadingElement>();
  const { resolved } = useTheme();
  const at = readPath(workspace, path);
  const entry = peek(at);
  useEffect(() => {
    ensure(at, 2_000);
    const timer = setInterval(() => {
      if (!document.hidden) ensure(at, POLL_MS);
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [at]);
  const data = entry?.data as FileRead | undefined;
  const text = data && "text" in data ? data.text : undefined;
  const slash = path.lastIndexOf("/");
  const dir = slash < 0 ? "" : path.slice(0, slash);
  const name = path.slice(slash + 1);
  const lines = useMemo(() => (text === undefined ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)), [text]);
  const contents = useMemo(() => (text === undefined ? undefined : { name: path, contents: text, cacheKey: `fv:${path}:${hashText(text)}` }), [path, text]);
  const options = useMemo(
    () => ({
      overflow: "scroll" as const,
      disableFileHeader: true,
      themeType: resolved === "light" ? ("light" as const) : ("dark" as const),
      theme: DIFF_THEMES,
      unsafeCSS: FIND_CSS,
      tokenizeMaxLength: 400_000,
    }),
    [resolved],
  );

  // Find in the file (⌘F), as the diff's.
  const wrap = useRef<HTMLDivElement>(null);
  const scrollerOf = () => wrap.current?.querySelector<HTMLElement>(":scope > .gd-scroll") ?? null;
  const findInput = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [findText, setFindText] = useState("");
  const [findOpts, setFindOpts] = useState<FindOptions>({ caseSensitive: false, regex: false });
  const [asked, setAsked] = useState("");
  useEffect(() => {
    if (!findText) return setAsked("");
    const t = setTimeout(() => setAsked(findText), 100);
    return () => clearTimeout(t);
  }, [findText]);
  const found = useMemo(() => (finding && asked && text !== undefined ? findInText(path, text, asked, findOpts) : null), [finding, asked, findOpts, text, path]);
  const byPath = useMemo(() => {
    if (!found?.matches.length) return null;
    const lines = new Map<string, FindMatch[]>();
    for (const m of found.matches) lines.set(m.key, [...(lines.get(m.key) ?? []), m]);
    return new Map([[path, lines]]);
  }, [found, path]);
  const [atMatch, setAtMatch] = useState(-1);
  const current = found && atMatch >= 0 ? found.matches[atMatch] : undefined;
  useFindPaint(scrollerOf, byPath, current);
  const order = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < lines + 1; i++) m.set(`R${i + 1}`, i);
    return m;
  }, [lines]);
  const revealing = useRef(0);
  const goTo = (i: number) => {
    const m = found?.matches[i];
    setAtMatch(m ? i : -1);
    if (!m) return;
    const token = ++revealing.current;
    requestAnimationFrame(() => {
      const scroller = scrollerOf();
      if (scroller) void revealMatch(scroller, m, order, () => revealing.current === token);
    });
  };
  const latest = useRef({ goTo, current, atMatch });
  latest.current = { goTo, current, atMatch };
  const lastAsk = useRef("");
  useEffect(() => {
    if (!found?.matches.length) {
      setAtMatch(-1);
      if (!found) lastAsk.current = "";
      return;
    }
    const ask = `${asked}\0${findOpts.caseSensitive}\0${findOpts.regex}`;
    const { goTo, current, atMatch } = latest.current;
    if (ask !== lastAsk.current) {
      lastAsk.current = ask;
      // From the line in view.
      const scroller = scrollerOf();
      const top = scroller ? firstLineInView(scroller) : 0;
      const first = found.matches.findIndex((m) => m.line >= top);
      goTo(first < 0 ? 0 : first);
    } else {
      const same = current ? found.matches.findIndex((m) => sameMatch(m, current)) : -1;
      setAtMatch(same >= 0 ? same : Math.min(Math.max(atMatch, 0), found.matches.length - 1));
    }
  }, [found]);
  const step = (by: 1 | -1) => {
    const n = found?.matches.length ?? 0;
    if (n) goTo(atMatch < 0 ? (by > 0 ? 0 : n - 1) : (atMatch + by + n) % n);
  };
  const used = useRef(onUse);
  used.current = onUse;
  const use = useCallback(() => used.current?.(path), [path]);
  const openFind = useCallback(() => {
    use();
    setFinding(true);
    requestAnimationFrame(() => {
      findInput.current?.focus();
      findInput.current?.select();
    });
  }, [use]);
  const closeFind = () => {
    revealing.current++;
    setFinding(false);
    clearFindMarks();
  };
  useLayoutEffect(() => {
    handle.current = { find: () => (text !== undefined ? openFind() : undefined) };
    return () => {
      handle.current = null;
    };
  }, [handle, openFind, text]);
  const hasText = text !== undefined;
  useEffect(() => {
    if (!hasText) return;
    const key = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== "f" || modalOpen()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      openFind();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [hasText, openFind]);

  // The tab's scroll: put back once its lines can reach it (the virtualizer sizes them first), then kept as it settles.
  const restoring = useRef(scroll && scroll > 0 ? scroll : 0);
  const hasContents = !!contents;
  useEffect(() => {
    if (!hasContents || !restoring.current) return;
    let frames = 0;
    let raf = 0;
    const put = () => {
      const scroller = scrollerOf();
      const want = restoring.current;
      if (!scroller || !want) return;
      scroller.scrollTop = want;
      if (Math.abs(scroller.scrollTop - want) <= 1 || ++frames > 60) restoring.current = 0;
      else raf = requestAnimationFrame(put);
    };
    raf = requestAnimationFrame(put);
    return () => cancelAnimationFrame(raf);
  }, [hasContents]);
  const saving = useRef<ReturnType<typeof setTimeout>>(undefined);
  const scrolled = useRef(onScrolled);
  scrolled.current = onScrolled;
  const onScroll = (e: React.UIEvent<HTMLElement>) => {
    const scroller = e.target as HTMLElement;
    if (restoring.current || !scroller.classList?.contains("gd-scroll")) return;
    pending.current = scroller.scrollTop;
    clearTimeout(saving.current);
    saving.current = setTimeout(flush, SCROLL_SAVE_MS);
  };
  const pending = useRef<number | undefined>(undefined);
  const flush = () => {
    if (pending.current !== undefined) scrolled.current(path, pending.current);
    pending.current = undefined;
  };
  // Leaving the tab (another shows): kept at once.
  useEffect(
    () => () => {
      clearTimeout(saving.current);
      flush();
    },
    [],
  );

  let body: ReactNode;
  if (data && "refused" in data) {
    const size = sizeLabel(data.size);
    body = (
      <Empty icon={<FileText size={26} strokeWidth={1.5} aria-hidden="true" />} title={name}>
        {data.refused === "large"
          ? `This file is ${size}, more than the ${sizeLabel(FILE_LIMITS.maxBytes)} the viewer opens.`
          : data.refused === "image"
            ? `An image (${size}). Images aren’t shown here.`
            : `A binary file (${size}). Only text files are shown.`}
      </Empty>
    );
  } else if (contents) {
    body = (
      <div
        className="gd-scroll-wrap fv-scroll-wrap"
        ref={wrap}
        onScrollCapture={onScroll}
        onWheel={use}
        onPointerDown={use}
        onKeyDown={use}
      >
        {finding && (
          <FindBar
            input={findInput}
            query={findText}
            options={findOpts}
            count={found?.matches.length ?? 0}
            at={atMatch}
            capped={!!found?.capped}
            error={found?.error}
            onQuery={setFindText}
            onOptions={setFindOpts}
            onStep={step}
            onClose={closeFind}
            label="Find in the file"
          />
        )}
        <Virtualizer className="gd-scroll fv-scroll">
          <section className="gd-file fv-file" data-path={path} aria-label={path}>
            <File className="gd-diff" file={contents} options={options} />
          </section>
        </Virtualizer>
      </div>
    );
  } else if (entry?.error) {
    body = (
      <Empty icon={<CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />} title="Couldn’t open this file">
        {entry.error}
      </Empty>
    );
  } else body = <p className="gh-note">Opening {name}…</p>;

  return (
    <div className="gh-main-inner">
      <header className="gh-head page-head fv-head">
        <h2 className="page-head-title" ref={titleTip}>
          <FileText size={15} aria-hidden="true" />
          {dir && <span className="page-crumb">{dir}/</span>}
          <span className="page-head-name">{name}</span>
        </h2>
        {data && (
          <span className="page-head-aside gh-hint fv-meta">
            {sizeLabel(data.size)}
            {text !== undefined && ` · ${lines.toLocaleString()} ${lines === 1 ? "line" : "lines"}`}
            {change && <span className={`fv-change-badge ${change}`}>{CHANGE_LABEL[change]}</span>}
          </span>
        )}
        <span className="gh-spacer" />
        {change && change !== "deleted" && (
          <button className="page-btn" data-tip="This file’s changes against main, in Changes" onClick={() => onShowChanges(path)}>
            <GitCompare size={13} aria-hidden="true" />
            <span className="page-tool-label">Show changes</span>
          </button>
        )}
        <button className="page-btn" data-tip="Copy the file’s path" onClick={() => onCopyPath(path)}>
          <Copy size={13} aria-hidden="true" />
          <span className="page-tool-label">Copy path</span>
        </button>
        {text !== undefined && (
          <button className="icon-btn" aria-label="Find in the file" data-tip="Find (⌘F)" onClick={openFind}>
            <Search size={13} aria-hidden="true" />
          </button>
        )}
        <button className="icon-btn" aria-label="Reload the file" data-tip="Reload" onClick={() => void load(at, true)}>
          <RefreshCw size={13} aria-hidden="true" className={entry?.loading ? "spinning" : undefined} />
        </button>
      </header>
      {body}
    </div>
  );
}

/** The first line drawn in view (0-based), for where a new find starts. */
function firstLineInView(scroller: HTMLElement): number {
  const top = scroller.getBoundingClientRect().top;
  const root = scroller.querySelector("diffs-container")?.shadowRoot;
  for (const el of root?.querySelectorAll<HTMLElement>("[data-line]") ?? []) {
    if (el.getBoundingClientRect().bottom > top) return Number(el.dataset.line) - 1;
  }
  return 0;
}

/** ⌘P: any file by name, fuzzy over every path (the recent ones first while nothing's typed). */
function QuickOpen({
  files,
  recent,
  onClose,
  onOpen,
  onHover,
}: {
  files?: FileList;
  recent: string[];
  onClose: () => void;
  onOpen: (path: string) => void;
  onHover: (path: string) => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useFocusTrap(dialog, input);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    if (!query.trim()) {
      const known = files ? new Set(files.files) : null;
      return recent.filter((p) => !known || known.has(p)).map((path) => ({ path, marks: [] as number[] }));
    }
    return files ? rankPaths(files.files, query, 60) : [];
  }, [files, query, recent]);
  const current = Math.min(active, results.length - 1);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, query]);
  useEffect(() => {
    const first = results[current];
    if (first) onHover(first.path);
  }, [results, current]);
  return (
    <div className="modal-backdrop palette-backdrop" onClick={onClose}>
      <section
        ref={dialog}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-label="Open a file"
        className="command-palette panel fv-quick"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation();
        }}
      >
        <label className="palette-search">
          <Search size={16} aria-hidden="true" />
          <input
            ref={input}
            role="combobox"
            aria-label="Find a file"
            aria-expanded="true"
            aria-controls="fv-quick-list"
            aria-autocomplete="list"
            aria-activedescendant={results.length ? `fv-quick-${current}` : undefined}
            placeholder="Go to file…"
            {...plainText}
            spellCheck={false}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (results.length) setActive((current + (e.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
              } else if (e.key === "Enter" && results[current]) {
                e.preventDefault();
                onOpen(results[current]!.path);
              }
            }}
          />
        </label>
        <ul ref={list} id="fv-quick-list" role="listbox" aria-label="Files" className="palette-list">
          {!query.trim() && results.length > 0 && (
            <li role="presentation" className="palette-heading section-label">
              Recently opened
            </li>
          )}
          {results.map((r, i) => {
            const start = r.path.lastIndexOf("/") + 1;
            const marks = new Set(r.marks);
            return (
              <li
                key={r.path}
                id={`fv-quick-${i}`}
                role="option"
                aria-selected={i === current}
                data-index={i}
                className="palette-row fv-quick-row"
                onMouseMove={i === current ? undefined : () => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onOpen(r.path)}
              >
                <span className="palette-label">
                  <Marked text={r.path.slice(start)} marks={marks} from={start} />
                  {start > 0 && (
                    <small>
                      <Marked text={r.path.slice(0, start - 1)} marks={marks} />
                    </small>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {!results.length && (
          <p className="palette-empty" role="status">
            {!files ? "Listing the workspace’s files…" : query.trim() ? `No file matches “${query.trim()}”.` : "Type to find a file."}
          </p>
        )}
        {files?.capped && query.trim() && <p className="fv-quick-note">Only the first {files.files.length.toLocaleString()} files are searched.</p>}
      </section>
    </div>
  );
}
