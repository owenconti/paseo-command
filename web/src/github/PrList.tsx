import { useEffect, useRef, useState } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { readPath, useGithubRead } from "./api";
import { Avatar, ChecksIcon, Churn, CommentCount, Decision, PrStateIcon, Time, YOUR_REVIEW_LABEL } from "./bits";
import { SCOPE_TITLE } from "./names";
import type { PrList as PrListData, PrRow, PrScope } from "./types";

const SCOPE_EMPTY: Record<PrScope, string> = {
  review: "No one is waiting on your review.",
  mine: "You have no open pull requests.",
  involved: "No open pull requests involve you.",
};

/** The list's rows refresh every minute while it shows. */
export const LIST_POLL_MS = 60_000;

/** The selected row of each list, kept while the view comes and goes. */
const lastSelected = new Map<PrScope, string>();

/**
 * Open pull requests in one of the sidebar's lists, most recently updated
 * first: each with its state, repository and number, author, labels, checks,
 * review decision and your own review, comments and size. J/K or ↓/↑ move,
 * Enter or O open (a click opens too).
 */
export function PrList({
  scope,
  onOpen,
  keys,
}: {
  scope: PrScope;
  onOpen: (row: PrRow) => void;
  /** The view hands its keys here while the list shows. */
  keys: React.MutableRefObject<((e: KeyboardEvent | React.KeyboardEvent) => boolean) | null>;
}) {
  const list = useGithubRead<PrListData>(readPath("prs", { scope }), LIST_POLL_MS);
  const rows = list.data?.rows ?? [];
  const [selectedId, setSelectedId] = useState<string | undefined>(lastSelected.get(scope));
  useEffect(() => setSelectedId(lastSelected.get(scope)), [scope]);
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0];
  useEffect(() => {
    if (selected) lastSelected.set(scope, selected.id);
  }, [scope, selected]);
  const listRef = useRef<HTMLDivElement>(null);
  const select = (row: PrRow) => {
    setSelectedId(row.id);
    setTimeout(() => listRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(row.id)}"]`)?.focus(), 0);
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
      <header className="gh-head">
        <h2>
          {SCOPE_TITLE[scope]}
          {list.data && <span className="gh-count">{rows.length}</span>}
        </h2>
        <span className="gh-spacer" />
        <button className="icon-btn" aria-label="Refresh" data-tip="Refresh" onClick={list.reload}>
          <RefreshCw size={13} aria-hidden="true" className={list.loading ? "spinning" : undefined} />
        </button>
      </header>
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
            <button className="secondary" onClick={list.reload}>
              Try again
            </button>
          </div>
        ) : (
          <p className="gh-note">Loading pull requests…</p>
        )
      ) : !rows.length ? (
        <p className="gh-note">{SCOPE_EMPTY[scope]}</p>
      ) : (
        <div className="gh-rows" role="listbox" aria-label={SCOPE_TITLE[scope]} ref={listRef}>
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
                  <span className="gh-repo">
                    {row.repo}#{row.number}
                  </span>
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
    </div>
  );
}
