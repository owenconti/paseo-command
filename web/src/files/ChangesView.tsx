import { useCallback, useEffect, useMemo, useRef } from "react";
import { ArrowDown, ArrowUp, CircleAlert, ExternalLink, GitBranch, GitPullRequest, MessageSquare, RefreshCw } from "lucide-react";
import { changesPath, useGithubRead } from "../github/api";
import { Churn } from "../github/bits";
import { usePageTitleTip } from "../pageHead";
import { DiffView, Draft, LayoutControls, type DiffLayout, type DiffReview, type DiffViewHandle } from "../github/DiffView";
import { pendingLabel, placeComments, placeLabel, textOf, type LocalComment } from "../github/localComments";
import { useLocalComments } from "../github/localCommentsStore";
import { MODE_LABEL } from "../github/names";
import type { ChangesMode, WorkspaceChanges } from "../github/types";

const MODE_TIP: Record<ChangesMode, string> = {
  all: "Everything on the branch since it left its base, committed or not",
  base: "Only what's committed on the branch",
  uncommitted: "Only what isn't committed yet",
};
/** The workspace's changes are asked again every 15 s while they show (agents keep writing). */
const CHANGES_POLL_MS = 15_000;

/**
 * The Files page's Changes: the selected workspace's branch against its base
 * (main), from its host's daemon (no GitHub needed): all changes (committed or
 * not), committed only, or uncommitted only; how far it's ahead and behind;
 * pending comments on its lines; each file's head opens it in Files. With
 * GitHub on, its pull request (Review #N, in the GitHub tab) and the
 * comparison on GitHub.
 */
export function ChangesView({
  workspace,
  mode,
  setMode,
  layout,
  setLayout,
  listShown,
  setListShown,
  onOpenPr,
  onExternal,
  onOpenFile,
  handle,
  onNotice,
  showPath,
  onShown,
}: {
  /** A file to scroll to once the changes show (then `onShown`). */
  showPath?: string;
  onShown?: () => void;
  workspace?: { id: string; host?: string; name: string };
  mode: ChangesMode;
  setMode: (m: ChangesMode) => void;
  layout: DiffLayout;
  setLayout: (l: DiffLayout) => void;
  listShown: boolean;
  setListShown: (shown: boolean) => void;
  /** Review #N and Compare on GitHub: only while GitHub is on. */
  onOpenPr?: (repo: string, number: number) => void;
  onExternal?: (url: string) => void;
  onOpenFile: (path: string) => void;
  handle: React.RefObject<DiffViewHandle | null>;
  onNotice: (message: string) => void;
}) {
  const titleTip = usePageTitleTip<HTMLHeadingElement>();
  const changes = useGithubRead<WorkspaceChanges>(
    workspace ? changesPath(workspace.id, workspace.host, mode) : null,
    CHANGES_POLL_MS,
  );
  const data = changes.data;
  const totals = useMemo(
    () =>
      (data?.files ?? []).reduce((t, f) => ({ additions: t.additions + f.additions, deletions: t.deletions + f.deletions }), {
        additions: 0,
        deletions: 0,
      }),
    [data],
  );
  const comments = useLocalComments(workspace?.host, workspace?.id, onNotice);
  const { change } = comments;
  // Each pending comment where its lines are now; those whose lines moved are kept there, those gone are outdated.
  const placing = useMemo(() => (data ? placeComments(comments.pending, data.files) : null), [data, comments.pending]);
  const moves = placing?.moves;
  // Each set of moves asked once (one the server refused isn't asked again and again).
  const moved = useRef("");
  useEffect(() => {
    const ask = JSON.stringify(moves ?? []);
    if (!moves?.length || ask === moved.current) return;
    moved.current = ask;
    void change({ action: "move", moves });
  }, [moves, change]);
  const onAdd = useCallback(
    (c: { path: string; side: "LEFT" | "RIGHT"; line: number; startLine?: number; body: string }) => {
      const file = data?.files.find((f) => f.path === c.path);
      const from = c.startLine ?? c.line;
      void change({
        action: "add",
        comment: {
          path: c.path,
          side: c.side,
          line: c.line,
          ...(c.startLine !== undefined && c.startLine !== c.line ? { startLine: c.startLine } : {}),
          text: file ? textOf(file, c.side, from, c.line) : [],
          body: c.body,
        },
      });
    },
    [data, change],
  );
  const placed = placing?.placed;
  const hasWorkspace = !!workspace;
  const review = useMemo<DiffReview | undefined>(
    () =>
      hasWorkspace ? {
        local: true,
        threads: [],
        drafts: (placed ?? []).map((c) => ({ id: c.id, path: c.path, side: c.side, line: c.line, ...(c.startLine !== undefined ? { startLine: c.startLine, startSide: c.side } : {}), body: c.body })),
        onAdd,
        onEdit: (id, body) => void change({ action: "edit", id, body }),
        onRemove: (id) => void change({ action: "remove", id }),
        onReply: async () => false,
        onResolve: () => {},
        viewed: NONE_VIEWED,
        onViewed: () => {},
      } : undefined,
    [hasWorkspace, placed, onAdd, change],
  );
  // Asked for one file (the Files page's Show changes): scrolled to once it's drawn.
  const hasShowPath = !!showPath && !!data?.files.some((f) => f.path === showPath);
  useEffect(() => {
    if (!hasShowPath || !showPath) return;
    let tries = 0;
    let frame = requestAnimationFrame(function look() {
      const shown = handle.current?.current() === showPath;
      if (!shown) handle.current?.show(showPath);
      if (handle.current?.current() === showPath || ++tries > 30) onShown?.();
      else frame = requestAnimationFrame(look);
    });
    return () => cancelAnimationFrame(frame);
  }, [hasShowPath, showPath]);
  const pr = data?.pr ?? null;
  const prRepo = pr?.repo ?? data?.repo;
  const compare =
    data?.repo && data.branch && data.baseRef
      ? `https://github.com/${data.repo}/compare/${encodeURIComponent(data.baseRef.replace(/^origin\//, ""))}...${encodeURIComponent(data.branch)}`
      : undefined;

  if (!workspace)
    return (
      <div className="gh-main-inner">
        <header className="gh-head page-head">
          <h2 className="page-head-title">
            <span className="page-head-name">Workspace changes</span>
          </h2>
        </header>
        <div className="gh-empty">
          <GitBranch size={26} strokeWidth={1.5} aria-hidden="true" />
          <h3>No workspace selected</h3>
          <p>Select a workspace (or one of its agents) on the map or in the panel to see its branch against main.</p>
        </div>
      </div>
    );

  return (
    <div className="gh-main-inner">
      <header className="gh-head page-head">
        <h2 className="gh-changes-title page-head-title" ref={titleTip}>
          <GitBranch size={15} aria-hidden="true" />
          <span className="page-head-name">{workspace.name}</span>
        </h2>
        {data && (
          <span className="gh-branches page-head-aside" data-tip={`${data.branch ?? "This checkout"} compared with ${data.baseRef ?? "its base"}`}>
            <code>{data.branch ?? "detached"}</code>
            <span aria-hidden="true">→</span>
            <code>{data.baseRef ?? "base"}</code>
            {data.ahead !== undefined && data.ahead > 0 && (
              <span className="gh-ahead" aria-label={`${data.ahead} commits ahead`}>
                <ArrowUp size={11} aria-hidden="true" />
                {data.ahead}
              </span>
            )}
            {data.behind !== undefined && data.behind > 0 && (
              <span className="gh-behind" aria-label={`${data.behind} commits behind`}>
                <ArrowDown size={11} aria-hidden="true" />
                {data.behind}
              </span>
            )}
          </span>
        )}
        <span className="gh-spacer" />
        {comments.pending.length > 0 && (
          <span
            className="gh-local-count page-head-aside"
            data-tip="Comments on this diff, kept for the workspace: apply them from an agent’s chat"
          >
            <MessageSquare size={12} aria-hidden="true" />
            {pendingLabel(comments.pending.length)}
          </span>
        )}
        {pr && prRepo && onOpenPr && (
          <button className="page-btn" onClick={() => onOpenPr(prRepo, pr.number)} data-tip={`${pr.title} (in the GitHub tab)`}>
            <GitPullRequest size={13} aria-hidden="true" />
            <span className="page-tool-label">Review #{pr.number}</span>
          </button>
        )}
        {compare && onExternal && (
          <button className="icon-btn" aria-label="Compare on GitHub" data-tip="Compare on GitHub" onClick={() => onExternal(compare)}>
            <ExternalLink size={13} aria-hidden="true" />
          </button>
        )}
        <button className="icon-btn" aria-label="Refresh" data-tip="Refresh" onClick={changes.reload}>
          <RefreshCw size={13} aria-hidden="true" className={changes.loading ? "spinning" : undefined} />
        </button>
      </header>
      <div className="gh-toolbar">
        <div className="gh-segmented" role="radiogroup" aria-label="Which changes">
          {(["all", "base", "uncommitted"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? "selected" : ""} data-tip={`${MODE_TIP[m]} (M)`} onClick={() => setMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        {data && data.files.length > 0 && <Churn {...totals} />}
        {data?.dirty && mode === "base" && <span className="gh-hint">Uncommitted changes aren’t shown</span>}
        <span className="gh-spacer" />
        <LayoutControls layout={layout} setLayout={setLayout} listShown={listShown} setListShown={setListShown} />
      </div>
      {data?.tooLarge && (
        <p className="gh-banner" role="status">
          This diff is too large to show whole: some files are left out.
        </p>
      )}
      {data && changes.error && (
        <p className="gh-banner" role="status">
          Couldn’t refresh: {changes.error}
        </p>
      )}
      {changes.unavailable ? (
        <div className="gh-empty">
          <CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
          <p>{changes.unavailable}</p>
        </div>
      ) : !data ? (
        changes.error ? (
          <div className="gh-empty">
            <CircleAlert size={26} strokeWidth={1.5} aria-hidden="true" />
            <h3>The workspace’s host didn’t answer</h3>
            <p>{changes.error}</p>
            <button className="page-btn" onClick={changes.reload}>
              Try again
            </button>
          </div>
        ) : (
          <p className="gh-note">Loading changes…</p>
        )
      ) : (
        <DiffView
          files={data.files}
          onOpenFile={onOpenFile}
          layout={layout}
          listShown={listShown}
          handle={handle}
          review={review}
          head={review && placing && placing.outdated.length > 0 && <OutdatedComments comments={placing.outdated} review={review} />}
          empty={
            <p>
              {mode === "uncommitted"
                ? "Nothing uncommitted."
                : `No changes against ${data.baseRef ?? "the base"}${mode === "base" ? " committed yet" : ""}.`}
            </p>
          }
        />
      )}
    </div>
  );
}

const NONE_VIEWED: ReadonlyMap<string, boolean> = new Map();

/** Pending comments whose lines this diff no longer shows (changed, or their file's gone): still listed, editable. */
function OutdatedComments({ comments, review }: { comments: LocalComment[]; review: DiffReview }) {
  return (
    <section className="gh-notes apart gh-local-outdated" aria-label="Outdated comments">
      <p className="gh-hint">
        <MessageSquare size={12} aria-hidden="true" /> {comments.length === 1 ? "A pending comment" : `${comments.length} pending comments`} on
        lines this diff no longer shows
      </p>
      {comments.map((c) => (
        <div key={c.id} className="gh-local-outdated-item">
          <p className="gh-local-place">
            <code>{placeLabel(c)}</code> <span className="gh-thread-outdated">Outdated</span>
          </p>
          {c.text.length > 0 && <pre className="gh-local-quote">{c.text.join("\n")}</pre>}
          <Draft draft={{ id: c.id, path: c.path, side: c.side, line: c.line, body: c.body }} review={review} />
        </div>
      ))}
    </section>
  );
}
