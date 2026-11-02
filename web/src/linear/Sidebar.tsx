import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AtSign,
  Bell,
  Box,
  ChevronRight,
  CircleDashed,
  CircleDot,
  Inbox,
  ListTodo,
  LoaderCircle,
  PanelLeftClose,
  PenLine,
  SquarePen,
  RefreshCcw,
  RefreshCw,
  Search,
  Target,
  Trash2,
  Pencil,
} from "lucide-react";
import { readStore, writeStore } from "../api";
import { unreadCount } from "./inboxRows";
import { menuKeys } from "./ListControls";
import { placeBelow } from "./Picker";
import { ViewIcon } from "./ViewDialog";
import type { LinearCustomView } from "./types";
import { samePlace, type LinearPlace, type TeamTab } from "./place";
import { useLinear } from "./store";

const TEAM_TABS: { tab: TeamTab; label: string; icon: ReactNode }[] = [
  { tab: "triage", label: "Triage", icon: <ArrowDownToLine size={14} aria-hidden="true" /> },
  { tab: "active", label: "Active", icon: <CircleDot size={14} aria-hidden="true" /> },
  { tab: "backlog", label: "Backlog", icon: <CircleDashed size={14} aria-hidden="true" /> },
  { tab: "all", label: "All", icon: <ListTodo size={14} aria-hidden="true" /> },
];

function Item({
  place,
  current,
  onPlace,
  icon,
  children,
  onMenu,
  disabled,
}: {
  place: LinearPlace;
  current: LinearPlace;
  onPlace: (p: LinearPlace) => void;
  icon: ReactNode;
  children: ReactNode;
  /** Right-click (or the context-menu key): its menu, at that point. */
  onMenu?: (at: { x: number; y: number }) => void;
  disabled?: boolean;
}) {
  const here = samePlace(place, current);
  return (
    <button
      className={`linear-nav-item${here ? " selected" : ""}`}
      aria-current={here ? "page" : undefined}
      disabled={disabled}
      onClick={() => onPlace(place)}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const keyed = e.clientX === 0 && e.clientY === 0;
          onMenu(keyed ? { x: r.left + 24, y: r.bottom } : { x: e.clientX, y: e.clientY });
        })
      }
    >
      {icon}
      <span className="linear-nav-label">{children}</span>
    </button>
  );
}

/** A view's place: a list of its issues, or of its projects. */
export const viewPlace = (view: Pick<LinearCustomView, "id" | "model">): LinearPlace =>
  view.model === "project" ? { screen: "projectView", viewId: view.id } : { screen: "view", viewId: view.id };

/** A view row's menu: Edit view…, Delete view…. */
function ViewMenu({
  view,
  at,
  onEdit,
  onDelete,
  onClose,
}: {
  view: LinearCustomView;
  at: { x: number; y: number };
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const menu = useRef<HTMLDivElement | null>(null);
  const place = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [onClose]);
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return createPortal(
    <span className="menu-anchor linear-row-menu-anchor" style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 220)), top: at.y }}>
      <div
        ref={place}
        role="menu"
        aria-label={`${view.name} view`}
        className="popover-menu left linear-row-menu"
        onKeyDown={(e) => menuKeys(e, onClose)}
        onBlur={(e) => {
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) onClose();
        }}
      >
        <button role="menuitem" tabIndex={-1} onClick={run(onEdit)}>
          <Pencil size={13} aria-hidden="true" />
          Edit view…
        </button>
        <button role="menuitem" tabIndex={-1} className="danger-item" onClick={run(onDelete)}>
          <Trash2 size={13} aria-hidden="true" />
          Delete view…
        </button>
      </div>
    </span>,
    document.body,
  );
}

/**
 * The Linear view's navigation, as Linear's own sidebar: your Inbox (its
 * unread count), your issues, each
 * team's views (Triage only where the team triages, Cycles where it runs
 * them), your saved views (of issues, and of projects, marked; a project's
 * own views are under the project), projects and initiatives. A view's
 * context menu edits or deletes it.
 * Teams open and close; which are open is remembered.
 */
export function Sidebar({
  place,
  onPlace,
  onHide,
  onRefresh,
  refreshing,
  onCreate,
  onSearch,
  onBack,
  onForward,
  onEditView,
  onDeleteView,
}: {
  place: LinearPlace;
  onPlace: (p: LinearPlace) => void;
  onHide: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  /** Create issue, in the place's team; absent until the workspace is in. */
  onCreate?: () => void;
  /** Search the whole workspace. */
  onSearch: () => void;
  /** Back and forward through where the tab has been; absent when there's nowhere to go. */
  onBack?: () => void;
  onForward?: () => void;
  onEditView: (viewId: string) => void;
  onDeleteView: (viewId: string) => void;
}) {
  const teams = useLinear((d) => d.workspace?.teams);
  const allViews = useLinear((d) => d.views);
  const views = allViews?.filter((v) => !v.projectId);
  // A project's own view is one of the project's places.
  const ownView = place.screen === "view" ? allViews?.find((v) => v.id === place.viewId && v.projectId) : undefined;
  const [menu, setMenu] = useState<{ view: LinearCustomView; at: { x: number; y: number } }>();
  const closeMenu = useCallback(() => setMenu(undefined), []);
  // Unread Inbox rows; snoozes that run out count from the next change.
  const unread = useLinear((d) => (d.notificationsLoaded ? unreadCount(d.notifications.values(), Date.now()) : 0));
  const [open, setOpen] = useState<string[]>(() => {
    const was = readStore<string[]>("linear:teamsOpen", []);
    // The team you're in starts open.
    return "teamId" in place && !was.includes(place.teamId) ? [...was, place.teamId] : was;
  });
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = was.includes(id) ? was.filter((t) => t !== id) : [...was, id];
      writeStore("linear:teamsOpen", next);
      return next;
    });
  const item = (p: LinearPlace, icon: ReactNode, label: string) => (
    <Item place={p} current={place} onPlace={onPlace} icon={icon}>
      {label}
    </Item>
  );
  return (
    <>
      <header className="linear-sidebar-head">
        <h2>Linear</h2>
        <button className="icon-btn" aria-label="Go back" data-tip="Back (⌘[)" disabled={!onBack} onClick={onBack}>
          <ArrowLeft size={14} aria-hidden="true" />
        </button>
        <button className="icon-btn" aria-label="Go forward" data-tip="Forward (⌘])" disabled={!onForward} onClick={onForward}>
          <ArrowRight size={14} aria-hidden="true" />
        </button>
        <button
          className="icon-btn"
          aria-label="Search Linear"
          aria-pressed={place.screen === "search"}
          data-tip="Search all issues"
          onClick={onSearch}
        >
          <Search size={14} aria-hidden="true" />
        </button>
        <button
          className="icon-btn"
          aria-label="New issue"
          data-tip="Create an issue"
          disabled={!onCreate}
          onClick={onCreate}
        >
          <SquarePen size={14} aria-hidden="true" />
        </button>
        <button
          className="icon-btn"
          aria-label="Refresh"
          data-tip="Ask Linear again"
          disabled={refreshing}
          onClick={onRefresh}
        >
          {refreshing ? (
            <LoaderCircle size={14} className="spinning" aria-hidden="true" />
          ) : (
            <RefreshCw size={14} aria-hidden="true" />
          )}
        </button>
        <button
          className="icon-btn"
          aria-label="Hide the Linear sidebar"
          data-tip="Hide the sidebar (⌘S)"
          onClick={onHide}
        >
          <PanelLeftClose size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="linear-nav">
        <section aria-label="Inbox" className="linear-nav-top">
          <Item place={{ screen: "inbox" }} current={place} onPlace={onPlace} icon={<Inbox size={14} aria-hidden="true" />}>
            Inbox
            {unread > 0 && (
              <span className="linear-nav-badge" aria-label={`${unread} unread`}>
                {unread}
              </span>
            )}
          </Item>
        </section>
        <section aria-labelledby="linear-nav-my">
          <h3 id="linear-nav-my">My issues</h3>
          {item({ screen: "my", tab: "assigned" }, <AtSign size={14} aria-hidden="true" />, "Assigned")}
          {item({ screen: "my", tab: "created" }, <PenLine size={14} aria-hidden="true" />, "Created")}
          {item({ screen: "my", tab: "subscribed" }, <Bell size={14} aria-hidden="true" />, "Subscribed")}
        </section>
        <section aria-labelledby="linear-nav-teams">
          <h3 id="linear-nav-teams">Teams</h3>
          {!teams && <p className="linear-nav-note">Loading…</p>}
          {teams?.map((team) => {
            const expanded = open.includes(team.id);
            return (
              <div key={team.id} className="linear-team" data-team={team.key}>
                <button
                  className="linear-nav-item linear-nav-team"
                  aria-expanded={expanded}
                  onClick={() => toggle(team.id)}
                >
                  <span className="linear-team-key">{team.key}</span>
                  <span className="linear-nav-label">{team.name}</span>
                  <ChevronRight size={12} className="linear-nav-chevron" aria-hidden="true" />
                </button>
                {expanded && (
                  <div className="linear-team-tabs">
                    {TEAM_TABS.filter((t) => t.tab !== "triage" || team.triageEnabled).map((t) => (
                      <Item
                        key={t.tab}
                        place={{ screen: "team", teamId: team.id, tab: t.tab }}
                        current={place}
                        onPlace={onPlace}
                        icon={t.icon}
                      >
                        {t.label}
                      </Item>
                    ))}
                    {team.cyclesEnabled && (
                      <Item
                        place={{ screen: "cycles", teamId: team.id }}
                        // A cycle's issues are under Cycles.
                        current={place.screen === "cycle" ? { screen: "cycles", teamId: place.teamId } : place}
                        onPlace={onPlace}
                        icon={<RefreshCcw size={14} aria-hidden="true" />}
                      >
                        Cycles
                      </Item>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
        {views && views.length > 0 && (
          <section aria-labelledby="linear-nav-views">
            <h3 id="linear-nav-views">Views</h3>
            {views.map((v) => (
              <Item
                key={v.id}
                place={viewPlace(v)}
                current={place}
                onPlace={onPlace}
                icon={<ViewIcon view={v} />}
                disabled={v.id.startsWith("pending-")}
                onMenu={v.id.startsWith("pending-") ? undefined : (at) => setMenu({ view: v, at })}
              >
                {v.name}
                {v.model === "project" && (
                  <span className="linear-nav-kind" aria-label="(project view)" data-tip="A view of projects">
                    <Box size={11} aria-hidden="true" />
                  </span>
                )}
              </Item>
            ))}
          </section>
        )}
        <section aria-label="Workspace">
          <Item
            place={{ screen: "projects" }}
            current={place.screen === "project" || ownView ? { screen: "projects" } : place}
            onPlace={onPlace}
            icon={<Box size={14} aria-hidden="true" />}
          >
            Projects
          </Item>
          {item({ screen: "initiatives" }, <Target size={14} aria-hidden="true" />, "Initiatives")}
        </section>
      </div>
      {menu && (
        <ViewMenu
          view={menu.view}
          at={menu.at}
          onEdit={() => onEditView(menu.view.id)}
          onDelete={() => onDeleteView(menu.view.id)}
          onClose={closeMenu}
        />
      )}
    </>
  );
}
