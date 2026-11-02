import { useCallback, useRef } from "react";

/** A head title's parts, as `styles/pages.css` names them. */
const PARTS = ".page-crumb, .page-head-name";

/** The title's whole text, its parts joined as the breadcrumb reads, when any part is cut short. */
export function cutTitle(title: HTMLElement): string | null {
  const parts = [...title.querySelectorAll<HTMLElement>(PARTS)];
  if (!parts.some((p) => p.scrollWidth > p.clientWidth + 1)) return null;
  return parts.map((p) => p.textContent?.trim() ?? "").filter(Boolean).join(" › ");
}

/**
 * A page head's title (`.page-head-title`) shows its whole text as its hint
 * (`data-tip`, a summary) while the head is too narrow for it, and none
 * otherwise. Pass the returned ref to the title.
 */
export function usePageTitleTip<T extends HTMLElement>() {
  const stop = useRef<(() => void) | undefined>(undefined);
  return useCallback((title: T | null) => {
    stop.current?.();
    stop.current = undefined;
    if (!title) return;
    const sync = () => {
      const tip = cutTitle(title);
      if (tip) {
        if (title.dataset.tip !== tip) title.dataset.tip = tip;
        title.dataset.summary = "";
      } else if (title.dataset.tip !== undefined) {
        delete title.dataset.tip;
        delete title.dataset.summary;
      }
    };
    const sized = new ResizeObserver(sync);
    sized.observe(title);
    // The title's words change while its box keeps its width (it takes what the tools leave).
    const changed = new MutationObserver(sync);
    changed.observe(title, { childList: true, subtree: true, characterData: true });
    sync();
    stop.current = () => {
      sized.disconnect();
      changed.disconnect();
    };
  }, []);
}
