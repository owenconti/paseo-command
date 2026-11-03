import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { usePageTitleTip } from "../pageHead";
import { readPath, useGithubRead } from "./api";
import { Avatar, ChecksIcon, Churn, CommentCount, Decision, PrStateIcon, Time, YOUR_REVIEW_LABEL } from "./bits";
import { SCOPE_TITLE } from "./names";
import { filterParams, filtersSet, type RepoFilters } from "./filters";
import type { PrList as PrListData, PrRow, PrScope } from "./types";

const SCOPE_EMPTY: Record<PrScope, string> = {
  review: "No one is waiting on your review.",
  mine: "You have no open pull requests.",
  involved: "No open pull requests involve you.",
};

/** The list's rows refresh every minute while it shows. */
export const LIST_POLL_MS = 60_000;

/** The selected row of each list, kept while the view comes and goes. */
const lastSelected = new Map<string, string>();

/** What a repository's list says when nothing matches. */
const repoEmpty = (filters: RepoFilters) =>
  filtersSet({ ...filters, state: "open" }) ? "No pull requests match these filters." : `No ${filters.state} pull requests.`;

/**
 * Pull requests in one of the sidebar's lists (open ones), or a repository's
 * with its filters (`tools` beside the head, `below` it: the filter's
 * button and chips), most recently updated first: each with its state,
 * repository and number, author, labels, checks, review decision and your
 * own review, comments and size. J/K or ↓/↑ move, Enter or O open (a click opens too).
 */
export function PrList({
  scope,
  repo,
  filters,
  title,
  tools,
  below,
  onOpen,
  keys,
}: {
  scope?: PrScope;
  repo?: string;
  filters?: RepoFilters;
  title?: ReactNode;
  tools?: ReactNode;
  below?: ReactNode;
  onOpen: (row: PrRow) => void;
  /** The view hands its keys here while the list shows. */
  keys: React.MutableRefObject<((e: KeyboardEvent | React.KeyboardEvent) => boolean) | null>;
}) {
  const path = repo ? readPath("prs", { repo, ...filterParams(filters ?? { state: "open" }) }) : readPath("prs", { scope: scope ?? "review" });
  const which = repo ? `repo:${repo.toLowerCase()}` : (scope ?? "review");
  const name = repo ?? SCOPE_TITLE[scope ?? "review"];
  const list = useGithubRead<PrListData>(path, LIST_POLL_MS);
  const titleTip = usePageTitleTip<HTMLHeadingElement>();
  const rows = list.data?.rows ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(lastSelected.get(which));
  useEffect(() => setSelectedId(lastSelected.get(which)), [which]);
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];
  useEffect(() => {
    if (selected) lastSelected.set(which, selected.id);
  }, [which, selected]);
  const listRef = useRef<HTMLDivElement>(null);
  // Only the latest move focuses its row: an earlier one's focus landing late would select its row again.
  const wanted = useRef<string | undefined>(undefined);
  const select = (row: PrRow) => {
    setSelectedId(row.id);
    wanted.current = row.id;
    setTimeout(() => {
      if (wanted.current === row.id) listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(row.id)}"]`)?.focus();
    }, 0);
  };
  keys.current = (e) => {
    const lower = e.key.toLowerCase();
    if (lower === "j" || e.key === "ArrowDown" || lower === "k" || e.key === "ArrowUp") {
      if (!rows.length) return true;
      const by = lower === "j" || e.key === "ArrowDown" ? 1 : -1;
      const at = selected ? rows.indexOf(selected) : -1;
      select(rows[Math.min(rows.length - 1, Math.max(0, at + by))]!);
      return true;
    }
    if (e.key === "Enter" || lower === "o") {
      if (selected) onOpen(selected);
      return true;
    }
    return false;
  };

  return (
    <div className="gh-main-inner">
      <header className="gh-head page-head">
        <h2 className="page-head-title" ref={titleTip}>
          <span className="page-head-name">{title ?? name}</span>
          {list.data && <span className="gh-count page-head-count">{repo ? Math.max(list.data.total ?? 0, rows.length) : rows.length}</span>}
        </h2>
        <span className="gh-spacer" />
        {tools}
        <button className="icon-btn" aria-label="Refresh" data-tip="Refresh" onClick={list.reload}>
          <RefreshCw size={13} aria-hidden="true" className={list.loading ? "spinning" : undefined} />
        </button>
      </header>
      {below}
      {list.data && list.error && (
        <p className="gh-banner" role="status">
          Couldn’t refresh: {list.error}
        </p>
      )}
      {list.unavailable ? (
        <div className="gh-empty">
          <CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
          <p>{list.unavailable}</p>
        </div>
      ) : !list.data ? (
        list.error ? (
          <div className="gh-empty">
            <CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
            <h3>GitHub didn’t answer</h3>
            <p>{list.error}</p>
            <button className="page-btn" onClick={list.reload}>
              Try again
            </button>
          </div>
        ) : (
          <p className="gh-note">Loading pull requests…</p>
        )
      ) : !rows.length ? (
        <p className="gh-note">{repo ? repoEmpty(filters ?? { state: "open" }) : SCOPE_EMPTY[scope ?? "review"]}</p>
      ) : (
        <div className="gh-rows" role="listbox" aria-label={name} ref={listRef}>
          {rows.map((row) => (
            <div
              key={row.id}
              data-id={row.id}
              role="option"
              aria-selected={row === selected}
              tabIndex={row === selected ? 0 : -1}
              className={`gh-row${row === selected ? " selected" : ""}`}
              onClick={() => onOpen(row)}
              onFocus={() => setSelectedId(row.id)}
            >
              <PrStateIcon state={row.state} />
              <span className="gh-row-text">
                <span className="gh-row-title">
                  {row.title}
                  {row.labels.slice(0, 4).map((l) => (
                    <span key={l.name} className="gh-label" style={{ ["--label" as string]: `#${l.color}` }}>
                      {l.name}
                    </span>
                  ))}
                </span>
                <span className="gh-row-sub">
                  <span className="gh-repo">{repo ? `#${row.number}` : `${row.repo}#${row.number}`}</span>
                  <span>
                    by {row.author?.login ?? "ghost"} · updated <Time at={row.updatedAt} />
                  </span>
                  {row.yourReview && <span className={`gh-your-review ${row.yourReview}`}>{YOUR_REVIEW_LABEL[row.yourReview]}</span>}
                </span>
              </span>
              <span className="gh-row-facts">
                <ChecksIcon state={row.checks} />
                <Decision decision={row.reviewDecision} />
                <CommentCount count={row.comments} />
                <Churn additions={row.additions} deletions={row.deletions} />
                <Avatar person={row.author} size={20} />
              </span>
            </div>
          ))}
        </div>
      )}
      {repo && rows.length > 0 && (list.data?.total ?? 0) > rows.length && (
        <p className="gh-note">
          The {rows.length} most recently updated of {list.data!.total}. Filter to find others.
        </p>
      )}
    </div>
  );
}
