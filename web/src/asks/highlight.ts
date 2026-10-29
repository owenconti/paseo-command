/**
 * Where a reply's detected questions came from: their sentences marked in
 * the transcript's message, with the CSS Custom Highlight API so the
 * rendered Markdown is never touched.
 */

const NAME = "ask-source";

/** Ranges of `texts` in `root`'s rendered text, matched ignoring spacing
 *  (sentences were taken from the Markdown with its marks removed). */
export function sourceRanges(root: Node, texts: string[]): Range[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  // The text with all whitespace removed, and where each character came from.
  let flat = "";
  const at: { node: Text; offset: number }[] = [];
  for (const node of nodes)
    for (let i = 0; i < node.data.length; i++)
      if (!/\s/.test(node.data[i])) {
        flat += node.data[i];
        at.push({ node, offset: i });
      }
  const ranges: Range[] = [];
  for (const text of texts) {
    const key = text.replace(/\s+/g, "");
    if (!key) continue;
    const start = flat.lastIndexOf(key);
    if (start < 0) continue;
    const first = at[start];
    const last = at[start + key.length - 1];
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset + 1);
    ranges.push(range);
  }
  return ranges;
}

/** Mark `texts` in the reply `messageId` (the newest reply without one),
 *  scrolling the first into view; nothing when the browser can't. */
export function highlightSource(messageId: string | undefined, texts: string[]) {
  clearSource();
  const highlights = (CSS as { highlights?: Map<string, unknown> }).highlights;
  const Ctor = (window as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!highlights || !Ctor || !texts.length) return;
  const replies = [...document.querySelectorAll<HTMLElement>(".msg.assistant")].reverse();
  const root = messageId
    ? replies.find((el) => el.dataset.messageId === messageId)
    : replies[0];
  if (!root) return;
  const ranges = sourceRanges(root, texts);
  if (!ranges.length) return;
  highlights.set(NAME, new Ctor(...ranges));
  const box = ranges[0].getBoundingClientRect();
  if (box.top < 0 || box.bottom > window.innerHeight)
    ranges[0].startContainer.parentElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

export function clearSource() {
  (CSS as { highlights?: Map<string, unknown> }).highlights?.delete(NAME);
}
