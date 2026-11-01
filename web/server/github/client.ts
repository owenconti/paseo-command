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
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

/** `read()` once per `GITHUB_TAB.ttlMs` for `key`; a failure isn't kept. */
export function cached<T>(key: string, fresh: boolean, read: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < GITHUB_TAB.ttlMs) return hit.value as Promise<T>;
  const value = read();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return value;
}

/** Forgets cached reads whose key starts with one of these. */
export function forget(...prefixes: string[]): void {
  for (const key of [...cache.keys()]) if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
}
export const resetGithubTab = () => cache.clear();
