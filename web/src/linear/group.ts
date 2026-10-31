import type { LinearIssue, LinearState, LinearUser, LinearWorkspace } from "./types";

/** Linear's workflow types, in the order the lists show them. */
const TYPE_ORDER: LinearState["type"][] = ["started", "unstarted", "triage", "backlog", "completed", "canceled"];

const UNKNOWN_STATE: LinearState = { id: "", name: "No status", type: "backlog", color: "#95a2b3", position: 0, teamId: "" };

/** The issues in groups by state (started first, done and canceled last), each by priority (urgent first, none last), then most recently updated. */
export function groupIssues(issues: LinearIssue[], ws: LinearWorkspace | undefined) {
  const states = new Map(ws?.states.map((s) => [s.id, s]));
  const stateOf = (i: LinearIssue) => states.get(i.stateId) ?? UNKNOWN_STATE;
  // A state name's place in the workflow: the least position any team gives it, so teams' same-named states group together.
  const place = new Map<string, number>();
  for (const s of ws?.states ?? []) place.set(s.name, Math.min(place.get(s.name) ?? Infinity, s.position));
  const rank = (s: LinearState) => {
    const at = TYPE_ORDER.indexOf(s.type);
    return at < 0 ? TYPE_ORDER.length : at;
  };
  const sorted = [...issues].sort((a, b) => {
    const sa = stateOf(a);
    const sb = stateOf(b);
    return (
      rank(sa) - rank(sb) ||
      (place.get(sa.name) ?? 0) - (place.get(sb.name) ?? 0) ||
      sa.name.localeCompare(sb.name) ||
      (a.priority || 5) - (b.priority || 5) ||
      b.updatedAt.localeCompare(a.updatedAt)
    );
  });
  const groups: { state: LinearState; issues: LinearIssue[] }[] = [];
  for (const issue of sorted) {
    const state = stateOf(issue);
    const last = groups[groups.length - 1];
    // Teams each have their own states: one group per state name.
    if (last?.state.name === state.name) last.issues.push(issue);
    else groups.push({ state, issues: [issue] });
  }
  return groups;
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
