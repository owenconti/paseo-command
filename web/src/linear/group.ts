import { cycleName, PRIORITY_LABEL } from "./names";
import { DEFAULT_DISPLAY, type Display, type Grouping, type Ordering } from "./display";
import type { LinearCycle, LinearIssue, LinearState, LinearUser, LinearWorkspace } from "./types";

/** Linear's workflow types, in the order the lists show them. */
const TYPE_ORDER: LinearState["type"][] = ["started", "unstarted", "triage", "backlog", "completed", "canceled"];

const UNKNOWN_STATE: LinearState = { id: "", name: "No status", type: "backlog", color: "#95a2b3", position: 0, teamId: "" };

/** A group of issues as a list (or a board's column) shows it. */
export type IssueGroup = {
  key: string;
  label: string;
  /** What its header shows before the label. */
  mark:
    | { kind: "state"; state: LinearState }
    | { kind: "user"; user?: LinearUser }
    | { kind: "priority"; priority: LinearIssue["priority"] }
    | { kind: "project"; color?: string }
    | { kind: "cycle"; current: boolean }
    | { kind: "none" };
  /** What an issue dropped here takes, for the grouping's property: a state's name, an id or priority; null clears it. */
  value: string | number | null;
  issues: LinearIssue[];
};

/** Urgent first, none last; then the most recently updated. */
const byPriority = (a: LinearIssue, b: LinearIssue) =>
  (a.priority || 5) - (b.priority || 5) || b.updatedAt.localeCompare(a.updatedAt);

/** How an ordering sorts issues; `rank` is the order Linear returned them in (a search's relevance). */
function comparator(ordering: Ordering, rank?: Map<string, number>): (a: LinearIssue, b: LinearIssue) => number {
  const newest = (a: LinearIssue, b: LinearIssue) => b.updatedAt.localeCompare(a.updatedAt);
  switch (ordering) {
    case "priority":
      return byPriority;
    case "updated":
      return newest;
    case "created":
      return (a, b) => b.createdAt.localeCompare(a.createdAt) || newest(a, b);
    case "manual":
      return (a, b) => a.sortOrder - b.sortOrder || newest(a, b);
    case "due":
      return (a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || byPriority(a, b);
    case "title":
      return (a, b) => a.title.localeCompare(b.title) || newest(a, b);
    case "relevance":
      return (a, b) => (rank?.get(a.id) ?? Infinity) - (rank?.get(b.id) ?? Infinity) || newest(a, b);
  }
}

type Keyed = { group: Omit<IssueGroup, "issues">; order: (string | number)[] };

/** Each issue's group for a grouping, with the groups' order. */
function grouper(
  grouping: Grouping,
  ws: LinearWorkspace | undefined,
  cycles: LinearCycle[],
): { of: (issue: LinearIssue) => Keyed; ofState?: (state: LinearState) => Keyed } {
  switch (grouping) {
    case "status": {
      const states = new Map(ws?.states.map((s) => [s.id, s]));
      // A state name's place in the workflow: the least position any team gives it, so teams' same-named states group together.
      const place = new Map<string, number>();
      for (const s of ws?.states ?? []) place.set(s.name, Math.min(place.get(s.name) ?? Infinity, s.position));
      const rank = (s: LinearState) => {
        const at = TYPE_ORDER.indexOf(s.type);
        return at < 0 ? TYPE_ORDER.length : at;
      };
      const ofState = (state: LinearState): Keyed => ({
        group: { key: `state:${state.name}`, label: state.name, mark: { kind: "state", state }, value: state.name },
        order: [rank(state), place.get(state.name) ?? 0, state.name],
      });
      return { of: (i) => ofState(states.get(i.stateId) ?? UNKNOWN_STATE), ofState };
    }
    case "assignee": {
      const users = new Map(ws?.users.map((u) => [u.id, u]));
      return {
        of: (i) => {
          const user = i.assigneeId ? users.get(i.assigneeId) : undefined;
          if (!i.assigneeId)
            return { group: { key: "user:none", label: "No assignee", mark: { kind: "user" }, value: null }, order: [2, ""] };
          const label = user?.name ?? "Someone else";
          return {
            group: { key: `user:${i.assigneeId}`, label, mark: { kind: "user", user }, value: i.assigneeId },
            order: [i.assigneeId === ws?.viewerId ? 0 : 1, label.toLowerCase()],
          };
        },
      };
    }
    case "priority":
      return {
        of: (i) => ({
          group: {
            key: `priority:${i.priority}`,
            label: PRIORITY_LABEL[i.priority],
            mark: { kind: "priority", priority: i.priority },
            value: i.priority,
          },
          order: [i.priority || 5],
        }),
      };
    case "project": {
      const projects = new Map(ws?.projects.map((p) => [p.id, p]));
      return {
        of: (i) => {
          const project = i.projectId ? projects.get(i.projectId) : undefined;
          if (!i.projectId)
            return { group: { key: "project:none", label: "No project", mark: { kind: "project" }, value: null }, order: [1, ""] };
          const label = project?.name ?? "Another project";
          return {
            group: { key: `project:${i.projectId}`, label, mark: { kind: "project", color: project?.color }, value: i.projectId },
            order: [0, label.toLowerCase()],
          };
        },
      };
    }
    case "cycle": {
      const known = new Map([...(ws?.cycles ?? []), ...cycles].map((c) => [c.id, c]));
      return {
        of: (i) => {
          const cycle = i.cycleId ? known.get(i.cycleId) : undefined;
          if (!i.cycleId)
            return {
              group: { key: "cycle:none", label: "No cycle", mark: { kind: "cycle", current: false }, value: null },
              order: [3, 0],
            };
          const label = cycle ? cycleName(cycle) : "Another cycle";
          return {
            group: { key: `cycle:${i.cycleId}`, label, mark: { kind: "cycle", current: !!cycle?.isActive }, value: i.cycleId },
            order: [cycle?.isActive ? 0 : cycle?.isNext ? 1 : 2, -(cycle?.number ?? 0)],
          };
        },
      };
    }
    case "none":
      return {
        of: () => ({ group: { key: "all", label: "Issues", mark: { kind: "none" }, value: null }, order: [0] }),
      };
  }
}

const compareOrder = (a: (string | number)[], b: (string | number)[]) => {
  for (let n = 0; n < Math.max(a.length, b.length); n++) {
    const x = a[n];
    const y = b[n];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x - y;
    return String(x ?? "").localeCompare(String(y ?? ""));
  }
  return 0;
};

/**
 * The issues in groups as the display asks: by status (started first, done
 * and canceled last, one group per state name across teams), assignee (you
 * first, nobody last), priority (urgent first, none last), project or cycle
 * (the current one first), or one group; each sorted by the display's
 * ordering. `states` adds empty groups for those states (a board's columns),
 * `cycles` names cycles the workspace doesn't list, `rank` is a search's order.
 */
export function arrangeIssues(
  issues: LinearIssue[],
  ws: LinearWorkspace | undefined,
  display: Pick<Display, "grouping" | "ordering"> = DEFAULT_DISPLAY,
  opts: { states?: LinearState[]; cycles?: LinearCycle[]; rank?: Map<string, number> } = {},
): IssueGroup[] {
  const { of, ofState } = grouper(display.grouping, ws, opts.cycles ?? []);
  const groups = new Map<string, { keyed: Keyed; issues: LinearIssue[] }>();
  if (ofState)
    for (const state of opts.states ?? []) {
      const keyed = ofState(state);
      if (!groups.has(keyed.group.key)) groups.set(keyed.group.key, { keyed, issues: [] });
    }
  for (const issue of issues) {
    const keyed = of(issue);
    const known = groups.get(keyed.group.key);
    if (known) known.issues.push(issue);
    else groups.set(keyed.group.key, { keyed, issues: [issue] });
  }
  const sort = comparator(display.ordering, opts.rank);
  return [...groups.values()]
    .sort((a, b) => compareOrder(a.keyed.order, b.keyed.order))
    .map(({ keyed, issues }) => ({ ...keyed.group, issues: issues.sort(sort) }));
}

/** Whether the issue matches what was typed in the list's search: its key, title, project, team, labels or assignee. */
export function issueMatches(issue: LinearIssue, query: string, ws: LinearWorkspace | undefined) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const team = ws?.teams.find((t) => t.id === issue.teamId);
  const assignee = ws?.users.find((u) => u.id === issue.assigneeId);
  const text = [
    issue.key,
    issue.title,
    ws?.projects.find((p) => p.id === issue.projectId)?.name,
    team?.key,
    team?.name,
    assignee?.name,
    assignee?.displayName,
    ...issue.labelIds.map((id) => ws?.labels.find((l) => l.id === id)?.name),
  ]
    .join(" ")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/** Up to two initials for a person ("Sam Rivera" → SR). */
export function initials(user: Pick<LinearUser, "name" | "displayName"> | undefined): string {
  const words = (user?.name || user?.displayName || "").trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * What dropping `issue` on a board's column changes: the issueUpdate input
 * and the store's patch; null when it changes nothing or can't (the issue's
 * team has no state of that name, the cycle is another team's).
 */
export function dropChange(
  issue: LinearIssue,
  group: Pick<IssueGroup, "value">,
  grouping: Grouping,
  ws: LinearWorkspace | undefined,
  cycles: LinearCycle[] = [],
): { input: Record<string, unknown>; patch: Partial<LinearIssue> } | null {
  const value = group.value;
  switch (grouping) {
    case "status": {
      const state = ws?.states.find((s) => s.teamId === issue.teamId && s.name === value);
      if (!state || state.id === issue.stateId) return null;
      return { input: { stateId: state.id }, patch: { stateId: state.id } };
    }
    case "assignee":
      if ((issue.assigneeId ?? null) === value) return null;
      return { input: { assigneeId: value }, patch: { assigneeId: (value as string | null) ?? undefined } };
    case "priority":
      if (typeof value !== "number" || issue.priority === value) return null;
      return { input: { priority: value }, patch: { priority: value as LinearIssue["priority"] } };
    case "project": {
      if ((issue.projectId ?? null) === value) return null;
      const next = ws?.projects.find((p) => p.id === value);
      // A milestone belongs to its project: moving the issue elsewhere clears it.
      const keep = !issue.milestoneId || next?.milestones.some((m) => m.id === issue.milestoneId);
      const projectId = (value as string | null) ?? undefined;
      return keep
        ? { input: { projectId: value }, patch: { projectId } }
        : { input: { projectId: value, projectMilestoneId: null }, patch: { projectId, milestoneId: undefined } };
    }
    case "cycle": {
      if ((issue.cycleId ?? null) === value) return null;
      if (value !== null) {
        const cycle = [...(ws?.cycles ?? []), ...cycles].find((c) => c.id === value);
        if (cycle?.teamId !== issue.teamId) return null;
      }
      return { input: { cycleId: value }, patch: { cycleId: (value as string | null) ?? undefined } };
    }
    case "none":
      return null;
  }
}
