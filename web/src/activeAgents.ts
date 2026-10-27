import { agentIdParts } from "./agentIdentity";
import { isArchived, type Agent } from "./types";

/** Tombstones fence late daemon events after a confirmed archive. Host is part
 * of the identity: an agent on another daemon is a different record. */
export const agentIdentity = (id: string, host?: string) => {
  const parts = agentIdParts(id);
  return JSON.stringify([host || parts.host || "local", parts.id]);
};
const archived = new Set<string>();
const listeners = new Set<(id: string, host?: string) => void>();
try {
  const stored: unknown = JSON.parse(
    localStorage.getItem("paseo-command:archived-agents") || "[]",
  );
  if (Array.isArray(stored))
    for (const key of stored) if (typeof key === "string") archived.add(key);
} catch {
  /* Storage may be unavailable. */
}
export function agentExcluded(
  agent: Pick<Agent, "id" | "host" | "status" | "archived">,
) {
  return isArchived(agent) || archived.has(agentIdentity(agent.id, agent.host));
}
export function archiveAgent(id: string, host?: string) {
  const key = agentIdentity(id, host);
  if (archived.has(key)) return;
  archived.add(key);
  try {
    localStorage.setItem(
      "paseo-command:archived-agents",
      JSON.stringify([...archived]),
    );
  } catch {
    /* Keep the in-memory fence. */
  }
  for (const listener of listeners) listener(id, host);
}
export function activeAgents<T extends Agent>(rows: T[]): T[] {
  for (const row of rows) if (isArchived(row)) archiveAgent(row.id, row.host);
  return rows.filter((row) => !agentExcluded(row));
}
export function onAgentArchived(listener: (id: string, host?: string) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (event.key !== "paseo-command:archived-agents") return;
    try {
      const keys = JSON.parse(event.newValue || "[]");
      if (Array.isArray(keys))
        for (const key of keys) {
          if (typeof key !== "string" || archived.has(key)) continue;
          const [host, id] = JSON.parse(key);
          if (typeof id === "string" && typeof host === "string")
            archiveAgent(id, host === "local" ? undefined : host);
        }
    } catch {
      /* Ignore malformed external storage. */
    }
  });
