/**
 * The session header's links: the workspace's pull request and its Linear
 * issue (src/HeaderLinks.tsx draws them).
 *
 * - The PR is Paseo's (the workspace row's `pr`); when Paseo can't tell, the
 *   server asks `gh` (GET /api/pull-request). PR lookups refresh every 15
 *   seconds and never hold up the header.
 * - Its CI checks come with it. Its merge queue standing is Paseo's two flags
 *   (uses a queue, is in it); the entry's state and position are asked of
 *   the server (gh, GET /api/merge-queue) for checkouts on this machine.
 * - The Linear key comes from the branch, else the PR's title or body, else
 *   the agent's title. Its link needs the Linear workspace's URL slug, a
 *   one-time setting kept in settings.json with the app's other settings.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, readStore } from "./api";
import { useIntegrations, useSecretRevision } from "./integrationSettings";
import { linearSlug } from "./linearSlug";
import { branchKey, textKey } from "./display";
import { nativeRequest } from "./nativePlatform";
import { nativeAvailable } from "./worldBridge";
import type { MergeQueue, PullRequest, Workspace } from "./types";

// ── Pure parts (unit tested) ───────────────────────────────────────────────
/** An https URL as given, or null (nothing else is ever opened). */
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const BASE = /^(main|master|HEAD)?$/;
/** The PR worth a chip: one with an https link, on a branch other than main. */
export function prShown(
  pr: PullRequest | null | undefined,
  branch: string | undefined,
): PullRequest | null {
  if (!pr || BASE.test((branch ?? "").trim())) return null;
  return safeUrl(pr.url) ? pr : null;
}

const live = (pr: PullRequest) => pr.state === "open" || pr.state === "draft";

/** "lint, test +2 more": the first few names of a list. */
function names(list: { name: string }[], n = 3) {
  const shown = list.slice(0, n).map((c) => c.name);
  return list.length > n
    ? `${shown.join(", ")} +${list.length - n} more`
    : shown.join(", ");
}

/** The CI line of a PR's tooltip; null when CI is unknown or moot. */
export function ciSummary(pr: PullRequest): string | null {
  const ci = pr.ci;
  if (!ci || !live(pr)) return null;
  const failing = ci.checks.filter((c) => c.status === "failure");
  const pending = ci.checks.filter((c) => c.status === "pending");
  switch (ci.state) {
    case "failing":
      return failing.length
        ? `${failing.length === 1 ? "Check" : "Checks"} failing: ${names(failing)}`
        : "Checks failing";
    case "pending":
      return pending.length
        ? `${pending.length === 1 ? "Check" : "Checks"} pending: ${names(pending)}`
        : "Checks pending";
    case "passing":
      return "Checks passing";
    default:
      return "No checks";
  }
}

const QUEUE_STATE: Record<NonNullable<MergeQueue["state"]>, string> = {
  queued: "waiting",
  awaiting_checks: "awaiting checks",
  mergeable: "ready to merge",
  unmergeable: "unmergeable",
  locked: "locked",
};
/** "about 5 min", "about 2 h", "under a minute". */
function eta(seconds: number) {
  if (seconds < 60) return "under a minute";
  if (seconds < 3600) return `about ${Math.round(seconds / 60)} min`;
  return `about ${Math.round(seconds / 360) / 10} h`;
}
/** The merge queue line of a PR's tooltip; null when unknown or moot. */
export function queueSummary(pr: PullRequest, queue = pr.queue): string | null {
  if (!queue || !live(pr) || !queue.enabled) return null;
  if (!queue.queued) return "Merge queue required; not queued";
  const parts = [
    queue.position ? `position ${queue.position}` : "",
    queue.state ? QUEUE_STATE[queue.state] : "",
    queue.etaSeconds !== undefined ? `merges in ${eta(queue.etaSeconds)}` : "",
  ].filter(Boolean);
  return parts.length
    ? `In merge queue: ${parts.join(", ")}`
    : "In merge queue";
}

/** A PR chip's tooltip: its title, then its CI and merge queue lines. */
export function prTip(pr: PullRequest, queue = pr.queue): string {
  return [
    pr.title || `Pull request #${pr.number}`,
    ciSummary(pr),
    queueSummary(pr, queue),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The Linear issue key: branch, then PR title and body, then agent title. */
export function linearKey(from: {
  branch?: string | null;
  prTitle?: string | null;
  prBody?: string | null;
  agentTitle?: string | null;
}): string | null {
  return (
    branchKey(from.branch) ??
    textKey(from.prTitle) ??
    textKey(from.prBody) ??
    textKey(from.agentTitle) ??
    null
  );
}

export { linearSlug };

const KEY = /^[A-Z]{2,5}\d?-\d{1,6}$/;
export function linearUrl(slug: string, key: string): string | null {
  const s = linearSlug(slug);
  return s && KEY.test(key) ? `https://linear.app/${s}/issue/${key}` : null;
}

// ── The slug setting ───────────────────────────────────────────────────────
// Kept in settings.json (GET/POST /api/settings). This browser once kept it
// itself: such a value is moved into the file when the file has none.
const SLUG = "linear-workspace";
let slug = "";
const listeners = new Set<() => void>();
const show = (value: string) => {
  if (value === slug) return;
  slug = value;
  listeners.forEach((l) => l());
};
export function setLinearWorkspace(value: string) {
  const next = linearSlug(value) ?? "";
  show(next);
  // The file has it now: an old browser value mustn't come back.
  try {
    localStorage.removeItem(`paseo-command:${SLUG}`);
  } catch {}
  void api("settings", { linearWorkspace: next }).catch(() => {});
}
/** Read the setting from the file (on load, and as a window comes back). */
export async function refreshLinearWorkspace() {
  let saved: string;
  try {
    const r = await api<{ linearWorkspace?: string; error?: string | null }>(
      "settings",
    );
    if (r.error) return;
    saved = linearSlug(r.linearWorkspace || "") ?? "";
  } catch {
    return;
  }
  const kept = linearSlug(readStore<string>(SLUG, "") || "") ?? "";
  if (!saved && kept) {
    show(kept);
    try {
      await api("settings", { linearWorkspace: kept });
      localStorage.removeItem(`paseo-command:${SLUG}`);
    } catch {}
    return;
  }
  show(saved);
}
if (typeof window !== "undefined") {
  // Until the file answers, this browser's old value (if any) is shown.
  slug = linearSlug(readStore<string>(SLUG, "") || "") ?? "";
  void refreshLinearWorkspace();
  window.addEventListener("focus", () => void refreshLinearWorkspace());
}
export function useLinearWorkspace() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => slug,
  );
}

// ── Opening links ──────────────────────────────────────────────────────────
/**
 * Open a page in the system browser: through the desktop app's external-link
 * path when there is one (the web view never navigates), else a new tab.
 */
export function openExternal(url: string) {
  const href = safeUrl(url);
  if (!href) return;
  if (nativeAvailable())
    void nativeRequest("externalLink", { url: href }).catch(() => {});
  else window.open(href, "_blank", "noopener,noreferrer");
}

// ── Lookups (cached, never blocking) ───────────────────────────────────────
const TTL = 60000;
const PR_REFRESH_MS = 15000;
type Cached<T> = { at: number; value: Promise<T> };
const prs = new Map<string, Cached<PullRequest | null>>();
const issues = new Map<string, Cached<LinearIssue | null>>();
/** The queue answer, with the PR's state as GitHub has it now. */
type QueueFound = { queue: MergeQueue | null; state?: PullRequest["state"] };
const queues = new Map<string, Cached<QueueFound>>();
export type LinearIssue = {
  key: string;
  title: string;
  state: string;
  url: string;
};
function cached<T>(
  map: Map<string, Cached<T>>,
  key: string,
  read: () => Promise<T>,
  ttl = TTL,
) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = read();
  map.set(key, { at: Date.now(), value });
  return value;
}
/** Forget every looked-up PR and issue (tests). */
export function resetLinkCache() {
  prs.clear();
  issues.clear();
  queues.clear();
}

/**
 * The workspace's PR: Paseo's answer when the row has one, else the
 * server's (gh, for a checkout on this machine). Null while unknown.
 */
export function usePullRequest(workspace?: Workspace): PullRequest | null {
  const branch = workspace?.branch ?? "";
  const known = workspace?.pr;
  const ask =
    !!workspace && known === undefined && !BASE.test(branch.trim())
      ? `${workspace.host ?? ""}|${workspace.workspaceId}|${branch}`
      : "";
  const [found, setFound] = useState<{
    key: string;
    pr: PullRequest | null;
  } | null>(null);
  useEffect(() => {
    if (!ask || !workspace) return;
    let live = true;
    const query = new URLSearchParams({ workspace: workspace.workspaceId });
    if (workspace.host) query.set("host", workspace.host);
    const refresh = () => {
      void cached(
        prs,
        ask,
        () =>
          api<{ pr?: PullRequest | null }>(`pull-request?${query}`).then(
            (r) => r?.pr ?? null,
            () => null,
          ),
        PR_REFRESH_MS,
      ).then((pr) => live && setFound({ key: ask, pr }));
    };
    refresh();
    const timer = window.setInterval(refresh, PR_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
    // The workspace is read through `ask`, which names everything it uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `ask`
  }, [ask]);
  const pr = known !== undefined ? known : found?.key === ask ? found.pr : null;
  return prShown(pr, branch);
}

/**
 * Refresh the PR's state and queue together, even when Paseo reports it as
 * unqueued, closed or merged. GitHub's answer wins; unavailable lookups
 * fall back to the daemon. Keep polling while this header is mounted.
 */
export function useMergeQueue(
  workspace: Workspace | undefined,
  pr: PullRequest | null,
): { queue?: MergeQueue; state?: PullRequest["state"] } {
  const known = pr?.queue;
  const ask =
    workspace && pr
      ? `${workspace.host ?? ""}|${workspace.workspaceId}|${pr.url}|${pr.state}|${known?.queued ?? ""}`
      : "";
  const [found, setFound] = useState<({ key: string } & QueueFound) | null>(
    null,
  );
  useEffect(() => {
    if (!ask || !workspace) return;
    let alive = true;
    const query = new URLSearchParams({ workspace: workspace.workspaceId });
    if (workspace.host) query.set("host", workspace.host);
    const refresh = () => {
      void cached(
        queues,
        ask,
        () =>
          api<{
            available?: boolean;
            queue?: MergeQueue | null;
            state?: PullRequest["state"];
          }>(`merge-queue?${query}`).then(
            (r): QueueFound =>
              r?.available
                ? { queue: r.queue ?? null, state: r.state }
                : { queue: null },
            (): QueueFound => ({ queue: null }),
          ),
        PR_REFRESH_MS,
      ).then((r) => alive && setFound({ key: ask, ...r }));
    };
    refresh();
    const timer = window.setInterval(refresh, PR_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
    // The workspace is read through `ask`, which names everything it uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `ask`
  }, [ask]);
  const mine = ask && found?.key === ask ? found : null;
  return {
    queue: mine?.queue || known,
    state: mine?.state,
  };
}

/** The issue's title and state, when the server has a Linear API key. */
export function useLinearIssue(key: string | null): LinearIssue | null {
  const secretRevision = useSecretRevision("linearApiKey");
  const { integrations } = useIntegrations();
  key = integrations.linear ? key : null;
  const [found, setFound] = useState<{
    key: string;
    issue: LinearIssue | null;
  } | null>(null);
  useEffect(() => {
    if (!key) return;
    setFound(null);
    if (secretRevision) issues.delete(key);
    let live = true;
    void cached(issues, key, () =>
      api<{ available?: boolean; issue?: LinearIssue | null }>(
        `linear-issue?key=${encodeURIComponent(key)}`,
      ).then(
        (r) => (r?.available && r.issue ? r.issue : null),
        () => null,
      ),
    ).then((issue) => live && setFound({ key, issue }));
    return () => {
      live = false;
    };
  }, [key, secretRevision]);
  return key && found?.key === key ? found.issue : null;
}
