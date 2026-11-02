import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleDot, Eye, FilePen, ListFilter, UserRound, X } from "lucide-react";
import { menuKeys } from "../linear/ListControls";
import { Picker, placeBelow, type PickerOption } from "../linear/Picker";
import { DEFAULT_FILTERS, FILTER_FIELDS, FILTERS, filterText, type FilterField, type RepoFilters } from "./filters";

const FIELD_ICON: Record<FilterField, ReactNode> = {
  state: <CircleDot size={13} aria-hidden="true" />,
  author: <UserRound size={13} aria-hidden="true" />,
  review: <Eye size={13} aria-hidden="true" />,
  draft: <FilePen size={13} aria-hidden="true" />,
  checks: <CircleCheck size={13} aria-hidden="true" />,
};

/** A field's choices: its values, and (but state's) Any, which clears it. */
const ANY = "";
function options(field: FilterField): PickerOption<string>[] {
  const values = Object.entries(FILTERS[field].values).map(([value, v]) => ({ value, text: (v as { text: string }).text }));
  return field === "state" ? values : [{ value: ANY, text: field === "author" ? "Anyone" : "Any" }, ...values];
}

/** The filters with one field set (or cleared, back to its default). */
export function setFilter(filters: RepoFilters, field: FilterField, value: string | null): RepoFilters {
  const next = { ...filters } as Record<string, string | undefined>;
  if (value) next[field] = value;
  else if (field === "state") next.state = DEFAULT_FILTERS.state;
  else delete next[field];
  return next as RepoFilters;
}

export type RepoFilterControl = { open(field?: FilterField): void };

/**
 * A repository's Filter button: a menu of the filters (state, author, review,
 * draft, CI), each opening a picker of its values. As the Linear list's, the
 * chosen ones show as chips under the head (`RepoFilterChips`).
 */
export function RepoFilterButton({
  filters,
  onFilters,
  control,
}: {
  filters: RepoFilters;
  onFilters: (next: RepoFilters) => void;
  /** Set to the button's opener, for F and ⌘K. */
  control?: React.MutableRefObject<RepoFilterControl | null>;
}) {
  const [open, setOpen] = useState<"menu" | FilterField | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(null), []);
  useEffect(() => {
    if (open !== "menu") return;
    const down = (e: MouseEvent) => {
      if (anchor.current && !anchor.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [open, close]);
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  if (control)
    control.current = {
      open: (field) => {
        button.current?.focus({ preventScroll: true });
        setOpen(field ?? "menu");
      },
    };
  const set = (field: FilterField) => (field === "state" ? filters.state !== "open" : !!filters[field]);
  const on = FILTER_FIELDS.some(set);
  return (
    <span className="menu-anchor" ref={anchor}>
      <button
        ref={button}
        className={`linear-tool${on ? " on" : ""}`}
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
          onKeyDown={(e) =>
            menuKeys(e, () => {
              close();
              button.current?.focus({ preventScroll: true });
            })
          }
        >
          {FILTER_FIELDS.map((field) => (
            <button
              key={field}
              role="menuitem"
              tabIndex={-1}
              onClick={() => {
                button.current?.focus({ preventScroll: true });
                setOpen(field);
              }}
            >
              {FIELD_ICON[field]}
              {FILTERS[field].label}
              {set(field) ? <small className="linear-menu-count">{filterText(field, filters[field]!)}</small> : null}
            </button>
          ))}
        </div>
      )}
      {open && open !== "menu" && (
        <Picker
          label={FILTERS[open].label}
          options={options(open)}
          value={filters[open] ?? ANY}
          onPick={(value) => onFilters(setFilter(filters, open, (value as string) || null))}
          onClose={close}
        />
      )}
    </span>
  );
}

/** The chosen filters as chips under the head: state always, the others while set; each reopens its picker, × clears it. */
export function RepoFilterChips({ filters, onFilters }: { filters: RepoFilters; onFilters: (next: RepoFilters) => void }) {
  const [open, setOpen] = useState<FilterField | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const fields = FILTER_FIELDS.filter((f) => filters[f]);
  const others = fields.filter((f) => f !== "state");
  return (
    <div className="linear-filters gh-filters" role="group" aria-label="Filters">
      {fields.map((field) => {
        const text = filterText(field, filters[field]!);
        const removable = field !== "state" || filters.state !== "open";
        return (
          <span key={field} className="linear-filter-chip">
            <span className="menu-anchor">
              <button
                className="linear-filter-edit"
                aria-label={`${FILTERS[field].label}: ${text}. Change`}
                aria-haspopup="listbox"
                aria-expanded={open === field}
                onClick={(e) => {
                  e.currentTarget.focus({ preventScroll: true });
                  setOpen(open === field ? null : field);
                }}
              >
                {FIELD_ICON[field]}
                <span className="linear-filter-field">{FILTERS[field].label}</span>
                <span className="linear-filter-op">is</span>
                <span className="linear-filter-values">{text}</span>
              </button>
              {open === field && (
                <Picker
                  label={FILTERS[field].label}
                  options={options(field)}
                  value={filters[field] ?? ANY}
                  onPick={(value) => onFilters(setFilter(filters, field, (value as string) || null))}
                  onClose={close}
                />
              )}
            </span>
            {removable && (
              <button
                className="icon-btn linear-filter-remove"
                aria-label={field === "state" ? "Back to open pull requests" : `Remove the ${FILTERS[field].label.toLowerCase()} filter`}
                data-tip={field === "state" ? "Open only" : "Remove"}
                onClick={() => onFilters(setFilter(filters, field, null))}
              >
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </span>
        );
      })}
      {(others.length > 1 || (others.length > 0 && filters.state !== "open")) && (
        <button className="link-btn linear-filters-clear" onClick={() => onFilters({ ...DEFAULT_FILTERS })}>
          Clear
        </button>
      )}
    </div>
  );
}
