/**
 * A PR's Conversation as GitHub shows it: its comments and reviews, each
 * review with the line comment threads it started, and threads not started
 * by a review shown in the list (a single comment, or one whose review isn't
 * among those read) at their own place. A review left only to reply in other
 * threads, or only to start its own threads with no summary (GitHub's
 * "Add single comment"), isn't shown as a review: its comments show in their
 * threads, or its threads stand on their own.
 */
import { HUNK_RANGE_MAX, HUNK_SHOWN, tailHunk } from "./hunk";
import type { ReviewThread, TimelineEntry } from "./types";

export type ReviewEntry = Extract<TimelineEntry, { kind: "review" }>;
export type ConversationItem =
  | { kind: "comment"; id: string; at: string; entry: Extract<TimelineEntry, { kind: "comment" }> }
  | { kind: "review"; id: string; at: string; entry: ReviewEntry; threads: ReviewThread[] }
  | { kind: "thread"; id: string; at: string; thread: ReviewThread };

/** The review that started a thread: its first comment's. */
export const threadReview = (t: ReviewThread) => t.comments[0]?.reviewId;

/** The Conversation's items, oldest first; threads keep their own comments' order. */
export function conversationOf(timeline: TimelineEntry[], threads: ReviewThread[]): ConversationItem[] {
  const reviews = new Map(timeline.filter((e): e is ReviewEntry => e.kind === "review").map((e) => [e.id, e]));
  const started = new Map<string, ReviewThread[]>();
  const loose: ReviewThread[] = [];
  for (const t of threads) {
    if (!t.comments.length) continue;
    const id = threadReview(t);
    if (id && reviews.has(id)) started.set(id, [...(started.get(id) ?? []), t]);
    else loose.push(t);
  }
  const items: ConversationItem[] = [];
  for (const e of timeline) {
    if (e.kind === "comment") {
      items.push({ kind: "comment", id: e.id, at: e.createdAt, entry: e });
      continue;
    }
    const own = started.get(e.id) ?? [];
    const plain = e.state === "commented" && !e.body.trim();
    // A review of single comments only: its threads stand alone, each at its first comment.
    if (plain && own.length) loose.push(...own);
    else if (!plain) items.push({ kind: "review", id: e.id, at: e.createdAt, entry: e, threads: own });
    // A review of replies only: they show in their threads.
  }
  for (const t of loose) items.push({ kind: "thread", id: t.id, at: t.comments[0]!.createdAt, thread: t });
  // Stable: the timeline's own order where times tie.
  return items.map((item, i) => ({ item, i })).sort((a, b) => a.item.at.localeCompare(b.item.at) || a.i - b.i).map((x) => x.item);
}

/** The line(s) a thread is on, in words ("line 12", "lines 10–12", "the file"), from where it was left once outdated. */
export function threadLines(t: ReviewThread): string {
  if (t.onFile) return "the file";
  const line = t.isOutdated || t.line === null ? (t.originalLine ?? t.line) : t.line;
  const start = t.isOutdated || t.line === null ? (t.originalStartLine ?? t.startLine) : t.startLine;
  if (line === null || line === undefined) return "an earlier line";
  return start !== null && start !== undefined && start !== line ? `lines ${start}–${line}` : `line ${line}`;
}

/** The few lines of its hunk a thread shows: its range's (up to `HUNK_RANGE_MAX`), else the last `HUNK_SHOWN`. */
export function threadHunk(t: ReviewThread): string {
  if (!t.diffHunk) return "";
  const line = t.isOutdated || t.line === null ? (t.originalLine ?? t.line) : t.line;
  const start = t.isOutdated || t.line === null ? (t.originalStartLine ?? t.startLine) : t.startLine;
  const range = line && start && line > start ? Math.min(HUNK_RANGE_MAX, line - start + 1) : 0;
  return tailHunk(t.diffHunk, Math.max(range, HUNK_SHOWN));
}
