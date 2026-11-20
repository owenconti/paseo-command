/**
 * A Diagonal workspace's app address, from `bin/worktree status` on its host (`GET /api/workspace-url`,
 * `server/worktreeUrl.ts`), and its opening in each of the workspace's agents' browsers (the user's ask): once an
 * agent's browser has no tab, its workspace's address opens there by itself, once an agent and address
 * (`browser:worktreeOpened`), so a tab you close stays closed.
 */
import { useEffect, useState } from "react";
import { api, readStore, writeStore } from "../api";
import { isDiagonalRepo } from "../worktree";

export type WorkspaceRef = { id: string; host?: string; repo?: string };
type Status = { url: string | null; slot?: string; setup?: string; why?: string };

const known = new Map<string, Promise<Status>>();
const keyOf = (w: WorkspaceRef) => `${w.host ?? ""}|${w.id}`;

/** The workspace's address while it's one of Diagonal's (else, or until it answers, null). */
export function useWorkspaceUrl(workspace: WorkspaceRef | undefined, on: boolean): string | null {
  const [url, setUrl] = useState<{ key: string; url: string | null } | null>(null);
  const key = workspace ? keyOf(workspace) : "";
  const diagonal = !!workspace && isDiagonalRepo(workspace.repo);
  useEffect(() => {
    if (!on || !workspace || !diagonal) return;
    let cancelled = false;
    let asked = known.get(key);
    if (!asked) {
      const host = workspace.host ? `&host=${encodeURIComponent(workspace.host)}` : "";
      asked = api<Status>(`workspace-url?workspace=${encodeURIComponent(workspace.id)}${host}`).catch(() => ({ url: null }));
      known.set(key, asked);
      // Asked again a while on (a worktree set up meanwhile): the server keeps its own answer a few minutes.
      setTimeout(() => known.delete(key), 5 * 60_000);
    }
    void asked.then((s) => !cancelled && setUrl({ key, url: s.url }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, on, diagonal]);
  return url?.key === key ? url.url : null;
}

const OPENED = "browser:worktreeOpened";
/** Whether this agent's browser has already been given this address (and note that it now has). */
export function takeWorktreeOpen(agentKey: string, url: string): boolean {
  const opened = readStore<Record<string, string>>(OPENED, {});
  if (opened[agentKey] === url) return false;
  const next = Object.fromEntries([...Object.entries(opened).filter(([k]) => k !== agentKey), [agentKey, url]].slice(-200));
  writeStore(OPENED, next);
  return true;
}
