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
  SquareTerminal,
  WrapText,
  X,
} from "lucide-react";
import { File, Virtualizer } from "@pierre/diffs/react";
import { api, errorMessage, readStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { MODAL_EVENT, modalOpen, useFocusTrap } from "../focus";
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
import { checkChangesAsk, checkFileAsk, takeChangesAsk, takeFileAsk, type FileAsk } from "./open";
import { clearFindMarks, FIND_CSS, FindBar, revealMatch, useFindPaint } from "../github/DiffFind";
import { findInText, sameMatch, type FindMatch, type FindOptions } from "../github/diffSearch";
import { Marked } from "../github/DiffView";
import { useDiffAnchor } from "../github/diffAnchor";
import { DIFF_THEMES, DiffWorkers } from "../github/diffWorkers";
import { hashText } from "../github/rows";
import { allPath, changedPath, ensure, load, peek, prefetch, readPath, reload, treePath, useFilesVersion, type FilesWorkspace } from "./api";
import { filterRows, parentsOf, rankPaths, sizeLabel, treeRows, type Listing, type TreeRow } from "./tree";
import { editorExitedIn, keptKey as keyOf, readKept, RECENT, writeKept, type Kept } from "./kept";
import {
  closeOtherTabs,
  closeTab,
  moveTab,
  NO_TABS,
  openTab,
  pinTab,
  reopenTab,
  scrollTab,
  setTabEditor,
  setTabViewer,
  stepTab,
  tabEditorExited,
  tabEditors,
  tabLabels,
  type FileTab,
  type TabsState,
} from "./tabs";
import { closeEditors, focusEditor, forgetEditors, hideEditor, onEditorEvent, postEditorPlacement } from "./editorBridge";
import { useFilesSettings } from "./filesSettings";
import { markdownType, MARKDOWN_TYPES, type MarkdownType } from "./markdown";
import { MarkdownPreview, type PreviewHandle, type WorkspaceLink } from "./MarkdownPreview";
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
  /** A Markdown file shows, rendered or as its source. */
  markdown?: MarkdownView;
  /** Long lines wrap (the source and every other file; a preview's code blocks). */
  wrap: boolean;
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
  /** The shown tab in the user's editor (the macOS app): it shows, the viewer shows over it, or none runs; whether it can. */
  editor: "shown" | "viewer" | "none";
  canEditor: boolean;
};

const PANELS = { sidebar: 280, sidebarMin: 180, mainMin: 420 };
/** How a Markdown file shows: rendered (the default) or as its source. */
export type MarkdownView = "preview" | "source";
/** The view chosen per Markdown type (`md`, `markdown`, `mdx`), only where it isn't the preview. */
const readMarkdownViews = (): Partial<Record<MarkdownType, MarkdownView>> => {
  const kept = readStore<unknown>("files:markdownView", {});
  const out: Partial<Record<MarkdownType, MarkdownView>> = {};
  if (kept && typeof kept === "object") for (const t of MARKDOWN_TYPES) if ((kept as Record<string, unknown>)[t] === "source") out[t] = "source";
  return out;
};
/** Asked again while shown: the tree and the open file every so often (agents keep writing). */
const POLL_MS = 15_000;
/** Where a tab's scroll is saved, once it settles. */
const SCROLL_SAVE_MS = 300;

const readKeptOf = (ws: FilesWorkspace): Kept => readKept(readStore<unknown>("files:workspaces", {}), ws);
const writeKeptOf = (ws: FilesWorkspace, kept: Kept) => writeStore("files:workspaces", writeKept(readStore<unknown>("files:workspaces", {}), ws, kept));
const NO_KEPT: Kept = { open: [], recent: [], tabs: NO_TABS };

const CHANGE_LABEL: Record<FileChange, string> = { added: "Added", deleted: "Deleted", modified: "Modified", renamed: "Renamed" };
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * The Files page, in the map's place (the macOS app's mode bar): the selected
 * workspace's files, read only, through its host's daemon (so remote hosts'
 * too). The sidebar is the tree (directories read as they open; `.gitignore`d
 * files and `.git` hidden unless asked), its "Filter files…" fuzzy over every
 * path; the main column the open file, highlighted by @pierre/diffs (Shiki in
 * its workers, drawn only where in view; long lines wrapped unless asked not
 * to; a Markdown file rendered, `MarkdownPreview`), with ⌘F to find in it, Copy path
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
  // Long lines wrap unless asked not to; Markdown shows rendered unless its type is kept as source.
  const [wrap, setWrapState] = useState(() => readStore<boolean>("files:wrap", true) !== false);
  const setWrap = useCallback((on: boolean) => {
    setWrapState(on);
    writeStore("files:wrap", on);
  }, []);
  const [markdownViews, setMarkdownViews] = useState(readMarkdownViews);
  /** A Markdown file opened at a line (a chat link, `#L12`): its source shows, there, until the toggle's used. */
  const [sourceFor, setSourceFor] = useState<string | undefined>();
  const setMarkdownView = useCallback((path: string, view: MarkdownView) => {
    const type = markdownType(path);
    if (!type) return;
    setSourceFor(undefined);
    setMarkdownViews((v) => {
      const { [type]: _, ...rest } = v;
      const next = view === "source" ? { ...rest, [type]: "source" as const } : rest;
      writeStore("files:markdownView", next);
      return next;
    });
  }, []);

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
  const keptNow = useRef(kept);
  keptNow.current = kept;
  /** A change to `ws`'s tabs, shown or not (an answer that lands after another workspace shows). */
  const setTabsOf = useCallback(
    (ws: FilesWorkspace, change: (t: TabsState) => TabsState) => {
      if (keyOf(ws) === shownKey.current) return setTabs(change);
      const k = readKeptOf(ws);
      writeKeptOf(ws, { ...k, tabs: change(k.tabs) });
    },
    [setTabs],
  );

  // ── The user's editor (Settings → Files → Open files in an editor command; the macOS app draws it) ──
  const { settings: filesSettings } = useFilesSettings();
  const inApp = macApp();
  const editorOn = inApp && filesSettings.openIn === "editor";
  const editorName = filesSettings.editorCommand.trim().split(/\s+/)[0] || "editor";
  /** Terminals this page ended or saw end, so their tabs going isn't a reason to end them again. */
  const ended = useRef(new Set<string>());
  const [starting, setStarting] = useState<string | undefined>();
  const startingNow = useRef(new Set<string>());
  /** Bumped when the app's relay to an editor went: the placement is sent again for it to reattach. */
  const [resend, setResend] = useState(0);
  const openInEditor = useCallback(
    async (path: string, line?: number) => {
      if (!workspace || !macApp()) return;
      const ws = workspace;
      const key = `${keyOf(ws)}|${path}`;
      if (startingNow.current.has(key)) return;
      startingNow.current.add(key);
      setStarting(path);
      // Opening in the editor keeps the tab, and shows the editor once it runs.
      setTabsOf(ws, (t) => setTabViewer(pinTab(t, path), path, false));
      try {
        const r = await api<{ terminal: { id: string } }>("terminals/editor", {
          workspace: ws.id,
          ...(ws.host ? { host: ws.host } : {}),
          path,
          ...(line && line > 1 ? { line } : {}),
        });
        setTabsOf(ws, (t) => setTabEditor(t, path, r.terminal.id));
      } catch (error) {
        onNotice(`Couldn’t open ${baseName(path)} in ${editorName}: ${errorMessage(error) || "the terminal didn’t start"}`);
        // Shown in the viewer, offering to try again, not retried on its own.
        setTabsOf(ws, (t) => ({ ...t, tabs: t.tabs.map((x) => (x.path === path && !x.editor ? { ...x, exited: true as const } : x)) }));
      } finally {
        startingNow.current.delete(key);
        setStarting((p) => (p === path ? undefined : p));
      }
    },
    [wsKey, setTabsOf, onNotice, editorName],
  );
  /** Close tabs, first ending their editors (the app asks while one still runs); nothing closes if that's cancelled. */
  const requestClose = useCallback(
    async (paths: string[], apply: (t: TabsState) => TabsState) => {
      const ws = workspace;
      const withEditors = keptNow.current.tabs.tabs.filter((t) => paths.includes(t.path) && t.editor);
      if (ws && withEditors.length && macApp()) {
        const items = withEditors.map((t) => ({ terminal: t.editor!, ...(ws.host ? { host: ws.host } : {}), name: baseName(t.path), running: true }));
        items.forEach((i) => ended.current.add(i.terminal));
        if (!(await closeEditors(items))) {
          items.forEach((i) => ended.current.delete(i.terminal));
          return;
        }
        return setTabsOf(ws, apply);
      }
      setTabs(apply);
    },
    [wsKey, setTabs, setTabsOf],
  );

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
  // ⌘W closes the shown file's tab (its editor first, asking while it runs); Changes, never closed, stays.
  const closeActive = useCallback(() => {
    const active = keptNow.current.tabs.active;
    if (!showingChanges && active) void requestClose([active], (t) => closeTab(t, active));
  }, [requestClose, showingChanges]);
  const reopen = useCallback(() => {
    setChangesShown(false);
    setTabs(reopenTab);
  }, [setTabs, setChangesShown]);
  // From Changes, stepping goes back to the shown tab.
  const step = useCallback((by: 1 | -1) => {
    if (showingChanges) setChangesShown(false);
    else setTabs((t) => stepTab(t, by));
  }, [setTabs, setChangesShown, showingChanges]);
  const closeOthers = useCallback(() => {
    const { active, tabs } = keptNow.current.tabs;
    if (active) void requestClose(tabs.filter((t) => t.path !== active).map((t) => t.path), (t) => closeOtherTabs(t, active));
  }, [requestClose]);
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
  // A file asked for from elsewhere (the chat's file links): a kept tab, at its line; only the shown workspace's.
  const [lineAsk, setLineAsk] = useState<LineAsk | undefined>();
  /** A file at a line (shown in its source, a Markdown file's too) or a heading (in its preview). */
  const showAt = useCallback(
    (path: string, at: { line?: number; endLine?: number; anchor?: string }) => {
      openFile(path, true);
      if (at.line) setSourceFor(markdownType(path) ? path : undefined);
      setLineAsk(
        at.line
          ? { path, line: at.line, ...(at.endLine ? { endLine: at.endLine } : {}), token: Date.now() }
          : at.anchor
            ? { path, anchor: at.anchor, token: Date.now() }
            : undefined,
      );
    },
    [openFile],
  );
  const openAsked = useCallback(
    (ask: FileAsk) => {
      if (!workspace || ask.workspace !== workspace.id || (ask.host ?? "") !== (workspace.host ?? "")) return;
      setChangesShown(false);
      showAt(ask.path, ask);
      if (editorOn) void openInEditor(ask.path, ask.line);
    },
    [wsKey, showAt, setChangesShown, editorOn, openInEditor],
  );
  /** A Markdown file's link to another of the workspace's files (a kept tab, at its line or heading) or folders (opened in the tree). */
  const openLink = useCallback(
    (link: WorkspaceLink) => {
      if (link.kind === "file") {
        showAt(link.path, link);
        if (editorOn) void openInEditor(link.path, link.line);
        return;
      }
      setSidebarHidden(false);
      if (!link.path) return treeRef.current?.focus();
      setKept((k) => {
        const want = [...parentsOf(link.path), link.path].filter((p) => !k.open.includes(p));
        return want.length ? { ...k, open: [...k.open, ...want] } : k;
      });
      setCursor(link.path);
      reveal(link.path);
      requestAnimationFrame(() => treeRef.current?.focus({ preventScroll: true }));
    },
    [showAt, editorOn, openInEditor, setKept],
  );
  useEffect(() => {
    const ask = takeFileAsk();
    if (ask) openAsked(ask);
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
  const viewer = useRef<ViewerHandle | null>(null);
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

  // The shown tab in the editor: the editor again if one runs, else a new one at the line in view (its View / Editor
  // toggle, ⌘K, Reopen in editor); or the built-in viewer over it.
  const showEditor = useCallback(
    (path: string) => {
      const tab = keptNow.current.tabs.tabs.find((t) => t.path === path);
      if (tab?.editor) {
        setTabs((t) => setTabViewer(t, path, false));
        return;
      }
      void openInEditor(path, viewer.current?.line?.());
    },
    [setTabs, openInEditor],
  );
  const showViewer = useCallback((path: string) => setTabs((t) => setTabViewer(t, path, true)), [setTabs]);

  // ⌘K's commands.
  const current = useRef({ openAsked, file, openFile, focusFilter, toggleSidebar, setShowIgnored, showIgnored, refresh, copyPath, showChanges, closeActive, reopen, step, closeOthers, showingChanges, layout, listShown, filterDiffFiles, cycleMode, showEditor, showViewer, wrap, setWrap, setMarkdownView });
  current.current = { openAsked, file, openFile, focusFilter, toggleSidebar, setShowIgnored, showIgnored, refresh, copyPath, showChanges, closeActive, reopen, step, closeOthers, showingChanges, layout, listShown, filterDiffFiles, cycleMode, showEditor, showViewer, wrap, setWrap, setMarkdownView };
  useEffect(() => {
    const c = () => current.current;
    const offs = [
      onAppCommand("files-quick-open", () => setQuick(true)),
      onAppCommand("files-filter", () => c().focusFilter()),
      onAppCommand("files-sidebar", () => c().toggleSidebar()),
      onAppCommand("files-ignored", () => c().setShowIgnored(!c().showIgnored)),
      onAppCommand("files-refresh", () => c().refresh()),
      onAppCommand("files-find", () => viewer.current?.find()),
      onAppCommand("files-wrap", () => c().setWrap(!c().wrap)),
      onAppCommand("files-markdown-source", () => {
        const f = c().file;
        if (f && !c().showingChanges) c().setMarkdownView(f, "source");
      }),
      onAppCommand("files-markdown-preview", () => {
        const f = c().file;
        if (f && !c().showingChanges) c().setMarkdownView(f, "preview");
      }),
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
      onAppCommand("files-open-at", (arg) => {
        const ask = checkFileAsk(arg);
        // Asked of the page as it shows: taken here, not again as it mounts.
        takeFileAsk();
        if (ask) c().openAsked(ask);
      }),
      onAppCommand("files-close-tab", () => c().closeActive()),
      onAppCommand("files-reopen-tab", () => c().reopen()),
      onAppCommand("files-next-tab", () => c().step(1)),
      onAppCommand("files-previous-tab", () => c().step(-1)),
      onAppCommand("files-close-other-tabs", () => c().closeOthers()),
      onAppCommand("files-open-editor", () => {
        const f = c().file;
        if (f && !c().showingChanges) c().showEditor(f);
      }),
      onAppCommand("files-open-viewer", () => {
        const f = c().file;
        if (f && !c().showingChanges) c().showViewer(f);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const read = workspace && file ? peek(readPath(workspace, file)) : undefined;
  const text = !!read?.data && "text" in (read.data as FileRead);
  const change = file ? changes.get(file) : undefined;
  const tabCount = kept.tabs.tabs.length;
  const reopenable = kept.tabs.closed.some((p) => !kept.tabs.tabs.some((t) => t.path === p));
  const activeTab = kept.tabs.tabs.find((t) => t.path === file);
  const mdType = file ? markdownType(file) : undefined;
  const markdown: MarkdownView | undefined = !mdType ? undefined : sourceFor === file || markdownViews[mdType] === "source" ? "source" : "preview";
  // What shows in the viewer's place: the tab's editor (the macOS app draws it there), or the built-in viewer.
  const editorState: EditorState = !inApp || !activeTab || showingChanges
    ? "off"
    : starting === activeTab.path && !activeTab.editor
      ? "starting"
      : activeTab.editor
        ? activeTab.viewer
          ? "viewer"
          : "shown"
        : activeTab.exited
          ? "exited"
          : editorOn
            ? "starting"
            : "off";
  useEffect(() => {
    onViewState?.({
      ...(workspace ? { workspace: workspace.name } : {}),
      ...(file ? { file } : {}),
      ...(change ? { change } : {}),
      text,
      ...(markdown && text ? { markdown } : {}),
      wrap,
      showIgnored,
      sidebarHidden,
      tabs: tabCount,
      reopenable,
      changes: showingChanges,
      changed: changes.size,
      changesMode,
      layout,
      listShown,
      editor: editorState === "shown" ? "shown" : activeTab?.editor ? "viewer" : "none",
      canEditor: inApp && !!file && !showingChanges,
    });
  }, [workspace?.name, file, change, text, markdown, wrap, showIgnored, sidebarHidden, tabCount, reopenable, showingChanges, changes.size, changesMode, layout, listShown, editorState, activeTab?.editor, inApp, onViewState]);

  // Shown with the editor setting on, a tab opens in the editor (once: one whose editor quit shows the viewer, offering it again).
  useEffect(() => {
    if (!editorOn || showingChanges || !activeTab || activeTab.editor || activeTab.viewer || activeTab.exited) return;
    void openInEditor(activeTab.path);
  }, [editorOn, showingChanges, activeTab?.path, activeTab?.editor, activeTab?.viewer, activeTab?.exited, openInEditor]);
  // The app's word on the editors: one quit (its tab shows the viewer, wherever it's kept), or its relay went.
  const checkEditors = useCallback(
    (ids: string[]) => {
      const ws = workspace;
      if (!ws || !ids.length) return;
      const q = new URLSearchParams({ workspace: ws.id, ...(ws.host ? { host: ws.host } : {}) });
      void api<{ terminals: { id: string }[] }>(`terminals?${q}`).then(
        (r) => {
          const live = new Set(r.terminals.map((t) => t.id));
          for (const id of ids) {
            if (live.has(id)) continue;
            ended.current.add(id);
            setTabsOf(ws, (t) => tabEditorExited(t, id));
          }
          setResend((n) => n + 1);
        },
        () => {},
      );
    },
    [wsKey, setTabsOf],
  );
  useEffect(
    () =>
      onEditorEvent((e) => {
        if (e.type === "exited") {
          ended.current.add(e.terminal);
          writeStore("files:workspaces", editorExitedIn(readStore<unknown>("files:workspaces", {}), e.terminal));
          setTabs((t) => tabEditorExited(t, e.terminal));
        } else if (e.type === "lost") checkEditors([e.terminal]);
      }),
    [setTabs, checkEditors],
  );
  // Back to a workspace (or the page): its tabs' editors that ended meanwhile show the viewer.
  useEffect(() => {
    if (inApp) checkEditors(tabEditors(keptNow.current.tabs));
  }, [wsKey]);
  // A tab that went with its editor running some other way (past the tab limit): its terminal ends too.
  const hadEditors = useRef({ key: wsKey, ids: new Set<string>() });
  useEffect(() => {
    const ids = new Set(tabEditors(kept.tabs));
    const before = hadEditors.current;
    hadEditors.current = { key: wsKey, ids };
    if (before.key !== wsKey || !workspace) return;
    const gone = [...before.ids].filter((id) => !ids.has(id) && !ended.current.has(id));
    if (!gone.length) return;
    gone.forEach((id) => ended.current.add(id));
    forgetEditors(gone);
    for (const id of gone) void api("terminals/kill", { id, ...(workspace.host ? { host: workspace.host } : {}) }).catch(() => {});
  }, [kept.tabs, wsKey]);
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
                onClose={(path) => void requestClose([path], (t) => closeTab(t, path))}
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
              {...(lineAsk?.path === file ? { reveal: lineAsk } : {})}
              onScrolled={onScrolled}
              onUse={activeTab?.preview ? onUse : undefined}
              wrap={wrap}
              onWrap={setWrap}
              {...(markdown ? { markdown, onMarkdown: (view: MarkdownView) => setMarkdownView(file, view) } : {})}
              onOpenLink={openLink}
              editor={{
                state: editorState,
                available: inApp,
                ...(activeTab?.editor ? { terminal: activeTab.editor } : {}),
                ...(workspace.host ? { host: workspace.host } : {}),
                name: editorName,
                resend,
                onEditor: () => showEditor(file),
                onViewer: () => showViewer(file),
              }}
              browserNote={!inApp && filesSettings.openIn === "editor" ? editorName : undefined}
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
/** A file asked to show at a line (marked) or a heading (a Markdown file's preview); `token` tells asks apart. */
type LineAsk = { path: string; line?: number; endLine?: number; anchor?: string; token: number };

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

/** The viewer's handle: ⌘F, and the line at the top of the view (where the editor opens). */
type ViewerHandle = { find: () => void; line?: () => number };
/** What the tab's place shows in the macOS app: its editor (drawn by the app), the editor starting, the viewer over a
 * running editor, the viewer after the editor quit, or the viewer alone (the editor setting off). */
type EditorState = "shown" | "starting" | "viewer" | "exited" | "off";
type EditorProps = {
  state: EditorState;
  /** The macOS app, which can draw the editor: the View / Editor toggle shows. */
  available: boolean;
  terminal?: string;
  host?: string;
  /** The command's program ("nvim"), for its labels. */
  name: string;
  resend: number;
  onEditor: () => void;
  onViewer: () => void;
};

/**
 * Where the tab's editor terminal shows: the page keeps this box and tells the macOS app its frame
 * (`postEditorPlacement`), which lays the terminal exactly over it and follows it as the page lays out
 * (sidebar, window), stepping aside while a dialog (⌘K, ⌘P) is open over it.
 */
function EditorSlot({ terminal, host, name, resend }: { terminal: string; host?: string; name: string; resend: number }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const send = (force = false) => {
      const r = el.getBoundingClientRect();
      postEditorPlacement({ terminal, ...(host ? { host } : {}), x: r.left, y: r.top, width: r.width, height: r.height, covered: modalOpen() }, force);
    };
    send(true);
    // Shown (its tab, the toggle, the page coming back): the editor takes the keyboard.
    focusEditor();
    const sizes = new ResizeObserver(() => send());
    sizes.observe(el);
    // Moves that change no size (another panel opening beside it) are caught by looking now and then.
    const timer = setInterval(() => send(), 250);
    const changed = () => send();
    window.addEventListener(MODAL_EVENT, changed);
    window.addEventListener("resize", changed);
    return () => {
      sizes.disconnect();
      clearInterval(timer);
      window.removeEventListener(MODAL_EVENT, changed);
      window.removeEventListener("resize", changed);
      hideEditor();
    };
  }, [terminal, host, resend]);
  return (
    <div ref={box} className="fv-editor" role="region" aria-label={`${name}: the file in your editor`} data-terminal={terminal} onMouseDown={() => focusEditor()}>
      <p className="gh-note">Opening {name}…</p>
    </div>
  );
}

/**
 * The open file: its head (its path, size and lines, Copy path, Show changes
 * when changed, Find, Refresh), then its lines drawn by @pierre/diffs's
 * `File` under its `Virtualizer`, so only the lines in view are drawn. Not
 * text, an image or past the limit: said so, politely. In the macOS app with
 * an editor command set (Settings → Files), the tab's editor in their place,
 * a View / Editor toggle in the head.
 */
function FileViewer({
  workspace,
  path,
  change,
  onShowChanges,
  onCopyPath,
  handle,
  scroll,
  reveal,
  onScrolled,
  onUse,
  wrap,
  onWrap,
  markdown,
  onMarkdown,
  onOpenLink,
  editor,
  browserNote,
}: {
  workspace: FilesWorkspace;
  path: string;
  change?: FileChange;
  onShowChanges: (path: string) => void;
  onCopyPath: (path: string) => void;
  handle: React.RefObject<ViewerHandle | null>;
  /** Where the tab was scrolled to, restored once its lines are drawn. */
  scroll?: number;
  /** A line (or lines) to show and mark, asked from elsewhere (the chat's file links), or a heading in a Markdown file's preview. */
  reveal?: LineAsk;
  onScrolled: (path: string, top: number) => void;
  /** A preview tab: using the file keeps it. */
  onUse?: (path: string) => void;
  /** Long lines wrap (and its toggle). */
  wrap: boolean;
  onWrap: (on: boolean) => void;
  /** A Markdown file: rendered or its source (and its toggle). */
  markdown?: MarkdownView;
  onMarkdown?: (view: MarkdownView) => void;
  /** A Markdown file's link to another of the workspace's files or folders. */
  onOpenLink: (link: WorkspaceLink) => void;
  editor: EditorProps;
  /** In a browser with the editor setting on: the program, for a note that the macOS app opens it. */
  browserNote?: string;
}) {
  const editorShows = editor.state === "shown" || editor.state === "starting";
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
  const preview = markdown === "preview" && text !== undefined;
  const options = useMemo(
    () => ({
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      disableFileHeader: true,
      themeType: resolved === "light" ? ("light" as const) : ("dark" as const),
      theme: DIFF_THEMES,
      unsafeCSS: FIND_CSS,
      tokenizeMaxLength: 400_000,
    }),
    [resolved, wrap],
  );

  // Find in the file (⌘F), as the diff's.
  const frame = useRef<HTMLDivElement>(null);
  const scrollerOf = () => frame.current?.querySelector<HTMLElement>(":scope > .gd-scroll, :scope > .fv-md-scroll") ?? null;
  const previewHandle = useRef<PreviewHandle | null>(null);
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
  const found = useMemo(() => (finding && !preview && asked && text !== undefined ? findInText(path, text, asked, findOpts) : null), [finding, preview, asked, findOpts, text, path]);
  const byPath = useMemo(() => {
    if (!found?.matches.length) return null;
    const lines = new Map<string, FindMatch[]>();
    for (const m of found.matches) lines.set(m.key, [...(lines.get(m.key) ?? []), m]);
    return new Map([[path, lines]]);
  }, [found, path]);
  const [atMatch, setAtMatch] = useState(-1);
  const current = found && atMatch >= 0 ? found.matches[atMatch] : undefined;
  // A line asked for (the chat's file links): marked, as a find's match is, until a find takes its place.
  const [marked, setMarked] = useState<{ line: number; endLine?: number } | undefined>();
  const lineMarks = useMemo(() => {
    if (!marked || text === undefined) return null;
    const all = text.split("\n");
    const byKey = new Map<string, FindMatch[]>();
    const last = Math.min(marked.endLine ?? marked.line, all.length);
    for (let n = marked.line; n <= last; n++) {
      const end = all[n - 1]!.length;
      if (end) byKey.set(`R${n}`, [{ file: 0, path, key: `R${n}`, line: n - 1, start: 0, end }]);
    }
    return byKey.size ? new Map([[path, byKey]]) : null;
  }, [marked, text, path]);
  useFindPaint(scrollerOf, byPath ?? (finding ? null : lineMarks), current);
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
    if (previewHandle.current) return previewHandle.current.find();
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
    handle.current = {
      find: () => (text !== undefined && !editorShows ? openFind() : undefined),
      line: () => {
        if (previewHandle.current) return previewHandle.current.line();
        const scroller = scrollerOf();
        return scroller ? firstLineInView(scroller) + 1 : 1;
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, openFind, text, editorShows]);
  const hasText = text !== undefined && !editorShows;
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
  const restoring = useRef(scroll && scroll > 0 && !reveal ? scroll : 0);
  // Source and preview trade places: the find closes (each has its own), the view starts at the top.
  const shownAs = useRef(preview);
  if (shownAs.current !== preview) {
    shownAs.current = preview;
    restoring.current = 0;
    if (finding) {
      setFinding(false);
      clearFindMarks();
    }
  }
  const hasContents = !!contents;
  // A line asked for: scrolled to the middle once drawn (the virtualizer draws only what's near), and marked.
  useEffect(() => {
    if (!hasContents || !reveal?.line) return;
    restoring.current = 0;
    setMarked({ line: reveal.line, ...(reveal.endLine ? { endLine: reveal.endLine } : {}) });
    const token = ++revealing.current;
    const line = reveal.line;
    const target: FindMatch = { file: 0, path, key: `R${line}`, line: line - 1, start: 0, end: 0 };
    const raf = requestAnimationFrame(() => {
      const scroller = scrollerOf();
      if (scroller) void revealMatch(scroller, target, order, () => revealing.current === token);
    });
    return () => cancelAnimationFrame(raf);
  }, [hasContents, reveal?.token]);
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
    if (restoring.current || !(scroller.classList?.contains("gd-scroll") || scroller.classList?.contains("fv-md-scroll"))) return;
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
  if (editor.state === "shown" && editor.terminal) {
    body = <EditorSlot terminal={editor.terminal} host={editor.host} name={editor.name} resend={editor.resend} />;
  } else if (editor.state === "starting" || editor.state === "shown") {
    body = <p className="gh-note">Starting {editor.name}…</p>;
  } else if (data && "refused" in data) {
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
  } else if (contents && preview) {
    body = (
      <div className="gd-scroll-wrap fv-scroll-wrap" ref={frame} onScrollCapture={onScroll} onWheel={use} onPointerDown={use} onKeyDown={use}>
        <MarkdownPreview
          workspace={workspace}
          path={path}
          text={text!}
          wrap={wrap}
          handle={previewHandle}
          onOpen={onOpenLink}
          onUse={use}
          {...(reveal?.anchor ? { reveal: { anchor: reveal.anchor, token: reveal.token } } : {})}
        />
      </div>
    );
  } else if (contents) {
    body = (
      <div
        className="gd-scroll-wrap fv-scroll-wrap"
        ref={frame}
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
        <Virtualizer className={`gd-scroll fv-scroll${wrap ? " wrap" : ""}`}>
          <section className="gd-file fv-file" data-path={path} aria-label={path}>
            <File className="gd-diff" file={contents} options={options} />
          </section>
        </Virtualizer>
        <KeepInPlace scrollerOf={scrollerOf} />
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
        {markdown && onMarkdown && text !== undefined && !editorShows && (
          <span className="fv-mode" role="group" aria-label="Show the Markdown">
            <button
              className={`page-btn${markdown === "preview" ? " on" : ""}`}
              aria-pressed={markdown === "preview"}
              data-tip="Rendered (⌘K: Show the preview)"
              onClick={() => onMarkdown("preview")}
            >
              <Eye size={13} aria-hidden="true" />
              <span className="page-tool-label">Preview</span>
            </button>
            <button
              className={`page-btn${markdown === "source" ? " on" : ""}`}
              aria-pressed={markdown === "source"}
              data-tip="The Markdown as written (⌘K: Show the Markdown source)"
              onClick={() => onMarkdown("source")}
            >
              <FileCode2 size={13} aria-hidden="true" />
              <span className="page-tool-label">Source</span>
            </button>
          </span>
        )}
        {text !== undefined && !editorShows && (
          <button
            className={`icon-btn${wrap ? " on" : ""}`}
            aria-pressed={wrap}
            aria-label="Wrap lines"
            data-tip={wrap ? "Long lines wrap (⌘K: Don’t wrap lines)" : "Long lines scroll sideways (⌘K: Wrap lines)"}
            onClick={() => onWrap(!wrap)}
          >
            <WrapText size={13} aria-hidden="true" />
          </button>
        )}
        {text !== undefined && (
          <button className="icon-btn" aria-label={preview ? "Find in the preview" : "Find in the file"} data-tip="Find (⌘F)" onClick={openFind}>
            <Search size={13} aria-hidden="true" />
          </button>
        )}
        <button className="icon-btn" aria-label="Reload the file" data-tip="Reload" onClick={() => void load(at, true)}>
          <RefreshCw size={13} aria-hidden="true" className={entry?.loading ? "spinning" : undefined} />
        </button>
        {editor.available && (
          <span className="fv-mode" role="group" aria-label="Show the file in">
            <button
              className={`page-btn${!editorShows ? " on" : ""}`}
              aria-pressed={!editorShows}
              data-tip="The built-in viewer (⌘K: Open in viewer)"
              onClick={() => editorShows && editor.onViewer()}
              disabled={editor.state === "starting"}
            >
              <FileText size={13} aria-hidden="true" />
              <span className="page-tool-label">View</span>
            </button>
            <button
              className={`page-btn${editorShows ? " on" : ""}`}
              aria-pressed={editorShows}
              data-tip={`${editor.name}, in a terminal on the workspace’s host (⌘K: Open in editor)`}
              onClick={() => !editorShows && editor.onEditor()}
            >
              <SquareTerminal size={13} aria-hidden="true" />
              <span className="page-tool-label">Editor</span>
            </button>
          </span>
        )}
      </header>
      {editor.state === "exited" && (
        <p className="fv-editor-note" role="status">
          <span>{editor.name} quit. The file shows in the viewer.</span>
          <button className="page-btn solid" onClick={editor.onEditor}>
            <SquareTerminal size={13} aria-hidden="true" />
            <span>Reopen in editor</span>
          </button>
        </p>
      )}
      {browserNote && (
        <p className="fv-editor-note" role="note">
          <span>Files open in {browserNote} in the macOS app. A browser shows them in the viewer.</span>
        </p>
      )}
      {body}
    </div>
  );
}

/** Keeps the first line in view in place as lines above it change height (wrapped lines measured as they're drawn), as the diff's. */
function KeepInPlace({ scrollerOf }: { scrollerOf: () => HTMLElement | null }) {
  useDiffAnchor(scrollerOf);
  return null;
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
