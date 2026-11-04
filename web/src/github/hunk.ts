/**
 * A review comment's diff hunk (GitHub's `diffHunk`: the hunk's header, then
 * its lines up to the commented line), cut to its last lines with the header
 * counted again, so it can be drawn as a hunk of its own. Shared by the
 * server (which keeps the last `HUNK_KEEP`) and the Conversation (a few).
 */

/** The server keeps at most this many of a hunk's lines. */
export const HUNK_KEEP = 40;
/** The Conversation shows this many lines above a thread's line (a range's lines, up to `HUNK_RANGE_MAX`). */
export const HUNK_SHOWN = 4;
export const HUNK_RANGE_MAX = 12;

const HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

/** The hunk's last `keep` lines under a header counted for them; "" when it isn't a hunk. */
export function tailHunk(hunk: string, keep: number): string {
  const lines = hunk.replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n");
  const head = HEADER.exec(lines[0] ?? "");
  if (!head) return "";
  let old = Number(head[1]);
  let neu = Number(head[2]);
  // Each line's numbers before it, so a tail's header can start from them.
  const body: { text: string; old: number; neu: number }[] = [];
  for (const text of lines.slice(1)) {
    body.push({ text, old, neu });
    const c = text[0];
    if (c === "+") neu++;
    else if (c === "-") old++;
    else if (c === " " || text === "") {
      old++;
      neu++;
    }
  }
  // The last `keep` lines; a "\ No newline" marker belongs to the line before it, and isn't counted.
  let from = body.length;
  for (let kept = 0; from > 0 && kept < Math.max(1, keep); ) if (!body[--from]!.text.startsWith("\\")) kept++;
  const tail = body.slice(from);
  if (!tail.length) return "";
  const oldCount = tail.filter((l) => l.text[0] === " " || l.text[0] === "-" || l.text === "").length;
  const newCount = tail.filter((l) => l.text[0] === " " || l.text[0] === "+" || l.text === "").length;
  const at = tail[0]!;
  // An empty side starts a line before (git's convention for a zero count).
  const oldStart = oldCount ? at.old : Math.max(0, at.old - 1);
  const newStart = newCount ? at.neu : Math.max(0, at.neu - 1);
  return [`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${from === 0 ? head[3] : ""}`, ...tail.map((l) => (l.text === "" ? " " : l.text))].join("\n");
}
