import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CornerLeftUp,
  ExternalLink,
  GitBranch,
  ListTodo,
  LoaderCircle,
  Minus,
  OctagonAlert,
  Play,
  RefreshCw,
  Search,
  SignalHigh,
  SignalLow,
  SignalMedium,
} from "lucide-react";
import { ago, readStore, writeStore } from "./api";
import { onAppCommand } from "./appCommands";
import { openExternal } from "./links";
import { Markdown } from "./Markdown";
import { plainText } from "./ui";
import {
  groupIssues,
  issueContext,
  issueMatches,
  useAssignedIssues,
  useIssueDetail,
  type IssueContext,
  type LinearIssueRow,
} from "./linearIssues";

const PRIORITY_ICON = [Minus, OctagonAlert, SignalHigh, SignalMedium, SignalLow];

function Priority({ issue }: { issue: LinearIssueRow }) {
  const Icon = PRIORITY_ICON[issue.priority] ?? Minus;
  return (
    <span
      className={`linear-priority p${issue.priority}`}
      aria-label={issue.priorityLabel || "No priority"}
      data-tip={issue.priorityLabel || "No priority"}
    >
      <Icon size={13} aria-hidden="true" />
    </span>
  );
}

function StateDot({ color }: { color: string }) {
  return <span className="linear-state-dot" style={{ background: color }} aria-hidden="true" />;
}

/**
 * The Linear tab, in the map's place (the macOS app's mode bar): the open
 * issues assigned to you, grouped by state, beside the chosen one's details,
 * from which an agent can be launched (New agent opens in the panel with the
 * issue). Read-only: nothing here changes Linear.
 */
export function LinearView({ onLaunch }: { onLaunch: (issue: IssueContext) => void }) {
  const list = useAssignedIssues();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(() => readStore("linear:selected", null));
  const [revision, setRevision] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const issues = list.answer?.available ? list.answer.issues : [];
  const shown = useMemo(() => issues.filter((i) => issueMatches(i, query)), [issues, query]);
  const groups = useMemo(() => groupIssues(shown), [shown]);
  const order = groups.flatMap((g) => g.issues);
  // The remembered issue, or the first, once the list is in.
  const current =
    issues.find((i) => i.key === selected)?.key ?? (list.answer ? order[0]?.key ?? null : null);
  const detail = useIssueDetail(current, revision);
  const choose = (key: string) => {
    setSelected(key);
    writeStore("linear:selected", key);
  };
  const refresh = () => {
    list.refresh();
    setRevision((r) => r + 1);
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => onAppCommand("linear-refresh", () => refreshRef.current()), []);
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-key="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const step = (by: number) => {
    const at = order.findIndex((i) => i.key === current);
    const next = order[Math.min(order.length - 1, Math.max(0, at + by))];
    if (next) {
      choose(next.key);
      listRef.current?.querySelector<HTMLElement>(`[data-key="${next.key}"]`)?.focus();
    }
  };

  if (list.answer && !list.answer.available)
    return (
      <section className="linear-view linear-unavailable" aria-label="Linear issues">
        <ListTodo size={28} strokeWidth={1.5} aria-hidden="true" />
        <h2>Linear isn’t connected</h2>
        <p>{list.answer.reason}</p>
        <button className="secondary" onClick={refresh}>
          <RefreshCw size={12} aria-hidden="true" />
          Try again
        </button>
      </section>
    );

  const issue = detail?.answer?.available ? detail.answer.issue : null;
  return (
    <section className="linear-view" aria-label="Linear issues">
      <div className="linear-list">
        <header className="linear-list-head">
          <h2>
            Assigned to you
            {list.answer?.available && <span className="linear-count">{issues.length}</span>}
          </h2>
          <button
            className="icon-btn"
            aria-label="Refresh"
            data-tip="Ask Linear again"
            disabled={list.loading}
            onClick={refresh}
          >
            {list.loading ? (
              <LoaderCircle size={14} className="spinning" aria-hidden="true" />
            ) : (
              <RefreshCw size={14} aria-hidden="true" />
            )}
          </button>
        </header>
        <label className="search-wrap">
          <Search size={14} aria-hidden="true" />
          <input
            {...plainText}
            type="search"
            aria-label="Search your issues"
            placeholder="Search issues"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                step(order.findIndex((i) => i.key === current) < 0 ? 0 : 1);
              } else if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
        </label>
        {list.error && (
          <p className="archive-error" role="alert">
            {list.error}
          </p>
        )}
        <div
          className="linear-groups"
          ref={listRef}
          role="listbox"
          aria-label="Your issues"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              step(e.key === "ArrowDown" ? 1 : -1);
            }
          }}
        >
          {!list.answer && <p className="linear-note">Loading your issues…</p>}
          {list.answer?.available && !issues.length && (
            <p className="linear-note">Nothing open is assigned to you.</p>
          )}
          {issues.length > 0 && !shown.length && <p className="linear-note">No issue matches.</p>}
          {groups.map((g) => (
            <div key={g.state.name} className="linear-group" role="group" aria-label={g.state.name}>
              <h3>
                <StateDot color={g.state.color} />
                {g.state.name}
                <span className="linear-count">{g.issues.length}</span>
              </h3>
              {g.issues.map((i) => (
                <button
                  key={i.key}
                  data-key={i.key}
                  role="option"
                  aria-selected={i.key === current}
                  tabIndex={i.key === current ? 0 : -1}
                  className={`linear-row${i.key === current ? " selected" : ""}`}
                  onClick={() => choose(i.key)}
                >
                  <Priority issue={i} />
                  <span className="linear-key">{i.key}</span>
                  <span className="linear-title">{i.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="linear-detail" aria-live="polite">
        {!current ? (
          <p className="linear-note">Choose an issue to see it here.</p>
        ) : detail?.error || (detail?.answer && !detail.answer.available) ? (
          <p className="archive-error" role="alert">
            {detail.error ||
              (detail.answer && !detail.answer.available ? detail.answer.reason : "")}
          </p>
        ) : detail?.answer && !issue ? (
          <p className="linear-note">Linear doesn’t know {current}.</p>
        ) : !issue ? (
          <p className="linear-note">Loading {current}…</p>
        ) : (
          <article className="linear-issue">
            <header>
              <div className="linear-issue-line">
                <span className="linear-key">{issue.key}</span>
                <span className="linear-state">
                  <StateDot color={issue.state.color} />
                  {issue.state.name}
                </span>
                <span className="linear-meta-item">
                  <Priority issue={issue} />
                  {issue.priorityLabel || "No priority"}
                </span>
              </div>
              <h1>{issue.title}</h1>
              <dl className="linear-facts">
                {issue.project && (
                  <div>
                    <dt>Project</dt>
                    <dd>{issue.project}</dd>
                  </div>
                )}
                <div>
                  <dt>Team</dt>
                  <dd>{issue.team}</dd>
                </div>
                {issue.creator && (
                  <div>
                    <dt>Created by</dt>
                    <dd>{issue.creator}</dd>
                  </div>
                )}
                {issue.dueDate && (
                  <div>
                    <dt>Due</dt>
                    <dd>
                      <CalendarDays size={12} aria-hidden="true" /> {issue.dueDate}
                    </dd>
                  </div>
                )}
                {issue.estimate != null && (
                  <div>
                    <dt>Estimate</dt>
                    <dd>{issue.estimate}</dd>
                  </div>
                )}
                <div>
                  <dt>Updated</dt>
                  <dd>{ago(issue.updatedAt)}</dd>
                </div>
              </dl>
              {issue.parent && (
                <button className="link-btn linear-parent" onClick={() => choose(issue.parent!.key)} disabled={!issues.some((i) => i.key === issue.parent!.key)}>
                  <CornerLeftUp size={12} aria-hidden="true" />
                  Part of {issue.parent.key}: {issue.parent.title}
                </button>
              )}
              {issue.labels.length > 0 && (
                <ul className="linear-labels" aria-label="Labels">
                  {issue.labels.map((l) => (
                    <li key={l.name}>
                      <StateDot color={l.color} />
                      {l.name}
                    </li>
                  ))}
                </ul>
              )}
              <div className="linear-actions">
                <button
                  className="primary"
                  aria-description="Opens New agent in the panel: choose the host and project, then the prompt"
                  onClick={() => onLaunch(issueContext(issue))}
                >
                  <Play size={13} aria-hidden="true" />
                  Launch agent
                </button>
                {issue.url && (
                  <button className="secondary" onClick={() => openExternal(issue.url)}>
                    <ExternalLink size={13} aria-hidden="true" />
                    Open in Linear
                  </button>
                )}
                {issue.branchName && (
                  <span className="linear-branch" data-tip="Linear’s branch for it; a new agent’s worktree takes it">
                    <GitBranch size={12} aria-hidden="true" />
                    {issue.branchName}
                  </span>
                )}
              </div>
            </header>
            <div className="linear-description">
              {issue.description.trim() ? (
                <Markdown text={issue.description} />
              ) : (
                <p className="linear-note">No description.</p>
              )}
            </div>
            {issue.links.length > 0 && (
              <section className="linear-section">
                <h3>Links</h3>
                <ul className="linear-links">
                  {issue.links.map((l) => (
                    <li key={l.url}>
                      <button className="link-btn" onClick={() => openExternal(l.url)}>
                        <ExternalLink size={12} aria-hidden="true" />
                        {l.title || l.url}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {issue.comments.length > 0 && (
              <section className="linear-section">
                <h3>
                  Comments <span className="linear-count">{issue.comments.length}</span>
                </h3>
                {issue.comments.map((c, n) => (
                  <div key={n} className="linear-comment">
                    <p className="linear-comment-head">
                      <b>{c.author}</b> <span>{ago(c.createdAt)}</span>
                    </p>
                    <Markdown text={c.body} />
                  </div>
                ))}
              </section>
            )}
          </article>
        )}
      </div>
    </section>
  );
}
