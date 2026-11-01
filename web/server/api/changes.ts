/**
 * `GET /api/changes?workspace=<id>[&host=<id>][&mode=all|base|uncommitted]`:
 * the workspace's branch against its base (main), from its host's daemon
 * (`getCheckoutDiff`, `getCheckoutStatus`), so remote hosts' checkouts work
 * too. Read only; not the GitHub integration's (gh isn't used). A checkout the
 * daemon can't diff answers `GithubUnavailable`.
 */
import { CHANGES_MODES, REPO, type ChangesMode, type ChangesPr, type DiffFile, type GithubUnavailable, type WorkspaceChanges } from "../../src/github/types";
import type { PullRequest } from "../links";
import { redactText } from "../redact";
import { resolveHost, sdk, timed } from "./hosts";
import { aggregate } from "./reads";
import { id } from "./validate";

export const CHANGES = {
  /** Past this many lines in all, later files keep their counts but not their hunks. */
  maxLines: 20_000,
  /** At most this many files. */
  maxFiles: 2_000,
};

/** `owner/name` from a GitHub remote (`git@github.com:o/r.git`, `https://github.com/o/r`, `ssh://git@github.com/o/r.git`). */
export function githubRepoOf(remote: unknown): string | undefined {
  if (typeof remote !== "string") return undefined;
  const m = /^(?:git@github\.com:|(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(remote.trim());
  const repo = m ? `${m[1]}/${m[2]}` : undefined;
  return repo && REPO.test(repo) ? repo : undefined;
}

const DAEMON_ERRORS: Record<string, string> = {
  NOT_GIT_REPO: "This workspace's folder isn't a git checkout.",
  NOT_ALLOWED: "The daemon won't show this checkout's changes.",
  MERGE_CONFLICT: "This checkout is mid-merge; resolve its conflicts to see its changes.",
};

type Line = { type?: unknown; content?: unknown; tokens?: unknown };
/** The daemon's files, kept to their known fields; past the caps, hunks are left out and `tooLarge` set. */
export function capFiles(raw: unknown, limits = CHANGES): { files: DiffFile[]; tooLarge: boolean } {
  const list = Array.isArray(raw) ? raw : [];
  let lines = 0;
  let full = false;
  let tooLarge = list.length > limits.maxFiles;
  const files: DiffFile[] = [];
  for (const f of list.slice(0, limits.maxFiles) as Record<string, unknown>[]) {
    if (!f || typeof f.path !== "string") continue;
    const hunks = Array.isArray(f.hunks) ? (f.hunks as Record<string, unknown>[]) : [];
    const count = hunks.reduce((n, h) => n + (Array.isArray(h.lines) ? h.lines.length : 0), 0);
    const status = f.status === "binary" || f.status === "too_large" ? f.status : "ok";
    const over = full || lines + count > limits.maxLines;
    if (over) full = tooLarge = true;
    else lines += count;
    files.push({
      path: f.path,
      ...(typeof f.oldPath === "string" && f.oldPath !== f.path ? { oldPath: f.oldPath } : {}),
      isNew: f.isNew === true,
      isDeleted: f.isDeleted === true,
      additions: typeof f.additions === "number" ? f.additions : 0,
      deletions: typeof f.deletions === "number" ? f.deletions : 0,
      hunks:
        over || status !== "ok"
          ? []
          : hunks.map((h) => ({
              oldStart: Number(h.oldStart) || 0,
              oldCount: Number(h.oldCount) || 0,
              newStart: Number(h.newStart) || 0,
              newCount: Number(h.newCount) || 0,
              lines: (Array.isArray(h.lines) ? (h.lines as Line[]) : []).map((l) => ({
                type: (["context", "add", "remove", "header"].includes(l.type as string) ? l.type : "context") as DiffFile["hunks"][number]["lines"][number]["type"],
                content: typeof l.content === "string" ? l.content : "",
                ...(Array.isArray(l.tokens) ? { tokens: l.tokens as { text: string; style: string | null }[] } : {}),
              })),
            })),
      status: over && status === "ok" ? "too_large" : status,
    });
  }
  return { files, tooLarge };
}

/** The workspace row's PR, as the changes' (its repository from its address). */
function prOf(pr: PullRequest | null | undefined): ChangesPr | null {
  if (!pr) return null;
  const repo = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(pr.url)?.[1];
  return { number: pr.number, url: pr.url, title: pr.title, state: pr.state, ...(repo ? { repo } : {}) };
}

export async function changesFor(params: URLSearchParams): Promise<WorkspaceChanges | GithubUnavailable> {
  for (const k of params.keys()) if (!["workspace", "host", "mode"].includes(k)) throw new Error(`Unexpected parameter ${k}`);
  const mode = (params.get("mode") ?? "all") as ChangesMode;
  if (!CHANGES_MODES.includes(mode)) throw new Error("Invalid mode");
  const workspaceId = id(params.get("workspace"));
  const host = await resolveHost(params.get("host"));
  const rows = (await aggregate("workspaces")).rows as {
    workspaceId?: string;
    host?: string;
    cwd?: string;
    branch?: string;
    pr?: PullRequest | null;
  }[];
  const ws = rows.find((w) => w.workspaceId === workspaceId && (w.host || "") === (host?.serverId || ""));
  if (!ws?.cwd) throw new Error("Unknown workspace");
  const client = await sdk(host);
  const [diff, status] = await Promise.all([
    timed(client.getCheckoutDiff(ws.cwd, { mode }), undefined, client),
    timed(client.getCheckoutStatus(ws.cwd), undefined, client).catch(() => null),
  ]);
  if (diff?.error) {
    return { available: false, reason: DAEMON_ERRORS[diff.error.code] ?? redactText(String(diff.error.message || "The daemon couldn't diff this checkout.")).slice(0, 300) };
  }
  const { files, tooLarge } = capFiles(diff?.files);
  const s = (status ?? {}) as Record<string, unknown>;
  const ab = (s.aheadBehind ?? null) as { ahead?: unknown; behind?: unknown } | null;
  const repo = githubRepoOf(s.remoteUrl);
  const branch = typeof s.currentBranch === "string" ? s.currentBranch : ws.branch || null;
  return {
    cwd: ws.cwd,
    branch,
    baseRef: typeof s.baseRef === "string" ? s.baseRef : null,
    mode,
    files,
    tooLarge: tooLarge || diff?.diffTooLarge === true,
    ...(typeof ab?.ahead === "number" ? { ahead: ab.ahead } : {}),
    ...(typeof ab?.behind === "number" ? { behind: ab.behind } : {}),
    ...(typeof s.isDirty === "boolean" ? { dirty: s.isDirty } : {}),
    ...(repo ? { repo } : {}),
    pr: prOf(ws.pr),
  };
}
