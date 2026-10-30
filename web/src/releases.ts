/**
 * Paseo Command's release notes (GET /api/releases, server/releases.ts), the
 * version running and the update waiting (the macOS app's `paseo:update`
 * event), and which release the user has seen. The newest seen version is kept
 * in this app's store; with none stored, the newest release counts as read (no
 * dot on first run). Opening the notes reads everything.
 */
import { useCallback, useEffect, useState } from "react";
import { api, readStore, writeStore } from "./api";

export type Release = {
  version: string;
  date: string;
  notes: string;
  url: string;
};
type Answer = { installed: string; releases: Release[]; error?: string };
/** The app's `paseo:update` event: this version, and the one waiting. */
type UpdateEvent = { installed: string; pending: string | null };

export const SEEN_KEY = "releases-seen";
/** How often the notes are asked for (the server caches GitHub's answer for an hour). */
export const POLL_MS = 30 * 60_000;

/** Whether `newest` differs from what was seen (nothing stored: not unread). */
export const isUnread = (newest: string | undefined, seen: string | null) =>
  !!newest && seen !== null && newest !== seen;

/**
 * How many releases came after `seen`: those listed before it, or all of
 * them when it isn't listed (older than the list).
 */
export function newSince(releases: Release[], seen: string | null) {
  if (seen === null) return 0;
  const at = releases.findIndex((r) => r.version === seen);
  return at < 0 ? releases.length : at;
}

/**
 * The release notes, the installed and pending versions, and the seen state.
 * `open`: the notes are showing, so whatever arrives is read.
 */
export function useReleases(open: boolean) {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [update, setUpdate] = useState<UpdateEvent | null>(null);
  const [seen, setSeen] = useState<string | null>(() =>
    readStore<string | null>(SEEN_KEY, null),
  );
  useEffect(() => {
    let stopped = false;
    const load = () =>
      api<Answer>("releases")
        .then((a) => !stopped && setAnswer(a))
        // Not answered (an older server, or a moment's outage): try later.
        .catch(() => {});
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  // The app posts this on page load and whenever an update is ready; the page
  // may load before or after, so the installed version also comes from the API.
  useEffect(() => {
    const receive = (e: Event) => setUpdate((e as CustomEvent<UpdateEvent>).detail);
    window.addEventListener("paseo:update", receive);
    return () => window.removeEventListener("paseo:update", receive);
  }, []);
  // Other windows of this app share what was seen.
  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === null || e.key === `paseo-command:${SEEN_KEY}`)
        setSeen(readStore<string | null>(SEEN_KEY, null));
    };
    addEventListener("storage", sync);
    return () => removeEventListener("storage", sync);
  }, []);
  const markRead = useCallback((version: string) => {
    setSeen(version);
    writeStore(SEEN_KEY, version);
  }, []);
  const releases = answer?.releases ?? [];
  const newest = releases[0]?.version;
  // First run: the newest release is read. Open: everything arriving is.
  useEffect(() => {
    if (newest && (seen === null || (open && seen !== newest)))
      markRead(newest);
  }, [newest, seen, open, markRead]);
  return {
    loaded: answer !== null,
    installed: update?.installed ?? answer?.installed ?? "dev",
    releases,
    pending: update?.pending ?? null,
    error: answer?.error ?? null,
    seen,
    unread: isUnread(newest, seen),
    markRead,
  };
}
