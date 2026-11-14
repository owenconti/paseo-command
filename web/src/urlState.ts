/**
 * What is open, kept in the page's query so a refresh (or a shared link) returns there: the selection and any open
 * subagent.
 *
 *   ?agent=<id>[&host=<id>][&sub=<id>]  or  ?workspace=<id>  or  ?project=<id>
 */
import type { Selection } from "./types";

const KINDS = ["agent", "workspace", "project"] as const;

export type UrlState = { selection: Selection };

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
  return { selection };
}

export function urlSearch(state: UrlState): string {
  const q = new URLSearchParams();
  const s = state.selection;
  if (s) {
    q.set(s.type, s.id);
    if (s.host) q.set("host", s.host);
    if (s.subagent) q.set("sub", s.subagent);
  }
  const text = q.toString();
  return text ? `?${text}` : "";
}

/** The selection's identity, for telling a new place from a tweak of this one. */
export const selectionKey = (s: Selection) =>
  s ? `${s.type}:${s.id}:${s.host ?? ""}:${s.subagent ?? ""}` : "";
