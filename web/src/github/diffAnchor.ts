import { useEffect } from "react";

/**
 * What the diff's view is anchored on: the first line drawn at or below its
 * top edge (else its file's top), and where each sat in the scrolled content.
 */
type Anchor = { path: string; line?: string; lineTop?: number; fileTop: number; scrollTop: number };

/** An element's distance from the top of the scroller's content (not its view). */
const contentTop = (scroller: HTMLElement, el: Element) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;

const sectionOf = (scroller: HTMLElement, path: string) => scroller.querySelector<HTMLElement>(`.gd-file[data-path="${CSS.escape(path)}"]`);
const linesOf = (section: HTMLElement) => section.querySelector("diffs-container")?.shadowRoot?.querySelectorAll<HTMLElement>("[data-line][data-line-index]") ?? [];

function pickAnchor(scroller: HTMLElement): Anchor | null {
  const top = scroller.getBoundingClientRect().top;
  for (const section of scroller.querySelectorAll<HTMLElement>(".gd-file")) {
    if (section.getBoundingClientRect().bottom <= top) continue;
    const path = section.dataset.path;
    if (!path) return null;
    const fileTop = contentTop(scroller, section);
    for (const line of linesOf(section)) {
      if (line.getBoundingClientRect().top < top) continue;
      return { path, line: line.dataset.lineIndex, lineTop: contentTop(scroller, line), fileTop, scrollTop: scroller.scrollTop };
    }
    return { path, fileTop, scrollTop: scroller.scrollTop };
  }
  return null;
}

/** How far the anchor has moved in the content since it was picked: by its line while that's drawn, else its file. */
function drift(scroller: HTMLElement, a: Anchor): number {
  const section = sectionOf(scroller, a.path);
  if (!section) return 0;
  if (a.line !== undefined && a.lineTop !== undefined) {
    const line = section
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector<HTMLElement>(`[data-line][data-line-index="${CSS.escape(a.line)}"]`);
    if (line) return contentTop(scroller, line) - a.lineTop;
  }
  return contentTop(scroller, section) - a.fileTop;
}

/**
 * Keeps what's under the diff's view in place while what's above it changes
 * height: @pierre/diffs drawing a file's lines over its estimate (wrapped
 * lines, highlighting), a refresh bringing a file with more or fewer lines,
 * threads opening. The first line in view keeps its place in the content:
 * scrolling (yours, a jump to a file or match) moves the view over the
 * content and changes nothing here; content moving under a still view is
 * scrolled back, before it's painted (the resize observer runs after layout).
 * WebKit (the macOS app's page) has no CSS scroll anchoring, and Chromium's is
 * turned off on the scroller (`overflow-anchor: none`) so both behave alike.
 */
export function useDiffAnchor(scrollerOf: () => HTMLElement | null) {
  useEffect(() => {
    const scroller = scrollerOf();
    const content = scroller?.firstElementChild;
    if (!scroller || !content) return;
    let anchor: Anchor | null = null;
    const hold = () => {
      // Hidden (another tab shows), nothing measures: pick again once shown.
      if (!scroller.clientHeight) {
        anchor = null;
        return;
      }
      // Scrolled more than a screen away (a jump to a file or a match), the old anchor's
      // lines are no longer drawn and say nothing about what's in view now.
      if (anchor && Math.abs(scroller.scrollTop - anchor.scrollTop) <= scroller.clientHeight) {
        const by = drift(scroller, anchor);
        if (Math.abs(by) >= 0.5) scroller.scrollTop += by;
      }
      anchor = pickAnchor(scroller);
    };
    // Each file's section too, so heights trading places above the view (one file growing, another shrinking) count.
    const resize = new ResizeObserver(hold);
    const watched = new WeakSet<Element>();
    const watchSections = () => {
      for (const section of content.querySelectorAll(":scope > .gd-file")) {
        if (watched.has(section)) continue;
        watched.add(section);
        resize.observe(section);
      }
    };
    resize.observe(content);
    watchSections();
    const added = new MutationObserver(watchSections);
    added.observe(content, { childList: true });
    let frame = 0;
    const onScroll = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          hold();
        });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    hold();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      added.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, []);
}
