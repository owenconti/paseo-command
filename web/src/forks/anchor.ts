/**
 * Where a fork's highlighted pieces stand in a reply's rendered text
 * (`textContent`), so they can be marked again after the reply re-renders.
 */
import type { Quote } from "./types";

/** The quote's place in `text`: where it was chosen, else where its words
 *  are now; null when they're gone. */
export function anchorQuote(
  text: string,
  q: Quote,
): { start: number; end: number } | null {
  if (text.slice(q.start, q.end) === q.text) return { start: q.start, end: q.end };
  const at = text.indexOf(q.text);
  return at < 0 ? null : { start: at, end: at + q.text.length };
}

/** A selection in a reply (offsets into its text), trimmed to its words;
 *  null when it holds none. */
export function quoteFromSelection(
  root: { textContent: string | null },
  start: number,
  end: number,
  reply: { key: string; messageId?: string },
): Quote | null {
  const text = root.textContent ?? "";
  const raw = text.slice(start, end);
  const words = raw.trim();
  if (!words) return null;
  const from = start + (raw.length - raw.trimStart().length);
  return {
    replyKey: reply.key,
    ...(reply.messageId ? { messageId: reply.messageId } : {}),
    text: words,
    start: from,
    end: from + words.length,
  };
}
