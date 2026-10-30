import { useSyncExternalStore } from "react";
import { api, errorMessage } from "./api";
import { sameHost } from "./types";
import { projectKey, workspaceKey } from "./workspaces";
import { soundEvent } from "./soundCues";

/*
 * Renaming agents, workspaces and projects. The new name is the daemon's (the
 * agent's title, the workspace's title, the project's custom name, as the
 * Paseo app sets them), so it arrives
 * with the live fleet like any other change. Meanwhile it is shown at once:
 * an override, applied to the fleet's rows wherever they are read (the list,
 * headers, the world), until the rows say it themselves, and dropped (with
 * a notice) if the daemon refuses.
 */

/** The longest name the server accepts (the daemon's agent title limit). */
export const MAX_NAME = 200;

export type RenameKind = "agent" | "workspace" | "project";
type Override = { name: string; saved: boolean; at: number };

/** How long a saved name is shown before the fleet must have it. */
const SETTLE_MS = 15000;

const overrides = new Map<string, Override>();
const listeners = new Set<() => void>();
/** What is shown: a new copy whenever an override or request changes. */
let shown: ReadonlyMap<string, Override> = new Map();
const changed = () => {
  shown = new Map(overrides);
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const keyOf = (kind: RenameKind, key: string) => `${kind}|${key}`;

/** A name as the server will store it: trimmed, inner whitespace collapsed. */
export const cleanName = (name: string) => name.replace(/\s+/g, " ").trim();

/** The renames shown now; re-renders when one starts, settles or is
 *  rolled back, or a "Rename…" is asked for. */
export const useRenames = () =>
  useSyncExternalStore(
    subscribe,
    () => shown,
    () => shown,
  );

/**
 * The rows with any rename in progress shown. Unchanged when none applies,
 * so memoised consumers don't redraw.
 */
export function withRenames<T extends { name: string }>(
  rows: T[],
  kind: RenameKind,
  key: (row: T) => string,
  renames: ReadonlyMap<string, Override> = shown,
): T[] {
  if (!renames.size) return rows;
  let out: T[] | null = null;
  rows.forEach((row, i) => {
    const o = renames.get(keyOf(kind, key(row)));
    if (!o || o.name === row.name) return;
    out ??= rows.slice();
    out[i] = { ...row, name: o.name };
  });
  return out ?? rows;
}

/**
 * Agents with any rename in progress shown: their own (the name), and,
 * for an agent named by its workspace's title (alone in a titled
 * workspace, as the Paseo app names its chat), the workspace's.
 */
export function withAgentRenames<
  T extends {
    id: string;
    name: string;
    title?: string;
    workspaceId?: string;
    host?: string;
  },
>(rows: T[], renames: ReadonlyMap<string, Override> = shown): T[] {
  if (!renames.size) return rows;
  const named = withRenames(rows, "agent", (a) => a.id, renames);
  let out: T[] | null = null;
  named.forEach((row, i) => {
    if (!row.title || !row.workspaceId) return;
    const o = renames.get(
      keyOf(
        "workspace",
        workspaceKey({ ...row, workspaceId: row.workspaceId }),
      ),
    );
    if (!o || o.name === row.title) return;
    out ??= named.slice();
    out[i] = { ...row, title: o.name };
  });
  return out ?? named;
}

/**
 * Projects with any rename in progress shown, and their workspaces, which
 * name their project (by its ID when they carry one, else by its old name).
 */
export function withProjectRenames<
  P extends { projectId: string; name: string; host?: string },
  W extends { projectId?: string; project: string; host?: string },
>(
  projects: P[],
  workspaces: W[],
  renames: ReadonlyMap<string, Override> = shown,
): { projects: P[]; workspaces: W[] } {
  const named = withRenames(projects, "project", projectKey, renames);
  if (named === projects) return { projects, workspaces };
  let out: W[] | null = null;
  workspaces.forEach((w, i) => {
    const at = projects.findIndex(
      (p) =>
        (w.projectId ? w.projectId === p.projectId : w.project === p.name) &&
        sameHost(w, p),
    );
    if (at < 0 || named[at].name === projects[at].name) return;
    out ??= workspaces.slice();
    out[i] = { ...w, project: named[at].name };
  });
  return { projects: named, workspaces: out ?? workspaces };
}

/**
 * The name a title shows for an agent, and what renaming it changes: the
 * workspace's title when the agent is named by it, else the agent's own.
 */
export function agentRenameTarget(a: {
  id: string;
  name: string;
  title?: string;
  workspaceId?: string;
  host?: string;
}) {
  return a.title && a.workspaceId
    ? {
        kind: "workspace" as const,
        key: workspaceKey({ workspaceId: a.workspaceId, host: a.host }),
        id: a.workspaceId,
        host: a.host,
        value: a.title,
      }
    : {
        kind: "agent" as const,
        key: a.id,
        id: a.id,
        host: a.host,
        value: a.name && a.name !== "-" ? a.name : "",
      };
}

/**
 * Forget saved renames the fleet now shows (or that it hasn't caught up with
 * in SETTLE_MS: the fleet is the truth then).
 */
export function settleRenames<T extends { name: string }>(
  rows: T[],
  kind: RenameKind,
  key: (row: T) => string,
  now = Date.now(),
) {
  let dropped = false;
  const names = new Map(rows.map((r) => [keyOf(kind, key(r)), r.name]));
  for (const [k, o] of overrides) {
    if (!k.startsWith(`${kind}|`) || !o.saved) continue;
    if (names.get(k) === o.name || now - o.at > SETTLE_MS) {
      overrides.delete(k);
      dropped = true;
    }
  }
  if (dropped) changed();
}

const RENAME_PATH: Record<RenameKind, string> = {
  agent: "agents",
  workspace: "workspaces",
  project: "projects",
};

/**
 * Rename an agent (`id` is its client ID), a workspace (its workspace ID) or
 * a project (its project ID) on its host: shown at once, rolled back with a notice on failure.
 * Resolves whether it was saved.
 */
export async function rename(
  target: {
    kind: RenameKind;
    /** The row's key in the fleet (agent ID, or workspace or project key). */
    key: string;
    id: string;
    host?: string;
  },
  name: string,
  onNotice: (message: string) => void,
) {
  const clean = cleanName(name);
  if (!clean) return false;
  const k = keyOf(target.kind, target.key);
  const previous = overrides.get(k);
  overrides.set(k, { name: clean, saved: false, at: Date.now() });
  changed();
  try {
    const result = await api<{ name?: string }>(
      `${RENAME_PATH[target.kind]}/${encodeURIComponent(target.id)}/rename`,
      { name: clean, ...(target.host ? { host: target.host } : {}) },
    );
    // A later rename of the same thing takes over.
    if (overrides.get(k)?.name === clean)
      overrides.set(k, {
        name: result?.name || clean,
        saved: true,
        at: Date.now(),
      });
    changed();
    return true;
  } catch (error) {
    if (overrides.get(k)?.name === clean) {
      if (previous?.saved) overrides.set(k, previous);
      else overrides.delete(k);
    }
    changed();
    // A rename that works is quiet (the new name shows); one refused fails audibly.
    soundEvent("actionFailed");
    onNotice(
      `Couldn’t rename this ${target.kind}: ${errorMessage(error) || "the request failed."}`,
    );
    return false;
  }
}

/** Requests to start editing a name, made before its editor is shown. */
const editRequests = new Set<string>();

/** Ask the editor for this agent, workspace or project to open (now or once shown). */
export function requestRename(kind: RenameKind, key: string) {
  editRequests.add(keyOf(kind, key));
  changed();
}
/** Whether an edit was asked for, consuming the request. */
export function takeRenameRequest(kind: RenameKind, key: string) {
  return editRequests.delete(keyOf(kind, key));
}

/** For tests: forget every rename and request. */
export function resetRenames() {
  overrides.clear();
  editRequests.clear();
  changed();
}
