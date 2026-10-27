import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { placePopover } from "../popover";

/** A popover anchored to its trigger (the parent's `[aria-haspopup]`). */
export function Menu({
  children,
  onClose,
  align = "left",
  role = "menu",
  label,
}: {
  children: ReactNode;
  onClose: () => void;
  align?: "left" | "right";
  role?: "menu" | "dialog";
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Opens up or down, whichever has room, capped and scrollable (popover.ts).
  const attach = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    const stop = placePopover(el);
    return () => {
      ref.current = null;
      stop?.();
    };
  }, []);
  const items = () => [
    ...(ref.current?.querySelectorAll<HTMLElement>(
      "button:not(:disabled), input:not(:disabled)",
    ) || []),
  ];
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node))
        onClose();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // Tabbing out of the menu (and its trigger) closes it.
    const anchor = ref.current?.parentElement;
    const out = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && !anchor?.contains(next)) onClose();
    };
    document.addEventListener("mousedown", down);
    window.addEventListener("keydown", key, true);
    anchor?.addEventListener("focusout", out);
    return () => {
      document.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key, true);
      anchor?.removeEventListener("focusout", out);
    };
  }, [onClose]);
  // Focus moves into the menu, and back to its trigger when it closes from
  // inside (Escape, choosing an item) unless something else took focus.
  const pending = useRef(0);
  useEffect(() => {
    clearTimeout(pending.current); // StrictMode's immediate re-run
    const menu = ref.current;
    const trigger = menu?.parentElement?.querySelector<HTMLElement>(
      ":scope > [aria-haspopup]",
    );
    if (menu && !menu.contains(document.activeElement)) items()[0]?.focus();
    return () => {
      pending.current = window.setTimeout(() => {
        // Only when focus was lost with the menu, not taken by e.g. the picker.
        const active = document.activeElement;
        if ((!active || active === document.body) && trigger?.isConnected)
          trigger.focus({ preventScroll: true });
      });
    };
  }, []);
  return (
    <div
      ref={attach}
      className={`popover-menu ${align}`}
      role={role}
      aria-label={label}
      onKeyDown={(e) => {
        // Inputs (the GitHub search) use the arrows for their own list.
        if (role !== "menu" || (e.target as HTMLElement).tagName === "INPUT")
          return;
        const all = items();
        const i = all.indexOf(document.activeElement as HTMLElement);
        const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: -1 }[
          e.key as "Home"
        ];
        if (to === undefined || !all.length) return;
        e.preventDefault();
        e.stopPropagation();
        all[(to + all.length) % all.length].focus();
      }}
    >
      {children}
    </div>
  );
}
