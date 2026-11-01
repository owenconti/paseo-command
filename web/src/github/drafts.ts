import { useCallback, useSyncExternalStore } from "react";
import { readStore, removeStore, writeStore } from "../api";
import type { DraftComment } from "./types";

/**
 * Your review of a PR while you write it: its line comments and summary, kept
 * in localStorage (`github:review:<owner/name>#<n>`) until it's submitted or
 * discarded, so a reload or another PR doesn't lose it. Nothing reaches GitHub
 * until Submit review.
 */
export type ReviewDraft = { comments: (DraftComment & { id: string })[]; body: string };

const EMPTY: ReviewDraft = { comments: [], body: "" };
const key = (repo: string, number: number) => `github:review:${repo}#${number}`;

function checkDraft(raw: unknown): ReviewDraft {
  if (!raw || typeof raw !== "object") return EMPTY;
  const r = raw as Record<string, unknown>;
  const comments = Array.isArray(r.comments)
    ? r.comments.filter(
        (c): c is ReviewDraft["comments"][number] =>
          !!c &&
          typeof c === "object" &&
          typeof c.id === "string" &&
          typeof c.path === "string" &&
          typeof c.body === "string" &&
          Number.isSafeInteger(c.line) &&
          (c.side === "LEFT" || c.side === "RIGHT"),
      )
    : [];
  return { comments, body: typeof r.body === "string" ? r.body : "" };
}

const drafts = new Map<string, ReviewDraft>();
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function readDraft(repo: string, number: number): ReviewDraft {
  const k = key(repo, number);
  let d = drafts.get(k);
  if (!d) {
    d = checkDraft(readStore<unknown>(k, null));
    drafts.set(k, d);
  }
  return d;
}

export function writeDraft(repo: string, number: number, next: ReviewDraft): void {
  const k = key(repo, number);
  drafts.set(k, next);
  if (!next.comments.length && !next.body.trim()) removeStore(k);
  else writeStore(k, next);
  listeners.forEach((l) => l());
}

let nextId = 0;
const newId = () => `d${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Adds a line comment; answers its id. */
export function addComment(draft: ReviewDraft, c: DraftComment): { draft: ReviewDraft; id: string } {
  const id = newId();
  return { draft: { ...draft, comments: [...draft.comments, { ...c, id }] }, id };
}
export const editComment = (draft: ReviewDraft, id: string, body: string): ReviewDraft => ({
  ...draft,
  comments: draft.comments.map((c) => (c.id === id ? { ...c, body } : c)),
});
export const removeComment = (draft: ReviewDraft, id: string): ReviewDraft => ({
  ...draft,
  comments: draft.comments.filter((c) => c.id !== id),
});

/** The comments as GitHub takes them: a range's start only when it's a different line. */
export function reviewComments(draft: ReviewDraft): DraftComment[] {
  return draft.comments
    .filter((c) => c.body.trim())
    .map(({ path, line, side, startLine, startSide, body }) => ({
      path,
      line,
      side,
      ...(startLine !== undefined && (startLine !== line || (startSide ?? side) !== side)
        ? { startLine, startSide: startSide ?? side }
        : {}),
      body,
    }));
}

/** The PR's review draft, and a setter that keeps it. */
export function useReviewDraft(repo: string, number: number) {
  const draft = useSyncExternalStore(
    subscribe,
    () => readDraft(repo, number),
    () => EMPTY,
  );
  const set = useCallback((next: ReviewDraft) => writeDraft(repo, number, next), [repo, number]);
  return [draft, set] as const;
}
