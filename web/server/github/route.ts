/**
 * `/api/github/…`: the GitHub tab's named reads (`GET q/viewer|prs|pr|diff`,
 * `fresh=1` past the cache) and whitelisted writes (`POST m/<name>`). No
 * passthrough: an unknown name is a 404. A read GitHub can't answer right now
 * (off, gh missing or signed out, refused) is a `GithubUnavailable` 200; a bad
 * parameter a 400. A write that didn't happen is an error.
 */
import type { IncomingMessage } from "node:http";
import { GITHUB_WRITES, PR_SCOPES, type GithubWriteName, type PrScope } from "../../src/github/types";
import { bodyOf } from "../api/http";
import { errorText } from "../wire";
import { assertEnabled, GithubTabError, unavailable } from "./client";
import { prParams, readDiff, readPr, readPrs, readViewer } from "./reads";
import { githubWrite } from "./writes";

const READS = ["viewer", "prs", "pr", "diff"] as const;
type ReadName = (typeof READS)[number];
/** A review with 100 drafted comments of some length fits; nothing larger is read. */
export const WRITE_BODY_LIMIT = 2 * 1024 * 1024;

function fresh(params: URLSearchParams): boolean {
  const f = params.get("fresh");
  if (f !== null && f !== "1") throw new GithubTabError("invalid", "Unexpected parameter fresh");
  return f === "1";
}
function only(params: URLSearchParams, allowed: string[]) {
  for (const k of new Set(params.keys())) if (!allowed.includes(k)) throw new GithubTabError("invalid", `Unexpected parameter ${k}`);
  for (const k of allowed) if (params.getAll(k).length > 1) throw new GithubTabError("invalid", `One ${k} only`);
}

async function read(name: ReadName, params: URLSearchParams): Promise<unknown> {
  switch (name) {
    case "viewer":
      only(params, ["fresh"]);
      assertEnabled();
      return readViewer(fresh(params));
    case "prs": {
      only(params, ["scope", "fresh"]);
      const scope = params.get("scope") as PrScope | null;
      if (!scope || !PR_SCOPES.includes(scope)) throw new GithubTabError("invalid", "Name the list: scope=review|mine|involved");
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
  const q = /^\/api\/github\/q\/([a-z]+)$/.exec(url.pathname)?.[1];
  if (q !== undefined) {
    if (!READS.includes(q as ReadName)) return reply(404, { error: "Unknown endpoint" });
    if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
    try {
      return reply(200, await read(q as ReadName, url.searchParams));
    } catch (e) {
      if (e instanceof GithubTabError) return e.kind === "invalid" ? reply(400, { error: e.message }) : reply(200, unavailable(e));
      return reply(502, { error: errorText(e) });
    }
  }
  const m = /^\/api\/github\/m\/([a-z]+)$/.exec(url.pathname)?.[1] as GithubWriteName | undefined;
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
    if (e instanceof GithubTabError) {
      const status = e.kind === "invalid" ? 400 : e.kind === "off" || e.kind === "no-gh" ? 503 : e.kind === "signed-out" ? 401 : 502;
      return reply(status, { error: e.message });
    }
    return reply(502, { error: errorText(e) });
  }
}
