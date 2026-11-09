import { useEffect, useRef, useState, type RefObject } from "react";
import { ArrowLeft, GitCommitHorizontal, RefreshCw } from "lucide-react";
import { api, errorMessage, readStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { usePageRefresh } from "../pageRefresh";
import { isTyping } from "../worldShortcut";
import { readPath, useGithubRead } from "./api";
import { DiffView, type DiffLayout, type DiffViewHandle } from "./DiffView";
import type { MainCommitPage, MainCommitDetail } from "./types";
import "./history.css";

export type HistoryState = {
  more: boolean;
  newer: boolean;
  loading: boolean;
  rows: { sha: string; title: string }[];
};
const date = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Date unavailable" : d.toLocaleString();
};
/** Poll only the tip. Pagination is pinned to the accepted head so arrivals can't skip commits or move the reader. */
export function MainHistory({
  repo,
  sha,
  onCommit,
  onPulls,
  onExternal,
  layout,
  listShown,
  handle,
  onState,
}: {
  repo: string;
  sha?: string;
  onCommit: (sha?: string) => void;
  onPulls: () => void;
  onExternal: (url: string) => void;
  layout: DiffLayout;
  listShown: boolean;
  handle: RefObject<DiffViewHandle | null>;
  onState: (state: HistoryState | undefined) => void;
}) {
  const latest = useGithubRead<MainCommitPage>(
    readPath("commits", { repo }),
    15_000,
  );
  const detail = useGithubRead<MainCommitDetail>(
    sha ? readPath("commit", { repo, sha }) : null,
  );
  const [page, setPage] = useState<MainCommitPage>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const requests = useRef(0);
  const mounted = useRef(true);
  const oldSeen = useRef(
    readStore<string>(`github:main-seen:${repo.toLowerCase()}`, ""),
  );
  const [seen, setSeen] = useState(oldSeen.current);
  const accept = () => {
    if (!latest.data) return;
    requests.current++;
    setSeen(page?.head ?? oldSeen.current);
    setPage(latest.data);
    setLoading(false);
    setError("");
    writeStore(`github:main-seen:${repo.toLowerCase()}`, latest.data.head);
  };
  useEffect(() => {
    if (!page && latest.data) accept();
  }, [page, latest.data]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requests.current++;
    };
  }, []);
  const newer = !!page && !!latest.data && latest.data.head !== page.head;
  const older = async () => {
    if (!page?.more || !page.cursor || loading) return;
    const seq = ++requests.current;
    setLoading(true);
    setError("");
    try {
      const next = await api<MainCommitPage>(
        readPath("commits", { repo, head: page.head, after: page.cursor }),
      );
      if (!mounted.current || seq !== requests.current) return;
      if (!(next && next.head === page.head && Array.isArray(next.rows)))
        throw new Error(
          "GitHub could not load this part of main’s history. Try again.",
        );
      setPage((old) =>
        old
          ? {
              ...next,
              rows: [
                ...old.rows,
                ...next.rows.filter(
                  (r) => !old.rows.some((o) => o.sha === r.sha),
                ),
              ],
            }
          : old,
      );
    } catch (e) {
      if (mounted.current && seq === requests.current)
        setError(errorMessage(e));
    } finally {
      if (mounted.current && seq === requests.current) setLoading(false);
    }
  };
  const refresh = async () => {
    await latest.reload();
    if (sha) await detail.reload();
  };
  usePageRefresh(refresh);
  const commands = useRef({ accept, older });
  commands.current = { accept, older };
  useEffect(() => {
    const offNew = onAppCommand("github-history-latest", () =>
      commands.current.accept(),
    );
    const offOlder = onAppCommand(
      "github-history-older",
      () => void commands.current.older(),
    );
    return () => {
      offNew();
      offOlder();
    };
  }, []);
  useEffect(() => {
    onState({
      more: !!page?.more,
      newer,
      loading,
      rows: page?.rows.map(({ sha, title }) => ({ sha, title })) ?? [],
    });
  }, [page, newer, loading, onState]);
  useEffect(() => () => onState(undefined), [onState]);
  const markSeen = (id: string) => onCommit(id);
  return (
    <section className="gh-history" aria-label="Main commit history">
      <header className="gh-history-head">
        <div>
          <h2>
            <GitCommitHorizontal size={18} aria-hidden="true" />{" "}
            {repo.split("/")[1]} <span>main</span>
          </h2>
          <p>{repo} · Every commit in main’s history · Watching main</p>
        </div>
        <div className="gh-history-tools">
          <button className="page-btn" onClick={onPulls}>
            Pull requests
          </button>
          <button
            className="icon-btn"
            aria-label="Refresh main history"
            data-tip="Refresh (⌘R)"
            disabled={latest.loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>
      {newer && (
        <div className="gh-history-new" role="status">
          <span>New commits on main</span>
          <button className="page-btn" onClick={accept}>
            Show latest commits
          </button>
        </div>
      )}
      {(latest.error || latest.unavailable) && (
        <p className="gh-history-note" role="status">
          {latest.error || latest.unavailable}
        </p>
      )}
      {sha ? (
        <>
          <div className="gh-commit-head">
            <button className="page-btn" onClick={() => onCommit()}>
              <ArrowLeft size={13} /> Back to main history
            </button>
            <button
              className="page-btn"
              onClick={() =>
                onExternal(`https://github.com/${repo}/commit/${sha}`)
              }
            >
              Open commit on GitHub
            </button>
            <h3>{detail.data?.title ?? sha.slice(0, 7)}</h3>
            <p>
              <code>{sha.slice(0, 12)}</code>
              {detail.data && (
                <>
                  {" "}
                  · {detail.data.author} · {date(detail.data.date)} ·{" "}
                  <span className="gh-add">+{detail.data.additions}</span>{" "}
                  <span className="gh-remove">−{detail.data.deletions}</span>
                </>
              )}
            </p>
            {detail.data?.message.includes("\n") && (
              <pre>
                {detail.data.message
                  .slice(detail.data.message.indexOf("\n") + 1)
                  .trim()}
              </pre>
            )}
            {detail.data?.parents.length && detail.data.parents.length > 1 ? (
              <p>Merge commit · {detail.data.parents.length} parents</p>
            ) : null}
            {detail.data?.tooLarge && (
              <p role="status">
                This diff is too large to show in full. Open the commit on
                GitHub for the remaining changes.
              </p>
            )}
          </div>
          {detail.data ? (
            <DiffView
              key={sha}
              files={detail.data.files}
              layout={layout}
              listShown={listShown}
              handle={handle}
              empty={
                <p className="gh-history-note">
                  This commit has no file changes to display.
                </p>
              }
            />
          ) : (
            <p className="gh-history-note" role="status">
              {detail.error || detail.unavailable || "Loading commit changes…"}
            </p>
          )}
        </>
      ) : (
        <div className="gh-history-scroll">
          {latest.loading && !page && (
            <p className="gh-history-note" role="status">
              Loading main’s commits…
            </p>
          )}
          {page && (
            <ol
              className="gh-commit-list"
              aria-label="Commits on main"
              onKeyDown={(e) => {
                if (
                  e.metaKey ||
                  e.ctrlKey ||
                  e.altKey ||
                  isTyping(e.target as HTMLElement)
                )
                  return;
                const rows = [
                  ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                    "button",
                  ),
                ];
                const i = rows.indexOf(
                  document.activeElement as HTMLButtonElement,
                );
                if (["j", "k", "ArrowDown", "ArrowUp"].includes(e.key)) {
                  e.preventDefault();
                  e.stopPropagation();
                  rows[
                    Math.min(
                      rows.length - 1,
                      Math.max(
                        0,
                        i + (["j", "ArrowDown"].includes(e.key) ? 1 : -1),
                      ),
                    )
                  ]?.focus();
                } else if (e.key.toLowerCase() === "o" && i >= 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  rows[i]?.click();
                }
              }}
            >
              {page.rows.map((c, i) => (
                <li key={c.sha}>
                  <button type="button" onClick={() => markSeen(c.sha)}>
                    <GitCommitHorizontal size={17} aria-hidden="true" />
                    <span className="gh-commit-message">
                      <strong>{c.title}</strong>
                      <span>
                        {c.author} ·{" "}
                        <time dateTime={c.date}>{date(c.date)}</time>
                        {seen &&
                        c.sha !== seen &&
                        i < page.rows.findIndex((r) => r.sha === seen) ? (
                          <em>New</em>
                        ) : null}
                      </span>
                    </span>
                    <code>{c.sha.slice(0, 7)}</code>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {page && !page.rows.length && (
            <p className="gh-history-note">No commits on main.</p>
          )}
          {error && (
            <p className="gh-history-note" role="alert">
              {error}
            </p>
          )}
          {page?.more ? (
            <button
              className="page-btn gh-history-more"
              disabled={loading}
              onClick={() => void older()}
            >
              {loading ? "Loading older commits…" : "Load older commits"}
            </button>
          ) : page?.rows.length ? (
            <p className="gh-history-end">
              Beginning of main’s history · {page.rows.length} commits
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
