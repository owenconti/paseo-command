/**
 * The Files page's tabs, as an editor's: pure, so the tests run it. A single
 * click opens a preview tab (one at most; the next preview takes its place),
 * double-clicking or using it pins it. Closing one remembers it for ⇧⌘T.
 * Each tab keeps where it was scrolled to, and, opened in the user's editor
 * (Settings → Files), its editor's daemon terminal: `editor`, until the editor
 * quits (`exited`, the viewer showing with Reopen in editor) or the tab closes;
 * `viewer` while its View / Editor toggle shows the built-in viewer instead.
 */
export type FileTab = { path: string; preview?: true; scroll?: number; editor?: string; exited?: true; viewer?: true };
export type TabsState = {
  tabs: FileTab[];
  /** The tab shown. */
  active?: string;
  /** Closed tabs' paths, newest last (⇧⌘T). */
  closed: string[];
};

export const NO_TABS: TabsState = { tabs: [], closed: [] };
/** At most this many tabs are kept (the oldest pinned ones beyond it are dropped, the shown one never). */
export const MAX_TABS = 60;
export const MAX_CLOSED = 20;

/** Opens `path`: shown if open (pinned when asked), else a preview in the preview's place, or a pinned tab after the shown one. */
export function openTab(s: TabsState, path: string, pin = false): TabsState {
  const at = s.tabs.findIndex((t) => t.path === path);
  if (at >= 0) {
    const tab = s.tabs[at]!;
    const tabs = pin && tab.preview ? s.tabs.map((t, i) => (i === at ? withoutPreview(t) : t)) : s.tabs;
    return { ...s, tabs, active: path };
  }
  const tab: FileTab = pin ? { path } : { path, preview: true };
  const preview = s.tabs.findIndex((t) => t.preview);
  let tabs: FileTab[];
  if (!pin && preview >= 0) tabs = s.tabs.map((t, i) => (i === preview ? tab : t));
  else {
    const after = s.active ? s.tabs.findIndex((t) => t.path === s.active) : -1;
    const insert = after >= 0 ? after + 1 : s.tabs.length;
    tabs = [...s.tabs.slice(0, insert), tab, ...s.tabs.slice(insert)];
  }
  return { ...s, tabs: trim(tabs, path), active: path, closed: s.closed.filter((p) => p !== path) };
}

/** Keeps the tab: no longer a preview. */
export function pinTab(s: TabsState, path: string): TabsState {
  const tab = s.tabs.find((t) => t.path === path);
  if (!tab?.preview) return s;
  return { ...s, tabs: s.tabs.map((t) => (t.path === path ? withoutPreview(t) : t)) };
}

/** Closes a tab; if it was shown, the one to its right shows, else the one to its left. */
export function closeTab(s: TabsState, path: string): TabsState {
  const at = s.tabs.findIndex((t) => t.path === path);
  if (at < 0) return s;
  const tabs = s.tabs.filter((_, i) => i !== at);
  const active = s.active === path ? (tabs[at] ?? tabs[at - 1])?.path : s.active;
  return { tabs, ...(active ? { active } : {}), closed: remember(s.closed, [path]) };
}

/** Closes every tab but `path`, which shows. */
export function closeOtherTabs(s: TabsState, path: string): TabsState {
  const keep = s.tabs.find((t) => t.path === path);
  if (!keep) return s;
  return { tabs: [keep], active: path, closed: remember(s.closed, s.tabs.filter((t) => t !== keep).map((t) => t.path)) };
}

/** ⇧⌘T: the last closed tab that isn't open again, pinned. */
export function reopenTab(s: TabsState): TabsState {
  const closed = [...s.closed];
  while (closed.length) {
    const path = closed.pop()!;
    if (!s.tabs.some((t) => t.path === path)) return { ...openTab({ ...s, closed }, path, true), closed };
  }
  return { ...s, closed };
}

/** Moves a tab to `to` (its index once moved). */
export function moveTab(s: TabsState, path: string, to: number): TabsState {
  const at = s.tabs.findIndex((t) => t.path === path);
  if (at < 0) return s;
  const rest = s.tabs.filter((_, i) => i !== at);
  const i = Math.max(0, Math.min(rest.length, to));
  if (i === at) return s;
  return { ...s, tabs: [...rest.slice(0, i), s.tabs[at]!, ...rest.slice(i)] };
}

/** ⌃Tab / ⌃⇧Tab: the next or previous tab, wrapping. */
export function stepTab(s: TabsState, by: 1 | -1): TabsState {
  if (s.tabs.length < 2) return s;
  const at = s.tabs.findIndex((t) => t.path === s.active);
  const next = s.tabs[(at < 0 ? 0 : at + by + s.tabs.length) % s.tabs.length]!;
  return { ...s, active: next.path };
}

/** The tab opened in the editor: its terminal, the tab kept (no longer a preview), the editor showing. */
export function setTabEditor(s: TabsState, path: string, terminal: string): TabsState {
  if (!s.tabs.some((t) => t.path === path)) return s;
  return {
    ...s,
    tabs: s.tabs.map((t) => {
      if (t.path !== path) return t;
      const { preview: _, exited: __, viewer: ___, ...rest } = t;
      return { ...rest, editor: terminal };
    }),
  };
}

/** A terminal's editor quit (or its terminal is gone): its tab shows the viewer, offering to reopen it. */
export function tabEditorExited(s: TabsState, terminal: string): TabsState {
  if (!s.tabs.some((t) => t.editor === terminal)) return s;
  return {
    ...s,
    tabs: s.tabs.map((t) => {
      if (t.editor !== terminal) return t;
      const { editor: _, viewer: __, ...rest } = t;
      return { ...rest, exited: true };
    }),
  };
}

/** The View / Editor toggle: the built-in viewer over the running editor, or the editor again. */
export function setTabViewer(s: TabsState, path: string, viewer: boolean): TabsState {
  const tab = s.tabs.find((t) => t.path === path);
  if (!tab || !!tab.viewer === viewer) return s;
  return { ...s, tabs: s.tabs.map((t) => (t !== tab ? t : viewer ? { ...t, viewer: true } : (({ viewer: _, ...rest }) => rest)(t))) };
}

/** The tabs' editor terminals still running. */
export const tabEditors = (s: TabsState) => s.tabs.flatMap((t) => (t.editor ? [t.editor] : []));

/** Where a tab was scrolled to. */
export function scrollTab(s: TabsState, path: string, top: number): TabsState {
  const scroll = Math.max(0, Math.round(top));
  const tab = s.tabs.find((t) => t.path === path);
  if (!tab || (tab.scroll ?? 0) === scroll) return s;
  return { ...s, tabs: s.tabs.map((t) => (t === tab ? { ...t, scroll } : t)) };
}

/**
 * Each tab's label: its file name, and where names clash, as much of its
 * folder as tells them apart ("src/index.ts" and "test/index.ts" read "index.ts · src"
 * and "index.ts · test"; the shortest distinct trailing part of the folder).
 */
export function tabLabels(paths: string[]): Map<string, { name: string; dir?: string }> {
  const out = new Map<string, { name: string; dir?: string }>();
  const byName = new Map<string, string[]>();
  for (const p of paths) {
    const name = p.slice(p.lastIndexOf("/") + 1);
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  for (const [name, group] of byName) {
    if (group.length === 1) {
      out.set(group[0]!, { name });
      continue;
    }
    const dirs = group.map((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")).split("/") : []));
    const most = Math.max(...dirs.map((d) => d.length));
    for (const [i, p] of group.entries()) {
      const d = dirs[i]!;
      // The fewest trailing folders that no other clashing path ends with.
      let dir = d.join("/");
      for (let n = 1; n <= most; n++) {
        const tail = d.slice(-n).join("/");
        if (dirs.every((o, j) => j === i || o.slice(-n).join("/") !== tail)) {
          dir = tail;
          break;
        }
      }
      out.set(p, { name, dir: dir || "/" });
    }
  }
  return out;
}

/** A kept state, read back from storage: anything odd dropped. */
export function readTabs(raw: unknown, legacyFile?: string): TabsState {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const seen = new Set<string>();
  const tabs: FileTab[] = [];
  for (const t of Array.isArray(r.tabs) ? r.tabs : []) {
    const path = t && typeof t === "object" ? (t as FileTab).path : undefined;
    if (typeof path !== "string" || !path || seen.has(path)) continue;
    seen.add(path);
    const { scroll, editor, exited, viewer } = t as FileTab;
    const hasEditor = typeof editor === "string" && !!editor && editor.length <= 200;
    tabs.push({
      path,
      ...((t as FileTab).preview === true && !hasEditor && !tabs.some((o) => o.preview) ? { preview: true as const } : {}),
      ...(typeof scroll === "number" && Number.isFinite(scroll) && scroll > 0 ? { scroll: Math.round(scroll) } : {}),
      ...(hasEditor ? { editor } : exited === true ? { exited: true as const } : {}),
      ...(hasEditor && viewer === true ? { viewer: true as const } : {}),
    });
  }
  // Before tabs, a workspace kept one open file.
  if (!tabs.length && legacyFile) tabs.push({ path: legacyFile });
  const activeRaw = typeof r.active === "string" ? r.active : legacyFile;
  const active = tabs.some((t) => t.path === activeRaw) ? activeRaw : tabs[0]?.path;
  const closed = Array.isArray(r.closed) ? r.closed.filter((p): p is string => typeof p === "string" && !!p).slice(-MAX_CLOSED) : [];
  return { tabs: tabs.slice(0, MAX_TABS), ...(active ? { active } : {}), closed };
}

const withoutPreview = ({ preview: _, ...t }: FileTab): FileTab => t;
const remember = (closed: string[], paths: string[]) => [...closed.filter((p) => !paths.includes(p)), ...paths].slice(-MAX_CLOSED);
/** Past the cap, the leftmost tabs (never `keep`) go. */
function trim(tabs: FileTab[], keep: string): FileTab[] {
  let out = tabs;
  while (out.length > MAX_TABS) {
    const drop = out.findIndex((t) => t.path !== keep);
    out = out.filter((_, i) => i !== drop);
  }
  return out;
}
