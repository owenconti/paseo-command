import { readStore, writeStore } from "../api";
import type { LinearIssue, LinearWorkspace } from "./types";

/**
 * How a list of issues shows, as Linear's Display options: a list or a board,
 * grouped and ordered by a property, with or without what's finished. And
 * which issues it shows: Linear's filters, any of the chosen values of a
 * property, every property chosen. Both are kept per place (localStorage).
 */
export type Layout = "list" | "board";
export type Grouping = "status" | "assignee" | "priority" | "project" | "cycle" | "none";
export type Ordering = "priority" | "updated" | "created" | "manual" | "due" | "title" | "relevance";
export type Completed = "all" | "week" | "month" | "none";
export type Display = { layout: Layout; grouping: Grouping; ordering: Ordering; completed: Completed };

export const DEFAULT_DISPLAY: Display = { layout: "list", grouping: "status", ordering: "priority", completed: "all" };

export const LAYOUTS: Layout[] = ["list", "board"];
export const GROUPINGS: Grouping[] = ["status", "assignee", "priority", "project", "cycle", "none"];
export const ORDERINGS: Ordering[] = ["priority", "updated", "created", "manual", "due", "title", "relevance"];
export const COMPLETED: Completed[] = ["all", "month", "week", "none"];

export const GROUPING_LABEL: Record<Grouping, string> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  project: "Project",
  cycle: "Cycle",
  none: "No grouping",
};
export const ORDERING_LABEL: Record<Ordering, string> = {
  priority: "Priority",
  updated: "Last updated",
  created: "Last created",
  manual: "Manual",
  due: "Due date",
  title: "Title",
  relevance: "Relevance",
};
export const COMPLETED_LABEL: Record<Completed, string> = {
  all: "All",
  month: "Past month",
  week: "Past week",
  none: "None",
};

/** A remembered (or Linear's) display, with anything unknown taken from `fallback`. */
export function checkDisplay(raw: unknown, fallback: Display = DEFAULT_DISPLAY): Display {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = <T extends string>(value: unknown, allowed: T[], or: T) => (allowed.includes(value as T) ? (value as T) : or);
  return {
    layout: pick(r.layout, LAYOUTS, fallback.layout),
    grouping: pick(r.grouping, GROUPINGS, fallback.grouping),
    ordering: pick(r.ordering, ORDERINGS, fallback.ordering),
    completed: pick(r.completed, COMPLETED, fallback.completed),
  };
}

export type FilterField = "status" | "assignee" | "priority" | "labels" | "project" | "cycle";
export const FILTER_FIELDS: FilterField[] = ["status", "assignee", "priority", "labels", "project", "cycle"];
export const FILTER_LABEL: Record<FilterField, string> = {
  status: "Status",
  assignee: "Assignee",
  priority: "Priority",
  labels: "Labels",
  project: "Project",
  cycle: "Cycle",
};
/**
 * The chosen values of each filtered property: a status by name (teams each
 * have their own states), a person, project or cycle by id, or "none" for
 * the issues without one, a priority as "0"–"4", a label by id.
 */
export type Filters = Partial<Record<FilterField, string[]>>;

/** Remembered filters, keeping only known properties with values. */
export function checkFilters(raw: unknown): Filters {
  if (!raw || typeof raw !== "object") return {};
  const out: Filters = {};
  for (const field of FILTER_FIELDS) {
    const values = (raw as Record<string, unknown>)[field];
    if (!Array.isArray(values)) continue;
    const kept = values.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200).slice(0, 100);
    if (kept.length) out[field] = [...new Set(kept)];
  }
  return out;
}

export const hasFilters = (filters: Filters) => FILTER_FIELDS.some((f) => filters[f]?.length);

/** A place's display and filters as remembered, else `fallback` and none. */
export function readListView(key: string, fallback: Display = DEFAULT_DISPLAY): { display: Display; filters: Filters } {
  return {
    display: checkDisplay(readStore<unknown>(`linear:display:${key}`, null), fallback),
    filters: checkFilters(readStore<unknown>(`linear:filters:${key}`, null)),
  };
}
/** Whether a display was chosen here for the place (else it shows its default). */
export function hasOwnDisplay(key: string): boolean {
  return readStore<unknown>(`linear:display:${key}`, null) !== null;
}
export function writeDisplay(key: string, display: Display): void {
  writeStore(`linear:display:${key}`, display);
}
export function writeFilters(key: string, filters: Filters): void {
  writeStore(`linear:filters:${key}`, filters);
}

const DAY = 86_400_000;

/** The value an issue has for a filtered property, as `Filters` keeps them. */
export function filterValues(issue: LinearIssue, field: FilterField, ws: LinearWorkspace | undefined): string[] {
  switch (field) {
    case "status":
      return [ws?.states.find((s) => s.id === issue.stateId)?.name ?? ""];
    case "assignee":
      return [issue.assigneeId ?? "none"];
    case "priority":
      return [String(issue.priority)];
    case "labels":
      return issue.labelIds.length ? issue.labelIds : ["none"];
    case "project":
      return [issue.projectId ?? "none"];
    case "cycle":
      return [issue.cycleId ?? "none"];
  }
}

/**
 * The issues the filters and the completed option let through: for each
 * filtered property, any of its values; finished issues (done or canceled)
 * only as recent as `completed` allows.
 */
export function filterIssues(
  issues: LinearIssue[],
  filters: Filters,
  completed: Completed,
  ws: LinearWorkspace | undefined,
  now: number = Date.now(),
): LinearIssue[] {
  const types = new Map(ws?.states.map((s) => [s.id, s.type]));
  const since = completed === "week" ? now - 7 * DAY : completed === "month" ? now - 30 * DAY : undefined;
  return issues.filter((issue) => {
    const type = types.get(issue.stateId);
    if (type === "completed" || type === "canceled") {
      if (completed === "none") return false;
      if (since !== undefined) {
        const at = Date.parse(issue.completedAt ?? issue.canceledAt ?? issue.updatedAt);
        if (!(at >= since)) return false;
      }
    }
    return FILTER_FIELDS.every((field) => {
      const chosen = filters[field];
      return !chosen?.length || filterValues(issue, field, ws).some((v) => chosen.includes(v));
    });
  });
}
