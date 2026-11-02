/**
 * The GitHub tab's favourites: starred repositories (`owner/name`) and
 * organizations (or users, by login), kept in the data directory's
 * `settings.json` as `githubStars: { repos, orgs }` (settings.ts: the file's
 * other keys are kept, an unreadable file is never overwritten). They're this
 * app's own, not GitHub's stars.
 */
import { OWNER, REPO, type GithubStars } from "../../src/github/types";
import { readSettings, writeSettings } from "../settings";
import { GithubApiError } from "./client";

/** As many of each as are kept. */
export const MAX_STARS = 100;

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isRepo = (v: unknown): v is string => typeof v === "string" && REPO.test(v) && !v.includes("..");
const isOrg = (v: unknown): v is string => typeof v === "string" && OWNER.test(v);

function unique(list: string[]): string[] {
  const out: string[] = [];
  for (const v of list) if (!out.some((o) => same(o, v))) out.push(v);
  return out.slice(0, MAX_STARS);
}

/** The stars in the settings file (none when it has none or can't be read). */
export function readStars(): GithubStars {
  const raw = readSettings()?.githubStars;
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    repos: unique(Array.isArray(o.repos) ? o.repos.filter(isRepo) : []),
    orgs: unique(Array.isArray(o.orgs) ? o.orgs.filter(isOrg) : []),
  };
}

/** Stars or unstars one repository or organization; the stars as saved. */
export function saveStar(kind: "repo" | "org", name: string, starred: boolean): GithubStars {
  if (kind === "repo" ? !isRepo(name) : !isOrg(name))
    throw new GithubApiError("invalid", kind === "repo" ? "Name the repository as owner/name" : "Name the organization by its login");
  if (!readSettings()) throw new GithubApiError("invalid", "settings.json can't be read: fix or remove it before starring here.");
  const stars = readStars();
  const key = kind === "repo" ? "repos" : "orgs";
  const rest = stars[key].filter((v) => !same(v, name));
  if (starred && rest.length >= MAX_STARS) throw new GithubApiError("invalid", `At most ${MAX_STARS} starred ${kind === "repo" ? "repositories" : "organizations"}`);
  const next: GithubStars = { ...stars, [key]: starred ? [...rest, name] : rest };
  writeSettings({ githubStars: next });
  return next;
}
