/**
 * Workspaces' pending diff comments (the Changes view's, `src/github/localComments.ts`),
 * in a small file in this app's data directory (`diff-comments.json`), keyed by
 * host and workspace: never the worktree's files, so its git status stays
 * clean, and never GitHub. Applied ones stay as history. `GET
 * /api/diff-comments?workspace=&host=` lists a workspace's; `POST
 * /api/diff-comments` changes them (`LocalCommentChange`). Written whole and
 * atomically, keeping what it doesn't know (other keys, other fields); a
 * damaged file throws rather than be overwritten.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  MAX_BODY,
  MAX_COMMENTS,
  MAX_LINE,
  MAX_TEXT_LINES,
  type LocalComment,
} from "../src/github/localComments";
import { id } from "./api/validate";
import { dataDir } from "./subagentArchive";

export const diffCommentsFile = () => join(dataDir(), "diff-comments.json");
const UNREADABLE = "The diff comments (diff-comments.json) can't be read.";

type File = Record<string, unknown> & { workspaces: Record<string, LocalComment[]> };

function read(): File {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(diffCommentsFile(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { workspaces: {} };
    throw new Error(UNREADABLE);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(UNREADABLE);
  const r = raw as Record<string, unknown>;
  const ws = r.workspaces && typeof r.workspaces === "object" && !Array.isArray(r.workspaces) ? (r.workspaces as Record<string, unknown>) : {};
  const workspaces: Record<string, LocalComment[]> = {};
  for (const [k, list] of Object.entries(ws)) workspaces[k] = Array.isArray(list) ? (list as LocalComment[]) : [];
  return { ...r, workspaces };
}

function write(file: File) {
  const path = diffCommentsFile();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

/** The local host is "" whatever the page calls it. */
export function keyOf(host: unknown, workspace: unknown): string {
  const h = host === undefined || host === null || host === "" || host === "local" ? "" : id(host);
  return `${h}|${id(workspace)}`;
}

/** A comment as kept, or null when it isn't one (left in the file, not shown). */
function shown(c: unknown): LocalComment | null {
  const r = c as Partial<LocalComment> | null;
  return r &&
    typeof r === "object" &&
    typeof r.id === "string" &&
    typeof r.path === "string" &&
    (r.side === "LEFT" || r.side === "RIGHT") &&
    Number.isSafeInteger(r.line) &&
    typeof r.body === "string"
    ? ({ ...r, text: Array.isArray(r.text) ? r.text.filter((t) => typeof t === "string") : [] } as LocalComment)
    : null;
}

/** A workspace's comments, oldest first; applied ones too (`appliedAt`). */
export function listDiffComments(host: unknown, workspace: unknown): LocalComment[] {
  const list = read().workspaces[keyOf(host, workspace)] ?? [];
  return list.flatMap((c) => shown(c) ?? []);
}

const lineNo = (v: unknown, what: string) => {
  if (!Number.isSafeInteger(v) || (v as number) < 1 || (v as number) > 10_000_000) throw new Error(`Invalid ${what}`);
  return v as number;
};
const bodyText = (v: unknown) => {
  if (typeof v !== "string" || !v.trim()) throw new Error("A comment needs some text");
  if (v.length > MAX_BODY || v.includes("\0")) throw new Error("That comment is too long");
  return v.trim();
};
const ids = (v: unknown) => {
  if (!Array.isArray(v) || v.length > MAX_COMMENTS || v.some((x) => typeof x !== "string" || x.length > 100)) throw new Error("Invalid comment ids");
  return new Set(v as string[]);
};

/** Change a workspace's comments as `body.action` says; answers them as they are then. */
export function changeDiffComments(body: Record<string, unknown>): { comments: LocalComment[] } {
  const key = keyOf(body.host, body.workspace);
  const file = read();
  const list = file.workspaces[key] ?? [];
  const now = new Date().toISOString();
  const find = (cid: unknown) => {
    const at = list.findIndex((c) => c?.id === cid);
    if (typeof cid !== "string" || at < 0) throw new Error("That comment is gone");
    return at;
  };
  let next: LocalComment[];
  switch (body.action) {
    case "add": {
      const c = (body.comment ?? {}) as Record<string, unknown>;
      if (list.filter((x) => !x?.appliedAt).length >= MAX_COMMENTS) throw new Error(`At most ${MAX_COMMENTS} pending comments`);
      if (typeof c.path !== "string" || !c.path || c.path.length > 1000 || c.path.includes("\0")) throw new Error("Invalid path");
      if (c.side !== "LEFT" && c.side !== "RIGHT") throw new Error("Invalid side");
      const line = lineNo(c.line, "line");
      const startLine = c.startLine === undefined || c.startLine === line ? undefined : lineNo(c.startLine, "first line");
      if (startLine !== undefined && startLine > line) throw new Error("Invalid range");
      if (!Array.isArray(c.text) || c.text.length > MAX_TEXT_LINES || c.text.some((t) => typeof t !== "string" || t.length > MAX_LINE))
        throw new Error("Invalid line text");
      const comment: LocalComment = {
        id: `dc_${randomUUID()}`,
        path: c.path,
        side: c.side,
        line,
        ...(startLine !== undefined ? { startLine } : {}),
        text: c.text as string[],
        body: bodyText(c.body),
        createdAt: now,
      };
      next = [...list, comment];
      break;
    }
    case "edit": {
      const at = find(body.id);
      const text = bodyText(body.body);
      next = list.map((c, i) => (i === at ? { ...c, body: text, updatedAt: now } : c));
      break;
    }
    case "remove": {
      const at = find(body.id);
      next = list.filter((_, i) => i !== at);
      break;
    }
    case "move": {
      if (!Array.isArray(body.moves) || body.moves.length > MAX_COMMENTS) throw new Error("Invalid moves");
      const moves = new Map<string, { line: number; startLine?: number }>();
      for (const m of body.moves as Record<string, unknown>[]) {
        const line = lineNo(m?.line, "line");
        const startLine = m?.startLine === undefined ? undefined : lineNo(m.startLine, "first line");
        if (typeof m?.id === "string") moves.set(m.id, { line, ...(startLine !== undefined ? { startLine } : {}) });
      }
      // Comments gone meanwhile are left out; the rest move, a range keeping its length.
      next = list.map((c) => {
        const m = c && moves.get(c.id);
        if (!m || c.appliedAt) return c;
        const { startLine: _was, ...rest } = c;
        return { ...rest, line: m.line, ...(m.startLine !== undefined ? { startLine: m.startLine } : {}) };
      });
      break;
    }
    case "apply": {
      const which = ids(body.ids);
      const agentId = body.agentId === undefined ? undefined : id(body.agentId);
      next = list.map((c) => (c && which.has(c.id) && !c.appliedAt ? { ...c, appliedAt: now, ...(agentId ? { appliedTo: agentId } : {}) } : c));
      break;
    }
    case "discard":
      next = list.filter((c) => c?.appliedAt);
      break;
    default:
      throw new Error("Unknown action");
  }
  // History is kept, its oldest let go past the cap.
  const applied = next.filter((c) => c?.appliedAt);
  if (applied.length > MAX_COMMENTS) {
    const drop = new Set(applied.slice(0, applied.length - MAX_COMMENTS));
    next = next.filter((c) => !drop.has(c));
  }
  if (next.length) file.workspaces[key] = next;
  else delete file.workspaces[key];
  write(file);
  return { comments: next.flatMap((c) => shown(c) ?? []) };
}
