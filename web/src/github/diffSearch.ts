import type { DiffFile } from "./types";

/**
 * Searching a diff (`DiffView.tsx`): the file list's filter, fuzzy on paths,
 * and Find in the diff, over every file's lines from the parsed diff (folded
 * and not-yet-drawn files too), never the page. Pure, so the tests run it.
 */

/** A path's fit for the filter: higher is better; `marks` are the matched characters' indexes. */
export type PathMatch = { score: number; marks: number[] };

const BOUNDARY = /[/_\-. ]/;
const SCORE = { match: 1, boundary: 8, consecutive: 6, name: 4, gap: 0.2 };

/**
 * The query's characters in order in the path (case-insensitive, spaces
 * ignored), placed for the best score: at word starts, run together, in the
 * file's name rather than its directories. Null when they aren't all there.
 */
export function fuzzyPath(query: string, path: string): PathMatch | null {
  const q = query.replace(/\s+/g, "").toLowerCase();
  if (!q) return { score: 0, marks: [] };
  const p = path.toLowerCase();
  const n = q.length;
  const m = p.length;
  if (n > m) return null;
  const nameStart = path.lastIndexOf("/") + 1;
  const bonus = (j: number) =>
    SCORE.match +
    (j === 0 || BOUNDARY.test(path[j - 1]!) || (/[a-z0-9]/.test(path[j - 1]!) && /[A-Z]/.test(path[j]!)) ? SCORE.boundary : 0) +
    (j >= nameStart ? SCORE.name : 0);
  // best[i][j]: the best score with q[i] at p[j]; from[i][j]: where q[i - 1] sat.
  const best = Array.from({ length: n }, () => new Float64Array(m).fill(-Infinity));
  const from = Array.from({ length: n }, () => new Int32Array(m).fill(-1));
  for (let j = 0; j < m; j++) if (p[j] === q[0]) best[0]![j] = bonus(j) - j * SCORE.gap * 0.1;
  for (let i = 1; i < n; i++) {
    // The best earlier place for q[i - 1] at least two back, less its gap to here.
    let run = -Infinity;
    let runAt = -1;
    const prev = best[i - 1]!;
    const row = best[i]!;
    for (let j = i; j < m; j++) {
      if (j >= 2 && prev[j - 2]! - SCORE.gap > run - SCORE.gap) {
        run = prev[j - 2]! - SCORE.gap;
        runAt = j - 2;
      } else run -= SCORE.gap;
      if (p[j] !== q[i]) continue;
      const after = prev[j - 1]! + SCORE.consecutive;
      if (after >= run && after > -Infinity) {
        row[j] = after + bonus(j);
        from[i]![j] = j - 1;
      } else if (run > -Infinity) {
        row[j] = run + bonus(j);
        from[i]![j] = runAt;
      }
    }
  }
  let end = -1;
  for (let j = 0; j < m; j++) if (best[n - 1]![j]! > (end < 0 ? -Infinity : best[n - 1]![end]!)) end = j;
  if (end < 0 || best[n - 1]![end] === -Infinity) return null;
  const marks: number[] = [];
  for (let i = n - 1, j = end; i >= 0; j = from[i]![j]!, i--) marks.push(j);
  return { score: best[n - 1]![end]!, marks: marks.reverse() };
}

/** The files whose paths fit the query, in their order, and the path that fits best. */
export function filterFiles<T extends { path: string }>(files: T[], query: string): { files: (T & { marks: number[] })[]; best?: string } {
  let best: { path: string; score: number } | undefined;
  const out: (T & { marks: number[] })[] = [];
  for (const f of files) {
    const hit = fuzzyPath(query, f.path);
    if (!hit) continue;
    out.push({ ...f, marks: hit.marks });
    if (!best || hit.score > best.score) best = { path: f.path, score: hit.score };
  }
  return { files: out, ...(best ? { best: best.path } : {}) };
}

/**
 * A line as the diff draws it, keyed by its side and number: `L<old>` for a
 * removed line, `R<new>` for an added or unchanged one (an unchanged line is
 * also `L<old>`, its `alt`, the left side of a split). Each hunk's changes
 * show their removals first, then their additions, as @pierre/diffs draws them.
 */
export type ShownLine = { key: string; alt?: string; type: "context" | "add" | "remove"; content: string };

export function shownLines(file: DiffFile): ShownLine[] {
  const out: ShownLine[] = [];
  for (const hunk of file.hunks) {
    let old = hunk.oldStart;
    let neu = hunk.newStart;
    let removed: ShownLine[] = [];
    let added: ShownLine[] = [];
    const flush = () => {
      out.push(...removed, ...added);
      removed = [];
      added = [];
    };
    for (const line of hunk.lines) {
      if (line.type === "header") continue;
      if (line.type === "remove") removed.push({ key: `L${old++}`, type: "remove", content: line.content });
      else if (line.type === "add") added.push({ key: `R${neu++}`, type: "add", content: line.content });
      else {
        flush();
        out.push({ key: `R${neu++}`, alt: `L${old++}`, type: "context", content: line.content });
      }
    }
    flush();
  }
  return out;
}

export type FindOptions = { caseSensitive: boolean; regex: boolean };

/** One match: its file (index and path), its line (`ShownLine`'s keys, and its place among the file's shown lines) and its characters. */
export type FindMatch = { file: number; path: string; key: string; alt?: string; line: number; start: number; end: number };

/** At most this many matches are kept (the count says "N+"). */
export const FIND_LIMIT = 5000;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every match of the query in the files' added, removed and unchanged lines,
 * in the order they show (file, line, column); case-insensitive unless asked,
 * a regular expression when asked (an invalid one answers `error`).
 */
export function findInDiff(files: DiffFile[], query: string, opts: FindOptions): { matches: FindMatch[]; capped: boolean; error?: string } {
  if (!query) return { matches: [], capped: false };
  let re: RegExp;
  try {
    re = new RegExp(opts.regex ? query : escape(query), opts.caseSensitive ? "g" : "gi");
  } catch {
    return { matches: [], capped: false, error: "Invalid pattern" };
  }
  const matches: FindMatch[] = [];
  for (const [index, file] of files.entries()) {
    for (const [line, shown] of shownLines(file).entries()) {
      re.lastIndex = 0;
      for (let hit = re.exec(shown.content); hit; hit = re.exec(shown.content)) {
        // A pattern that matches nothing (`a*`) moves on rather than marking nothing.
        if (!hit[0].length) {
          re.lastIndex++;
          continue;
        }
        if (matches.length >= FIND_LIMIT) return { matches, capped: true };
        matches.push({
          file: index,
          path: file.path,
          key: shown.key,
          ...(shown.alt ? { alt: shown.alt } : {}),
          line,
          start: hit.index,
          end: hit.index + hit[0].length,
        });
      }
    }
  }
  return { matches, capped: false };
}

/** The same match (after the diff is read again): same file, line and characters. */
export const sameMatch = (a: FindMatch, b: FindMatch) => a.path === b.path && a.key === b.key && a.start === b.start && a.end === b.end;
