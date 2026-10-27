import type { IncomingMessage } from "node:http";
import {
  LIMITS,
  attachments as validAttachments,
  behavior as validBehavior,
  images as validImages,
  permissionResponse,
} from "../daemon";
import { TUNING } from "../fleet";
import { feedOf } from "../live";
import { redactText } from "../redact";
import { agentSnapshot } from "./agents";
import { paseo } from "./cli";
import { rawBody } from "./http";
import {
  hostKey,
  resolveHost,
  sdk,
  timed,
  type DaemonClient,
  type Remote,
} from "./hosts";
import { currentWorkspaces, projectsOf, providers } from "./reads";
import {
  MAX_PROMPT,
  dispatchPlan,
  featureValue,
  id,
  newName,
  option,
  present,
  text,
  validateAgentPost,
  type Body,
  type DispatchPlan,
} from "./validate";

/**
 * What a mutation could have changed, dropped once it has been issued.
 * Keys may be a function: those that depend on what is known (a
 * workspace's members) are chosen when the mutation settles.
 */
export type Changed = { host?: Remote; keys: string[] | (() => string[]) };
/** Record what a mutation is about to change, before it is issued. */
export type Mark = (changed: Changed) => void;

type Attachments = NonNullable<
  Parameters<DaemonClient["sendMessage"]>[2]
>["attachments"];

/** The daemon's current record of an agent, read now (never cached or pushed). */
async function freshAgent(client: DaemonClient, agentId: string) {
  const r = await timed(client.fetchAgent(agentId), undefined, client);
  if (!r?.agent) throw new Error("Agent not found");
  return r.agent;
}
/** The daemon's current copy of a pending request, never a cached one. */
async function pendingRequest(
  client: DaemonClient,
  agentId: string,
  requestId: string,
) {
  const agent = await freshAgent(client, agentId);
  const request = (agent.pendingPermissions || []).find(
    (r) => r?.id === requestId,
  );
  if (!request) throw new Error("This request is no longer pending.");
  return request;
}
/** Whether the daemon may hold a finish (or failure) for the user to read:
 *  flagged (or not saying), and not for a request, which only an answer clears. */
const unreadFlag = (agent: {
  requiresAttention?: boolean;
  attentionReason?: string | null;
}) =>
  agent.requiresAttention !== false && agent.attentionReason !== "permission";
async function agentPost(
  action: string,
  agentId: string,
  host: Remote | undefined,
  body: Body,
) {
  const client = await sdk(host);
  const snapshot = await agentSnapshot(client, agentId, host);
  switch (action) {
    case "send": {
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      if (prompt.length > MAX_PROMPT || prompt.includes("\0"))
        throw new Error("Invalid prompt");
      const imgs = validImages(body.images);
      const files = validAttachments(body.attachments);
      if (!prompt.trim() && !imgs?.length && !files?.length)
        throw new Error("Nothing to send");
      const how = validBehavior(body.behavior);
      const messageId =
        body.messageId === undefined ? undefined : id(body.messageId);
      // No behavior: the daemon interrupts a running turn, as `paseo send` does.
      const sent = await timed(
        client.sendMessage(agentId, prompt, {
          ...(how ? { activeTurnBehavior: how } : {}),
          ...(messageId ? { messageId } : {}),
          ...(imgs?.length ? { images: imgs } : {}),
          // Checked field by field in daemon.ts (`attachments`).
          ...(files?.length ? { attachments: files as Attachments } : {}),
        }),
        TUNING.writeMs,
      );
      // Replying reads the reply, as sending a prompt in the Paseo app does.
      if (snapshot.requiresAttention === true && unreadFlag(snapshot))
        await timed(client.clearAgentAttention(agentId), TUNING.writeMs).catch(
          () => {
            // Best effort: the prompt went out; its reply stays flagged.
          },
        );
      return sent;
    }
    case "cancel":
      await timed(client.cancelAgent(agentId), TUNING.writeMs);
      return { ok: true };
    case "stop": {
      // Interrupts a running turn; a no-op otherwise (as `paseo stop`).
      if (body.confirm !== true) throw new Error("Stop requires confirmation");
      const agent = await freshAgent(client, agentId);
      if (agent.status !== "running") return { stoppedCount: 0, agentIds: [] };
      await timed(client.cancelAgent(agentId), TUNING.writeMs);
      return { stoppedCount: 1, agentIds: [agentId] };
    }
    case "archive": {
      // Never forced: a running agent must be stopped first.
      if (body.confirm !== true)
        throw new Error("Archive requires confirmation");
      const agent = await freshAgent(client, agentId);
      if (agent.archivedAt) throw new Error("This agent is already archived.");
      if (agent.status === "running")
        throw new Error("This agent is running. Stop it before archiving it.");
      const r = await timed(client.archiveAgent(agentId), TUNING.writeMs);
      // Older daemons answer a refusal with an `error` field.
      const refused = (Object(r) as { error?: unknown }).error;
      if (refused) throw new Error(redactText(String(refused)));
      feedOf(hostKey(host))?.exclude(agentId);
      return { agentId, status: "archived", archivedAt: r?.archivedAt ?? null };
    }
    case "mode": {
      const mode = id(body.mode);
      await freshAgent(client, agentId);
      const notice = await timed(
        client.setAgentMode(agentId, mode),
        TUNING.writeMs,
      );
      return { agentId, mode, notice: notice ?? null };
    }
    case "allow":
    case "deny": {
      const request = await pendingRequest(client, agentId, id(body.requestId));
      await client.respondToPermissionAndWait(
        agentId,
        request.id,
        permissionResponse(request, { behavior: action }),
        15000,
      );
      return { requestId: request.id, agentId, result: `${action}ed` };
    }
    case "model": {
      if (body.model !== null) option(body.model, "model");
      // Validated above: a model id, or null for the provider's default.
      const model = body.model as string | null;
      await timed(client.setAgentModel(agentId, model), TUNING.writeMs);
      return { ok: true };
    }
    case "thinking": {
      if (body.thinking !== null) option(body.thinking, "thinking option");
      const thinking = body.thinking as string | null;
      return {
        notice:
          (await timed(
            client.setAgentThinkingOption(agentId, thinking),
            TUNING.writeMs,
          )) ?? null,
      };
    }
    case "respond": {
      // Questions and custom actions: decided against the daemon's own copy.
      const requestId = text(body.requestId, "request", 200);
      const request = await pendingRequest(client, agentId, requestId);
      await client.respondToPermissionAndWait(
        agentId,
        requestId,
        permissionResponse(request, body),
        15000,
      );
      return { ok: true };
    }
    case "read":
      // The user has seen its reply: clear the daemon's attention flag, as
      // the Paseo app does when an agent is opened. Never for a request,
      // which only an answer clears, and not when nothing is flagged.
      if (!unreadFlag(snapshot)) return { ok: true, cleared: false };
      await timed(client.clearAgentAttention(agentId), TUNING.writeMs);
      return { ok: true, cleared: true };
    case "rename": {
      // The agent's title, as renaming it in the Paseo app sets it
      // (`updateAgent` with a name, which the daemon stores as its title).
      const name = newName(body.name);
      await timed(client.updateAgent(agentId, { name }), TUNING.writeMs);
      return { agentId, name };
    }
    case "feature": {
      const featureId = id(body.featureId);
      const v = featureValue(body.value);
      await timed(
        client.setAgentFeature(agentId, featureId, v),
        TUNING.writeMs,
      );
      return { ok: true };
    }
  }
  throw new Error("Unknown command");
}
/** `POST /api/agents/:id/:command`. */
export async function agentCommand(
  action: string,
  rawId: string,
  body: Body,
  mark: Mark,
) {
  const agentId = id(rawId);
  validateAgentPost(action, body);
  const host = await resolveHost(body.host, "write");
  mark({ host, keys: affectedKeys(action, agentId) });
  return agentPost(action, agentId, host, body);
}
/**
 * `POST /api/agents/:id/open`: Paseo Desktop runs on this machine; --server
 * selects a remote daemon. The SDK can't launch it.
 */
export async function openAgent(rawId: string, body: Body) {
  const host = await resolveHost(body.host, "write");
  await agentSnapshot(await sdk(host), id(rawId), host);
  return paseo(
    [
      "agent",
      "open",
      id(rawId),
      ...(host ? ["--server", id(host.serverId)] : []),
    ],
    false,
    undefined,
    TUNING.writeMs,
    true,
  );
}
/** `POST /api/agents/:id/upload`: a file for the agent's next prompt. */
export async function uploadFile(
  req: IncomingMessage,
  rawId: string,
  rawHost: string | null,
) {
  const host = await resolveHost(rawHost, "write");
  const client = await sdk(host);
  await agentSnapshot(client, id(rawId), host);
  const fileName = decodeURIComponent(String(req.headers["x-file-name"] || ""));
  const mimeType = String(
    req.headers["x-file-type"] || "application/octet-stream",
  );
  if (!fileName || fileName.length > 255 || /[/\\\0]/.test(fileName))
    throw new Error("Invalid file name");
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType))
    throw new Error("Invalid file type");
  const bytes = await rawBody(req, LIMITS.uploadBytes);
  const uploaded = await timed(
    client.uploadFile({
      fileName,
      mimeType,
      bytes: new Uint8Array(bytes),
    }),
    TUNING.writeMs,
  );
  if (uploaded?.error || !uploaded?.file)
    throw new Error(uploaded?.error || "Upload failed");
  return uploaded.file;
}

/** Create the workspace (if any) and the agent, as `paseo run --no-wait` does. */
async function dispatch(plan: DispatchPlan, host?: Remote) {
  const client = await sdk(host);
  let workspaceId: string, cwd: string;
  if (plan.workspace.kind === "existing") {
    workspaceId = plan.workspace.workspaceId;
    cwd = plan.workspace.cwd;
  } else {
    const source =
      plan.workspace.kind === "directory"
        ? { kind: "directory" as const, path: plan.workspace.path }
        : {
            kind: "worktree" as const,
            cwd: plan.workspace.cwd,
            action: "branch-off" as const,
            branchName: plan.workspace.branchName,
            ...(plan.workspace.baseBranch
              ? { baseBranch: plan.workspace.baseBranch }
              : {}),
          };
    const created = await timed(
      client.createWorkspace({ source }),
      TUNING.writeMs,
    );
    if (!created?.workspace)
      throw new Error(
        redactText(String(created?.error || "Couldn't create the workspace.")),
      );
    workspaceId = created.workspace.id;
    cwd =
      created.workspace.workspaceDirectory ??
      (plan.workspace.kind === "directory"
        ? plan.workspace.path
        : plan.workspace.cwd);
  }
  const agent = await timed(
    client.createAgent({ ...plan.agent, cwd, workspaceId }),
    TUNING.writeMs,
  );
  return {
    agentId: agent?.id,
    status: agent?.status === "running" ? "running" : "created",
    provider: agent?.provider,
    cwd: agent?.cwd,
    title: agent?.title,
    workspaceId,
  };
}
/** `POST /api/dispatch`: a new agent, in a new or an existing workspace. */
export async function dispatchRoute(body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  const [projects, available, activeWorkspaces] = await Promise.all([
    projectsOf(host),
    providers(host),
    // Revalidate workspaces against the daemon when dispatching into one.
    present(body.workspaceId) ? currentWorkspaces(host) : Promise.resolve([]),
  ]);
  const plan = dispatchPlan(body, projects, available, activeWorkspaces);
  mark({ host, keys: affectedKeys("dispatch") });
  return dispatch(plan, host);
}

/**
 * Cache keys (within the mutated host's scope) that a mutation could change.
 * Names ending in ":" are prefixes. Everything else, including other hosts and
 * other agents, stays cached.
 */
/** An agent's own records: its socket record and timeline. */
const agentKeys = (id: string) => [`agent:${id}`, `timeline:${id}:`];
/** Every agent's records on a host, when which agents changed isn't known. */
const ALL_AGENT_KEYS = ["agent:", "timeline:"];
/**
 * `members` are the agents a bulk mutation also changes (a workspace's
 * agents); "unknown" means they couldn't be listed, so every agent record on
 * the host is dropped rather than risk serving one stale.
 */
export function affectedKeys(
  action: string,
  subject?: string,
  members: string[] | "unknown" = "unknown",
): string[] {
  // The agent's own records, plus its row in the host's agent list (status,
  // model, thinking, mode and update time all show there).
  const agent = subject ? [...agentKeys(subject), "agents-unarchived"] : [];
  switch (action) {
    case "send":
      // Any send can interrupt or replace the turn, cancelling its approvals.
      return [...agent, "permissions"];
    case "stop":
    case "cancel":
      // A stopped turn drops its pending requests.
      return [...agent, "permissions"];
    case "allow":
    case "deny":
    case "respond":
      return [...agent, "permissions"];
    case "archive":
      // It leaves the active listing for the archive; its pending requests
      // go with it.
      return [...agent, "agents", "permissions"];
    case "mode":
      // A permissive mode can resolve pending requests; slash commands and
      // provider features follow the mode and model.
      return [...agent, `commands:${subject}`, "permissions"];
    case "model":
    case "thinking":
    case "feature":
      return [...agent, `commands:${subject}`];
    case "read":
      // Only its attention flag (its row) changes.
      return agent;
    case "rename":
      // Only its title: its own records and its row.
      return agent;
    case "workspace-rename":
      // Only the workspace's row: agents keep their own titles.
      return ["workspaces"];
    case "dispatch":
      // A new agent (possibly in a new worktree) that may ask for approval.
      return ["agents-unarchived", "agents", "workspaces", "permissions"];
    case "workspace-archive":
      // Its agents are archived with it: their rows, their approvals, and
      // each one's own records.
      return [
        "workspaces",
        "agents-unarchived",
        "agents",
        "permissions",
        ...(members === "unknown"
          ? ALL_AGENT_KEYS
          : members.flatMap(agentKeys)),
      ];
    default:
      // "open" only drives Paseo Desktop; uploads change nothing listed.
      return [];
  }
}
/** Fan-out keys: a mutation dropping any also drops the shared read round. */
export const FANOUT_KEYS = new Set([
  "agents",
  "agents-unarchived",
  "projects",
  "workspaces",
  "permissions",
]);
