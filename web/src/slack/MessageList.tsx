import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, LoaderCircle } from "lucide-react";
import { dayLabel, dayOf } from "./bits";
import { MessageRow } from "./Message";
import { messageRows } from "./rows";
import type { ShownMessage } from "./store";

/** Within this of the bottom, the list counts as at the bottom (it follows new messages there). */
const BOTTOM_SLACK = 24;
/** Within this of the top, older messages are asked for. */
const OLDER_AT = 400;

/**
 * Messages, newest at the bottom, as Slack lists them: day dividers, sender
 * runs, a "New messages" line, and older ones loaded as you scroll up
 * (keeping your place). At the bottom it follows new messages; elsewhere
 * "Jump to recent" takes you there. A message to show (`highlightTs`) is
 * scrolled to and marked; with none, it opens at the newest, or at the line
 * when what's new runs further up than shows.
 */
export function MessageList({
  messages,
  self,
  unreadFrom,
  highlightTs,
  editingTs,
  onEdit,
  onThread,
  onLaunch,
  permalinkFor,
  onSelect,
  more,
  loadingOlder,
  onOlder,
  onBottom,
  intro,
  afterFirst,
  label,
}: {
  messages: ShownMessage[];
  self?: string;
  unreadFrom?: string;
  highlightTs?: string;
  editingTs?: string;
  onEdit: (ts: string | undefined) => void;
  onThread?: (ts: string) => void;
  onLaunch: (m: ShownMessage) => void;
  permalinkFor: (m: ShownMessage) => string | undefined;
  onSelect: (ts: string) => void;
  more?: boolean;
  loadingOlder?: boolean;
  onOlder?: () => void;
  /** Whether the newest message shows (the view marks read then). */
  onBottom?: (atBottom: boolean) => void;
  /** Above the first message once there are no older ones (the conversation's start). */
  intro?: ReactNode;
  /** After the first message (a thread's parent: its replies' count). */
  afterFirst?: ReactNode;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  /** The first placement, applied again as the layout settles until you scroll yourself. */
  const settling = useRef<(() => void) | null>(null);
  const settled = () => {
    settling.current = null;
  };
  const anchor = useRef<{ first?: string; fromBottom: number; atBottom: boolean; placed: boolean }>({ fromBottom: 0, atBottom: true, placed: false });
  const [atBottom, setAtBottom] = useState(true);
  const rows = useMemo(() => messageRows(messages, dayOf, unreadFrom, self), [messages, unreadFrom, self]);
  const first = messages.find((m) => !m.pending)?.ts;
  const firstRow = rows.findIndex((r) => r.kind === "message");

  const note = useCallback(() => {
    const box = el.current;
    if (!box) return;
    const bottom = box.scrollHeight - box.scrollTop - box.clientHeight < BOTTOM_SLACK;
    anchor.current.fromBottom = box.scrollHeight - box.scrollTop;
    anchor.current.first = first;
    if (bottom !== anchor.current.atBottom) {
      anchor.current.atBottom = bottom;
      setAtBottom(bottom);
      onBottom?.(bottom);
    }
  }, [first, onBottom]);

  const toBottom = useCallback(() => {
    const box = el.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, []);

  // Where the list stands as messages change: first placed, kept in place as older ones come in above, or following at the bottom.
  useLayoutEffect(() => {
    const box = el.current;
    if (!box || messages.length === 0) return;
    const a = anchor.current;
    if (!a.placed) {
      a.placed = true;
      const place = () => {
        toBottom();
        const target = highlightTs && box.querySelector<HTMLElement>(`[data-ts="${highlightTs}"]`);
        const line = box.querySelector<HTMLElement>(".slack-new-line");
        if (target) target.scrollIntoView({ block: "center" });
        else if (line) {
          // What's new runs further up than shows: the line at the top instead.
          const top = line.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
          if (top < box.scrollTop) box.scrollTop = top - 8;
        }
        note();
      };
      place();
      // Fonts, emoji and images settle after: placed again as they do, until you scroll.
      settling.current = place;
    } else if (a.first && first && a.first !== first) {
      box.scrollTop = box.scrollHeight - a.fromBottom;
    } else if (a.atBottom) toBottom();
    note();
    // Only as messages change; the rest is the scroll's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // A message asked for after the list was placed.
  useEffect(() => {
    if (!highlightTs || !anchor.current.placed) return;
    settling.current = null;
    el.current?.querySelector<HTMLElement>(`[data-ts="${highlightTs}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightTs]);

  // The box or what's in it changing size (the composer grows, the window resizes, images load) keeps the bottom in view.
  const inner = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = el.current;
    if (!box) return;
    const watch = new ResizeObserver(() => {
      if (settling.current) settling.current();
      else if (anchor.current.atBottom) toBottom();
      note();
    });
    watch.observe(box);
    if (inner.current) watch.observe(inner.current);
    return () => watch.disconnect();
  }, [toBottom, note]);

  const onScroll = () => {
    note();
    const box = el.current;
    if (box && box.scrollTop < OLDER_AT && more && !loadingOlder) onOlder?.();
  };
  // A list too short to scroll asks for older ones by itself.
  useEffect(() => {
    const box = el.current;
    if (box && more && !loadingOlder && box.scrollHeight <= box.clientHeight + OLDER_AT) onOlder?.();
  }, [messages, more, loadingOlder, onOlder]);

  return (
    <div className="slack-messages-wrap">
      <div
        className="slack-messages"
        ref={el}
        onScroll={onScroll}
        onWheel={settled}
        onPointerDown={settled}
        onTouchStart={settled}
        onKeyDown={settled}
        role="log"
        aria-label={label}
        aria-live="polite"
      >
        <div ref={inner}>
        {more ? (
          <p className="slack-loading-older" aria-live="polite">
            {loadingOlder ? <LoaderCircle size={14} className="spinning" aria-hidden="true" /> : null}
            {loadingOlder ? "Loading older messages…" : ""}
          </p>
        ) : (
          intro
        )}
        {rows.map((row, n) => {
          if (row.kind === "day")
            return (
              <div key={row.key} className="slack-day" role="separator">
                <span>{dayLabel(row.ts)}</span>
              </div>
            );
          if (row.kind === "new")
            return (
              <div key={row.key} className="slack-new-line" role="separator">
                <span>New</span>
              </div>
            );
          const m = row.message;
          return (
            <div key={row.key} className="slack-row">
              <MessageRow
                message={m}
                compact={row.compact}
                highlighted={m.ts === highlightTs}
                editing={m.ts === editingTs}
                onEdit={onEdit}
                onThread={onThread}
                onLaunch={onLaunch}
                permalink={permalinkFor(m)}
                onSelect={onSelect}
              />
              {n === firstRow && afterFirst}
            </div>
          );
        })}
        </div>
      </div>
      {!atBottom && messages.length > 0 && (
        <button
          type="button"
          className="slack-jump"
          onClick={() => {
            settling.current = null;
            toBottom();
          }}
        >
          <ArrowDown size={13} aria-hidden="true" />
          Jump to recent
        </button>
      )}
    </div>
  );
}
