import type { IncomingMessage, ServerResponse } from "node:http";
import { readAttachmentImage } from "../attachment";
import { readRemoteImage } from "../remoteImage";
import { releasesView } from "../releases";
import { LIMITS } from "../daemon";
import { assertReachable } from "../fleet";
import { captureExtras, streamFleet, streamSession } from "../live";
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
import { readVisualPage } from "../visual";
import { linearRoute } from "../linear/route";
import { activityRoute } from "../activity/route";
import { githubRoute } from "../github/route";
import { changesFor } from "./changes";
import { filesAll, filesChanged, filesImage, filesRead, filesTree } from "./files";
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
import { changeDiffComments, listDiffComments } from "../diffComments";
import { appSettings, saveAppSettings } from "../settings";
import { saveSecret, secretsStatus } from "../secrets";
import { createEditorTerminal, createTerminal, killTerminal, listTerminals } from "./terminals";
import {
  addProject,
  removeProject,
  renameProject,
  cloneProject,
  createProjectFolder,
  foldersGet,
} from "./projects";
import {
  agentCommand,
  dispatchRoute,
  openAgent,
  uploadFile,
  type Changed,
} from "./commands";
import { profileEditor, profileFeatures, saveProfiles } from "./profiles";
import { settleChange } from "./settle";
import { poolRoute } from "../pool";
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
import {
  aggregate,
  labelCatalog,
  models,
  profiles,
  providers,
  usage,
} from "./reads";
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
  // Local clients and loopback Host only; browser access remains same-origin.
  const origin = allowedOrigin(req);
  if (!origin) return reply(403, { error: "Invalid request host" });
  if (req.headers.origin && req.headers.origin !== origin)
    return reply(403, { error: "Same-origin access only" });
  // The app's release notes: GitHub's, never the daemon.
  if (req.method === "GET" && url.pathname === "/api/releases") {
    if (url.search) return reply(400, { error: "Unexpected parameters" });
    return reply(200, await releasesView());
  }
  // Settings and preset prompts: this app's own settings file, never the daemon.
  if (url.pathname === "/api/settings") {
    if (url.search) return reply(400, { error: "Unexpected parameters" });
    if (req.method === "GET") return reply(200, appSettings());
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return reply(415, { error: "JSON required" });
    try {
      return reply(200, saveAppSettings(await bodyOf(req)));
    } catch (error) {
      return reply(400, { error: errorText(error) });
    }
  }
  if (url.pathname === "/api/secrets") {
    if (url.search) return reply(400, { error: "Unexpected parameters" });
    if (req.method === "GET") return reply(200, secretsStatus());
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    if (!req.headers["content-type"]?.startsWith("application/json"))
      return reply(415, { error: "JSON required" });
    try {
      const body = await bodyOf(req, 12000);
      const status = saveSecret(body);
      if (body.name === "typesafeApiKey") replyAsks.reset();
      return reply(200, status);
    } catch {
      // Neither parser nor filesystem errors may reflect a submitted key.
      return reply(400, { error: "Couldn't save the API key. Check that secrets.json is readable and writable, and enter a valid key." });
    }
  }
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
  // Workspaces' pending diff comments: this app's own file, never the daemon, the worktree or GitHub.
  if (url.pathname === "/api/diff-comments") {
    try {
      if (req.method === "GET") {
        for (const k of url.searchParams.keys()) if (k !== "workspace" && k !== "host") throw new Error(`Unexpected parameter ${k}`);
        return reply(200, { comments: listDiffComments(url.searchParams.get("host"), url.searchParams.get("workspace")) });
      }
      if (url.search) return reply(400, { error: "Unexpected parameters" });
      if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
      if (!req.headers["content-type"]?.startsWith("application/json"))
        return reply(415, { error: "JSON required" });
      return reply(200, changeDiffComments(await bodyOf(req, 1024 * 1024)));
    } catch (error) {
      return reply(400, { error: errorText(error) });
    }
  }
  // Linear members' avatars, for Activity's Linear rows (with the API key for Linear's own uploads).
  if (url.pathname.startsWith("/api/linear/")) return linearRoute(req, url, res, reply);
  // The Activity tab: GitHub and Linear notifications in one feed, never the daemon.
  if (url.pathname === "/api/activity" || url.pathname.startsWith("/api/activity/")) return activityRoute(req, url, reply);
  // The GitHub tab: named reads and whitelisted writes with the user's GitHub token, never the daemon.
  if (url.pathname.startsWith("/api/github/")) return githubRoute(req, url, reply);
  // Pool boxes: the paseo-boxes scripts on this Mac claim and release them; a claim then dispatches.
  if (url.pathname === "/api/pool" || url.pathname.startsWith("/api/pool/")) return poolRoute(req, url, reply);
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
          case "visual": {
            const host = await resolveHost(url.searchParams.get("host"));
            if (host) assertReachable(host.serverId, host.label);
            const client = await sdk(host);
            result = await readVisualPage(url.searchParams.get("id"), {
              invoke: (plugin, method, input) =>
                client.invokePluginRpc(plugin, method, input),
            });
            break;
          }
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
          case "profiles": {
            const host = await resolveHost(url.searchParams.get("host"));
            if (host) assertReachable(host.serverId, host.label);
            result = await profiles(host);
            break;
          }
          case "terminals":
            result = await listTerminals(url);
            break;
          case "changes":
            result = await changesFor(url.searchParams);
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
        parts[0] === "profiles" &&
        parts.length === 2 &&
        (parts[1] === "editor" || parts[1] === "features")
      ) {
        const host = await resolveHost(url.searchParams.get("host"));
        if (host) assertReachable(host.serverId, host.label);
        result =
          parts[1] === "editor"
            ? await profileEditor(host)
            : await profileFeatures(url, host);
      } else if (
        parts[0] === "drafts" &&
        parts.length === 2 &&
        (parts[1] === "commands" || parts[1] === "files" || parts[1] === "prs")
      ) {
        result = await draftGet(parts[1], url);
      } else if (parts[0] === "files" && parts.length === 2 && ["tree", "read", "all", "changed"].includes(parts[1])) {
        // The Files page: a workspace's folders and files, read through its host's daemon.
        const read = { tree: filesTree, read: filesRead, all: filesAll, changed: filesChanged }[parts[1] as "tree" | "read" | "all" | "changed"];
        result = await read(url.searchParams);
      } else if (parts[0] === "files" && parts.length === 2 && parts[1] === "image") {
        // A Markdown file's relative image: raster only, size-limited, inside the workspace.
        const { bytes, mime } = await filesImage(url.searchParams);
        res.statusCode = 200;
        res.setHeader("Content-Type", mime);
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "private, max-age=60");
        return res.end(bytes);
      } else if (parts[0] === "attachments" && parts[1] === "image") {
        // Prompt attachments and images observed in local agent transcripts.
        // Validated and read through one descriptor (server/attachment.ts).
        // With `host`, a remote host's, read through its daemon (server/remoteImage.ts).
        const path = url.searchParams.get("path") || "";
        const remote = await resolveHost(url.searchParams.get("host"));
        if (remote) {
          assertReachable(remote.serverId, remote.label);
          const image = await readRemoteImage(remote, path, LIMITS.imageBytes);
          if (!image) return reply(404, { error: "Not found" });
          res.statusCode = 200;
          res.setHeader("Content-Type", image.mime);
          res.setHeader("X-Content-Type-Options", "nosniff");
          res.setHeader("Cache-Control", "private, max-age=86400");
          return res.end(image.bytes);
        }
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
        else if (parts[0] === "profiles" && parts.length === 1)
          result = await saveProfiles(body, mark);
        else if (parts[0] === "terminals" && parts.length === 2 && parts[1] === "create")
          result = await createTerminal(body);
        else if (parts[0] === "terminals" && parts.length === 2 && parts[1] === "editor")
          result = await createEditorTerminal(body);
        else if (parts[0] === "terminals" && parts.length === 2 && parts[1] === "kill")
          result = await killTerminal(body);
        else if (parts[0] === "projects" && parts.length === 2) {
          if (parts[1] === "add") result = await addProject(body, mark);
          else if (parts[1] === "create-folder")
            result = await createProjectFolder(body, mark);
          else if (parts[1] === "clone") result = await cloneProject(body, mark);
          else return reply(404, { error: "Unknown endpoint" });
        } else if (parts[0] === "projects" && parts.length === 3) {
          if (parts[2] === "rename")
            result = await renameProject(parts[1], body, mark);
          else if (parts[2] === "remove")
            result = await removeProject(parts[1], body, mark);
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
