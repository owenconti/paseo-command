/**
 * The agent's workspace's pending diff comments (left on its Changes diff,
 * `github/localComments.ts`), above the composer: "N pending comments ·
 * Apply" sends them to the agent as one message (queued while it works),
 * then marks them applied. Their list opens beneath it to review them first,
 * each removable, or discard them all.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, GitBranch, MessageSquare, Send, Trash2, X } from "lucide-react";
import { onAppCommand, runAppCommand } from "../appCommands";
import { pendingLabel, placeLabel, type LocalComment } from "../github/localComments";
import { applyLocalComments, useLocalComments } from "../github/localCommentsStore";

/** Quoted lines shown per comment in the list; the message has them all. */
const SHOWN_LINES = 3;

export function PendingComments({
  host,
  workspace,
  agentId,
  disabled,
  onSend,
  onNotice,
}: {
  host?: string;
  workspace: string;
  agentId: string;
  disabled: boolean;
  /** Sends (or queues) the message through the chat's own path; answers whether it went. */
  onSend: (text: string) => Promise<boolean>;
  onNotice: (message: string) => void;
}) {
  const { pending, change } = useLocalComments(host, workspace, onNotice);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!pending.length) {
      setOpen(false);
      setConfirming(false);
    }
  }, [pending.length]);

  const apply = async () => {
    if (sending || disabled || !pending.length) return;
    setSending(true);
    const ok = await applyLocalComments(host, workspace, pending, agentId, onSend, onNotice);
    setSending(false);
    if (ok) {
      setOpen(false);
      onNotice(`Sent ${pendingLabel(pending.length)} to the agent`);
    }
  };
  // ⌘K's Apply and Show.
  const latest = useRef(apply);
  latest.current = apply;
  useEffect(() => {
    const offs = [
      onAppCommand("diff-comments-apply", () => void latest.current()),
      onAppCommand("diff-comments-show", () => {
        setOpen(true);
        requestAnimationFrame(() => root.current?.scrollIntoView({ block: "nearest" }));
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  if (!pending.length) return null;
  return (
    <section ref={root} className={`pending-comments${open ? " open" : ""}`} aria-label="Pending diff comments">
      <div className="pending-comments-bar">
        <button
          type="button"
          className="pending-comments-toggle"
          aria-expanded={open}
          aria-controls="pending-comments-list"
          title={open ? "Hide them" : "Review them before applying"}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          <MessageSquare size={13} aria-hidden="true" />
          {pendingLabel(pending.length)}
        </button>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          className="pending-comments-apply"
          disabled={disabled || sending}
          title="Send them to the agent as one message"
          onClick={() => void apply()}
        >
          <Send size={12} aria-hidden="true" />
          {sending ? "Applying…" : "Apply"}
        </button>
      </div>
      {open && (
        <div id="pending-comments-list" className="pending-comments-list">
          <ul>
            {pending.map((c) => (
              <PendingItem key={c.id} comment={c} onRemove={() => void change({ action: "remove", id: c.id })} />
            ))}
          </ul>
          <div className="pending-comments-foot">
            <button type="button" className="ghost-btn" onClick={() => runAppCommand("github-branch-changes")}>
              <GitBranch size={12} aria-hidden="true" />
              Show the changes
            </button>
            <span className="pending-comments-spacer" />
            {confirming ? (
              <>
                <span>Discard {pending.length === 1 ? "it" : `all ${pending.length}`}?</span>
                <button type="button" className="ghost-btn" onClick={() => setConfirming(false)}>
                  Keep
                </button>
                <button
                  type="button"
                  className="ghost-btn danger"
                  onClick={() => {
                    setConfirming(false);
                    void change({ action: "discard" });
                  }}
                >
                  Discard
                </button>
              </>
            ) : (
              <button type="button" className="ghost-btn" onClick={() => setConfirming(true)}>
                <Trash2 size={12} aria-hidden="true" />
                Discard all
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function PendingItem({ comment: c, onRemove }: { comment: LocalComment; onRemove: () => void }) {
  const lines = c.text.slice(0, SHOWN_LINES);
  return (
    <li className="pending-comment">
      <div className="pending-comment-head">
        <code title={c.path}>{placeLabel(c)}</code>
        <button type="button" className="ask-dismiss" aria-label={`Remove the comment on ${placeLabel(c)}`} title="Remove" onClick={onRemove}>
          <X size={12} aria-hidden="true" />
        </button>
      </div>
      {lines.length > 0 && (
        <pre className="pending-comment-quote">
          {lines.join("\n")}
          {c.text.length > SHOWN_LINES ? "\n…" : ""}
        </pre>
      )}
      <p className="pending-comment-body">{c.body}</p>
    </li>
  );
}
