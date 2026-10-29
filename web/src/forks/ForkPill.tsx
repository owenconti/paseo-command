/**
 * The small pill beside a selection in a settled reply: Ask about it in a
 * fork, or Add it to the pieces collected for one question.
 */
import { useEffect, useState, type RefObject } from "react";
import { GitFork, Plus } from "lucide-react";
import { quoteFromSelection } from "./anchor";
import { offsetsIn, replyOf } from "./marks";
import type { Quote } from "./types";
import { UNSUPPORTED } from "./useReplyForks";

type Chosen = { quote: Quote; top: number; left: number };

/** The selection, if it lies within one settled reply of `root`. */
function chosen(root: HTMLElement): Chosen | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const reply = replyOf(range.startContainer);
  if (
    !reply ||
    reply !== replyOf(range.endContainer) ||
    !root.contains(reply) ||
    reply.closest(".fork-pane") ||
    reply.dataset.live === "true"
  )
    return null;
  const { start, end } = offsetsIn(reply, range);
  const quote = quoteFromSelection(reply, start, end, {
    key: reply.dataset.replyKey!,
    messageId: reply.dataset.messageId,
  });
  if (!quote) return null;
  const at = range.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  // Beside the selection, kept within the visible session.
  const below = Math.min(Math.max(at.bottom - box.top + 6, 8), box.height - 40);
  return {
    quote,
    top: below + root.scrollTop,
    left: Math.max(8, Math.min(at.left - box.left, box.width - 190)),
  };
}

export function ForkPill({
  root,
  supported,
  onAsk,
  onAdd,
}: {
  root: RefObject<HTMLElement | null>;
  supported: boolean;
  onAsk: (q: Quote) => void;
  onAdd: (q: Quote) => void;
}) {
  const [at, setAt] = useState<Chosen | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const el = root.current;
        setAt(el ? chosen(el) : null);
      }, 60);
    };
    document.addEventListener("selectionchange", read);
    document.addEventListener("mouseup", read);
    document.addEventListener("keyup", read);
    // The conversation scrolls under it: follow the selection.
    const el = root.current;
    el?.addEventListener("scroll", read, true);
    return () => {
      el?.removeEventListener("scroll", read, true);
      clearTimeout(timer);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("mouseup", read);
      document.removeEventListener("keyup", read);
    };
  }, [root]);
  if (!at) return null;
  const take = (fn: (q: Quote) => void) => () => {
    fn(at.quote);
    getSelection()?.removeAllRanges();
    setAt(null);
  };
  return (
    <div
      className="fork-pill"
      role="toolbar"
      aria-label="Ask about the selection"
      title={supported ? undefined : UNSUPPORTED}
      style={{ top: at.top, left: at.left }}
      // Keep the selection while a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button type="button" disabled={!supported} onClick={take(onAsk)}>
        <GitFork size={13} aria-hidden="true" />
        Ask
      </button>
      <button
        type="button"
        aria-label="Add to question"
        disabled={!supported}
        onClick={take(onAdd)}
      >
        <Plus size={13} aria-hidden="true" />
        Add
      </button>
    </div>
  );
}
