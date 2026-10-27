/**
 * Where the user is in the panel, kept in the page's query so a refresh (or a
 * shared link) returns there: the selection and any open subagent, the list's
 * tab and filter, the host the lists are narrowed to, and whether the list is
 * shown over an open selection.
 *
 *   ?agent=<id>[&host=<id>][&sub=<id>]  or  ?workspace=<id>  or  ?project=<id>
 *   &tab=Agents|Workspaces|Projects|Hosts  &filter=attention|unread|running|idle
 *   &on=<host id, "local" for this machine>  &list=1
 */
import type { Tab } from "./Fleet";
import type { Filter } from "./fleetView";
import type { Selection } from "./types";

const TABS: Tab[] = ["Agents", "Workspaces", "Projects", "Hosts"];
const FILTERS: Filter[] = ["all", "attention", "unread", "running", "idle"];
const KINDS = ["agent", "workspace", "project"] as const;

export type UrlState = {
  selection: Selection;
  tab?: Tab;
  filter?: Filter;
  /** The host filter: "" for local, as the lists hold it. */
  hostFilter: string | null;
  /** The list is shown over the selection. */
  browsing: boolean;
};

export function readUrlState(search = location.search): UrlState {
  const q = new URLSearchParams(search);
  let selection: Selection = null;
  for (const type of KINDS) {
    const id = q.get(type);
    if (!id) continue;
    selection = { type, id };
    const host = q.get("host");
    if (host) selection.host = host;
    const sub = q.get("sub");
    if (type === "agent" && sub) selection.subagent = sub;
    break;
  }
  const tab = q.get("tab") as Tab | null;
  const filter = q.get("filter") as Filter | null;
  const on = q.get("on");
  return {
    selection,
    tab: tab && TABS.includes(tab) ? tab : undefined,
    filter: filter && FILTERS.includes(filter) ? filter : undefined,
    hostFilter: on === null ? null : on === "local" ? "" : on,
    browsing: !selection || q.get("list") === "1",
  };
}

export function urlSearch(state: UrlState, defaults: { tab: Tab }): string {
  const q = new URLSearchParams();
  const s = state.selection;
  if (s) {
    q.set(s.type, s.id);
    if (s.host) q.set("host", s.host);
    if (s.subagent) q.set("sub", s.subagent);
    if (state.browsing) q.set("list", "1");
  }
  if (state.tab && state.tab !== defaults.tab) q.set("tab", state.tab);
  if (state.filter && state.filter !== "all") q.set("filter", state.filter);
  if (state.hostFilter !== null) q.set("on", state.hostFilter || "local");
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** The selection's identity, for telling a new place from a tweak of this one. */
export const selectionKey = (s: Selection) =>
  s ? `${s.type}:${s.id}:${s.host ?? ""}:${s.subagent ?? ""}` : "";
