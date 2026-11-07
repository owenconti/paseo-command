/**
 * `/api/linear/avatar?user=<id>`: a workspace member's avatar, for Activity's
 * Linear rows (the address is Linear's, never the page's). `/api/linear/teams`:
 * the workspace's address and team keys, so the chat links issue keys
 * (`DE-7338`) only of the workspace's teams; empty while Linear is off, has no
 * key or can't answer. `/api/linear/issue-counts[?fresh=1]`: the issues assigned to
 * you, counted for the Village's dashboard (`readIssueCounts`). Nothing else of Linear is served to the page: Activity
 * reads and writes through its own route.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { linearAvatar } from "./avatar";
import { linearApiKey } from "./client";
import { readIssueCounts, readWorkspace } from "./reads";

/** The workspace's address and its teams' keys; none while Linear can't answer. */
export async function linearTeams(): Promise<{ urlKey: string; teams: string[] }> {
  if (!linearApiKey()) return { urlKey: "", teams: [] };
  try {
    const ws = await readWorkspace();
    return ws.urlKey ? { urlKey: ws.urlKey, teams: ws.teams.map((t) => t.key.toUpperCase()) } : { urlKey: "", teams: [] };
  } catch {
    return { urlKey: "", teams: [] };
  }
}

export async function linearRoute(
  req: IncomingMessage,
  url: URL,
  res: ServerResponse,
  reply: (status: number, body: unknown) => void,
): Promise<void> {
  const path = url.pathname.slice("/api/linear/".length);
  if (req.method === "GET" && path === "teams") {
    if ([...url.searchParams.keys()].length) return reply(400, { error: "Unexpected parameters" });
    return reply(200, await linearTeams());
  }
  if (req.method === "GET" && path === "issue-counts") {
    const keys = [...url.searchParams.keys()];
    if (keys.some((k) => k !== "fresh") || keys.length > 1 || (keys.length && url.searchParams.get("fresh") !== "1"))
      return reply(400, { error: "Unexpected parameters" });
    return reply(200, await readIssueCounts(keys.length === 1));
  }
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
