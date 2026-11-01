import type { DiffFile, DiffLine, ReviewThread } from "./types";

/**
 * A file's diff as the rows the view draws, unified (one column) or split
 * (old on the left, new on the right, a hunk's removals beside its additions).
 * Each line carries its numbers in the old and new file, and the place a
 * comment on it anchors to: RIGHT at its new number (added and unchanged
 * lines), LEFT at its old number (removed lines; and the left side of a split).
 */
export type Side = "LEFT" | "RIGHT";
export type Anchor = { side: Side; line: number };
export type Cell = { type: "context" | "add" | "remove"; line: DiffLine; old: number | null; new: number | null; anchor: Anchor };

export type UnifiedRow = { kind: "hunk"; header: string; key: string } | ({ kind: "line"; key: string } & Cell);
export type SplitRow =
  | { kind: "hunk"; header: string; key: string }
  | { kind: "pair"; key: string; left?: Cell; right?: Cell };

export const anchorKey = (a: Anchor) => `${a.side}:${a.line}`;

/** Each hunk's lines with their numbers; a hunk's header line comes first. */
function* cells(file: DiffFile): Generator<{ hunk: number; header?: string; cell?: Cell }> {
  for (const [h, hunk] of file.hunks.entries()) {
    let old = hunk.oldStart;
    let neu = hunk.newStart;
    // The hunk's own header line, else one made from its numbers; yielded before its first line.
    let header: string | undefined =
      hunk.lines[0]?.type === "header"
        ? hunk.lines[0].content
        : `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;
    for (const line of hunk.lines) {
      if (line.type === "header") continue;
      if (header !== undefined) {
        yield { hunk: h, header };
        header = undefined;
      }
      if (line.type === "add") {
        yield { hunk: h, cell: { type: "add", line, old: null, new: neu, anchor: { side: "RIGHT", line: neu } } };
        neu++;
      } else if (line.type === "remove") {
        yield { hunk: h, cell: { type: "remove", line, old, new: null, anchor: { side: "LEFT", line: old } } };
        old++;
      } else {
        yield { hunk: h, cell: { type: "context", line, old, new: neu, anchor: { side: "RIGHT", line: neu } } };
        old++;
        neu++;
      }
    }
    if (header !== undefined) yield { hunk: h, header };
  }
}

export function unifiedRows(file: DiffFile): UnifiedRow[] {
  const rows: UnifiedRow[] = [];
  for (const { hunk, header, cell } of cells(file)) {
    if (header !== undefined) rows.push({ kind: "hunk", header, key: `h${hunk}` });
    else if (cell) rows.push({ kind: "line", key: `${hunk}:${cell.old ?? ""}:${cell.new ?? ""}`, ...cell });
  }
  return rows;
}

/** The left side's copy of an unchanged line: anchored on the old file. */
const leftOf = (c: Cell): Cell => (c.type === "context" && c.old !== null ? { ...c, anchor: { side: "LEFT", line: c.old } } : c);

export function splitRows(file: DiffFile): SplitRow[] {
  const rows: SplitRow[] = [];
  let removes: Cell[] = [];
  let adds: Cell[] = [];
  let hunkAt = 0;
  const flush = () => {
    for (let i = 0; i < Math.max(removes.length, adds.length); i++) {
      const left = removes[i];
      const right = adds[i];
      rows.push({
        kind: "pair",
        key: `${hunkAt}:${left?.old ?? ""}:${right?.new ?? ""}`,
        ...(left ? { left } : {}),
        ...(right ? { right } : {}),
      });
    }
    removes = [];
    adds = [];
  };
  for (const { hunk, header, cell } of cells(file)) {
    if (header !== undefined) {
      flush();
      hunkAt = hunk;
      rows.push({ kind: "hunk", header, key: `h${hunk}` });
      continue;
    }
    if (!cell) continue;
    if (cell.type === "remove") {
      // Removals after additions start a new block.
      if (adds.length) flush();
      removes.push(cell);
    } else if (cell.type === "add") adds.push(cell);
    else {
      flush();
      rows.push({ kind: "pair", key: `${hunk}:${cell.old}:${cell.new}`, left: leftOf(cell), right: cell });
    }
  }
  flush();
  return rows;
}

/** The anchors a file's diff shows (where a thread or draft can sit). */
export function anchorsOf(file: DiffFile): Set<string> {
  const keys = new Set<string>();
  for (const { cell } of cells(file)) {
    if (!cell) continue;
    keys.add(anchorKey(cell.anchor));
    if (cell.type === "context" && cell.old !== null) keys.add(anchorKey({ side: "LEFT", line: cell.old }));
  }
  return keys;
}

/** The threads of a file that sit on a line it shows, by anchor; the rest (outdated, or off the diff) apart. */
export function placeThreads(file: DiffFile, threads: ReviewThread[]) {
  const anchors = anchorsOf(file);
  const placed = new Map<string, ReviewThread[]>();
  const apart: ReviewThread[] = [];
  for (const t of threads) {
    if (t.path !== file.path) continue;
    const key = t.line !== null ? anchorKey({ side: t.side, line: t.line }) : "";
    if (t.line !== null && !t.isOutdated && anchors.has(key)) placed.set(key, [...(placed.get(key) ?? []), t]);
    else apart.push(t);
  }
  return { placed, apart };
}

/** The lines a row shows, in a file's lines-changed count (for collapsing big files). */
export const lineCount = (file: DiffFile) => file.hunks.reduce((n, h) => n + h.lines.length, 0);

/** The directory a path is in ("" at the root), and its name. */
export function splitPath(path: string): { dir: string; name: string } {
  const at = path.lastIndexOf("/");
  return at < 0 ? { dir: "", name: path } : { dir: path.slice(0, at), name: path.slice(at + 1) };
}

/** Files grouped by directory, directories in order, for the file list. */
export function byDirectory<T extends { path: string }>(files: T[]): { dir: string; files: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const f of files) {
    const { dir } = splitPath(f.path);
    groups.set(dir, [...(groups.get(dir) ?? []), f]);
  }
  return [...groups.entries()].sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b))).map(([dir, files]) => ({ dir, files }));
}
