import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "./api";

/** As `web/server/linear.ts` answers them. */
export type LinearState = { name: string; type: string; color: string };
export type LinearIssueRow = {
  key: string;
  title: string;
  url: string;
  state: LinearState;
  /** 0 none, 1 urgent, 2 high, 3 medium, 4 low. */
  priority: number;
  priorityLabel: string;
  team: string;
  project?: string;
  labels: { name: string; color: string }[];
  branchName?: string;
  updatedAt: string;
};
export type LinearIssueDetail = LinearIssueRow & {
  description: string;
  createdAt: string;
  dueDate?: string;
  estimate?: number;
  assignee?: string;
  creator?: string;
  parent?: { key: string; title: string };
  links: { title: string; url: string }[];
  comments: { author: string; body: string; createdAt: string }[];
};
type Unavailable = { available: false; reason: string };
type ListAnswer = Unavailable | { available: true; viewer: string; issues: LinearIssueRow[] };
type DetailAnswer = Unavailable | { available: true; issue: LinearIssueDetail | null };

/** An issue a new agent starts from (New agent's `DispatchTarget.issue`). */
export type IssueContext = {
  key: string;
  title: string;
  url: string;
  description?: string;
  branchName?: string;
};

/** Linear's workflow types, in the order the list shows them. */
const STATE_ORDER = ["started", "unstarted", "triage", "backlog"];

/** The issues in groups by state (started first), each by priority (urgent first, none last), then most recently updated. */
export function groupIssues(issues: LinearIssueRow[]) {
  const rank = (i: LinearIssueRow) => {
    const at = STATE_ORDER.indexOf(i.state.type);
    return at < 0 ? STATE_ORDER.length : at;
  };
  const sorted = [...issues].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.state.name.localeCompare(b.state.name) ||
      (a.priority || 5) - (b.priority || 5) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
  const groups: { state: LinearState; issues: LinearIssueRow[] }[] = [];
  for (const issue of sorted) {
    const last = groups[groups.length - 1];
    if (last?.state.name === issue.state.name) last.issues.push(issue);
    else groups.push({ state: issue.state, issues: [issue] });
  }
  return groups;
}

/** Whether the issue matches what was typed in the list's search: its key, title, project, team or labels. */
export function issueMatches(issue: LinearIssueRow, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = [issue.key, issue.title, issue.project, issue.team, ...issue.labels.map((l) => l.name)]
    .join(" ")
    .toLowerCase();
  return words.every((w) => text.includes(w));
}

/** How much of a description goes into a prompt. */
const DESCRIPTION_LIMIT = 8000;

/** The issue as a prompt names it: its key, title, link and description. */
export function issueBlock(issue: IssueContext) {
  const description = issue.description?.trim() ?? "";
  return [
    `Linear issue ${issue.key}: ${issue.title}`,
    issue.url,
    description &&
      `\n${description.length > DESCRIPTION_LIMIT ? `${description.slice(0, DESCRIPTION_LIMIT)}…` : description}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The first message New agent offers for an issue, to edit before sending. */
export const issuePrompt = (issue: IssueContext) =>
  `Work on this issue.\n\n${issueBlock(issue)}`;

/** The issue a detail view launches an agent for. */
export const issueContext = (issue: LinearIssueDetail): IssueContext => ({
  key: issue.key,
  title: issue.title,
  url: issue.url,
  description: issue.description,
  branchName: issue.branchName,
});

/** Your open assigned issues; `refresh` asks Linear again now. */
export function useAssignedIssues() {
  const [state, setState] = useState<{
    loading: boolean;
    answer?: ListAnswer;
    error?: string;
  }>({ loading: true });
  const load = useCallback((fresh: boolean) => {
    setState((s) => ({ ...s, loading: true }));
    api<ListAnswer>(`linear/issues${fresh ? "?fresh=1" : ""}`).then(
      (answer) => setState({ loading: false, answer }),
      (e) => setState((s) => ({ ...s, loading: false, error: errorMessage(e) })),
    );
  }, []);
  useEffect(() => {
    load(false);
    // Kept current while it shows, as Linear changes elsewhere.
    const timer = setInterval(() => load(false), 60000);
    return () => clearInterval(timer);
  }, [load]);
  return { ...state, refresh: () => load(true) };
}

/** One issue's details, asked for whenever `key` or `revision` changes. */
export function useIssueDetail(key: string | null, revision: number) {
  const [state, setState] = useState<{
    key: string;
    answer?: DetailAnswer;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!key) return;
    let live = true;
    api<DetailAnswer>(
      `linear/issues/${encodeURIComponent(key)}${revision ? "?fresh=1" : ""}`,
    ).then(
      (answer) => live && setState({ key, answer }),
      (e) => live && setState({ key, error: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [key, revision]);
  return key && state?.key === key ? state : null;
}
