import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { plainText } from "../ui";
import { Dot, Person, Priority, ScreenHead } from "./bits";
import { groupIssues, issueMatches } from "./group";
import { scopeIssues, useLinear } from "./store";
import type { IssueScope, LinearIssue, LinearWorkspace } from "./types";

/** One issue as a list shows it: priority, key, title, labels' dots, project and assignee. */
export function IssueRow({
  issue,
  ws,
  open,
  focusable,
  onOpen,
  showState = false,
}: {
  issue: LinearIssue;
  ws: LinearWorkspace | undefined;
  open: boolean;
  focusable: boolean;
  onOpen: (key: string) => void;
  showState?: boolean;
}) {
  const labels = issue.labelIds.map((id) => ws?.labels.find((l) => l.id === id)).filter((l) => l !== undefined);
  const project = ws?.projects.find((p) => p.id === issue.projectId);
  const state = ws?.states.find((s) => s.id === issue.stateId);
  return (
    <button
      data-key={issue.key}
      role="option"
      aria-selected={open}
      tabIndex={focusable ? 0 : -1}
      className={`linear-row${open ? " selected" : ""}`}
      onClick={() => onOpen(issue.key)}
    >
      <Priority priority={issue.priority} />
      <span className="linear-key">{issue.key}</span>
      {showState && state && (
        <span data-tip={state.name} aria-label={state.name} className="linear-row-state">
          <Dot color={state.color} />
        </span>
      )}
      <span className="linear-title">{issue.title}</span>
      {labels.length > 0 && (
        <span className="linear-row-labels" aria-label={labels.map((l) => l.name).join(", ")}>
          {labels.map((l) => (
            <span key={l.id} data-tip={l.name}>
              <Dot color={l.color} />
            </span>
          ))}
        </span>
      )}
      {project && <span className="linear-row-project">{project.name}</span>}
      <span className="linear-row-person">
        <Person user={ws?.users.find((u) => u.id === issue.assigneeId)} />
      </span>
    </button>
  );
}

/**
 * A place's issues, grouped by state (started first, done and canceled last),
 * from the store: an edit or a sync moves an issue between lists at once.
 * ↑/↓ move between rows; where the issue opens beside the list (`opensBeside`)
 * they open it too, else Enter does.
 */
export function IssueList({
  title,
  scope,
  openKey,
  onOpen,
  opensBeside,
  loading,
  error,
  actions,
  children,
}: {
  title: ReactNode;
  scope: IssueScope;
  openKey?: string;
  onOpen: (key: string) => void;
  opensBeside: boolean;
  loading: boolean;
  error?: string;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  /** Shown between the title and the list (a project's summary). */
  children?: ReactNode;
}) {
  const data = useLinear((d) => d);
  const ws = data.workspace;
  const issues = useMemo(() => scopeIssues(data, scope), [data, scope]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => issues.filter((i) => issueMatches(i, query, ws)), [issues, query, ws]);
  const groups = useMemo(() => groupIssues(shown, ws), [shown, ws]);
  const order = groups.flatMap((g) => g.issues);
  const listRef = useRef<HTMLDivElement>(null);
  // The row that takes Tab: the open issue's, else the first.
  const [focusKey, setFocusKey] = useState<string | undefined>(openKey);
  const current = order.find((i) => i.key === (openKey ?? focusKey))?.key ?? order[0]?.key;
  useEffect(() => setQuery(""), [scope]);
  useEffect(() => {
    if (openKey)
      listRef.current?.querySelector<HTMLElement>(`[data-key="${openKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [openKey]);

  const step = (by: number) => {
    const at = order.findIndex((i) => i.key === current);
    const next = order[Math.min(order.length - 1, Math.max(0, at < 0 ? 0 : at + by))];
    if (!next) return;
    setFocusKey(next.key);
    if (opensBeside) onOpen(next.key);
    listRef.current?.querySelector<HTMLElement>(`[data-key="${next.key}"]`)?.focus();
  };

  return (
    <div className="linear-list">
      <ScreenHead title={title} count={loading && !issues.length ? undefined : issues.length}>
        {actions}
      </ScreenHead>
      {children}
      <label className="search-wrap">
        <Search size={14} aria-hidden="true" />
        <input
          {...plainText}
          type="search"
          aria-label="Search these issues"
          placeholder="Search issues"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              step(order.findIndex((i) => i.key === current) < 0 ? 0 : opensBeside && openKey ? 1 : 0);
            } else if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
      </label>
      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="linear-groups"
        ref={listRef}
        role="listbox"
        aria-label="Issues"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            step(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {loading && !issues.length && <p className="linear-note">Loading issues…</p>}
        {!loading && !error && !issues.length && <p className="linear-note">No issues here.</p>}
        {issues.length > 0 && !shown.length && <p className="linear-note">No issue matches.</p>}
        {groups.map((g) => (
          <div key={g.state.name} className="linear-group" role="group" aria-label={g.state.name}>
            <h3>
              <Dot color={g.state.color} />
              {g.state.name}
              <span className="linear-count">{g.issues.length}</span>
            </h3>
            {g.issues.map((i) => (
              <IssueRow
                key={i.id}
                issue={i}
                ws={ws}
                open={i.key === openKey}
                focusable={i.key === current}
                onOpen={onOpen}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
