/**
 * Reply text in the DOM: where a selection stands in a reply, and the
 * forks' highlights, drawn with the CSS Custom Highlight API so the
 * rendered Markdown is never rewritten.
 */
import { anchorQuote } from "./anchor";
import type { Quote } from "./types";

export const REPLY = ".msg.assistant[data-reply-key]";

/** The reply element holding `node`, if any. */
export const replyOf = (node: Node | null) =>
  (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(
    REPLY,
  ) ?? null;

/** Where `range` starts and ends in `root`'s text. */
export function offsetsIn(root: Element, range: Range) {
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

/** A range over `root`'s text from `start` to `end`. */
export function rangeIn(root: Element, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0;
  let begun = false;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const next = at + n.data.length;
    if (!begun && start < next) {
      range.setStart(n, start - at);
      begun = true;
    }
    if (begun && end <= next) {
      range.setEnd(n, end - at);
      return range;
    }
    at = next;
  }
  return null;
}

/** The reply a quote came from, in `root`. */
export function replyFor(root: Element, q: Quote) {
  const byKey = [...root.querySelectorAll<HTMLElement>(REPLY)].find(
    (el) => el.dataset.replyKey === q.replyKey,
  );
  return (
    byKey ??
    (q.messageId
      ? [...root.querySelectorAll<HTMLElement>(REPLY)].find(
          (el) => el.dataset.messageId === q.messageId,
        )
      : undefined) ??
    null
  );
}

const painted = new Set<string>();
/** Draw each group's quotes under its highlight name; clear the others. */
export function paintMarks(
  root: Element,
  groups: { name: string; quotes: Quote[] }[],
) {
  const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } })
    .CSS?.highlights;
  const Highlight = (globalThis as { Highlight?: new (...r: Range[]) => unknown })
    .Highlight;
  if (!highlights || !Highlight) return;
  for (const name of painted) highlights.delete(name);
  painted.clear();
  for (const { name, quotes } of groups) {
    const ranges: Range[] = [];
    for (const q of quotes) {
      const reply = replyFor(root, q);
      const at = reply && anchorQuote(reply.textContent ?? "", q);
      const range = at && rangeIn(reply, at.start, at.end);
      if (range) ranges.push(range);
    }
    if (!ranges.length) continue;
    highlights.set(name, new Highlight(...ranges));
    painted.add(name);
  }
}
