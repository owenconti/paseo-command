import { lastActive } from "../fleetView";
import { hostText, placeText } from "../names";
import { isWorking, type Agent, type Host, type Workspace } from "../types";
import { prPlaceOf } from "./place";

/** What a PR says about where its branch lives: its repository, number, head branch and head repository. */
export type PrHead = {
  repo: string;
  number: number;
  headRef: string;
  /** The repository its branch is in (a fork's for a PR from one); null when GitHub has none (a deleted fork), absent when unknown. */
  headRepo?: string | null;
};

/** A Paseo workspace with the PR's branch checked out, and its most recent agent (none: the workspace itself opens). */
export type PaseoMatch = {
  workspace: Workspace;
  agent?: Agent;
  /** Paseo names this PR as the workspace's, or the branch and remote match. */
  by: "pr" | "branch";
  /** How the chooser names it: host · project · workspace. */
  label: string;
};

/** When an agent was last active: now while it works (a stale row's last word aside), else its last activity. */
const activeAt = (a: Agent, now: number) => (isWorking(a) && !a.stale ? now : lastActive(a, {}, now));
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** `owner/name` from a workspace's repository page (`https://github.com/owner/name`). */
export function repoOf(page: string | undefined): string | undefined {
  const m = page && /^https:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(page);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/**
 * The workspaces (on any host) that have the PR's head branch checked out:
 * those Paseo already names the PR for, then those on the head branch whose
 * remote is the PR's head repository (a fork's, for a PR from one; never the
 * base's then). A workspace Paseo names another PR for doesn't match by its
 * branch. Each comes with its most recent agent (one working counts as
 * active now; listed subagents and archived ones aside); Paseo's own
 * matches first, then by that agent's last activity.
 */
export function paseoMatches(pr: PrHead, workspaces: Workspace[], agentsOf: (w: Workspace) => Agent[], hosts: Host[] = [], now = Date.now()): PaseoMatch[] {
  const head = pr.headRepo === undefined ? pr.repo : pr.headRepo;
  const out: PaseoMatch[] = [];
  for (const workspace of workspaces) {
    const named = workspace.pr ? prPlaceOf(workspace.pr.url) : null;
    let by: PaseoMatch["by"] | null = null;
    if (named && same(named.repo, pr.repo) && named.number === pr.number) by = "pr";
    else if (!named && head && pr.headRef && workspace.branch === pr.headRef) {
      const repo = repoOf(workspace.repo);
      if (repo && same(repo, head)) by = "branch";
    }
    if (!by) continue;
    const agents = agentsOf(workspace).filter((a) => !a.archived && !a.child);
    const agent = agents.reduce<Agent | undefined>((best, a) => (!best || activeAt(a, now) > activeAt(best, now) ? a : best), undefined);
    out.push({ workspace, by, label: matchLabel(workspace, hosts), ...(agent ? { agent } : {}) });
  }
  const at = (m: PaseoMatch) => (m.agent ? activeAt(m.agent, now) : -Infinity);
  return out.sort((a, b) => (a.by !== b.by ? (a.by === "pr" ? -1 : 1) : at(a) === at(b) ? 0 : at(b) > at(a) ? 1 : -1));
}

/** How a match is named in the chooser: host (by the hosts list's name, else the row's) · project · workspace. */
export function matchLabel(w: Workspace, hosts: Host[] = []) {
  const host = w.host ? hosts.find((h) => h.serverId === w.host) : undefined;
  return [w.host ? hostText(host ?? w) : "local", placeText(w.project, "Project"), placeText(w.name || w.branch, "Workspace")].join(" · ");
}
