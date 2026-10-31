import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Hash, LoaderCircle, RefreshCw, Users } from "lucide-react";
import { ConversationIcon } from "./bits";
import { Composer } from "./Composer";
import { MessageList } from "./MessageList";
import { permalinkOf } from "./prompt";
import { MessageText } from "./rich";
import { compareTs, conversationTitle, loadConversation, loadHistory, loadOlder, slackStore, useSlack, type ShownMessage } from "./store";

/** How long the newest message shows (with the window focused) before the conversation is marked read. */
const MARK_AFTER_MS = 800;
/** Pages of older messages asked for at most to reach a message asked to show. */
const SEEK_PAGES = 6;

/** Whether the window has the user's attention: focused and not hidden. */
export function useAttention(): boolean {
  const read = () => typeof document !== "undefined" && !document.hidden && document.hasFocus();
  const [on, setOn] = useState(read);
  useEffect(() => {
    const update = () => setOn(read());
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return on;
}

/**
 * The open conversation: its name, topic and members, its messages (older
 * ones as you scroll up), and the composer. It's marked read as its newest
 * message shows while the window has your attention. A message asked to show
 * (a search hit, an Activity item) is scrolled to, older pages loaded until
 * it's reached.
 */
export function Conversation({
  conversationId,
  unreadFrom,
  highlightTs,
  onThread,
  onLaunch,
  onSelect,
  composerFocus,
  sidebarHidden,
}: {
  conversationId: string;
  /** Where you'd read to when it opened: the "New" line goes after it. */
  unreadFrom?: string;
  highlightTs?: string;
  onThread: (ts: string) => void;
  onLaunch: (m: ShownMessage) => void;
  onSelect: (ts: string) => void;
  composerFocus: MutableRefObject<(() => void) | null>;
  sidebarHidden: boolean;
}) {
  const conversation = useSlack((d) => d.conversations.get(conversationId));
  const title = useSlack((d) => conversationTitle(d, d.conversations.get(conversationId)));
  const list = useSlack((d) => d.history.get(conversationId));
  const self = useSlack((d) => d.workspace?.selfId);
  const workspaceUrl = useSlack((d) => d.workspace?.url);
  const known = useSlack((d) => d.conversations.has(conversationId));
  const [editingTs, setEditingTs] = useState<string>();
  const [atBottom, setAtBottom] = useState(true);
  const attention = useAttention();
  const messages = useMemo(() => list?.messages ?? [], [list?.messages]);

  useEffect(() => {
    if (!known) void loadConversation(conversationId).catch(() => {});
    loadHistory(conversationId).catch(() => {});
  }, [conversationId, known]);

  // Marked read once the newest message shows, while you're looking.
  const newest = [...messages].reverse().find((m) => !m.pending)?.ts;
  const unread = !!conversation && !!newest && (!conversation.lastRead || compareTs(newest, conversation.lastRead) > 0);
  useEffect(() => {
    if (!unread || !atBottom || !attention || !newest) return;
    const timer = setTimeout(() => void slackStore.markRead(conversationId, newest), MARK_AFTER_MS);
    return () => clearTimeout(timer);
  }, [unread, atBottom, attention, newest, conversationId]);

  // A message asked to show that's older than what's loaded: older pages until it's in (or there are no more).
  const seeking = useRef(0);
  useEffect(() => {
    seeking.current = 0;
  }, [highlightTs]);
  useEffect(() => {
    if (!highlightTs || !list?.loaded || list.loadingOlder) return;
    if (messages.some((m) => m.ts === highlightTs)) return;
    const oldest = messages.find((m) => !m.pending)?.ts;
    if (!list.more || !oldest || compareTs(highlightTs, oldest) > 0) return;
    if (seeking.current >= SEEK_PAGES) {
      slackStore.notice("That message is further back than the Slack tab reads; open it in Slack to see it.");
      return;
    }
    seeking.current++;
    void loadOlder(conversationId);
  }, [highlightTs, list, messages, conversationId]);

  const permalinkFor = useCallback(
    (m: ShownMessage) => (m.pending ? undefined : permalinkOf(workspaceUrl, conversationId, m.ts, m.threadTs)),
    [workspaceUrl, conversationId],
  );
  const older = useCallback(() => void loadOlder(conversationId), [conversationId]);
  const editLast = () => {
    const mine = [...messages].reverse().find((m) => m.userId === self && !m.pending && !m.botName && !m.subtype);
    if (mine) setEditingTs(mine.ts);
  };
  const channel = conversation?.kind === "channel" || conversation?.kind === "private";
  const intro = (
    <div className="slack-intro">
      <ConversationIcon conversation={conversation} size={22} />
      <h3>{channel ? `This is the very beginning of ${title}` : `This is the very beginning of your messages with ${title}`}</h3>
      {conversation?.purpose && <p>{conversation.purpose}</p>}
    </div>
  );

  return (
    <section className={`slack-conversation${sidebarHidden ? " sidebar-hidden" : ""}`} aria-label={title}>
      <header className="slack-conv-head">
        <h2>
          <ConversationIcon conversation={conversation} size={16} />
          <span className="slack-conv-name">{channel ? conversation?.name ?? "" : title}</span>
          {conversation?.isMuted && <span className="slack-tag">Muted</span>}
          {conversation?.isArchived && <span className="slack-tag">Archived</span>}
        </h2>
        {conversation?.memberCount !== undefined && channel && (
          <span className="slack-members" data-tip={`${conversation.memberCount} members`}>
            <Users size={13} aria-hidden="true" />
            {conversation.memberCount}
          </span>
        )}
        {conversation?.topic && (
          <div className="slack-topic" title={conversation.topic}>
            <MessageText message={{ text: conversation.topic }} />
          </div>
        )}
      </header>
      {list?.error && !list.loaded ? (
        <div className="slack-empty">
          <p>{list.error}</p>
          <button type="button" className="secondary" onClick={() => void loadHistory(conversationId, true).catch(() => {})}>
            <RefreshCw size={12} aria-hidden="true" />
            Try again
          </button>
        </div>
      ) : !list?.loaded ? (
        <div className="slack-empty" aria-busy="true">
          <LoaderCircle size={16} className="spinning" aria-hidden="true" />
        </div>
      ) : (
        <MessageList
          key={conversationId}
          label={`Messages in ${title}`}
          messages={messages}
          self={self}
          unreadFrom={unreadFrom}
          highlightTs={highlightTs}
          editingTs={editingTs}
          onEdit={setEditingTs}
          onThread={onThread}
          onLaunch={onLaunch}
          permalinkFor={permalinkFor}
          onSelect={onSelect}
          more={list.more}
          loadingOlder={list.loadingOlder}
          onOlder={older}
          onBottom={setAtBottom}
          intro={intro}
        />
      )}
      <footer className="slack-conv-foot">
        {conversation?.isArchived ? (
          <p className="slack-note">
            <Hash size={12} aria-hidden="true" /> This channel is archived.
          </p>
        ) : (
          <Composer
            key={conversationId}
            conversationId={conversationId}
            placeholder={`Message ${title}`}
            onEditLast={editLast}
            focusRef={composerFocus}
          />
        )}
      </footer>
    </section>
  );
}
