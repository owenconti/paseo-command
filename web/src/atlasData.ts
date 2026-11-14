/** The fleet as Crew takes it (`AtlasData`): the world snapshot's rows with each agent's truthful state (a pending
 * request a question or an approval, an idle reply that waits on you, unread as done, stale as offline), and each
 * workspace's PR labels, Probe's verdict and auto-merge (src/crew/). */
import type { AtlasData } from "./model/fleet";
import type { ProbeVerdict } from "./model/probe";
import type { WorldSnapshot } from "./worldBridge";
import type { Selection } from "./types";
import { projectKey, workspaceKey } from "./workspaces";

/** Hosts are keyed by their bridge id ("local" or a server id), as rows reference them. */
export function atlasData(
  snapshot: WorldSnapshot,
  questions: Set<string>,
  asking: Set<string> = new Set(),
  /** Probe's verdicts, keyed `<host>:<workspaceId>` (useProbe). */
  probe: Record<string, ProbeVerdict> = {},
): AtlasData {
  return {
    hosts: snapshot.hosts.map((h) => ({
      key: h.id,
      name: h.name,
      online: !/offline|stale/.test(h.state),
      local: h.local,
    })),
    projects: snapshot.projects.map((p) => ({
      key: p.key,
      host: p.hostId,
      name: p.name,
      stale: p.stale,
    })),
    workspaces: snapshot.workspaces.map((w) => ({
      key: w.key,
      host: w.hostId,
      project: w.projectKey,
      name: w.name,
      stale: w.stale,
      labels: w.labels,
      ...(w.autoMerge ? { autoMerge: true } : {}),
      ...(w.created ? { created: w.created } : {}),
      ...(probe[`${w.hostId}:${w.id}`] ? { probe: probe[`${w.hostId}:${w.id}`] } : {}),
    })),
    agents: snapshot.agents.map((a) => ({
      key: a.key,
      host: a.hostId,
      project: a.projectKey,
      workspace: a.workspaceKey,
      name: a.name,
      model: a.model,
      state: a.stale
        ? "offline"
        : a.state === "attention"
          ? questions.has(a.clientId ?? a.id)
            ? "question"
            : "approval"
          : (a.state === "unread" || a.state === "idle") &&
              asking.has(a.clientId ?? a.id)
            ? "asking"
            : a.state === "unread"
              ? "done"
              : a.state,
      subagents: a.subagentCount,
      subagentModels: a.subagentModels,
      created: a.created,
    })),
  };
}
/** The world key the app's selection points at, if it is drawn. */
export function selectionKey(selection: Selection, snapshot: WorldSnapshot) {
  if (!selection) return null;
  if (selection.type === "agent")
    return (
      snapshot.agents.find(
        (a) =>
          (a.clientId ?? a.id) === selection.id &&
          (!selection.host || a.hostId === selection.host),
      )?.key ?? null
    );
  const host = (id: string) => (id === "local" ? undefined : id);
  if (selection.type === "project")
    return (
      snapshot.projects.find(
        (p) =>
          projectKey({ projectId: p.id, host: host(p.hostId) }) ===
          selection.id,
      )?.key ?? null
    );
  if (selection.type === "workspace")
    return (
      snapshot.workspaces.find(
        (w) =>
          workspaceKey({ workspaceId: w.id, host: host(w.hostId) }) ===
          selection.id,
      )?.key ?? null
    );
  return null;
}
