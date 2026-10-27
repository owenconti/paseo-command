/**
 * The session header's links: a workspace's pull request and its Linear issue.
 *
 * The PR comes from Paseo first: the daemon reports each workspace's forge
 * facts (`githubRuntime.pullRequest`, the same field the Paseo app reads), so
 * remote hosts are covered too. Only when Paseo can't tell (an older daemon,
 * forge features off, its own lookup failing) is `gh pr view <branch>` run,
 * read-only, in the workspace's checkout on this machine; remote checkouts
 * are skipped. Answers are cached per checkout and branch for `GH.ttlMs`.
 *
 * Linear: Paseo stores no Linear link (no field in its protocol or app), so
 * the issue key is found in the browser (src/links.ts). With LINEAR_API_KEY
 * in the environment, the issue's title and state are read here for the
 * tooltip; without it nothing is fetched.
 */
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";

export type PrState = "open" | "draft" | "merged" | "closed";
export type PullRequest = {
  number: number;
  title: string;
  state: PrState;
  url: string;
  /** From gh only (Paseo doesn't report it): for finding a Linear key. */
  body?: string;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const httpsUrl = (v: unknown) => {
  try {
    const url = new URL(str(v));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
const numberOf = (n: unknown, url: string) =>
  typeof n === "number" && Number.isInteger(n) && n > 0
    ? n
    : Number(/\/pull\/(\d+)(?:[/?#]|$)/.exec(url)?.[1]) || 0;
function stateOf(state: unknown, merged: boolean, draft: boolean): PrState {
  const s = str(state).toLowerCase();
  if (merged || s === "merged") return "merged";
  if (s === "closed") return "closed";
  return draft ? "draft" : "open";
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * A workspace's PR as Paseo reports it: the PR, null when Paseo says there
 * is none, undefined when Paseo can't tell (then `gh` may be asked).
 */
export function prFromRuntime(
  runtime: unknown,
): PullRequest | null | undefined {
  if (!runtime || typeof runtime !== "object") return undefined;
  const rt = runtime as Record<string, unknown>;
  if (rt.featuresEnabled === false || rt.error) return undefined;
  if (rt.pullRequest === null) return null;
  const pr = rt.pullRequest as Record<string, unknown> | undefined;
  if (!pr || typeof pr !== "object") return undefined;
  const url = httpsUrl(pr.url);
  if (!url) return undefined;
  const number = numberOf(pr.number, url);
  if (!number) return undefined;
  return {
    number,
    title: clip(str(pr.title), 300),
    state: stateOf(pr.state, pr.isMerged === true, pr.isDraft === true),
    url,
  };
}

// ── gh fallback ────────────────────────────────────────────────────────────
export const GH = {
  ttlMs: 60000,
  timeoutMs: 10000,
  /** Where gh usually lives, for a helper started without a login PATH. */
  extraPath: ["/opt/homebrew/bin", "/usr/local/bin"],
};
export type GhAnswer = { available: boolean; pr: PullRequest | null };
/** Branches that never have a PR of their own. */
export const BASE_BRANCHES = /^(main|master|HEAD)?$/;

function gh(cwd: string, args: string[]) {
  // Read-only and non-interactive: no prompts, no update checks, no pager.
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env))
    if (!k.startsWith("GIT_")) env[k] = v;
  env.PATH = [env.PATH, ...GH.extraPath].filter(Boolean).join(delimiter);
  Object.assign(env, {
    GH_PROMPT_DISABLED: "1",
    GH_NO_UPDATE_NOTIFIER: "1",
    GH_PAGER: "cat",
    NO_COLOR: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
  });
  return new Promise<string>((done, fail) =>
    execFile(
      "gh",
      args,
      {
        cwd,
        env,
        encoding: "utf8",
        timeout: GH.timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout, stderr) =>
        error
          ? fail(Object.assign(error, { stderr: String(stderr ?? "") }))
          : done(stdout),
    ),
  );
}

function ghPr(raw: unknown): PullRequest | null {
  const pr = raw as Record<string, unknown> | null;
  const url = httpsUrl(pr?.url);
  if (!pr || !url) return null;
  const number = numberOf(pr.number, url);
  if (!number) return null;
  return {
    number,
    title: clip(str(pr.title), 300),
    state: stateOf(pr.state, false, pr.isDraft === true),
    url,
    ...(str(pr.body) ? { body: clip(str(pr.body), 4000) } : {}),
  };
}

const prCache = new Map<string, { at: number; value: Promise<GhAnswer> }>();

/**
 * The PR `gh` finds for `branch`, asked in `cwd` (a checkout on this
 * machine). Never throws: gh missing, signed out or failing is
 * `available: false`; "no pull requests found" is `pr: null`.
 */
export function ghPullRequest(
  cwd: string,
  branch: string,
  now = Date.now(),
): Promise<GhAnswer> {
  if (BASE_BRANCHES.test(branch.trim()))
    return Promise.resolve({ available: true, pr: null });
  if (!isAbsolute(cwd) || !isDirectory(cwd) || branch.startsWith("-"))
    return Promise.resolve({ available: false, pr: null });
  const key = `${cwd}\n${branch}`;
  const hit = prCache.get(key);
  if (hit && now - hit.at < GH.ttlMs) return hit.value;
  const value = gh(cwd, [
    "pr",
    "view",
    branch,
    "--json",
    "number,title,state,isDraft,url,body",
  ]).then(
    (out): GhAnswer => {
      try {
        return { available: true, pr: ghPr(JSON.parse(out)) };
      } catch {
        return { available: false, pr: null };
      }
    },
    (error: { code?: unknown; stderr?: string }): GhAnswer =>
      /no (open )?pull requests? found/i.test(error.stderr ?? "")
        ? { available: true, pr: null }
        : { available: false, pr: null },
  );
  prCache.set(key, { at: now, value });
  if (prCache.size > 500) prCache.delete(prCache.keys().next().value!);
  return value;
}
function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// ── Linear ─────────────────────────────────────────────────────────────────
export const LINEAR = {
  ttlMs: 60000,
  timeoutMs: 8000,
  endpoint: "https://api.linear.app/graphql",
  /** Tests inject this; nothing else calls Linear. */
  fetch: ((...args: Parameters<typeof fetch>) =>
    fetch(...args)) as typeof fetch,
};
export type LinearAnswer =
  | { available: false }
  | {
      available: true;
      issue: { key: string; title: string; state: string; url: string } | null;
    };
const KEY = /^([a-z]{2,5}\d?)-(\d{1,6})$/i;
const issueCache = new Map<
  string,
  { at: number; value: Promise<LinearAnswer> }
>();

/** The issue's title and state, when LINEAR_API_KEY is set; else unavailable. */
export function linearIssue(
  rawKey: string,
  now = Date.now(),
): Promise<LinearAnswer> {
  const key = rawKey.trim().toUpperCase();
  if (!KEY.test(key)) return Promise.reject(new Error("Invalid issue key"));
  const token = process.env.LINEAR_API_KEY?.trim();
  if (!token) return Promise.resolve({ available: false });
  const hit = issueCache.get(key);
  if (hit && now - hit.at < LINEAR.ttlMs) return hit.value;
  const value = (async (): Promise<LinearAnswer> => {
    const res = await LINEAR.fetch(LINEAR.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: token },
      body: JSON.stringify({
        query:
          "query Issue($id: String!) { issue(id: $id) { identifier title url state { name } } }",
        variables: { id: key },
      }),
      signal: AbortSignal.timeout(LINEAR.timeoutMs),
    });
    const body = (await res.json().catch(() => null)) as {
      data?: { issue?: Record<string, unknown> | null };
    } | null;
    const issue = body?.data?.issue;
    if (!res.ok || !body?.data) return { available: false };
    if (!issue) return { available: true, issue: null };
    const state = issue.state as { name?: unknown } | null;
    return {
      available: true,
      issue: {
        key: str(issue.identifier).toUpperCase() || key,
        title: clip(str(issue.title), 300),
        state: clip(str(state?.name), 60),
        url: httpsUrl(issue.url) ?? "",
      },
    };
  })().catch((): LinearAnswer => ({ available: false }));
  issueCache.set(key, { at: now, value });
  if (issueCache.size > 500) issueCache.delete(issueCache.keys().next().value!);
  return value;
}

export function resetLinks() {
  prCache.clear();
  issueCache.clear();
}
