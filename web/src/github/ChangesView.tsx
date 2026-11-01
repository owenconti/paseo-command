import { useMemo } from "react";
import { ArrowDown, ArrowUp, CircleAlert, ExternalLink, GitBranch, GitPullRequest, PanelLeft, RefreshCw } from "lucide-react";
import { changesPath, useGithubRead } from "./api";
import { Churn } from "./bits";
import { DiffView, type DiffLayout, type DiffViewHandle } from "./DiffView";
import { MODE_LABEL } from "./names";
import type { ChangesMode, WorkspaceChanges } from "./types";
import type { GithubWorkspace } from "./GitHubView";

const MODE_TIP: Record<ChangesMode, string> = {
  all: "Everything on the branch since it left its base, committed or not",
  base: "Only what's committed on the branch",
  uncommitted: "Only what isn't committed yet",
};
/** The workspace's changes are asked again every 15 s while they show (agents keep writing). */
const CHANGES_POLL_MS = 15_000;

/**
 * The selected workspace's branch against its base (main), from its host's
 * daemon: all changes (committed or not), committed only, or uncommitted only;
 * how far it's ahead and behind; its pull request, to review here, and the
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
  handle,
}: {
  workspace?: GithubWorkspace;
  mode: ChangesMode;
  setMode: (m: ChangesMode) => void;
  layout: DiffLayout;
  setLayout: (l: DiffLayout) => void;
  listShown: boolean;
  setListShown: (shown: boolean) => void;
  onOpenPr: (repo: string, number: number) => void;
  onExternal: (url: string) => void;
  handle: React.RefObject<DiffViewHandle | null>;
}) {
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
  const pr = data?.pr ?? null;
  const prRepo = pr?.repo ?? data?.repo;
  const compare =
    data?.repo && data.branch && data.baseRef
      ? `https://github.com/${data.repo}/compare/${encodeURIComponent(data.baseRef.replace(/^origin\//, ""))}...${encodeURIComponent(data.branch)}`
      : undefined;

  if (!workspace)
    return (
      <div className="gh-main-inner">
        <header className="gh-head">
          <h2>Workspace changes</h2>
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
      <header className="gh-head">
        <h2 className="gh-changes-title">
          <GitBranch size={15} aria-hidden="true" />
          <span>{workspace.name}</span>
        </h2>
        {data && (
          <span className="gh-branches" data-tip={`${data.branch ?? "This checkout"} compared with ${data.baseRef ?? "its base"}`}>
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
        {pr && prRepo && (
          <button className="secondary" onClick={() => onOpenPr(prRepo, pr.number)} data-tip={pr.title}>
            <GitPullRequest size={13} aria-hidden="true" />
            Review #{pr.number}
          </button>
        )}
        {compare && (
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
            <button className="secondary" onClick={changes.reload}>
              Try again
            </button>
          </div>
        ) : (
          <p className="gh-note">Loading changes…</p>
        )
      ) : (
        <DiffView
          files={data.files}
          layout={layout}
          listShown={listShown}
          handle={handle}
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

/** Split or unified, and the file list shown or not (both kept). */
export function LayoutControls({
  layout,
  setLayout,
  listShown,
  setListShown,
}: {
  layout: DiffLayout;
  setLayout: (l: DiffLayout) => void;
  listShown: boolean;
  setListShown: (shown: boolean) => void;
}) {
  return (
    <>
      <button
        className={`icon-btn${listShown ? " on" : ""}`}
        aria-label={listShown ? "Hide the file list" : "Show the file list"}
        aria-pressed={listShown}
        data-tip={listShown ? "Hide files (F)" : "Show files (F)"}
        onClick={() => setListShown(!listShown)}
      >
        <PanelLeft size={13} aria-hidden="true" />
      </button>
      <div className="gh-segmented" role="radiogroup" aria-label="Diff layout">
        {(["unified", "split"] as const).map((l) => (
          <button key={l} role="radio" aria-checked={layout === l} className={layout === l ? "selected" : ""} data-tip="Unified or split (U)" onClick={() => setLayout(l)}>
            {l === "unified" ? "Unified" : "Split"}
          </button>
        ))}
      </div>
    </>
  );
}
