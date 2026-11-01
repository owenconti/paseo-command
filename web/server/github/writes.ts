/**
 * The GitHub tab's whitelisted writes (`POST /api/github/m/<name>`), each the
 * user's own action through their gh sign-in. Inputs are checked field by
 * field; anything unexpected is refused before gh runs. Each clears the
 * cached reads it changes.
 */
import {
  GITHUB_WRITES,
  REPO,
  type DraftComment,
  type GithubWriteInputs,
  type GithubWriteName,
  type GithubWriteResult,
  type ReviewEvent,
} from "../../src/github/types";
import { assertEnabled, forget, gh, graphql, GithubTabError } from "./client";
import { BODY_MAX, diffKey, prKey } from "./reads";

export const MAX_DRAFTS = 100;
const EVENTS: ReviewEvent[] = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];
const SIDES = ["LEFT", "RIGHT"] as const;

type Raw = Record<string, unknown>;
const invalid = (message: string) => new GithubTabError("invalid", message);

function fields(raw: unknown, allowed: string[], optional: string[] = []): Raw {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw invalid("Invalid request body");
  const o = raw as Raw;
  for (const k of Object.keys(o)) if (!allowed.includes(k) && !optional.includes(k)) throw invalid(`Unexpected field ${k}`);
  for (const k of allowed) if (!(k in o)) throw invalid(`Missing field ${k}`);
  return o;
}
function repoOf(v: unknown): string {
  if (typeof v !== "string" || !REPO.test(v) || v.includes("..")) throw invalid("Invalid repo");
  return v;
}
function positive(v: unknown, name: string): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw invalid(`Invalid ${name}`);
  return v;
}
function text(v: unknown, name: string, { empty = false } = {}): string {
  if (typeof v !== "string") throw invalid(`Invalid ${name}`);
  if (!empty && !v.trim()) throw invalid(`Write the ${name} first`);
  if (v.length > BODY_MAX) throw invalid(`The ${name} is too long`);
  return v;
}
function nodeId(v: unknown, name: string): string {
  if (typeof v !== "string" || !/^[\w=-]{1,200}$/.test(v)) throw invalid(`Invalid ${name}`);
  return v;
}
function side(v: unknown): "LEFT" | "RIGHT" {
  if (!SIDES.includes(v as "LEFT")) throw invalid("Invalid side");
  return v as "LEFT" | "RIGHT";
}
function path(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 1000 || v.startsWith("/") || v.includes("\0")) throw invalid("Invalid path");
  return v;
}

function draft(raw: unknown): DraftComment {
  const o = fields(raw, ["path", "line", "side", "body"], ["startLine", "startSide"]);
  const d: DraftComment = { path: path(o.path), line: positive(o.line, "line"), side: side(o.side), body: text(o.body, "comment") };
  if (o.startLine !== undefined) {
    d.startLine = positive(o.startLine, "start line");
    d.startSide = o.startSide === undefined ? d.side : side(o.startSide);
    if (d.startSide === d.side && d.startLine >= d.line) throw invalid("A comment's first line comes before its last");
  } else if (o.startSide !== undefined) throw invalid("Unexpected field startSide");
  return d;
}

/** A write's input, checked field by field. */
export function checkWrite<N extends GithubWriteName>(name: N, raw: unknown): GithubWriteInputs[N] {
  switch (name) {
    case "comment": {
      const o = fields(raw, ["repo", "number", "body"]);
      return { repo: repoOf(o.repo), number: positive(o.number, "number"), body: text(o.body, "comment") } as GithubWriteInputs[N];
    }
    case "review": {
      const o = fields(raw, ["repo", "number", "event", "body", "commitId", "comments"]);
      if (!EVENTS.includes(o.event as ReviewEvent)) throw invalid("Invalid event");
      if (typeof o.commitId !== "string" || !/^[0-9a-f]{40}$/.test(o.commitId)) throw invalid("Invalid commitId");
      if (!Array.isArray(o.comments) || o.comments.length > MAX_DRAFTS) throw invalid(`At most ${MAX_DRAFTS} comments at once`);
      const event = o.event as ReviewEvent;
      const comments = o.comments.map(draft);
      // Requesting changes, or commenting, says something: a summary or a line comment.
      const body = text(o.body, "review", { empty: event === "APPROVE" || comments.length > 0 });
      return { repo: repoOf(o.repo), number: positive(o.number, "number"), event, body, commitId: o.commitId, comments } as GithubWriteInputs[N];
    }
    case "reply": {
      const o = fields(raw, ["repo", "number", "commentId", "body"]);
      return {
        repo: repoOf(o.repo),
        number: positive(o.number, "number"),
        commentId: positive(o.commentId, "commentId"),
        body: text(o.body, "reply"),
      } as GithubWriteInputs[N];
    }
    case "resolve": {
      const o = fields(raw, ["threadId", "resolved"]);
      if (typeof o.resolved !== "boolean") throw invalid("Invalid resolved");
      return { threadId: nodeId(o.threadId, "threadId"), resolved: o.resolved } as GithubWriteInputs[N];
    }
    case "viewed": {
      const o = fields(raw, ["prId", "path", "viewed"]);
      if (typeof o.viewed !== "boolean") throw invalid("Invalid viewed");
      return { prId: nodeId(o.prId, "prId"), path: path(o.path), viewed: o.viewed } as GithubWriteInputs[N];
    }
  }
  throw invalid("Unknown write");
}

const forgetPr = (repo: string, number: number) => forget(prKey(repo, number), diffKey(repo, number), "prs:");
/** The PR a node id belongs to isn't known here: every PR's cached read goes. */
const forgetPrs = () => forget("pr:", "prs:");

const urlOf = (out: string): string | undefined => {
  try {
    const u = (JSON.parse(out) as { html_url?: unknown }).html_url;
    return typeof u === "string" && /^https:\/\/github\.com\//.test(u) ? u : undefined;
  } catch {
    return undefined;
  }
};

export async function githubWrite(name: GithubWriteName, raw: unknown): Promise<GithubWriteResult> {
  if (!GITHUB_WRITES.includes(name)) throw invalid("Unknown write");
  assertEnabled();
  switch (name) {
    case "comment": {
      const w = checkWrite("comment", raw);
      const out = await gh(["api", "-X", "POST", `repos/${w.repo}/issues/${w.number}/comments`, "--input", "-"], JSON.stringify({ body: w.body }));
      forgetPr(w.repo, w.number);
      return { ok: true, ...(urlOf(out) ? { url: urlOf(out) } : {}) };
    }
    case "review": {
      const w = checkWrite("review", raw);
      const input = {
        event: w.event,
        body: w.body,
        commit_id: w.commitId,
        comments: w.comments.map((c) => ({
          path: c.path,
          line: c.line,
          side: c.side,
          ...(c.startLine !== undefined ? { start_line: c.startLine, start_side: c.startSide } : {}),
          body: c.body,
        })),
      };
      const out = await gh(["api", "-X", "POST", `repos/${w.repo}/pulls/${w.number}/reviews`, "--input", "-"], JSON.stringify(input));
      forgetPr(w.repo, w.number);
      return { ok: true, ...(urlOf(out) ? { url: urlOf(out) } : {}) };
    }
    case "reply": {
      const w = checkWrite("reply", raw);
      const out = await gh(
        ["api", "-X", "POST", `repos/${w.repo}/pulls/${w.number}/comments/${w.commentId}/replies`, "--input", "-"],
        JSON.stringify({ body: w.body }),
      );
      forgetPr(w.repo, w.number);
      return { ok: true, ...(urlOf(out) ? { url: urlOf(out) } : {}) };
    }
    case "resolve": {
      const w = checkWrite("resolve", raw);
      const mutation = w.resolved ? "resolveReviewThread" : "unresolveReviewThread";
      await graphql(`mutation($id: ID!) { ${mutation}(input: { threadId: $id }) { thread { id isResolved } } }`, { id: w.threadId }, true);
      forgetPrs();
      return { ok: true };
    }
    case "viewed": {
      const w = checkWrite("viewed", raw);
      const mutation = w.viewed ? "markFileAsViewed" : "unmarkFileAsViewed";
      await graphql(`mutation($id: ID!, $path: String!) { ${mutation}(input: { pullRequestId: $id, path: $path }) { clientMutationId } }`, {
        id: w.prId,
        path: w.path,
      }, true);
      forgetPrs();
      return { ok: true };
    }
  }
}
