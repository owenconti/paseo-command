import { useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  AtSign,
  Bell,
  Box,
  ChevronRight,
  CircleDashed,
  CircleDot,
  Inbox,
  Layers,
  ListTodo,
  LoaderCircle,
  PanelLeftClose,
  PenLine,
  SquarePen,
  RefreshCcw,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import { readStore, writeStore } from "../api";
import { unreadCount } from "./inboxRows";
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
}: {
  place: LinearPlace;
  current: LinearPlace;
  onPlace: (p: LinearPlace) => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  const here = samePlace(place, current);
  return (
    <button
      className={`linear-nav-item${here ? " selected" : ""}`}
      aria-current={here ? "page" : undefined}
      onClick={() => onPlace(place)}
    >
      {icon}
      <span className="linear-nav-label">{children}</span>
    </button>
  );
}

/**
 * The Linear view's navigation, as Linear's own sidebar: your Inbox (its
 * unread count), your issues, each
 * team's views (Triage only where the team triages, Cycles where it runs
 * them), your saved views, projects and initiatives.
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
}) {
  const teams = useLinear((d) => d.workspace?.teams);
  const views = useLinear((d) => d.views);
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
                place={{ screen: "view", viewId: v.id }}
                current={place}
                onPlace={onPlace}
                icon={<Layers size={14} aria-hidden="true" style={{ color: v.color }} />}
              >
                {v.name}
              </Item>
            ))}
          </section>
        )}
        <section aria-label="Workspace">
          <Item
            place={{ screen: "projects" }}
            current={place.screen === "project" ? { screen: "projects" } : place}
            onPlace={onPlace}
            icon={<Box size={14} aria-hidden="true" />}
          >
            Projects
          </Item>
          {item({ screen: "initiatives" }, <Target size={14} aria-hidden="true" />, "Initiatives")}
        </section>
      </div>
    </>
  );
}
