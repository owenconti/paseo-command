import type { DiffFile, DiffLine, ReviewThread } from "./types";

/**
 * A file's diff lines with their numbers in the old and new file, and the
 * place a comment on each anchors to: RIGHT at its new number (added and
 * unchanged lines), LEFT at its old number (removed lines, and an unchanged
 * line's left side in a split); and the file as patch text for @pierre/diffs.
 */
export type Side = "LEFT" | "RIGHT";
export type Anchor = { side: Side; line: number };
export type Cell = { type: "context" | "add" | "remove"; line: DiffLine; old: number | null; new: number | null; anchor: Anchor };


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

/** The file as a unified patch (git's headers, then its hunks), as @pierre/diffs reads one. */
export function patchOf(file: DiffFile): string {
  const from = file.oldPath ?? file.path;
  const out = [`diff --git a/${from} b/${file.path}`];
  if (file.isNew) out.push("new file mode 100644");
  if (file.isDeleted) out.push("deleted file mode 100644");
  if (from !== file.path) out.push(`rename from ${from}`, `rename to ${file.path}`);
  out.push(`--- ${file.isNew ? "/dev/null" : `a/${from}`}`, `+++ ${file.isDeleted ? "/dev/null" : `b/${file.path}`}`);
  for (const hunk of file.hunks) {
    const header = hunk.lines[0]?.type === "header" ? hunk.lines[0].content : "";
    out.push(/^@@ /.test(header) ? header : `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const line of hunk.lines) {
      if (line.type === "header") continue;
      out.push(`${line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}${line.content}`);
    }
  }
  return `${out.join("\n")}\n`;
}
