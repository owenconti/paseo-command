import { TUNING } from "../fleet";
import {
  BASE_BRANCHES,
  ghMergeQueue,
  ghPullRequest,
  linearIssue,
  type PullRequest,
} from "../links";
import { redactText } from "../redact";
import { affectedKeys, type Mark } from "./commands";
import { resolveHost, sdk, timed, type DaemonClient } from "./hosts";
import { aggregate, currentWorkspaces, labelCatalog } from "./reads";
import {
  id,
  workspaceArchiveCommand,
  workspaceLabelCommand,
  workspaceRenameCommand,
  type Body,
} from "./validate";

type LabelColor = Parameters<
  DaemonClient["setWorkspaceLabel"]
>[0]["label"]["color"];

/** `POST /api/workspaces/:id/archive`: the workspace and its agents. */
export async function archiveWorkspace(rawId: string, body: Body, mark: Mark) {
  const target = id(rawId);
  if (body.confirm !== true)
    throw new Error("Workspace archive requires confirmation");
  const host = await resolveHost(body.host, "write");
  // Revalidate against the daemon, not a cached copy.
  const { cwd } = workspaceArchiveCommand(
    target,
    body,
    await currentWorkspaces(host),
  );
  // Every agent record on the host goes: the feed may not know yet
  // every agent the daemon had in the workspace (they're 1s caches).
  mark({ host, keys: affectedKeys("workspace-archive", cwd) });
  const client = await sdk(host);
  const r = await timed(client.archiveWorkspace(target), TUNING.writeMs);
  if (r?.error) throw new Error(redactText(String(r.error)));
  return {
    workspaceId: target,
    status: "archived",
    archivedAt: r?.archivedAt ?? null,
  };
}

/** `POST /api/workspaces/:id/labels`: assign or remove a label. */
export async function labelWorkspace(rawId: string, body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  const [workspaces, catalog] = await Promise.all([
    currentWorkspaces(host),
    labelCatalog(host),
  ]);
  const command = workspaceLabelCommand(rawId, body, workspaces, catalog);
  mark({ host, keys: ["workspaces"] });
  const client = await sdk(host);
  // The colour is one of LABEL_COLORS, or the daemon's own for a known label.
  const color = command.label.color as LabelColor;
  const r = await timed(
    client.setWorkspaceLabel({
      ...command,
      label: { ...command.label, color },
    }),
    TUNING.writeMs,
  );
  return {
    workspaceId: command.workspaceId,
    label: command.label,
    labels: Array.isArray(r?.workspaceLabels) ? r.workspaceLabels : [],
  };
}

/**
 * `POST /api/workspaces/:id/rename`: the workspace's title, as renaming it
 * in the Paseo app sets it (`setWorkspaceTitle`); the daemon then names the
 * workspace by it.
 */
export async function renameWorkspace(rawId: string, body: Body, mark: Mark) {
  const host = await resolveHost(body.host, "write");
  const command = workspaceRenameCommand(
    rawId,
    body,
    await currentWorkspaces(host),
  );
  mark({ host, keys: affectedKeys("workspace-rename") });
  const client = await sdk(host);
  const r = await timed(
    client.setWorkspaceTitle(command.workspaceId, command.title),
    TUNING.writeMs,
  );
  return {
    workspaceId: command.workspaceId,
    name: typeof r?.title === "string" && r.title ? r.title : command.title,
  };
}

/**
 * `GET /api/pull-request?workspace=<id>[&host=<id>]`: the workspace's PR.
 * Paseo's own answer when it has one (the row's `pr`); otherwise, for a
 * checkout on this machine, a read-only `gh pr view` (server/links.ts).
 * Remote checkouts gh can't reach are skipped. Never fails for a lookup:
 * no PR, or none knowable, is `pr: null`.
 */
export async function pullRequestFor(rawId: string | null, rawHost: unknown) {
  const { host, ws } = await workspaceRowFor(rawId, rawHost);
  if (!ws) return { source: "none", available: false, pr: null };
  const branch = ws.branch || "";
  if (BASE_BRANCHES.test(branch.trim()))
    return { source: "none", available: true, pr: null };
  if (ws.pr !== undefined)
    return { source: "paseo", available: true, pr: ws.pr };
  if (host || !ws.cwd) return { source: "none", available: false, pr: null };
  const r = await ghPullRequest(ws.cwd, branch);
  return { source: r.available ? "gh" : "none", ...r };
}

async function workspaceRowFor(rawId: string | null, rawHost: unknown) {
  if (!rawId) throw new Error("A workspace is required");
  const workspaceId = id(rawId);
  const host = await resolveHost(rawHost);
  const rows = (await aggregate("workspaces")).rows as {
    workspaceId?: string;
    host?: string;
    cwd?: string;
    branch?: string;
    pr?: PullRequest | null;
  }[];
  const ws = rows.find(
    (w) =>
      w.workspaceId === workspaceId &&
      (w.host || "") === (host?.serverId || ""),
  );
  return { host, ws };
}

/**
 * `GET /api/merge-queue?workspace=<id>[&host=<id>]`: the merge queue
 * standing of the workspace's open PR (Paseo's PR, else gh's), from a
 * read-only `gh api graphql` query in a checkout on this machine. Remote
 * checkouts are skipped (`available: false`; the row's own `pr.queue`, from
 * Paseo, stands). Never fails for a lookup.
 */
export async function mergeQueueFor(rawId: string | null, rawHost: unknown) {
  const { host, ws } = await workspaceRowFor(rawId, rawHost);
  if (!ws || host || !ws.cwd) return { available: false, queue: null };
  const branch = ws.branch || "";
  if (BASE_BRANCHES.test(branch.trim()))
    return { available: true, queue: null };
  const pr =
    ws.pr !== undefined ? ws.pr : (await ghPullRequest(ws.cwd, branch)).pr;
  if (!pr || (pr.state !== "open" && pr.state !== "draft"))
    return { available: true, queue: null };
  return ghMergeQueue(ws.cwd, pr.url);
}

/** `GET /api/linear-issue?key=ABC-123`: title and state, with LINEAR_API_KEY. */
export function linearIssueFor(key: string | null) {
  return linearIssue(key ?? "");
}
