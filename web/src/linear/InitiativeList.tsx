import { useMemo, type ReactNode } from "react";
import { Box, Target } from "lucide-react";
import { Health, Person, ScreenHead, shortDate } from "./bits";
import { Progress } from "./ProjectList";
import { useLinear } from "./store";

/** The workspace's initiatives: status, health, owner, target date and their projects, each opening that project. */
export function InitiativeList({ onProject, actions }: { onProject: (projectId: string) => void; actions?: ReactNode }) {
  const ws = useLinear((d) => d.workspace);
  const initiatives = useMemo(
    () => [...(ws?.initiatives ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [ws],
  );
  return (
    <div className="linear-list linear-initiatives">
      <ScreenHead title="Initiatives" count={ws ? initiatives.length : undefined}>
        {actions}
      </ScreenHead>
      <div className="linear-cards" role="list" aria-label="Initiatives">
        {!ws && <p className="linear-note">Loading initiatives…</p>}
        {ws && !initiatives.length && <p className="linear-note">No initiatives.</p>}
        {initiatives.map((initiative) => {
          const owner = ws?.users.find((u) => u.id === initiative.ownerId);
          const projects = initiative.projectIds
            .map((id) => ws?.projects.find((p) => p.id === id))
            .filter((p) => p !== undefined);
          return (
            <section key={initiative.id} role="listitem" className="linear-initiative-row" aria-label={initiative.name}>
              <header>
                <Target size={14} aria-hidden="true" />
                <h3>{initiative.name}</h3>
                <span className="linear-project-status">{initiative.status}</span>
                <Health health={initiative.health} />
                {owner && (
                  <span className="linear-project-lead">
                    <Person user={owner} /> {owner.name}
                  </span>
                )}
                {initiative.targetDate && (
                  <span className="linear-project-date">{shortDate(initiative.targetDate)}</span>
                )}
              </header>
              {projects.length > 0 ? (
                <ul className="linear-initiative-projects" aria-label={`${initiative.name}'s projects`}>
                  {projects.map((p) => (
                    <li key={p.id}>
                      <button className="linear-project-chip" onClick={() => onProject(p.id)}>
                        <Box size={13} style={{ color: p.color }} aria-hidden="true" />
                        <span className="linear-title">{p.name}</span>
                        <Progress value={p.progress} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="linear-note">No projects yet.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
