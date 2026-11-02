/**
 * `/api/linear/avatar?user=<id>`: a workspace member's avatar, for Activity's
 * Linear rows (the address is Linear's, never the page's). Nothing else of
 * Linear is served to the page: Activity reads and writes through its own route.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { linearAvatar } from "./avatar";
import { readWorkspace } from "./reads";

export async function linearRoute(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  reply: (status: number, body: unknown) => void,
): Promise<void> {
  const path = url.pathname.slice("/api/linear/".length);
  if (req.method !== "GET" || path !== "avatar") return reply(404, { error: "Unknown endpoint" });
  if (![...url.searchParams.keys()].every((k) => k === "user")) return reply(400, { error: "Unexpected parameters" });
  const id = url.searchParams.get("user") ?? "";
  let avatarUrl: string | undefined;
  try {
    avatarUrl = (await readWorkspace()).users.find((u) => u.id === id)?.avatarUrl;
  } catch {
    return reply(404, { error: "No avatar" });
  }
  const avatar = await linearAvatar(avatarUrl);
  if (!avatar.bytes) return reply(avatar.status, { error: avatar.error });
  res.statusCode = 200;
  res.setHeader("Content-Type", avatar.type!);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.end(avatar.bytes);
}
