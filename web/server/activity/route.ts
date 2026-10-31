/**
 * `/api/activity`: the feed (`GET`, `?fresh=1` past the sources' caches) and
 * the writes (`POST /api/activity/m/read|unread|done` with `{ keys }`). No other routes.
 */
import type { IncomingMessage } from "node:http";
import type { ActivityWriteName } from "../../src/activity/types";
import { bodyOf } from "../api/http";
import { errorText } from "../wire";
import { activityFeed, activityWrite } from "./feed";

export const ACTIVITY_KEY = /^(github|linear|slack):[\w:.-]{1,200}$/;
export const MAX_KEYS = 200;
const WRITES: ActivityWriteName[] = ["read", "unread", "done"];

/** A write's keys, checked: 1 to 200 item keys. */
export function checkKeys(body: unknown): string[] {
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || !keys.length) throw new Error("Name the items: keys");
  if (keys.length > MAX_KEYS) throw new Error(`At most ${MAX_KEYS} items at once`);
  const extra = Object.keys(body as object).filter((k) => k !== "keys");
  if (extra.length) throw new Error(`Unexpected field ${extra[0]}`);
  for (const key of keys) if (typeof key !== "string" || !ACTIVITY_KEY.test(key)) throw new Error("Invalid item key");
  return [...new Set(keys as string[])];
}

export async function activityRoute(
  req: IncomingMessage,
  url: URL,
  reply: (status: number, body: unknown) => void,
): Promise<void> {
  if (url.pathname === "/api/activity") {
    if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
    const params = [...url.searchParams];
    if (params.some(([k, v]) => k !== "fresh" || v !== "1") || params.length > 1)
      return reply(400, { error: "Unexpected parameters" });
    try {
      return reply(200, await activityFeed(params.length === 1));
    } catch (e) {
      return reply(502, { error: errorText(e) });
    }
  }
  const name = /^\/api\/activity\/m\/([a-z]+)$/.exec(url.pathname)?.[1] as ActivityWriteName | undefined;
  if (!name || !WRITES.includes(name)) return reply(404, { error: "Unknown endpoint" });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  if (url.search) return reply(400, { error: "Unexpected parameters" });
  if (!/^application\/json\s*(;|$)/i.test(req.headers["content-type"] ?? "")) return reply(415, { error: "JSON required" });
  let keys: string[];
  try {
    keys = checkKeys(await bodyOf(req, 64_000));
  } catch (e) {
    if (e instanceof Error && e.message === "Request too large") return reply(413, { error: e.message });
    return reply(400, { error: errorText(e) });
  }
  try {
    return reply(200, await activityWrite(name, keys));
  } catch (e) {
    return reply(502, { error: errorText(e) });
  }
}
