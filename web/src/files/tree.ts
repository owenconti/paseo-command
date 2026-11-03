import { fuzzyPath } from "../github/diffSearch";
import type { FileEntry } from "./types";

/**
 * The Files page's tree, as rows to draw: the directories opened so far
 * (each listed when first opened), or, while "Filter files…" has words, the
 * files whose paths fit them with their directories. Pure, so the tests run it.
 */

/** One row of the tree. `marks`: the characters of its name the filter matched. */
export type TreeRow = {
  path: string;
  name: string;
  kind: "file" | "directory";
  depth: number;
  /** Ignored by git (or under an ignored directory, or `.git`). */
  ignored: boolean;
  /** A directory shown open. */
  open?: boolean;
  /** An open directory whose entries are still being read. */
  loading?: boolean;
  /** An open directory that couldn't be read. */
  error?: string;
  size?: number;
  marks?: number[];
};

/** A directory's entries as read (undefined while unread), or why it couldn't be. */
export type Listing = FileEntry[] | { error: string } | undefined;

/** The tree's rows, depth first: each open directory's entries under it; ignored ones only when shown. */
export function treeRows(listingOf: (dir: string) => Listing, open: ReadonlySet<string>, showIgnored: boolean): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number, underIgnored: boolean, seen: Set<string>) => {
    const listed = listingOf(dir);
    if (!Array.isArray(listed)) return;
    for (const e of listed) {
      const ignored = underIgnored || !!e.ignored;
      if (ignored && !showIgnored) continue;
      if (e.kind === "file") {
        rows.push({ path: e.path, name: e.name, kind: "file", depth, ignored, size: e.size });
        continue;
      }
      const isOpen = open.has(e.path) && !seen.has(e.path);
      const inside = isOpen ? listingOf(e.path) : undefined;
      rows.push({
        path: e.path,
        name: e.name,
        kind: "directory",
        depth,
        ignored,
        ...(isOpen ? { open: true } : {}),
        ...(isOpen && inside === undefined ? { loading: true } : {}),
        ...(isOpen && inside && !Array.isArray(inside) ? { error: inside.error } : {}),
      });
      if (isOpen) walk(e.path, depth + 1, ignored, new Set(seen).add(e.path));
    }
  };
  walk("", 0, false, new Set());
  return rows;
}

/** Whether the query's characters (spaces aside) appear in order in the path, ignoring case: a cheap test before scoring. */
function inOrder(q: string, path: string): boolean {
  let at = 0;
  const p = path.toLowerCase();
  for (const c of q) {
    at = p.indexOf(c, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

export type PathHit = { path: string; score: number; marks: number[] };

/** The paths that fit the query (fuzzy, as the diff's file filter), each scored, in the given order. */
export function matchPaths(paths: readonly string[], query: string): PathHit[] {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return [];
  const out: PathHit[] = [];
  for (const path of paths) {
    if (!inOrder(q, path)) continue;
    const hit = fuzzyPath(q, path);
    if (hit) out.push({ path, score: hit.score, marks: hit.marks });
  }
  return out;
}

/** Quick-open's list: the best fits first (shorter paths ahead of equal scores), at most `limit`. */
export function rankPaths(paths: readonly string[], query: string, limit = 50): PathHit[] {
  return matchPaths(paths, query)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || (a.path < b.path ? -1 : 1))
    .slice(0, limit);
}

const nameOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }) || (a < b ? -1 : 1);

/**
 * The filter's tree: the files that fit (at most `limit`) under their
 * directories, all open, directories first then by name at each level; each
 * row's name marked where the query matched. `best` is the best fit's path.
 */
export function filterRows(paths: readonly string[], query: string, limit = 1000): { rows: TreeRow[]; count: number; best?: string } {
  const hits = matchPaths(paths, query);
  let best: PathHit | undefined;
  for (const h of hits) if (!best || h.score > best.score) best = h;
  type Node = { dirs: Map<string, Node>; files: PathHit[]; marks: Set<number>; path: string };
  const root: Node = { dirs: new Map(), files: [], marks: new Set(), path: "" };
  for (const h of hits.slice(0, limit)) {
    const parts = h.path.split("/");
    let node = root;
    let at = 0;
    for (const part of parts.slice(0, -1)) {
      let next = node.dirs.get(part);
      if (!next) node.dirs.set(part, (next = { dirs: new Map(), files: [], marks: new Set(), path: node.path ? `${node.path}/${part}` : part }));
      // The directory's own characters this file matched, from its name's start.
      for (const m of h.marks) if (m >= at && m < at + part.length) next.marks.add(m - at);
      at += part.length + 1;
      node = next;
    }
    node.files.push(h);
  }
  const rows: TreeRow[] = [];
  const walk = (node: Node, depth: number) => {
    for (const name of [...node.dirs.keys()].sort(nameOrder)) {
      const d = node.dirs.get(name)!;
      rows.push({ path: d.path, name, kind: "directory", depth, ignored: false, open: true, marks: [...d.marks].sort((a, b) => a - b) });
      walk(d, depth + 1);
    }
    for (const f of [...node.files].sort((a, b) => nameOrder(a.path, b.path))) {
      const start = f.path.lastIndexOf("/") + 1;
      rows.push({
        path: f.path,
        name: f.path.slice(start),
        kind: "file",
        depth,
        ignored: false,
        marks: f.marks.filter((m) => m >= start).map((m) => m - start),
      });
    }
  };
  walk(root, 0);
  return { rows, count: hits.length, ...(best ? { best: best.path } : {}) };
}

/** A path's directories, outermost first (`a/b/c.ts` → `a`, `a/b`). */
export function parentsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** A size as people read it: 512 B, 3.4 KB, 1.2 MB. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
