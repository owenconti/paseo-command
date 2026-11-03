import { useEffect, type RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { plainText } from "../ui";
import { FIND_LIMIT, type FindMatch, type FindOptions } from "./diffSearch";

/**
 * Find in the diff, on the page: the strip over the diff, its matches marked
 * in @pierre/diffs's shadow roots with the CSS Custom Highlight API (so the
 * drawn lines are never touched), and the scroll to a match through the
 * virtualizer, which draws only the lines near the view.
 */

const HIGHLIGHT = { all: "gd-find", current: "gd-find-current" };

/** The marks' colours, inside each file's shadow root (FileDiff's `unsafeCSS`). */
export const FIND_CSS = `
::highlight(${HIGHLIGHT.all}) { background-color: rgba(255, 196, 0, 0.38); }
::highlight(${HIGHLIGHT.current}) { background-color: rgb(255, 150, 20); color: #1b1300; }
`;

type Registry = { set(name: string, h: unknown): void; delete(name: string): void };
const registry = () => (CSS as unknown as { highlights?: Registry }).highlights;
const HighlightCtor = () => (window as unknown as { Highlight?: new (...r: Range[]) => { priority: number } }).Highlight;

export function clearFindMarks() {
  registry()?.delete(HIGHLIGHT.all);
  registry()?.delete(HIGHLIGHT.current);
}

/** A file's section, and the shadow root @pierre/diffs draws its lines in. */
const sectionOf = (scroller: HTMLElement, path: string) => scroller.querySelector<HTMLElement>(`.gd-file[data-path="${CSS.escape(path)}"]`);
const rootOf = (section: Element) => section.querySelector("diffs-container")?.shadowRoot ?? null;

/** A drawn line's key, as `shownLines` names it: its side and number (an unchanged line's in the split's left column is its old one). */
function keyOf(el: HTMLElement): string | undefined {
  const n = el.dataset.line;
  const type = el.dataset.lineType;
  if (!n || !type) return undefined;
  if (type === "change-deletion") return `L${n}`;
  if (type === "change-addition") return `R${n}`;
  return el.closest("code")?.hasAttribute("data-deletions") ? `L${n}` : `R${n}`;
}
const drawnLines = (root: ShadowRoot) => [...root.querySelectorAll<HTMLElement>("[data-line][data-line-type]")];

/** The range of characters `start`–`end` of a drawn line's text. */
function rangeIn(el: HTMLElement, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0;
  let began = false;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.data.length;
    if (!began && start < at + len) {
      range.setStart(node, start - at);
      began = true;
    }
    if (began && end <= at + len) {
      range.setEnd(node, end - at);
      return range;
    }
    at += len;
  }
  return null;
}

/** Marks the matches on the lines drawn now (the current one apart); none when the browser can't. */
export function paintFinds(scroller: HTMLElement, byPath: Map<string, Map<string, FindMatch[]>>, current: FindMatch | undefined) {
  const reg = registry();
  const Ctor = HighlightCtor();
  if (!reg || !Ctor) return;
  const all: Range[] = [];
  const now: Range[] = [];
  for (const [path, byKey] of byPath) {
    const section = sectionOf(scroller, path);
    const root = section && rootOf(section);
    if (!root) continue;
    for (const el of drawnLines(root)) {
      const key = keyOf(el);
      for (const m of (key && byKey.get(key)) || []) {
        const range = rangeIn(el, m.start, m.end);
        if (range) (m === current ? now : all).push(range);
      }
    }
  }
  reg.set(HIGHLIGHT.all, new Ctor(...all));
  const mark = new Ctor(...now);
  mark.priority = 1;
  reg.set(HIGHLIGHT.current, mark);
}

/**
 * Repaints the marks while the find is on: when the diff scrolls and when
 * @pierre/diffs draws lines (each file's shadow root watched as it appears).
 */
export function useFindPaint(
  scrollerOf: () => HTMLElement | null,
  byPath: Map<string, Map<string, FindMatch[]>> | null,
  current: FindMatch | undefined,
) {
  useEffect(() => {
    const scroller = scrollerOf();
    if (!byPath || !scroller) {
      clearFindMarks();
      return;
    }
    let frame = 0;
    const watched = new WeakSet<Node>();
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const watch = new MutationObserver(schedule);
    const paint = () => {
      frame = 0;
      for (const host of scroller.querySelectorAll("diffs-container")) {
        const root = host.shadowRoot;
        if (root && !watched.has(root)) {
          watched.add(root);
          watch.observe(root, { childList: true, subtree: true, characterData: true });
        }
      }
      paintFinds(scroller, byPath, current);
    };
    watch.observe(scroller, { childList: true, subtree: true });
    scroller.addEventListener("scroll", schedule, { passive: true });
    paint();
    return () => {
      cancelAnimationFrame(frame);
      watch.disconnect();
      scroller.removeEventListener("scroll", schedule);
      clearFindMarks();
    };
  }, [byPath, current]);
}

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

/**
 * Scrolls a match to the middle of the diff. Its file may not be drawn yet
 * (the virtualizer draws only the lines near the view): it scrolls to where
 * the line should be, judged from the nearest drawn line (else the file's
 * top) and the lines between, and looks again, until the line is drawn.
 * `order` is the file's line keys in the order they show; `live` answers
 * false once another reveal (or a close) has superseded this one.
 */
export async function revealMatch(scroller: HTMLElement, m: FindMatch, order: Map<string, number>, live: () => boolean) {
  for (let tries = 0; tries < 24 && live(); tries++) {
    const section = sectionOf(scroller, m.path);
    const box = scroller.getBoundingClientRect();
    const offset = (el: Element) => scroller.scrollTop + el.getBoundingClientRect().top - box.top;
    if (!section) {
      await nextFrame();
      continue;
    }
    const root = rootOf(section);
    const lines = root ? drawnLines(root) : [];
    // The match's own line; in a split, an unchanged line's right column.
    const own = lines.filter((el) => {
      const k = keyOf(el);
      return k === m.key || (m.alt !== undefined && k === m.alt);
    });
    const target = own.find((el) => keyOf(el) === m.key) ?? own[0];
    if (target) {
      const r = target.getBoundingClientRect();
      if (r.top < box.top + 40 || r.bottom > box.bottom - 40) scroller.scrollTop = offset(target) - scroller.clientHeight / 2 + r.height / 2;
      return;
    }
    let y: number;
    let nearest: { el: HTMLElement; at: number } | undefined;
    for (const el of lines) {
      const at = order.get(keyOf(el) ?? "");
      if (at !== undefined && (!nearest || Math.abs(at - m.line) < Math.abs(nearest.at - m.line))) nearest = { el, at };
    }
    if (nearest) {
      const height = nearest.el.getBoundingClientRect().height || 20;
      y = offset(nearest.el) + (m.line - nearest.at) * height;
    } else y = offset(section) + 40 + m.line * 20;
    scroller.scrollTop = y - scroller.clientHeight / 2;
    await nextFrame();
    await nextFrame();
  }
}

/** Find in the diff's strip: the field and its count, case and pattern toggles, previous and next, and close. */
export function FindBar({
  input,
  query,
  options,
  count,
  at,
  capped,
  error,
  onQuery,
  onOptions,
  onStep,
  onClose,
}: {
  input: RefObject<HTMLInputElement | null>;
  query: string;
  options: FindOptions;
  count: number;
  /** The current match's index, from 0 (−1 for none). */
  at: number;
  capped: boolean;
  error?: string;
  onQuery: (q: string) => void;
  onOptions: (o: FindOptions) => void;
  onStep: (by: 1 | -1) => void;
  onClose: () => void;
}) {
  const status = error ?? (!query ? "" : count ? `${at + 1} of ${count}${capped ? "+" : ""}` : "No results");
  return (
    <div className="gd-find" role="search" aria-label="Find in the diff">
      <label className="gd-find-field">
        <Search size={13} aria-hidden="true" />
        <input
          {...plainText}
          ref={input}
          type="search"
          value={query}
          spellCheck={false}
          aria-label="Find in the diff"
          aria-invalid={!!error}
          placeholder="Find in the diff…"
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }
          }}
        />
        <span className={`gd-find-count${error ? " error" : ""}`} aria-live="polite" title={capped ? `The first ${FIND_LIMIT.toLocaleString()} matches` : undefined}>
          {status}
        </span>
      </label>
      <button
        className={`icon-btn gd-find-toggle${options.caseSensitive ? " on" : ""}`}
        aria-label="Match case"
        aria-pressed={options.caseSensitive}
        data-tip="Match case"
        onClick={() => onOptions({ ...options, caseSensitive: !options.caseSensitive })}
      >
        Aa
      </button>
      <button
        className={`icon-btn gd-find-toggle${options.regex ? " on" : ""}`}
        aria-label="Regular expression"
        aria-pressed={options.regex}
        data-tip="Regular expression"
        onClick={() => onOptions({ ...options, regex: !options.regex })}
      >
        .*
      </button>
      <button className="icon-btn" aria-label="Previous match" data-tip="Previous (⇧↩)" disabled={!count} onClick={() => onStep(-1)}>
        <ChevronUp size={14} aria-hidden="true" />
      </button>
      <button className="icon-btn" aria-label="Next match" data-tip="Next (↩)" disabled={!count} onClick={() => onStep(1)}>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <button className="icon-btn gd-find-close" aria-label="Close the find bar" data-tip="Close (Esc)" onClick={onClose}>
        <X size={13} aria-hidden="true" />
      </button>
    </div>
  );
}
