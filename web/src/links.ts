/**
 * The session header's links: the workspace's pull request and its Linear
 * issue (src/HeaderLinks.tsx draws them).
 *
 * - The PR is Paseo's (the workspace row's `pr`); when Paseo can't tell, the
 *   server asks `gh` (GET /api/pull-request). Answers are kept for a minute
 *   and never hold up the header.
 * - The Linear key comes from the branch, else the PR's title or body, else
 *   the agent's title. Its link needs the Linear workspace's URL slug, a
 *   one-time setting kept with the app's other settings.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { api, readStore, writeStore } from "./api";
import { branchKey, textKey } from "./display";
import { nativeRequest } from "./nativePlatform";
import { nativeAvailable } from "./worldBridge";
import type { PullRequest, Workspace } from "./types";

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

/** A Linear workspace's URL slug, typed bare or pasted as a linear.app URL. */
export function linearSlug(input: string): string | null {
  let s = input.trim().toLowerCase();
  const m = /^(?:https?:\/\/)?linear\.app\/([^/?#\s]+)/.exec(s);
  if (m) s = m[1];
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(s) ? s : null;
}

const KEY = /^[A-Z]{2,5}\d?-\d{1,6}$/;
export function linearUrl(slug: string, key: string): string | null {
  const s = linearSlug(slug);
  return s && KEY.test(key) ? `https://linear.app/${s}/issue/${key}` : null;
}

// ── The slug setting ───────────────────────────────────────────────────────
const SLUG = "linear-workspace";
let slug = linearSlug(readStore<string>(SLUG, "") || "") ?? "";
const listeners = new Set<() => void>();
export function setLinearWorkspace(value: string) {
  slug = linearSlug(value) ?? "";
  writeStore(SLUG, slug);
  listeners.forEach((l) => l());
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== `paseo-command:${SLUG}`) return;
    slug = linearSlug(readStore<string>(SLUG, "") || "") ?? "";
    listeners.forEach((l) => l());
  });
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
type Cached<T> = { at: number; value: Promise<T> };
const prs = new Map<string, Cached<PullRequest | null>>();
const issues = new Map<string, Cached<LinearIssue | null>>();
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
) {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = read();
  map.set(key, { at: Date.now(), value });
  return value;
}
/** Forget every looked-up PR and issue (tests). */
export function resetLinkCache() {
  prs.clear();
  issues.clear();
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
    void cached(prs, ask, () =>
      api<{ pr?: PullRequest | null }>(`pull-request?${query}`).then(
        (r) => r?.pr ?? null,
        () => null,
      ),
    ).then((pr) => live && setFound({ key: ask, pr }));
    return () => {
      live = false;
    };
    // The workspace is read through `ask`, which names everything it uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by `ask`
  }, [ask]);
  const pr = known !== undefined ? known : found?.key === ask ? found.pr : null;
  return prShown(pr, branch);
}

/** The issue's title and state, when the server has a Linear API key. */
export function useLinearIssue(key: string | null): LinearIssue | null {
  const [found, setFound] = useState<{
    key: string;
    issue: LinearIssue | null;
  } | null>(null);
  useEffect(() => {
    if (!key) return;
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
  }, [key]);
  return key && found?.key === key ? found.issue : null;
}
