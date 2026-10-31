import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { NO_ASKS, type Asks } from "./asks/types";
import { isArchived, type Agent } from "./types";

const turnKey = (a: Agent) =>
  `${a.id}|${a.updatedAt ?? ""}|${a.lastUserMessageAt ?? ""}`;
const eligible = (a: Agent) =>
  a.status === "idle" && !a.stale && !a.child && !isArchived(a);

/** What each idle agent's last reply asks of you (server/asks.ts), polled
 *  until its turn is judged; each turn is judged once. */
export function useAsks(
  agents: Agent[],
  enabled = false,
): Record<string, Asks | undefined> {
  const latest = useRef(agents);
  latest.current = agents;
  const [values, setValues] = useState<Record<string, Asks>>({});
  const settled = useRef(new Set<string>());
  const shown = agents.filter(eligible);
  const signature = shown.map(turnKey).sort().join("\n");
  useEffect(() => {
    if (!enabled) {
      settled.current.clear();
      setValues({});
      return;
    }
    if (!signature) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      let retry = 0;
      if (!document.hidden) {
        const due = latest.current
          .filter(eligible)
          .filter((a) => !settled.current.has(turnKey(a)));
        await Promise.allSettled(
          due.map(async (agent) => {
            const key = turnKey(agent);
            const asks = await api<Asks>(
              `agents/${agent.id}/asks`,
              agent.host ? { host: agent.host } : {},
              controller.signal,
            ).catch(() => ({ ...NO_ASKS, error: "unavailable" }));
            if (stopped) return;
            if (asks.pending) retry = 3000;
            else if (asks.error) retry ||= 30000;
            else settled.current.add(key);
            setValues((old) =>
              JSON.stringify(old[key]) === JSON.stringify(asks)
                ? old
                : { ...old, [key]: asks },
            );
          }),
        );
      } else retry = 3000;
      // Pending judgements land in a second or two; errors are retried slowly.
      if (!stopped && retry) timer = setTimeout(poll, retry);
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [signature, enabled]);
  return !enabled
    ? {}
    : Object.fromEntries(shown.map((a) => [a.id, values[turnKey(a)]]));
}
