/**
 * New agents still on their way to a pool box, at the head of the agent list (and the Crew map): each claim the
 * server is running (claiming, waiting for the box's host, starting the agent) with its latest step, and each
 * that failed with why, until dismissed. The claim is the server's (`web/server/pool.ts`), so these rows
 * come back wherever the page is reopened; a claim that worked leaves once the fleet lists its agent.
 */
import { LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { jobRunning, jobText, pendingClaims, type PoolJob } from "./pool";
import { dismissPoolJob, usePool } from "./poolStore";
import { errorMessage } from "./api";
import "./pool-claims.css";

type Known = { id: string; daemonId?: string }[];

export function PoolClaims({
  agents,
  onOpen,
  onNotice,
}: {
  /** The fleet's agents, so a claim whose agent is listed gives way to it. */
  agents: Known;
  /** Open New agent (which shows a claim it sent, or why it failed, its message back). */
  onOpen: () => void;
  onNotice?: (message: string) => void;
}) {
  // The page's own read (main.tsx reads it while Pool boxes are on).
  const pool = usePool(false);
  const enabled = !!pool?.enabled;
  // Done claims linger only briefly while the fleet catches up: look again now and then.
  const [now, setNow] = useState(Date.now());
  const claims = enabled ? pendingClaims(pool?.jobs, (id) => agents.some((a) => a.id === id || a.daemonId === id), now) : [];
  const lingering = claims.some((j) => j.phase === "done");
  useEffect(() => {
    if (!lingering) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [lingering]);
  if (!claims.length) return null;
  return (
    <ul className="pool-claims" aria-label="New agents on pool boxes">
      {claims.map((job) => (
        <Claim key={job.id} job={job} onOpen={onOpen} onNotice={onNotice} />
      ))}
    </ul>
  );
}

function Claim({ job, onOpen, onNotice }: { job: PoolJob; onOpen: () => void; onNotice?: (m: string) => void }) {
  const running = jobRunning(job);
  const failed = job.phase === "failed";
  const step = running ? job.steps[job.steps.length - 1] : undefined;
  const box = job.pool ?? "a pool box";
  return (
    <li className="pool-claim" data-phase={job.phase} aria-busy={running || undefined}>
      <button
        className="pool-claim-main"
        onClick={onOpen}
        aria-description={failed ? "Open New agent: its message is back in the draft" : "Open New agent to follow it"}
      >
        <span className="pool-claim-icon" aria-hidden="true">
          {failed ? <TriangleAlert size={14} /> : <LoaderCircle size={14} className={running ? "spinning" : undefined} />}
        </span>
        <span className="pool-claim-text">
          <span className="pool-claim-name">{job.title || `New agent on ${box}`}</span>
          <span className="pool-claim-state" role={failed ? "alert" : "status"}>
            {jobText(job)}
            {step ? ` · ${step}` : ""}
          </span>
          {job.where && !failed && <span className="pool-claim-where">{`${box} · ${job.where}`}</span>}
        </span>
      </button>
      {failed && (
        <button
          className="pool-claim-dismiss"
          aria-label={`Dismiss the failed claim of ${box}`}
          data-tip="Dismiss"
          onClick={() => dismissPoolJob(job.id).catch((e) => onNotice?.(errorMessage(e)))}
        >
          <X size={13} />
        </button>
      )}
    </li>
  );
}
