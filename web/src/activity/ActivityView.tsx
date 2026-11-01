import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  Bell,
  Box,
  Check,
  CheckCheck,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDot,
  ExternalLink,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Github,
  Inbox,
  ListChecks,
  ListX,
  ListTodo,
  Mail,
  MailOpen,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  Slack,
  Tag,
} from "lucide-react";
import { readStore, removeStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { ResizeEdge } from "../ResizeEdge";
import { modalOpen } from "../focus";
import { isTyping } from "../worldShortcut";
import { canOpen, openActivityItem } from "./open";
import { filterItems, groupByDay, isFilter, shortAgo, SOURCE_LABEL, whatHappened, type ActivityFilter } from "./rows";
import { canUnread, loadActivity, setActivityNotice, useActivity, useActivityPoll, writeItems } from "./store";
import type { ActivityItem, ActivitySource } from "./types";
import "./activity.css";

/** From this width the selected item's preview shows beside the feed. */
const PREVIEW_MIN = 1100;
/** The panels' widths: the sidebar's default and least, the preview's least, and the least the feed keeps between them. */
const PANELS = { sidebar: 220, sidebarMin: 170, previewMin: 320, feedMin: 360 };
const SOURCES: ActivitySource[] = ["github", "linear", "slack"];
const FILTER_KEYS: Record<string, ActivityFilter> = { "1": "all", "2": "github", "3": "linear", "4": "slack" };

/** What ⌘K needs to know: the unread count, the selected item and what it allows, and the filter. */
export type ActivityViewState = {
  unread: number;
  /** How many items the feed shows (Mark all done takes them). */
  shown: number;
  selected?: { key: string; unread: boolean; source: ActivitySource; canUnread: boolean };
  filter: ActivityFilter;
};

const SOURCE_ICON: Record<ActivitySource, typeof Github> = { github: Github, linear: ListTodo, slack: Slack };

export function SourceIcon({ source, size = 14 }: { source: ActivitySource; size?: number }) {
  const Icon = SOURCE_ICON[source];
  return <Icon size={size} aria-hidden="true" className={`activity-source-icon ${source}`} />;
}

/** The subject's icon, in its state's colour where known (open, merged, closed, draft). */
function SubjectIcon({ item }: { item: ActivityItem }) {
  const state = item.state;
  let Icon = Circle;
  switch (item.subject) {
    case "pull":
      Icon =
        state === "merged" ? GitMerge : state === "closed" ? GitPullRequestClosed : state === "draft" ? GitPullRequestDraft : GitPullRequest;
      break;
    case "issue":
      Icon = item.source === "github" ? (state === "closed" ? CircleCheck : CircleDot) : Circle;
      break;
    case "release":
      Icon = Tag;
      break;
    case "discussion":
      Icon = MessagesSquare;
      break;
    case "commit":
      Icon = GitCommitHorizontal;
      break;
    case "check":
      Icon = ListChecks;
      break;
    case "project":
      Icon = Box;
      break;
    case "message":
      Icon = MessageSquare;
      break;
    case "alert":
      Icon = CircleAlert;
      break;
    default:
      Icon = Bell;
  }
  const label = state ? `${item.subject} · ${state}` : item.subject;
  return (
    <span className={`activity-subject${state ? ` ${state}` : ""}`} data-tip={label} aria-label={label}>
      <Icon size={14} aria-hidden="true" />
    </span>
  );
}

/** Avatars that didn't load: their initials show instead. */
const noAvatar = new Set<string>();
function Actor({ actor }: { actor?: ActivityItem["actor"] }) {
  const [broken, setBroken] = useState(false);
  if (!actor) return null;
  const initials = actor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const src = actor.avatarUrl?.startsWith("/api/") ? actor.avatarUrl : undefined;
  return (
    <span className="activity-actor" data-tip={actor.name} aria-label={actor.name}>
      {src && !broken && !noAvatar.has(src) ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            noAvatar.add(src);
            setBroken(true);
          }}
        />
      ) : (
        initials
      )}
    </span>
  );
}

/** Where opening an item takes you, in words. */
const openLabel = (item: ActivityItem) =>
  item.open?.kind === "slack" ? "Open in Slack" : item.open ? "Open in Linear" : "Open in Conquer";

/** The selected row, kept while the view comes and goes. */
let lastSelected: string | undefined;

/**
 * The Activity tab, in the map's place (the macOS app's mode bar): GitHub,
 * Linear and Slack notifications in one feed, newest first, grouped by day.
 * The sidebar filters it (All, Unread, each enabled source with its unread
 * count, or why it couldn't answer); the selected item shows beside the feed
 * from 1,100 px with Open, Mark read/unread and Done. Opening takes an item
 * where it lives (Conquer, the Linear tab, the Slack tab) and marks it read.
 * While the keyboard is in the view (not typing): J/K or ↓/↑ move, Enter or O
 * open, U marks read or unread, E or ⌫ marks done, ⇧U marks every shown item
 * read, ⇧E marks every shown item done (after confirming), 1–4 filter All,
 * GitHub, Linear, Slack.
 */
export function ActivityView({
  onNotice,
  onViewState,
}: {
  onNotice: (message: string) => void;
  /** The view's state for ⌘K (undefined once it goes). */
  onViewState?: (state: ActivityViewState | undefined) => void;
}) {
  useActivityPoll(true);
  useEffect(() => {
    setActivityNotice(onNotice);
    return () => setActivityNotice(null);
  }, [onNotice]);
  const feed = useActivity((s) => s.feed);
  const error = useActivity((s) => s.error);
  const loading = useActivity((s) => s.loading);
  const enabled = useActivity((s) => s.enabled);
  const [filter, setFilterState] = useState<ActivityFilter>(() => {
    const kept = readStore<unknown>("activity:filter", "all");
    return isFilter(kept) ? kept : "all";
  });
  const setFilter = useCallback((next: ActivityFilter) => {
    setFilterState(next);
    writeStore("activity:filter", next);
  }, []);

  const sources = feed?.sources ?? [];
  const on = sources.filter((s) => s.enabled);
  // A filter on a source that's off shows everything.
  const shownFilter: ActivityFilter =
    filter === "all" || filter === "unread" || !feed || on.some((s) => s.source === filter) ? filter : "all";
  const items = useMemo(() => filterItems(feed?.items ?? [], shownFilter), [feed, shownFilter]);
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const groups = useMemo(() => groupByDay(items, new Date(tick)), [items, tick]);

  // The selection: kept by key; when it leaves (done), the item that took its place.
  const [selectedKey, setSelectedKey] = useState<string | undefined>(lastSelected);
  const lastIndex = useRef(0);
  const selectedIndex = items.findIndex((i) => i.key === selectedKey);
  const selected: ActivityItem | undefined =
    selectedIndex >= 0 ? items[selectedIndex] : items[Math.min(lastIndex.current, items.length - 1)];
  if (selected) lastIndex.current = items.indexOf(selected);
  useEffect(() => {
    lastSelected = selected?.key;
  }, [selected?.key]);

  const [view, setView] = useState<HTMLElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    if (!view) return;
    const watch = new ResizeObserver(() => setViewWidth(view.clientWidth));
    watch.observe(view);
    return () => watch.disconnect();
  }, [view]);
  const wide = viewWidth === 0 || viewWidth >= PREVIEW_MIN;
  // The sidebar's and the preview's widths: their edges resize them (kept), double-click puts the default back.
  const [sidebarWidth, setSidebarWidth] = useState(() => readStore<number>("activity:sidebarWidth", PANELS.sidebar));
  const [previewWidth, setPreviewWidth] = useState(() => readStore<number | null>("activity:previewWidth", null));
  const sidebarMax = Math.max(PANELS.sidebarMin, (viewWidth || 1600) - PANELS.feedMin - (wide ? PANELS.previewMin : 0));
  const sidebarW = Math.round(Math.min(sidebarMax, Math.max(PANELS.sidebarMin, sidebarWidth)));
  const previewMax = Math.max(PANELS.previewMin, (viewWidth || 1600) - sidebarW - PANELS.feedMin);
  const previewW = previewWidth === null ? null : Math.round(Math.min(previewMax, Math.max(PANELS.previewMin, previewWidth)));
  const resizeSidebar = (w: number | null) => {
    const next = w === null ? PANELS.sidebar : Math.round(Math.min(sidebarMax, Math.max(PANELS.sidebarMin, w)));
    setSidebarWidth(next);
    writeStore("activity:sidebarWidth", next);
  };
  const resizePreview = (w: number | null) => {
    const next = w === null ? null : Math.round(Math.min(previewMax, Math.max(PANELS.previewMin, w)));
    setPreviewWidth(next);
    if (next === null) removeStore("activity:previewWidth");
    else writeStore("activity:previewWidth", next);
  };

  const listRef = useRef<HTMLDivElement>(null);
  const focusRow = (key: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: false });
  const select = (item: ActivityItem, focus = true) => {
    setSelectedKey(item.key);
    if (focus) setTimeout(() => focusRow(item.key), 0);
  };
  const step = (by: number) => {
    if (!items.length) return;
    const at = selected ? items.indexOf(selected) : -1;
    const next = items[Math.min(items.length - 1, Math.max(0, at < 0 ? 0 : at + by))]!;
    select(next);
  };

  const toggleRead = (item: ActivityItem) => {
    if (item.unread) void writeItems("read", [item.key]);
    else if (canUnread(item)) void writeItems("unread", [item.key]);
    else onNotice("GitHub can't mark a notification unread.");
  };
  const done = (item: ActivityItem) => {
    const keyboardHere = !!listRef.current?.contains(document.activeElement);
    void writeItems("done", [item.key]);
    // The keyboard stays on the row that takes its place.
    if (keyboardHere) {
      const at = items.indexOf(item);
      const next = items[at + 1] ?? items[at - 1];
      if (next) select(next);
    }
  };
  const shownUnread = items.filter((i) => i.unread);
  const readAll = () => {
    if (shownUnread.length) void writeItems("read", shownUnread.map((i) => i.key));
  };
  // Mark all done asks first in the head: Done can't be undone here.
  const [confirmAllDone, setConfirmAllDone] = useState(false);
  useEffect(() => setConfirmAllDone(false), [shownFilter]);
  const askAllDone = () => {
    if (items.length) setConfirmAllDone(true);
  };
  const doneAll = () => {
    setConfirmAllDone(false);
    if (items.length) void writeItems("done", items.map((i) => i.key));
  };
  const open = (item: ActivityItem) => {
    setSelectedKey(item.key);
    if (canOpen(item)) openActivityItem(item);
    else if (item.unread) void writeItems("read", [item.key]);
  };

  // ⌘K's commands, on the selected item or the shown ones.
  const current = useRef({ selected, readAll, askAllDone, toggleRead, done, open, filter: shownFilter });
  current.current = { selected, readAll, askAllDone, toggleRead, done, open, filter: shownFilter };
  useEffect(() => {
    const offs = [
      onAppCommand("activity-refresh", () => void loadActivity(true)),
      onAppCommand("activity-filter", (arg) => {
        if (isFilter(arg)) setFilter(arg);
      }),
      onAppCommand("activity-unread-only", () => setFilter(current.current.filter === "unread" ? "all" : "unread")),
      onAppCommand("activity-open", () => {
        const s = current.current.selected;
        if (s) current.current.open(s);
      }),
      onAppCommand("activity-read", () => {
        const s = current.current.selected;
        if (s?.unread) void writeItems("read", [s.key]);
      }),
      onAppCommand("activity-unread", () => {
        const s = current.current.selected;
        if (s && !s.unread && canUnread(s)) void writeItems("unread", [s.key]);
      }),
      onAppCommand("activity-done", () => {
        const s = current.current.selected;
        if (s) current.current.done(s);
      }),
      onAppCommand("activity-read-all", () => current.current.readAll()),
      onAppCommand("activity-done-all", () => current.current.askAllDone()),
    ];
    return () => offs.forEach((off) => off());
  }, [setFilter]);

  const unreadTotal = (feed?.items ?? []).filter((i) => i.unread).length;
  useEffect(() => {
    onViewState?.({
      unread: unreadTotal,
      shown: items.length,
      filter: shownFilter,
      ...(selected
        ? {
            selected: {
              key: selected.key,
              unread: selected.unread,
              source: selected.source,
              canUnread: canUnread(selected),
            },
          }
        : {}),
    });
  }, [unreadTotal, items.length, shownFilter, selected?.key, selected?.unread, selected?.source, onViewState]);
  useEffect(() => () => onViewState?.(undefined), [onViewState]);

  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || !e.key || modalOpen() || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(target)) return;
    const key = e.key;
    const lower = key.toLowerCase();
    const onButton = !!target.closest("button,a,[role=button]") && !target.closest(".activity-row");
    let handled = true;
    if (lower === "j" || key === "ArrowDown") step(1);
    else if (lower === "k" || key === "ArrowUp") step(-1);
    else if ((key === "Enter" && !onButton) || lower === "o") {
      if (selected) open(selected);
    } else if (key === "U" || (lower === "u" && e.shiftKey)) readAll();
    else if (key === "E" || (lower === "e" && e.shiftKey)) askAllDone();
    else if (lower === "u") {
      if (selected) toggleRead(selected);
    } else if (lower === "e" || key === "Backspace" || key === "Delete") {
      if (selected) done(selected);
    } else if (FILTER_KEYS[key]) setFilter(FILTER_KEYS[key]!);
    // Esc stops here: the page's own would clear the map's (hidden) selection.
    else if (key === "Escape") handled = true;
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (/^[a-z]$/i.test(key) || key.startsWith("Arrow")) e.stopPropagation();
  };

  const countOf = (f: ActivityFilter) => filterItems(feed?.items ?? [], f).filter((i) => i.unread).length;
  const navItem = (f: ActivityFilter, label: string, icon: ReactNode, hint: string, note?: ReactNode) => (
    <div key={f}>
      <button
        className={`activity-nav-item${shownFilter === f ? " selected" : ""}`}
        aria-current={shownFilter === f ? "page" : undefined}
        data-tip={hint}
        onClick={() => setFilter(f)}
      >
        {icon}
        <span className="activity-nav-label">{label}</span>
        {feed && countOf(f) > 0 && <span className="activity-count">{countOf(f)}</span>}
      </button>
      {note}
    </div>
  );

  const title =
    shownFilter === "all" ? "All activity" : shownFilter === "unread" ? "Unread" : SOURCE_LABEL[shownFilter];
  const columns = [
    `${sidebarW}px`,
    "minmax(0, 1fr)",
    wide && selected ? (previewW !== null ? `${previewW}px` : `minmax(${PANELS.previewMin}px, 400px)`) : null,
  ].filter(Boolean);

  let body: ReactNode;
  if (!enabled)
    body = (
      <div className="activity-empty">
        <Inbox size={28} strokeWidth={1.5} aria-hidden="true" />
        <h2>Nothing to gather yet</h2>
        <p>Turn on GitHub, Linear or Slack in Settings to see their notifications here.</p>
      </div>
    );
  else if (!feed)
    body = error ? (
      <div className="activity-empty">
        <CircleAlert size={28} strokeWidth={1.5} aria-hidden="true" />
        <h2>Activity didn’t answer</h2>
        <p>{error}</p>
        <button className="secondary" onClick={() => void loadActivity(true)} disabled={loading}>
          <RefreshCw size={12} aria-hidden="true" />
          Try again
        </button>
      </div>
    ) : (
      <p className="activity-note">Loading activity…</p>
    );
  else if (!items.length)
    body = (
      <p className="activity-note">
        {shownFilter === "unread" ? "Nothing unread. You’re all caught up." : "Nothing here. You’re all caught up."}
      </p>
    );
  else
    body = (
      <div ref={listRef} role="listbox" aria-label={`${title}`} className="activity-groups">
        {groups.map((g) => (
          <section key={g.group} className="activity-group" aria-label={g.group}>
            <h3>{g.group}</h3>
            {g.items.map((item) => {
              const isSelected = item === selected;
              return (
                <div
                  key={item.key}
                  data-key={item.key}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  className={`activity-row${item.unread ? " unread" : ""}${isSelected ? " selected" : ""}`}
                  onClick={() => (wide ? select(item, false) : open(item))}
                  onDoubleClick={() => open(item)}
                >
                  <span className="activity-dot" aria-label={item.unread ? "Unread" : undefined} />
                  <SourceIcon source={item.source} />
                  <SubjectIcon item={item} />
                  <span className="activity-text">
                    <span className="activity-title">{item.title}</span>
                    <span className="activity-sub">
                      <span className="activity-what">{whatHappened(item)}</span>
                      {item.subtitle && <span className="activity-subtitle">{item.subtitle}</span>}
                    </span>
                  </span>
                  <Actor actor={item.actor} />
                  <time className="activity-time" dateTime={item.at} title={new Date(item.at).toLocaleString()}>
                    {shortAgo(item.at, tick)}
                  </time>
                  <span className="activity-actions" onClick={(e) => e.stopPropagation()}>
                    {(item.unread || canUnread(item)) && (
                      <button
                        className="icon-btn"
                        tabIndex={-1}
                        aria-label={item.unread ? `Mark ${item.title} read` : `Mark ${item.title} unread`}
                        data-tip={item.unread ? "Mark read (U)" : "Mark unread (U)"}
                        onClick={() => toggleRead(item)}
                      >
                        {item.unread ? <MailOpen size={13} aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      tabIndex={-1}
                      aria-label={`Mark ${item.title} done`}
                      data-tip="Done (E)"
                      onClick={() => done(item)}
                    >
                      <Check size={13} aria-hidden="true" />
                    </button>
                  </span>
                </div>
              );
            })}
          </section>
        ))}
      </div>
    );

  return (
    <section
      className="activity-view"
      aria-label="Activity"
      ref={setView}
      style={{ gridTemplateColumns: columns.join(" ") }}
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <nav className="activity-sidebar" id="activity-sidebar" aria-label="Activity filters">
        <div className="activity-sidebar-head">
          <h2>Activity</h2>
          <button
            className="icon-btn"
            aria-label="Refresh activity"
            data-tip="Refresh"
            disabled={!enabled}
            onClick={() => void loadActivity(true)}
          >
            <RefreshCw size={13} aria-hidden="true" className={loading ? "spinning" : undefined} />
          </button>
        </div>
        <div className="activity-nav">
          {navItem("all", "All", <Inbox size={14} aria-hidden="true" />, "All (1)")}
          {navItem("unread", "Unread", <Bell size={14} aria-hidden="true" />, "Only what's unread")}
          {on.length > 0 && <h3>Sources</h3>}
          {SOURCES.map((source) => {
            const status = on.find((s) => s.source === source);
            if (!status) return null;
            return navItem(
              source,
              SOURCE_LABEL[source],
              <SourceIcon source={source} />,
              `${SOURCE_LABEL[source]} (${SOURCES.indexOf(source) + 2})`,
              !status.ok && (
                <p className="activity-source-reason" role="status">
                  <CircleAlert size={12} aria-hidden="true" />
                  <span>{status.reason ?? `${SOURCE_LABEL[source]} didn't answer.`}</span>
                </p>
              ),
            );
          })}
        </div>
        <ResizeEdge
          label="Resize the activity sidebar"
          controls="activity-sidebar"
          value={sidebarW}
          min={PANELS.sidebarMin}
          max={sidebarMax}
          grows="right"
          onResize={resizeSidebar}
          onReset={() => resizeSidebar(null)}
        />
      </nav>
      <div className="activity-main">
        <header className="activity-head">
          <h2>
            {title}
            {feed && <span className="activity-count">{items.length}</span>}
          </h2>
          {shownUnread.length > 0 && (
            <button className="activity-tool" onClick={readAll} data-tip="Mark all shown read (⇧U)">
              <CheckCheck size={13} aria-hidden="true" />
              Mark all read
            </button>
          )}
          {items.length > 0 &&
            (confirmAllDone ? (
              <span className="activity-confirm" role="group" aria-label="Confirm marking all done">
                <span>
                  Mark {items.length === 1 ? "1 notification" : `all ${items.length}`} done?
                </span>
                <button
                  className="activity-tool danger"
                  autoFocus
                  onClick={doneAll}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      e.stopPropagation();
                      setConfirmAllDone(false);
                    }
                  }}
                >
                  Mark done
                </button>
                <button className="activity-tool" onClick={() => setConfirmAllDone(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button className="activity-tool" onClick={askAllDone} data-tip="Mark all shown done (⇧E)">
                <ListX size={13} aria-hidden="true" />
                Mark all done
              </button>
            ))}
        </header>
        {feed && error && (
          <p className="activity-banner" role="status">
            Couldn’t refresh: {error}
          </p>
        )}
        {body}
        {wide && selected && (
          <ResizeEdge
            label="Resize the preview"
            controls="activity-preview"
            value={previewW ?? view?.querySelector<HTMLElement>(".activity-preview")?.getBoundingClientRect().width ?? 400}
            min={PANELS.previewMin}
            max={previewMax}
            grows="left"
            onResize={resizePreview}
            onReset={() => resizePreview(null)}
          />
        )}
      </div>
      {wide && selected && (
        <aside className="activity-preview" id="activity-preview" aria-label="Selected notification">
          <p className="activity-preview-source">
            <SourceIcon source={selected.source} />
            {SOURCE_LABEL[selected.source]}
            <span aria-hidden="true">·</span>
            {whatHappened(selected)}
          </p>
          <h2>
            <SubjectIcon item={selected} />
            <span>{selected.title}</span>
          </h2>
          {selected.subtitle && <p className="activity-preview-subtitle">{selected.subtitle}</p>}
          <dl className="activity-preview-facts">
            {selected.actor && (
              <>
                <dt>By</dt>
                <dd>
                  <Actor actor={selected.actor} />
                  {selected.actor.name}
                </dd>
              </>
            )}
            {selected.state && (
              <>
                <dt>State</dt>
                <dd className={`activity-state ${selected.state}`}>{selected.state}</dd>
              </>
            )}
            <dt>When</dt>
            <dd>{new Date(selected.at).toLocaleString()}</dd>
            <dt>Status</dt>
            <dd>{selected.unread ? "Unread" : "Read"}</dd>
          </dl>
          <div className="activity-preview-actions">
            {canOpen(selected) && (
              <button className="primary" onClick={() => open(selected)}>
                <ExternalLink size={13} aria-hidden="true" />
                {openLabel(selected)}
              </button>
            )}
            {(selected.unread || canUnread(selected)) && (
              <button className="secondary" onClick={() => toggleRead(selected)}>
                {selected.unread ? <MailOpen size={13} aria-hidden="true" /> : <Mail size={13} aria-hidden="true" />}
                {selected.unread ? "Mark read" : "Mark unread"}
              </button>
            )}
            <button className="secondary" onClick={() => done(selected)}>
              <Check size={13} aria-hidden="true" />
              Done
            </button>
          </div>
          <p className="activity-preview-keys">
            <kbd>O</kbd> open · <kbd>U</kbd> read/unread · <kbd>E</kbd> done
          </p>
        </aside>
      )}
    </section>
  );
}
