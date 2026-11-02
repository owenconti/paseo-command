import { readStore, writeStore } from "../api";
import { runAppCommand } from "../appCommands";
import { checkFilters, DEFAULT_FILTERS, type RepoFilters } from "./filters";
import { PR_SCOPES, REPO, type PrScope } from "./types";

/** A PR view's tabs. */
export type PrTab = "conversation" | "files" | "commits" | "checks";
export const PR_TABS: PrTab[] = ["conversation", "files", "commits", "checks"];

/**
 * Where the user is in the GitHub tab: the selected workspace's changes, a
 * list of pull requests, a repository's pull requests (its filters kept for
 * it, `readRepoFilters`), or one pull request (on one of its tabs, perhaps at a file).
 */
export type GithubPlace =
  | { kind: "changes" }
  | { kind: "prs"; scope: PrScope }
  | { kind: "repo"; repo: string }
  | { kind: "pr"; repo: string; number: number; tab: PrTab; path?: string };

const STORE_KEY = "github:place";
export const DEFAULT_PLACE: GithubPlace = { kind: "prs", scope: "review" };

/** A remembered (or otherwise untrusted) place as a valid one, else the default. */
export function checkPlace(raw: unknown): GithubPlace {
  if (!raw || typeof raw !== "object") return DEFAULT_PLACE;
  const p = raw as Record<string, unknown>;
  if (p.kind === "changes") return { kind: "changes" };
  if (p.kind === "prs" && PR_SCOPES.includes(p.scope as PrScope)) return { kind: "prs", scope: p.scope as PrScope };
  if (p.kind === "repo" && typeof p.repo === "string" && REPO.test(p.repo) && !p.repo.includes("..")) return { kind: "repo", repo: p.repo };
  if (
    p.kind === "pr" &&
    typeof p.repo === "string" &&
    REPO.test(p.repo) &&
    typeof p.number === "number" &&
    Number.isSafeInteger(p.number) &&
    p.number > 0
  ) {
    const tab = PR_TABS.includes(p.tab as PrTab) ? (p.tab as PrTab) : "conversation";
    const path = typeof p.path === "string" && p.path.length <= 1000 ? p.path : undefined;
    return { kind: "pr", repo: p.repo, number: p.number, tab, ...(path ? { path } : {}) };
  }
  return DEFAULT_PLACE;
}

export const samePlace = (a: GithubPlace, b: GithubPlace) => JSON.stringify(a) === JSON.stringify(b);

/** The remembered place (localStorage). */
export const readPlace = (): GithubPlace => checkPlace(readStore<unknown>(STORE_KEY, null));
export function writePlace(p: GithubPlace): void {
  writeStore(STORE_KEY, p);
}

// ── A repository's filters, kept for each (localStorage) ─────────────────────
const FILTERS_KEY = "github:repoFilters";
/** As many repositories' filters as are kept (the most recently set). */
const MAX_KEPT = 100;
const keptFilters = (): Record<string, unknown> => {
  const kept = readStore<unknown>(FILTERS_KEY, {});
  return kept && typeof kept === "object" && !Array.isArray(kept) ? (kept as Record<string, unknown>) : {};
};
export const readRepoFilters = (repo: string): RepoFilters => {
  const kept = keptFilters()[repo.toLowerCase()];
  return kept ? checkFilters(kept) : { ...DEFAULT_FILTERS };
};
export function writeRepoFilters(repo: string, filters: RepoFilters): void {
  const { [repo.toLowerCase()]: _, ...rest } = keptFilters();
  const entries = [...Object.entries(rest), [repo.toLowerCase(), checkFilters(filters)] as const].slice(-MAX_KEPT);
  writeStore(FILTERS_KEY, Object.fromEntries(entries));
}

/**
 * Opens a place in the GitHub tab: remembered for the view to read as it
 * mounts, and asked of it at once if it shows (`github-open`). Links to a
 * pull request, the workspace view's Changes and Activity call it.
 */
export function openGithubPlace(target: GithubPlace): void {
  const place = checkPlace(target);
  writePlace(place);
  runAppCommand("github-open", place);
}

/**
 * A pull request's address on github.com as its place:
 * `github.com/<owner>/<name>/pull/<n>[/files|/commits|/checks]`; else null.
 */
export function prPlaceOf(href: string): Extract<GithubPlace, { kind: "pr" }> | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname.toLowerCase() !== "github.com" && url.hostname.toLowerCase() !== "www.github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "pull" || !/^\d{1,9}$/.test(parts[3]!)) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  if (!REPO.test(repo)) return null;
  const tab: PrTab = parts[4] === "files" ? "files" : parts[4] === "commits" ? "commits" : parts[4] === "checks" ? "checks" : "conversation";
  return { kind: "pr", repo, number: Number(parts[3]), tab };
}

// ── The conversation's order, one for every PR (localStorage) ────────────────
export type ConversationOrder = "newest" | "oldest";
const ORDER_KEY = "github:conversationOrder";
export const readConversationOrder = (): ConversationOrder => (readStore<string>(ORDER_KEY, "newest") === "oldest" ? "oldest" : "newest");
export function writeConversationOrder(order: ConversationOrder): void {
  writeStore(ORDER_KEY, order);
}
