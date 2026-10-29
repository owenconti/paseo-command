import type { IncomingMessage, ServerResponse } from "node:http";
import { readAttachmentImage } from "../attachment";
import { mainCommits } from "../commits";
import { LIMITS } from "../daemon";
import { assertReachable, invalidate } from "../fleet";
import { captureExtras, settle, streamFleet, streamSession } from "../live";
import { admissionClosed } from "../proc";
import { errorText } from "../wire";
import {
  agentDetailFor,
  agentGet,
  agentSnapshot,
  heldSession,
  sessionSource,
} from "./agents";
import { workingOn } from "../workingOn";
import { replyAsks } from "../asks";
import { probeRoute } from "../probe";
import {
  concludeFork,
  createFork,
  forkHost,
  forkOf,
  forkSupport,
  forksWithState,
  listForks,
  markFork,
} from "../forks";
import { finishGame, gamesRecord, nextGame, saveGameState } from "../games";
import { draftGet } from "./drafts";
import { presets, savePresets } from "../presets";
import { createTerminal, killTerminal, listTerminals } from "./terminals";
import {
  addProject,
  cloneProject,
  createProjectFolder,
  foldersGet,
} from "./projects";
import {
  FANOUT_KEYS,
  agentCommand,
  dispatchRoute,
  openAgent,
  uploadFile,
  type Changed,
} from "./commands";
import {
  HostOffline,
  hostChips,
  hostKey,
  hostRegistry,
  localStatus,
  registryKnown,
  registryNow,
  resolveHost,
  sdk,
  statusView,
} from "./hosts";
import { allowedOrigin, bodyOf, replier, shuttingDown } from "./http";
import { aggregate, labelCatalog, models, providers, usage } from "./reads";
import { startLive } from "./stream";
import { archiveSubagents, subagentTimeline } from "./subagents";
import { AGENT_COMMANDS, MAX_PROMPT, id } from "./validate";
import {
  archiveWorkspace,
  labelWorkspace,
  linearIssueFor,
  mergeQueueFor,
  pullRequestFor,
  renameWorkspace,
} from "./workspaces";

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (!url.pathname.startsWith("/api/")) return next();
  // Shutting down: nothing new is admitted, whatever the route.
  if (admissionClosed()) return shuttingDown(res);
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const reply = replier(res);
  // Requests may use any network address; browser access remains same-origin.
  const origin = allowedOrigin(req);
  if (!origin) return reply(403, { error: "Invalid request host" });
  if (req.headers.origin && req.headers.origin !== origin)
    return reply(403, { error: "Same-origin access only" });
  // The app's own commits on main: read from git, never the daemon.
  if (req.method === "GET" && url.pathname === "/api/commits") {
    if ([...url.searchParams.keys()].some((k) => k !== "since"))
      return reply(400, { error: "Unexpected parameters" });
    return reply(200, await commitsRoute(url.searchParams.get("since")));
  }
  // Preset prompts: this app's own settings file, never the daemon.
  if (url.pathname === "/api/presets") {
    if (url.search) return reply(400, { error: "Unexpected parameters" });
    if (req.method === "GET") return reply(200, presets());
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return reply(415, { error: "JSON required" });
    try {
      return reply(200, savePresets(await bodyOf(req, 2 * 1024 * 1024)));
    } catch (error) {
      return reply(400, { error: errorText(error) });
    }
  }
  // The mini games' record: this app's own file, never the daemon.
  if (url.pathname === "/api/games" || url.pathname.startsWith("/api/games/"))
    return gamesRoute(req, url.pathname, reply);
  startLive();
  try {
    const parts = url.pathname.split("/").filter(Boolean).slice(1);
    let result: unknown;
    if (req.method === "GET") {
      if (parts.length === 1 && parts[0] === "live") {
        if (url.search) return reply(400, { error: "Unexpected parameters" });
        await registryKnown();
        if (admissionClosed())
          return reply(503, { error: "The server is shutting down." });
        return streamFleet(req, res);
      }
      if (parts.length === 1) {
        switch (parts[0]) {
          case "asks":
            result = replyAsks.status();
            break;
          case "probe":
            result = await probeRoute();
            break;
          case "hosts": {
            await hostRegistry();
            const chips = captureExtras({
              hosts: hostChips(registryNow()),
              status: null,
            }).hosts;
            result = chips.rows;
            res.setHeader("X-Paseo-Rev", JSON.stringify({ "": chips.rev }));
            break;
          }
          case "agents":
          case "projects":
          case "workspaces":
          case "permissions": {
            const read = await aggregate(parts[0]);
            result = read.rows;
            res.setHeader("X-Paseo-Rev", JSON.stringify(read.revs));
            break;
          }
          case "providers": {
            const host = await resolveHost(url.searchParams.get("host"));
            if (host) assertReachable(host.serverId, host.label);
            result = await providers(host);
            break;
          }
          case "terminals":
            result = await listTerminals(url);
            break;
          case "usage":
            result = await usage();
            break;
          case "pull-request":
            result = await pullRequestFor(
              url.searchParams.get("workspace"),
              url.searchParams.get("host"),
            );
            break;
          case "merge-queue":
            result = await mergeQueueFor(
              url.searchParams.get("workspace"),
              url.searchParams.get("host"),
            );
            break;
          case "linear-issue":
            result = await linearIssueFor(url.searchParams.get("key"));
            break;
          case "folders":
            result = await foldersGet(url);
            break;
          case "workspace-labels": {
            const host = await resolveHost(url.searchParams.get("host"));
            if (host) assertReachable(host.serverId, host.label);
            result = await labelCatalog(host);
            break;
          }
          case "status": {
            await localStatus();
            const s = captureExtras({ hosts: [], status: statusView() }).status;
            res.setHeader("X-Paseo-Rev", JSON.stringify({ "": s.rev }));
            if (!s.value) throw new Error("The local daemon isn't answering.");
            result = s.value;
            break;
          }
          default:
            return reply(404, { error: "Unknown endpoint" });
        }
      } else if (
        parts[0] === "providers" &&
        parts.length === 3 &&
        parts[2] === "models"
      ) {
        const provider = id(parts[1]);
        const host = await resolveHost(url.searchParams.get("host"));
        if (host) assertReachable(host.serverId, host.label);
        result = await models(provider, host);
      } else if (
        parts[0] === "drafts" &&
        parts.length === 2 &&
        (parts[1] === "commands" || parts[1] === "files" || parts[1] === "prs")
      ) {
        result = await draftGet(parts[1], url);
      } else if (parts[0] === "attachments" && parts[1] === "image") {
        // Images the local daemon stored for sent prompts; nothing else is readable.
        // Validated and read through one descriptor (server/attachment.ts).
        const path = url.searchParams.get("path") || "";
        const bytes = await readAttachmentImage(path, LIMITS.imageBytes);
        if (!bytes) return reply(404, { error: "Not found" });
        res.statusCode = 200;
        res.setHeader(
          "Content-Type",
          IMAGE_MIME[path.split(".").pop()!.toLowerCase()],
        );
        res.setHeader("Cache-Control", "private, max-age=86400");
        return res.end(bytes);
      } else if (
        parts[0] === "agents" &&
        parts.length === 3 &&
        parts[2] === "live"
      ) {
        const agentId = id(parts[1]);
        const host = await resolveHost(url.searchParams.get("host"));
        if (admissionClosed())
          return reply(503, { error: "The server is shutting down." });
        return streamSession(req, res, sessionSource(agentId, host?.serverId));
      } else if (
        parts[0] === "agents" &&
        parts.length === 3 &&
        ["timeline", "commands", "config", "files", "github"].includes(parts[2])
      ) {
        const agentId = id(parts[1]);
        try {
          const host = await resolveHost(url.searchParams.get("host"));
          result = await agentGet(parts[2], agentId, host, url);
        } catch (error) {
          if (
            !(error instanceof HostOffline) ||
            parts[2] !== "timeline" ||
            url.searchParams.get("before")
          )
            throw error;
          result = heldSession("timeline", agentId, error);
        }
      } else if (
        parts[0] === "agents" &&
        parts.length === 5 &&
        parts[2] === "subagents" &&
        parts[4] === "timeline"
      ) {
        const host = await resolveHost(url.searchParams.get("host"));
        result = await subagentTimeline(id(parts[1]), id(parts[3]), host, url);
      } else if (
        parts[0] === "agents" &&
        parts.length === 3 &&
        parts[2] === "forks"
      ) {
        const agentId = id(parts[1]);
        const raw = url.searchParams.get("host");
        const host = await resolveHost(raw);
        const client = await sdk(host);
        result = {
          supported: forkSupport(client).supported,
          forks: await forksWithState(
            client,
            host,
            listForks(forkHost(raw), agentId),
          ),
        };
      } else if (parts[0] === "agents" && parts.length === 2) {
        const target = id(parts[1]);
        try {
          const host = await resolveHost(url.searchParams.get("host"));
          result = await agentDetailFor(target, host);
        } catch (error) {
          if (!(error instanceof HostOffline)) throw error;
          result = heldSession("detail", target, error);
        }
      } else return reply(404, { error: "Unknown endpoint" });
    } else if (
      req.method === "POST" &&
      parts[0] === "agents" &&
      parts.length === 3 &&
      parts[2] === "upload"
    ) {
      if (req.headers["content-type"] !== "application/octet-stream")
        return reply(415, { error: "Binary body required" });
      result = await uploadFile(req, parts[1], url.searchParams.get("host"));
    } else if (req.method === "POST") {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return reply(415, { error: "JSON required" });
      const agentAction =
        parts[0] === "agents" &&
        parts.length === 3 &&
        AGENT_COMMANDS.includes(parts[2]);
      // Prompts and new agents' missions may carry pasted screenshots.
      // Prompts may be long, multi-byte text; a char limit needs ~4x in bytes.
      const body = await bodyOf(
        req,
        parts[2] === "send" || (parts[0] === "dispatch" && parts.length === 1)
          ? 30 * 1024 * 1024
          : 4 * MAX_PROMPT + 16000,
      );
      // What the mutation could have changed, dropped once it has been issued,
      // whether or not it reported success (a timed-out send may still land).
      let changed: Changed | undefined;
      const mark = (c: Changed) => {
        changed = c;
      };
      try {
        if (parts[0] === "dispatch" && parts.length === 1)
          result = await dispatchRoute(body, mark);
        else if (parts[0] === "terminals" && parts.length === 2 && parts[1] === "create")
          result = await createTerminal(body);
        else if (parts[0] === "terminals" && parts.length === 2 && parts[1] === "kill")
          result = await killTerminal(body);
        else if (parts[0] === "projects" && parts.length === 2) {
          if (parts[1] === "add") result = await addProject(body, mark);
          else if (parts[1] === "create-folder")
            result = await createProjectFolder(body, mark);
          else if (parts[1] === "clone") result = await cloneProject(body, mark);
          else return reply(404, { error: "Unknown endpoint" });
        }
        else if (
          parts[0] === "workspaces" &&
          parts.length === 3 &&
          parts[2] === "archive"
        )
          result = await archiveWorkspace(parts[1], body, mark);
        else if (
          parts[0] === "workspaces" &&
          parts.length === 3 &&
          parts[2] === "labels"
        )
          result = await labelWorkspace(parts[1], body, mark);
        else if (
          parts[0] === "workspaces" &&
          parts.length === 3 &&
          parts[2] === "rename"
        )
          result = await renameWorkspace(parts[1], body, mark);
        else if (
          parts[0] === "agents" &&
          parts.length === 3 &&
          parts[2] === "working-on"
        ) {
          const host = await resolveHost(body.host, "write");
          const client = await sdk(host);
          const source = await agentSnapshot(client, id(parts[1]), host);
          result = await workingOn.request(client, hostKey(host), source);
        } else if (
          parts[0] === "agents" &&
          parts.length === 3 &&
          parts[2] === "asks"
        ) {
          const host = await resolveHost(body.host, "read");
          const client = await sdk(host);
          const source = await agentSnapshot(client, id(parts[1]), host);
          result = replyAsks.request(client, hostKey(host), source);
        } else if (
          parts[0] === "agents" &&
          parts.length === 3 &&
          parts[2] === "forks"
        ) {
          const host = await resolveHost(body.host, "write");
          result = await createFork(await sdk(host), host, id(parts[1]), body);
        } else if (parts[0] === "forks" && parts.length === 3) {
          const fork = forkOf(id(parts[1]));
          const action = parts[2];
          if (action === "conclude") {
            const host = await resolveHost(fork.host, "write");
            result = await concludeFork(await sdk(host), fork);
          } else if (action === "close" || action === "reopen" || action === "sent")
            result = markFork(fork, action);
          else return reply(404, { error: "Unknown endpoint" });
        } else if (agentAction)
          result = await agentCommand(parts[2], parts[1], body, mark);
        else if (
          parts[0] === "agents" &&
          parts.length === 4 &&
          parts[2] === "subagents" &&
          parts[3] === "archive"
        )
          result = await archiveSubagents(id(parts[1]), body, mark);
        else if (
          parts[0] === "agents" &&
          parts.length === 3 &&
          parts[2] === "open"
        )
          result = await openAgent(parts[1], body);
        else return reply(404, { error: "Unknown endpoint" });
      } finally {
        await settleChange(changed);
      }
    } else return reply(405, { error: "Method not allowed" });
    reply(200, result);
  } catch (error) {
    // Daemon errors can quote what they were given: never pass a secret on.
    reply(400, { error: errorText(error) });
  }
}

/** `?since=<sha>`: unchanged answers only say so. */
async function commitsRoute(since: string | null) {
  const view = await mainCommits();
  return view.available && since === view.head
    ? { available: true, head: view.head, unchanged: true }
    : view;
}

/**
 * Drop what a mutation could have changed, then let the host's feed re-read
 * now, so the answer (and the push that goes out before it) shows the
 * command's effect.
 */
async function settleChange(changed: Changed | undefined) {
  if (!changed) return;
  const keys =
    typeof changed.keys === "function" ? changed.keys() : changed.keys;
  if (keys.some((k) => FANOUT_KEYS.has(k))) keys.push("rows");
  if (keys.length)
    invalidate(hostKey(changed.host), changed.host?.target, keys);
  await settle(hostKey(changed.host));
}

async function gamesRoute(
  req: IncomingMessage,
  path: string,
  reply: ReturnType<typeof replier>,
) {
  try {
    if (req.method === "GET" && path === "/api/games") return reply(200, gamesRecord());
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return reply(415, { error: "JSON required" });
    const body = await bodyOf(req, 256 * 1024);
    if (path === "/api/games/state") return reply(200, saveGameState(body));
    if (path === "/api/games/finish") return reply(200, finishGame(body));
    if (path === "/api/games/next") return reply(200, nextGame());
    return reply(404, { error: "Unknown endpoint" });
  } catch (error) {
    reply(400, { error: errorText(error) });
  }
}
