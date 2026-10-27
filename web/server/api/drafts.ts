/**
 * Suggestions for an agent not yet dispatched (the Dispatch dialog's mission):
 *
 * - `GET /api/drafts/commands?cwd=…&provider=…[&model=…&mode=…&thinking=…][&host=…]`:
 *   the /commands and skills a new agent with these settings would have.
 * - `GET /api/drafts/files?cwd=…&q=…[&host=…]`: @files in its folder.
 *
 * The folder must be a workspace's or project's on that host: nothing else is
 * listed. Reads only.
 */
import { remember, scopeOf } from "../fleet";
import { resolveHost, sdk, timed } from "./hosts";
import { aggregate } from "./reads";
import { id, query } from "./validate";

const text = (url: URL, key: string) => {
  const value = url.searchParams.get(key) ?? "";
  if (value.length > 200 || value.includes("\0")) throw new Error(`Invalid ${key}`);
  return value;
};

/** The draft's folder, if it is one of the host's workspaces or projects. */
async function knownFolder(url: URL, host: string) {
  const cwd = url.searchParams.get("cwd") ?? "";
  if (!cwd || cwd.length > 4096 || cwd.includes("\0")) throw new Error("A folder is required");
  const [workspaces, projects] = await Promise.all([
    aggregate("workspaces"),
    aggregate("projects"),
  ]);
  const here = (row: { host?: string | null }) => (row.host || "") === host;
  const known =
    (workspaces.rows as { cwd?: string; host?: string }[]).some(
      (w) => here(w) && w.cwd === cwd,
    ) ||
    (projects.rows as { path?: string; host?: string }[]).some(
      (p) => here(p) && p.path === cwd,
    );
  if (!known) throw new Error("Not a workspace or project folder");
  return cwd;
}

export async function draftGet(kind: string, url: URL) {
  const host = await resolveHost(url.searchParams.get("host"));
  const cwd = await knownFolder(url, host?.serverId || "");
  const client = await sdk(host);
  if (kind === "commands") {
    const provider = id(text(url, "provider"));
    const model = text(url, "model"),
      modeId = text(url, "mode"),
      thinkingOptionId = text(url, "thinking");
    const draftConfig = {
      provider,
      cwd,
      ...(model ? { model } : {}),
      ...(modeId ? { modeId } : {}),
      ...(thinkingOptionId ? { thinkingOptionId } : {}),
    };
    const key = `${scopeOf(host?.target)}|draft-commands:${JSON.stringify(draftConfig)}`;
    return remember(key, 60000, () =>
      // No agent has this ID, so the daemon lists for the draft's settings.
      timed(client.listCommands({ agentId: "draft", draftConfig }), undefined, client).then(
        (r) => ({
          error: r.error ?? null,
          commands: (Array.isArray(r.commands) ? r.commands : []).map((c) => ({
            name: String(c.name),
            description: String(c.description || ""),
            argumentHint: String(c.argumentHint || ""),
            kind: c.kind === "skill" ? "skill" : "command",
          })),
        }),
      ),
    );
  }
  const r = await timed(
    client.getDirectorySuggestions({
      cwd,
      query: query(url),
      includeFiles: true,
      includeDirectories: true,
      limit: 20,
    }),
  );
  return {
    entries: (r.entries || []).map((e) => ({ path: String(e.path), kind: e.kind })),
    error: r.error ?? null,
  };
}
