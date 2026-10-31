import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CircleDot,
  Columns3,
  List,
  ListFilter,
  RefreshCcw,
  SignalHigh,
  SlidersHorizontal,
  Tag,
  UserRound,
  UserX,
  Box,
  X,
  Minus,
} from "lucide-react";
import { cycleName, Dot, Person, Priority, PRIORITY_LABEL } from "./bits";
import {
  COMPLETED,
  COMPLETED_LABEL,
  DEFAULT_DISPLAY,
  FILTER_LABEL,
  GROUPING_LABEL,
  GROUPINGS,
  hasFilters,
  ORDERING_LABEL,
  ORDERINGS,
  scopeCompleted,
  type Display,
  type FilterField,
  type Filters,
} from "./display";
import { Picker, placeBelow, type PickerOption } from "./Picker";
import type { LinearCycle, LinearState, LinearWorkspace } from "./types";

/** Linear's workflow types, in the order pickers list them. */
const STATE_ORDER: LinearState["type"][] = ["triage", "backlog", "unstarted", "started", "completed", "canceled"];

const FIELD_ICON: Record<FilterField, ReactNode> = {
  status: <CircleDot size={13} aria-hidden="true" />,
  assignee: <UserRound size={13} aria-hidden="true" />,
  priority: <SignalHigh size={13} aria-hidden="true" />,
  labels: <Tag size={13} aria-hidden="true" />,
  project: <Box size={13} aria-hidden="true" />,
  cycle: <RefreshCcw size={13} aria-hidden="true" />,
};

/** The properties a list can be filtered by: cycles only where a team runs them. */
export function filterFields(ws: LinearWorkspace | undefined): FilterField[] {
  const cycles = !!ws?.teams.some((t) => t.cyclesEnabled);
  return (["status", "assignee", "priority", "labels", "project", "cycle"] as FilterField[]).filter(
    (f) => f !== "cycle" || cycles,
  );
}

/** A filtered property's choices, as `Filters` keeps them: a status by name, the rest by id ("none" for without). */
export function filterOptions(
  field: FilterField,
  ws: LinearWorkspace | undefined,
  cycles: LinearCycle[] = [],
): PickerOption<string>[] {
  const none = (text: string, icon: ReactNode = <Minus size={13} />): PickerOption<string> => ({ value: "none", text, icon });
  switch (field) {
    case "status": {
      const seen = new Map<string, LinearState>();
      for (const s of [...(ws?.states ?? [])].sort(
        (a, b) => STATE_ORDER.indexOf(a.type) - STATE_ORDER.indexOf(b.type) || a.position - b.position,
      ))
        if (!seen.has(s.name)) seen.set(s.name, s);
      return [...seen.values()].map((s) => ({ value: s.name, text: s.name, icon: <Dot color={s.color} /> }));
    }
    case "assignee": {
      const users = [...(ws?.users ?? [])].sort(
        (a, b) => Number(b.id === ws?.viewerId) - Number(a.id === ws?.viewerId) || a.name.localeCompare(b.name),
      );
      return [
        none("No assignee", <UserX size={13} />),
        ...users.map((u) => ({
          value: u.id,
          text: u.name,
          icon: <Person user={u} />,
          hint: u.id === ws?.viewerId ? "You" : undefined,
        })),
      ];
    }
    case "priority":
      return [1, 2, 3, 4, 0].map((p) => ({ value: String(p), text: PRIORITY_LABEL[p], icon: <Priority priority={p} /> }));
    case "labels":
      return [
        none("No labels", <Tag size={13} />),
        ...[...(ws?.labels ?? [])]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((l) => ({ value: l.id, text: l.name, icon: <Dot color={l.color} /> })),
      ];
    case "project":
      return [
        none("No project", <Box size={13} />),
        ...[...(ws?.projects ?? [])]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ value: p.id, text: p.name, icon: <Dot color={p.color} /> })),
      ];
    case "cycle": {
      const known = new Map([...(ws?.cycles ?? []), ...cycles].map((c) => [c.id, c]));
      const teams = new Map(ws?.teams.map((t) => [t.id, t.key]));
      return [
        none("No cycle", <RefreshCcw size={13} />),
        ...[...known.values()]
          .sort((a, b) => Number(b.isActive) - Number(a.isActive) || b.number - a.number)
          .map((c) => ({
            value: c.id,
            text: cycleName(c),
            hint: [teams.get(c.teamId), c.isActive ? "Current" : c.isNext ? "Next" : undefined].filter(Boolean).join(" · "),
          })),
      ];
    }
  }
}

/** A filter's chosen values in words ("Todo, In Progress"). */
function chosenText(field: FilterField, values: string[], options: PickerOption<string>[]): string {
  const names = values.map((v) => options.find((o) => o.value === v)?.text ?? "Unknown");
  return names.length > 2 ? `${names.length} ${FILTER_LABEL[field].toLowerCase()}` : names.join(", ");
}

/** A small menu's arrow keys, Home/End and Esc, as the row menu's. */
function menuKeys(e: React.KeyboardEvent<HTMLElement>, onClose: () => void) {
  if (e.key === "Tab") return;
  e.stopPropagation();
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key as "Home"];
  if (e.key === "Escape") {
    e.preventDefault();
    onClose();
  } else if (to !== undefined && items.length) {
    e.preventDefault();
    items[(to + items.length) % items.length].focus();
  }
}

/** Closes a popover on a click outside its anchor. */
function useOutside(anchor: React.RefObject<HTMLElement | null>, open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [anchor, open, onClose]);
}

export type FilterControl = { open(): void };

/**
 * Filter: a menu of the properties, each opening a picker of its values
 * (any of them shows an issue). Chosen filters show as chips under the
 * list's head, each reopening its picker or removed with its ×.
 */
export function FilterButton({
  filters,
  onFilters,
  ws,
  cycles,
  control,
}: {
  filters: Filters;
  onFilters: (next: Filters) => void;
  ws: LinearWorkspace | undefined;
  cycles?: LinearCycle[];
  /** Set to the button's opener, for F and ⌘K. */
  control?: React.MutableRefObject<FilterControl | null>;
}) {
  const [open, setOpen] = useState<"menu" | FilterField | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useOutside(anchor, open === "menu", close);
  const menu = useRef<HTMLDivElement | null>(null);
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  if (control)
    control.current = {
      open: () => {
        button.current?.focus({ preventScroll: true });
        setOpen("menu");
      },
    };
  const set = (field: FilterField, values: string[]) => {
    const next = { ...filters };
    if (values.length) next[field] = values;
    else delete next[field];
    onFilters(next);
  };
  return (
    <span className="menu-anchor" ref={anchor}>
      <button
        ref={button}
        className={`linear-tool${hasFilters(filters) ? " on" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        data-tip="Filter (F)"
        onClick={(e) => {
          e.currentTarget.focus({ preventScroll: true });
          setOpen(open ? null : "menu");
        }}
      >
        <ListFilter size={13} aria-hidden="true" />
        Filter
      </button>
      {open === "menu" && (
        <div
          ref={placeMenu}
          role="menu"
          aria-label="Filter by"
          className="popover-menu left linear-row-menu"
          onKeyDown={(e) => menuKeys(e, () => {
            close();
            button.current?.focus({ preventScroll: true });
          })}
        >
          {filterFields(ws).map((field) => (
            <button
              key={field}
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                // The picker gives focus back to what had it: the button, not this menu.
                button.current?.focus({ preventScroll: true });
                setOpen(field);
              }}
            >
              {FIELD_ICON[field]}
              {FILTER_LABEL[field]}
              {filters[field]?.length ? <small className="linear-menu-count">{filters[field]!.length}</small> : null}
            </button>
          ))}
        </div>
      )}
      {open && open !== "menu" && (
        <Picker
          label={FILTER_LABEL[open]}
          options={filterOptions(open, ws, cycles)}
          value={filters[open] ?? []}
          multiple
          onPick={(values) => set(open, values as string[])}
          onClose={close}
        />
      )}
    </span>
  );
}

/** The chosen filters as chips: each reopens its picker; × removes it; Clear removes them all. */
export function FilterChips({
  filters,
  onFilters,
  ws,
  cycles,
}: {
  filters: Filters;
  onFilters: (next: Filters) => void;
  ws: LinearWorkspace | undefined;
  cycles?: LinearCycle[];
}) {
  const [open, setOpen] = useState<FilterField | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const fields = (Object.keys(filters) as FilterField[]).filter((f) => filters[f]?.length);
  if (!fields.length) return null;
  const set = (field: FilterField, values: string[]) => {
    const next = { ...filters };
    if (values.length) next[field] = values;
    else delete next[field];
    onFilters(next);
  };
  return (
    <div className="linear-filters" role="group" aria-label="Filters">
      {fields.map((field) => {
        const options = filterOptions(field, ws, cycles);
        const values = filters[field]!;
        const text = chosenText(field, values, options);
        return (
          <span key={field} className="linear-filter-chip">
            <span className="menu-anchor">
              <button
                className="linear-filter-edit"
                aria-label={`${FILTER_LABEL[field]}: ${text}. Change`}
                aria-haspopup="listbox"
                aria-expanded={open === field}
                onClick={(e) => {
                  e.currentTarget.focus({ preventScroll: true });
                  setOpen(open === field ? null : field);
                }}
              >
                {FIELD_ICON[field]}
                <span className="linear-filter-field">{FILTER_LABEL[field]}</span>
                <span className="linear-filter-op">{values.length > 1 ? "is any of" : "is"}</span>
                <span className="linear-filter-values">{text}</span>
              </button>
              {open === field && (
                <Picker
                  label={FILTER_LABEL[field]}
                  options={options}
                  value={values}
                  multiple
                  onPick={(next) => set(field, next as string[])}
                  onClose={close}
                />
              )}
            </span>
            <button
              className="icon-btn linear-filter-remove"
              aria-label={`Remove the ${FILTER_LABEL[field].toLowerCase()} filter`}
              data-tip="Remove"
              onClick={() => set(field, [])}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        );
      })}
      {fields.length > 1 && (
        <button className="link-btn linear-filters-clear" onClick={() => onFilters({})}>
          Clear
        </button>
      )}
    </div>
  );
}

export type DisplayControl = { open(): void };

/**
 * Display: List or Board, grouping, ordering and how far back finished issues
 * show. `fallback` is what Reset puts back (the place's own default: a view's
 * Linear settings); Relevance is offered only where the list has one (a search).
 */
export function DisplayButton({
  display,
  onDisplay,
  fallback = DEFAULT_DISPLAY,
  relevance = false,
  cycles = true,
  completedChoices = COMPLETED,
  control,
}: {
  display: Display;
  onDisplay: (next: Display) => void;
  fallback?: Display;
  relevance?: boolean;
  /** Whether grouping by cycle makes sense (a team runs them). */
  cycles?: boolean;
  /** How far back the list can show finished issues (`completedChoices`); none hides the choice. */
  completedChoices?: Display["completed"][];
  control?: React.MutableRefObject<DisplayControl | null>;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(anchor, open, close);
  const place = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("button[aria-pressed=true]")?.focus({ preventScroll: true });
  }, []);
  if (control)
    control.current = {
      open: () => {
        button.current?.focus({ preventScroll: true });
        setOpen(true);
      },
    };
  const set = (patch: Partial<Display>) => {
    const next = { ...display, ...patch };
    // A board has columns: it's grouped by something.
    if (next.layout === "board" && next.grouping === "none") next.grouping = "status";
    onDisplay(next);
  };
  const groupings = GROUPINGS.filter((g) => g !== "cycle" || cycles).filter(
    (g) => g !== "none" || display.layout === "list",
  );
  const orderings = ORDERINGS.filter((o) => o !== "relevance" || relevance);
  const changed = JSON.stringify(display) !== JSON.stringify(fallback);
  return (
    <span className="menu-anchor" ref={anchor}>
      <button
        ref={button}
        className="linear-tool"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip="Display options"
        onClick={(e) => {
          e.currentTarget.focus({ preventScroll: true });
          setOpen(!open);
        }}
      >
        <SlidersHorizontal size={13} aria-hidden="true" />
        Display
      </button>
      {open && (
        <div
          ref={place}
          role="dialog"
          aria-label="Display options"
          className="popover-menu right linear-display-menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              close();
              button.current?.focus({ preventScroll: true });
            } else if (e.key !== "Tab") e.stopPropagation();
          }}
        >
          <div className="linear-layout-toggle" role="group" aria-label="Layout">
            {(
              [
                ["list", "List", <List size={14} aria-hidden="true" />],
                ["board", "Board", <Columns3 size={14} aria-hidden="true" />],
              ] as const
            ).map(([layout, label, icon]) => (
              <button
                key={layout}
                aria-pressed={display.layout === layout}
                onClick={() => set({ layout })}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
          <label className="linear-display-row">
            <span>Grouping</span>
            <select value={display.grouping} onChange={(e) => set({ grouping: e.target.value as Display["grouping"] })}>
              {groupings.map((g) => (
                <option key={g} value={g}>
                  {GROUPING_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
          <label className="linear-display-row">
            <span>Ordering</span>
            <select value={display.ordering} onChange={(e) => set({ ordering: e.target.value as Display["ordering"] })}>
              {orderings.map((o) => (
                <option key={o} value={o}>
                  {ORDERING_LABEL[o]}
                </option>
              ))}
            </select>
          </label>
          {completedChoices.length > 0 && (
            <label className="linear-display-row">
              <span>Completed issues</span>
              <select
                value={scopeCompleted(display.completed, completedChoices)}
                onChange={(e) => set({ completed: e.target.value as Display["completed"] })}
              >
                {completedChoices.map((c) => (
                  <option key={c} value={c}>
                    {COMPLETED_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {changed && (
            <button
              className="link-btn linear-display-reset"
              onClick={(e) => {
                // The button goes with the change: the keyboard stays in the menu, on the layout.
                e.currentTarget.parentElement
                  ?.querySelector<HTMLElement>("button[aria-pressed=true]")
                  ?.focus({ preventScroll: true });
                onDisplay(fallback);
              }}
            >
              Reset to default
            </button>
          )}
        </div>
      )}
    </span>
  );
}
