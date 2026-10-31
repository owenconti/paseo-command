import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import { visibleBounds } from "../popover";
import { plainText } from "../ui";

const GAP = 4;
const MARGIN = 6;
/** Below its opener, as Linear's pickers open, unless there's more room above; inside what clips it, as tall as fits. */
export function placeBelow(el: HTMLElement): void {
  const anchor = el.parentElement;
  if (!anchor) return;
  const bounds = visibleBounds(el);
  const a = anchor.getBoundingClientRect();
  const natural = Math.min(el.scrollHeight, parseFloat(getComputedStyle(el).maxHeight) || Infinity);
  const below = bounds.bottom - a.bottom - GAP - MARGIN;
  const above = a.top - bounds.top - GAP - MARGIN;
  const down = below >= natural || below >= above;
  el.dataset.place = down ? "down" : "up";
  el.style.top = down ? `calc(100% + ${GAP}px)` : "auto";
  el.style.bottom = down ? "auto" : `calc(100% + ${GAP}px)`;
  el.style.maxHeight = `${Math.max(120, Math.floor(down ? below : above))}px`;
  el.style.overflowY = "auto";
  // Near the right edge of what shows it, it moves left to fit.
  const box = el.getBoundingClientRect();
  const over = Math.min(box.right - (bounds.right - MARGIN), box.left - (bounds.left + MARGIN));
  if (over > 0) el.style.left = `${-over}px`;
}

export type PickerOption<T> = { value: T; text: string; icon?: ReactNode; hint?: string };

/**
 * A property picker: a popover over its opener (the element it's rendered in),
 * a filter field and the options. Typing filters, ↑/↓ move, Enter or a click
 * picks and closes; with `multiple`, Enter or a click toggles and Esc closes.
 * Esc closes without a change. Focus goes back to whatever had it when it
 * opened; a click outside or Tab away closes it and leaves focus there.
 */
export function Picker<T>({
  label,
  options,
  value,
  multiple = false,
  onPick,
  onClose,
}: {
  label: string;
  options: PickerOption<T>[];
  value: T | T[];
  multiple?: boolean;
  onPick: (value: T | T[]) => void;
  onClose: () => void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Whether closing gives focus back to the opener (not after a click elsewhere or Tab). */
  const giveBack = useRef(true);
  const [query, setQuery] = useState("");
  const chosen = useCallback(
    (v: T) => (multiple && Array.isArray(value) ? value.includes(v) : Object.is(value, v)),
    [multiple, value],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.text.toLowerCase().includes(q)) : options;
  }, [options, query]);
  const [active, setActive] = useState(() => (multiple ? 0 : Math.max(0, options.findIndex((o) => chosen(o.value)))));

  // Focus to the filter; back to the opener when it closes.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    input.current?.focus({ preventScroll: true });
    return () => {
      if (giveBack.current && opener?.isConnected && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);
  // A click outside it and its opener closes it.
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const anchor = root.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) {
        giveBack.current = false;
        onClose();
      }
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [onClose]);
  useEffect(() => {
    list.current?.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }, [active, shown]);
  const place = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    root.current = el;
    placeBelow(el);
  }, []);

  const pick = (option: PickerOption<T> | undefined) => {
    if (!option) return;
    if (multiple) {
      const was = Array.isArray(value) ? value : [];
      onPick(chosen(option.value) ? was.filter((v) => !Object.is(v, option.value)) : [...was, option.value]);
      return;
    }
    if (!chosen(option.value)) onPick(option.value);
    onClose();
  };
  const at = Math.min(active, shown.length - 1);
  const optionId = (n: number) => `${id}-option-${n}`;

  return (
    <div
      ref={place}
      className="popover-menu left linear-picker"
      onMouseDown={(e) => {
        // Clicks inside keep the filter's focus.
        if (e.target !== input.current) e.preventDefault();
      }}
      onBlur={(e) => {
        // Tabbing away closes it (to its opener, the opener's own click decides).
        if (e.relatedTarget && !e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) {
          giveBack.current = false;
          onClose();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") return;
        // The picker's keys are its own: not the list's ↑/↓, nor the page's Esc and letters.
        e.stopPropagation();
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!shown.length) return;
          const by = e.key === "ArrowDown" ? 1 : -1;
          setActive((Math.max(0, at) + by + shown.length) % shown.length);
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          setActive(e.key === "Home" ? 0 : shown.length - 1);
        } else if (e.key === "Enter") {
          e.preventDefault();
          pick(shown[at]);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <label className="linear-picker-filter">
        <Search size={13} aria-hidden="true" />
        <input
          {...plainText}
          ref={input}
          role="combobox"
          aria-label={`Filter ${label.toLowerCase()}`}
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          aria-activedescendant={at >= 0 ? optionId(at) : undefined}
          placeholder={`${label}…`}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
        />
      </label>
      <div
        ref={list}
        id={`${id}-list`}
        role="listbox"
        aria-label={label}
        aria-multiselectable={multiple || undefined}
        className="linear-picker-list"
      >
        {shown.map((option, n) => {
          const on = chosen(option.value);
          return (
            <div
              key={`${String(option.value)}-${n}`}
              id={optionId(n)}
              role="option"
              aria-selected={on}
              className={`linear-picker-option${n === at ? " active" : ""}`}
              onMouseMove={() => n !== at && setActive(n)}
              onClick={() => pick(option)}
            >
              {multiple && (
                <span className={`linear-picker-box${on ? " on" : ""}`} aria-hidden="true">
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
              )}
              {option.icon && (
                <span className="linear-picker-icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="linear-picker-text">{option.text}</span>
              {option.hint && <small>{option.hint}</small>}
              {!multiple && on && <Check size={13} className="linear-picker-check" aria-hidden="true" />}
            </div>
          );
        })}
        {!shown.length && <p className="linear-picker-empty">No match</p>}
      </div>
    </div>
  );
}
