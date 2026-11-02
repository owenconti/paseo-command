/**
 * The GitHub tab's side of GitHub's API (`../githubApi.ts`, the user's classic
 * token, only while `integrations.github` is on): reads are cached for
 * `GITHUB_TAB.ttlMs` (`fresh` asks past it), writes clear what they change,
 * and a failure becomes the view's words or the write's status.
 */
import type { GithubUnavailable } from "../../src/github/types";
import { GithubApiError, githubToken } from "../githubApi";

export { GithubApiError } from "../githubApi";

export const GITHUB_TAB = { ttlMs: 15_000 };

/** Refuses while the integration is off or has no token. */
export function assertEnabled(): void {
  githubToken();
}

/** Any failure as a `GithubApiError` (something unexpected is GitHub not answering). */
export const apiFailure = (e: unknown): GithubApiError =>
  e instanceof GithubApiError ? e : new GithubApiError("failed", "GitHub didn't answer.");

export const unavailable = (e: GithubApiError): GithubUnavailable => ({ available: false, reason: e.message });

/** A write's HTTP status for why it didn't happen. */
export function writeStatus(e: GithubApiError): number {
  switch (e.kind) {
    case "off":
    case "no-key":
      return 503;
    case "refused":
      return 401;
    case "forbidden":
      return 403;
    case "limited":
      return 429;
    case "invalid":
      return 400;
    case "not-found":
      return 404;
    default:
      return 502;
  }
}

// ── Cache ────────────────────────────────────────────────────────────────────
const cache = new Map<string, { at: number; value: Promise<unknown>; settled?: unknown }>();

/**
 * `read()` once per `GITHUB_TAB.ttlMs` for `key`; a failure isn't kept, and
 * one that's only the rate limit answers the last answer instead, while there is one.
 */
export function cached<T>(key: string, fresh: boolean, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < GITHUB_TAB.ttlMs) return hit.value as Promise<T>;
  const last = hit && "settled" in hit ? (hit.settled as T) : undefined;
  const value = read().catch((e) => {
    if (last !== undefined && e instanceof GithubApiError && e.kind === "limited") return last;
    throw e;
  });
  const entry: { at: number; value: Promise<unknown>; settled?: unknown } = { at: Date.now(), value, ...(last !== undefined ? { settled: last } : {}) };
  cache.set(key, entry);
  value.then(
    (v) => {
      entry.settled = v;
    },
    () => {
      if (cache.get(key) === entry) cache.delete(key);
    },
  );
  return value;
}

// ── Search ───────────────────────────────────────────────────────────────────
/** GitHub's search allows 30 requests a minute; the tab keeps a few back for the rest of the app. */
export const SEARCH_BUDGET = { perMinute: 25 };
let searches: number[] = [];

/** Takes one of the minute's searches, or refuses (`limited`) until one frees. */
export function searchSlot(): void {
  const now = Date.now();
  searches = searches.filter((at) => now - at < 60_000);
  if (searches.length >= SEARCH_BUDGET.perMinute)
    throw new GithubApiError("limited", "GitHub's search allows 30 requests a minute; this list is asked again shortly.", undefined, searches[0]! + 60_000);
  searches.push(now);
}

/** Forgets cached reads whose key starts with one of these. */
export function forget(...prefixes: string[]): void {
  for (const key of [...cache.keys()]) if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
}
export const resetGithubTab = () => {
  cache.clear();
  searches = [];
};
