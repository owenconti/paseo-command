/**
 * `/api/github/…`: the GitHub tab's named reads (`GET q/viewer|prs|repos|repoSearch|people|teams|pr|diff|prCounts`,
 * `fresh=1` past the cache) and whitelisted writes (`POST m/<name>`). No
 * passthrough: an unknown name is a 404. A read GitHub can't answer right now
 * (off, no token, refused, limited) is a `GithubUnavailable` 200; a bad
 * parameter a 400. A write that didn't happen is an error.
 */
import type { IncomingMessage } from "node:http";
import { GITHUB_WRITES, PR_SCOPES, REPO, type GithubWriteName, type PrScope } from "../../src/github/types";
import { bodyOf } from "../api/http";
import { errorText } from "../wire";
import { apiFailure, assertEnabled, GithubApiError, unavailable, writeStatus } from "./client";
import { checkFilters, FILTER_FIELDS, FILTERS, isPeople, MAX_PEOPLE, MAX_SEARCHES, PERSON, searchCount } from "../../src/github/filters";
import { prParams, readDiff, readPrCounts, readPeople, readPr, readTeams, readPrs, readRepoPrs, readRepoSearch, readRepos, readViewer } from "./reads";
import { githubWrite } from "./writes";

import { COMMIT_SHA, readMainCommits, readMainCommit } from "./commits";

const READS = ["commits", "commit", "viewer", "prs", "repos", "repoSearch", "people", "teams", "pr", "diff", "prCounts"] as const;
type ReadName = (typeof READS)[number];
/** A review with 100 drafted comments of some length fits; nothing larger is read. */
export const WRITE_BODY_LIMIT = 2 * 1024 * 1024;

function fresh(params: URLSearchParams): boolean {
  const f = params.get("fresh");
  if (f !== null && f !== "1") throw new GithubApiError("invalid", "Unexpected parameter fresh");
  return f === "1";
}
function repoParam(params: URLSearchParams): string {
  const repo = params.get("repo") ?? "";
  if (!REPO.test(repo) || repo.includes("..")) throw new GithubApiError("invalid", "Name the repository: repo=owner/name");
  return repo;
}
function only(params: URLSearchParams, allowed: string[]) {
  for (const k of new Set(params.keys())) if (!allowed.includes(k)) throw new GithubApiError("invalid", `Unexpected parameter ${k}`);
  for (const k of allowed) if (params.getAll(k).length > 1) throw new GithubApiError("invalid", `One ${k} only`);
}

async function read(name: ReadName, params: URLSearchParams): Promise<unknown> {
  switch (name) {
    case "commits": {
      only(params, ["repo", "head", "after", "fresh"]);
      const repo = repoParam(params), head = params.get("head") ?? "", after = params.get("after") ?? "";
      if ((head && !COMMIT_SHA.test(head)) || after.length > 512 || /[\x00-\x1f]/.test(after) || (after && !head)) throw new GithubApiError("invalid", "History needs a valid head and cursor.");
      const f = fresh(params); assertEnabled();
      return readMainCommits(repo, head, after, f);
    }
    case "commit": {
      only(params, ["repo", "sha", "fresh"]);
      const repo = repoParam(params), sha = params.get("sha") ?? "";
      if (!COMMIT_SHA.test(sha)) throw new GithubApiError("invalid", "Name the commit by its full SHA.");
      const f = fresh(params); assertEnabled();
      return readMainCommit(repo, sha, f);
    }
    case "viewer":
      only(params, ["fresh"]);
      assertEnabled();
      return readViewer(fresh(params));
    case "prCounts":
      // Never unavailable: off, no token and GitHub's refusals are its own `state`.
      only(params, ["fresh"]);
      return readPrCounts(fresh(params));
    case "repos":
      only(params, ["fresh"]);
      assertEnabled();
      return readRepos(fresh(params));
    case "repoSearch": {
      only(params, ["q", "fresh"]);
      const text = params.get("q") ?? "";
      if (!text.trim() || text.length > 200) throw new GithubApiError("invalid", "Find a repository by its name, owner/name or owner: q=");
      const f = fresh(params);
      assertEnabled();
      return readRepoSearch(text, f);
    }
    case "people":
    case "teams": {
      only(params, ["repo", "fresh"]);
      const repo = repoParam(params);
      const f = fresh(params);
      assertEnabled();
      return name === "people" ? readPeople(repo, f) : readTeams(repo, f);
    }
    case "prs": {
      if (params.has("repo")) {
        only(params, ["repo", ...FILTER_FIELDS, "fresh"]);
        const repo = repoParam(params);
        const raw: Record<string, string | string[]> = {};
        for (const field of FILTER_FIELDS) {
          const v = params.get(field);
          if (v === null) continue;
          if (isPeople(field)) {
            const people = v.split(",");
            if (people.length > MAX_PEOPLE || people.some((p) => !PERSON.test(p))) throw new GithubApiError("invalid", `Unexpected ${field}`);
            raw[field] = people;
          } else if (!Object.hasOwn(FILTERS[field].values, v)) throw new GithubApiError("invalid", `Unexpected ${field}`);
          else raw[field] = v;
        }
        const filters = checkFilters(raw);
        if (searchCount(filters) > MAX_SEARCHES || FILTER_FIELDS.some((field) => isPeople(field) && raw[field] && filters[field]?.length !== raw[field]!.length))
          throw new GithubApiError("invalid", `Choose fewer people: these filters would take more than ${MAX_SEARCHES} of GitHub's searches`);
        const f = fresh(params);
        assertEnabled();
        return readRepoPrs(repo, filters, f);
      }
      only(params, ["scope", "fresh"]);
      const scope = params.get("scope") as PrScope | null;
      if (!scope || !PR_SCOPES.includes(scope)) throw new GithubApiError("invalid", "Name the list: scope=review|mine|involved");
      assertEnabled();
      return readPrs(scope, fresh(params));
    }
    case "pr":
    case "diff": {
      only(params, ["repo", "number", "fresh"]);
      const { repo, number } = prParams(params);
      const f = fresh(params);
      assertEnabled();
      return name === "pr" ? readPr(repo, number, f) : readDiff(repo, number, f);
    }
  }
}

export async function githubRoute(
  req: IncomingMessage,
  url: URL,
  reply: (status: number, body: unknown) => void,
): Promise<void> {
  const q = /^\/api\/github\/q\/([a-zA-Z]+)$/.exec(url.pathname)?.[1];
  if (q !== undefined) {
    if (!READS.includes(q as ReadName)) return reply(404, { error: "Unknown endpoint" });
    if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
    try {
      return reply(200, await read(q as ReadName, url.searchParams));
    } catch (e) {
      const f = apiFailure(e);
      if (f.kind === "invalid" && !(f.status && f.status >= 400)) return reply(400, { error: f.message });
      return reply(200, unavailable(f));
    }
  }
  const m = /^\/api\/github\/m\/([a-zA-Z]+)$/.exec(url.pathname)?.[1] as GithubWriteName | undefined;
  if (!m || !GITHUB_WRITES.includes(m)) return reply(404, { error: "Unknown endpoint" });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  if (url.search) return reply(400, { error: "Unexpected parameters" });
  if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) return reply(415, { error: "JSON required" });
  let body: unknown;
  try {
    body = await bodyOf(req, WRITE_BODY_LIMIT);
  } catch (e) {
    if (e instanceof Error && e.message === "Request too large") return reply(413, { error: e.message });
    return reply(400, { error: "Invalid request body" });
  }
  try {
    return reply(200, await githubWrite(m, body));
  } catch (e) {
    if (!(e instanceof GithubApiError)) return reply(502, { error: errorText(e) });
    return reply(writeStatus(e), { error: e.message });
  }
}
