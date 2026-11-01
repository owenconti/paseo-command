import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { AtSign, Eye, GitBranch, GitPullRequest, GitPullRequestArrow, RefreshCw, UserRound } from "lucide-react";
import { readStore, removeStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { modalOpen } from "../focus";
import { ResizeEdge } from "../ResizeEdge";
import { macApp, postAppLink } from "../worldBridge";
import { isTyping } from "../worldShortcut";
import { changesPath, invalidate, readPath, useGithubRead } from "./api";
import { createGithubToken } from "../GithubTokenSetup";
import { Avatar } from "./bits";
import { ChangesView } from "./ChangesView";
import type { DiffLayout, DiffViewHandle } from "./DiffView";
import { checkPlace, PR_TABS, readPlace, samePlace, writePlace, type GithubPlace, type PrTab } from "./place";
import { SCOPE_TITLE } from "./names";
import { LIST_POLL_MS, PrList } from "./PrList";
import { PrView, type PrViewApi } from "./PrView";
import { CHANGES_MODES, PR_SCOPES, type ChangesMode, type PrDetail, type PrList as PrListData, type PrScope, type ReviewEvent, type Viewer, type WorkspaceChanges } from "./types";
import "./github.css";

/** The workspace selected on the map or in the panel (or the open agent's), whose changes the tab shows. */
export type GithubWorkspace = {
  id: string;
  host?: string;
  name: string;
  branch?: string;
  /** Its PR, as the panel knows it. */
  pr?: { number: number; url: string; title: string } | null;
};

/** What ⌘K needs to know: where the view is, and what the open PR or diff allows. */
export type GithubViewState = {
  place: GithubPlace;
  layout: DiffLayout;
  listShown: boolean;
  /** A diff shows (Files changed, or the workspace's changes). */
  diff: boolean;
  pr?: { repo: string; number: number; url: string; title: string; viewerIsAuthor: boolean; open: boolean; pending: number };
  /** The PR the workspace's changes belong to. */
  workspacePr?: { repo: string; number: number };
  changesMode: ChangesMode;
  canBack: boolean;
};

const PANELS = { sidebar: 220, sidebarMin: 170, mainMin: 480 };
const SCOPE_ICON: Record<PrScope, typeof Eye> = { review: Eye, mine: UserRound, involved: AtSign };
const SCOPE_HINT: Record<PrScope, string> = {
  review: "Open pull requests waiting on your review",
  mine: "Open pull requests you opened",
  involved: "Open pull requests you're assigned, mentioned in or have commented on",
};

/** A PR's repository and number from its github.com address. */
const prOf = (url: string | undefined) => {
  const m = url && /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(url);
  return m ? { repo: m[1]!, number: Number(m[2]) } : undefined;
};

/**
 * The GitHub tab, in the map's place (the macOS app's mode bar), through the
 * user's own classic token (Settings → GitHub): the selected workspace's branch against main (from
 * its host's daemon, so remote workspaces too), and pull requests to review:
 * those waiting on you, yours and those involving you, each opening to its
 * conversation, files (the review), commits and checks.
 * Keys while the keyboard is in the view (not typing): J/K or ↓/↑ move
 * through a list (and through a diff's files), Enter or O open, Esc goes back,
 * 1–4 a PR's tabs, R review, C comment, V viewed, U unified/split, F the file
 * list, M which changes.
 */
export function GitHubView({
  workspace,
  onNotice,
  onViewState,
}: {
  workspace?: GithubWorkspace;
  onNotice: (message: string) => void;
  /** The view's state for ⌘K (undefined once it goes). */
  onViewState?: (state: GithubViewState | undefined) => void;
}) {
  const [place, setPlaceState] = useState<GithubPlace>(readPlace);
  // Where Back goes from a PR: the place it was opened from.
  const [from, setFrom] = useState<GithubPlace | null>(() => {
    const kept = readStore<unknown>("github:from", null);
    return kept ? checkPlace(kept) : null;
  });
  const go = useCallback((next: GithubPlace, keepFrom = false) => {
    setPlaceState((was) => {
      if (samePlace(was, next)) return was;
      if (next.kind === "pr" && !keepFrom && !(was.kind === "pr" && was.repo === next.repo && was.number === next.number)) {
        const back = was.kind === "pr" ? null : was;
        setFrom(back);
        if (back) writeStore("github:from", back);
        else removeStore("github:from");
      }
      writePlace(next);
      return next;
    });
  }, []);
  const back = useCallback(() => {
    setPlaceState((was) => {
      if (was.kind !== "pr") return was;
      const to = from ?? { kind: "prs" as const, scope: "review" as const };
      writePlace(to);
      return to;
    });
  }, [from]);

  const [layout, setLayoutState] = useState<DiffLayout>(() => (readStore<string>("github:layout", "unified") === "split" ? "split" : "unified"));
  const setLayout = (l: DiffLayout) => {
    setLayoutState(l);
    writeStore("github:layout", l);
  };
  const [listShown, setListShownState] = useState(() => readStore<boolean>("github:fileList", true) !== false);
  const setListShown = (shown: boolean) => {
    setListShownState(shown);
    writeStore("github:fileList", shown);
  };
  const [changesMode, setChangesModeState] = useState<ChangesMode>(() => {
    const kept = readStore<string>("github:changesMode", "all") as ChangesMode;
    return CHANGES_MODES.includes(kept) ? kept : "all";
  });
  const setChangesMode = (m: ChangesMode) => {
    setChangesModeState(m);
    writeStore("github:changesMode", m);
  };

  const viewer = useGithubRead<Viewer>(readPath("viewer"));
  // The sidebar's counts: each list, asked once shown (the open one polls).
  const counts = {
    review: useGithubRead<PrListData>(readPath("prs", { scope: "review" }), LIST_POLL_MS).data?.rows.length,
    mine: useGithubRead<PrListData>(readPath("prs", { scope: "mine" })).data?.rows.length,
    involved: useGithubRead<PrListData>(readPath("prs", { scope: "involved" })).data?.rows.length,
  };
  const changes = useGithubRead<WorkspaceChanges>(workspace ? changesPath(workspace.id, workspace.host, changesMode) : null);
  const workspacePr = (() => {
    const p = changes.data?.pr;
    if (p?.repo) return { repo: p.repo, number: p.number };
    return prOf(p?.url) ?? prOf(workspace?.pr?.url);
  })();

  // Opened from elsewhere (a PR link, the workspace's Changes, Activity).
  useEffect(
    () =>
      onAppCommand("github-open", (arg) => {
        go(checkPlace(arg));
      }),
    [go],
  );

  // The view's size: the sidebar's width is kept, within what leaves the main column room.
  const [view, setView] = useState<HTMLElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    if (!view) return;
    const watch = new ResizeObserver(() => setViewWidth(view.clientWidth));
    watch.observe(view);
    return () => watch.disconnect();
  }, [view]);
  const [sidebarWidth, setSidebarWidth] = useState(() => readStore<number>("github:sidebarWidth", PANELS.sidebar));
  const sidebarMax = Math.max(PANELS.sidebarMin, (viewWidth || 1600) - PANELS.mainMin);
  const sidebarW = Math.round(Math.min(sidebarMax, Math.max(PANELS.sidebarMin, sidebarWidth)));
  const resizeSidebar = (w: number | null) => {
    const next = w === null ? PANELS.sidebar : Math.round(Math.min(sidebarMax, Math.max(PANELS.sidebarMin, w)));
    setSidebarWidth(next);
    writeStore("github:sidebarWidth", next);
  };

  const external = useCallback((url: string) => {
    // Conquer, as a new tab (direct: not back to this tab); a browser opens it in another.
    if (macApp()) postAppLink(url, true);
    else window.open(url, "_blank", "noopener");
  }, []);

  const diffHandle = useRef<DiffViewHandle | null>(null);
  const prApi = useRef<PrViewApi | null>(null);
  const listKeys = useRef<((e: KeyboardEvent | React.KeyboardEvent) => boolean) | null>(null);
  const [openPr, setOpenPr] = useState<{ pr?: PrDetail; pending: number }>({ pending: 0 });
  const onPrLoaded = useCallback((pr: PrDetail | undefined, pending: number) => setOpenPr({ pr, pending }), []);

  const setTab = useCallback(
    (tab: PrTab) => setPlaceState((was) => (was.kind === "pr" && was.tab !== tab ? (writePlace({ ...was, tab }), { ...was, tab }) : was)),
    [],
  );
  const openRow = useCallback((repo: string, number: number, tab: PrTab = "conversation") => go({ kind: "pr", repo, number, tab }), [go]);

  const diffShown = place.kind === "changes" || (place.kind === "pr" && place.tab === "files");
  const toggleViewed = () => {
    const path = diffHandle.current?.current();
    const pr = openPr.pr;
    if (!path || !pr || place.kind !== "pr") return;
    const on = pr.files.find((f) => f.path === path)?.viewed !== "viewed";
    // Through the view's own toggle, so the file folds as a click would.
    const box = view?.querySelector<HTMLInputElement>(`.gd-file[data-path="${CSS.escape(path)}"] .gd-viewed input`);
    if (box) box.click();
    else if (on) diffHandle.current?.step(1);
  };
  const cycleMode = () => setChangesMode(CHANGES_MODES[(CHANGES_MODES.indexOf(changesMode) + 1) % CHANGES_MODES.length]!);
  const refresh = () => invalidate("github/q/", "changes?");

  // ⌘K's commands.
  const current = useRef({ place, layout, listShown, diffShown, toggleViewed, cycleMode, setTab, back, refresh, external, openPr, workspacePr });
  current.current = { place, layout, listShown, diffShown, toggleViewed, cycleMode, setTab, back, refresh, external, openPr, workspacePr };
  useEffect(() => {
    const c = () => current.current;
    const offs = [
      onAppCommand("github-go", (arg) => go(checkPlace(arg))),
      onAppCommand("github-refresh", () => c().refresh()),
      onAppCommand("github-back", () => c().back()),
      onAppCommand("github-tab", (arg) => {
        if (PR_TABS.includes(arg as PrTab)) c().setTab(arg as PrTab);
      }),
      onAppCommand("github-layout", () => setLayout(c().layout === "split" ? "unified" : "split")),
      onAppCommand("github-files", () => setListShown(!c().listShown)),
      onAppCommand("github-review", (arg) => {
        if (c().place.kind !== "pr") return;
        prApi.current?.openReview(arg === "APPROVE" || arg === "REQUEST_CHANGES" || arg === "COMMENT" ? (arg as ReviewEvent) : undefined);
      }),
      onAppCommand("github-comment", () => prApi.current?.focusComment()),
      onAppCommand("github-next-file", () => diffHandle.current?.step(1)),
      onAppCommand("github-prev-file", () => diffHandle.current?.step(-1)),
      onAppCommand("github-viewed", () => c().toggleViewed()),
      onAppCommand("github-changes-mode", (arg) => {
        if (CHANGES_MODES.includes(arg as ChangesMode)) setChangesMode(arg as ChangesMode);
        else c().cycleMode();
      }),
      onAppCommand("github-open-browser", () => {
        const { place, openPr } = c();
        if (place.kind === "pr" && openPr.pr) c().external(openPr.pr.url);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [go]);

  useEffect(() => {
    const pr = place.kind === "pr" ? openPr.pr : undefined;
    onViewState?.({
      place,
      layout,
      listShown,
      diff: diffShown,
      changesMode,
      canBack: place.kind === "pr",
      ...(pr
        ? {
            pr: {
              repo: pr.repo,
              number: pr.number,
              url: pr.url,
              title: pr.title,
              viewerIsAuthor: pr.viewerIsAuthor,
              open: pr.state === "open" || pr.state === "draft",
              pending: openPr.pending,
            },
          }
        : {}),
      ...(workspacePr ? { workspacePr } : {}),
    });
  }, [place, layout, listShown, diffShown, changesMode, openPr, workspacePr?.repo, workspacePr?.number, onViewState]);
  useEffect(() => () => onViewState?.(undefined), [onViewState]);

  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || !e.key || modalOpen() || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(target)) return;
    const key = e.key;
    const lower = key.toLowerCase();
    const onButton = !!target.closest("button,a,[role=button],input,label");
    let handled = true;
    if (place.kind === "prs" && !(key === "Enter" && onButton) && listKeys.current?.(e)) handled = true;
    else if (diffShown && (lower === "j" || key === "ArrowDown") && !onButton) diffHandle.current?.step(1);
    else if (diffShown && (lower === "k" || key === "ArrowUp") && !onButton) diffHandle.current?.step(-1);
    else if (diffShown && lower === "u") setLayout(layout === "split" ? "unified" : "split");
    else if (diffShown && lower === "f") setListShown(!listShown);
    else if (place.kind === "pr" && place.tab === "files" && lower === "v") toggleViewed();
    else if (place.kind === "changes" && lower === "m") cycleMode();
    else if (place.kind === "pr" && /^[1-4]$/.test(key)) setTab(PR_TABS[Number(key) - 1]!);
    else if (place.kind === "pr" && lower === "r") prApi.current?.openReview();
    else if (place.kind === "pr" && lower === "c") prApi.current?.focusComment();
    else if (key === "Escape") {
      // Esc stops here: the page's own would clear the map's (hidden) selection.
      if (place.kind === "pr") back();
    } else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (/^[a-z]$/i.test(key) || key.startsWith("Arrow")) e.stopPropagation();
  };

  const navItem = (key: string, selected: boolean, icon: ReactNode, label: ReactNode, hint: string, onClick: () => void, count?: number, disabled = false) => (
    <button
      key={key}
      className={`gh-nav-item${selected ? " selected" : ""}`}
      aria-current={selected ? "page" : undefined}
      data-tip={hint}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="gh-nav-label">{label}</span>
      {count !== undefined && count > 0 && <span className="gh-count">{count}</span>}
    </button>
  );

  const fileCount = changes.data?.files.length;
  const listTitle = from?.kind === "prs" ? SCOPE_TITLE[from.scope] : from?.kind === "changes" ? "Changes" : SCOPE_TITLE.review;

  let main: ReactNode;
  if (place.kind === "changes")
    main = (
      <ChangesView
        workspace={workspace}
        mode={changesMode}
        setMode={setChangesMode}
        layout={layout}
        setLayout={setLayout}
        listShown={listShown}
        setListShown={setListShown}
        onOpenPr={(repo, number) => openRow(repo, number, "files")}
        onExternal={external}
        handle={diffHandle}
      />
    );
  else if (place.kind === "prs") main = <PrList scope={place.scope} onOpen={(row) => openRow(row.repo, row.number)} keys={listKeys} />;
  else
    main = (
      <PrView
        key={`${place.repo}#${place.number}`}
        repo={place.repo}
        number={place.number}
        tab={place.tab}
        setTab={setTab}
        layout={layout}
        setLayout={setLayout}
        listShown={listShown}
        setListShown={setListShown}
        onBack={back}
        backLabel={listTitle}
        onExternal={external}
        onNotice={onNotice}
        diffHandle={diffHandle}
        api={prApi}
        onLoaded={onPrLoaded}
      />
    );

  return (
    <section
      className="github-view"
      aria-label="GitHub"
      ref={setView}
      style={{ gridTemplateColumns: `${sidebarW}px minmax(0, 1fr)` }}
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <nav className="gh-sidebar" id="github-sidebar" aria-label="GitHub places">
          <div className="gh-sidebar-head">
            <h2>GitHub</h2>
            <button className="icon-btn" aria-label="Refresh GitHub" data-tip="Refresh" onClick={refresh}>
              <RefreshCw size={13} aria-hidden="true" />
            </button>
          </div>
          <div className="gh-nav">
            <h3>Workspace</h3>
            {navItem(
              "changes",
              place.kind === "changes",
              <GitBranch size={14} aria-hidden="true" />,
              workspace ? workspace.name : "Changes",
              workspace ? `${workspace.name}'s branch against main` : "Select a workspace to see its changes",
              () => go({ kind: "changes" }),
              fileCount,
            )}
            {workspacePr &&
              navItem(
                "workspace-pr",
                place.kind === "pr" && place.repo === workspacePr.repo && place.number === workspacePr.number,
                <GitPullRequestArrow size={14} aria-hidden="true" />,
                `Its pull request #${workspacePr.number}`,
                "Review the workspace's pull request",
                () => openRow(workspacePr.repo, workspacePr.number, "files"),
              )}
            <h3>Pull requests</h3>
            {PR_SCOPES.map((scope) => {
              const Icon = SCOPE_ICON[scope];
              return navItem(
                scope,
                place.kind === "prs" && place.scope === scope,
                <Icon size={14} aria-hidden="true" />,
                SCOPE_TITLE[scope],
                SCOPE_HINT[scope],
                () => go({ kind: "prs", scope }),
                counts[scope],
              );
            })}
            {place.kind === "pr" &&
              !(workspacePr && place.repo === workspacePr.repo && place.number === workspacePr.number) &&
              navItem(
                "open-pr",
                true,
                <GitPullRequest size={14} aria-hidden="true" />,
                `${place.repo.split("/")[1]}#${place.number}`,
                `${place.repo}#${place.number}`,
                () => {},
              )}
          </div>
          {!!viewer.data?.missingScopes?.length && (
            <div className="gh-scopes" role="status">
              <p>
                The GitHub token lacks {viewer.data.missingScopes.join(", ")}, so some of this tab won’t work.
              </p>
              <button className="secondary" onClick={createGithubToken}>
                Create a new token
              </button>
            </div>
          )}
          {(viewer.data || viewer.unavailable) && (
            <p className="gh-sidebar-foot">
              {viewer.data ? (
                <>
                  <Avatar person={viewer.data.viewer} size={18} />
                  <span>{viewer.data.viewer.login}</span>
                </>
              ) : (
                <span className="gh-hint">{viewer.unavailable}</span>
              )}
            </p>
          )}
          <ResizeEdge
            label="Resize the GitHub sidebar"
            controls="github-sidebar"
            value={sidebarW}
            min={PANELS.sidebarMin}
            max={sidebarMax}
            grows="right"
            onResize={resizeSidebar}
            onReset={() => resizeSidebar(null)}
          />
      </nav>
      <div className="gh-main">{main}</div>
    </section>
  );
}
