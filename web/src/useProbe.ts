import { useEffect, useState } from "react";
import { api } from "./api";
import type { ProbeVerdict } from "../../rendering/src/probe";

/** How often Probe's verdicts are asked for (the server caches each PR's for as long). */
export const PROBE_POLL_MS = 30000;

/** Probe's verdict on each workspace's PR (server/probe.ts), keyed
 *  `<host or "local">:<workspaceId>`; polled while the page is shown. */
export function useProbe(): Record<string, ProbeVerdict> {
  const [verdicts, setVerdicts] = useState<Record<string, ProbeVerdict>>({});
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      clearTimeout(timer);
      if (!document.hidden) {
        // A failed lookup keeps the verdicts already shown.
        const next = await api<Record<string, ProbeVerdict>>("probe", undefined, controller.signal).catch(() => null);
        if (stopped) return;
        if (next) setVerdicts((old) => (JSON.stringify(old) === JSON.stringify(next) ? old : next));
      }
      if (!stopped) timer = setTimeout(poll, PROBE_POLL_MS);
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
  return verdicts;
}
