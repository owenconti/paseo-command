import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleCheck, CircleDot, Eye, FilePen, ListFilter, UserCheck, UserRound, UserRoundPen, X } from "lucide-react";
import { menuKeys } from "../linear/ListControls";
import { Picker, placeBelow, type PickerOption } from "../linear/Picker";
import { readPath, useGithubRead } from "./api";
import { Avatar } from "./bits";
import {
  DEFAULT_FILTERS,
  FILTER_FIELDS,
  FILTERS,
  fieldLabel,
  filterText,
  isPeople,
  MAX_SEARCHES,
  ME,
  peopleText,
  PEOPLE,
  searchCount,
  type FilterField,
  type PeopleField,
  type RepoFilters,
  type ValueField,
} from "./filters";
import type { Person, RepoPeople } from "./types";

const FIELD_ICON: Record<FilterField, ReactNode> = {
  state: <CircleDot size={13} aria-hidden="true" />,
  author: <UserRoundPen size={13} aria-hidden="true" />,
  reviewer: <UserCheck size={13} aria-hidden="true" />,
  assignee: <UserRound size={13} aria-hidden="true" />,
  review: <Eye size={13} aria-hidden="true" />,
  draft: <FilePen size={13} aria-hidden="true" />,
  checks: <CircleCheck size={13} aria-hidden="true" />,
};

/** A one-value field's choices: its values, and (but state's) Any, which clears it. */
const ANY = "";
function options(field: ValueField): PickerOption<string>[] {
  const values = Object.entries(FILTERS[field].values).map(([value, v]) => ({ value, text: (v as { text: string }).text }));
  return field === "state" ? values : [{ value: ANY, text: "Any" }, ...values];
}

/** Whether a field is set (state: other than open). */
export const fieldSet = (filters: RepoFilters, field: FilterField) =>
  field === "state" ? filters.state !== "open" : isPeople(field) ? !!filters[field]?.length : !!filters[field];

/** The filters with one field set (or cleared, back to its default): a value, or a people filter's people. */
export function setFilter(filters: RepoFilters, field: FilterField, value: string | string[] | null): RepoFilters {
  const next = { ...filters } as Record<string, string | string[] | undefined>;
  if (Array.isArray(value) ? value.length : value) next[field] = isPeople(field) ? (Array.isArray(value) ? value : [value as string]) : (value as string);
  else if (field === "state") next.state = DEFAULT_FILTERS.state;
  else delete next[field];
  return next as RepoFilters;
}

/** A field's value in words. */
const valueText = (filters: RepoFilters, field: FilterField) =>
  isPeople(field) ? peopleText(filters[field] ?? []) : filterText(field, filters[field] as string);

/**
 * A people filter's picker: you first, then the repository's people (recent
 * pull requests' authors, then those who can be assigned), with avatars,
 * searchable by login or name; several can be chosen. Those chosen whom the
 * list doesn't name stay offered. Past `MAX_SEARCHES` it says so instead.
 */
function PeoplePicker({
  repo,
  field,
  filters,
  onFilters,
  onClose,
}: {
  repo: string;
  field: PeopleField;
  filters: RepoFilters;
  onFilters: (next: RepoFilters) => void;
  onClose: () => void;
}) {
  const people = useGithubRead<RepoPeople>(readPath("people", { repo }));
  const [refused, setRefused] = useState(false);
  const chosen = filters[field] ?? [];
  const opts = useMemo<PickerOption<string>[]>(() => {
    const person = (p: Person, extra: Partial<PickerOption<string>> = {}): PickerOption<string> => ({
      value: p.login,
      text: p.login,
      icon: <Avatar person={p} size={16} />,
      ...(p.name ? { hint: p.name, keywords: p.name } : {}),
      ...extra,
    });
    const viewer = people.data?.viewer;
    const you: PickerOption<string> = {
      value: ME,
      text: "You",
      icon: <Avatar person={viewer ?? { login: "me" }} size={16} />,
      ...(viewer ? { hint: viewer.login, keywords: `${viewer.login} ${viewer.name ?? ""} me` } : { keywords: "me" }),
    };
    const listed = people.data?.people ?? [];
    const others = chosen
      .filter((login) => login !== ME && !listed.some((p) => p.login.toLowerCase() === login.toLowerCase()))
      .map((login) => person({ login }));
    return [you, ...others, ...listed.map((p) => person(p))];
  }, [people.data, chosen]);
  return (
    <Picker
      label={PEOPLE[field].label}
      options={opts}
      value={chosen}
      multiple
      note={
        refused
          ? `GitHub's search takes one person at a time, so these filters ask at most ${MAX_SEARCHES} searches together${field === "reviewer" ? " (a reviewer takes two: requested and reviewed)" : ""}.`
          : (people.unavailable ?? (people.loading && !people.data ? `Loading ${repo}'s people…` : undefined))
      }
      onPick={(value) => {
        const next = setFilter(filters, field, value as string[]);
        if (searchCount(next) > MAX_SEARCHES) return setRefused(true);
        setRefused(false);
        onFilters(next);
      }}
      onClose={onClose}
    />
  );
}

/** A field's picker, a value's or a people filter's. */
function FieldPicker({
  repo,
  field,
  filters,
  onFilters,
  onClose,
}: {
  repo: string;
  field: FilterField;
  filters: RepoFilters;
  onFilters: (next: RepoFilters) => void;
  onClose: () => void;
}) {
  if (isPeople(field)) return <PeoplePicker repo={repo} field={field} filters={filters} onFilters={onFilters} onClose={onClose} />;
  return (
    <Picker
      label={FILTERS[field].label}
      options={options(field)}
      value={(filters[field] as string | undefined) ?? ANY}
      onPick={(value) => onFilters(setFilter(filters, field, (value as string) || null))}
      onClose={onClose}
    />
  );
}

export type RepoFilterControl = { open(field?: FilterField): void };

/**
 * A repository's Filter button: a menu of the filters (state, author,
 * reviewer, assignee, review, draft, CI), each opening a picker of its values
 * (the people filters, of the repository's people). As the Linear list's, the
 * chosen ones show as chips under the head (`RepoFilterChips`).
 */
export function RepoFilterButton({
  repo,
  filters,
  onFilters,
  control,
}: {
  repo: string;
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
  const on = FILTER_FIELDS.some((f) => fieldSet(filters, f));
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
              {fieldLabel(field)}
              {fieldSet(filters, field) ? <small className="linear-menu-count">{valueText(filters, field)}</small> : null}
            </button>
          ))}
        </div>
      )}
      {open && open !== "menu" && <FieldPicker repo={repo} field={open} filters={filters} onFilters={onFilters} onClose={close} />}
    </span>
  );
}

/** The chosen filters as chips under the head: state always, the others while set; each reopens its picker, × clears it. */
export function RepoFilterChips({ repo, filters, onFilters }: { repo: string; filters: RepoFilters; onFilters: (next: RepoFilters) => void }) {
  const [open, setOpen] = useState<FilterField | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const fields = FILTER_FIELDS.filter((f) => f === "state" || fieldSet(filters, f));
  const others = fields.filter((f) => f !== "state");
  return (
    <div className="linear-filters gh-filters" role="group" aria-label="Filters">
      {fields.map((field) => {
        const text = valueText(filters, field);
        const removable = field !== "state" || filters.state !== "open";
        const label = fieldLabel(field);
        const many = isPeople(field) && (filters[field]?.length ?? 0) > 1;
        return (
          <span key={field} className="linear-filter-chip">
            <span className="menu-anchor">
              <button
                className="linear-filter-edit"
                aria-label={`${label}: ${text}. Change`}
                aria-haspopup="listbox"
                aria-expanded={open === field}
                onClick={(e) => {
                  e.currentTarget.focus({ preventScroll: true });
                  setOpen(open === field ? null : field);
                }}
              >
                {FIELD_ICON[field]}
                <span className="linear-filter-field">{label}</span>
                <span className="linear-filter-op">{many ? "is any of" : "is"}</span>
                <span className="linear-filter-values">{text}</span>
              </button>
              {open === field && <FieldPicker repo={repo} field={field} filters={filters} onFilters={onFilters} onClose={close} />}
            </span>
            {removable && (
              <button
                className="icon-btn linear-filter-remove"
                aria-label={field === "state" ? "Back to open pull requests" : `Remove the ${label === "CI" ? "CI" : label.toLowerCase()} filter`}
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
