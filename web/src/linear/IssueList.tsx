import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CircleDot, Search, SignalHigh, Tag, UserRound } from "lucide-react";
import { plainText } from "../ui";
import { Dot, Person, Priority, ScreenHead } from "./bits";
import { groupIssues, issueMatches } from "./group";
import { placeBelow } from "./Picker";
import { PropertyPicker, type PropertyField } from "./Properties";
import { scopeIssues, useLinear } from "./store";
import type { IssueScope, LinearIssue, LinearWorkspace } from "./types";

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
/** What the Linear tab's keys ask of the list shown. */
export type IssueListNav = { move(by: number): void; open(): void; filter(): void };

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

/**
 * A place's issues, grouped by state (started first, done and canceled last),
 * from the store: an edit or a sync moves an issue between lists at once.
 * ↑/↓ move between rows; where the issue opens beside the list (`opensBeside`)
 * they open it too, else Enter does. A row's context menu edits its status,
 * priority, assignee and labels. `nav` takes the Linear tab's keys (J/K, O, /).
 */
export function IssueList({
  title,
  scope,
  openKey,
  onOpen,
  opensBeside,
  loading,
  error,
  actions,
  children,
  nav,
}: {
  title: ReactNode;
  scope: IssueScope;
  openKey?: string;
  onOpen: (key: string) => void;
  opensBeside: boolean;
  loading: boolean;
  error?: string;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  /** Shown between the title and the list (a project's summary). */
  children?: ReactNode;
  /** Set to the list's moves, for the view's keys. */
  nav?: MutableRefObject<IssueListNav | null>;
}) {
  const data = useLinear((d) => d);
  const ws = data.workspace;
  const issues = useMemo(() => scopeIssues(data, scope), [data, scope]);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => issues.filter((i) => issueMatches(i, query, ws)), [issues, query, ws]);
  const groups = useMemo(() => groupIssues(shown, ws), [shown, ws]);
  const order = groups.flatMap((g) => g.issues);
  const listRef = useRef<HTMLDivElement>(null);
  // The row that takes Tab: the open issue's, else the first.
  const [focusKey, setFocusKey] = useState<string | undefined>(openKey);
  const current = order.find((i) => i.key === (openKey ?? focusKey))?.key ?? order[0]?.key;
  useEffect(() => setQuery(""), [scope]);
  const [menu, setMenu] = useState<{ issueId: string; key: string; at: { x: number; y: number } }>();
  const menuFor = useRef<string | undefined>(undefined);
  const closeMenu = useCallback(() => setMenu(undefined), []);
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
      listRef.current?.querySelector<HTMLElement>(`[data-key="${openKey}"]`)?.scrollIntoView({ block: "nearest" });
  }, [openKey]);

  const step = (by: number) => {
    const at = order.findIndex((i) => i.key === current);
    const next = order[Math.min(order.length - 1, Math.max(0, at < 0 ? 0 : at + by))];
    if (!next) return;
    setFocusKey(next.key);
    if (opensBeside) onOpen(next.key);
    listRef.current?.querySelector<HTMLElement>(`[data-key="${next.key}"]`)?.focus();
  };

  const search = useRef<HTMLInputElement>(null);
  /** The focused row's key, if a row has the focus. */
  const focusedRow = () => {
    const el = document.activeElement as HTMLElement | null;
    return el && listRef.current?.contains(el) && el.matches(".linear-row") ? el.dataset.key : undefined;
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
    };

  return (
    <div className="linear-list">
      <ScreenHead title={title} count={loading && !issues.length ? undefined : issues.length}>
        {actions}
      </ScreenHead>
      {children}
      <label className="search-wrap">
        <Search size={14} aria-hidden="true" />
        <input
          {...plainText}
          ref={search}
          type="search"
          aria-label="Search these issues"
          placeholder="Search issues"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              step(order.findIndex((i) => i.key === current) < 0 ? 0 : opensBeside && openKey ? 1 : 0);
            } else if (e.key === "Escape" && query) {
              e.stopPropagation();
              setQuery("");
            }
          }}
        />
      </label>
      {error && (
        <p className="archive-error" role="alert">
          {error}
        </p>
      )}
      <div
        className="linear-groups"
        ref={listRef}
        role="listbox"
        aria-label="Issues"
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            step(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
      >
        {loading && !issues.length && <p className="linear-note">Loading issues…</p>}
        {!loading && !error && !issues.length && <p className="linear-note">No issues here.</p>}
        {issues.length > 0 && !shown.length && <p className="linear-note">No issue matches.</p>}
        {groups.map((g) => (
          <div key={`${g.state.type}:${g.state.name}`} className="linear-group" role="group" aria-label={g.state.name}>
            <h3>
              <Dot color={g.state.color} />
              {g.state.name}
              <span className="linear-count">{g.issues.length}</span>
            </h3>
            {g.issues.map((i) => (
              <IssueRow
                key={i.id}
                issue={i}
                ws={ws}
                open={i.key === openKey}
                focusable={i.key === current}
                onOpen={onOpen}
                onMenu={(issue, at) => setMenu({ issueId: issue.id, key: issue.key, at })}
              />
            ))}
          </div>
        ))}
      </div>
      {menu && <RowMenu key={menu.issueId} issueId={menu.issueId} at={menu.at} onClose={closeMenu} />}
    </div>
  );
}
