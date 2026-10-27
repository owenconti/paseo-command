/**
 * The commits on Paseo Command's own main (GET /api/commits, server/commits.ts)
 * and which of them the user has seen. The last-seen head is kept in this
 * app's store; with none stored, the current head counts as read (no dot on
 * first run). Opening the list reads everything, and so does every commit
 * that lands while it is open.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, readStore, writeStore } from "./api";

export type MainCommit = {
  sha: string;
  subject: string;
  author: string;
  date: string;
};
export type CommitsView = { head: string; commits: MainCommit[] };
type Answer =
  | { available: false }
  | { available: true; head: string; unchanged: true }
  | { available: true; head: string; commits: MainCommit[] };

export const SEEN_KEY = "main-commits-seen";
/** How often main is asked for while the page is visible. */
export const POLL_MS = 6000;

/** Whether `head` is newer than what was seen (nothing stored: not unread). */
export const isUnread = (head: string | undefined, seen: string | null) =>
  !!head && seen !== null && head !== seen;

/**
 * How many of main's commits came after `seen`: those listed before it, or
 * all of them when it isn't listed (older than the list, or rewritten).
 */
export function newSince(commits: MainCommit[], seen: string | null) {
  if (seen === null) return 0;
  const at = commits.findIndex((c) => c.sha === seen);
  return at < 0 ? commits.length : at;
}

/**
 * Main's commits, kept current while the page is visible, and the seen
 * state. `open`: the list is showing, so whatever arrives is read.
 */
export function useMainCommits(enabled: boolean, open: boolean) {
  const [view, setView] = useState<CommitsView | null>(null);
  const [seen, setSeen] = useState<string | null>(() =>
    readStore<string | null>(SEEN_KEY, null),
  );
  const head = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const poll = async () => {
      clearTimeout(timer);
      if (stopped) return;
      if (document.visibilityState !== "hidden" && !controller) {
        controller = new AbortController();
        try {
          const since = head.current
            ? `?since=${encodeURIComponent(head.current)}`
            : "";
          const answer = await api<Answer>(
            `commits${since}`,
            undefined,
            controller.signal,
          );
          if (stopped) return;
          if (!answer.available) {
            head.current = undefined;
            setView(null);
          } else if (!("unchanged" in answer)) {
            head.current = answer.head;
            setView({ head: answer.head, commits: answer.commits });
          }
        } catch {
          // Not answered (an older server, or a moment's outage): try again.
        } finally {
          controller = undefined;
        }
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    };
    const visible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", visible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled]);
  // Other windows of this app share what was seen.
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === null || e.key === `paseo-command:${SEEN_KEY}`)
        setSeen(readStore<string | null>(SEEN_KEY, null));
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  const markRead = useCallback((sha: string) => {
    setSeen(sha);
    writeStore(SEEN_KEY, sha);
  }, []);
  // Seen is tracked by the newest listed commit: main's head itself can be a
  // merge commit, which the list leaves out.
  const current = view?.commits[0]?.sha;
  // First run: the newest commit shown now is read. Open: everything arriving is.
  useEffect(() => {
    if (current && (seen === null || (open && seen !== current)))
      markRead(current);
  }, [current, seen, open, markRead]);
  return { view, seen, unread: isUnread(current, seen), markRead };
}
