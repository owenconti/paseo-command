import type { IncomingMessage, ServerResponse } from "node:http";
import { encode } from "../wire";
import type { Body } from "./validate";

/** Send a JSON answer (every `error` field redacted by `encode`). */
export type Reply = (code: number, value: unknown) => void;
export function replier(res: ServerResponse): Reply {
  return (code, value) => {
    res.statusCode = code;
    res.end(encode(value));
  };
}
/** The answer to any API request once the server has begun shutting down. */
export function shuttingDown(res: ServerResponse) {
  res.statusCode = 503;
  res.setHeader("Content-Type", "application/json");
  return res.end(JSON.stringify({ error: "The server is shutting down." }));
}
/** Only local clients and loopback hostnames may use the API or its sockets.
 * Restricting Host also prevents a rebinding hostname from reaching the daemon.
 * Origin checks at the call sites additionally prevent cross-origin access. */
export function allowedOrigin(req: {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string | null {
  const peer = req.socket?.remoteAddress;
  if (peer && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer))
    return null;
  if (req.headers["sec-fetch-site"] === "cross-site") return null;
  const host = req.headers.host;
  if (typeof host !== "string" || !host || /[\s/\\@?#]/.test(host)) return null;
  try {
    const url = new URL(`http://${host}`);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export async function rawBody(req: IncomingMessage, limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf =
      typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    size += buf.length;
    if (size > limit) throw new Error("Request too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
/** A JSON object body, at most `limit` bytes. */
export async function bodyOf(req: IncomingMessage, limit = 24000) {
  const data = (await rawBody(req, limit)).toString("utf8");
  const body: unknown = JSON.parse(data || "{}");
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Invalid request body");
  return body as Body;
}
