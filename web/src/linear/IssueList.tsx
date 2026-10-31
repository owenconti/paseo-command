import { useCallback, useEffect, useId, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Box, CircleDot, RefreshCcw, Search, SignalHigh, Tag, UserRound, UserX } from "lucide-react";
import { plainText } from "../ui";
import { Dot, Person, Priority, ScreenHead } from "./bits";
import { checkDisplay, DEFAULT_DISPLAY, filterIssues, hasFilters, hasOwnDisplay, readListView, writeDisplay, writeFilters, type Display, type Filters, type Layout } from "./display";
import { arrangeIssues, dropChange, issueMatches, type IssueGroup } from "./group";
import { DisplayButton, FilterButton, FilterChips, type DisplayControl, type FilterControl } from "./ListControls";
import { placeBelow } from "./Picker";
import { PropertyPicker, type PropertyField } from "./Properties";
import { linearStore, scopeIssues, useLinear } from "./store";
import type { IssueScope, LinearIssue, LinearState, LinearWorkspace } from "./types";

/** One issue as a list shows it: priority, key, title, labels' dots, project and assignee. */
export function IssueRow({
  issue,
  ws,
  open,
  focusable,
  onOpen,
  onMenu,
  showState = false,
}: {
  issue: LinearIssue;
  ws: LinearWorkspace | undefined;
  open: boolean;
  focusable: boolean;
  onOpen: (key: string) => void;
  /** Right-click (or the context-menu key): the row's menu, at that point. */
  onMenu?: (issue: LinearIssue, at: { x: number; y: number }) => void;
  showState?: boolean;
}) {
  const labels = issue.labelIds.map((id) => ws?.labels.find((l) => l.id === id)).filter((l) => l !== undefined);
  const project = ws?.projects.find((p) => p.id === issue.projectId);
  const state = ws?.states.find((s) => s.id === issue.stateId);
  return (
    <button
      data-key={issue.key}
      role="option"
      aria-selected={open}
      tabIndex={focusable ? 0 : -1}
      className={`linear-row${open ? " selected" : ""}`}
      onClick={() => onOpen(issue.key)}
      onContextMenu={
        onMenu &&
        ((e) => {
          e.preventDefault();
          e.currentTarget.focus({ preventScroll: true });
          const r = e.currentTarget.getBoundingClientRect();
          // From the keyboard there's no pointer: under the row's start.
          const keyed = e.clientX === 0 && e.clientY === 0;
          onMenu(issue, keyed ? { x: r.left + 24, y: r.bottom } : { x: e.clientX, y: e.clientY });
        })
      }
    >
      <Priority priority={issue.priority} />
      <span className="linear-key">{issue.key}</span>
      {showState && state && (
        <span data-tip={state.name} aria-label={state.name} className="linear-row-state">
          <Dot color={state.color} />
        </span>
      )}
      <span className="linear-title">{issue.title}</span>
      {labels.length > 0 && (
        <span className="linear-row-labels" aria-label={labels.map((l) => l.name).join(", ")}>
          {labels.map((l) => (
            <span key={l.id} data-tip={l.name}>
              <Dot color={l.color} />
            </span>
          ))}
        </span>
      )}
      {project && <span className="linear-row-project">{project.name}</span>}
      <span className="linear-row-person">
        <Person user={ws?.users.find((u) => u.id === issue.assigneeId)} />
      </span>
    </button>
  );
}

const MENU_ITEMS: [PropertyField, string, ReactNode][] = [
  ["status", "Status", <CircleDot size={13} aria-hidden="true" />],
  ["priority", "Priority", <SignalHigh size={13} aria-hidden="true" />],
  ["assignee", "Assignee", <UserRound size={13} aria-hidden="true" />],
  ["labels", "Labels", <Tag size={13} aria-hidden="true" />],
];
/** What the Linear tab's keys and ⌘K ask of the list shown. */
export type IssueListNav = {
  move(by: number): void;
  open(): void;
  filter(): void;
  /** Filter: the menu of properties (F). */
  filterBy(): void;
  /** The display options. */
  display(): void;
  setLayout(layout: Layout): void;
  clearFilters(): void;
};
/** What ⌘K needs of the list: its layout, whether filters are on; `key` is where they're kept (its place). */
export type IssueListState = { key: string; layout: Layout; filtered: boolean };

/** Room the menu and its pickers keep from the window's right edge. */
const MENU_WIDTH = 260;

/** A row's context menu: Status, Priority, Assignee, Labels, each opening its picker in the menu's place. */
function RowMenu({ issueId, at, onClose }: { issueId: string; at: { x: number; y: number }; onClose: () => void }) {
  const issue = useLinear((d) => d.issues.get(issueId));
  const [field, setField] = useState<PropertyField | null>(null);
  const menu = useRef<HTMLDivElement | null>(null);
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    if (el) placeBelow(el);
  }, []);
  useEffect(() => {
    if (field) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    const down = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [field, onClose]);
  if (!issue) return null;
  return createPortal(
    <span
      className="menu-anchor linear-row-menu-anchor"
      style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - MENU_WIDTH)), top: at.y }}
    >
      {field ? (
        <PropertyPicker field={field} issue={issue} onClose={onClose} />
      ) : (
        <div
          ref={placeMenu}
          role="menu"
          aria-label={`Edit ${issue.key}`}
          className="popover-menu left linear-row-menu"
          onBlur={(e) => {
            if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === "Tab") return;
            // The menu's keys are its own (not the list's ↑/↓, nor the page's Esc).
            e.stopPropagation();
            const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key as "Home"];
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (to !== undefined && items.length) {
              e.preventDefault();
              items[(to + items.length) % items.length].focus();
            }
          }}
        >
          {MENU_ITEMS.map(([f, label, icon]) => (
            <button key={f} role="menuitem" tabIndex={-1} onClick={() => setField(f)}>
              {icon}
              {label}
            </button>
          ))}
        </div>
      )}
    </span>,
    document.body,
  );
}

/** A group's mark before its name: the state's dot, the person, the priority, the project's colour, a cycle. */
function GroupMark({ group }: { group: IssueGroup }) {
  const mark = group.mark;
  switch (mark.kind) {
    case "state":
      return <Dot color={mark.state.color} />;
    case "user":
      return mark.user ? <Person user={mark.user} /> : <UserX size={13} aria-hidden="true" className="linear-group-icon" />;
    case "priority":
      return <Priority priority={mark.priority} />;
    case "project":
      return <Box size={13} aria-hidden="true" className="linear-group-icon" style={mark.color ? { color: mark.color } : undefined} />;
    case "cycle":
      return <RefreshCcw size={13} aria-hidden="true" className={`linear-group-icon${mark.current ? " current" : ""}`} />;
    case "none":
      return null;
  }
}

/** One issue as a board's card: its key, title, and priority, labels, project and assignee beneath. */
function IssueCard({
  issue,
  ws,
  open,
  focusable,
  onOpen,
  onMenu,
  onDrag,
}: {
  issue: LinearIssue;
  ws: LinearWorkspace | undefined;
  open: boolean;
  focusable: boolean;
  onOpen: (key: string) => void;
  onMenu: (issue: LinearIssue, at: { x: number; y: number }) => void;
  /** Dragging starts (the issue) or ends (null). */
  onDrag: (issue: LinearIssue | null) => void;
}) {
  const labels = issue.labelIds.map((id) => ws?.labels.find((l) => l.id === id)).filter((l) => l !== undefined);
  const project = ws?.projects.find((p) => p.id === issue.projectId);
  return (
    <div
      data-key={issue.key}
      role="option"
      aria-selected={open}
      tabIndex={focusable ? 0 : -1}
      className={`linear-card${open ? " selected" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", issue.key);
        e.dataTransfer.effectAllowed = "move";
        onDrag(issue);
      }}
      onDragEnd={() => onDrag(null)}
      onClick={() => onOpen(issue.key)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.currentTarget.focus({ preventScroll: true });
        const r = e.currentTarget.getBoundingClientRect();
        const keyed = e.clientX === 0 && e.clientY === 0;
        onMenu(issue, keyed ? { x: r.left + 24, y: r.bottom } : { x: e.clientX, y: e.clientY });
      }}
    >
      <span className="linear-card-head">
        <span className="linear-key">{issue.key}</span>
        <Person user={ws?.users.find((u) => u.id === issue.assigneeId)} />
      </span>
      <span className="linear-card-title">{issue.title}</span>
      <span className="linear-card-foot">
        <Priority priority={issue.priority} />
        {labels.map((l) => (
          <span key={l.id} className="linear-card-label">
            <Dot color={l.color} />
            {l.name}
          </span>
        ))}
        {project && <span className="linear-row-project">{project.name}</span>}
      </span>
    </div>
  );
}

/** The states a scope's board shows as columns even when empty: its team's, of the types the scope lists. */
function boardStates(scope: IssueScope, teamId: string | undefined, ws: LinearWorkspace | undefined, display: Display) {
  const team = ws?.teams.find((t) => t.id === teamId);
  if (!team) return [];
  const tab = scope.startsWith("team:") ? scope.split(":")[2] : "all";
  const types: Partial<Record<string, LinearState["type"][]>> = {
    triage: ["triage"],
    active: ["unstarted", "started"],
    backlog: ["backlog"],
  };
  const allowed = types[tab];
  return (ws?.states ?? []).filter(
    (s) =>
      s.teamId === team.id &&
      (allowed ? allowed.includes(s.type) : s.type !== "triage" || team.triageEnabled) &&
      (display.completed !== "none" || (s.type !== "completed" && s.type !== "canceled")),
  );
}

/**
 * A place's issues, from the store (an edit or a sync moves an issue between
 * lists at once), shown as the place's Display options say: a list or a
 * board, grouped (by status unless changed: started first, done and canceled
 * last) and ordered, and only what its filters and the search let through.
 * The display and filters are kept per place (`viewKey`). ↑/↓ move between
 * issues (on a board, ←/→ between columns); where the issue opens beside the
 * list (`opensBeside`) they open it too, else Enter does. A row's context
 * menu edits its status, priority, assignee and labels; a card dragged to
 * another column takes that column's status, assignee, priority, project or
 * cycle. `nav` takes the Linear tab's keys (J/K, O, /, F) and ⌘K's.
 */
export function IssueList({
  title,
  scope,
  issues: given,
  rank,
  viewKey = scope,
  defaultDisplay = DEFAULT_DISPLAY,
  teamId,
  openKey,
  onOpen,
  opensBeside,
  loading,
  capped = false,
  error,
  actions,
  children,
  nav,
  onListState,
  search: asks,
  emptyNote = "No issues here.",
}: {
  title: ReactNode;
  scope: IssueScope;
  /** The issues, when the scope isn't a predicate over the store (a view's or a search's, in Linear's order). */
  issues?: LinearIssue[];
  /** The issues' order as Linear returned them (a search's relevance). */
  rank?: Map<string, number>;
  /** Where its display and filters are kept; the scope by default. */
  viewKey?: string;
  /** The display until it's changed here (a view's own, as set in Linear). */
  defaultDisplay?: Display;
  /** The place's team, if it has one: a board shows its every state. */
  teamId?: string;
  openKey?: string;
  onOpen: (key: string) => void;
  opensBeside: boolean;
  loading: boolean;
  /** The scope stopped at 1,000 issues: the list says so. */
  capped?: boolean;
  error?: string;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  /** Shown between the title and the list (a project's summary). */
  children?: ReactNode;
  /** Set to the list's moves, for the view's keys. */
  nav?: MutableRefObject<IssueListNav | null>;
  /** Its layout and whether it's filtered, as they change (⌘K offers the rest). */
  onListState?: (state: IssueListState) => void;
  /** The search field asks for the issues instead of narrowing them (a search of the whole workspace). */
  search?: { value: string; onChange: (value: string) => void; label: string; placeholder: string };
  /** What an empty list says ("No issues here." by default). */
  emptyNote?: string;
}) {
  const data = useLinear((d) => d);
  const ws = data.workspace;
  const scoped = useMemo(() => given ?? scopeIssues(data, scope), [given, data, scope]);
  const fallback = useMemo(() => checkDisplay(defaultDisplay), [defaultDisplay]);
  const [view, setView] = useState(() => readListView(viewKey, fallback));
  // Another place: its own display and filters.
  const [viewOf, setViewOf] = useState(viewKey);
  if (viewOf !== viewKey) {
    setViewOf(viewKey);
    setView(readListView(viewKey, fallback));
  }
  // The default may come later (a view's, once the views are in): shown unless one was chosen here.
  const [fallbackOf, setFallbackOf] = useState(fallback);
  if (fallbackOf !== fallback) {
    setFallbackOf(fallback);
    if (!hasOwnDisplay(viewKey)) setView((v) => ({ ...v, display: fallback }));
  }
  const { display, filters } = view;
  const setDisplay = (next: Display) => {
    setView((v) => ({ ...v, display: next }));
    writeDisplay(viewKey, next);
  };
  const setFilters = (next: Filters) => {
    setView((v) => ({ ...v, filters: next }));
    writeFilters(viewKey, next);
  };
  const teamCycles = useMemo(() => [...data.cycles.values()].flat(), [data.cycles]);
  const issues = useMemo(
    () => filterIssues(scoped, filters, display.completed, ws),
    [scoped, filters, display.completed, ws],
  );
  const filtered = hasFilters(filters) || display.completed !== "all";
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => (asks ? issues : issues.filter((i) => issueMatches(i, query, ws))),
    [asks, issues, query, ws],
  );
  const board = display.layout === "board";
  const singleTeam = useMemo(() => {
    if (scope.startsWith("team:")) return scope.split(":")[1];
    if (teamId) return teamId;
    const teams = new Set(scoped.map((i) => i.teamId));
    return teams.size === 1 ? [...teams][0] : undefined;
  }, [scope, teamId, scoped]);
  const groups = useMemo(
    () =>
      arrangeIssues(shown, ws, display, {
        states: board && display.grouping === "status" ? boardStates(scope, singleTeam, ws, display) : undefined,
        cycles: teamCycles,
        rank,
      }),
    [shown, ws, display, board, scope, singleTeam, teamCycles, rank],
  );
  const order = groups.flatMap((g) => g.issues);
  const listRef = useRef<HTMLDivElement>(null);
  const headId = useId();
  const filterControl = useRef<FilterControl | null>(null);
  const displayControl = useRef<DisplayControl | null>(null);
  // The row that takes Tab: the open issue's, else the first.
  const [focusKey, setFocusKey] = useState<string | undefined>(openKey);
  const current = order.find((i) => i.key === (openKey ?? focusKey))?.key ?? order[0]?.key;
  useEffect(() => setQuery(""), [scope]);
  const [menu, setMenu] = useState<{ issueId: string; key: string; at: { x: number; y: number } }>();
  const menuFor = useRef<string | undefined>(undefined);
  const closeMenu = useCallback(() => setMenu(undefined), []);
  const openMenu = useCallback(
    (issue: LinearIssue, at: { x: number; y: number }) => setMenu({ issueId: issue.id, key: issue.key, at }),
    [],
  );
  // Once the menu has gone, its row has the focus again (unless something else took it).
  useEffect(() => {
    if (menu) {
      menuFor.current = menu.key;
      return;
    }
    const key = menuFor.current;
    menuFor.current = undefined;
    if (key && (!document.activeElement || document.activeElement === document.body))
      listRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus({ preventScroll: true });
  }, [menu]);
  useEffect(() => {
    if (openKey)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-key="${openKey}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openKey]);
  useEffect(() => {
    onListState?.({ key: viewKey, layout: display.layout, filtered: hasFilters(filters) });
  }, [viewKey, display.layout, filters, onListState]);

  const focusIssue = (key: string) => {
    setFocusKey(key);
    if (opensBeside) onOpen(key);
    listRef.current?.querySelector<HTMLElement>(`[data-key="${key}"]`)?.focus();
  };
  const step = (by: number) => {
    const at = order.findIndex((i) => i.key === current);
    const next = order[Math.min(order.length - 1, Math.max(0, at < 0 ? 0 : at + by))];
    if (next) focusIssue(next.key);
  };
  /** On a board: the issue as far down the next column (or the previous) that has any. */
  const across = (by: 1 | -1) => {
    const g = groups.findIndex((group) => group.issues.some((i) => i.key === current));
    if (g < 0) return;
    const at = groups[g].issues.findIndex((i) => i.key === current);
    for (let n = g + by; n >= 0 && n < groups.length; n += by) {
      const column = groups[n].issues;
      if (column.length) return focusIssue(column[Math.min(at, column.length - 1)].key);
    }
  };

  // Board: a card dragged over a column it can go to; dropped, the issue takes the column's value.
  const [dragging, setDragging] = useState<LinearIssue | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dropFor = (group: IssueGroup) =>
    dragging ? dropChange(dragging, group, display.grouping, ws, teamCycles) : null;
  const drop = (group: IssueGroup) => {
    const change = dropFor(group);
    setOver(null);
    setDragging(null);
    if (!change || !dragging) return;
    void linearStore.write("issueUpdate", { id: dragging.id, ...change.input }, { issueId: dragging.id, patch: change.patch });
  };

  const search = useRef<HTMLInputElement>(null);
  /** The focused row's key, if a row has the focus. */
  const focusedRow = () => {
    const el = document.activeElement as HTMLElement | null;
    return el && listRef.current?.contains(el) && el.matches(".linear-row, .linear-card") ? el.dataset.key : undefined;
  };
  useEffect(
    () => () => {
      if (nav) nav.current = null;
    },
    [nav],
  );
  if (nav)
    nav.current = {
      // From elsewhere, with no issue open, the first move lands on the row that takes Tab.
      move: (by) => step(focusedRow() || openKey ? by : 0),
      open: () => {
        const key = focusedRow() ?? current;
        if (key) onOpen(key);
      },
      filter: () => search.current?.focus(),
      filterBy: () => filterControl.current?.open(),
      display: () => displayControl.current?.open(),
      setLayout: (layout) => setDisplay({ ...display, layout, grouping: layout === "board" && display.grouping === "none" ? "status" : display.grouping }),
      clearFilters: () => setFilters({}),
    };

  const cyclesUsed = !!ws?.teams.some((t) => t.cyclesEnabled);
  return (
    <div className={`linear-list${board ? " is-board" : ""}`}>
      <ScreenHead title={title} count={loading && !scoped.length ? undefined : issues.length}>
        {actions}
        <span className="linear-tools">
          <FilterButton filters={filters} onFilters={setFilters} ws={ws} cycles={teamCycles} control={filterControl} />
          <DisplayButton
            display={display}
            onDisplay={setDisplay}
            fallback={fallback}
            relevance={!!rank}
            cycles={cyclesUsed}
            control={displayControl}
          />
        </span>
      </ScreenHead>
      {children}
      <label className="search-wrap">
        <Search size={14} aria-hidden="true" />
        <input
          {...plainText}
          ref={search}
          type="search"
          aria-label={asks?.label ?? "Search these issues"}
          placeholder={asks?.placeholder ?? "Search issues"}
          value={asks ? asks.value : query}
          onChange={(e) => (asks ? asks.onChange(e.target.value) : setQuery(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              step(order.findIndex((i) => i.key === current) < 0 ? 0 : opensBeside && openKey ? 1 : 0);
            } else if (e.key === "Escape" && (asks ? asks.value : query)) {
              e.stopPropagation();
              if (asks) asks.onChange("");
              else setQuery("");
            }
          }}
        />
      </label>
      <FilterChips filters={filters} onFilters={setFilters} ws={ws} cycles={teamCycles} />
      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}
      {/* The scroller holds the notes; the listbox only groups of options. */}
      <div className={board ? "linear-board-scroll" : "linear-groups"}>
        {loading && !scoped.length && <p className="linear-note">Loading issues…</p>}
        {!loading && !error && !scoped.length && <p className="linear-note">{emptyNote}</p>}
        {scoped.length > 0 && !shown.length && (
          <p className="linear-note">
            {filtered && !issues.length ? "No issue matches these filters." : "No issue matches."}
          </p>
        )}
        <div
          ref={listRef}
          role="listbox"
          aria-label="Issues"
          aria-orientation={board ? "horizontal" : "vertical"}
          className={board ? "linear-board" : undefined}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              step(e.key === "ArrowDown" ? 1 : -1);
            } else if (board && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
              e.preventDefault();
              across(e.key === "ArrowRight" ? 1 : -1);
            }
          }}
        >
          {(shown.length > 0 || board) &&
            groups.map((g, n) => {
              const target = dragging && dropFor(g) !== null;
              return (
                <div
                  key={g.key}
                  className={`linear-group${board ? " linear-column" : ""}${over === g.key && target ? " drop" : ""}`}
                  role="group"
                  aria-labelledby={`${headId}-${n}`}
                  data-group={g.key}
                  onDragOver={
                    board
                      ? (e) => {
                          if (!target) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          if (over !== g.key) setOver(g.key);
                        }
                      : undefined
                  }
                  onDragLeave={
                    board
                      ? (e) => {
                          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === g.key ? null : o));
                        }
                      : undefined
                  }
                  onDrop={
                    board
                      ? (e) => {
                          e.preventDefault();
                          drop(g);
                        }
                      : undefined
                  }
                >
                  {/* Hidden from the listbox's tree (it owns only groups and options); its name still labels the group. */}
                  <h3 aria-hidden="true" className={display.grouping === "none" && !board ? "sr-only" : undefined}>
                    <GroupMark group={g} />
                    <span id={`${headId}-${n}`}>{g.label}</span>
                    <span className="linear-count">{g.issues.length}</span>
                  </h3>
                  {board ? (
                    <div className="linear-column-cards">
                      {g.issues.map((i) => (
                        <IssueCard
                          key={i.id}
                          issue={i}
                          ws={ws}
                          open={i.key === openKey}
                          focusable={i.key === current}
                          onOpen={onOpen}
                          onMenu={openMenu}
                          onDrag={(issue) => {
                            setDragging(issue);
                            if (!issue) setOver(null);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    g.issues.map((i) => (
                      <IssueRow
                        key={i.id}
                        issue={i}
                        ws={ws}
                        open={i.key === openKey}
                        focusable={i.key === current}
                        onOpen={onOpen}
                        onMenu={openMenu}
                        showState={display.grouping !== "status"}
                      />
                    ))
                  )}
                </div>
              );
            })}
        </div>
        {capped && <p className="linear-note">Showing the 1,000 most recently updated</p>}
      </div>
      {menu && <RowMenu key={menu.issueId} issueId={menu.issueId} at={menu.at} onClose={closeMenu} />}
    </div>
  );
}
