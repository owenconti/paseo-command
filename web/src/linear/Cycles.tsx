import { useEffect, useMemo, useState, type ReactNode } from "react";
import { RefreshCcw } from "lucide-react";
import { errorMessage } from "../api";
import { cycleName, dayRange, ScreenHead } from "./bits";
import { Progress } from "./ProjectList";
import { loadCycles, scopeIssues, useLinear } from "./store";
import type { LinearCycle } from "./types";

/** A team's cycles in Linear's sections: the current one, those coming up (soonest first), and past ones (latest first). */
export function cycleSections(cycles: LinearCycle[]): { title: string; cycles: LinearCycle[] }[] {
  const current = cycles.filter((c) => c.isActive);
  const upcoming = cycles.filter((c) => !c.isActive && !c.isPast).sort((a, b) => a.number - b.number);
  const past = cycles.filter((c) => !c.isActive && c.isPast).sort((a, b) => b.number - a.number);
  return [
    { title: "Current", cycles: current },
    { title: "Upcoming", cycles: upcoming },
    { title: "Past", cycles: past },
  ].filter((s) => s.cycles.length);
}

/** "3 of 5 done", as Linear last counted the cycle's issues. */
const doneOf = (done: number, scope: number) => (scope ? `${done} of ${scope} done` : "No issues");

/** A team's cycles: the current one, upcoming and recent past ones, each with its days and progress; one opens its issues. */
export function CycleList({
  teamId,
  title,
  revision,
  onCycle,
}: {
  teamId: string;
  title: ReactNode;
  /** Changes when the view refreshes: the cycles are asked for again. */
  revision: number;
  onCycle: (cycleId: string) => void;
}) {
  const cycles = useLinear((d) => d.cycles.get(teamId));
  const [error, setError] = useState<string>();
  useEffect(() => {
    setError(undefined);
    loadCycles(teamId, revision > 0).catch((e) => setError(errorMessage(e)));
  }, [teamId, revision]);
  const sections = useMemo(() => cycleSections(cycles ?? []), [cycles]);
  return (
    <div className="linear-list linear-cycles">
      <ScreenHead title={title} count={cycles?.length} />
      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}
      <div className="linear-table" aria-label="Cycles">
        {!cycles && !error && <p className="linear-note">Loading cycles…</p>}
        {cycles && !cycles.length && <p className="linear-note">No current, upcoming or recent cycles.</p>}
        {sections.map((section) => (
          <section key={section.title} className="linear-cycle-section" aria-label={section.title}>
            <h3>{section.title}</h3>
            {section.cycles.map((c) => (
              <button key={c.id} className="linear-cycle-row" onClick={() => onCycle(c.id)}>
                <span className="linear-project-name">
                  <RefreshCcw size={14} aria-hidden="true" className={c.isActive ? "current" : undefined} />
                  <span className="linear-title">{cycleName(c)}</span>
                </span>
                <span className="linear-project-date">{dayRange(c.startsAt, c.endsAt)}</span>
                <span className="linear-cycle-count">{doneOf(c.done ?? 0, c.scope ?? 0)}</span>
                <Progress value={c.progress ?? 0} />
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}

/** The open cycle's days, and its issues done of those in it, counted from the store (an edit counts at once). */
export function CycleFacts({ cycle, scope }: { cycle?: LinearCycle; scope: `cycle:${string}` }) {
  const counts = useLinear((d) => {
    const issues = scopeIssues(d, scope);
    const types = new Map(d.workspace?.states.map((s) => [s.id, s.type]));
    const done = issues.filter((i) => ["completed", "canceled"].includes(types.get(i.stateId) ?? "")).length;
    return `${done}/${issues.length}`;
  });
  const [done, total] = counts.split("/").map(Number);
  return (
    <span className="linear-project-facts">
      {cycle && <span className="linear-project-status">{cycle.isActive ? "Current" : cycle.isPast ? "Ended" : "Upcoming"}</span>}
      {cycle && <span className="linear-project-date">{dayRange(cycle.startsAt, cycle.endsAt)}</span>}
      <span className="linear-cycle-count">{doneOf(done, total)}</span>
      <Progress value={total ? done / total : 0} />
    </span>
  );
}
