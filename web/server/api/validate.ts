import {
  attachments as validAttachments,
  behavior as validBehavior,
  images as validImages,
} from "../daemon";
import { providerAndModel } from "../rows";

/** A request body: a JSON object, its fields not yet validated. */
export type Body = Record<string, unknown>;

export const MAX_PROMPT = 100000;
export function text(v: unknown, label: string, max = 12000) {
  if (typeof v !== "string" || !v.trim() || v.length > max || v.includes("\0"))
    throw new Error(`Invalid ${label}`);
  return v.trim();
}
export function id(v: unknown) {
  const s = text(v, "identifier", 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s))
    throw new Error("Invalid identifier");
  return s;
}
/** Model, thinking option, or run mode: e.g. claude-opus-5-5, gpt-6, codex/gpt-6. */
export function option(v: unknown, label: string) {
  const s = text(v, label, 100);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(s))
    throw new Error(`Invalid ${label}`);
  return s;
}
function ref(v: unknown, label: string) {
  const s = text(v, label, 150);
  if (
    !/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(s) ||
    s.includes("..") ||
    s.endsWith("/") ||
    s.endsWith(".lock")
  )
    throw new Error(`Invalid ${label}`);
  return s;
}
export const present = (v: unknown) =>
  v !== undefined && v !== null && v !== "";
export function query(url: URL, max = 200) {
  const q = url.searchParams.get("q") ?? "";
  if (q.length > max || q.includes("\0")) throw new Error("Invalid query");
  return q;
}
/** A provider feature's new value: a boolean, a number or a short string. */
export function featureValue(v: unknown) {
  if (
    !["boolean", "string", "number"].includes(typeof v) ||
    (typeof v === "string" && v.length > 200)
  )
    throw new Error("Invalid feature value");
  return v;
}

/**
 * Validate an archive request against the daemon's current workspaces: the
 * workspace must still be active and still be where the user saw it.
 */
export function workspaceArchiveCommand(
  workspaceId: string,
  body: Body,
  workspaces: { workspaceId: string; cwd: string }[],
) {
  const target = id(workspaceId);
  if (body.confirm !== true)
    throw new Error("Workspace archive requires confirmation");
  const workspace = workspaces.find((w) => w.workspaceId === target);
  if (!workspace)
    throw new Error(
      "This workspace is no longer active. Refresh and select an active workspace.",
    );
  if (text(body.expectedCwd, "workspace directory") !== workspace.cwd)
    throw new Error(
      "The workspace directory changed. Close this dialog and review the workspace again.",
    );
  return { workspaceId: target, cwd: workspace.cwd };
}

/** The longest name an agent or workspace may be given (the daemon's
 *  limit for an agent's title). */
export const MAX_NAME = 200;
/**
 * A new agent or workspace name: trimmed, inner whitespace (newlines
 * included) collapsed to single spaces, non-empty, at most MAX_NAME
 * characters, without control characters.
 */
export function newName(v: unknown) {
  if (typeof v !== "string") throw new Error("Invalid name");
  const control = [...v].some((c) => {
    const code = c.charCodeAt(0);
    return (code < 32 && !"\t\n\r".includes(c)) || code === 127;
  });
  if (control) throw new Error("Invalid name");
  const name = v.replace(/\s+/g, " ").trim();
  if (!name) throw new Error("A name can't be empty");
  if (name.length > MAX_NAME)
    throw new Error(`A name can be at most ${MAX_NAME} characters`);
  return name;
}
/**
 * Validate a workspace rename against the daemon's current workspaces: the
 * workspace must still be active.
 */
export function workspaceRenameCommand(
  workspaceId: string,
  body: Body,
  workspaces: { workspaceId: string }[],
) {
  const target = id(workspaceId);
  const title = newName(body.name);
  if (!workspaces.some((w) => w.workspaceId === target))
    throw new Error(
      "This workspace is no longer active. Refresh and select an active workspace.",
    );
  return { workspaceId: target, title };
}

/** Paseo's workspace label colours. */
export const LABEL_COLORS = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
];
/**
 * Validate a workspace label change against the daemon's current workspaces
 * and label catalog: an existing label (matched as Paseo does, ignoring case
 * and extra spaces) keeps its name and colour; a new one gets the colour
 * asked for, else Paseo's default.
 */
export function workspaceLabelCommand(
  workspaceId: string,
  body: Body,
  workspaces: { workspaceId: string }[],
  catalog: { name: string; color: string }[],
) {
  const target = id(workspaceId);
  if (!workspaces.some((w) => w.workspaceId === target))
    throw new Error(
      "This workspace is no longer active. Refresh and select an active workspace.",
    );
  const name = text(body.name, "label", 40).replace(/\s+/g, " ");
  if (typeof body.assigned !== "boolean") throw new Error("Invalid assigned");
  if (present(body.color) && !LABEL_COLORS.includes(body.color as string))
    throw new Error("Invalid label colour");
  const known = catalog.find(
    (l) =>
      l.name.replace(/\s+/g, " ").trim().toLowerCase() === name.toLowerCase(),
  );
  return {
    workspaceId: target,
    label: known
      ? { name: known.name, color: known.color }
      : { name, color: (body.color as string) || LABEL_COLORS[0] },
    assigned: body.assigned,
  };
}

export type DispatchPlan = {
  /** An existing workspace, or the source of a new one. */
  workspace:
    | { kind: "existing"; workspaceId: string; cwd: string }
    | { kind: "directory"; path: string }
    | {
        kind: "worktree";
        cwd: string;
        branchName: string;
        baseBranch?: string;
      };
  agent: {
    provider: string;
    model?: string;
    thinkingOptionId?: string;
    modeId?: string;
    title?: string;
    initialPrompt: string;
    images?: { data: string; mimeType: string }[];
  };
};
/**
 * What `paseo run --no-wait` would do, validated against the host's
 * registered projects, available providers and active workspaces.
 */
export function dispatchPlan(
  body: Body,
  projects: { projectId: string; path: string }[],
  providers: { provider: string; status: string }[],
  workspaces: { workspaceId: string; cwd: string }[] = [],
): DispatchPlan {
  const hasProject = present(body.projectId),
    hasWorkspace = present(body.workspaceId);
  if (hasProject === hasWorkspace)
    throw new Error("Select exactly one project or workspace");
  const prompt = text(body.prompt, "prompt");
  const imgs = validImages(body.images);
  let workspace: DispatchPlan["workspace"];
  if (hasWorkspace) {
    const workspaceId = id(body.workspaceId);
    const w = workspaces.find((w) => w.workspaceId === workspaceId);
    if (!w) throw new Error("Select an active workspace");
    if (present(body.branch) || present(body.base))
      throw new Error("A new branch can't be created in an existing workspace");
    workspace = { kind: "existing", workspaceId, cwd: w.cwd };
  } else {
    const project = projects.find((p) => p.projectId === body.projectId);
    if (!project) throw new Error("Select a registered project");
    if (present(body.branch)) {
      workspace = {
        kind: "worktree",
        cwd: project.path,
        branchName: ref(body.branch, "branch name"),
        ...(present(body.base)
          ? { baseBranch: ref(body.base, "base ref") }
          : {}),
      };
    } else {
      if (present(body.base))
        throw new Error("A base ref requires a new branch");
      workspace = { kind: "directory", path: project.path };
    }
  }
  if (!present(body.provider)) throw new Error("Select a provider");
  if (
    !providers.some(
      (p) => p.provider === body.provider && p.status === "available",
    )
  )
    throw new Error("Provider is unavailable");
  const resolved = providerAndModel(
    String(body.provider),
    present(body.model) ? option(body.model, "model") : undefined,
  );
  return {
    workspace,
    agent: {
      provider: resolved.provider,
      ...(resolved.model ? { model: resolved.model } : {}),
      ...(present(body.thinking)
        ? { thinkingOptionId: option(body.thinking, "thinking option") }
        : {}),
      ...(present(body.mode) ? { modeId: option(body.mode, "mode") } : {}),
      ...(present(body.title) ? { title: text(body.title, "title", 200) } : {}),
      initialPrompt: prompt,
      ...(imgs?.length ? { images: imgs } : {}),
    },
  };
}

/** Agent commands, all over the daemon's socket. */
export const AGENT_COMMANDS = [
  "send",
  "cancel",
  "stop",
  "archive",
  "mode",
  "allow",
  "deny",
  "respond",
  "model",
  "thinking",
  "feature",
  "read",
  "rename",
];
/**
 * Everything a command's body can be refused for without asking the daemon,
 * checked before anything is issued or invalidated.
 */
export function validateAgentPost(action: string, body: Body) {
  switch (action) {
    case "send": {
      const prompt = typeof body.prompt === "string" ? body.prompt : "";
      if (prompt.length > MAX_PROMPT || prompt.includes("\0"))
        throw new Error("Invalid prompt");
      const imgs = validImages(body.images);
      const files = validAttachments(body.attachments);
      if (!prompt.trim() && !imgs?.length && !files?.length)
        throw new Error("Nothing to send");
      validBehavior(body.behavior);
      if (body.messageId !== undefined) id(body.messageId);
      return;
    }
    case "stop":
      if (body.confirm !== true) throw new Error("Stop requires confirmation");
      return;
    case "archive":
      if (body.confirm !== true)
        throw new Error("Archive requires confirmation");
      return;
    case "mode":
      id(body.mode);
      return;
    case "allow":
    case "deny":
      id(body.requestId);
      return;
    case "respond":
      text(body.requestId, "request", 200);
      if (body.behavior !== "allow" && body.behavior !== "deny")
        throw new Error("Invalid decision");
      return;
    case "model":
      if (body.model !== null) option(body.model, "model");
      return;
    case "thinking":
      if (body.thinking !== null) option(body.thinking, "thinking option");
      return;
    case "feature": {
      id(body.featureId);
      featureValue(body.value);
      return;
    }
    case "rename":
      newName(body.name);
      return;
    case "cancel":
    case "read":
      return;
  }
  throw new Error("Unknown command");
}
