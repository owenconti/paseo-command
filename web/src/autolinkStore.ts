/**
 * What the conversation links mentions with (src/autolink.ts): the agent's
 * workspace's GitHub repository, the Linear workspace's address and team
 * keys (GET /api/linear/teams, only while Linear is on with a key; asked again
 * five minutes on, as a window comes back, and when Linear or its key changes),
 * and the workspace's files (GET /api/files/all, through the Files page's
 * reads, so the two share one list per workspace; asked again five minutes on
 * and as a window comes back).
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "./api";
import { workspaceFiles, type AutolinkContext, type WorkspaceFiles } from "./autolink";
import { allPath, ensure, useFilesData } from "./files/api";
import type { FileList } from "./files/types";
import { repoOf } from "./github/paseo";
import { prPlaceOf } from "./github/place";
import { useIntegrations, useSecretRevision } from "./integrationSettings";
import type { Workspace } from "./types";

type Teams = { urlKey: string; teams: ReadonlySet<string> };
const NONE: Teams = { urlKey: "", teams: new Set() };
const TTL_MS = 5 * 60_000;
let teams = NONE;
let askedAt = 0;
let asking: Promise<void> | undefined;
const listeners = new Set<() => void>();

function refresh(force = false) {
  if (asking || (!force && Date.now() - askedAt < TTL_MS)) return;
  askedAt = Date.now();
  asking = api<{ urlKey?: string; teams?: string[] }>("linear/teams")
    .then(
      (r) => {
        const keys = (r.teams ?? []).filter((k) => typeof k === "string");
        const next = r.urlKey && keys.length ? { urlKey: r.urlKey, teams: new Set(keys) } : NONE;
        if (next.urlKey === teams.urlKey && [...next.teams].join() === [...teams.teams].join()) return;
        teams = next;
        listeners.forEach((l) => l());
      },
      () => {},
    )
    .finally(() => (asking = undefined));
}

function useLinearTeams(on: boolean): Teams {
  const revision = useSecretRevision("linearApiKey");
  useEffect(() => {
    if (!on) return;
    refresh(revision > 0);
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [on, revision]);
  const value = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => teams,
  );
  return on ? value : NONE;
}

/** Each workspace's files as the links look them up, kept while its list reads the same (a new answer needn't re-render the transcript). */
const filesKept = new Map<string, { list: string[]; root?: string; files: WorkspaceFiles }>();

function filesOf(path: string, data: unknown, root?: string): WorkspaceFiles | undefined {
  const list = (data as FileList | undefined)?.files;
  if (!Array.isArray(list) || !list.length) return undefined;
  const kept = filesKept.get(path);
  if (kept && kept.root === root && (kept.list === list || (kept.list.length === list.length && kept.list.every((p, i) => p === list[i])))) {
    kept.list = list;
    return kept.files;
  }
  const files = workspaceFiles(list, root);
  filesKept.set(path, { list, ...(root ? { root } : {}), files });
  return files;
}

/** The agent's workspace's files (none for an agent without a workspace). */
function useWorkspaceFiles(workspace: Workspace | undefined): WorkspaceFiles | undefined {
  const path = workspace ? allPath({ id: workspace.workspaceId, ...(workspace.host ? { host: workspace.host } : {}) }) : undefined;
  useEffect(() => {
    if (!path) return;
    ensure(path, TTL_MS);
    const focus = () => ensure(path, TTL_MS);
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [path]);
  const data = useFilesData(path);
  const root = workspace?.cwd;
  return useMemo(() => (path ? filesOf(path, data, root) : undefined), [path, data, root]);
}

/** The context an agent's conversation links mentions with; stable while nothing it uses changes. */
export function useAutolinks(workspace: Workspace | undefined): AutolinkContext {
  const { integrations } = useIntegrations();
  const { urlKey, teams: keys } = useLinearTeams(integrations.linear);
  const files = useWorkspaceFiles(workspace);
  const repo = repoOf(workspace?.repo) ?? (workspace?.pr ? prPlaceOf(workspace.pr.url)?.repo : undefined);
  return useMemo(() => ({ repo, linearWorkspace: urlKey, teams: keys, ...(files ? { files } : {}) }), [repo, urlKey, keys, files]);
}

export const Autolinks = createContext<AutolinkContext | undefined>(undefined);
export const useAutolinkContext = () => useContext(Autolinks);
