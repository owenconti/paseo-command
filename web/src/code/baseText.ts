import type { DiffFile } from "../github/types";

/**
 * A changed file's text before its changes (the diff's base: `HEAD` for uncommitted changes, the merge base for the
 * branch's), rebuilt from the file as it is now and the daemon's diff of it, by applying the diff backwards: each
 * hunk's context and added lines must be the current text's at their place, or the diff is of another version of the
 * file and null is returned (ask for the diff again). A new file was empty. A file whose hunks were left out (too large,
 * binary) can't be rebuilt.
 */
export function baseText(current: string, file: Pick<DiffFile, "isNew" | "isDeleted" | "hunks" | "status" | "additions" | "deletions">): string | null {
  if (file.isNew) return "";
  if (file.status && file.status !== "ok") return null;
  if (!file.hunks.length) return file.additions || file.deletions ? null : current;
  const lines = current.split("\n");
  const out: string[] = [];
  let at = 0;
  const hunks = [...file.hunks].sort((a, b) => a.newStart - b.newStart);
  for (const h of hunks) {
    // A hunk adding nothing to the new side names the line before its place.
    const start = h.newCount === 0 ? h.newStart : h.newStart - 1;
    if (start < at || start > lines.length) return null;
    while (at < start) out.push(lines[at++]);
    for (const line of h.lines) {
      if (line.type === "header") continue;
      if (line.type === "remove") {
        out.push(line.content);
        continue;
      }
      if (at >= lines.length || lines[at] !== line.content) return null;
      if (line.type === "context") out.push(line.content);
      at++;
    }
  }
  while (at < lines.length) out.push(lines[at++]);
  return out.join("\n");
}
