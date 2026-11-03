/**
 * Comments on a workspace's own diff (the Changes view), kept as that
 * workspace's pending comments in the app's data directory
 * (`diff-comments.json`, `web/server/diffComments.ts`) until they're applied
 * from the chat: sent to one of its agents as one message, then kept as
 * history. They never reach GitHub, nor the worktree's files.
 */
import { sideLines, type Side } from "./rows";
import type { DiffFile } from "./types";

export type LocalComment = {
  id: string;
  path: string;
  side: Side;
  /** The (last) line it's on, in the old file (LEFT) or the new (RIGHT). */
  line: number;
  /** A range's first line, on the same side. */
  startLine?: number;
  /** The lines' text when it was written, `startLine`…`line`: what it's re-anchored by. */
  text: string[];
  body: string;
  createdAt: string;
  updatedAt?: string;
  /** When it was sent to an agent; then only history. */
  appliedAt?: string;
  /** The agent it was sent to. */
  appliedTo?: string;
};

/** What the page posts to `POST /api/diff-comments`, beside `host` and `workspace`. */
export type LocalCommentChange =
  | { action: "add"; comment: Pick<LocalComment, "path" | "side" | "line" | "startLine" | "text" | "body"> }
  | { action: "edit"; id: string; body: string }
  | { action: "remove"; id: string }
  | { action: "move"; moves: { id: string; line: number; startLine?: number }[] }
  | { action: "apply"; ids: string[]; agentId?: string }
  | { action: "discard" };

export const MAX_COMMENTS = 500;
export const MAX_BODY = 20_000;
/** At most this many lines of text kept per comment (a range's first ones). */
export const MAX_TEXT_LINES = 200;
export const MAX_LINE = 2_000;

export const pending = (comments: readonly LocalComment[]) => comments.filter((c) => !c.appliedAt);

/** "3 pending comments". */
export const pendingLabel = (n: number) => `${n} pending comment${n === 1 ? "" : "s"}`;

/** Where a range starts (its line when it's one). */
export const firstLine = (c: Pick<LocalComment, "line" | "startLine">) => c.startLine ?? c.line;

/** The text of a side's lines `from`…`to` as the file's diff shows them (a line it doesn't show is ""). */
export function textOf(file: DiffFile, side: Side, from: number, to: number): string[] {
  const lines = sideLines(file, side);
  const out: string[] = [];
  for (let n = from; n <= to && out.length < MAX_TEXT_LINES; n++) out.push((lines.get(n) ?? "").slice(0, MAX_LINE));
  return out;
}

/**
 * Where a comment sits in the diff as it is now: where it was, while its
 * lines there still read as they did; else the nearest place on its side
 * where they do (one line's text, or the range's in order); else null:
 * outdated (its file or lines are gone from the diff, or changed).
 */
export function placeComment(c: LocalComment, files: readonly DiffFile[]): { line: number; startLine?: number } | null {
  const file = files.find((f) => f.path === c.path);
  if (!file) return null;
  const lines = sideLines(file, c.side);
  const from = firstLine(c);
  const span = c.line - from;
  const text = c.text.length ? c.text : null;
  const fits = (start: number) => {
    if (!text) return lines.has(start) && lines.has(start + span);
    for (let i = 0; i <= span; i++) {
      const want = text[i];
      if (want === undefined) return lines.has(start + i);
      if (lines.get(start + i) !== want) return false;
    }
    return true;
  };
  const at = (start: number) => (span ? { line: start + span, startLine: start } : { line: start });
  if (fits(from)) return at(from);
  if (!text) return null;
  let best: number | null = null;
  for (const n of lines.keys()) {
    if (n === from || !fits(n)) continue;
    if (best === null || Math.abs(n - from) < Math.abs(best - from) || (Math.abs(n - from) === Math.abs(best - from) && n < best)) best = n;
  }
  return best === null ? null : at(best);
}

/** Each pending comment's place now: on the diff (moved or not), or outdated. */
export function placeComments(comments: readonly LocalComment[], files: readonly DiffFile[]) {
  const placed: LocalComment[] = [];
  const outdated: LocalComment[] = [];
  const moves: { id: string; line: number; startLine?: number }[] = [];
  for (const c of comments) {
    const at = placeComment(c, files);
    if (!at) {
      outdated.push(c);
      continue;
    }
    const { startLine: _drop, ...rest } = c;
    const now: LocalComment = { ...rest, line: at.line, ...(at.startLine !== undefined ? { startLine: at.startLine } : {}) };
    if (now.line !== c.line || now.startLine !== c.startLine) moves.push({ id: c.id, line: at.line, ...(at.startLine !== undefined ? { startLine: at.startLine } : {}) });
    placed.push(now);
  }
  return { placed, outdated, moves };
}

/** `path:12`, or `path:10-14` for a range. */
export const placeLabel = (c: Pick<LocalComment, "path" | "line" | "startLine">) =>
  `${c.path}:${c.startLine !== undefined && c.startLine !== c.line ? `${c.startLine}-${c.line}` : c.line}`;

export const APPLY_LEAD =
  "Please address these comments on your changes. I left them on the diff of this workspace's branch; each gives the file and line (or lines), quotes them, then says what to change.";

/** The one message Apply sends: the instruction, then each comment as `path:line`, its lines quoted, and what it says. */
export function applyMessage(comments: readonly LocalComment[]): string {
  const items = comments.map((c, i) => {
    const where = `${i + 1}. ${placeLabel(c)}${c.side === "LEFT" ? " (the old version, before your changes)" : ""}`;
    const quoted = c.text.length ? c.text.map((l) => (l ? `   > ${l}` : "   >")).join("\n") : "";
    const body = c.body
      .trim()
      .split("\n")
      .map((l) => (l ? `   ${l}` : ""))
      .join("\n");
    return [where, quoted, body].filter(Boolean).join("\n");
  });
  return `${APPLY_LEAD}\n\n${items.join("\n\n")}`;
}
