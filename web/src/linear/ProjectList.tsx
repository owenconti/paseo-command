import { useMemo, type CSSProperties, type ReactNode } from "react";
import { Box } from "lucide-react";
import { Health, Person, ScreenHead, shortDate } from "./bits";
import { useLinear } from "./store";
import type { LinearProject, LinearWorkspace } from "./types";

/** Linear's project statuses in the order the list shows them; others follow, by name. */
const STATUS_ORDER = ["Started", "In Progress", "Planned", "Backlog", "Paused", "Completed", "Canceled"];
const statusRank = (status: string) => {
  const at = STATUS_ORDER.findIndex((s) => s.toLowerCase() === status.toLowerCase());
  return at < 0 ? STATUS_ORDER.length : at;
};

/** The projects by status (started first), then by name. */
export function sortProjects(projects: LinearProject[]): LinearProject[] {
  return [...projects].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.name.localeCompare(b.name));
}

/** A project's progress as a ring and its percent. */
export function Progress({ value }: { value: number }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <span className="linear-progress" aria-label={`${percent}% done`}>
      <span className="linear-progress-ring" style={{ "--p": `${percent}%` } as CSSProperties} aria-hidden="true" />
      {percent}%
    </span>
  );
}

/** A project's facts in one line: status, health, lead, target date, progress. */
export function ProjectFacts({ project, ws }: { project: LinearProject; ws: LinearWorkspace | undefined }) {
  const lead = ws?.users.find((u) => u.id === project.leadId);
  return (
    <span className="linear-project-facts">
      <span className="linear-project-status">{project.status}</span>
      <Health health={project.health} />
      {lead && (
        <span className="linear-project-lead">
          <Person user={lead} /> {lead.name}
        </span>
      )}
      {project.targetDate && <span className="linear-project-date">{shortDate(project.targetDate)}</span>}
      <Progress value={project.progress} />
    </span>
  );
}

/** The workspace's projects (current ones, and those finished in the last 30 days); one opens its issues. */
export function ProjectList({ onProject, actions }: { onProject: (projectId: string) => void; actions?: ReactNode }) {
  const ws = useLinear((d) => d.workspace);
  const projects = useMemo(() => sortProjects(ws?.projects ?? []), [ws]);
  return (
    <div className="linear-list linear-projects">
      <ScreenHead title="Projects" count={ws ? projects.length : undefined}>
        {actions}
      </ScreenHead>
      <div className="linear-table" role="list" aria-label="Projects">
        {!ws && <p className="linear-note">Loading projects…</p>}
        {ws && !projects.length && <p className="linear-note">No projects.</p>}
        {projects.length > 0 && (
          <div className="linear-table-head" aria-hidden="true">
            <span>Name</span>
            <span>Status</span>
            <span>Health</span>
            <span>Lead</span>
            <span>Target</span>
            <span>Progress</span>
          </div>
        )}
        {projects.map((p) => {
          const lead = ws?.users.find((u) => u.id === p.leadId);
          return (
            <button key={p.id} role="listitem" className="linear-project-row" onClick={() => onProject(p.id)}>
              <span className="linear-project-name">
                <Box size={14} style={{ color: p.color }} aria-hidden="true" />
                <span className="linear-title">{p.name}</span>
              </span>
              <span className="linear-project-status">{p.status}</span>
              <Health health={p.health} compact />
              <span className="linear-project-lead">
                {lead ? (
                  <>
                    <Person user={lead} /> <span className="linear-title">{lead.name}</span>
                  </>
                ) : (
                  <span className="linear-none">No lead</span>
                )}
              </span>
              <span className="linear-project-date">{shortDate(p.targetDate) || <span className="linear-none">—</span>}</span>
              <Progress value={p.progress} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
