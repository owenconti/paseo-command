/**
 * `/api/slack/…`: the named reads (`q/…`), the whitelisted writes (`m/:name`),
 * uploads, Slack's private files and images, avatars, custom emoji and the
 * live events stream. No passthrough: an unknown name is a 404.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SlackUnavailable } from "../../src/slack/types";
import { bodyOf, rawBody } from "../api/http";
import { errorText } from "../wire";
import { SlackError } from "./client";
import { noteSlackDemand, streamSlackEvents } from "./events";
import { slackAvatar, slackEmoji, slackFile, slackImage, type Fetched } from "./files";
import { slackLive } from "./live";
import { CONVERSATION_ID, TS_PATTERN, readConversation, readHistory, readReplies, readSearch, readWorkspace } from "./reads";
import { ensureSlackSocket } from "./socket";
import { slackUnreads } from "./unreads";
import { SLACK_UPLOAD, uploadToSlack } from "./upload";
import { WRITES, slackWrite } from "./writes";
import { slackEnabled, slackUnavailable, slackUserToken } from "./client";

const WRITE_BODY_LIMIT = 1024 * 1024;

/** Slack can't be used right now (off, no token, refused, limited): a normal answer, not an error. */
const unavailable = (e: SlackError): SlackUnavailable => ({
  available: false,
  reason: e.message,
  ...(e.retryAt !== undefined ? { retryAt: e.retryAt } : {}),
});

/** A write's or upload's failure: it didn't happen, so it's an error, never `SlackUnavailable`. */
function writeError(e: unknown, reply: (status: number, body: unknown) => void) {
  if (!(e instanceof SlackError)) return reply(502, { error: errorText(e) });
  if (e.kind === "limited") return reply(409, { error: e.message, ...(e.retryAt !== undefined ? { retryAt: e.retryAt } : {}) });
  if (e.kind === "refused") return reply(401, { error: e.message });
  if (e.kind === "no-key") return reply(503, { error: e.message });
  return reply(e.kind === "invalid" ? 400 : 502, { error: e.message });
}

function send(res: ServerResponse, got: Fetched, cache: string, download = false) {
  res.statusCode = 200;
  res.setHeader("Content-Type", download ? "application/octet-stream" : got.type!);
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (download)
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(got.name ?? "file")}`);
  res.setHeader("Cache-Control", cache);
  res.end(got.bytes);
}

export async function slackRoute(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  reply: (status: number, body: unknown) => void,
): Promise<void> {
  const path = url.pathname.slice("/api/slack/".length);
  const only = (...names: string[]) => [...url.searchParams.keys()].every((k) => names.includes(k));
  const param = (name: string) => url.searchParams.get(name) ?? "";
  const optional = (name: string) => url.searchParams.get(name) ?? undefined;

  // A file for Slack: its bytes, sent on with the token; the answer is its id, shared later with the `share` write.
  if (req.method === "POST" && path === "upload") {
    if (!only("name", "type")) return reply(400, { error: "Unexpected parameters" });
    if (!/^application\/octet-stream\s*(;|$)/i.test(req.headers["content-type"] ?? ""))
      return reply(415, { error: "File bytes required" });
    let bytes: Buffer;
    try {
      bytes = await rawBody(req, SLACK_UPLOAD.maxBytes);
    } catch (e) {
      if (e instanceof Error && e.message === "Request too large") return reply(413, { error: "Files up to 50 MB can be uploaded." });
      return reply(400, { error: errorText(e) });
    }
    try {
      return reply(200, await uploadToSlack(bytes, param("name"), param("type")));
    } catch (e) {
      return writeError(e, reply);
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
      return reply(200, await slackWrite(name, input));
    } catch (e) {
      return writeError(e, reply);
    }
  }
  if (req.method !== "GET") return reply(404, { error: "Unknown endpoint" });

  // Images shared in Slack (files.slack.com), which load only with the token.
  if (path === "image") {
    if (!only("url")) return reply(400, { error: "Unexpected parameters" });
    const got = await slackImage(param("url"));
    if (!got.bytes) return reply(got.status, { error: got.error });
    return send(res, got, "private, max-age=86400");
  }
  // Any other file shared in Slack, as a download: never shown in the page as what it says it is.
  if (path === "file") {
    if (!only("url")) return reply(400, { error: "Unexpected parameters" });
    const got = await slackFile(param("url"));
    if (!got.bytes) return reply(got.status, { error: got.error });
    return send(res, got, "private, max-age=86400", true);
  }
  // A person's avatar, by their id (the address is Slack's, never the page's).
  if (path === "avatar") {
    if (!only("user")) return reply(400, { error: "Unexpected parameters" });
    const got = await slackAvatar(param("user"));
    if (!got.bytes) return reply(got.status, { error: got.error });
    return send(res, got, "private, max-age=3600");
  }
  // A custom emoji's image, by name.
  if (path === "emoji") {
    if (!only("name")) return reply(400, { error: "Unexpected parameters" });
    const got = await slackEmoji(param("name"));
    if (!got.bytes) return reply(got.status, { error: got.error });
    return send(res, got, "private, max-age=86400");
  }
  // Live events, while Slack is on with a token.
  if (path === "events") {
    if (url.search) return reply(400, { error: "Unexpected parameters" });
    if (!slackEnabled() || !slackUserToken()) return reply(200, { available: false, reason: slackUnavailable() });
    streamSlackEvents(req, res, slackLive());
    ensureSlackSocket();
    return;
  }

  const read = async (names: string[], run: () => Promise<unknown> | unknown) => {
    if (!only(...names)) return reply(400, { error: "Unexpected parameters" });
    try {
      return reply(200, await run());
    } catch (e) {
      if (!(e instanceof SlackError)) return reply(502, { error: errorText(e) });
      if (e.kind === "no-key" || e.kind === "refused" || e.kind === "limited") return reply(200, unavailable(e));
      return reply(e.kind === "invalid" ? 400 : 502, { error: e.message });
    }
  };
  const conversation = (name: string) => CONVERSATION_ID.test(param(name));
  const tsOk = (name: string, required = false) => {
    const v = optional(name);
    return v === undefined ? !required : TS_PATTERN.test(v);
  };

  switch (path) {
    case "q/workspace":
      if (!["", "1"].includes(param("fresh"))) return reply(400, { error: "fresh must be 1" });
      return read(["fresh"], () => readWorkspace(param("fresh") === "1"));
    case "q/history":
      if (!only("conversation", "before")) return reply(400, { error: "Unexpected parameters" });
      if (!conversation("conversation")) return reply(400, { error: "Unknown conversation" });
      if (!tsOk("before")) return reply(400, { error: "before must be a message ts" });
      return read(["conversation", "before"], () => readHistory(param("conversation"), optional("before")));
    case "q/replies":
      if (!only("conversation", "ts", "after")) return reply(400, { error: "Unexpected parameters" });
      if (!conversation("conversation")) return reply(400, { error: "Unknown conversation" });
      if (!tsOk("ts", true) || !tsOk("after")) return reply(400, { error: "ts and after must be message ts" });
      return read(["conversation", "ts", "after"], () => readReplies(param("conversation"), param("ts"), optional("after")));
    case "q/conversation":
      if (!only("id")) return reply(400, { error: "Unexpected parameters" });
      if (!conversation("id")) return reply(400, { error: "Unknown conversation" });
      return read(["id"], async () => ({ conversation: await readConversation(param("id")) }));
    case "q/unreads":
      return read([], async () => {
        // The tracker learns which conversations to check from the workspace.
        await readWorkspace();
        noteSlackDemand();
        return slackUnreads();
      });
    case "q/search": {
      if (!only("term")) return reply(400, { error: "Unexpected parameters" });
      const term = param("term").trim();
      if (!term || term.length > 500) return reply(400, { error: "Search for 1 to 500 characters." });
      return read(["term"], () => readSearch(term));
    }
    default:
      return reply(404, { error: "Unknown endpoint" });
  }
}
