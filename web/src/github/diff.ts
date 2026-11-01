/**
 * Unified diffs (`git diff`, GitHub's pull request diffs) as the daemon's parsed shape
 * (`DiffFile`), and the line numbers the views need. Pure: the server parses
 * PR diffs with it; the page numbers both kinds.
 */
import type { DiffFile, DiffHunk, DiffLine } from "./types";

export const DIFF_LIMITS = {
  /** A file with more lines than this is `too_large`, its hunks left out. */
  fileLines: 5_000,
  /** Past this many lines in all, later files are left out and the diff is `tooLarge`. */
  totalLines: 40_000,
  /** At most this many files. */
  files: 3_000,
};
export type DiffLimits = typeof DIFF_LIMITS;

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A `diff --git a/x b/y` header's two paths (quoted or plain); null when it can't be split. */
function gitPaths(line: string): { a: string; b: string } | null {
  const rest = line.slice("diff --git ".length);
  const quoted = /^"a\/((?:[^"\\]|\\.)*)" "b\/((?:[^"\\]|\\.)*)"$/.exec(rest);
  if (quoted) return { a: unquote(quoted[1]!), b: unquote(quoted[2]!) };
  // Plain: `a/<p> b/<p>`; when both are the same path, split in the middle.
  if (rest.startsWith("a/")) {
    const half = (rest.length - 1) / 2;
    if (Number.isInteger(half) && rest.slice(half, half + 3) === " b/" && rest.slice(2, half) === rest.slice(half + 3))
      return { a: rest.slice(2, half), b: rest.slice(half + 3) };
    const at = rest.indexOf(" b/");
    if (at > 0) return { a: rest.slice(2, at), b: rest.slice(at + 3) };
  }
  return null;
}

/** Git's C-style quoted path, unescaped (octal escapes as UTF-8 bytes). */
function unquote(s: string): string {
  const bytes: number[] = [];
  const map: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "\\": 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length) {
      const oct = /^[0-7]{3}/.exec(s.slice(i + 1));
      if (oct) {
        bytes.push(parseInt(oct[0], 8));
        i += 3;
        continue;
      }
      const e = s[i + 1]!;
      bytes.push(map[e] ?? e.charCodeAt(0));
      i++;
      continue;
    }
    bytes.push(...new TextEncoder().encode(c));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** A `--- a/x` / `+++ b/x` path; null for /dev/null. */
function markerPath(line: string): string | null {
  let p = line.slice(4).replace(/\t.*$/, "");
  if (p === "/dev/null") return null;
  if (p.startsWith('"') && p.endsWith('"')) p = unquote(p.slice(1, -1));
  return p.replace(/^[ab]\//, "");
}

/**
 * Parses a unified diff. Each hunk's first line is its `@@ … @@` header (as the
 * daemon's); "\ No newline at end of file" lines are dropped. A file past
 * `fileLines` is `too_large` (no hunks); past `totalLines` in all (or `files`
 * files), the rest are left out and `tooLarge` is set.
 */
export function parseUnifiedDiff(text: string, limits: Partial<DiffLimits> = {}): { files: DiffFile[]; tooLarge: boolean } {
  const lim = { ...DIFF_LIMITS, ...limits };
  const files: DiffFile[] = [];
  let tooLarge = false;
  let total = 0;
  let file: (DiffFile & { lineCount: number }) | null = null;
  let hunk: DiffHunk | null = null;
  // Lines still expected in the current hunk, so a `--- x` removal isn't read as a header.
  let oldLeft = 0;
  let newLeft = 0;

  const finish = () => {
    if (!file) return;
    const { lineCount, ...done } = file;
    if (done.status === "too_large" || done.status === "binary") done.hunks = [];
    else if (lineCount > lim.fileLines) {
      done.status = "too_large";
      done.hunks = [];
    } else total += lineCount;
    if (total > lim.totalLines || files.length >= lim.files) tooLarge = true;
    else files.push(done);
    file = null;
    hunk = null;
  };

  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const raw of lines) {
    if (tooLarge) break;
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      if (c === "\\") continue;
      if (c === "+" || c === "-" || c === " " || line === "") {
        const type: DiffLine["type"] = c === "+" ? "add" : c === "-" ? "remove" : "context";
        if (type !== "add") oldLeft--;
        if (type !== "remove") newLeft--;
        if (type === "add") file!.additions++;
        if (type === "remove") file!.deletions++;
        file!.lineCount++;
        if (file!.lineCount <= lim.fileLines) hunk.lines.push({ type, content: line.slice(1) });
        continue;
      }
      // A malformed hunk ended early: read the line as a header.
      oldLeft = newLeft = 0;
    }
    if (line.startsWith("\\")) continue;
    if (line.startsWith("diff --git ")) {
      finish();
      const paths = gitPaths(line);
      file = {
        path: paths?.b ?? "",
        ...(paths && paths.a !== paths.b ? { oldPath: paths.a } : {}),
        isNew: false,
        isDeleted: false,
        additions: 0,
        deletions: 0,
        hunks: [],
        status: "ok",
        lineCount: 0,
      };
      continue;
    }
    if (!file) {
      // A diff without `diff --git` headers (plain `diff -u`) starts at its `---`.
      if (!line.startsWith("--- ")) continue;
      file = { path: "", isNew: false, isDeleted: false, additions: 0, deletions: 0, hunks: [], status: "ok", lineCount: 0 };
    }
    const m = HUNK.exec(line);
    if (m) {
      const oldCount = m[2] === undefined ? 1 : Number(m[2]);
      const newCount = m[4] === undefined ? 1 : Number(m[4]);
      hunk = { oldStart: Number(m[1]), oldCount, newStart: Number(m[3]), newCount, lines: [] };
      if (file.lineCount <= lim.fileLines) {
        hunk.lines.push({ type: "header", content: line });
        file.hunks.push(hunk);
      }
      oldLeft = oldCount;
      newLeft = newCount;
      continue;
    }
    if (line.startsWith("new file mode")) file.isNew = true;
    else if (line.startsWith("deleted file mode")) file.isDeleted = true;
    else if (line.startsWith("rename from ")) file.oldPath = line.slice("rename from ".length);
    else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
    else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.status = "binary";
    else if (line.startsWith("--- ")) {
      const p = markerPath(line);
      if (p === null) file.isNew = true;
      else if (!file.path) file.path = p;
      else if (p !== file.path && !file.oldPath) file.oldPath = p;
    } else if (line.startsWith("+++ ")) {
      const p = markerPath(line);
      if (p === null) file.isDeleted = true;
      else file.path = p;
    }
  }
  finish();
  for (const f of files) if (f.oldPath === f.path) delete f.oldPath;
  // A deleted file's path is its old one (`+++ /dev/null`).
  for (const f of files) if (!f.path && f.oldPath) f.path = f.oldPath;
  return { files, tooLarge };
}

/** A hunk's line with its numbers: `oldLine` in the old file (not for additions), `newLine` in the new (not for removals). */
export type NumberedLine = DiffLine & { oldLine?: number; newLine?: number };

/** The hunk's lines with their old and new line numbers (the header has neither). */
export function numberLines(hunk: DiffHunk): NumberedLine[] {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return hunk.lines.map((l) => {
    if (l.type === "header") return { ...l };
    if (l.type === "add") return { ...l, newLine: newLine++ };
    if (l.type === "remove") return { ...l, oldLine: oldLine++ };
    return { ...l, oldLine: oldLine++, newLine: newLine++ };
  });
}

/** Files' additions and deletions in all. */
export function diffStats(files: DiffFile[]): { files: number; additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { files: files.length, additions, deletions };
}
