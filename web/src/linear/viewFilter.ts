/**
 * Saved views' filters and display in the page's words, and in Linear's.
 * Shared by the server (which builds Linear's `IssueFilter` / `ProjectFilter`
 * and view preferences from the page's, and reads a view's back) and the page.
 * Only what the app can show and edit is translated; a view whose filter has
 * anything else is read as not editable here (it still opens: Linear filters it).
 */
import type { Completed, Display, Filters, Grouping, Layout, Ordering } from "./display";
import type { IssueScope, LinearState } from "./types";

type Raw = Record<string, unknown>;
const rec = (v: unknown): Raw | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null);
const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.length <= 200 && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 200)
    ? (v as string[])
    : null;

const STATE_TYPES: LinearState["type"][] = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];
const ISSUE_FIELDS = ["status", "assignee", "priority", "labels", "project", "cycle"] as const;

/** What the place a view was saved from lists, beside the chosen filters: a team (its tab's state types), you. */
export type ViewBase = {
  teamId?: string;
  stateTypes?: LinearState["type"][];
  /** Issues assigned to you, created by you, or that you're subscribed to. */
  me?: "assignee" | "creator" | "subscriber";
};
/**
 * An issue view's filter: the place's base and the chosen filters. Linear's
 * own views name statuses by id (`stateIds`, which the page turns into names
 * with `resolveIssueFilter`); the app names them, as `Filters` does.
 */
export type IssueViewFilter = { base: ViewBase; filters: Filters; stateIds?: string[] };

export type ProjectFilterField = "status" | "health" | "lead" | "team";
export const PROJECT_FILTER_FIELDS: ProjectFilterField[] = ["status", "health", "lead", "team"];
/** A project list's chosen filters: a status by name, a health ("onTrack"…), a lead ("none" for without) or team by id. */
export type ProjectFilters = Partial<Record<ProjectFilterField, string[]>>;
export const PROJECT_HEALTHS = ["onTrack", "atRisk", "offTrack"] as const;

export type ProjectGrouping = "none" | "status" | "health" | "lead";
export type ProjectOrdering = "status" | "name" | "target" | "progress" | "updated";
/** How a project list shows: grouped, ordered, with or without finished (completed, canceled) projects. */
export type ProjectDisplay = { grouping: ProjectGrouping; ordering: ProjectOrdering; completed: "all" | "none" };
export const PROJECT_GROUPINGS: ProjectGrouping[] = ["none", "status", "health", "lead"];
export const PROJECT_ORDERINGS: ProjectOrdering[] = ["status", "name", "target", "progress", "updated"];
export const DEFAULT_PROJECT_DISPLAY: ProjectDisplay = { grouping: "none", ordering: "status", completed: "all" };

/** The base of the place a scope lists, for a view saved from it; null where a view can't say it (a search). */
export function baseOfScope(scope: IssueScope): { base: ViewBase; filters: Filters } | null {
  if (scope === "assigned") return { base: { me: "assignee" }, filters: {} };
  if (scope === "created") return { base: { me: "creator" }, filters: {} };
  if (scope === "subscribed") return { base: { me: "subscriber" }, filters: {} };
  const project = /^project:(.+)$/.exec(scope)?.[1];
  if (project) return { base: {}, filters: { project: [project] } };
  const cycle = /^cycle:(.+)$/.exec(scope)?.[1];
  if (cycle) return { base: {}, filters: { cycle: [cycle] } };
  const team = /^team:([^:]+):(triage|active|backlog|all)$/.exec(scope);
  if (team) {
    const types = { triage: ["triage"], active: ["unstarted", "started"], backlog: ["backlog"], all: undefined }[team[2]] as
      | LinearState["type"][]
      | undefined;
    return { base: { teamId: team[1], ...(types ? { stateTypes: types } : {}) }, filters: {} };
  }
  return null;
}

/** Each filtered property's values, where both name it, only those in both (what a list showing both lets through). */
export function intersectFilters<F extends string>(
  a: Partial<Record<F, string[]>>,
  b: Partial<Record<F, string[]>>,
): Partial<Record<F, string[]>> {
  const out: Partial<Record<F, string[]>> = { ...a };
  for (const [field, values] of Object.entries(b) as [F, string[]][]) {
    if (!values?.length) continue;
    const had = out[field];
    const both = had?.length ? had.filter((v) => values.includes(v)) : values;
    out[field] = both.length ? both : values;
  }
  return out;
}

/** "any of these ids, or none": Linear's condition on a nullable reference. */
function refCondition(field: string, values: string[], nested: (ids: string[]) => Raw = (ids) => ({ id: { in: ids } })): Raw {
  const ids = values.filter((v) => v !== "none");
  const none = values.includes("none");
  const some = ids.length ? { [field]: nested(ids) } : null;
  const empty = { [field]: field === "labels" ? { length: { eq: 0 } } : { null: true } };
  if (some && none) return { or: [some, empty] };
  return some ?? empty;
}

const joined = (parts: Raw[]): Raw => (parts.length === 0 ? {} : parts.length === 1 ? parts[0] : { and: parts });

/** Linear's IssueFilter for a view's filter: every part must hold. */
export function toIssueFilter({ base, filters }: IssueViewFilter): Raw {
  const parts: Raw[] = [];
  if (base.teamId) parts.push({ team: { id: { eq: base.teamId } } });
  if (base.stateTypes?.length) parts.push({ state: { type: { in: base.stateTypes } } });
  if (base.me === "assignee") parts.push({ assignee: { isMe: { eq: true } } });
  if (base.me === "creator") parts.push({ creator: { isMe: { eq: true } } });
  if (base.me === "subscriber") parts.push({ subscribers: { some: { isMe: { eq: true } } } });
  for (const field of ISSUE_FIELDS) {
    const values = filters[field];
    if (!values?.length) continue;
    if (field === "status") parts.push({ state: { name: { in: values } } });
    else if (field === "priority") parts.push({ priority: { in: values.map(Number) } });
    else if (field === "labels") parts.push(refCondition("labels", values, (ids) => ({ some: { id: { in: ids } } })));
    else parts.push(refCondition(field, values));
  }
  return joined(parts);
}

/** A filter's conditions, one each: an `and` list's, else each key of the object as its own. */
function conditionsOf(raw: unknown): Raw[] | null {
  const r = rec(raw);
  if (!r) return null;
  const out: Raw[] = [];
  for (const [key, value] of Object.entries(r)) {
    if (key === "and") {
      if (!Array.isArray(value)) return null;
      for (const part of value) {
        const inner = conditionsOf(part);
        if (!inner) return null;
        out.push(...inner);
      }
    } else out.push({ [key]: value });
  }
  return out;
}

/** The ids an `{ id: { eq | in } }` names; null for anything else. */
function idsOf(v: unknown): string[] | null {
  const r = rec(v);
  if (!r || Object.keys(r).length !== 1) return null;
  const id = rec(r.id);
  if (!id || Object.keys(id).length !== 1) return null;
  if (typeof id.eq === "string" && id.eq) return [id.eq];
  return strings(id.in);
}
/** Whether `v` is `{ null: true }` (or a label list's `{ length: { eq: 0 } }`). */
const isEmptyRef = (v: unknown) => {
  const r = rec(v);
  if (!r || Object.keys(r).length !== 1) return false;
  if (r.null === true) return true;
  const length = rec(r.length);
  return !!length && Object.keys(length).length === 1 && length.eq === 0;
};
/** `{ eq: x }` or `{ in: [...] }` of strings (or numbers, with `numbers`). */
function valuesOf(v: unknown, numbers = false): string[] | null {
  const r = rec(v);
  if (!r || Object.keys(r).length !== 1) return null;
  const ok = (x: unknown) => (numbers ? typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 4 : typeof x === "string" && !!x && x.length <= 200);
  if ("eq" in r) return ok(r.eq) ? [String(r.eq)] : null;
  if (Array.isArray(r.in) && r.in.length > 0 && r.in.length <= 200 && r.in.every(ok)) return r.in.map(String);
  return null;
}
const isMe = (v: unknown) => {
  const r = rec(v);
  const me = rec(r?.isMe);
  return !!r && Object.keys(r).length === 1 && !!me && Object.keys(me).length === 1 && me.eq === true;
};

/**
 * A view's IssueFilter in the page's words, or null when it has any
 * condition the app can't show (another comparator, a property it doesn't
 * filter by, a property named twice).
 */
export function fromIssueFilter(raw: unknown): IssueViewFilter | null {
  const parts = conditionsOf(raw ?? {});
  if (!parts) return null;
  const base: ViewBase = {};
  const filters: Filters = {};
  let stateIds: string[] | undefined;
  const once = (field: keyof Filters, values: string[]) => {
    if (filters[field] || !values.length) return false;
    filters[field] = [...new Set(values)];
    return true;
  };
  /** A reference's values: ids, "none", or either (an `or` of the two). */
  const refValues = (field: string, cond: Raw, nested: (v: unknown) => string[] | null = idsOf): string[] | null => {
    const one = (v: unknown): string[] | null => (isEmptyRef(v) ? ["none"] : nested(v));
    if (Object.keys(cond).length !== 1) return null;
    if (cond.or) {
      const alts = Array.isArray(cond.or) ? cond.or.map(rec) : [];
      if (alts.length !== 2 || alts.some((a) => !a || Object.keys(a).length !== 1 || !(field in a))) return null;
      const got = alts.map((a) => one(a![field]));
      return got.every(Boolean) ? got.flat() as string[] : null;
    }
    return field in cond ? one(cond[field]) : null;
  };
  for (const cond of parts) {
    const [key] = Object.keys(cond);
    const value = cond[key];
    const v = rec(value);
    switch (key) {
      case "team": {
        const ids = idsOf(value);
        if (!ids || ids.length !== 1 || base.teamId) return null;
        base.teamId = ids[0];
        break;
      }
      case "state": {
        if (!v || Object.keys(v).length !== 1) return null;
        if (v.type) {
          const types = valuesOf(v.type);
          if (!types || base.stateTypes || !types.every((t) => (STATE_TYPES as string[]).includes(t))) return null;
          base.stateTypes = types as LinearState["type"][];
        } else if (v.name) {
          const names = valuesOf(v.name);
          if (!names || !once("status", names)) return null;
        } else {
          const ids = idsOf(value);
          if (!ids || stateIds) return null;
          stateIds = ids;
        }
        break;
      }
      case "creator":
        if (!isMe(value) || base.me) return null;
        base.me = "creator";
        break;
      case "assignee":
        if (isMe(value)) {
          if (base.me) return null;
          base.me = "assignee";
          break;
        }
        if (!once("assignee", refValues(key, cond) ?? [])) return null;
        break;
      case "project":
      case "cycle":
        if (!once(key, refValues(key, cond) ?? [])) return null;
        break;
      case "subscribers": {
        const some = rec(v?.some);
        if (!v || Object.keys(v).length !== 1 || !isMe(some) || base.me) return null;
        base.me = "subscriber";
        break;
      }
      case "priority": {
        if (!once("priority", valuesOf(value, true) ?? [])) return null;
        break;
      }
      case "labels": {
        const values = refValues("labels", cond, (x) => {
          const r = rec(x);
          if (!r || Object.keys(r).length !== 1) return null;
          return r.some ? idsOf(r.some) : idsOf(r);
        });
        if (!values || !once("labels", values)) return null;
        break;
      }
      case "or": {
        // Either of two alternatives of one property: an id or none.
        const alts = Array.isArray(value) ? value.map(rec) : [];
        const field = alts[0] && Object.keys(alts[0]).length === 1 ? Object.keys(alts[0])[0] : "";
        if (!["assignee", "project", "cycle", "labels"].includes(field)) return null;
        const nested = field === "labels" ? (x: unknown) => { const r = rec(x); return r?.some ? idsOf(r.some) : idsOf(r); } : idsOf;
        const values = refValues(field, cond, nested);
        if (!values || !once(field as keyof Filters, values)) return null;
        break;
      }
      default:
        return null;
    }
  }
  return { base, filters, ...(stateIds ? { stateIds } : {}) };
}

/**
 * A view's filter with Linear's status ids as the page's names (statuses of
 * one name across teams count as one); null when an id isn't a status the
 * workspace has.
 */
export function resolveIssueFilter(filter: IssueViewFilter, states: LinearState[]): IssueViewFilter | null {
  if (!filter.stateIds) return filter;
  const names = filter.stateIds.map((id) => states.find((s) => s.id === id)?.name);
  if (names.some((n) => n === undefined) || filter.filters.status) return null;
  const { stateIds: _, ...rest } = filter;
  return { ...rest, filters: { ...rest.filters, status: [...new Set(names as string[])] } };
}

/** Linear's ProjectFilter for a project list's filters. */
export function toProjectFilter(filters: ProjectFilters): Raw {
  const parts: Raw[] = [];
  for (const field of PROJECT_FILTER_FIELDS) {
    const values = filters[field];
    if (!values?.length) continue;
    if (field === "status") parts.push({ status: { name: { in: values } } });
    else if (field === "health") parts.push({ health: { in: values } });
    else if (field === "lead") parts.push(refCondition("lead", values));
    else parts.push({ accessibleTeams: { some: { id: { in: values } } } });
  }
  return joined(parts);
}

/** A view's ProjectFilter in the page's words, or null when it has a condition the app can't show. */
export function fromProjectFilter(raw: unknown): ProjectFilters | null {
  const parts = conditionsOf(raw ?? {});
  if (!parts) return null;
  const out: ProjectFilters = {};
  const once = (field: ProjectFilterField, values: string[] | null) => {
    if (!values || out[field]) return false;
    out[field] = [...new Set(values)];
    return true;
  };
  for (const cond of parts) {
    const [key] = Object.keys(cond);
    const value = rec(cond[key]);
    let ok = false;
    if (key === "status") ok = !!value && Object.keys(value).length === 1 && once("status", valuesOf(value.name));
    else if (key === "health") {
      const values = valuesOf(value);
      ok = !!values && values.every((h) => (PROJECT_HEALTHS as readonly string[]).includes(h)) && once("health", values);
    } else if (key === "lead") ok = once("lead", isEmptyRef(value) ? ["none"] : idsOf(value));
    else if (key === "or") {
      // A lead, or none.
      const alts = Array.isArray(cond.or) ? cond.or.map(rec) : [];
      const each = alts.map((a) =>
        a && Object.keys(a).length === 1 && "lead" in a ? (isEmptyRef(a.lead) ? ["none"] : idsOf(a.lead)) : null,
      );
      ok = alts.length === 2 && each.every(Boolean) && once("lead", each.flat() as string[]);
    } else if (key === "accessibleTeams") ok = !!value && Object.keys(value).length === 1 && once("team", idsOf(value.some));
    if (!ok) return null;
  }
  return out;
}

/** Linear's view preference words for the page's display, and back (anything unknown is left to the default). */
const ISSUE_GROUPING: Record<Grouping, string> = {
  status: "workflowState",
  assignee: "assignee",
  priority: "priority",
  project: "project",
  cycle: "cycle",
  none: "noGrouping",
};
const ISSUE_ORDERING: Partial<Record<Ordering, string>> = {
  priority: "priority",
  updated: "updatedAt",
  created: "createdAt",
  manual: "manual",
  due: "dueDate",
  title: "title",
};
const ISSUE_COMPLETED: Record<Completed, string> = { all: "all", month: "pastMonth", week: "pastWeek", none: "none" };

/** An issue view's display as Linear's view preferences. */
export function issuePreferences(display: Display): Record<string, string> {
  return {
    layout: display.layout satisfies Layout,
    issueGrouping: ISSUE_GROUPING[display.grouping],
    issueSubGrouping: ISSUE_GROUPING[display.subGrouping],
    ...(ISSUE_ORDERING[display.ordering] ? { viewOrdering: ISSUE_ORDERING[display.ordering]! } : {}),
    showCompletedIssues: ISSUE_COMPLETED[display.completed],
  };
}

const PROJECT_GROUPING_WORD: Record<ProjectGrouping, string> = { none: "none", status: "status", health: "health", lead: "lead" };
const PROJECT_ORDERING_WORD: Record<ProjectOrdering, string> = {
  status: "status",
  name: "name",
  target: "targetDate",
  progress: "progress",
  updated: "updatedAt",
};

/** A project view's display as Linear's view preferences. */
export function projectPreferences(display: ProjectDisplay): Record<string, string> {
  return {
    projectGrouping: PROJECT_GROUPING_WORD[display.grouping],
    projectViewOrdering: PROJECT_ORDERING_WORD[display.ordering],
    showCompletedProjects: display.completed,
  };
}

const lookup = <T extends string>(words: Record<string, string>, value: unknown, extra: Record<string, T> = {}): T | undefined => {
  if (typeof value !== "string") return undefined;
  if (Object.hasOwn(extra, value)) return extra[value];
  const found = Object.entries(words).find(([, word]) => word === value);
  return found?.[0] as T | undefined;
};

/** A project view's display from Linear's view preferences, as far as the app knows its words. */
export function projectDisplayOf(prefs: Raw): Partial<ProjectDisplay> {
  const out: Partial<ProjectDisplay> = {};
  const grouping = lookup<ProjectGrouping>(PROJECT_GROUPING_WORD, prefs.projectGrouping, { noGrouping: "none", projectStatus: "status" });
  const ordering = lookup<ProjectOrdering>(PROJECT_ORDERING_WORD, prefs.projectViewOrdering, { targetdate: "target" });
  if (grouping) out.grouping = grouping;
  if (ordering) out.ordering = ordering;
  if (prefs.showCompletedProjects === "none") out.completed = "none";
  else if (typeof prefs.showCompletedProjects === "string") out.completed = "all";
  return out;
}
