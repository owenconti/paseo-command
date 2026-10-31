/**
 * The small pill beside a selection in a settled reply, or a block of it
 * (paragraph, list item, heading, code, quote or table row) picked with a
 * click: Ask about it in a fork, Add it to the pieces collected for one
 * question, or Answer it as a question in the next message.
 */
import { useEffect, useState, type RefObject } from "react";
import { GitFork, Plus, Reply } from "lucide-react";
import { quoteFromSelection } from "./anchor";
import { BLOCK, markPick, offsetsIn, rangeIn, replyFor, replyOf } from "./marks";
import type { Quote } from "./types";
import { UNSUPPORTED } from "./useReplyForks";

type Chosen = { quote: Quote; top: number; left: number };

const settled = (root: HTMLElement, reply: HTMLElement | null) =>
  !!reply &&
  root.contains(reply) &&
  !reply.closest(".fork-pane") &&
  reply.dataset.live !== "true";

/** The selection, if it lies within one settled reply of `root`. */
function chosen(root: HTMLElement): Chosen | null {
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  const reply = replyOf(range.startContainer);
  if (!settled(root, reply) || reply !== replyOf(range.endContainer)) return null;
  return place(root, reply!, range);
}

/** The block a plain click landed on, in a settled reply of `root`; not
 *  a link, button or field in it. */
function picked(root: HTMLElement, target: EventTarget | null): Chosen | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("a, button, input, textarea, select, summary, label")) return null;
  const reply = replyOf(target);
  const block = target.closest<HTMLElement>(BLOCK);
  if (!settled(root, reply) || !block || !reply!.contains(block)) return null;
  const range = document.createRange();
  range.selectNodeContents(block);
  return place(root, reply!, range);
}

/** The quote `range` holds in `reply`, and where its pill stands. */
function place(root: HTMLElement, reply: HTMLElement, range: Range): Chosen | null {
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
    left: Math.max(8, Math.min(at.left - box.left, box.width - 260)),
  };
}

export function ForkPill({
  root,
  supported,
  onAsk,
  onAdd,
  onAnswer,
}: {
  root: RefObject<HTMLElement | null>;
  supported: boolean;
  onAsk: (q: Quote) => void;
  onAdd: (q: Quote) => void;
  onAnswer: (q: Quote) => void;
}) {
  const [selected, setSelected] = useState<Chosen | null>(null);
  const [pick, setPick] = useState<Chosen | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const el = root.current;
        const now = el ? chosen(el) : null;
        setSelected(now);
        if (now) setPick(null);
      }, 60);
    };
    // A plain click (no text dragged over) picks the block under it.
    const click = (e: MouseEvent) => {
      const el = root.current;
      if (!el || (e.target instanceof Element && e.target.closest(".fork-pill"))) return;
      const sel = getSelection();
      if (sel && !sel.isCollapsed) return;
      setPick(e.button === 0 && !e.metaKey && !e.shiftKey ? picked(el, e.target) : null);
    };
    document.addEventListener("selectionchange", read);
    document.addEventListener("mouseup", read);
    document.addEventListener("keyup", read);
    // The conversation scrolls under it: follow the selection.
    const el = root.current;
    el?.addEventListener("scroll", read, true);
    document.addEventListener("click", click);
    return () => {
      el?.removeEventListener("scroll", read, true);
      document.removeEventListener("click", click);
      clearTimeout(timer);
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("mouseup", read);
      document.removeEventListener("keyup", read);
    };
  }, [root]);
  // The picked block stays marked while its pill shows; Escape lets it go
  // (ahead of the page's Escape, which would go back a selection).
  useEffect(() => {
    const el = root.current;
    if (!pick || !el) return;
    const reply = replyFor(el, pick.quote);
    const range = reply && rangeIn(reply, pick.quote.start, pick.quote.end);
    if (range) markPick(range);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setPick(null);
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      markPick(null);
    };
  }, [pick, root]);
  const at = selected ?? pick;
  if (!at) return null;
  const take = (fn: (q: Quote) => void) => () => {
    fn(at.quote);
    getSelection()?.removeAllRanges();
    setSelected(null);
    setPick(null);
  };
  return (
    <div
      className="fork-pill"
      role="toolbar"
      aria-label="Ask about the selection"
      style={{ top: at.top, left: at.left }}
      // Keep the selection while a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        type="button"
        disabled={!supported}
        title={supported ? undefined : UNSUPPORTED}
        onClick={take(onAsk)}
      >
        <GitFork size={13} aria-hidden="true" />
        Ask
      </button>
      <button
        type="button"
        aria-label="Add to question"
        disabled={!supported}
        title={supported ? undefined : UNSUPPORTED}
        onClick={take(onAdd)}
      >
        <Plus size={13} aria-hidden="true" />
        Add
      </button>
      <button
        type="button"
        aria-label="Answer in my message"
        title="Quote this as a question and answer it in your message"
        onClick={take(onAnswer)}
      >
        <Reply size={13} aria-hidden="true" />
        Answer
      </button>
    </div>
  );
}
