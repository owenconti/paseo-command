import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CornerDownRight, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { ago, readStore, removeStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { Markdown } from "../Markdown";
import { Person } from "./bits";
import { placeBelow } from "./Picker";
import { linearImages } from "./prompt";
import { clearPending, linearStore, loadIssue, markPending, useLinear } from "./store";
import type { LinearComment, LinearUser } from "./types";

/** The reactions the picker offers. */
const EMOJI = ["👍", "👎", "😄", "🎉", "😕", "❤️", "🚀", "👀"];
/** Linear may name an emoji by its shortcode; shown (and matched) as the emoji itself. */
const SHORTCODE: Record<string, string> = {
  "+1": "👍",
  thumbsup: "👍",
  "-1": "👎",
  thumbsdown: "👎",
  smile: "😄",
  tada: "🎉",
  confused: "😕",
  heart: "❤️",
  rocket: "🚀",
  eyes: "👀",
};
const shown = (emoji: string) => SHORTCODE[emoji] ?? emoji;

/** Where a composer keeps what's typed until it's sent: the issue, and the thread a reply is for. */
const draftKey = (issueId: string, parentId?: string) => `linear:draft:${issueId}${parentId ? `:${parentId}` : ""}`;

type Thread = { root: LinearComment; replies: LinearComment[] };

/** The comments as threads: each top-level one with its replies, oldest first. */
function threadsOf(comments: LinearComment[]): Thread[] {
  const byTime = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ids = new Set(byTime.map((c) => c.id));
  return byTime
    .filter((c) => !c.parentId || !ids.has(c.parentId))
    .map((root) => ({ root, replies: byTime.filter((c) => c.parentId === root.id) }));
}

const isSend = (e: React.KeyboardEvent) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey;

/**
 * A Markdown text box: ⌘↩ sends, Esc cancels (where there's something to go
 * back to), Preview shows the Markdown. With `draft`, what's typed is kept in
 * localStorage until it's sent, so a remount or reload keeps it. A send Linear
 * refuses keeps the text (the store's notice says why).
 */
function Composer({
  draft,
  label,
  placeholder,
  initial = "",
  sendLabel,
  autoFocus,
  onSend,
  onCancel,
  focusRef,
}: {
  draft?: string;
  label: string;
  placeholder: string;
  initial?: string;
  sendLabel: string;
  autoFocus?: boolean;
  /** True once Linear has it. */
  onSend: (body: string) => Promise<boolean>;
  onCancel?: () => void;
  focusRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const [text, setText] = useState(() => (draft ? readStore<string>(draft, initial) : initial));
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusRef) return;
    focusRef.current = () => {
      setPreview(false);
      requestAnimationFrame(() => box.current?.focus());
    };
    return () => {
      focusRef.current = null;
    };
  }, [focusRef]);
  // The box grows with what's typed, up to a point.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, 320)}px`;
  }, [text, preview]);

  const change = (next: string) => {
    setText(next);
    if (!draft) return;
    if (next) writeStore(draft, next);
    else removeStore(draft);
  };
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    const saved = await onSend(body).catch(() => false);
    setSending(false);
    if (!saved) return;
    if (draft) removeStore(draft);
    setText("");
    setPreview(false);
  };
  const empty = !text.trim();

  return (
    <div className="linear-composer">
      {preview ? (
        <div className="linear-composer-preview" aria-label={`${label} (preview)`}>
          {empty ? <p className="linear-note">Nothing to preview.</p> : <Markdown text={linearImages(text, location.origin)} />}
        </div>
      ) : (
        <textarea
          ref={box}
          aria-label={label}
          placeholder={placeholder}
          value={text}
          rows={2}
          autoFocus={autoFocus}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (isSend(e)) {
              e.preventDefault();
              e.stopPropagation();
              void send();
            } else if (e.key === "Escape" && onCancel) {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }
          }}
        />
      )}
      <div className="linear-composer-bar">
        <button
          type="button"
          className="ghost-btn linear-preview-toggle"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Write" : "Preview"}
        </button>
        <span className="linear-composer-hint" aria-hidden="true">
          ⌘↩
        </span>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="button" className="primary" disabled={empty || sending} onClick={() => void send()}>
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

/** Adds the viewer's reaction, or takes it away; the issue is then read again for the reactions' ids. */
async function toggleReaction(comment: LinearComment, emoji: string, viewerId: string): Promise<void> {
  const known = comment.reactions.find((r) => shown(r.emoji) === shown(emoji));
  const at = known ? known.userIds.indexOf(viewerId) : -1;
  const before = comment.reactions;
  // Shown at once; syncs leave the reactions alone until Linear answers.
  const after =
    at >= 0
      ? before
          .map((r) =>
            r === known
              ? { ...r, userIds: r.userIds.filter((_, i) => i !== at), ids: r.ids.filter((_, i) => i !== at) }
              : r,
          )
          .filter((r) => r.userIds.length > 0)
      : known
        ? before.map((r) => (r === known ? { ...r, userIds: [...r.userIds, viewerId], ids: [...r.ids, ""] } : r))
        : [...before, { emoji, userIds: [viewerId], ids: [""] }];
  markPending(comment.id, ["reactions"]);
  linearStore.patchComment(comment.id, { reactions: after });
  const saved =
    at >= 0
      ? await linearStore.write("reactionDelete", { id: known!.ids[at] })
      : await linearStore.write("reactionCreate", { commentId: comment.id, emoji: known?.emoji ?? emoji });
  clearPending(comment.id, ["reactions"]);
  if (!saved) linearStore.patchComment(comment.id, { reactions: before });
  const key = linearStore.getState().issues.get(comment.issueId)?.key;
  if (key) await loadIssue(key).catch(() => {});
}

/** A comment's reactions (each a toggle of yours) and the picker for another. */
function Reactions({ comment, viewerId, users }: { comment: LinearComment; viewerId?: string; users: LinearUser[] }) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  const placeMenu = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    if (!el) return;
    placeBelow(el);
    el.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!picking) return;
    const down = (e: MouseEvent) => {
      if (!menu.current?.parentElement?.contains(e.target as Node)) setPicking(false);
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [picking]);
  const toggle = (emoji: string) => {
    if (!viewerId || busy) return;
    setPicking(false);
    setBusy(true);
    void toggleReaction(comment, emoji, viewerId).finally(() => setBusy(false));
  };
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "Someone";

  return (
    <div className="linear-reactions" aria-label="Reactions" role="group" aria-busy={busy}>
      {comment.reactions.map((r) => {
        const mine = !!viewerId && r.userIds.includes(viewerId);
        return (
          <button
            key={r.emoji}
            type="button"
            className={`linear-reaction${mine ? " mine" : ""}`}
            aria-pressed={mine}
            aria-label={`${shown(r.emoji)} ${r.userIds.length}`}
            data-tip={r.userIds.map(name).join(", ")}
            disabled={!viewerId}
            onClick={() => toggle(r.emoji)}
          >
            {shown(r.emoji)} <span>{r.userIds.length}</span>
          </button>
        );
      })}
      <span className="menu-anchor">
        <button
          type="button"
          className="linear-reaction linear-reaction-add"
          aria-label="Add a reaction"
          aria-expanded={picking}
          data-tip="Add a reaction"
          disabled={!viewerId}
          onClick={() => setPicking((p) => !p)}
        >
          <SmilePlus size={13} aria-hidden="true" />
        </button>
        {picking && (
          <div
            ref={placeMenu}
            role="menu"
            aria-label="Reactions"
            className="popover-menu left linear-emoji-menu"
            onKeyDown={(e) => {
              e.stopPropagation();
              const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
              const i = items.indexOf(document.activeElement as HTMLElement);
              const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: items.length - 1 }[e.key as "Home"];
              if (e.key === "Escape") {
                e.preventDefault();
                setPicking(false);
              } else if (to !== undefined && items.length) {
                e.preventDefault();
                items[(to + items.length) % items.length].focus();
              }
            }}
          >
            {EMOJI.map((emoji) => (
              <button key={emoji} type="button" role="menuitem" tabIndex={-1} aria-label={emoji} onClick={() => toggle(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

/** One comment: who and when, its Markdown, reactions, and Reply, Resolve, Edit and Delete where they apply. */
function CommentItem({
  comment,
  reply,
  viewerId,
  users,
  onReply,
  onResolve,
}: {
  comment: LinearComment;
  reply: boolean;
  viewerId?: string;
  users: LinearUser[];
  onReply: () => void;
  /** Top-level comments only: resolves the thread. */
  onResolve?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const author = users.find((u) => u.id === comment.authorId);
  const mine = !!viewerId && comment.authorId === viewerId;
  const remove = async () => {
    setDeleting(true);
    const done = await linearStore.write("commentDelete", { id: comment.id });
    setDeleting(false);
    if (done) linearStore.removeComment(comment.id);
    else setConfirming(false);
  };

  return (
    <div className={`linear-comment${reply ? " reply" : ""}`} data-comment={comment.id}>
      <p className="linear-comment-head">
        <Person user={author} />
        <b>{author?.name ?? "Someone"}</b> <span>{ago(comment.createdAt)}</span>
        {comment.editedAt && <span>· edited</span>}
      </p>
      {editing ? (
        <Composer
          label="Edit comment"
          placeholder="Edit the comment…"
          initial={comment.body}
          sendLabel="Save"
          autoFocus
          onCancel={() => setEditing(false)}
          onSend={async (body) => {
            const saved =
              body === comment.body.trim() || (await linearStore.write("commentUpdate", { id: comment.id, body }));
            if (saved) setEditing(false);
            return saved;
          }}
        />
      ) : (
        <div className="linear-comment-body">
          <Markdown text={linearImages(comment.body, location.origin)} />
        </div>
      )}
      {!editing && (
        <div className="linear-comment-foot">
          <Reactions comment={comment} viewerId={viewerId} users={users} />
          {confirming ? (
            <span className="linear-confirm" role="group" aria-label="Delete this comment?">
              <span>Delete this comment?</span>
              <button type="button" className="danger" disabled={deleting} onClick={() => void remove()}>
                Delete
              </button>
              <button type="button" className="secondary" autoFocus onClick={() => setConfirming(false)}>
                Keep
              </button>
            </span>
          ) : (
            <span className="linear-comment-actions">
              <button type="button" className="ghost-btn" onClick={onReply}>
                <CornerDownRight size={12} aria-hidden="true" />
                Reply
              </button>
              {onResolve && (
                <button type="button" className="ghost-btn" onClick={onResolve}>
                  <Check size={12} aria-hidden="true" />
                  Resolve
                </button>
              )}
              {mine && (
                <>
                  <button type="button" className="ghost-btn" onClick={() => setEditing(true)}>
                    <Pencil size={12} aria-hidden="true" />
                    Edit
                  </button>
                  <button type="button" className="ghost-btn linear-delete" onClick={() => setConfirming(true)}>
                    <Trash2 size={12} aria-hidden="true" />
                    Delete
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A thread: its first comment and replies, a reply box when asked for; resolved, one line with Unresolve. */
function ThreadView({
  thread,
  issueId,
  viewerId,
  users,
}: {
  thread: Thread;
  issueId: string;
  viewerId?: string;
  users: LinearUser[];
}) {
  const { root, replies } = thread;
  const draft = draftKey(issueId, root.id);
  // A reply already being written stays open.
  const [replying, setReplying] = useState(() => !!readStore<string>(draft, ""));
  const focusReply = useRef<(() => void) | null>(null);
  const author = users.find((u) => u.id === root.authorId);
  const resolve = (name: "commentResolve" | "commentUnresolve") => void linearStore.write(name, { id: root.id });
  const reply = () => {
    setReplying(true);
    focusReply.current?.();
  };

  if (root.resolvedAt)
    return (
      <div className="linear-thread resolved">
        <Check size={13} aria-hidden="true" className="linear-thread-check" />
        <span className="linear-thread-line">
          <b>{author?.name ?? "Someone"}</b>
          <span className="linear-thread-excerpt">{root.body.replace(/\s+/g, " ").slice(0, 140)}</span>
        </span>
        <span className="linear-thread-meta">
          Resolved{replies.length > 0 ? ` · ${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : ""}
        </span>
        <button type="button" className="ghost-btn" onClick={() => resolve("commentUnresolve")}>
          Unresolve
        </button>
      </div>
    );

  return (
    <div className="linear-thread">
      <CommentItem
        comment={root}
        reply={false}
        viewerId={viewerId}
        users={users}
        onReply={reply}
        onResolve={() => resolve("commentResolve")}
      />
      {replies.map((c) => (
        <CommentItem key={c.id} comment={c} reply viewerId={viewerId} users={users} onReply={reply} />
      ))}
      {replying && (
        <div className="linear-reply-box">
          <Composer
            draft={draft}
            label={`Reply to ${author?.name ?? "the thread"}`}
            placeholder="Reply…"
            sendLabel="Reply"
            autoFocus
            focusRef={focusReply}
            // Closing keeps what's typed: Reply brings it back.
            onCancel={() => setReplying(false)}
            onSend={async (body) => {
              const saved = await linearStore.write("commentCreate", { issueId, body, parentId: root.id });
              if (saved) setReplying(false);
              return saved;
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * An issue's comments, read and written in place: threads (top-level comments
 * oldest first, replies under each), reactions, Reply, Resolve, and Edit and
 * Delete on your own; a composer at the bottom, which ⌘K's "Comment on" focuses.
 */
export function Comments({ issueId }: { issueId: string }) {
  const all = useLinear((d) => d.comments);
  const viewerId = useLinear((d) => d.workspace?.viewerId);
  const users = useLinear((d) => d.workspace?.users) ?? [];
  const threads = useMemo(() => threadsOf([...all.values()].filter((c) => c.issueId === issueId)), [all, issueId]);
  const count = threads.reduce((n, t) => n + 1 + t.replies.length, 0);
  const focusComposer = useRef<(() => void) | null>(null);
  useEffect(() => onAppCommand("linear-comment", () => focusComposer.current?.()), []);

  return (
    <section className="linear-section linear-comments" aria-label="Comments">
      <h3>
        Comments {count > 0 && <span className="linear-count">{count}</span>}
      </h3>
      {threads.map((t) => (
        <ThreadView key={t.root.id} thread={t} issueId={issueId} viewerId={viewerId} users={users} />
      ))}
      <Composer
        key={issueId}
        draft={draftKey(issueId)}
        label="Write a comment"
        placeholder="Leave a comment… (Markdown)"
        sendLabel="Comment"
        focusRef={focusComposer}
        onSend={(body) => linearStore.write("commentCreate", { issueId, body })}
      />
    </section>
  );
}
