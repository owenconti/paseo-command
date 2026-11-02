import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Activity, Box, CircleDot, SlidersHorizontal, UserRound, UserX, Users } from "lucide-react";
import { readStore, removeStore, writeStore } from "../api";
import { Health, Person, ScreenHead, shortDate } from "./bits";
import { SaveViewButton, type SaveViewAction } from "./IssueList";
import { FilterButton, FilterChips, type FilterControl, type FilterSpec } from "./ListControls";
import { placeBelow } from "./Picker";
import { useLinear } from "./store";
import type { LinearProject, LinearWorkspace } from "./types";
import {
  DEFAULT_PROJECT_DISPLAY,
  PROJECT_FILTER_FIELDS,
  PROJECT_GROUPINGS,
  PROJECT_HEALTHS,
  PROJECT_ORDERINGS,
  type ProjectDisplay,
  type ProjectFilterField,
  type ProjectFilters,
  type ProjectGrouping,
  type ProjectOrdering,
} from "./viewFilter";

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

const HEALTH_LABEL: Record<string, string> = { onTrack: "On track", atRisk: "At risk", offTrack: "Off track" };
const GROUPING_LABEL: Record<ProjectGrouping, string> = { none: "No grouping", status: "Status", health: "Health", lead: "Lead" };
const ORDERING_LABEL: Record<ProjectOrdering, string> = {
  status: "Status",
  name: "Name",
  target: "Target date",
  progress: "Progress",
  updated: "Last updated",
};
const FILTER_LABEL: Record<ProjectFilterField, string> = { status: "Status", health: "Health", lead: "Lead", team: "Team" };
const FILTER_ICON: Record<ProjectFilterField, ReactNode> = {
  status: <CircleDot size={13} aria-hidden="true" />,
  health: <Activity size={13} aria-hidden="true" />,
  lead: <UserRound size={13} aria-hidden="true" />,
  team: <Users size={13} aria-hidden="true" />,
};

/** Whether a project is finished: completed or canceled (by its status's kind, else its name). */
const finished = (p: LinearProject) =>
  p.statusType ? p.statusType === "completed" || p.statusType === "canceled" : /^(completed|canceled)$/i.test(p.status);

/** A project list's filters: status (by name), health, lead (or none) and team. */
export function projectFilterSpec(ws: LinearWorkspace | undefined, projects: LinearProject[]): FilterSpec<ProjectFilterField> {
  return {
    fields: PROJECT_FILTER_FIELDS,
    label: FILTER_LABEL,
    icon: FILTER_ICON,
    options: (field) => {
      switch (field) {
        case "status":
          return sortProjects([...new Map(projects.map((p) => [p.status, p])).values()])
            .filter((p) => p.status)
            .map((p) => ({ value: p.status, text: p.status }));
        case "health":
          return PROJECT_HEALTHS.map((h) => ({ value: h, text: HEALTH_LABEL[h], icon: <Health health={h} compact /> }));
        case "lead":
          return [
            { value: "none", text: "No lead", icon: <UserX size={13} /> },
            ...[...(ws?.users ?? [])]
              .sort((a, b) => Number(b.id === ws?.viewerId) - Number(a.id === ws?.viewerId) || a.name.localeCompare(b.name))
              .map((u) => ({ value: u.id, text: u.name, icon: <Person user={u} />, hint: u.id === ws?.viewerId ? "You" : undefined })),
          ];
        case "team":
          return (ws?.teams ?? []).map((t) => ({ value: t.id, text: t.name, hint: t.key }));
      }
    },
  };
}

/** The projects the filters and the display's finished choice let through. */
export function filterProjects(projects: LinearProject[], filters: ProjectFilters, display: ProjectDisplay): LinearProject[] {
  return projects.filter(
    (p) =>
      (display.completed === "all" || !finished(p)) &&
      (!filters.status?.length || filters.status.includes(p.status)) &&
      (!filters.health?.length || (!!p.health && filters.health.includes(p.health))) &&
      (!filters.lead?.length || filters.lead.includes(p.leadId ?? "none")) &&
      (!filters.team?.length || p.teamIds.some((t) => filters.team!.includes(t))),
  );
}

/** The projects in the display's order, in its groups (one unnamed group without grouping). */
export function arrangeProjects(
  projects: LinearProject[],
  display: ProjectDisplay,
  ws: LinearWorkspace | undefined,
): { key: string; label: string; projects: LinearProject[] }[] {
  const byName = (a: LinearProject, b: LinearProject) => a.name.localeCompare(b.name);
  const order: Record<ProjectOrdering, (a: LinearProject, b: LinearProject) => number> = {
    status: (a, b) => statusRank(a.status) - statusRank(b.status) || byName(a, b),
    name: byName,
    target: (a, b) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") || byName(a, b),
    progress: (a, b) => b.progress - a.progress || byName(a, b),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
  };
  const sorted = [...projects].sort(order[display.ordering]);
  if (display.grouping === "none") return [{ key: "all", label: "Projects", projects: sorted }];
  const groupOf = (p: LinearProject): [string, string, number] => {
    if (display.grouping === "status") return [p.status || "none", p.status || "No status", statusRank(p.status)];
    if (display.grouping === "health") {
      const at = p.health ? PROJECT_HEALTHS.indexOf(p.health) : PROJECT_HEALTHS.length;
      return [p.health ?? "none", p.health ? HEALTH_LABEL[p.health] : "No health", at];
    }
    const lead = ws?.users.find((u) => u.id === p.leadId);
    return [lead?.id ?? "none", lead?.name ?? "No lead", lead ? 0 : 1];
  };
  const groups = new Map<string, { key: string; label: string; rank: number; projects: LinearProject[] }>();
  for (const p of sorted) {
    const [key, label, rank] = groupOf(p);
    const group = groups.get(key) ?? { key, label, rank, projects: [] };
    group.projects.push(p);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
}

/** A project list's display and filters as kept for a place (localStorage), else `fallback` and none. */
function readProjectView(key: string, fallback: ProjectDisplay): { display: ProjectDisplay; filters: ProjectFilters } {
  const raw = readStore<Record<string, unknown> | null>(`linear:projectDisplay:${key}`, null);
  const pick = <T extends string>(v: unknown, allowed: T[], or: T) => (allowed.includes(v as T) ? (v as T) : or);
  const display = raw
    ? {
        grouping: pick(raw.grouping, PROJECT_GROUPINGS, fallback.grouping),
        ordering: pick(raw.ordering, PROJECT_ORDERINGS, fallback.ordering),
        completed: pick(raw.completed, ["all", "none"], fallback.completed),
      }
    : fallback;
  const kept = readStore<Record<string, unknown> | null>(`linear:projectFilters:${key}`, null) ?? {};
  const filters: ProjectFilters = {};
  for (const field of PROJECT_FILTER_FIELDS) {
    const values = kept[field];
    if (Array.isArray(values) && values.length && values.every((v) => typeof v === "string")) filters[field] = values.slice(0, 100);
  }
  return { display, filters };
}
/** Forgets a place's own display and filters (a view now has them). */
export function clearProjectView(key: string): void {
  removeStore(`linear:projectDisplay:${key}`);
  removeStore(`linear:projectFilters:${key}`);
}

/** What ⌘K and the view dialog need of a project list: its filters and display as shown, and whether they differ from the place's own. */
export type ProjectListState = { key: string; filters: ProjectFilters; display: ProjectDisplay; changed: boolean };

/** Display: grouping, ordering and whether finished projects show; Reset puts back the place's own (a view's, as set in Linear). */
function ProjectDisplayButton({
  display,
  onDisplay,
  fallback,
}: {
  display: ProjectDisplay;
  onDisplay: (next: ProjectDisplay) => void;
  fallback: ProjectDisplay;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [open, close]);
  const place = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("select")?.focus({ preventScroll: true });
  }, []);
  const changed = JSON.stringify(display) !== JSON.stringify(fallback);
  return (
    <span className="menu-anchor" ref={anchor}>
      <button
        ref={button}
        className="linear-tool"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip="Display options"
        onClick={(e) => {
          e.currentTarget.focus({ preventScroll: true });
          setOpen(!open);
        }}
      >
        <SlidersHorizontal size={13} aria-hidden="true" />
        Display
      </button>
      {open && (
        <div
          ref={place}
          role="dialog"
          aria-label="Display options"
          className="popover-menu right linear-display-menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
              button.current?.focus({ preventScroll: true });
            } else if (e.key !== "Tab") e.stopPropagation();
          }}
        >
          <div className="linear-display-row">
            <label htmlFor={`${id}-grouping`}>Grouping</label>
            <select
              id={`${id}-grouping`}
              value={display.grouping}
              onChange={(e) => onDisplay({ ...display, grouping: e.target.value as ProjectGrouping })}
            >
              {PROJECT_GROUPINGS.map((g) => (
                <option key={g} value={g}>
                  {GROUPING_LABEL[g]}
                </option>
              ))}
            </select>
          </div>
          <label className="linear-display-row">
            <span>Ordering</span>
            <select value={display.ordering} onChange={(e) => onDisplay({ ...display, ordering: e.target.value as ProjectOrdering })}>
              {PROJECT_ORDERINGS.map((o) => (
                <option key={o} value={o}>
                  {ORDERING_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          <label className="linear-display-row">
            <span>Completed projects</span>
            <select
              value={display.completed}
              onChange={(e) => onDisplay({ ...display, completed: e.target.value as ProjectDisplay["completed"] })}
            >
              <option value="all">All</option>
              <option value="none">None</option>
            </select>
          </label>
          {changed && (
            <button className="link-btn linear-display-reset" onClick={() => onDisplay(fallback)}>
              Reset to default
            </button>
          )}
        </div>
      )}
    </span>
  );
}

/**
 * A list of projects: the workspace's (current ones, and those finished in
 * the last 30 days), or a project view's (`projects`, as Linear's filter lets
 * them through); one opens its issues. Filter (status, health, lead, team) and
 * Display (grouping, ordering, finished projects) are kept per place
 * (`viewKey`); `defaultDisplay` is the place's own (a view's). Save as view
 * shows beside the filters once they or the display differ from it.
 */
export function ProjectList({
  onProject,
  title = "Projects",
  projects: given,
  loading = false,
  viewKey = "projects",
  defaultDisplay = DEFAULT_PROJECT_DISPLAY,
  actions,
  children,
  saveView,
  onListState,
  control,
}: {
  onProject: (projectId: string) => void;
  title?: ReactNode;
  /** A project view's projects; the workspace's by default. */
  projects?: LinearProject[];
  loading?: boolean;
  viewKey?: string;
  defaultDisplay?: ProjectDisplay;
  actions?: ReactNode;
  children?: ReactNode;
  saveView?: SaveViewAction;
  onListState?: (state: ProjectListState) => void;
  /** Set to the Filter button's opener, for F and ⌘K. */
  control?: React.MutableRefObject<FilterControl | null>;
}) {
  const ws = useLinear((d) => d.workspace);
  const all = given ?? ws?.projects;
  const fallback = useMemo(() => ({ ...DEFAULT_PROJECT_DISPLAY, ...defaultDisplay }), [defaultDisplay]);
  const [view, setView] = useState(() => readProjectView(viewKey, fallback));
  const [viewOf, setViewOf] = useState({ viewKey, fallback });
  if (viewOf.viewKey !== viewKey || viewOf.fallback !== fallback) {
    setViewOf({ viewKey, fallback });
    setView(readProjectView(viewKey, fallback));
  }
  const { display, filters } = view;
  const setDisplay = (next: ProjectDisplay) => {
    setView((v) => ({ ...v, display: next }));
    writeStore(`linear:projectDisplay:${viewKey}`, next);
  };
  const setFilters = (next: ProjectFilters) => {
    setView((v) => ({ ...v, filters: next }));
    writeStore(`linear:projectFilters:${viewKey}`, next);
  };
  const spec = useMemo(() => projectFilterSpec(ws, all ?? []), [ws, all]);
  const shown = useMemo(() => filterProjects(all ?? [], filters, display), [all, filters, display]);
  const groups = useMemo(() => arrangeProjects(shown, display, ws), [shown, display, ws]);
  const changed =
    PROJECT_FILTER_FIELDS.some((f) => filters[f]?.length) || JSON.stringify(display) !== JSON.stringify(fallback);
  useEffect(() => onListState?.({ key: viewKey, filters, display, changed }), [viewKey, filters, display, changed, onListState]);
  const row = (p: LinearProject) => {
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
  };
  return (
    <div className="linear-list linear-projects">
      <ScreenHead title={title} count={all && !loading ? shown.length : undefined}>
        {actions}
        <span className="linear-tools">
          <FilterButton filters={filters} onFilters={setFilters} spec={spec} control={control} />
          <ProjectDisplayButton display={display} onDisplay={setDisplay} fallback={fallback} />
        </span>
      </ScreenHead>
      {children}
      <FilterChips
        filters={filters}
        onFilters={setFilters}
        spec={spec}
        extra={saveView && changed ? <SaveViewButton action={saveView} /> : undefined}
      />
      <div className="linear-table" role="list" aria-label="Projects">
        {(!all || loading) && <p className="linear-note">Loading projects…</p>}
        {all && !loading && !all.length && <p className="linear-note">No projects.</p>}
        {all && !loading && all.length > 0 && !shown.length && <p className="linear-note">No project matches these filters.</p>}
        {shown.length > 0 && (
          <div className="linear-table-head" aria-hidden="true">
            <span>Name</span>
            <span>Status</span>
            <span>Health</span>
            <span>Lead</span>
            <span>Target</span>
            <span>Progress</span>
          </div>
        )}
        {display.grouping === "none"
          ? shown.length > 0 && groups[0].projects.map(row)
          : groups.map((g) => (
              <div key={g.key} role="group" aria-label={g.label} className="linear-project-group" data-group={g.key}>
                <h3 aria-hidden="true">
                  {g.label}
                  <span className="linear-count">{g.projects.length}</span>
                </h3>
                {g.projects.map(row)}
              </div>
            ))}
      </div>
    </div>
  );
}
