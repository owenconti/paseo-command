import { useCallback, useEffect, useRef, useState } from "react";
import { Box, ChevronRight, ListTodo, PanelLeftOpen, RefreshCw } from "lucide-react";
import { errorMessage, readStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { InitiativeList } from "./InitiativeList";
import { IssueDetail } from "./IssueDetail";
import { IssueList } from "./IssueList";
import { checkPlace, placeScope, readPlace, writePlace, type LinearPlace } from "./place";
import { ProjectFacts, ProjectList } from "./ProjectList";
import type { IssueContext } from "./prompt";
import { Sidebar } from "./Sidebar";
import { loadScope, loadWorkspace, setLinearNotice, useLinear, useLinearSync } from "./store";
import type { IssueScope } from "./types";

/** The sidebar's width: its default, and the least it and the rest of the view keep. */
const LIST = { width: 320, min: 200, detailMin: 320 };
const listMax = (viewWidth: number) => Math.max(LIST.min, viewWidth - LIST.detailMin);
const clampList = (width: number, viewWidth: number) =>
  Math.round(Math.min(listMax(viewWidth), Math.max(LIST.min, width)));
/** From this width the open issue shows beside the list; narrower, in its place. */
const BESIDE_MIN = 1100;

const MY_TITLE = { assigned: "Assigned to you", created: "Created by you", subscribed: "Subscribed" };
const TEAM_TITLE = { triage: "Triage", active: "Active", backlog: "Backlog", all: "All issues" };

/**
 * The Linear tab, in the map's place (the macOS app's mode bar): Linear's
 * navigation in a sidebar (your issues, each team's views, projects,
 * initiatives), the place's list, and the open issue beside it (or in its
 * place when narrow), from which an agent can be launched. Everything shows
 * from the page's Linear store, kept current by sync while the view shows.
 * An issue's properties are edited in place (the detail's pickers, a row's
 * context menu), saved to Linear at once. As Conquer's tab sidebar, the
 * sidebar's inner edge resizes it and ⌘S hides or shows it (both remembered),
 * and the place comes back after a reload.
 */
export function LinearView({
  onLaunch,
  onNotice,
  onIssueOpen,
}: {
  onLaunch: (issue: IssueContext) => void;
  onNotice: (message: string) => void;
  /** Whether an issue is open (⌘K offers editing it). */
  onIssueOpen?: (open: boolean) => void;
}) {
  useLinearSync(true);
  // A write Linear refuses says why in the app's notice.
  useEffect(() => setLinearNotice(onNotice), [onNotice]);
  const ws = useLinear((d) => d.workspace);
  const unavailable = useLinear((d) => d.unavailable);
  const loadedScopes = useLinear((d) => d.loadedScopes);
  const [place, setPlaceState] = useState<LinearPlace>(() => readPlace());
  const setPlace = useCallback((next: LinearPlace) => {
    setPlaceState(next);
    writePlace(next);
  }, []);
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [scopeErrors, setScopeErrors] = useState<Partial<Record<IssueScope, string>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  const [view, setView] = useState<HTMLElement | null>(null);
  const [listWidth, setListWidth] = useState(() => readStore("linear:listWidth", LIST.width));
  const [listHidden, setListHidden] = useState(() => readStore("linear:listHidden", false));
  const [viewWidth, setViewWidth] = useState(0);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const width = viewWidth ? clampList(listWidth, viewWidth) : listWidth;
  const resizeTo = (next: number) => {
    const w = viewWidth ? clampList(next, viewWidth) : next;
    setListWidth(w);
    writeStore("linear:listWidth", w);
  };
  const toggleList = () =>
    setListHidden((hidden) => {
      writeStore("linear:listHidden", !hidden);
      return !hidden;
    });

  const loadWs = useCallback(
    (fresh: boolean) =>
      loadWorkspace(fresh).then(
        () => setWorkspaceError(undefined),
        (e) => {
          setWorkspaceError(errorMessage(e));
          throw e;
        },
      ),
    [],
  );
  const loadPlace = useCallback((scope: IssueScope, fresh: boolean) => {
    setScopeErrors(({ [scope]: _, ...rest }) => rest as Partial<Record<IssueScope, string>>);
    return loadScope(scope, fresh).catch((e) => {
      setScopeErrors((was) => ({ ...was, [scope]: errorMessage(e) }));
      throw e;
    });
  }, []);

  useEffect(() => {
    loadWs(false).catch(() => {});
  }, [loadWs]);
  // Once the workspace is in, a remembered team or project it doesn't have goes back to the default.
  useEffect(() => {
    if (!ws) return;
    setPlaceState((was) => {
      const checked = checkPlace(was, ws);
      if (JSON.stringify(checked) === JSON.stringify(was)) return was;
      writePlace(checked);
      return checked;
    });
  }, [ws]);
  const scope = placeScope(place);
  useEffect(() => {
    if (scope) loadPlace(scope, false).catch(() => {});
  }, [scope, loadPlace]);

  const refresh = () => {
    setRefreshing(true);
    setRevision((r) => r + 1);
    // The open issue is asked for again by its view, as `revision` changes.
    Promise.all([loadWs(true), scope ? loadPlace(scope, true) : undefined])
      .catch((e) => onNotice(`Couldn’t refresh Linear: ${errorMessage(e)}`))
      .finally(() => setRefreshing(false));
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => onAppCommand("linear-refresh", () => refreshRef.current()), []);

  useEffect(() => {
    if (!view) return;
    const watch = new ResizeObserver(() => setViewWidth(view.clientWidth));
    watch.observe(view);
    return () => watch.disconnect();
  }, [view]);
  // ⌘S, as in Conquer: while Linear shows, the page has the key.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toggleList();
      }
    };
    window.addEventListener("keydown", key);
    const off = onAppCommand("linear-sidebar", toggleList);
    return () => {
      window.removeEventListener("keydown", key);
      off();
    };
  }, []);

  const issueOpen = !!place.issue && !!ws;
  useEffect(() => {
    onIssueOpen?.(issueOpen);
  }, [issueOpen, onIssueOpen]);
  useEffect(() => () => onIssueOpen?.(false), [onIssueOpen]);

  if (!ws && (unavailable || workspaceError))
    return (
      <section className="linear-view linear-unavailable" aria-label="Linear" ref={setView}>
        <ListTodo size={28} strokeWidth={1.5} aria-hidden="true" />
        <h2>{unavailable ? "Linear isn’t connected" : "Linear didn’t answer"}</h2>
        <p>{unavailable?.reason ?? workspaceError}</p>
        <button className="secondary" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={12} aria-hidden="true" />
          Try again
        </button>
      </section>
    );

  const beside = viewWidth === 0 || viewWidth >= BESIDE_MIN;
  const openIssue = place.issue;
  const open = (key: string) => setPlace({ ...place, issue: key });
  const close = () => {
    const { issue: _, ...rest } = place;
    setPlace(rest as LinearPlace);
  };
  const openProject = (projectId: string) => setPlace({ screen: "project", projectId });
  const showList = !openIssue || beside;
  const team = place.screen === "team" ? ws?.teams.find((t) => t.id === place.teamId) : undefined;
  const project = place.screen === "project" ? ws?.projects.find((p) => p.id === place.projectId) : undefined;

  const main = () => {
    if (place.screen === "projects") return <ProjectList onProject={openProject} />;
    if (place.screen === "initiatives") return <InitiativeList onProject={openProject} />;
    const title =
      place.screen === "my" ? (
        MY_TITLE[place.tab]
      ) : place.screen === "team" ? (
        <>
          <span className="linear-crumb">{team?.name ?? "Team"}</span>
          <ChevronRight size={14} className="linear-crumb-sep" aria-hidden="true" />
          {TEAM_TITLE[place.tab]}
        </>
      ) : (
        <>
          <button className="link-btn linear-crumb" onClick={() => setPlace({ screen: "projects" })}>
            Projects
          </button>
          <ChevronRight size={14} className="linear-crumb-sep" aria-hidden="true" />
          {project?.name ?? "Project"}
        </>
      );
    return (
      <IssueList
        title={title}
        scope={scope!}
        openKey={openIssue}
        onOpen={open}
        opensBeside={beside}
        loading={!loadedScopes.has(scope!) && !scopeErrors[scope!]}
        error={scopeErrors[scope!]}
      >
        {project && (
          <div className="linear-project-summary">
            <Box size={14} style={{ color: project.color }} aria-hidden="true" />
            <ProjectFacts project={project} ws={ws} />
          </div>
        )}
      </IssueList>
    );
  };

  const columns = [
    listHidden ? null : `${width}px`,
    showList ? "minmax(0, 1fr)" : null,
    openIssue ? (showList ? "minmax(360px, 1.2fr)" : "minmax(0, 1fr)") : null,
  ].filter(Boolean);
  return (
    <section
      className={`linear-view${listHidden ? " sidebar-hidden" : ""}${showList ? "" : " issue-only"}`}
      aria-label="Linear"
      ref={setView}
      style={{ gridTemplateColumns: columns.join(" ") }}
    >
      <nav className="linear-sidebar" id="linear-sidebar" aria-label="Linear navigation" hidden={listHidden}>
        <Sidebar
          place={place}
          onPlace={setPlace}
          onHide={toggleList}
          onRefresh={refresh}
          refreshing={refreshing}
        />
        <div
          className="linear-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the Linear sidebar"
          aria-controls="linear-sidebar"
          aria-valuemin={LIST.min}
          aria-valuemax={viewWidth ? listMax(viewWidth) : undefined}
          aria-valuenow={width}
          aria-description="Drag, or use the arrow keys, to change the sidebar's width. Shift resizes faster; double-click restores the default."
          tabIndex={0}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { x: e.clientX, width };
          }}
          onPointerMove={(e) => {
            if (drag.current) resizeTo(drag.current.width + e.clientX - drag.current.x);
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          onLostPointerCapture={() => (drag.current = null)}
          onDoubleClick={() => resizeTo(LIST.width)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            resizeTo(width + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 64 : 16));
          }}
        />
      </nav>
      {listHidden && (
        <button
          className="icon-btn linear-show-list"
          aria-label="Show the Linear sidebar"
          data-tip="Show the sidebar (⌘S)"
          onClick={toggleList}
        >
          <PanelLeftOpen size={14} aria-hidden="true" />
        </button>
      )}
      {showList && (
        <div className="linear-main">
          {unavailable && (
            <p className="linear-banner" role="status">
              {unavailable.reason}
              {unavailable.retryAt ? ` Trying again ${new Date(unavailable.retryAt).toLocaleTimeString()}.` : ""}
            </p>
          )}
          {main()}
        </div>
      )}
      {openIssue && (
        <IssueDetail
          key={openIssue}
          issueKey={openIssue}
          onOpen={open}
          onClose={close}
          closeLabel={showList ? "Close" : "Back"}
          onLaunch={onLaunch}
          revision={revision}
        />
      )}
    </section>
  );
}
