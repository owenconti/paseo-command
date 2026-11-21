/**
 * The Files tab beside an agent's conversation (the user's ask: the workspace's files in the app itself, with diffs,
 * go to any file, a language server's features and vim keys), drawn by the page, unlike your editor's terminal.
 *
 * Its sidebar lists the workspace's uncommitted changes, the branch's changes against its base (committed or not), or
 * every file (a tree). A changed file opens with its diff against that base, inline; ⌘P (or :e, ⌃P in vim) goes to any
 * file. The editor (`editor.ts`) saves over the version it read only (`store.ts`), and its language server (`lsp.ts`,
 * the host's `language-servers` plugin) brings go to definition (gd, F12, ⌘-click), usages (gr, ⇧F12, listed under
 * the editor), hover (K), completion, signatures, errors, rename (F2, <space>rn) and format (⇧⌥F).
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, ChevronRight, Columns2, FileDiff, FileText, Folder, FolderOpen, PanelLeftClose, PanelLeftOpen, RefreshCw, Rows2, Save, X } from "lucide-react";
import { onAppCommand } from "../appCommands";
import { readStore, writeStore } from "../api";
import { allPath, ensure, treePath, useFilesData } from "../files/api";
import type { FileList, FileTree } from "../files/types";
import { rankFiles } from "../github/diffSearch";
import { toggleWrapSetting } from "./wrapSetting";
import type { DiffFile, GithubUnavailable, WorkspaceChanges } from "../github/types";
import { ResizeEdge } from "../ResizeEdge";
import { languageOf } from "./paths";
import {
  activate,
  activeBuffer,
  changesNow,
  checkDisk,
  closeBuffer,
  closeUsages,
  filterUsages,
  pickUsage,
  diffLayout,
  diffModeOf,
  filesOf,
  followTheme,
  keepMine,
  loadChanges,
  lspStateOf,
  mount,
  openFile,
  QUICK_OPEN_EVENT,
  reload,
  rename,
  restartLsp,
  save,
  say,
  setDiff,
  setDiffLayout,
  setSide,
  showUsage,
  useFilesStore,
  type Buffer,
  type Files,
  type FilesWorkspace,
  type SideView,
  type Usage,
} from "./store";
import "../crew/crew-files.css";
import "./files-pane.css";

const SIDE_LABEL: Record<SideView, string> = { uncommitted: "Uncommitted", branch: "Branch", tree: "All files" };
const SIDE_TIP: Record<SideView, string> = {
  uncommitted: "What isn't committed yet, against the last commit",
  branch: "Everything this branch changes against its base, committed or not",
  tree: "Every file in the workspace",
};
const WIDTH_KEY = "files:sidebarWidth";
const HIDDEN_KEY = "files:sidebarHidden";
const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const dir = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Opens a file in the Files tab from elsewhere (a chat's file link): its workspace, path and line. */
export const FILES_OPEN_EVENT = "paseo:files-open";
export type FilesOpenAsk = { workspace: string; host?: string; path: string; line?: number };
let pendingAsk: FilesOpenAsk | null = null;
export function askFilesOpen(ask: FilesOpenAsk) {
  pendingAsk = ask;
  window.dispatchEvent(new CustomEvent(FILES_OPEN_EVENT));
}

export function FilesPane({ workspace }: { workspace: FilesWorkspace }) {
  useFilesStore();
  const f = filesOf(workspace);
  const host = useRef<HTMLDivElement>(null);
  const [quick, setQuick] = useState(false);
  const [width, setWidth] = useState(() => readStore<number>(WIDTH_KEY, 260));
  // ⌘B (and ⌘K) hides or shows the sidebar, kept for every workspace; ⌃B stays vim's.
  const [sideHidden, setSideHidden] = useState(() => readStore<boolean>(HIDDEN_KEY, false));
  const toggleSide = () =>
    setSideHidden((h) => {
      writeStore(HIDDEN_KEY, !h);
      return !h;
    });
  useEffect(() => onAppCommand("files-sidebar", toggleSide), []);
  const b = activeBuffer(f);
  const mode = diffModeOf(f.side);

  useEffect(() => {
    followTheme();
  }, []);
  // The shown buffer's editor lives in this box while the pane shows.
  useEffect(() => {
    mount(f, host.current);
    return () => mount(f, null);
  }, [f]);
  // What's on disk, and the sidebar's changes, kept current while the pane shows.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void checkDisk(f);
    };
    const disk = setInterval(tick, 2_000);
    const list = setInterval(() => {
      const m = diffModeOf(f.side);
      if (m && document.visibilityState === "visible") void loadChanges(f, m, 10_000);
    }, 10_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(disk);
      clearInterval(list);
      window.removeEventListener("focus", tick);
    };
  }, [f]);
  useEffect(() => {
    if (mode) void loadChanges(f, mode);
  }, [f, mode]);
  // Asks from elsewhere: a chat's file link.
  useEffect(() => {
    const take = () => {
      const ask = pendingAsk;
      if (!ask || ask.workspace !== workspace.id || (ask.host ?? "") !== (workspace.host ?? "")) return;
      pendingAsk = null;
      void openFile(f, ask.path, { ...(ask.line ? { line: ask.line } : {}) });
    };
    take();
    window.addEventListener(FILES_OPEN_EVENT, take);
    return () => window.removeEventListener(FILES_OPEN_EVENT, take);
  }, [f, workspace.id, workspace.host]);
  // ⌘P (and :e, ⌃P in vim) goes to a file; ⌘S saves, from anywhere in the pane.
  useEffect(() => {
    const open = () => setQuick(true);
    window.addEventListener(QUICK_OPEN_EVENT, open);
    const key = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "p") {
        e.preventDefault();
        setQuick(true);
      } else if (k === "b" && !e.repeat) {
        e.preventDefault();
        toggleSide();
      } else if (k === "s" && (e.target as HTMLElement | null)?.closest?.(".files-view")) {
        // Only with the keyboard in the pane: elsewhere on the Command tab ⌘S hides or shows the crew list (CrewMap).
        e.preventDefault();
        const now = activeBuffer(f);
        if (now) void save(f, now);
      }
    };
    window.addEventListener("keydown", key);
    // ⌥Z (VS Code's key): wrap long lines or keep them whole, caught before the editor (vim would take its Ω in normal
    // mode, and a keymap ahead of vim's stops its Ex commands).
    const wrap = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code !== "KeyZ") return;
      if (!(e.target as HTMLElement | null)?.closest?.(".files-view") || (e.target as HTMLElement).closest(".files-quick")) return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) toggleWrapSetting();
    };
    window.addEventListener("keydown", wrap, true);
    return () => {
      window.removeEventListener(QUICK_OPEN_EVENT, open);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keydown", wrap, true);
    };
  }, [f]);
  // A notice goes after a while.
  useEffect(() => {
    if (!f.notice) return;
    const t = setTimeout(() => say(f, null), 6_000);
    return () => clearTimeout(t);
  }, [f, f.notice]);

  const lang = b ? languageOf(b.path) : null;
  const lsp = lspStateOf(f, b?.lsp?.group);
  const changes = mode ? changesNow(f, mode) : null;
  const changedHere = b && mode && changes?.data && !("available" in changes.data) ? changes.data.files.some((x) => x.path === b.path) : false;

  return (
    <section className="crew-files files-view beside" data-tool="files" aria-label={`${workspace.name}: files`} style={{ "--files-side": `${width}px` } as CSSProperties}>
      {!sideHidden && (
        <aside className="files-side" aria-label="Files">
          <div className="files-side-modes" role="radiogroup" aria-label="Show">
            {(["uncommitted", "branch", "tree"] as const).map((s) => (
              <button key={s} role="radio" aria-checked={f.side === s} data-tip={SIDE_TIP[s]} onClick={() => setSide(f, s)}>
                {SIDE_LABEL[s]}
              </button>
            ))}
          </div>
          {f.side === "tree" ? <Tree f={f} /> : <ChangeList f={f} />}
          <ResizeEdge
            label="Resize the file list"
            value={width}
            min={180}
            max={520}
            grows="right"
            onResize={(w) => (setWidth(w), writeStore(WIDTH_KEY, w))}
            onReset={() => (setWidth(260), writeStore(WIDTH_KEY, 260))}
          />
        </aside>
      )}
      <div className="files-main">
        <Tabs f={f} />
        {b && (
          <div className="files-bar">
            <button className="files-icon-btn" aria-label={sideHidden ? "Show the sidebar" : "Hide the sidebar"} aria-pressed={!sideHidden} data-tip={`${sideHidden ? "Show" : "Hide"} the sidebar (⌘B)`} onClick={toggleSide}>
              {sideHidden ? <PanelLeftOpen size={13} aria-hidden="true" /> : <PanelLeftClose size={13} aria-hidden="true" />}
            </button>
            <span className="files-path" title={b.path}>
              {b.outside && <span className="files-badge">Outside the workspace · read only</span>}
              {dir(b.path) && <span className="files-dir">{dir(b.path)}/</span>}
              <span className="files-name">{name(b.path)}</span>
              {b.dirty && <span className="files-dirty" aria-label="Unsaved changes" data-tip="Unsaved changes (⌘S or :w saves)" />}
            </span>
            <span className="files-bar-tools">
              {lang && <LspChip f={f} b={b} state={lsp} />}
              {b.diff && (
                <span className="files-layout" role="radiogroup" aria-label="Diff layout">
                  <button role="radio" aria-checked={diffLayout() === "stacked"} aria-label="Stacked" data-tip="Stacked: what was removed shown above what replaced it" onClick={() => setDiffLayout("stacked")}>
                    <Rows2 size={13} aria-hidden="true" />
                  </button>
                  <button role="radio" aria-checked={diffLayout() === "split"} aria-label="Split" data-tip="Split: the base beside the file" onClick={() => setDiffLayout("split")}>
                    <Columns2 size={13} aria-hidden="true" />
                  </button>
                </span>
              )}
              {!b.outside && (changedHere || b.diff) && (
                <button
                  className={`page-btn${b.diff ? " on" : ""}`}
                  aria-pressed={!!b.diff}
                  data-tip={b.diff ? "Hide the diff (:diff)" : `Show what changed against ${mode === "uncommitted" ? "the last commit" : "the base"} (:diff)`}
                  onClick={() => void setDiff(f, b, b.diff ? null : mode ?? "all")}
                >
                  <FileDiff size={13} aria-hidden="true" />
                  <span className="page-tool-label">Diff</span>
                </button>
              )}
              {!b.outside && (
                <button className={`page-btn${b.dirty ? " solid" : ""}`} disabled={!b.dirty || b.saving} data-tip="Save (⌘S, :w)" onClick={() => void save(f, b)}>
                  <Save size={13} aria-hidden="true" />
                  <span className="page-tool-label">{b.saving ? "Saving…" : "Save"}</span>
                </button>
              )}
            </span>
          </div>
        )}
        <Banners f={f} b={b} />
        <div className="files-editor" ref={host} data-empty={!b || undefined} />
        {!b && (
          <div className="files-empty">
            <p>{sideHidden ? "Open a file: go to any file with ⌘P, or show the sidebar with ⌘B." : "Open a file: pick one on the left, or go to any file with ⌘P."}</p>
            <p className="files-empty-keys">
              In the editor: <kbd>gd</kbd> definition · <kbd>gr</kbd> usages · <kbd>K</kbd> hover · <kbd>:w</kbd> save · <kbd>⌃O</kbd> back
            </p>
          </div>
        )}

        {f.notice && (
          <div className="files-notice" role="status">
            {f.notice}
            <button aria-label="Dismiss" onClick={() => say(f, null)}>
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
      {quick && <QuickOpen f={f} onClose={() => setQuick(false)} />}
      {f.usages && !quick && <UsagesPicker f={f} />}
    </section>
  );
}

function LspChip({ f, b, state }: { f: Files; b: Buffer; state: ReturnType<typeof lspStateOf> }) {
  const lang = languageOf(b.path)?.name;
  if (!b.lsp) return <span className="files-lsp" data-tip="No language server knows this kind of file: highlighting only">{lang}</span>;
  if (!state || state.phase === "connecting")
    return (
      <span className="files-lsp" data-state="connecting" data-tip="Starting its language server on the workspace's host">
        {lang} · starting…
      </span>
    );
  if (state.phase === "ended")
    return (
      <button className="files-lsp" data-state="ended" data-tip={`${state.reason} Click to try again.`} onClick={() => restartLsp(f, b.lsp!.group)}>
        {lang} · no language server
      </button>
    );
  return (
    <span className="files-lsp" data-state="ready" data-tip={`${state.server} on the workspace's host${state.busy ? `: ${state.busy}` : ""}`}>
      {state.server}
      {state.busy ? ` · ${state.busy}…` : ""}
    </span>
  );
}

function Tabs({ f }: { f: Files }) {
  if (!f.buffers.length) return null;
  return (
    <div className="files-tabs" role="tablist" aria-label="Open files">
      {f.buffers.map((x) => (
        <div key={x.key} className="files-tab" role="tab" aria-selected={x.key === f.active} title={x.path} onMouseDown={(e) => e.button === 1 && (e.preventDefault(), closeBuffer(f, x.key))}>
          <button className="files-tab-name" onClick={() => activate(f, x.key)}>
            {x.diff && <FileDiff size={12} aria-hidden="true" />}
            {name(x.path)}
            {x.dirty && <span className="files-dirty" aria-label="unsaved" />}
          </button>
          <button className="files-tab-close" aria-label={`Close ${name(x.path)}`} onClick={() => closeBuffer(f, x.key)}>
            <X size={11} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function Banners({ f, b }: { f: Files; b: Buffer | undefined }) {
  const closing = f.closing ? f.buffers.find((x) => x.key === f.closing) : undefined;
  const [renameTo, setRenameTo] = useState("");
  useEffect(() => {
    setRenameTo(f.renaming?.word ?? "");
  }, [f.renaming]);
  return (
    <>
      {closing && (
        <div className="files-banner" role="alertdialog" aria-label="Unsaved changes">
          <span>{name(closing.path)} has unsaved changes.</span>
          <button className="page-btn solid" autoFocus onClick={() => void save(f, closing).then((ok) => ok && closeBuffer(f, closing.key))}>
            Save and close
          </button>
          <button className="page-btn" onClick={() => closeBuffer(f, closing.key, true)}>
            Discard them
          </button>
          <button className="page-btn" onClick={() => ((f.closing = null), say(f, null))}>
            Keep it open
          </button>
        </div>
      )}
      {b?.disk === "changed" && (
        <div className="files-banner warn" role="alert">
          <span>{name(b.path)} changed on disk (an agent may have edited it) while you had unsaved changes.</span>
          <button className="page-btn" onClick={() => void reload(f, b).then(() => b.view.focus())}>
            Reload theirs
          </button>
          <button className="page-btn" onClick={() => (keepMine(f, b), b.view.focus())}>
            Keep mine
          </button>
        </div>
      )}
      {b?.disk === "missing" && (
        <div className="files-banner warn" role="alert">
          <span>{name(b.path)} isn't on disk any more.</span>
          {b.dirty && (
            <button className="page-btn" onClick={() => void save(f, b, true)}>
              Save mine
            </button>
          )}
          <button className="page-btn" onClick={() => closeBuffer(f, b.key, true)}>
            Close it
          </button>
        </div>
      )}
      {b?.note && <div className="files-banner quiet">{b.note}</div>}
      {f.renaming && (
        <form
          className="files-banner"
          onSubmit={(e) => {
            e.preventDefault();
            void rename(f, renameTo);
          }}
        >
          <label>
            Rename <code>{f.renaming.word}</code> to{" "}
            <input
              autoFocus
              value={renameTo}
              spellCheck={false}
              onChange={(e) => setRenameTo(e.target.value)}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  f.renaming = null;
                  say(f, null);
                  b?.view.focus();
                }
              }}
            />
          </label>
          <button className="page-btn solid" type="submit">
            Rename
          </button>
        </form>
      )}
    </>
  );
}

/** The sidebar's changed files (uncommitted, or the branch's), each opening with its diff. */
function ChangeList({ f }: { f: Files }) {
  const mode = diffModeOf(f.side)!;
  const c = changesNow(f, mode);
  const data = c.data as WorkspaceChanges | GithubUnavailable | undefined;
  const files = data && !("available" in data) ? data.files : [];
  const adds = files.reduce((n, x) => n + x.additions, 0);
  const dels = files.reduce((n, x) => n + x.deletions, 0);
  const b = activeBuffer(f);
  return (
    <div className="files-list">
      <div className="files-list-head">
        <span>
          {data && !("available" in data)
            ? `${files.length} file${files.length === 1 ? "" : "s"}${files.length ? ` · +${adds} −${dels}` : ""}${mode === "all" && data.baseRef ? ` · against ${data.baseRef}` : ""}`
            : c.loading || !c.at
              ? "Reading changes…"
              : ""}
        </span>
        <button className="files-icon-btn" aria-label="Read the changes again" data-tip="Read the changes again" onClick={() => void loadChanges(f, mode, 0)}>
          <RefreshCw size={12} aria-hidden="true" className={c.loading ? "spin" : undefined} />
        </button>
      </div>
      {data && "available" in data && <p className="files-list-note">{data.reason}</p>}
      {c.error && !data && <p className="files-list-note">{c.error}</p>}
      {data && !("available" in data) && !files.length && (
        <p className="files-list-note">{mode === "uncommitted" ? "Nothing uncommitted." : `No changes against ${data.baseRef ?? "the base"}.`}</p>
      )}
      <ul role="listbox" aria-label={SIDE_LABEL[f.side]}>
        {files.map((x) => (
          <ChangeRow key={x.path} f={f} file={x} mode={mode} current={b?.key === x.path} />
        ))}
      </ul>
    </div>
  );
}
function ChangeRow({ f, file, mode, current }: { f: Files; file: DiffFile; mode: "uncommitted" | "all"; current: boolean }) {
  const kind = file.isNew ? "A" : file.isDeleted ? "D" : file.oldPath && file.oldPath !== file.path ? "R" : "M";
  return (
    <li role="option" aria-selected={current}>
      <button
        className="files-row"
        data-kind={kind}
        title={file.oldPath && file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}
        disabled={file.isDeleted}
        onClick={() => void openFile(f, file.path, { diff: mode })}
      >
        <span className="files-kind" aria-label={{ A: "added", D: "deleted", R: "renamed", M: "modified" }[kind]}>
          {kind}
        </span>
        <span className="files-row-name">{name(file.path)}</span>
        <span className="files-row-dir">{dir(file.path)}</span>
        <span className="files-row-count">
          {file.additions > 0 && <span className="add">+{file.additions}</span>}
          {file.deletions > 0 && <span className="del">−{file.deletions}</span>}
        </span>
      </button>
    </li>
  );
}

/** Every file, a folder at a time. */
function Tree({ f }: { f: Files }) {
  const store = `files:tree:${f.ws.host ?? ""}|${f.ws.id}`;
  const [open, setOpen] = useState<Set<string>>(() => new Set(readStore<string[]>(store, [])));
  const toggle = (d: string) => {
    const next = new Set(open);
    if (next.has(d)) next.delete(d);
    else next.add(d);
    setOpen(next);
    writeStore(store, [...next].slice(0, 200));
  };
  return (
    <div className="files-list files-tree" role="tree" aria-label="All files">
      <TreeFolder f={f} dirPath="" depth={0} open={open} toggle={toggle} />
    </div>
  );
}
function TreeFolder({ f, dirPath, depth, open, toggle }: { f: Files; dirPath: string; depth: number; open: Set<string>; toggle: (d: string) => void }) {
  const ws = { id: f.ws.id, ...(f.ws.host ? { host: f.ws.host } : {}) };
  const path = treePath(ws, dirPath);
  useEffect(() => {
    ensure(path, 5_000);
  }, [path]);
  const data = useFilesData(path) as FileTree | undefined;
  const b = activeBuffer(f);
  if (!data)
    return (
      <p className="files-list-note" style={{ paddingLeft: 12 + depth * 12 }}>
        Reading…
      </p>
    );
  return (
    <>
      {data.entries.map((e) =>
        e.kind === "directory" ? (
          <div key={e.path} role="treeitem" aria-expanded={open.has(e.path)}>
            <button className="files-row tree" data-ignored={e.ignored || undefined} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => toggle(e.path)}>
              {open.has(e.path) ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
              {open.has(e.path) ? <FolderOpen size={13} aria-hidden="true" /> : <Folder size={13} aria-hidden="true" />}
              <span className="files-row-name">{e.name}</span>
            </button>
            {open.has(e.path) && <TreeFolder f={f} dirPath={e.path} depth={depth + 1} open={open} toggle={toggle} />}
          </div>
        ) : (
          <div key={e.path} role="treeitem" aria-selected={b?.key === e.path}>
            <button className="files-row tree" data-ignored={e.ignored || undefined} style={{ paddingLeft: 20 + depth * 12 }} onClick={() => void openFile(f, e.path, { diff: null })}>
              <FileText size={13} aria-hidden="true" />
              <span className="files-row-name">{e.name}</span>
            </button>
          </div>
        ),
      )}
    </>
  );
}

/**
 * Usages of the symbol (gr, ⇧F12) in a picker over the editor, as Telescope's (the user's ask): the field narrows them by
 * path, line or text; ↑/↓ (⌃N/⌃P, ⌃J/⌃K) step; a few lines around the one picked show beneath; Enter or a click opens it
 * and closes the picker, Esc closes it where you were. It has the keyboard while open, so Esc is its, not vim's.
 */
function UsagesPicker({ f }: { f: Files }) {
  const u = f.usages!;
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const shown = useMemo(() => filterUsages(u.items, q), [u.items, q]);
  const files = new Set(u.items.map((x) => x.path)).size;
  useEffect(() => {
    setAt(0);
  }, [q, u.at]);
  useEffect(() => {
    const raf = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [u.at]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const pick = (item: Usage) => void pickUsage(f, item);
  const picked = shown[at];
  const keys = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    const down = e.key === "ArrowDown" || (e.ctrlKey && (e.key === "n" || e.key === "j"));
    const up = e.key === "ArrowUp" || (e.ctrlKey && (e.key === "p" || e.key === "k"));
    if (e.key === "Escape") (e.preventDefault(), closeUsages(f));
    else if (down) (e.preventDefault(), setAt((n) => Math.min(n + 1, shown.length - 1)));
    else if (up) (e.preventDefault(), setAt((n) => Math.max(n - 1, 0)));
    else if (e.key === "PageDown") (e.preventDefault(), setAt((n) => Math.min(n + 10, shown.length - 1)));
    else if (e.key === "PageUp") (e.preventDefault(), setAt((n) => Math.max(n - 10, 0)));
    else if (e.key === "Enter" && picked) (e.preventDefault(), pick(picked));
  };
  const head = u.loading
    ? `Finding usages of ${u.symbol}…`
    : u.error
      ? u.error
      : `${u.items.length} usage${u.items.length === 1 ? "" : "s"} of ${u.symbol}${files > 1 ? ` in ${files} files` : ""}`;
  return (
    <div className="files-quick-scrim" onMouseDown={(e) => e.target === e.currentTarget && closeUsages(f)}>
      <div className="files-quick files-usages-picker" role="dialog" aria-label={`Usages of ${u.symbol}`}>
        <input
          ref={input}
          value={q}
          spellCheck={false}
          placeholder={u.loading ? head : `Narrow ${u.items.length} usage${u.items.length === 1 ? "" : "s"} of ${u.symbol} by file or text…`}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={keys}
        />
        <p className="files-usages-head">
          <span>{head}</span>
          {q && !u.loading && <span>{shown.length} shown</span>}
        </p>
        <ul ref={list} role="listbox" aria-label="Usages">
          {shown.map((item, i) => (
            <li
              key={`${item.path}:${item.line}:${item.from}:${i}`}
              data-i={i}
              role="option"
              aria-selected={i === at}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(e) => (e.preventDefault(), pick(item))}
            >
              <span className="files-usage-where">
                <span className="files-quick-name">{name(item.path)}</span>
                <span className="files-usage-line">:{item.line}</span>
                {item.outside && <span className="files-badge">outside</span>}
              </span>
              <span className="files-usage-text">
                {item.text.slice(Math.max(0, item.from - 60), item.from).trimStart()}
                <strong>{item.text.slice(item.from, item.to)}</strong>
                {item.text.slice(item.to, item.to + 160)}
              </span>
              <span className="files-quick-dir">{dir(item.path)}</span>
            </li>
          ))}
          {!u.loading && !u.error && !shown.length && <li className="files-quick-none">{q ? "No usage matches." : "No usages found."}</li>}
        </ul>
        {picked && (
          <pre className="files-usage-preview" aria-label={`${picked.path}, line ${picked.line}`}>
            {(picked.before ?? []).map((l, i) => (
              <span key={`b${i}`} className="files-usage-preview-line">
                <i>{picked.line - (picked.before ?? []).length + i}</i>
                {l}
              </span>
            ))}
            <span className="files-usage-preview-line current">
              <i>{picked.line}</i>
              {picked.text.slice(0, picked.from)}
              <strong>{picked.text.slice(picked.from, picked.to)}</strong>
              {picked.text.slice(picked.to)}
            </span>
            {(picked.after ?? []).map((l, i) => (
              <span key={`a${i}`} className="files-usage-preview-line">
                <i>{picked.line + i + 1}</i>
                {l}
              </span>
            ))}
          </pre>
        )}
      </div>
    </div>
  );
}

/** ⌘P: go to any file in the workspace, fuzzy by path; open files first while nothing is typed. */
function QuickOpen({ f, onClose }: { f: Files; onClose: () => void }) {
  const ws = { id: f.ws.id, ...(f.ws.host ? { host: f.ws.host } : {}) };
  const path = allPath(ws);
  useEffect(() => {
    ensure(path, 30_000);
  }, [path]);
  const list = useFilesData(path) as FileList | undefined;
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const box = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // Once drawn, and again a frame later: the editor's own key handling may take focus back as it opens.
  useEffect(() => {
    input.current?.focus();
    const raf = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);
  const shown = useMemo(() => {
    const files = (list?.files ?? []).map((p) => ({ path: p }));
    if (!q.trim()) {
      const open = f.buffers.filter((b) => !b.outside).map((b) => b.path);
      return [...open, ...files.map((x) => x.path).filter((p) => !open.includes(p))].slice(0, 200).map((p) => ({ path: p, marks: [] as number[] }));
    }
    // "path:12" goes to line 12.
    const bare = q.replace(/:\d+$/, "");
    // Best fits first (contiguous, at word starts, in the file's name; then shorter paths), as editors' ⌘P does.
    return rankFiles(files, bare).slice(0, 200);
  }, [list, q, f.buffers]);
  useEffect(() => {
    setAt(0);
  }, [q]);
  useEffect(() => {
    box.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);
  const go = (p: string) => {
    const line = Number(/:(\d+)$/.exec(q)?.[1]) || undefined;
    onClose();
    void openFile(f, p, { ...(line ? { line } : {}), diff: null });
  };
  return (
    <div className="files-quick-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="files-quick" role="dialog" aria-label="Go to file">
        <input
          ref={input}
          autoFocus
          placeholder={list ? `Go to file… (${list.files.length}${list.capped ? "+" : ""} files; name:line goes to a line)` : "Reading the workspace's files…"}
          value={q}
          spellCheck={false}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") (e.preventDefault(), onClose(), activeBuffer(f)?.view.focus());
            else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) (e.preventDefault(), setAt((n) => Math.min(n + 1, shown.length - 1)));
            else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) (e.preventDefault(), setAt((n) => Math.max(n - 1, 0)));
            else if (e.key === "Enter" && shown[at]) (e.preventDefault(), go(shown[at].path));
          }}
        />
        <ul ref={box} role="listbox" aria-label="Files">
          {shown.map((x, i) => (
            <li key={x.path} data-i={i} role="option" aria-selected={i === at} onMouseEnter={() => setAt(i)} onMouseDown={(e) => (e.preventDefault(), go(x.path))}>
              <span className="files-quick-name">
                <Marked text={name(x.path)} marks={x.marks} offset={x.path.length - name(x.path).length} />
              </span>
              <span className="files-quick-dir">
                <Marked text={dir(x.path)} marks={x.marks} offset={0} />
              </span>
            </li>
          ))}
          {list && !shown.length && <li className="files-quick-none">No file matches.</li>}
        </ul>
      </div>
    </div>
  );
}
/** The text with its matched characters marked, in runs (one element per run, not per character). */
function Marked({ text, marks, offset }: { text: string; marks: number[]; offset: number }) {
  if (!marks.length) return <>{text}</>;
  const set = new Set(marks.map((m) => m - offset));
  const runs: { marked: boolean; text: string }[] = [];
  [...text].forEach((ch, i) => {
    const marked = set.has(i);
    const last = runs.at(-1);
    if (last && last.marked === marked) last.text += ch;
    else runs.push({ marked, text: ch });
  });
  return <>{runs.map((r, i) => (r.marked ? <mark key={i}>{r.text}</mark> : <span key={i}>{r.text}</span>))}</>;
}
