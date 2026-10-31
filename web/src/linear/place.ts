import { readStore, writeStore } from "../api";
import { linearStore } from "./store";
import type { IssueScope, LinearWorkspace } from "./types";

export type MyTab = "assigned" | "created" | "subscribed";
export type TeamTab = "triage" | "active" | "backlog" | "all";

/** Where the user is in the Linear view (its sidebar's choice), and the issue open there by key. */
export type LinearPlace = (
  | { screen: "my"; tab: MyTab }
  | { screen: "team"; teamId: string; tab: TeamTab }
  | { screen: "projects" }
  | { screen: "project"; projectId: string }
  | { screen: "initiatives" }
) & { issue?: string };

export const DEFAULT_PLACE: LinearPlace = { screen: "my", tab: "assigned" };

const MY_TABS: MyTab[] = ["assigned", "created", "subscribed"];
const TEAM_TABS: TeamTab[] = ["triage", "active", "backlog", "all"];
const STORE_KEY = "linear:place";

/** The issues a place lists, as the store's scope; null for the projects' and initiatives' lists. */
export function placeScope(p: LinearPlace): IssueScope | null {
  switch (p.screen) {
    case "my":
      return p.tab;
    case "team":
      return `team:${p.teamId}:${p.tab}`;
    case "project":
      return `project:${p.projectId}`;
    default:
      return null;
  }
}

/** Whether two places are the same screen (the open issue aside): the sidebar marks it. */
export function samePlace(a: LinearPlace, b: LinearPlace): boolean {
  return placeScope(a) === placeScope(b) && a.screen === b.screen;
}

/**
 * A remembered (or otherwise untrusted) place as a valid one: anything
 * malformed, or a team or project the workspace doesn't have, is the default.
 * Before the workspace is in, ids can't be checked and stand.
 */
export function checkPlace(raw: unknown, ws?: LinearWorkspace): LinearPlace {
  if (!raw || typeof raw !== "object") return DEFAULT_PLACE;
  const p = raw as Record<string, unknown>;
  const issue = typeof p.issue === "string" && /^[a-z][a-z0-9]{0,9}-\d{1,6}$/i.test(p.issue) ? { issue: p.issue } : {};
  switch (p.screen) {
    case "my":
      return MY_TABS.includes(p.tab as MyTab) ? { screen: "my", tab: p.tab as MyTab, ...issue } : DEFAULT_PLACE;
    case "team": {
      if (typeof p.teamId !== "string" || !TEAM_TABS.includes(p.tab as TeamTab)) return DEFAULT_PLACE;
      const team = ws?.teams.find((t) => t.id === p.teamId);
      if (ws && !team) return DEFAULT_PLACE;
      const tab = p.tab === "triage" && team && !team.triageEnabled ? "active" : (p.tab as TeamTab);
      return { screen: "team", teamId: p.teamId, tab, ...issue };
    }
    case "project":
      if (typeof p.projectId !== "string" || (ws && !ws.projects.some((x) => x.id === p.projectId)))
        return DEFAULT_PLACE;
      return { screen: "project", projectId: p.projectId, ...issue };
    case "projects":
    case "initiatives":
      return { screen: p.screen, ...issue };
    default:
      return DEFAULT_PLACE;
  }
}

/** The remembered place (localStorage), checked against the workspace when it's in. */
export function readPlace(ws: LinearWorkspace | undefined = linearStore.getState().workspace): LinearPlace {
  return checkPlace(readStore<unknown>(STORE_KEY, null), ws);
}

export function writePlace(p: LinearPlace): void {
  writeStore(STORE_KEY, p);
}
