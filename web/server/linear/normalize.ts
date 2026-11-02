/**
 * Turns Linear's GraphQL replies into the server's types. Everything is
 * clipped and checked here (titles 300, names 120; https URLs only), so
 * nothing Linear sends reaches the page unchecked. Malformed records come
 * back as null and are dropped.
 */
import type { LinearNotification, LinearTeam, LinearUser } from "./types";

type Raw = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const rec = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const nodes = (v: unknown): Raw[] => {
  const list = rec(v).nodes;
  return Array.isArray(list) ? list.map(rec) : [];
};
/** The id of a `{ id }` reference, undefined when absent. */
const optId = (v: unknown) => str(rec(v).id) || undefined;

export const httpsUrl = (v: unknown) => {
  try {
    const url = new URL(str(v));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};

export function userOf(raw: Raw, viewerId?: string): LinearUser | null {
  const id = str(raw.id);
  if (!id) return null;
  const name = clip(str(raw.name), 120);
  return {
    id,
    name,
    displayName: clip(str(raw.displayName), 120) || name,
    avatarUrl: httpsUrl(raw.avatarUrl) || undefined,
    ...(id === viewerId ? { me: true } : {}),
  };
}

export function teamOf(raw: Raw): LinearTeam | null {
  const id = str(raw.id);
  const key = clip(str(raw.key), 20);
  if (!id || !key) return null;
  return { id, key, name: clip(str(raw.name), 120) };
}

/** A notification, with the issue (or project) and comment it's about; null without an id. */
export function notificationOf(raw: Raw): LinearNotification | null {
  const id = str(raw.id);
  if (!id) return null;
  const issue = rec(raw.issue);
  const comment = rec(raw.comment);
  const key = clip(str(issue.identifier).toUpperCase(), 30);
  const pr = rec(raw.pullRequest);
  const prKeys = issueKeysIn(`${str(pr.sourceBranch).slice(0, 300)} ${str(pr.title).slice(0, 300)}`);
  return {
    id,
    type: clip(str(raw.type), 60),
    title: clip(str(raw.title), 300),
    subtitle: clip(str(raw.subtitle), 300),
    url: httpsUrl(raw.url),
    actorId: optId(raw.actor),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
    readAt: str(raw.readAt) || undefined,
    snoozedUntilAt: str(raw.snoozedUntilAt) || undefined,
    archivedAt: str(raw.archivedAt) || undefined,
    issueId: str(issue.id) || undefined,
    issueKey: key || undefined,
    commentId: str(comment.id) || undefined,
    commentBody: clip(str(comment.body), 300) || undefined,
    projectId: optId(raw.project),
    pullRequestId: optId(raw.pullRequest),
    ...(prKeys.length ? { pullRequestIssueKeys: prKeys } : {}),
  };
}

/**
 * The issue keys a pull request's branch and title name (`owen/de-7919-…`,
 * `DE-7919: …`), as Linear links them, uppercased, at most five; which are
 * this workspace's teams' is for the reader to say.
 */
export function issueKeysIn(text: string): string[] {
  const keys = [...text.matchAll(/(?<![a-z0-9])([a-z][a-z0-9]{0,9}-\d{1,7})(?![0-9])/gi)].map((m) => m[1]!.toUpperCase());
  return [...new Set(keys)].slice(0, 5);
}

export { nodes as nodesOf, rec as recOf, str as strOf };
