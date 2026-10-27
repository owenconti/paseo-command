import { agentIdParts } from "./agentIdentity";
import { useSyncExternalStore } from "react";
import {
  agentLabel,
  cleanText,
  hasOpaqueId,
  knownIdsRevision,
  onKnownIds,
} from "./display";
import type { Agent } from "./types";

/*
 * Readable UI names, using the shared rules in display.ts:
 * never an opaque identifier (hex agent IDs, hashes, UUIDs, and every ID the
 * app knows: agents', workspaces', projects', hosts'). Raw IDs are only
 * behind an explicit "Copy agent ID".
 */

/** An identifier rather than a word: long enough, and with a digit or an
 *  underscore (prj_…, wks_…, srv_…, UUIDs), or all hex (short agent IDs).
 *  A word used as an ID ("atlas", "long") stays a word in names. */
export const idLike = (id: string | undefined | null) =>
  !!id && id.length >= 6 && (/[\d_]/.test(id) || /^[0-9a-f]{7,}$/i.test(id));

type AgentLike = Pick<
  Agent,
  "id" | "shortId" | "name" | "provider" | "branch"
> & { title?: string };

/** Re-renders when known IDs change, including labels shown before an ID was known. */
export const useKnownIds = () =>
  useSyncExternalStore(onKnownIds, knownIdsRevision);

/** An agent's name in full (the UI truncates it): the title set in the
 *  Paseo app, else its own name, without IDs (its own always, whatever the
 *  registry knows yet); if nothing readable is left, its issue key and short
 *  title. */
export function agentName(a: AgentLike, branch?: string | null) {
  return remember(
    `n|${a.id}|${a.shortId}|${a.title ?? ""}|${a.name}|${branch ?? ""}|${a.branch ?? ""}`,
    () => {
      const ids = [a.id, agentIdParts(a.id).id, a.shortId].filter(idLike);
      const full = cleanText(a.title, ids) || cleanText(a.name, ids);
      if (full) return full;
      const { key, title } = agentLabel(a, branch);
      return key && title ? `${key} ${title}` : key || title;
    },
  );
}
/** The agent session's own title, as the Paseo app shows it on the session
 *  (the daemon's agent title), never its workspace's title. Cleaned and,
 *  when it has none, named by the same fallback as `agentName`: its issue
 *  key and short title from its branch, else its provider. */
export const sessionName = (a: AgentLike, branch?: string | null) =>
  agentName(
    {
      id: a.id,
      shortId: a.shortId,
      // The rows say "-" for an agent without a title.
      name: a.name === "-" ? "" : a.name,
      provider: a.provider,
      branch: a.branch,
    },
    branch,
  );
/** The name of the agent as the fleet lists it now (renames included),
 *  else as last seen. */
export const currentName = (a: AgentLike, fleet: AgentLike[]) =>
  agentName(fleet.find((f) => f.id === a.id) ?? a);
/** The agent's Linear issue key (from its branch or title), if any. */
export const agentKey = (a: AgentLike, branch?: string | null) =>
  remember(
    `k|${a.id}|${a.shortId}|${a.title ?? ""}|${a.name}|${branch ?? ""}|${a.branch ?? ""}`,
    () => agentLabel(a, branch).key ?? "",
  ) || null;
/** A place's or message's shown text, as placeText computes it. */
const cleanCached = (
  text: string | null | undefined,
  ids: (string | undefined | null)[] | undefined,
  fallback: string,
) =>
  remember(`p|${text ?? ""}|${(ids ?? []).join(",")}|${fallback}`, () =>
    cleanText(text, ids, fallback),
  );

/**
 * Labels are pure for a given text and set of known IDs, and lists show
 * hundreds of them on every render: computed once each, until the known
 * IDs change.
 */
const memo = new Map<string, string>();
let memoRevision = -1;
function remember(key: string, compute: () => string) {
  if (memoRevision !== knownIdsRevision()) {
    memo.clear();
    memoRevision = knownIdsRevision();
  }
  let v = memo.get(key);
  if (v === undefined) {
    if (memo.size > 20000) memo.clear();
    memo.set(key, (v = compute()));
  }
  return v;
}
/** A project, workspace, branch or message, without IDs (and `ids`). */
export const placeText = (
  name: string | undefined | null,
  fallback = "",
  ids?: (string | undefined | null)[],
) => cleanCached(name, ids, fallback);
/** A host's name: its label, unless it has none (the server reports its ID
 *  in its place) or the label is only an ID. */
export function hostText(h: {
  label?: string;
  hostLabel?: string;
  serverId?: string;
  host?: string;
  local?: boolean;
}) {
  if (h.local) return "local";
  const id = h.serverId ?? h.host;
  const label = h.label ?? h.hostLabel;
  if (!label || label === id) return "remote host";
  return cleanText(label, [id], "remote host");
}
/** A path for reading: segments that are IDs show as "…" (copying uses the
 *  path itself). */
export function pathText(
  path: string | undefined | null,
  ids?: (string | undefined | null)[],
) {
  return String(path ?? "")
    .split("/")
    .map((seg) =>
      seg && hasOpaqueId(seg, (ids ?? []).filter(idLike)) ? "…" : seg,
    )
    .join("/");
}
