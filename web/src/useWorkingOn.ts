import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { isRunning, isArchived, type Agent } from "./types";
export type WorkSummary = {
  sentence: string | null;
  pending: boolean;
  error?: string;
};
export type WorkSummaries = Record<string, WorkSummary | undefined>;
const turnKey = (agent: Agent) =>
  `${agent.id}|${agent.lastUserMessageAt ?? agent.createdAt ?? ""}`;

/** One fleet-wide poll feeds both the composer and map; requests only start on POST. */
export function useWorkingOn(agents: Agent[], waiting: Set<string>) {
  const latest = useRef({ agents, waiting });
  latest.current = { agents, waiting };
  const [values, setValues] = useState<Record<string, WorkSummary>>({});
  const eligible = agents.filter(
    (a) =>
      isRunning(a.status) &&
      !a.stale &&
      !isArchived(a) &&
      !waiting.has(a.id) &&
      a.workspaceId &&
      a.name !== "Current work summary",
  );
  const signature = eligible.map(turnKey).sort().join("\n");
  useEffect(() => {
    if (!signature) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      if (!document.hidden) {
        const { agents, waiting } = latest.current;
        const current = agents.filter(
          (a) =>
            isRunning(a.status) &&
            !a.stale &&
            !isArchived(a) &&
            !waiting.has(a.id) &&
            a.workspaceId &&
            a.name !== "Current work summary",
        );
        // Requests respond immediately with the cached result or pending state.
        await Promise.allSettled(
          current.map(async (agent) => {
            const key = turnKey(agent);
            try {
              const summary = await api<WorkSummary>(
                `agents/${agent.id}/working-on`,
                agent.host ? { host: agent.host } : {},
                controller.signal,
              );
              if (!stopped)
                setValues((old) =>
                  JSON.stringify(old[key]) === JSON.stringify(summary)
                    ? old
                    : { ...old, [key]: summary },
                );
            } catch {
              if (!stopped)
                setValues((old) => ({
                  ...old,
                  [key]: {
                    sentence: null,
                    pending: false,
                    error: "Current work summary unavailable.",
                  },
                }));
            }
          }),
        );
      }
      if (!stopped) timer = setTimeout(poll, 5000);
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [signature]);
  return Object.fromEntries(
    eligible.map((a) => [a.id, values[turnKey(a)]]),
  ) as WorkSummaries;
}
