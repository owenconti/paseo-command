/**
 * GitHub's REST and GraphQL APIs with the user's classic token (`githubToken`
 * in secrets.json, through `integrationKey("github")`: only while the GitHub
 * integration is on; the environment is never read). Every GitHub call in the
 * server goes through here; tests replace `GITHUB_API.fetch` (and
 * `test-setup.ts` makes it refuse unless a test does).
 */
import { GITHUB_TOKEN_SCOPES } from "../src/githubToken";
import { integrationEnabled, integrationKey } from "./integrations";

export const GITHUB_API = {
  base: "https://api.github.com",
  timeoutMs: 30_000,
  /** The request itself (tests put a fake here). */
  fetch: (url: string, init: RequestInit): Promise<Response> => fetch(url, init),
};

export const OFF = "Enable GitHub in Settings to use GitHub.";
export const NO_KEY = "Add a GitHub token in Settings → GitHub to use GitHub.";
export const REFUSED = "GitHub refused the token. Create a new one in Settings → GitHub.";
export const SCOPES = `The GitHub token can't do this: it needs the ${GITHUB_TOKEN_SCOPES.join(", ")} scopes.`;

export type GithubApiErrorKind = "off" | "no-key" | "refused" | "forbidden" | "not-found" | "invalid" | "limited" | "failed";

/** Why a GitHub call didn't go through, in words for the view. */
export class GithubApiError extends Error {
  constructor(
    readonly kind: GithubApiErrorKind,
    message: string,
    readonly status?: number,
    /** When a rate limit lifts (ms since the epoch). */
    readonly retryAt?: number,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

/** The token, or why there's none to use. */
export function githubToken(): string {
  if (!integrationEnabled("github")) throw new GithubApiError("off", OFF);
  const token = integrationKey("github");
  if (!token) throw new GithubApiError("no-key", NO_KEY);
  return token;
}

/** Whether GitHub can be asked at all (on, with a token). */
export const githubReady = () => integrationEnabled("github") && !!integrationKey("github");

/** The scopes this app needs that a response's `X-OAuth-Scopes` doesn't list (`repo` covers its sub-scopes). */
export function missingScopes(headers: Headers): string[] {
  const raw = headers.get("x-oauth-scopes");
  if (raw === null) return [];
  const have = new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  return GITHUB_TOKEN_SCOPES.filter((s) => !have.has(s) && !(s === "read:org" && (have.has("admin:org") || have.has("write:org"))));
}

/** GitHub's message in a refused answer, clipped. */
function messageOf(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as { message?: unknown; errors?: unknown };
  const errors = Array.isArray(b.errors) ? b.errors : [];
  const first = errors.map((x) => (typeof x === "string" ? x : (x as { message?: unknown })?.message)).find((m) => typeof m === "string");
  const text = [b.message, first].filter((m) => typeof m === "string" && m).join(": ");
  return text ? text.slice(0, 300) : undefined;
}

async function failure(res: Response): Promise<GithubApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const said = messageOf(body);
  const remaining = res.headers.get("x-ratelimit-remaining");
  const reset = Number(res.headers.get("x-ratelimit-reset"));
  const after = Number(res.headers.get("retry-after"));
  if (res.status === 429 || (res.status === 403 && (remaining === "0" || /rate limit/i.test(said ?? "")))) {
    const retryAt = after > 0 ? Date.now() + after * 1000 : reset > 0 ? reset * 1000 : Date.now() + 60_000;
    return new GithubApiError("limited", "GitHub's rate limit is reached for now; it lifts shortly.", res.status, retryAt);
  }
  if (res.status === 401) return new GithubApiError("refused", REFUSED, 401);
  if (res.status === 403) {
    const missing = missingScopes(res.headers);
    return new GithubApiError("forbidden", missing.length ? SCOPES : said ? `GitHub refused: ${said}` : SCOPES, 403);
  }
  if (res.status === 404) return new GithubApiError("not-found", "GitHub can't find that, or the token can't see it.", 404);
  if (res.status === 406 || res.status === 422 || res.status === 400)
    return new GithubApiError("invalid", said ?? "GitHub refused the request.", res.status);
  return new GithubApiError("failed", said ? `GitHub didn't answer: ${said}` : "GitHub didn't answer.", res.status);
}

/** One request; non-2xx answers become `GithubApiError`. */
async function request(method: string, path: string, opts: { body?: unknown; accept?: string } = {}): Promise<Response> {
  const token = githubToken();
  const url = path.startsWith("https://") ? path : `${GITHUB_API.base}/${path.replace(/^\//, "")}`;
  if (!url.startsWith(`${GITHUB_API.base}/`)) throw new GithubApiError("invalid", "Not a GitHub API address.");
  const signal = AbortSignal.timeout(GITHUB_API.timeoutMs);
  let res: Response;
  try {
    res = await GITHUB_API.fetch(url, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: opts.accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "Paseo-Command",
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
  } catch (e) {
    const timedOut = (e as { name?: unknown })?.name === "TimeoutError" || (e as { name?: unknown })?.name === "AbortError";
    throw new GithubApiError("failed", timedOut ? "GitHub didn't answer in time." : "GitHub couldn't be reached.");
  }
  if (!res.ok) throw await failure(res);
  return res;
}

/** A REST call's JSON (null for an empty answer, such as 204), with its headers. */
export async function githubRest<T = unknown>(
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ data: T; headers: Headers }> {
  const res = await request(method, path, { body });
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new GithubApiError("failed", "GitHub's answer wasn't JSON.");
    }
  }
  return { data: data as T, headers: res.headers };
}

/** A GET's text in another media type (a pull request's diff: `application/vnd.github.diff`). */
export async function githubText(path: string, accept: string): Promise<string> {
  return (await request("GET", path, { accept })).text();
}

/** A paginated GET's items, following `Link: rel="next"` until `max` items. */
export async function githubPaged<T>(path: string, max: number): Promise<T[]> {
  const items: T[] = [];
  let next: string | undefined = path;
  while (next && items.length < max) {
    const res = await request("GET", next);
    const page = (await res.json()) as unknown;
    if (!Array.isArray(page)) break;
    items.push(...(page as T[]));
    next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get("link") ?? "")?.[1];
  }
  return items.slice(0, max);
}

/**
 * A GraphQL query's `data`. A query's partial answer (some fields refused)
 * stands; a mutation (`strict`) with any error fails with it.
 */
export async function githubGraphql(
  query: string,
  variables: Record<string, unknown> = {},
  strict = false,
): Promise<Record<string, unknown>> {
  const { data: body } = await githubRest<{ data?: unknown; errors?: unknown }>("POST", "graphql", { query, variables });
  const errors = Array.isArray(body?.errors) && body.errors.length > 0;
  if (body?.data && typeof body.data === "object" && !(strict && errors)) return body.data as Record<string, unknown>;
  if (errors) {
    const first = (body!.errors as { message?: unknown; type?: unknown }[])[0];
    if (first?.type === "RATE_LIMITED")
      throw new GithubApiError("limited", "GitHub's rate limit is reached for now; it lifts shortly.", undefined, Date.now() + 60_000);
    if (first?.type === "INSUFFICIENT_SCOPES") throw new GithubApiError("forbidden", SCOPES);
    throw new GithubApiError("failed", typeof first?.message === "string" ? first.message.slice(0, 300) : "GitHub refused the request.");
  }
  throw new GithubApiError("failed", "GitHub didn't answer.");
}
