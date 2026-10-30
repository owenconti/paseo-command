import { useEffect, useState } from "react";
import { api } from "./api";
import type { HostStats } from "../../rendering/src/world";

/** How often host loads are asked for (the server reuses each host's for as long). */
export const HOST_STATS_POLL_MS = 15000;

/** Each host machine's load (server/hostStats.ts), keyed "local" or its
 *  server id; hosts without the host-stats plugin are absent. Polled while the page is shown. */
export function useHostStats(): Record<string, HostStats> {
  const [stats, setStats] = useState<Record<string, HostStats>>({});
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      clearTimeout(timer);
      if (!document.hidden) {
        // A failed lookup keeps the loads already shown.
        const next = await api<Record<string, HostStats>>("hoststats", undefined, controller.signal).catch(() => null);
        if (stopped) return;
        if (next) setStats((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      }
      if (!stopped) timer = setTimeout(poll, HOST_STATS_POLL_MS);
    }
    // Shown again: ask now rather than at the next turn.
    const shown = () => !document.hidden && void poll();
    document.addEventListener("visibilitychange", shown);
    void poll();
    return () => {
      document.removeEventListener("visibilitychange", shown);
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  return stats;
}
