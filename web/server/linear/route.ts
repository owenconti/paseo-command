/**
 * `/api/linear/…`: the named reads (`q/…`), Linear's uploaded images and, from
 * Task 6, the whitelisted writes (`m/:name`). No passthrough: an unknown name is a 404.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IssueScope, LinearUnavailable } from "../../src/linear/types";
import { errorText } from "../wire";
import { LinearError } from "./client";
import { linearImage } from "./image";
import { readIssue, readIssues, readStatus, readSync, readWorkspace } from "./reads";


const isScope = (v: string): v is IssueScope =>
  v === "assigned" ||
  v === "created" ||
  v === "subscribed" ||
  /^team:[0-9a-f-]{8,64}:(triage|active|backlog|all)$/i.test(v) ||
  /^project:[0-9a-f-]{8,64}$/i.test(v);

/** Linear can't be used right now (no key, refused, limited): a normal answer, not an error. */
const unavailable = (e: LinearError): LinearUnavailable => ({
  available: false,
  reason: e.message,
  ...(e.retryAt !== undefined ? { retryAt: e.retryAt } : {}),
});

export async function linearRoute(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  reply: (status: number, body: unknown) => void,
): Promise<void> {
  const path = url.pathname.slice("/api/linear/".length);
  const only = (...names: string[]) => [...url.searchParams.keys()].every((k) => names.includes(k));

  if (req.method === "POST" && /^m\/[^/]+$/.test(path)) return reply(404, { error: "Unknown endpoint" });
  if (req.method !== "GET") return reply(404, { error: "Unknown endpoint" });

  // Images uploaded to Linear, which load only with the API key.
  if (path === "image") {
    if (!only("url")) return reply(400, { error: "Unexpected parameters" });
    const image = await linearImage(url.searchParams.get("url") ?? "");
    if (!image.bytes) return reply(image.status, { error: image.error });
    res.statusCode = 200;
    res.setHeader("Content-Type", image.type!);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(image.bytes);
    return;
  }

  const read = async (names: string[], run: () => Promise<unknown> | unknown) => {
    if (!only(...names)) return reply(400, { error: "Unexpected parameters" });
    try {
      return reply(200, await run());
    } catch (e) {
      if (!(e instanceof LinearError)) return reply(502, { error: errorText(e) });
      if (e.kind === "no-key" || e.kind === "refused" || e.kind === "limited") return reply(200, unavailable(e));
      return reply(e.kind === "invalid" ? 400 : 502, { error: e.message });
    }
  };
  const param = (name: string) => url.searchParams.get(name) ?? "";

  switch (path) {
    case "q/workspace":
      return read(["fresh"], () => readWorkspace(param("fresh") === "1"));
    case "q/issues": {
      if (!only("scope", "after")) return reply(400, { error: "Unexpected parameters" });
      const scope = param("scope");
      if (!isScope(scope)) return reply(400, { error: "Unknown issue scope" });
      const after = url.searchParams.get("after") ?? undefined;
      if (after !== undefined && !/^[\w+/=.:-]{1,200}$/.test(after)) return reply(400, { error: "Invalid cursor" });
      return read(["scope", "after"], () => readIssues(scope, after));
    }
    case "q/issue":
      return read(["key"], async () => (await readIssue(param("key"))) ?? { issue: null });
    case "q/sync":
      return read(["since"], () => readSync(param("since")));
    case "q/status":
      return read([], () => readStatus());
    default:
      return reply(404, { error: "Unknown endpoint" });
  }
}
