/**
 * `/api/linear/…`: the named reads (`q/…`), Linear's uploaded images and, from
 * Task 6, the whitelisted writes (`m/:name`). No passthrough: an unknown name is a 404.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { IssueScope, LinearUnavailable } from "../../src/linear/types";
import { bodyOf, rawBody } from "../api/http";
import { errorText } from "../wire";
import { LinearError } from "./client";
import { avatarAllowed, linearAvatar, linearFile, linearImage } from "./image";
import { LINEAR_UPLOAD, uploadToLinear } from "./upload";
import { WRITES, linearWrite } from "./writes";
import {
  readCycles,
  readIssue,
  readIssues,
  readIssuesById,
  readNotifications,
  readSearch,
  readStatus,
  readSync,
  readViews,
  readWorkspace,
} from "./reads";


const WRITE_BODY_LIMIT = 1024 * 1024;

const isScope = (v: string): v is IssueScope =>
  v === "assigned" ||
  v === "created" ||
  v === "subscribed" ||
  /^team:[0-9a-f-]{8,64}:(triage|active|backlog|all)$/i.test(v) ||
  /^(project|cycle|view):[0-9a-f-]{8,64}$/i.test(v);

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

  // A file for Linear: its bytes, sent on with the key; the answer is its address on uploads.linear.app.
  if (req.method === "POST" && path === "upload") {
    if (!only("name", "type")) return reply(400, { error: "Unexpected parameters" });
    if (!/^application\/octet-stream\s*(;|$)/i.test(req.headers["content-type"] ?? ""))
      return reply(415, { error: "File bytes required" });
    let bytes: Buffer;
    try {
      bytes = await rawBody(req, LINEAR_UPLOAD.maxBytes);
    } catch (e) {
      if (e instanceof Error && e.message === "Request too large")
        return reply(413, { error: "Files up to 25 MB can be uploaded." });
      return reply(400, { error: errorText(e) });
    }
    try {
      return reply(200, await uploadToLinear(bytes, url.searchParams.get("name") ?? "", url.searchParams.get("type") ?? ""));
    } catch (e) {
      if (!(e instanceof LinearError)) return reply(502, { error: errorText(e) });
      if (e.kind === "limited") return reply(409, { error: e.message, ...(e.retryAt !== undefined ? { retryAt: e.retryAt } : {}) });
      if (e.kind === "refused") return reply(401, { error: e.message });
      if (e.kind === "no-key") return reply(503, { error: e.message });
      return reply(e.kind === "invalid" ? 400 : 502, { error: e.message });
    }
  }

  if (req.method === "POST" && /^m\/[^/]+$/.test(path)) {
    const name = path.slice(2);
    if (!Object.hasOwn(WRITES, name)) return reply(404, { error: "Unknown endpoint" });
    if (url.search) return reply(400, { error: "Unexpected parameters" });
    if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) return reply(415, { error: "JSON required" });
    let input: unknown;
    try {
      input = await bodyOf(req, WRITE_BODY_LIMIT);
    } catch (e) {
      if (e instanceof Error && e.message === "Request too large") return reply(413, { error: e.message });
      return reply(400, { error: errorText(e) });
    }
    try {
      return reply(200, await linearWrite(name, input));
    } catch (e) {
      if (!(e instanceof LinearError)) return reply(502, { error: errorText(e) });
      // A write that did not happen must not look like one that did: these are errors, not `LinearUnavailable`.
      if (e.kind === "limited") return reply(409, { error: e.message, ...(e.retryAt !== undefined ? { retryAt: e.retryAt } : {}) });
      if (e.kind === "refused") return reply(401, { error: e.message });
      if (e.kind === "no-key") return reply(503, { error: e.message });
      return reply(e.kind === "invalid" ? 400 : 502, { error: e.message });
    }
  }
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

  // A workspace member's avatar, by their id (the address is Linear's, never the page's).
  // Or another actor's (an app, a bot), by the address a notification named; never one Linear didn't.
  if (path === "avatar") {
    const byUrl = url.searchParams.has("url");
    if (!only(byUrl ? "url" : "user")) return reply(400, { error: "Unexpected parameters" });
    let avatarUrl: string | undefined;
    if (byUrl) {
      const asked = url.searchParams.get("url") ?? "";
      if (!avatarAllowed(asked)) return reply(404, { error: "No avatar" });
      avatarUrl = asked;
    } else {
      const id = url.searchParams.get("user") ?? "";
      try {
        avatarUrl = (await readWorkspace()).users.find((u) => u.id === id)?.avatarUrl;
      } catch {
        return reply(404, { error: "No avatar" });
      }
    }
    const avatar = await linearAvatar(avatarUrl);
    if (!avatar.bytes) return reply(avatar.status, { error: avatar.error });
    res.statusCode = 200;
    res.setHeader("Content-Type", avatar.type!);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.end(avatar.bytes);
    return;
  }

  // Any other file uploaded to Linear, as a download: never shown in the page as what it says it is.
  if (path === "file") {
    if (!only("url")) return reply(400, { error: "Unexpected parameters" });
    const file = await linearFile(url.searchParams.get("url") ?? "");
    if (!file.bytes) return reply(file.status, { error: file.error });
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name ?? "file")}`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(file.bytes);
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
    case "q/search":
      return read(["term"], () => readSearch(param("term")));
    case "q/notifications": {
      const after = url.searchParams.get("after") ?? undefined;
      if (after !== undefined && !/^[\w+/=.:-]{1,200}$/.test(after)) return reply(400, { error: "Invalid cursor" });
      return read(["after"], () => readNotifications(after));
    }
    case "q/views":
      return read([], () => readViews());
    case "q/cycles":
      return read(["team"], () => readCycles(param("team")));
    case "q/byId":
      return read(["ids"], () => readIssuesById(param("ids").split(",")));
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
