/**
 * What the conversation links mentions with (src/autolink.ts): the agent's
 * workspace's GitHub repository, and the Linear workspace's address and team
 * keys (GET /api/linear/teams, only while Linear is on with a key; asked again
 * five minutes on, as a window comes back, and when Linear or its key changes).
 */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "./api";
import type { AutolinkContext } from "./autolink";
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

/** The context an agent's conversation links mentions with; stable while nothing it uses changes. */
export function useAutolinks(workspace: Workspace | undefined): AutolinkContext {
  const { integrations } = useIntegrations();
  const { urlKey, teams: keys } = useLinearTeams(integrations.linear);
  const repo = repoOf(workspace?.repo) ?? (workspace?.pr ? prPlaceOf(workspace.pr.url)?.repo : undefined);
  return useMemo(() => ({ repo, linearWorkspace: urlKey, teams: keys }), [repo, urlKey, keys]);
}

export const Autolinks = createContext<AutolinkContext | undefined>(undefined);
export const useAutolinkContext = () => useContext(Autolinks);
