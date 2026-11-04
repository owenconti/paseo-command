import { readStore, writeStore } from "../api";
import type { Side } from "./rows";
import type { DiffFile, Person, ReviewThread } from "./types";

/**
 * The diff sidebar's Comments list (`DiffView.tsx`): every thread on the
 * diff, grouped by file in the diff's order, as plain entries. On a PR,
 * GitHub's review threads and your pending review's drafts; on a workspace's
 * Changes, its pending comments (its drafts here).
 */

/** What the diff's sidebar shows: the changed files, or the comments on them. */
export type DiffSidebar = "files" | "comments";
/** Which diff it is: a PR's Files changed, or a workspace's Changes; each keeps its own choice. */
export type DiffKind = "pr" | "changes";

const sidebarKey = (kind: DiffKind) => `github:diffSidebar:${kind}`;
export const readDiffSidebar = (kind: DiffKind): DiffSidebar => (readStore<string>(sidebarKey(kind), "files") === "comments" ? "comments" : "files");
export const writeDiffSidebar = (kind: DiffKind, s: DiffSidebar) => writeStore(sidebarKey(kind), s);

export type NoteDraft = { id: string; path: string; side: Side; line: number; startLine?: number; body: string };

export type NoteEntry = {
  /** The thread's id or the draft's: the diff marks it `data-thread` or `data-draft`. */
  id: string;
  kind: "thread" | "draft";
  path: string;
  side: Side;
  /** Where it sits in the diff now (null: on the file, or off the diff). */
  line: number | null;
  /** "L12", "L10–14", "File": its line(s), where it was left when outdated. */
  where: string;
  /** Who wrote it (a draft is yours: null). */
  author: Person | null;
  /** The first comment's first words, as plain text. */
  text: string;
  /** Comments after the first. */
  replies: number;
  resolved: boolean;
  outdated: boolean;
  thread?: ReviewThread;
};

export type NoteGroup = { path: string; entries: NoteEntry[] };

/** Hidden behind "Show resolved": resolved and outdated entries. */
export const isDim = (e: Pick<NoteEntry, "resolved" | "outdated">) => e.resolved || e.outdated;

const span = (start: number | null | undefined, line: number) => (start != null && start !== line ? `L${start}–${line}` : `L${line}`);

export function threadWhere(t: ReviewThread): string {
  if (t.onFile) return "File";
  const line = !t.isOutdated && t.line !== null ? t.line : (t.originalLine ?? t.line);
  if (line == null) return "File";
  return span(!t.isOutdated && t.line !== null ? t.startLine : (t.originalStartLine ?? t.startLine), line);
}

/** A comment's Markdown as a line of plain text, cut at `max` characters. */
export function plainSnippet(md: string, max = 180): string {
  const s = md
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^\s*```.*$/gm, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>+|[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\*\*|__|~~|`/g, "")
    // Single-starred or underscored emphasis, not snake_case or a lone star.
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?=[^\w*]|$)/g, "$1$2")
    .replace(/(^|[^\w])_(?=\S)([^\n]*?\S)_(?=[^\w]|$)/g, "$1$2")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * The entries by file: the diff's files in its order (then any other file a
 * thread is on, by path), each file's entries by line (those off the diff
 * first, as the diff shows them above its lines), threads before drafts.
 */
export function noteGroups(
  files: readonly Pick<DiffFile, "path">[],
  threads: readonly ReviewThread[],
  drafts: readonly NoteDraft[],
  outdatedDrafts: readonly NoteDraft[] = [],
): NoteGroup[] {
  const byPath = new Map<string, NoteEntry[]>();
  const add = (e: NoteEntry) => {
    const list = byPath.get(e.path);
    if (list) list.push(e);
    else byPath.set(e.path, [e]);
  };
  for (const t of threads) {
    const first = t.comments[0];
    const total = Math.max(t.totalComments ?? 0, t.comments.length);
    add({
      id: t.id,
      kind: "thread",
      path: t.path,
      side: t.side,
      line: t.isOutdated || t.onFile ? null : t.line,
      where: threadWhere(t),
      author: first?.author ?? null,
      text: first ? plainSnippet(first.body) : "",
      replies: Math.max(0, total - 1),
      resolved: t.isResolved,
      outdated: t.isOutdated,
      thread: t,
    });
  }
  const draft = (d: NoteDraft, outdated: boolean): NoteEntry => ({
    id: d.id,
    kind: "draft",
    path: d.path,
    side: d.side,
    line: outdated ? null : d.line,
    where: span(d.startLine, d.line),
    author: null,
    text: plainSnippet(d.body),
    replies: 0,
    resolved: false,
    outdated,
  });
  for (const d of drafts) add(draft(d, false));
  for (const d of outdatedDrafts) add(draft(d, true));
  const order = new Map(files.map((f, i) => [f.path, i]));
  const paths = [...byPath.keys()].sort((a, b) => {
    const x = order.get(a);
    const y = order.get(b);
    if (x !== undefined && y !== undefined) return x - y;
    if (x !== undefined) return -1;
    if (y !== undefined) return 1;
    return a.localeCompare(b);
  });
  return paths.map((path) => ({
    path,
    entries: byPath
      .get(path)!
      .map((e, i) => ({ e, i }))
      .sort((a, b) => (a.e.line ?? -1) - (b.e.line ?? -1) || (a.e.kind === b.e.kind ? a.i - b.i : a.e.kind === "thread" ? -1 : 1))
      .map(({ e }) => e),
  }));
}

/** The groups with only the entries shown: dimmed ones only with Show resolved. */
export function shownGroups(groups: readonly NoteGroup[], showResolved: boolean): NoteGroup[] {
  if (showResolved) return groups as NoteGroup[];
  return groups.map((g) => ({ path: g.path, entries: g.entries.filter((e) => !isDim(e)) })).filter((g) => g.entries.length > 0);
}

/**
 * The entry a step goes to: the next (1) or previous (−1) after the one in
 * view, wrapping; with none in view, the first at or after the file in view
 * (stepping on), or the last before it (stepping back).
 */
export function stepNote(entries: readonly NoteEntry[], inView: string | undefined, by: 1 | -1, fileOrder: ReadonlyMap<string, number>, currentFile?: string): NoteEntry | undefined {
  const n = entries.length;
  if (!n) return undefined;
  const at = inView ? entries.findIndex((e) => e.id === inView) : -1;
  if (at >= 0) return entries[(at + by + n) % n];
  const here = currentFile !== undefined ? (fileOrder.get(currentFile) ?? 0) : 0;
  const rank = (e: NoteEntry) => fileOrder.get(e.path) ?? Number.MAX_SAFE_INTEGER;
  if (by > 0) return entries.find((e) => rank(e) >= here) ?? entries[0];
  for (let i = n - 1; i >= 0; i--) if (rank(entries[i]!) < here) return entries[i];
  return entries[n - 1];
}
