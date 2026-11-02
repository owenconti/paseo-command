import type { KeyboardEvent } from "react";

/** A small menu's arrow keys, Home/End and Esc, as a row menu's. */
export function menuKeys(e: KeyboardEvent<HTMLElement>, onClose: () => void) {
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
