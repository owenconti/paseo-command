import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import { ArrowLeft, LoaderCircle, RefreshCw, X } from "lucide-react";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { permalinkOf } from "./prompt";
import { conversationTitle, loadThread, threadKey, useSlack, type ShownMessage } from "./store";

/**
 * A thread, beside the conversation (in its place when the window is
 * narrow): its parent, its replies and a composer that can also send the
 * reply to the channel.
 */
export function Thread({
  conversationId,
  threadTs,
  highlightTs,
  beside,
  onClose,
  onLaunch,
  onSelect,
  composerFocus,
}: {
  conversationId: string;
  threadTs: string;
  highlightTs?: string;
  /** Beside the conversation (Close), or in its place (Back). */
  beside: boolean;
  onClose: () => void;
  onLaunch: (m: ShownMessage) => void;
  onSelect: (ts: string) => void;
  composerFocus: MutableRefObject<(() => void) | null>;
}) {
  const key = threadKey(conversationId, threadTs);
  const thread = useSlack((d) => d.threads.get(key));
  // The parent as the conversation has it, until the thread's read is in.
  const fallback = useSlack((d) => d.history.get(conversationId)?.messages.find((m) => m.ts === threadTs));
  const title = useSlack((d) => conversationTitle(d, d.conversations.get(conversationId)));
  const self = useSlack((d) => d.workspace?.selfId);
  const workspaceUrl = useSlack((d) => d.workspace?.url);
  const [editingTs, setEditingTs] = useState<string>();
  useEffect(() => {
    loadThread(conversationId, threadTs).catch(() => {});
  }, [conversationId, threadTs]);

  const parent = thread?.parent ?? fallback;
  const messages = useMemo(() => [...(parent ? [parent] : []), ...(thread?.replies ?? [])], [parent, thread?.replies]);
  const count = thread?.loaded ? thread.replies.filter((m) => !m.pending).length : (parent?.replyCount ?? 0);
  const permalinkFor = useCallback(
    (m: ShownMessage) => (m.pending ? undefined : permalinkOf(workspaceUrl, conversationId, m.ts, threadTs)),
    [workspaceUrl, conversationId, threadTs],
  );
  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.userId === self && !m.pending && !m.botName && !m.subtype);
    if (mine) setEditingTs(mine.ts);
  };

  return (
    <aside className="slack-thread" id="slack-thread" aria-label={`Thread in ${title}`}>
      <header className="slack-conv-head">
        {!beside && (
          <button type="button" className="icon-btn" aria-label="Back to the conversation" data-tip="Back (Esc)" onClick={onClose}>
            <ArrowLeft size={15} aria-hidden="true" />
          </button>
        )}
        <h2>
          Thread <span className="slack-thread-where">{title}</span>
        </h2>
        {beside && (
          <button type="button" className="icon-btn" aria-label="Close the thread" data-tip="Close (Esc)" onClick={onClose}>
            <X size={15} aria-hidden="true" />
          </button>
        )}
      </header>
      {thread?.error && !thread.loaded ? (
        <div className="slack-empty">
          <p>{thread.error}</p>
          <button type="button" className="secondary" onClick={() => void loadThread(conversationId, threadTs, true).catch(() => {})}>
            <RefreshCw size={12} aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : messages.length === 0 ? (
        <div className="slack-empty" aria-busy="true">
          <LoaderCircle size={16} className="spinning" aria-hidden="true" />
        </div>
      ) : (
        <MessageList
          key={key}
          label={`Replies in the thread`}
          messages={messages}
          self={self}
          highlightTs={highlightTs}
          editingTs={editingTs}
          onEdit={setEditingTs}
          onLaunch={onLaunch}
          permalinkFor={permalinkFor}
          onSelect={onSelect}
          afterFirst={
            count > 0 ? (
              <div className="slack-replies-line" role="separator">
                <span>
                  {count} {count === 1 ? "reply" : "replies"}
                </span>
              </div>
            ) : undefined
          }
        />
      )}
      <footer className="slack-conv-foot">
        <Composer
          key={key}
          conversationId={conversationId}
          threadTs={threadTs}
          placeholder="Reply…"
          broadcastTo={title}
          onEditLast={editLast}
          focusRef={composerFocus}
          autoFocus
        />
      </footer>
    </aside>
  );
}
