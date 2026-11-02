/**
 * The GitHub tab's whitelisted writes (`POST /api/github/m/<name>`), each the
 * user's own action with their GitHub token. Inputs are checked field by
 * field; anything unexpected is refused before GitHub is asked. Each clears the
 * cached reads it changes. `star` is the app's own: favourites in settings.json (`stars.ts`).
 * The merge box's writes (`merge`, `autoMerge`, `queue`, `ready`, `updateBranch`,
 * `state`, `deleteBranch`) also clear the PR's lookups for the map and header (`links.ts`).
 */
import {
  GITHUB_WRITES,
  MERGE_METHODS,
  type MergeMethod,
  MAX_ASSIGNEES,
  MAX_REVIEWERS,
  OWNER,
  REPO,
  TEAM_SLUG,
  type DraftComment,
  type GithubWriteInputs,
  type GithubWriteName,
  type GithubWriteResult,
  type ReviewEvent,
} from "../../src/github/types";
import { GithubApiError, githubGraphql as graphql, githubRest } from "../githubApi";
import { assertEnabled, forget } from "./client";
import { forgetPullRequest } from "../links";
import { BODY_MAX, diffKey, prKey, readPr } from "./reads";
import { saveStar } from "./stars";

export const MAX_DRAFTS = 100;
const EVENTS: ReviewEvent[] = ["APPROVE", "REQUEST_CHANGES", "COMMENT"];
const SIDES = ["LEFT", "RIGHT"] as const;

type Raw = Record<string, unknown>;
const invalid = (message: string) => new GithubApiError("invalid", message);

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

function action(v: unknown): "add" | "remove" {
  if (v !== "add" && v !== "remove") throw invalid("Invalid action");
  return v;
}
/** Logins (or team slugs), each once, at most `max`. */
function names(v: unknown, what: string, pattern: RegExp, max: number): string[] {
  if (!Array.isArray(v) || v.length > max) throw invalid(`At most ${max} ${what} at once`);
  const out: string[] = [];
  for (const n of v) {
    if (typeof n !== "string" || !pattern.test(n)) throw invalid(`Invalid ${what}`);
    if (!out.some((o) => o.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  return out;
}

function method(v: unknown): MergeMethod {
  if (!MERGE_METHODS.includes(v as MergeMethod)) throw invalid("Invalid method");
  return v as MergeMethod;
}
function sha(v: unknown, name = "headSha"): string {
  if (typeof v !== "string" || !/^[0-9a-f]{40}$/.test(v)) throw invalid(`Invalid ${name}`);
  return v;
}
/** A commit's title (one line) or message; only merge and squash commits take them. */
function commitText(o: Raw, m: MergeMethod | undefined): { title?: string; message?: string } {
  if ((o.title !== undefined || o.message !== undefined) && m !== "merge" && m !== "squash") throw invalid("Only a merge or squash commit takes a title and message");
  const out: { title?: string; message?: string } = {};
  if (o.title !== undefined) {
    const t = text(o.title, "commit title");
    if (t.length > 1000 || /[\r\n]/.test(t)) throw invalid("The commit title is one line");
    out.title = t;
  }
  if (o.message !== undefined) out.message = text(o.message, "commit message", { empty: true });
  return out;
}
/** The PR every merge-box write names: its repository and number, and its node id. */
function prOf(o: Raw) {
  return { repo: repoOf(o.repo), number: positive(o.number, "number"), prId: nodeId(o.prId, "prId") };
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
    case "reviewers": {
      const o = fields(raw, ["repo", "number", "action", "users", "teams"]);
      const users = names(o.users, "people", OWNER, MAX_REVIEWERS);
      const teams = names(o.teams, "teams", TEAM_SLUG, MAX_REVIEWERS);
      if (!users.length && !teams.length) throw invalid("Name someone to ask for a review");
      if (users.length + teams.length > MAX_REVIEWERS) throw invalid(`At most ${MAX_REVIEWERS} reviewers at once`);
      return { repo: repoOf(o.repo), number: positive(o.number, "number"), action: action(o.action), users, teams } as GithubWriteInputs[N];
    }
    case "assignees": {
      const o = fields(raw, ["repo", "number", "action", "users"]);
      const users = names(o.users, "people", OWNER, MAX_ASSIGNEES);
      if (!users.length) throw invalid("Name someone to assign");
      return { repo: repoOf(o.repo), number: positive(o.number, "number"), action: action(o.action), users } as GithubWriteInputs[N];
    }
    case "merge": {
      const o = fields(raw, ["repo", "number", "prId", "method", "headSha"], ["title", "message"]);
      const m = method(o.method);
      return { ...prOf(o), method: m, headSha: sha(o.headSha), ...commitText(o, m) } as GithubWriteInputs[N];
    }
    case "autoMerge": {
      const o = fields(raw, ["repo", "number", "prId", "enable"], ["method", "headSha", "title", "message"]);
      if (typeof o.enable !== "boolean") throw invalid("Invalid enable");
      if (!o.enable) {
        for (const k of ["method", "headSha", "title", "message"]) if (o[k] !== undefined) throw invalid(`Unexpected field ${k}`);
        return { ...prOf(o), enable: false } as GithubWriteInputs[N];
      }
      const m = method(o.method);
      return {
        ...prOf(o),
        enable: true,
        method: m,
        ...(o.headSha !== undefined ? { headSha: sha(o.headSha) } : {}),
        ...commitText(o, m),
      } as GithubWriteInputs[N];
    }
    case "queue": {
      const o = fields(raw, ["repo", "number", "prId", "action"], ["headSha"]);
      const a = action(o.action);
      if (a === "remove" && o.headSha !== undefined) throw invalid("Unexpected field headSha");
      return { ...prOf(o), action: a, ...(o.headSha !== undefined ? { headSha: sha(o.headSha) } : {}) } as GithubWriteInputs[N];
    }
    case "ready": {
      const o = fields(raw, ["repo", "number", "prId", "ready"]);
      if (typeof o.ready !== "boolean") throw invalid("Invalid ready");
      return { ...prOf(o), ready: o.ready } as GithubWriteInputs[N];
    }
    case "updateBranch": {
      const o = fields(raw, ["repo", "number", "prId", "method", "headSha"]);
      if (o.method !== "merge" && o.method !== "rebase") throw invalid("Invalid method");
      return { ...prOf(o), method: o.method, headSha: sha(o.headSha) } as GithubWriteInputs[N];
    }
    case "state": {
      const o = fields(raw, ["repo", "number", "prId", "state"], ["comment"]);
      if (o.state !== "closed" && o.state !== "open") throw invalid("Invalid state");
      if (o.comment !== undefined && o.state !== "closed") throw invalid("Unexpected field comment");
      const comment = o.comment === undefined ? "" : text(o.comment, "comment", { empty: true });
      return { ...prOf(o), state: o.state, ...(comment.trim() ? { comment } : {}) } as GithubWriteInputs[N];
    }
    case "deleteBranch": {
      const o = fields(raw, ["repo", "number"]);
      return { repo: repoOf(o.repo), number: positive(o.number, "number") } as GithubWriteInputs[N];
    }
    case "star": {
      const o = fields(raw, ["kind", "name", "starred"]);
      if (o.kind !== "repo" && o.kind !== "org") throw invalid("Invalid kind");
      if (typeof o.starred !== "boolean") throw invalid("Invalid starred");
      const ok = typeof o.name === "string" && (o.kind === "repo" ? REPO.test(o.name) && !o.name.includes("..") : OWNER.test(o.name));
      if (!ok) throw invalid(o.kind === "repo" ? "Name the repository as owner/name" : "Name the organization by its login");
      return { kind: o.kind, name: o.name, starred: o.starred } as GithubWriteInputs[N];
    }
  }
  throw invalid("Unknown write");
}

const forgetPr = (repo: string, number: number) => forget(prKey(repo, number), diffKey(repo, number), "prs:");
/** A merge-box write changed its state: its lists and counts, the repositories' counts, and the map's lookups too. */
const forgetMerged = (repo: string, number: number) => {
  forget(prKey(repo, number), diffKey(repo, number), "prs:", "repos:", "repoSearch:");
  forgetPullRequest(repo, number);
};
const METHOD = { merge: "MERGE", squash: "SQUASH", rebase: "REBASE" } as const;

/** A merge or auto-merge only by a method the repository and the base branch's rules allow (as the PR's read says). */
async function allowedMethod(repo: string, number: number, m: MergeMethod) {
  const { methods } = (await readPr(repo, number)).merge;
  if (!methods.includes(m)) throw invalid(methods.length ? `This pull request merges only by ${methods.join(", ")}` : "No merge method is allowed here");
}
/** A ref's path under `git/refs/heads/`, each segment encoded (a branch may have slashes, never `..`). */
function branchPath(branch: string): string {
  const parts = branch.split("/");
  if (!branch || branch.length > 255 || parts.some((p) => !p || p === "." || p === "..") || /[\0\s~^:?*[\\]/.test(branch)) throw invalid("Invalid branch");
  return parts.map(encodeURIComponent).join("/");
}
/** The PR a node id belongs to isn't known here: every PR's cached read goes. */
const forgetPrs = () => forget("pr:", "prs:");

/** The written thing's page, from GitHub's answer. */
const urlOf = (out: unknown): string | undefined => {
  const u = (out as { html_url?: unknown } | null)?.html_url;
  return typeof u === "string" && /^https:\/\/github\.com\//.test(u) ? u : undefined;
};
const post = async (path: string, body: unknown) => (await githubRest("POST", path, body)).data;

export async function githubWrite(name: GithubWriteName, raw: unknown): Promise<GithubWriteResult> {
  if (!GITHUB_WRITES.includes(name)) throw invalid("Unknown write");
  assertEnabled();
  switch (name) {
    case "comment": {
      const w = checkWrite("comment", raw);
      const out = await post(`repos/${w.repo}/issues/${w.number}/comments`, { body: w.body });
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
      const out = await post(`repos/${w.repo}/pulls/${w.number}/reviews`, input);
      forgetPr(w.repo, w.number);
      return { ok: true, ...(urlOf(out) ? { url: urlOf(out) } : {}) };
    }
    case "reply": {
      const w = checkWrite("reply", raw);
      const out = await post(`repos/${w.repo}/pulls/${w.number}/comments/${w.commentId}/replies`, { body: w.body });
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
    case "reviewers": {
      // Asking again someone who reviewed re-requests their review, as GitHub's own button does.
      const w = checkWrite("reviewers", raw);
      await githubRest(w.action === "add" ? "POST" : "DELETE", `repos/${w.repo}/pulls/${w.number}/requested_reviewers`, {
        reviewers: w.users,
        team_reviewers: w.teams,
      });
      forgetPr(w.repo, w.number);
      return { ok: true };
    }
    case "assignees": {
      const w = checkWrite("assignees", raw);
      await githubRest(w.action === "add" ? "POST" : "DELETE", `repos/${w.repo}/issues/${w.number}/assignees`, { assignees: w.users });
      forgetPr(w.repo, w.number);
      return { ok: true };
    }
    case "merge": {
      const w = checkWrite("merge", raw);
      await allowedMethod(w.repo, w.number, w.method);
      const data = await graphql(
        `mutation($id: ID!, $method: PullRequestMergeMethod!, $sha: GitObjectID!, $title: String, $body: String) {
          mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $sha, commitHeadline: $title, commitBody: $body }) { pullRequest { state merged } }
        }`,
        { id: w.prId, method: METHOD[w.method], sha: w.headSha, ...(w.title !== undefined ? { title: w.title } : {}), ...(w.message !== undefined ? { body: w.message } : {}) },
        true,
      );
      forgetMerged(w.repo, w.number);
      const pr = (data.mergePullRequest as { pullRequest?: { merged?: unknown; state?: unknown } } | null)?.pullRequest;
      return { ok: true, merged: pr?.merged === true || pr?.state === "MERGED" };
    }
    case "autoMerge": {
      const w = checkWrite("autoMerge", raw);
      if (w.enable) await allowedMethod(w.repo, w.number, w.method!);
      if (w.enable)
        await graphql(
          `mutation($id: ID!, $method: PullRequestMergeMethod!, $sha: GitObjectID, $title: String, $body: String) {
            enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: $method, expectedHeadOid: $sha, commitHeadline: $title, commitBody: $body }) { pullRequest { id } }
          }`,
          {
            id: w.prId,
            method: METHOD[w.method!],
            ...(w.headSha ? { sha: w.headSha } : {}),
            ...(w.title !== undefined ? { title: w.title } : {}),
            ...(w.message !== undefined ? { body: w.message } : {}),
          },
          true,
        );
      else await graphql(`mutation($id: ID!) { disablePullRequestAutoMerge(input: { pullRequestId: $id }) { pullRequest { id } } }`, { id: w.prId }, true);
      forgetMerged(w.repo, w.number);
      return { ok: true };
    }
    case "queue": {
      const w = checkWrite("queue", raw);
      if (w.action === "add")
        await graphql(
          `mutation($id: ID!, $sha: GitObjectID) { enqueuePullRequest(input: { pullRequestId: $id, expectedHeadOid: $sha }) { mergeQueueEntry { id } } }`,
          { id: w.prId, ...(w.headSha ? { sha: w.headSha } : {}) },
          true,
        );
      else await graphql(`mutation($id: ID!) { dequeuePullRequest(input: { id: $id }) { mergeQueueEntry { id } } }`, { id: w.prId }, true);
      forgetMerged(w.repo, w.number);
      return { ok: true };
    }
    case "ready": {
      const w = checkWrite("ready", raw);
      const mutation = w.ready ? "markPullRequestReadyForReview" : "convertPullRequestToDraft";
      await graphql(`mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { pullRequest { id isDraft } } }`, { id: w.prId }, true);
      forgetMerged(w.repo, w.number);
      return { ok: true };
    }
    case "updateBranch": {
      const w = checkWrite("updateBranch", raw);
      await graphql(
        `mutation($id: ID!, $sha: GitObjectID!, $method: PullRequestBranchUpdateMethod!) {
          updatePullRequestBranch(input: { pullRequestId: $id, expectedHeadOid: $sha, updateMethod: $method }) { pullRequest { id } }
        }`,
        { id: w.prId, sha: w.headSha, method: w.method === "rebase" ? "REBASE" : "MERGE" },
        true,
      );
      forgetMerged(w.repo, w.number);
      return { ok: true };
    }
    case "state": {
      // Closing with a comment posts the comment first, as GitHub's "Close with comment" does.
      const w = checkWrite("state", raw);
      if (w.comment) await post(`repos/${w.repo}/issues/${w.number}/comments`, { body: w.comment });
      const mutation = w.state === "closed" ? "closePullRequest" : "reopenPullRequest";
      try {
        await graphql(`mutation($id: ID!) { ${mutation}(input: { pullRequestId: $id }) { pullRequest { id state } } }`, { id: w.prId }, true);
      } finally {
        forgetMerged(w.repo, w.number);
      }
      return { ok: true };
    }
    case "deleteBranch": {
      // Only the PR's own head branch, once it's merged or closed, and only where GitHub says the token may.
      const w = checkWrite("deleteBranch", raw);
      const pr = await readPr(w.repo, w.number, true);
      if (pr.state !== "merged" && pr.state !== "closed") throw invalid("Merge or close the pull request before deleting its branch");
      if (!pr.merge.headBranchExists) throw invalid("Its branch is already deleted");
      if (!pr.merge.canDeleteBranch || !pr.headRepo) throw new GithubApiError("forbidden", "The token can't delete this branch.");
      await githubRest("DELETE", `repos/${pr.headRepo}/git/refs/heads/${branchPath(pr.headRef)}`);
      forgetMerged(w.repo, w.number);
      return { ok: true };
    }
    case "star": {
      // The app's own favourites, in settings.json: GitHub isn't asked.
      const w = checkWrite("star", raw);
      const stars = saveStar(w.kind, w.name, w.starred);
      forget("repos:");
      return { ok: true, stars };
    }
  }
}
