/** The open conversation's permission mode and the modes its provider offers, as its Session knows them, so ⌘K can
 *  offer the others ("Set the permission mode: Plan"). Session publishes it (`publishAgentMode`) and clears its own. */
import { useSyncExternalStore } from "react";
import type { Mode } from "./types";

export type OpenAgentMode = { agentId: string; mode?: string; modes: Mode[] };

let current: OpenAgentMode | null = null;
const listeners = new Set<() => void>();
const same = (a: OpenAgentMode | null, b: OpenAgentMode | null) => JSON.stringify(a) === JSON.stringify(b);

export function publishAgentMode(next: OpenAgentMode | null): void {
  if (same(current, next)) return;
  current = next;
  listeners.forEach((l) => l());
}

/** Clears what `agentId` published, leaving another conversation's alone. */
export function clearAgentMode(agentId: string): void {
  if (current?.agentId === agentId) publishAgentMode(null);
}

export const useOpenAgentMode = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
