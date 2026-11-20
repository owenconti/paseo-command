/**
 * The Files tab's state, per workspace, kept for the page's life (stepping to another agent or tab and back loses
 * nothing, unsaved edits included): its open files (buffers, each a CodeMirror view kept while it's open), the one
 * shown, where you've been (back and forward, as go to definition and usages move you), the usages last found, and its
 * language servers (`lsp.ts`).
 *
 * A buffer is saved only over the version it read (`POST /api/files/write`); the shown one's version on disk is asked
 * every couple of seconds (`GET /api/files/version`), so an agent's edit reloads a buffer without unsaved edits and
 * marks one with them as changed on disk (Reload, or Keep mine). A buffer can show its diff against the base the
 * sidebar's view compares with (`baseText.ts`).
 */
import { LSPPlugin } from "@codemirror/lsp-client";
import { EditorSelection, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useSyncExternalStore } from "react";
import { api, errorMessage, readStore, writeStore } from "../api";
import type { FileRead, FileVersion, FileWrite } from "../files/types";
import type { DiffFile, GithubUnavailable, WorkspaceChanges } from "../github/types";
import { baseText } from "./baseText";
import {
  bufferState,
  clientExtensions,
  diffExtension,
  loadLanguage,
  lspExtensions,
  newParts,
  reconfigureTheme,
  reconfigureVim,
  setActions,
  setHover,
  type Parts,
} from "./editor";
import { LspConnection, type LspState } from "./lsp";
import { languageOf, placeOf, workspaceUri, type ServerGroup } from "./paths";
import { onVimSetting, vimSetting } from "./vimSetting";

export type FilesWorkspace = { id: string; host?: string; name: string; branch?: string };
/** What the sidebar lists: uncommitted changes, the branch's changes against its base, or every file. */
export type SideView = "uncommitted" | "branch" | "tree";
/** What a diff compares with: `HEAD` (uncommitted), or the branch's base (everything the branch changes). */
export type DiffMode = "uncommitted" | "all";
export const diffModeOf = (side: SideView): DiffMode | null => (side === "uncommitted" ? "uncommitted" : side === "branch" ? "all" : null);

type Saved = { text: string; modifiedAt: string; revision?: string };
export type Buffer = {
  /** Its workspace path, or `outside:<absolute path>` for a file outside the workspace (read only). */
  key: string;
  path: string;
  outside?: { uri: string; group: ServerGroup };
  view: EditorView;
  parts: Parts;
  /** What it was when read or last saved (null: outside the workspace, never saved). */
  saved: Saved | null;
  dirty: boolean;
  saving: boolean;
  /** The diff shown, and the base it's against. */
  diff: { mode: DiffMode; base: string } | null;
  /** Changed on disk while it had unsaved edits (or gone), and the version there then (Keep mine saves over it). */
  disk: "changed" | "missing" | null;
  diskVersion: { modifiedAt: string; revision?: string } | null;
  /** Something to say about it (its diff couldn't be lined up…). */
  note: string | null;
  lsp: { group: ServerGroup; id: string } | null;
  /** The URI its language server knows it by, once attached. */
  uri: string | null;
};
export type Usage = { key: string; path: string; outside?: { uri: string; group: ServerGroup }; line: number; from: number; to: number; text: string };
export type Usages = { symbol: string; loading: boolean; error?: string; items: Usage[]; at: number };
type Place = { key: string; pos: number };

export type Files = {
  ws: FilesWorkspace;
  buffers: Buffer[];
  active: string | null;
  back: Place[];
  forward: Place[];
  side: SideView;
  usages: Usages | null;
  renaming: { key: string; from: number; to: number; word: string } | null;
  closing: string | null;
  lsp: Map<ServerGroup, LspConnection>;
  host: HTMLElement | null;
  notice: string | null;
};

const MAX_BUFFERS = 24;
const MAX_HISTORY = 100;
const SIDE_KEY = "files:side";

// ── The store ────────────────────────────────────────────────────────────────
const all = new Map<string, Files>();
const listeners = new Set<() => void>();
let version = 0;
export const changed = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** Re-renders whenever anything in the Files tab changes. */
export const useFilesStore = () => useSyncExternalStore(subscribe, () => version, () => version);

const keyOf = (ws: { id: string; host?: string }) => `${ws.host ?? ""}|${ws.id}`;
const query = (ws: FilesWorkspace, extra: Record<string, string> = {}) =>
  new URLSearchParams({ workspace: ws.id, ...(ws.host ? { host: ws.host } : {}), ...extra }).toString();

export function filesOf(ws: FilesWorkspace): Files {
  const key = keyOf(ws);
  let f = all.get(key);
  if (!f) {
    f = { ws, buffers: [], active: null, back: [], forward: [], side: readStore<SideView>(SIDE_KEY, "branch"), usages: null, renaming: null, closing: null, lsp: new Map(), host: null, notice: null };
    all.set(key, f);
  }
  f.ws = ws;
  return f;
}
export const bufferOf = (f: Files, key: string | null) => (key ? f.buffers.find((b) => b.key === key) : undefined);
export const activeBuffer = (f: Files) => bufferOf(f, f.active);

export function setSide(f: Files, side: SideView) {
  f.side = side;
  writeStore(SIDE_KEY, side);
  changed();
}
export function say(f: Files, notice: string | null) {
  f.notice = notice;
  changed();
}

// ── Showing a buffer ─────────────────────────────────────────────────────────
/** Where the shown buffer's editor goes: the pane's box (null as the pane goes). */
export function mount(f: Files, host: HTMLElement | null) {
  f.host = host;
  place(f);
}
function place(f: Files, focus = false) {
  const b = activeBuffer(f);
  if (!f.host) return;
  if (!b) {
    f.host.replaceChildren();
    return;
  }
  if (f.host.firstChild !== b.view.dom) f.host.replaceChildren(b.view.dom);
  b.view.requestMeasure();
  // At once (keys typed next are its), and again once laid out.
  if (focus) b.view.focus();
  requestAnimationFrame(() => {
    b.view.dispatch({ effects: EditorView.scrollIntoView(b.view.state.selection.main.head, { y: "center" }) });
    if (focus) b.view.focus();
  });
}
function remember(f: Files) {
  const b = activeBuffer(f);
  if (!b) return;
  const pos = b.view.state.selection.main.head;
  const last = f.back[f.back.length - 1];
  if (last && last.key === b.key && Math.abs(last.pos - pos) < 1) return;
  f.back.push({ key: b.key, pos });
  if (f.back.length > MAX_HISTORY) f.back.shift();
  f.forward = [];
}
export function activate(f: Files, key: string, options: { focus?: boolean; remember?: boolean } = {}) {
  if (options.remember !== false && f.active && f.active !== key) remember(f);
  f.active = key;
  place(f, options.focus ?? true);
  changed();
}
/** Back (⌃O) and forward (⌃I) through where you've been. */
export function step(f: Files, dir: -1 | 1) {
  const from = dir < 0 ? f.back : f.forward;
  const to = dir < 0 ? f.forward : f.back;
  const cur = activeBuffer(f);
  let next: Place | undefined;
  while ((next = from.pop()) && !bufferOf(f, next.key));
  if (!next) return;
  if (cur) to.push({ key: cur.key, pos: cur.view.state.selection.main.head });
  f.active = next.key;
  const b = bufferOf(f, next.key)!;
  b.view.dispatch({ selection: { anchor: Math.min(next.pos, b.view.state.doc.length) }, scrollIntoView: true });
  place(f, true);
  changed();
}
const goTo = (b: Buffer, line?: number, col = 1) => {
  if (!line) return;
  const doc = b.view.state.doc;
  const l = doc.line(Math.max(1, Math.min(line, doc.lines)));
  b.view.dispatch({ selection: { anchor: Math.min(l.from + Math.max(0, col - 1), l.to) }, scrollIntoView: true });
};

// ── Opening ──────────────────────────────────────────────────────────────────
function makeBuffer(f: Files, key: string, path: string, text: string, saved: Saved | null, outside?: Buffer["outside"]): Buffer {
  const parts = newParts();
  const view = new EditorView({
    state: bufferState(text, parts, { vim: vimSetting(), readOnly: !!outside }),
    dispatch: (tr, v) => {
      v.update([tr]);
      if (tr.docChanged) {
        const b = bufferOf(f, key);
        if (!b) return;
        const dirty = !!b.saved && v.state.doc.toString() !== b.saved.text;
        if (dirty !== b.dirty) {
          b.dirty = dirty;
          changed();
        }
      }
    },
  });
  view.dom.classList.add("code-editor");
  // Esc and the pane's keys are the editor's while it has the keyboard: they never reach the page's own.
  view.dom.addEventListener("keydown", (e) => {
    if (!e.metaKey) e.stopPropagation();
  });
  const lang = languageOf(path);
  const b: Buffer = {
    key,
    path,
    ...(outside ? { outside } : {}),
    view,
    parts,
    saved,
    dirty: false,
    saving: false,
    diff: null,
    disk: null,
    diskVersion: null,
    note: null,
    lsp: outside ? { group: outside.group, id: lang?.lsp?.id ?? outside.group } : lang?.lsp ? { group: lang.lsp.group, id: lang.lsp.id } : null,
    uri: null,
  };
  setActions(view, {
    save: () => void save(f, b),
    saveAll: () => void saveAll(f),
    close: () => closeBuffer(f, b.key),
    open: (p) => void openPath(f, p),
    usages: () => void findUsages(f, b),
    rename: () => startRename(f, b),
    hover: () => void hoverAtCursor(b),
    back: () => step(f, -1),
    forward: () => step(f, 1),
    quickOpen: () => window.dispatchEvent(new CustomEvent(QUICK_OPEN_EVENT)),
    toggleDiff: () => void toggleDiff(f, b),
  });
  void loadLanguage(view, parts, path);
  f.buffers.push(b);
  // Past the most kept, the oldest unchanged buffer goes.
  if (f.buffers.length > MAX_BUFFERS) {
    const old = f.buffers.find((x) => !x.dirty && x.key !== key && x.key !== f.active);
    if (old) dropBuffer(f, old);
  }
  if (b.lsp) attachLsp(f, b);
  return b;
}

/** Opens a workspace file (or shows it if open), at a line; with `diff`, its diff against that base. */
export async function openFile(
  f: Files,
  path: string,
  options: { line?: number; col?: number; diff?: DiffMode | null; background?: boolean; remember?: boolean; focus?: boolean } = {},
): Promise<EditorView | null> {
  let b = bufferOf(f, path);
  if (!b) {
    let read: FileRead;
    try {
      read = await api<FileRead>(`files/read?${query(f.ws, { path, fresh: "1" })}`);
    } catch (e) {
      say(f, `${path}: ${errorMessage(e) || "couldn't be read"}`);
      return null;
    }
    if (!("text" in read)) {
      say(f, `${path} isn't shown here: ${read.refused === "large" ? "it's over 1 MB" : read.refused === "image" ? "it's an image" : "it isn't text"}.`);
      return null;
    }
    b = bufferOf(f, path) ?? makeBuffer(f, path, path, read.text, { text: read.text, modifiedAt: read.modifiedAt, ...(read.revision ? { revision: read.revision } : {}) });
  }
  if (!options.background) activate(f, b.key, { remember: options.remember ?? true, focus: options.focus ?? true });
  goTo(b, options.line, options.col);
  if (options.diff !== undefined && (options.diff ? b.diff?.mode !== options.diff : b.diff)) await setDiff(f, b, options.diff);
  changed();
  return b.view;
}

/** `:e <path>`: a workspace path (relative), opened. */
async function openPath(f: Files, raw: string) {
  const path = raw.replace(/^\.\//, "");
  if (path.startsWith("/") || path.split("/").includes("..")) return say(f, "Only the workspace's own files open here: give a path from its folder.");
  await openFile(f, path);
}

/** A file outside the workspace that its language server named (a library's types), read only. */
async function openOutside(f: Files, uri: string, abs: string, group: ServerGroup): Promise<EditorView | null> {
  const key = `outside:${abs}`;
  let b = bufferOf(f, key);
  if (!b) {
    const conn = f.lsp.get(group);
    if (!conn) return null;
    let text: string;
    try {
      text = await conn.read(uri);
    } catch (e) {
      say(f, `${abs}: ${errorMessage(e) || "couldn't be read"}`);
      return null;
    }
    b = bufferOf(f, key) ?? makeBuffer(f, key, abs, text, null, { uri, group });
  }
  activate(f, b.key);
  return b.view;
}

function dropBuffer(f: Files, b: Buffer) {
  f.buffers = f.buffers.filter((x) => x !== b);
  f.back = f.back.filter((p) => p.key !== b.key);
  f.forward = f.forward.filter((p) => p.key !== b.key);
  b.view.destroy();
}
/** Closes a buffer; one with unsaved edits asks first (`closing`, answered by the pane's banner). */
export function closeBuffer(f: Files, key: string, force = false) {
  const b = bufferOf(f, key);
  if (!b) return;
  if (b.dirty && !force) {
    f.closing = key;
    changed();
    return;
  }
  const at = f.buffers.indexOf(b);
  dropBuffer(f, b);
  f.closing = null;
  if (f.active === key) {
    const prev = [...f.back].reverse().find((p) => bufferOf(f, p.key));
    f.active = prev?.key ?? f.buffers[Math.min(at, f.buffers.length - 1)]?.key ?? null;
    place(f, true);
  }
  changed();
}

// ── Saving, and what's on disk ───────────────────────────────────────────────
export async function save(f: Files, b: Buffer, overwrite = false): Promise<boolean> {
  if (b.outside) {
    say(f, "Files outside the workspace are read only.");
    return false;
  }
  if (!b.saved || b.saving) return false;
  if (!b.dirty && !overwrite) return true;
  const text = b.view.state.doc.toString();
  b.saving = true;
  changed();
  try {
    const r = await api<FileWrite>("files/write", {
      workspace: f.ws.id,
      ...(f.ws.host ? { host: f.ws.host } : {}),
      path: b.path,
      text,
      modifiedAt: b.saved.modifiedAt,
      ...(b.saved.revision ? { revision: b.saved.revision } : {}),
    });
    if (r.status === "conflict") {
      b.disk = r.version.status === "missing" ? "missing" : "changed";
      b.diskVersion = r.version.status === "ready" ? { modifiedAt: r.version.modifiedAt, ...(r.version.revision ? { revision: r.version.revision } : {}) } : null;
      say(f, `${b.path} changed on disk since you opened it: reload it, or keep yours and save again.`);
      return false;
    }
    b.saved = { text, modifiedAt: r.modifiedAt, ...(r.revision ? { revision: r.revision } : {}) };
    b.dirty = b.view.state.doc.toString() !== text;
    b.disk = null;
    b.diskVersion = null;
    refreshChanges(f);
    return true;
  } catch (e) {
    say(f, `${b.path} wasn't saved: ${errorMessage(e) || "the host refused it"}`);
    return false;
  } finally {
    b.saving = false;
    changed();
  }
}
export async function saveAll(f: Files) {
  const dirty = f.buffers.filter((b) => b.dirty && !b.outside);
  const results = await Promise.all(dirty.map((b) => save(f, b)));
  const failed = results.filter((ok) => !ok).length;
  if (dirty.length && !failed) say(f, dirty.length === 1 ? `Saved ${dirty[0].path}.` : `Saved ${dirty.length} files.`);
}

/** Replaces a buffer's text with what's on disk, keeping where the cursor was (and its diff, unless `rediff` is false). */
export async function reload(f: Files, b: Buffer, rediff = true) {
  let read: FileRead;
  try {
    read = await api<FileRead>(`files/read?${query(f.ws, { path: b.path, fresh: "1" })}`);
  } catch (e) {
    say(f, `${b.path}: ${errorMessage(e) || "couldn't be read"}`);
    return;
  }
  if (!("text" in read)) return;
  const head = b.view.state.selection.main.head;
  b.saved = { text: read.text, modifiedAt: read.modifiedAt, ...(read.revision ? { revision: read.revision } : {}) };
  if (b.view.state.doc.toString() !== read.text)
    b.view.dispatch({ changes: { from: 0, to: b.view.state.doc.length, insert: read.text }, selection: EditorSelection.cursor(Math.min(head, read.text.length)), userEvent: "reload" });
  b.dirty = false;
  b.disk = null;
  b.diskVersion = null;
  if (rediff && b.diff) await setDiff(f, b, b.diff.mode);
  changed();
}
/** Keep mine: the next save overwrites the version on disk that was noticed (a newer one still refuses it). */
export function keepMine(_f: Files, b: Buffer) {
  if (b.diskVersion && b.saved) b.saved = { text: b.saved.text, ...b.diskVersion };
  b.disk = null;
  b.diskVersion = null;
  changed();
}

/** The shown buffer's version on disk, asked now: an agent's edit reloads it, or marks it (unsaved edits kept). */
export async function checkDisk(f: Files) {
  const b = activeBuffer(f);
  if (!b || b.outside || !b.saved || b.saving) return;
  const was = b.saved.modifiedAt;
  const v = await api<FileVersion>(`files/version?${query(f.ws, { path: b.path })}`).catch(() => null);
  if (!v || !b.saved || b.saving || b.saved.modifiedAt !== was) return;
  if (v.status === "missing") {
    if (b.disk !== "missing") {
      b.disk = "missing";
      changed();
    }
    return;
  }
  if (v.modifiedAt === b.saved.modifiedAt && (!v.revision || !b.saved.revision || v.revision === b.saved.revision)) return;
  if (b.dirty) {
    b.diskVersion = { modifiedAt: v.modifiedAt, ...(v.revision ? { revision: v.revision } : {}) };
    if (b.disk !== "changed") {
      b.disk = "changed";
      changed();
    }
  } else await reload(f, b);
}

// ── Diffs ────────────────────────────────────────────────────────────────────
type Changes = Record<DiffMode, { at: number; data?: WorkspaceChanges | GithubUnavailable; error?: string; loading?: Promise<void> }>;
const changesOf = new Map<string, Changes>();
const changesFor = (f: Files) => {
  const key = keyOf(f.ws);
  let c = changesOf.get(key);
  if (!c) changesOf.set(key, (c = { uncommitted: { at: 0 }, all: { at: 0 } }));
  return c;
};
/** The workspace's changes in that mode, asked again when older than `maxAgeMs`. */
export function loadChanges(f: Files, mode: DiffMode, maxAgeMs = 8_000): Promise<void> {
  const c = changesFor(f)[mode];
  if (c.loading) return c.loading;
  if (c.data && Date.now() - c.at < maxAgeMs) return Promise.resolve();
  c.loading = api<WorkspaceChanges | GithubUnavailable>(`changes?${query(f.ws, { mode })}`)
    .then(
      (data) => {
        c.data = data;
        c.error = undefined;
      },
      (e) => {
        c.error = errorMessage(e) || "The host couldn't diff this checkout.";
      },
    )
    .finally(() => {
      c.at = Date.now();
      c.loading = undefined;
      changed();
    });
  changed();
  return c.loading;
}
export const changesNow = (f: Files, mode: DiffMode) => changesFor(f)[mode];
/** After a save: the sidebar's changes are asked again. */
function refreshChanges(f: Files) {
  const mode = diffModeOf(f.side);
  if (mode) void loadChanges(f, mode, 0);
}

/** Shows (or hides, `null`) a buffer's diff against the mode's base. */
export async function setDiff(f: Files, b: Buffer, mode: DiffMode | null) {
  if (!mode || b.outside) {
    b.diff = null;
    b.note = null;
    b.view.dispatch({ effects: b.parts.diff.reconfigure([]) });
    changed();
    return;
  }
  // The diff and the text it's of, both fresh: the base is rebuilt from them.
  await loadChanges(f, mode, 0);
  const data = changesFor(f)[mode].data;
  if (!data || "available" in data) {
    b.note = data && "reason" in data ? data.reason : changesFor(f)[mode].error ?? "The host couldn't diff this checkout.";
    changed();
    return;
  }
  const file: DiffFile | undefined = data.files.find((x) => x.path === b.path);
  let base: string | null;
  if (!file) base = b.saved?.text ?? b.view.state.doc.toString();
  else {
    base = baseText(b.saved?.text ?? "", file);
    if (base === null && !b.dirty) {
      // The diff may be of a newer version than the buffer's: read the file again (without asking for its diff) and retry once.
      await reload(f, b, false);
      base = baseText(b.saved?.text ?? "", file);
    }
  }
  if (base === null) {
    b.note = file?.status === "too_large" ? "This file's diff is too large to show here." : file?.status === "binary" ? "The diff is of a binary file." : "Its diff no longer matches the file: save or reload it, then try again.";
    b.diff = null;
    b.view.dispatch({ effects: b.parts.diff.reconfigure([]) });
    changed();
    return;
  }
  b.diff = { mode, base };
  b.note = file ? null : `No changes in this file against ${mode === "uncommitted" ? "the last commit" : data.baseRef ?? "the base"}.`;
  b.view.dispatch({ effects: b.parts.diff.reconfigure(diffExtension(base)) });
  changed();
}
export async function toggleDiff(f: Files, b: Buffer) {
  await setDiff(f, b, b.diff ? null : diffModeOf(f.side) ?? "all");
}

// ── Language servers ─────────────────────────────────────────────────────────
export function lspStateOf(f: Files, group: ServerGroup | undefined): LspState | null {
  return group ? f.lsp.get(group)?.state ?? null : null;
}
function connectionFor(f: Files, group: ServerGroup): LspConnection {
  let conn = f.lsp.get(group);
  if (!conn || conn.state.phase === "ended") {
    conn?.close();
    const made: LspConnection = new LspConnection(f.ws, group, {
      changed: () => {
        if (made.state.phase === "ended") for (const b of f.buffers) if (b.lsp?.group === group && b.uri) detach(b);
        changed();
      },
      display: async (where) => {
        remember(f);
        if ("path" in where) return openFile(f, where.path, { remember: false });
        return openOutside(f, where.uri, where.outside, group);
      },
      extensions: clientExtensions,
    });
    conn = made;
    f.lsp.set(group, made);
  }
  return conn;
}
function attachLsp(f: Files, b: Buffer) {
  if (!b.lsp) return;
  const conn = connectionFor(f, b.lsp.group);
  conn.whenReady(() => {
    if (!conn.client || !conn.root || !bufferOf(f, b.key) || b.uri) return;
    b.uri = b.outside ? b.outside.uri : workspaceUri(conn.root, b.path);
    b.view.dispatch({ effects: b.parts.lsp.reconfigure(lspExtensions(conn.client, b.uri, b.lsp!.id)) });
    changed();
  });
}
function detach(b: Buffer) {
  b.uri = null;
  b.view.dispatch({ effects: b.parts.lsp.reconfigure([]) });
}
/** Start the group's server again (after it ended), for every buffer of it. */
export function restartLsp(f: Files, group: ServerGroup) {
  f.lsp.get(group)?.close();
  f.lsp.delete(group);
  for (const b of f.buffers) if (b.lsp?.group === group) attachLsp(f, b);
  changed();
}

const pluginOf = (b: Buffer) => LSPPlugin.get(b.view);
type LspRange = { start: { line: number; character: number }; end: { line: number; character: number } };
type Location = { uri: string; range: LspRange };

/** The text of a file the usages name: an open buffer's, else read (outside ones through the server). */
async function linesOf(f: Files, where: { path: string } | { outside: string; uri: string }, group: ServerGroup): Promise<Text | null> {
  const key = "path" in where ? where.path : `outside:${where.outside}`;
  const open = bufferOf(f, key);
  if (open) return open.view.state.doc;
  try {
    if ("path" in where) {
      const read = await api<FileRead>(`files/read?${query(f.ws, { path: where.path })}`);
      return "text" in read ? Text.of(read.text.split("\n")) : null;
    }
    const text = await f.lsp.get(group)?.read(where.uri);
    return typeof text === "string" ? Text.of(text.split("\n")) : null;
  } catch {
    return null;
  }
}

/** Usages (gr, ⇧F12): every reference to the symbol under the cursor, listed beside the editor. */
export async function findUsages(f: Files, b: Buffer) {
  const plugin = pluginOf(b);
  const conn = b.lsp ? f.lsp.get(b.lsp.group) : undefined;
  if (!plugin || !conn?.root || !b.lsp) return say(f, b.lsp ? "Its language server isn't ready yet." : "No language server knows this kind of file.");
  const head = b.view.state.selection.main.head;
  const word = b.view.state.wordAt(head);
  const symbol = word ? b.view.state.sliceDoc(word.from, word.to) : "this";
  const at = Date.now();
  f.usages = { symbol, loading: true, items: [], at };
  changed();
  plugin.client.sync();
  let locs: Location[] | null;
  try {
    locs = await plugin.client.request<unknown, Location[] | null>("textDocument/references", {
      textDocument: { uri: plugin.uri },
      position: plugin.toPosition(head),
      context: { includeDeclaration: true },
    });
  } catch (e) {
    if (f.usages?.at === at) f.usages = { symbol, loading: false, error: (e as { message?: string })?.message || "The language server didn't find them.", items: [], at };
    return changed();
  }
  const group = b.lsp.group;
  const root = conn.root;
  const items = await Promise.all(
    (locs ?? []).slice(0, 2_000).map(async (loc): Promise<Usage | null> => {
      const where = placeOf(root, loc.uri);
      if (!where) return null;
      const place = "path" in where ? where : { outside: where.outside, uri: loc.uri };
      const doc = await linesOf(f, place, group);
      const lineNo = loc.range.start.line + 1;
      const text = doc && lineNo <= doc.lines ? doc.line(lineNo).text : "";
      const from = loc.range.start.character;
      const to = loc.range.end.line === loc.range.start.line ? loc.range.end.character : text.length;
      return "path" in where
        ? { key: where.path, path: where.path, line: lineNo, from, to, text }
        : { key: `outside:${where.outside}`, path: where.outside, outside: { uri: loc.uri, group }, line: lineNo, from, to, text };
    }),
  );
  if (f.usages?.at !== at) return;
  const found = items.filter((x): x is Usage => !!x).sort((x, y) => (x.outside ? 1 : 0) - (y.outside ? 1 : 0) || x.path.localeCompare(y.path) || x.line - y.line);
  f.usages = { symbol, loading: false, items: found, at };
  changed();
}
/** Opens a usage at its place. */
export async function showUsage(f: Files, u: Usage) {
  remember(f);
  const view = u.outside ? await openOutside(f, u.outside.uri, u.path, u.outside.group) : await openFile(f, u.path, { remember: false });
  if (!view) return;
  const doc = view.state.doc;
  const line = doc.line(Math.min(u.line, doc.lines));
  // The cursor at it (a selection would put vim in visual mode).
  view.dispatch({ selection: { anchor: Math.min(line.from + u.from, line.to) }, scrollIntoView: true });
  view.focus();
}
export function closeUsages(f: Files) {
  f.usages = null;
  changed();
  activeBuffer(f)?.view.focus();
}

/** Rename (F2, <space>rn): asks the new name in the pane (`renaming`), then `rename`. */
export function startRename(f: Files, b: Buffer) {
  if (!pluginOf(b)) return say(f, b.lsp ? "Its language server isn't ready yet." : "No language server knows this kind of file.");
  if (b.outside) return say(f, "Files outside the workspace are read only.");
  const word = b.view.state.wordAt(b.view.state.selection.main.head);
  if (!word) return say(f, "Put the cursor on a name to rename it.");
  f.renaming = { key: b.key, from: word.from, to: word.to, word: b.view.state.sliceDoc(word.from, word.to) };
  changed();
}
type TextEdit = { range: LspRange; newText: string };
/** Renames the symbol everywhere its server says: each file opened (in the background) and edited, left unsaved. */
export async function rename(f: Files, name: string) {
  const r = f.renaming;
  f.renaming = null;
  changed();
  const b = r && bufferOf(f, r.key);
  const plugin = b && pluginOf(b);
  const conn = b?.lsp ? f.lsp.get(b.lsp.group) : undefined;
  if (!r || !b || !plugin || !conn?.root || !name.trim() || name === r.word) return b?.view.focus();
  plugin.client.sync();
  let edit: { changes?: Record<string, TextEdit[]>; documentChanges?: { textDocument?: { uri: string }; edits?: TextEdit[]; kind?: string }[] } | null;
  try {
    edit = await plugin.client.request("textDocument/rename", { textDocument: { uri: plugin.uri }, position: plugin.toPosition(r.from), newName: name.trim() });
  } catch (e) {
    say(f, `Rename failed: ${(e as { message?: string })?.message || "the language server refused it"}`);
    return;
  }
  const byUri: Record<string, TextEdit[]> = { ...(edit?.changes ?? {}) };
  for (const dc of edit?.documentChanges ?? []) if (dc.textDocument?.uri && dc.edits) byUri[dc.textDocument.uri] = [...(byUri[dc.textDocument.uri] ?? []), ...dc.edits];
  let files = 0;
  for (const [uri, edits] of Object.entries(byUri)) {
    const where = placeOf(conn.root, uri);
    if (!where || !("path" in where) || !edits.length) continue;
    const view = where.path === b.path ? b.view : await openFile(f, where.path, { background: true });
    if (!view) continue;
    const doc = view.state.doc;
    const pos = (p: { line: number; character: number }) => Math.min(doc.line(Math.min(p.line + 1, doc.lines)).from + p.character, doc.length);
    view.dispatch({ changes: edits.map((e) => ({ from: pos(e.range.start), to: pos(e.range.end), insert: e.newText })), userEvent: "rename" });
    files++;
  }
  say(f, files ? `Renamed ${r.word} to ${name.trim()} in ${files} file${files === 1 ? "" : "s"}. Not saved yet: :wa (or ⌘S each) saves them.` : "Nothing to rename there.");
  b.view.focus();
}

// ── Hover at the cursor (K) ──────────────────────────────────────────────────
async function hoverAtCursor(b: Buffer) {
  const plugin = pluginOf(b);
  if (!plugin) return;
  const pos = b.view.state.selection.main.head;
  plugin.client.sync();
  const result = await plugin.client
    .request<unknown, { contents: unknown } | null>("textDocument/hover", { textDocument: { uri: plugin.uri }, position: plugin.toPosition(pos) })
    .catch(() => null);
  if (!result?.contents || b.view.state.selection.main.head !== pos) return;
  const contents = result.contents as string | { kind?: string; value: string; language?: string } | (string | { language: string; value: string })[];
  const fence = (language: string, value: string) => plugin.docToHTML({ kind: "markdown", value: "```" + language + "\n" + value + "\n```" });
  const html = Array.isArray(contents)
    ? contents.map((c) => (typeof c === "string" ? plugin.docToHTML(c, "markdown") : fence(c.language, c.value))).join("<hr>")
    : typeof contents === "string"
      ? plugin.docToHTML(contents, "markdown")
      : "language" in contents && contents.language
        ? fence(contents.language, contents.value)
        : plugin.docToHTML(contents as { kind: "markdown" | "plaintext"; value: string });
  b.view.dispatch({
    effects: setHover.of({
      pos,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-lsp-hover-tooltip cm-lsp-documentation";
        dom.innerHTML = html;
        return { dom };
      },
    }),
  });
}

// ── Settings that follow ─────────────────────────────────────────────────────
// Settings → Files' vim switch, followed by every open buffer.
onVimSetting(() => {
  for (const f of all.values()) for (const b of f.buffers) reconfigureVim(b.view, b.parts, vimSetting());
});
let themeWatch: MutationObserver | null = null;
export function followTheme() {
  if (themeWatch) return;
  themeWatch = new MutationObserver(() => {
    for (const f of all.values()) for (const b of f.buffers) reconfigureTheme(b.view, b.parts);
  });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

/** Unsaved edits anywhere in the Files tab. */
export const anyDirty = () => [...all.values()].some((f) => f.buffers.some((b) => b.dirty));

export const QUICK_OPEN_EVENT = "paseo:files-quick-open";
