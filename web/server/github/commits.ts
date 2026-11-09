/** Main's complete, cursor-paged history. Older pages stay pinned to the head first shown. */
import {
  githubGraphql,
  githubRest,
  githubText,
  GithubApiError,
} from "../githubApi";
import { cached } from "./client";
import { filesFromPatches } from "./reads";
import { parseUnifiedDiff } from "../../src/github/diff";
import type {
  MainCommit,
  MainCommitPage,
  MainCommitDetail,
} from "../../src/github/types";

export const COMMIT_SHA = /^[a-f0-9]{40}$/i;
export const MAIN_HISTORY_QUERY = `query MainHistory($owner: String!, $name: String!, $ref: String!, $after: String) {
  repository(owner: $owner, name: $name) { object(expression: $ref) { ... on Commit {
    oid history(first: 50, after: $after) {
      nodes { oid messageHeadline committedDate author { name user { login avatarUrl } } }
      pageInfo { endCursor hasNextPage }
    }
  } } }
}`;
type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;
const array = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export function readMainCommits(
  repo: string,
  head = "",
  after = "",
  fresh = false,
): Promise<MainCommitPage> {
  return cached(
    `main:${repo.toLowerCase()}:${head}:${after}`,
    fresh,
    async () => {
      const [owner, name] = repo.split("/");
      const data = await githubGraphql(
        MAIN_HISTORY_QUERY,
        { owner, name, ref: head || "refs/heads/main", after: after || null },
        true,
      );
      const object = rec(rec(data.repository).object),
        history = rec(object.history),
        info = rec(history.pageInfo);
      if (!object.history || !COMMIT_SHA.test(str(object.oid)))
        throw new GithubApiError(
          "not-found",
          `${repo} has no readable main branch history.`,
        );
      const rows: MainCommit[] = array(history.nodes)
        .map(rec)
        .filter((n) => COMMIT_SHA.test(str(n.oid)))
        .map((n) => {
          const author = rec(n.author),
            user = rec(author.user);
          return {
            sha: str(n.oid),
            title: str(n.messageHeadline) || str(n.oid).slice(0, 7),
            date: str(n.committedDate),
            author: str(author.name) || str(user.login) || "Unknown author",
            ...(str(user.login) ? { login: str(user.login) } : {}),
          };
        });
      if (info.hasNextPage === true && (!str(info.endCursor) || !rows.length))
        throw new GithubApiError(
          "failed",
          "GitHub returned an incomplete history page. Refresh to try again.",
        );
      return {
        repo,
        branch: "main",
        head: str(object.oid),
        rows,
        cursor: str(info.endCursor) || null,
        more: info.hasNextPage === true,
      };
    },
    head ? 300_000 : 15_000,
  );
}
export function readMainCommit(
  repo: string,
  sha: string,
  fresh = false,
): Promise<MainCommitDetail> {
  return cached(
    `commit:${repo.toLowerCase()}:${sha.toLowerCase()}`,
    fresh,
    async () => {
      const path = `repos/${repo}/commits/${sha}`;
      const { data: raw, headers } = await githubRest(
        "GET",
        `${path}?per_page=100`,
      );
      const data = rec(raw),
        commit = rec(data.commit),
        author = rec(commit.author),
        user = rec(data.author),
        stats = rec(data.stats);
      const message = str(commit.message);
      let diff;
      try {
        diff = parseUnifiedDiff(
          await githubText(path, "application/vnd.github.diff"),
        );
      } catch (e) {
        if (
          !(e instanceof GithubApiError) ||
          !(
            e.status === 406 ||
            /too_large|too large|exceeded the maximum|maximum number/i.test(
              e.message,
            )
          )
        )
          throw e;
        // A large diff GitHub can't render still has useful patches; label them as partial.
        diff = { files: filesFromPatches(array(data.files)), tooLarge: true };
      }
      return {
        sha,
        title: message.split("\n")[0] || sha.slice(0, 7),
        message,
        date: str(rec(commit.committer).date) || str(author.date),
        author: str(author.name) || str(user.login) || "Unknown author",
        ...(str(user.login) ? { login: str(user.login) } : {}),
        parents: array(data.parents)
          .map((p) => str(rec(p).sha))
          .filter((s) => COMMIT_SHA.test(s)),
        additions: num(stats.additions),
        deletions: num(stats.deletions),
        ...diff,
        tooLarge:
          diff.tooLarge ||
          (!!headers.get("link")?.includes('rel="next"') &&
            diff.files.length <= array(data.files).length),
      };
    },
    300_000,
  );
}
