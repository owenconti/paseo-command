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
 * CI: Paseo's `checks` and `checksStatus`, else gh's `statusCheckRollup`,
 * folded the way Paseo folds them. Merge queue: Paseo reports only whether
 * the base branch uses one and whether the PR is in it (its GitHub facts);
 * the entry's state, position and estimate come from a read-only
 * `gh api graphql` query in a local checkout (`ghMergeQueue`).
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
  /** Its head's CI checks; absent when unknown. */
  ci?: Ci;
  /** Its merge queue standing; absent when unknown. */
  queue?: MergeQueue;
};
/** One check as Paseo words it (GitHub's conclusions folded the same way). */
export type CheckStatus =
  "success" | "failure" | "pending" | "skipped" | "cancelled";
export type Check = { name: string; status: CheckStatus; url?: string };
/** The PR head's checks, rolled up as Paseo does (`computeChecksStatus`). */
export type CiState = "passing" | "failing" | "pending" | "none";
export type Ci = { state: CiState; checks: Check[] };
/** GitHub's `MergeQueueEntryState`, lower-cased. */
export type QueueState =
  "queued" | "awaiting_checks" | "mergeable" | "unmergeable" | "locked";
export type MergeQueue = {
  /** The base branch merges through a merge queue. */
  enabled: boolean;
  /** The PR is in it. */
  queued: boolean;
  /** Entry details, from gh only (Paseo reports just the two flags). */
  state?: QueueState;
  position?: number;
  enqueuedAt?: string;
  etaSeconds?: number;
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

// ── CI checks ──────────────────────────────────────────────────────────────
const CHECK_STATUSES = new Set<string>([
  "success",
  "failure",
  "pending",
  "skipped",
  "cancelled",
]);
const ROLLUP: Record<string, CiState> = {
  success: "passing",
  failure: "failing",
  pending: "pending",
  none: "none",
};
/** At most this many checks travel to the browser (failing ones first). */
export const MAX_CHECKS = 40;
const RANK: Record<CheckStatus, number> = {
  failure: 0,
  pending: 1,
  cancelled: 2,
  success: 3,
  skipped: 4,
};
function compactChecks(checks: Check[]): Check[] {
  return checks
    .map((c, i) => ({ c, i }))
    .sort((a, b) => RANK[a.c.status] - RANK[b.c.status] || a.i - b.i)
    .slice(0, MAX_CHECKS)
    .map(({ c }) => c);
}
/** As Paseo's `computeChecksStatus`: any failure, else any pending. */
export function rollUp(checks: Check[]): CiState {
  if (!checks.length) return "none";
  if (checks.some((c) => c.status === "failure")) return "failing";
  if (checks.some((c) => c.status === "pending")) return "pending";
  return "passing";
}
function check(name: unknown, status: CheckStatus, url: unknown): Check | null {
  const n = clip(str(name).trim(), 120);
  if (!n) return null;
  const href = httpsUrl(url);
  return { name: n, status, ...(href ? { url: href } : {}) };
}

/**
 * The checks Paseo reports on `githubRuntime.pullRequest` (`checks`,
 * `checksStatus`). Paseo's own rollup wins; without it the listed checks are
 * rolled up the same way. Undefined when Paseo reports neither.
 */
export function ciFromRuntime(pr: Record<string, unknown>): Ci | undefined {
  const listed = Array.isArray(pr.checks)
    ? pr.checks.flatMap((raw: unknown): Check[] => {
        const c = raw as Record<string, unknown> | null;
        const status = str(c?.status);
        if (!c || !CHECK_STATUSES.has(status)) return [];
        const found = check(c.name, status as CheckStatus, c.url);
        return found ? [found] : [];
      })
    : undefined;
  const rolled = ROLLUP[str(pr.checksStatus)];
  if (!rolled && !listed) return undefined;
  const checks = listed ?? [];
  return { state: rolled ?? rollUp(checks), checks: compactChecks(checks) };
}

/** A CheckRun's status and conclusion, folded as Paseo folds them. */
function checkRunStatus(status: unknown, conclusion: unknown): CheckStatus {
  if (str(status).toUpperCase() !== "COMPLETED") return "pending";
  switch (str(conclusion).toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
      return "failure";
    case "CANCELLED":
      return "cancelled";
    case "SKIPPED":
    case "NEUTRAL":
      return "skipped";
    default:
      return "pending";
  }
}
function statusContextState(state: unknown): CheckStatus {
  switch (str(state).toUpperCase()) {
    case "SUCCESS":
      return "success";
    case "FAILURE":
    case "ERROR":
      return "failure";
    default:
      return "pending";
  }
}
const timeOf = (...values: unknown[]) => {
  for (const v of values) {
    const t = Date.parse(str(v));
    if (Number.isFinite(t)) return t;
  }
  return 0;
};

/**
 * `gh pr view --json statusCheckRollup` as checks: check runs and commit
 * status contexts, one per name (a re-run's latest attempt wins). Undefined
 * when gh didn't answer the field.
 */
export function ciFromRollup(rollup: unknown): Ci | undefined {
  if (!Array.isArray(rollup)) return undefined;
  const byName = new Map<string, { check: Check; at: number }>();
  for (const raw of rollup) {
    const c = raw as Record<string, unknown> | null;
    if (!c || typeof c !== "object") continue;
    const context = c.__typename === "StatusContext" || "context" in c;
    const found = context
      ? check(c.context, statusContextState(c.state), c.targetUrl)
      : check(c.name, checkRunStatus(c.status, c.conclusion), c.detailsUrl);
    if (!found) continue;
    const at = timeOf(c.startedAt, c.createdAt, c.completedAt);
    const had = byName.get(found.name);
    if (!had || at >= had.at) byName.set(found.name, { check: found, at });
  }
  const checks = [...byName.values()].map((v) => v.check);
  return { state: rollUp(checks), checks: compactChecks(checks) };
}

// ── Merge queue ────────────────────────────────────────────────────────────
/**
 * The merge-queue flags Paseo reports among its GitHub facts
 * (`forgeSpecific`, or `github` as older daemons put it). No position or
 * state: those come from gh (`ghMergeQueue`). Undefined when absent.
 */
export function queueFromRuntime(
  pr: Record<string, unknown>,
): MergeQueue | undefined {
  for (const raw of [pr.forgeSpecific, pr.github]) {
    const facts = raw as Record<string, unknown> | null | undefined;
    if (!facts || typeof facts !== "object") continue;
    if (facts.forge !== undefined && facts.forge !== "github") continue;
    const { isMergeQueueEnabled: enabled, isInMergeQueue: queued } = facts;
    if (typeof enabled !== "boolean" && typeof queued !== "boolean") continue;
    return {
      enabled: enabled === true || queued === true,
      queued: queued === true,
    };
  }
  return undefined;
}

const QUEUE_STATES = new Set<string>([
  "queued",
  "awaiting_checks",
  "mergeable",
  "unmergeable",
  "locked",
]);
/** GitHub's GraphQL answer about one PR's merge queue standing. */
export function queueFromGraphql(raw: unknown): MergeQueue | null {
  const body = raw as {
    data?: { repository?: { pullRequest?: Record<string, unknown> | null } };
  } | null;
  const pr = body?.data?.repository?.pullRequest;
  if (!pr || typeof pr !== "object") return null;
  const entry = pr.mergeQueueEntry as Record<string, unknown> | null;
  const queued = pr.isInMergeQueue === true || !!entry;
  const out: MergeQueue = {
    enabled: pr.isMergeQueueEnabled === true || queued,
    queued,
  };
  if (entry && typeof entry === "object") {
    const state = str(entry.state).toLowerCase();
    if (QUEUE_STATES.has(state)) out.state = state as QueueState;
    const position = entry.position;
    if (typeof position === "number" && Number.isInteger(position))
      out.position = position;
    if (Number.isFinite(Date.parse(str(entry.enqueuedAt))))
      out.enqueuedAt = str(entry.enqueuedAt);
    const eta = entry.estimatedTimeToMerge;
    if (typeof eta === "number" && Number.isFinite(eta) && eta >= 0)
      out.etaSeconds = Math.round(eta);
  }
  return out;
}

/** The owner, repository and number of a github.com pull request URL. */
export function prCoordinates(url: string) {
  const m =
    /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})(?:[/?#]|$)/.exec(
      url,
    );
  return m ? { owner: m[1], name: m[2], number: Number(m[3]) } : null;
}

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
  const ci = ciFromRuntime(pr);
  const queue = queueFromRuntime(pr);
  return {
    number,
    title: clip(str(pr.title), 300),
    state: stateOf(pr.state, pr.isMerged === true, pr.isDraft === true),
    url,
    ...(ci ? { ci } : {}),
    ...(queue ? { queue } : {}),
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

/** `gh pr view --json …` as a PullRequest, its checks included. */
export function ghPr(raw: unknown): PullRequest | null {
  const pr = raw as Record<string, unknown> | null;
  const url = httpsUrl(pr?.url);
  if (!pr || !url) return null;
  const number = numberOf(pr.number, url);
  if (!number) return null;
  const ci = ciFromRollup(pr.statusCheckRollup);
  return {
    number,
    title: clip(str(pr.title), 300),
    state: stateOf(pr.state, false, pr.isDraft === true),
    url,
    ...(str(pr.body) ? { body: clip(str(pr.body), 4000) } : {}),
    ...(ci ? { ci } : {}),
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
    "number,title,state,isDraft,url,body,statusCheckRollup",
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
const QUEUE_QUERY = `query PullRequestMergeQueue($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      isMergeQueueEnabled
      isInMergeQueue
      mergeQueueEntry { state position estimatedTimeToMerge enqueuedAt }
    }
  }
}`;
export type QueueAnswer = { available: boolean; queue: MergeQueue | null };
const queueCache = new Map<
  string,
  { at: number; value: Promise<QueueAnswer> }
>();

/**
 * The PR's merge queue standing, from a read-only GraphQL query
 * (`gh api graphql`) run in `cwd`, a checkout on this machine; github.com
 * PRs only. Never throws: gh missing, signed out or failing is
 * `available: false`; a PR GitHub doesn't know is `queue: null`.
 */
export function ghMergeQueue(
  cwd: string,
  prUrl: string,
  now = Date.now(),
): Promise<QueueAnswer> {
  const at = prCoordinates(prUrl);
  if (!at || !isAbsolute(cwd) || !isDirectory(cwd))
    return Promise.resolve({ available: false, queue: null });
  const key = `${cwd}\n${at.owner}/${at.name}#${at.number}`;
  const hit = queueCache.get(key);
  if (hit && now - hit.at < GH.ttlMs) return hit.value;
  const value = gh(cwd, [
    "api",
    "graphql",
    "-f",
    `query=${QUEUE_QUERY}`,
    "-f",
    `owner=${at.owner}`,
    "-f",
    `name=${at.name}`,
    "-F",
    `number=${at.number}`,
  ]).then(
    (out): QueueAnswer => {
      try {
        return { available: true, queue: queueFromGraphql(JSON.parse(out)) };
      } catch {
        return { available: false, queue: null };
      }
    },
    (): QueueAnswer => ({ available: false, queue: null }),
  );
  queueCache.set(key, { at: now, value });
  if (queueCache.size > 500) queueCache.delete(queueCache.keys().next().value!);
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
  queueCache.clear();
  issueCache.clear();
}
