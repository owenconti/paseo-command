/**
 * Paseo Command's release notes (GET /api/releases) for the panel header's
 * "What's new": GitHub's published releases, read unauthenticated and cached
 * for an hour. When GitHub can't be reached the last good answer is kept.
 */
export const RELEASES_URL =
  "https://api.github.com/repos/owenconti/paseo-command/releases?per_page=20";
export const RELEASES_TTL_MS = 60 * 60_000;
const FETCH_TIMEOUT_MS = 10000;
/** How long a failed fetch is left alone. */
export const RELEASES_BACKOFF_MS = 5 * 60_000;
export const RELEASES_ERROR = "Couldn't load release notes";

export type Release = {
  version: string;
  date: string;
  notes: string;
  url: string;
};
export type ReleasesView = {
  installed: string;
  releases: Release[];
  error?: string;
};

type GitHubRelease = {
  tag_name?: unknown;
  published_at?: unknown;
  body?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

const text = (v: unknown) => (typeof v === "string" ? v : "");

/** Published, final releases only, newest first as GitHub lists them. */
function parse(json: unknown): Release[] {
  if (!Array.isArray(json)) throw new Error("Unexpected answer");
  return (json as GitHubRelease[])
    .filter((r) => r && !r.draft && !r.prerelease && text(r.tag_name))
    .map((r) => ({
      version: text(r.tag_name).replace(/^v/, ""),
      date: text(r.published_at),
      notes: text(r.body),
      url: text(r.html_url),
    }));
}

let cached: { at: number; releases: Release[] } | undefined;
let failedAt: number | undefined;
let inflight: Promise<void> | undefined;

/** Forgets what was fetched (tests). */
export const resetReleases = () => {
  cached = undefined;
  failedAt = undefined;
  inflight = undefined;
};

async function load(now: () => number): Promise<void> {
  try {
    const res = await fetch(RELEASES_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "paseo-command",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    cached = { at: now(), releases: parse(await res.json()) };
    failedAt = undefined;
  } catch {
    failedAt = now();
  }
}

/**
 * The release notes and the running version. Never throws. Concurrent calls
 * share one fetch, and a failure is not retried for RELEASES_BACKOFF_MS.
 */
export async function releasesView(
  now: () => number = Date.now,
): Promise<ReleasesView> {
  const installed = process.env.PASEO_COMMAND_VERSION || "dev";
  const fresh = cached && now() - cached.at < RELEASES_TTL_MS;
  const backingOff = failedAt !== undefined && now() - failedAt < RELEASES_BACKOFF_MS;
  if (!fresh && !backingOff) {
    inflight ??= load(now).finally(() => {
      inflight = undefined;
    });
    await inflight;
  }
  if (failedAt !== undefined && !fresh)
    return { installed, releases: cached?.releases ?? [], error: RELEASES_ERROR };
  return { installed, releases: cached?.releases ?? [] };
}
