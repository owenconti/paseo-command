/**
 * What Activity has marked on a source, kept beside its lists, since a
 * source's lists don't follow its writes at once: GitHub's `/notifications`
 * lags after `PATCH`/`DELETE`, keeps listing threads marked done (as read
 * ones), and moves a thread's `updated_at` for activity that doesn't notify
 * you (pushes, checks on a pull request you're assigned), leaving it read;
 * Linear's Inbox can still list an archived notification for a moment.
 * So a thread marked done is left out until a genuinely newer event: past the
 * settling time, unread again and changed after both the source's time for it
 * when marked and when it was marked here. Read and unread show as marked
 * while the lists settle.
 */
import type { ActivityItem } from "../../src/activity/types";

export const ACTIVITY_MARKS = {
  /** How long after a write a source's lists may still show what was before it. */
  settleMs: 120_000,
  /** The clock (tests move it). */
  now: () => Date.now(),
};

/** A thread marked done: the source's time for it then (`at`) and when it was marked (`doneAt`). */
export type DoneMark = { at: string; doneAt: string };
/** A thread marked read or unread, while the lists settle. */
export type ReadMark = { unread: boolean; at: string; markedAt: string };

const time = (s: string | undefined) => (s ? Date.parse(s) || 0 : 0);

/** Whether a thread marked done has had something genuinely newer since (`seenAt`: when the source says you last read it). */
export function backAfterDone(mark: DoneMark, item: Pick<ActivityItem, "unread" | "at">, now: number, seenAt?: string): boolean {
  if (now - time(mark.doneAt) < ACTIVITY_MARKS.settleMs) return false;
  return item.unread && time(item.at) > Math.max(time(mark.at), time(mark.doneAt), time(seenAt));
}

export type Marks = { done: Map<string, DoneMark>; read: Map<string, ReadMark> };
export const newMarks = (): Marks => ({ done: new Map(), read: new Map() });

/**
 * The list with the marks applied: those done left out, those read or unread
 * as marked while the lists settle (unless changed since); answers the ids that
 * came back after being done, whose marks are then forgotten.
 */
export function applyMarks(
  marks: Marks,
  items: ActivityItem[],
  seenAt: (id: string) => string | undefined = () => undefined,
): { items: ActivityItem[]; back: string[] } {
  const now = ACTIVITY_MARKS.now();
  const back: string[] = [];
  for (const [id, mark] of marks.read) if (now - time(mark.markedAt) >= ACTIVITY_MARKS.settleMs) marks.read.delete(id);
  const out: ActivityItem[] = [];
  for (const item of items) {
    const done = marks.done.get(item.id);
    if (done) {
      if (!backAfterDone(done, item, now, seenAt(item.id))) continue;
      marks.done.delete(item.id);
      back.push(item.id);
    }
    const read = marks.read.get(item.id);
    const changed = read && time(item.at) > Math.max(time(read.at), time(read.markedAt));
    out.push(read && !changed ? { ...item, unread: read.unread } : { ...item });
  }
  return { items: out, back };
}
