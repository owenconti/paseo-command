import type { ReactNode } from "react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import DiffsWorker from "@pierre/diffs/worker/worker.js?worker";

/** The diffs' themes, the same in the workers and the components. */
export const DIFF_THEMES = { dark: "pierre-dark", light: "pierre-light" } as const;

/** Few workers: highlighting is bursty (a diff opening), and each holds its own Shiki. */
const POOL_SIZE = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));

/**
 * Highlights the GitHub tab's diffs in web workers (@pierre/diffs's pool,
 * one per tab lifetime), so opening or scrolling a big diff doesn't block the
 * page while Shiki runs.
 */
export function DiffWorkers({ children }: { children: ReactNode }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory: () => new DiffsWorker(), poolSize: POOL_SIZE }}
      highlighterOptions={{ theme: DIFF_THEMES }}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
