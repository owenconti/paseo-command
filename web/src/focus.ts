import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled):not([type=hidden])",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

// Open traps, innermost last: only the top one handles keys and focus.
type Trap = { previous: HTMLElement | null; parent?: Trap };
const stack: Trap[] = [];

/** Whether a modal dialog holds focus (global shortcuts behind it stand down). */
export const modalOpen = () => stack.length > 0;

export function focusables(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && !el.hidden && el.getClientRects().length > 0,
  );
}

/** Can take focus back: still on the page, shown, and not in an inert panel. */
const usable = (el: HTMLElement | null): el is HTMLElement =>
  !!el &&
  el.isConnected &&
  !el.closest("[inert]") &&
  (el.checkVisibility?.({ visibilityProperty: true }) ??
    el.getClientRects().length > 0);
/**
 * The control for the panel `el` went into while it was hidden (e.g. the
 * rail's toggle, by aria-controls), so focus lands where that panel lives.
 */
function controlOf(el: HTMLElement | null) {
  const panel = el?.closest<HTMLElement>("[inert][id]");
  const control =
    panel &&
    document.querySelector<HTMLElement>(
      `[aria-controls="${CSS.escape(panel.id)}"]`,
    );
  return usable(control ?? null) ? control : null;
}

/**
 * Modal focus: moves focus into the dialog (to `initial`, else its first
 * control, else the dialog itself), keeps Tab and Shift+Tab inside it, pulls
 * focus back if it escapes, and returns focus to where it was on close.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  initial?: RefObject<HTMLElement | null>,
  active = true,
) {
  // Read during render: by the time effects run, an autoFocus child has
  // already taken focus from the control that opened the dialog.
  const [previous] = useState(
    () => document.activeElement as HTMLElement | null,
  );
  // StrictMode re-runs effects at once; a restore pending from the first run's
  // cleanup is cancelled by the second setup instead of yanking focus out.
  const pending = useRef(0);
  const enabled = useRef(active);
  enabled.current = active;
  useEffect(() => {
    if (!active) return;
    clearTimeout(pending.current);
    const root = ref.current;
    if (!root) return;
    // Opened from another dialog (e.g. the palette launching Dispatch while
    // it animates out): fall back to where that one was opened from.
    const token: Trap = { previous, parent: stack[stack.length - 1] };
    stack.push(token);
    const top = () => enabled.current && stack[stack.length - 1] === token;
    if (!root.contains(document.activeElement))
      (initial?.current || focusables(root)[0] || root).focus({
        preventScroll: true,
      });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !ref.current || !top()) return;
      const items = focusables(ref.current);
      if (!items.length) {
        e.preventDefault();
        ref.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && ref.current.contains(active);
      if (
        e.shiftKey &&
        (!inside || active === first || active === ref.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = ref.current;
      const target = e.target as Node | null;
      if (!el || !target || !top() || el.contains(target)) return;
      (focusables(el)[0] || el).focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
      stack.splice(stack.indexOf(token), 1);
      pending.current = window.setTimeout(() => {
        // Don't take focus back from whatever has it now (a dialog opened next).
        const active = document.activeElement;
        if (active && active !== document.body && !root.contains(active))
          return;
        let back: Trap | undefined = token;
        while (back && !usable(back.previous)) back = back.parent;
        if (back?.previous) back.previous.focus({ preventScroll: true });
        else controlOf(token.previous)?.focus({ preventScroll: true });
      });
    };
    // Re-trap only when a retained dialog becomes active again. A departing
    // AnimatePresence child releases document listeners before unmounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/**
 * Arrow keys for a horizontal tablist or radiogroup with a roving tabindex:
 * the group is one Tab stop, ←/→ (Home/End) move and select.
 */
export function rovingKeyDown(
  e: ReactKeyboardEvent<HTMLElement>,
  select: (index: number) => void,
) {
  const items = [
    ...e.currentTarget.querySelectorAll<HTMLElement>("[role=tab],[role=radio]"),
  ];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: -1 }[
    e.key as "Home"
  ];
  if (i < 0 || to === undefined || e.altKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  e.stopPropagation();
  const j = (to + items.length) % items.length;
  items[j].focus();
  select(j);
}
