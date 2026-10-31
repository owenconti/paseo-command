import { memo, useState } from "react";
import { Check, FileText, ImageOff, Link2, MessageSquareText, Pencil, Play, SmilePlus, Trash2 } from "lucide-react";
import { ago } from "../api";
import { Lightbox } from "../Images";
import { slackFileHref, slackImageHref } from "./api";
import { Avatar, Emoji, fullTime, onLinkClick, sizeText, timeOf, tsDate } from "./bits";
import { EditBox } from "./Composer";
import { EmojiPicker } from "./EmojiPicker";
import { editableText } from "./mrkdwn";
import { MessageText } from "./rich";
import { slackStore, useSlack, type ShownMessage } from "./store";
import type { SlackFile, SlackMessage } from "./types";

/** Subtypes Slack shows as a line about the conversation rather than as a message. */
const SYSTEM = new Set(["channel_join", "channel_leave", "group_join", "group_leave", "channel_topic", "channel_purpose", "channel_name", "group_topic", "group_purpose", "group_name", "channel_archive", "channel_unarchive", "pinned_item"]);
export const isSystem = (m: Pick<SlackMessage, "subtype">) => !!m.subtype && SYSTEM.has(m.subtype);

/** Images as Slack shows them: within 360 × 240, keeping their shape. */
function fit(file: SlackFile): { width?: number; height?: number } {
  if (!file.width || !file.height) return {};
  const scale = Math.min(1, 360 / file.width, 240 / file.height);
  return { width: Math.round(file.width * scale), height: Math.round(file.height * scale) };
}

/** A message's files: images inline (their preview, then the lightbox), others as cards that download. */
function Files({ files }: { files: SlackFile[] }) {
  const [shown, setShown] = useState<SlackFile>();
  const [broken, setBroken] = useState<Set<string>>(new Set());
  return (
    <div className="slack-files">
      {files.map((f) => {
        if (f.hidden || !f.url)
          return (
            <span key={f.id} className="slack-file hidden">
              <FileText size={16} aria-hidden="true" />
              <span className="slack-file-name">{f.name || "A file"} isn’t available</span>
            </span>
          );
        if (f.mimetype.startsWith("image/") && !broken.has(f.id))
          return (
            <button key={f.id} type="button" className="slack-image" aria-label={`Open ${f.title || f.name}`} onClick={() => setShown(f)}>
              <img
                src={slackImageHref(f.thumbUrl ?? f.url)}
                alt={f.title || f.name}
                loading="lazy"
                draggable={false}
                {...fit(f)}
                onError={() => setBroken((b) => new Set(b).add(f.id))}
              />
            </button>
          );
        return (
          <a key={f.id} className="slack-file" href={slackFileHref(f.url)} target="_blank" rel="noreferrer" download={f.name}>
            <span className="slack-file-icon" aria-hidden="true">
              {f.mimetype.startsWith("image/") ? <ImageOff size={16} /> : <FileText size={16} />}
            </span>
            <span className="slack-file-text">
              <span className="slack-file-name">{f.title || f.name}</span>
              <span className="slack-file-meta">{[f.filetype?.toUpperCase(), f.size ? sizeText(f.size) : undefined].filter(Boolean).join(" · ")}</span>
            </span>
          </a>
        );
      })}
      {shown && (
        <Lightbox
          shown={{ url: slackImageHref(shown.url!), alt: shown.title || shown.name, name: shown.name }}
          onClose={() => setShown(undefined)}
        />
      )}
    </div>
  );
}

/** Link previews (Slack's legacy attachments): a coloured edge, the service, the title and its words. */
function Unfurls({ attachments }: { attachments: NonNullable<SlackMessage["attachments"]> }) {
  return (
    <div className="slack-unfurls">
      {attachments
        .filter((a) => a.title || a.text)
        .map((a, i) => (
          <div key={i} className="slack-unfurl" style={a.color ? { borderLeftColor: `#${a.color.replace(/^#/, "")}` } : undefined}>
            {a.serviceName && <span className="slack-unfurl-service">{a.serviceName}</span>}
            {a.title &&
              (a.url ? (
                <a className="slack-unfurl-title" href={a.url} target="_blank" rel="noreferrer noopener" onClick={onLinkClick}>
                  {a.title}
                </a>
              ) : (
                <span className="slack-unfurl-title">{a.title}</span>
              ))}
            {a.text && <MessageText message={{ text: a.text }} />}
          </div>
        ))}
    </div>
  );
}

/** A message's reactions: each a toggle of yours (who reacted in its tip), and the picker for another. */
function Reactions({ message }: { message: ShownMessage }) {
  const self = useSlack((d) => d.workspace?.selfId);
  const users = useSlack((d) => d.users);
  const [picking, setPicking] = useState(false);
  const toggle = (name: string) => {
    setPicking(false);
    void slackStore.toggleReaction(message.conversationId, message.ts, name);
  };
  const reactions = message.reactions ?? [];
  if (reactions.length === 0) return null;
  return (
    <div className="slack-reactions" role="group" aria-label="Reactions">
      {reactions.map((r) => {
        const mine = !!self && r.userIds.includes(self);
        const who = r.userIds.map((id) => (id === self ? "You" : users.get(id)?.name ?? "Someone"));
        const more = r.count - who.length;
        return (
          <button
            key={r.name}
            type="button"
            className={`slack-reaction${mine ? " mine" : ""}`}
            aria-pressed={mine}
            aria-label={`:${r.name}: ${r.count}`}
            data-tip={`${who.join(", ")}${more > 0 ? ` and ${more} more` : ""} reacted with :${r.name}:`}
            disabled={message.pending}
            onClick={() => toggle(r.name)}
          >
            <Emoji name={r.name} />
            <span>{r.count}</span>
          </button>
        );
      })}
      <span className="menu-anchor">
        <button
          type="button"
          className="slack-reaction slack-reaction-add"
          aria-label="Add a reaction"
          aria-expanded={picking}
          data-tip="Add a reaction"
          onClick={() => setPicking((p) => !p)}
        >
          <SmilePlus size={14} aria-hidden="true" />
        </button>
        {picking && <EmojiPicker onPick={toggle} onClose={() => setPicking(false)} />}
      </span>
    </div>
  );
}

/** A thread parent's "N replies": the repliers' avatars, the count and when the last came. */
function ThreadLink({ message, onOpen }: { message: ShownMessage; onOpen: () => void }) {
  const users = useSlack((d) => d.users);
  const count = message.replyCount ?? 0;
  return (
    <button type="button" className="slack-thread-link" onClick={onOpen}>
      <span className="slack-thread-avatars" aria-hidden="true">
        {(message.replyUserIds ?? []).slice(0, 4).map((id) => (
          <Avatar key={id} user={users.get(id)} size={20} />
        ))}
      </span>
      <b>
        {count} {count === 1 ? "reply" : "replies"}
      </b>
      {message.latestReply && <span className="slack-thread-last">Last reply {ago(tsDate(message.latestReply).getTime())}</span>}
    </button>
  );
}

export type MessageRowProps = {
  message: ShownMessage;
  /** Within a sender's run: no avatar or name, its time on hover. */
  compact: boolean;
  /** Marked (a search hit or link opened to it). */
  highlighted?: boolean;
  editing: boolean;
  onEdit: (ts: string | undefined) => void;
  /** Opens the message's thread (absent for a thread's own messages). */
  onThread?: (ts: string) => void;
  onLaunch: (message: ShownMessage) => void;
  /** Its address in Slack, to copy. */
  permalink?: string;
  /** The keyboard or pointer is on it (⌘K's Launch agent takes it). */
  onSelect: (ts: string) => void;
};

/**
 * One message, as Slack shows it: avatar, name and time (or only the time,
 * on hover, within a sender's run), its text, files, link previews,
 * reactions and replies; on hover, react, reply in thread, copy link,
 * launch an agent, and edit or delete your own.
 */
export const MessageRow = memo(function MessageRow({ message, compact, highlighted, editing, onEdit, onThread, onLaunch, permalink, onSelect }: MessageRowProps) {
  const user = useSlack((d) => (message.userId ? d.users.get(message.userId) : undefined));
  const self = useSlack((d) => d.workspace?.selfId);
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const mine = !!self && message.userId === self && !message.botName;
  const name = message.botName ?? user?.name ?? "Someone";
  const time = message.pending ? "Sending…" : timeOf(message.ts);

  if (message.subtype === "tombstone")
    return (
      <div className="slack-message tombstone" data-ts={message.ts}>
        <span className="slack-gutter" />
        <p className="slack-note-inline">This message was deleted.</p>
      </div>
    );
  if (isSystem(message))
    return (
      <div className="slack-message system" data-ts={message.ts}>
        <span className="slack-gutter">
          <Avatar user={user} size={20} />
        </span>
        <div className="slack-body">
          <MessageText message={message} />
          <time className="slack-time" dateTime={tsDate(message.ts).toISOString()} data-tip={fullTime(message.ts)}>
            {time}
          </time>
        </div>
      </div>
    );

  const react = (emoji: string) => {
    setPicking(false);
    void slackStore.toggleReaction(message.conversationId, message.ts, emoji);
  };
  const copy = () => {
    if (!permalink) return;
    void navigator.clipboard?.writeText(permalink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const remove = () => {
    setConfirming(false);
    void slackStore.remove({ conversationId: message.conversationId, ts: message.ts });
  };

  return (
    <div
      className={`slack-message${compact ? " compact" : ""}${message.pending ? " pending" : ""}${highlighted ? " highlighted" : ""}${editing ? " editing" : ""}`}
      data-ts={message.ts}
      tabIndex={-1}
      onMouseEnter={() => onSelect(message.ts)}
      onFocus={() => onSelect(message.ts)}
    >
      <span className="slack-gutter">
        {compact ? (
          <time className="slack-time hover-only" dateTime={tsDate(message.ts).toISOString()} data-tip={fullTime(message.ts)}>
            {message.pending ? "" : timeOf(message.ts).replace(/\s?[AP]M$/i, "")}
          </time>
        ) : (
          <Avatar user={user} size={36} botIcon={message.botIconUrl} />
        )}
      </span>
      <div className="slack-body">
        {!compact && (
          <p className="slack-head">
            <b className="slack-name">{name}</b>
            {(message.botName || user?.isBot) && <span className="slack-app-tag">App</span>}
            {user?.statusEmoji && <Emoji name={user.statusEmoji.replace(/:/g, "")} />}
            <time className="slack-time" dateTime={message.pending ? undefined : tsDate(message.ts).toISOString()} data-tip={message.pending ? undefined : fullTime(message.ts)}>
              {time}
            </time>
          </p>
        )}
        {editing ? (
          <EditBox
            initial={editableText(message)}
            onCancel={() => onEdit(undefined)}
            onSave={(markdown) => {
              onEdit(undefined);
              void slackStore.edit({ conversationId: message.conversationId, ts: message.ts, markdown });
            }}
          />
        ) : (
          <div className="slack-text">
            <MessageText
              message={message}
              trailing={message.edited ? <span className="slack-edited" data-tip={fullTime(message.edited)}>(edited)</span> : undefined}
            />
          </div>
        )}
        {message.files && message.files.length > 0 && <Files files={message.files} />}
        {message.attachments && message.attachments.length > 0 && <Unfurls attachments={message.attachments} />}
        <Reactions message={message} />
        {onThread && !!message.replyCount && message.threadTs === message.ts && <ThreadLink message={message} onOpen={() => onThread(message.ts)} />}
        {message.subtype === "thread_broadcast" && message.threadTs && onThread && (
          <button type="button" className="link-btn slack-broadcast-note" onClick={() => onThread(message.threadTs!)}>
            Replied to a thread
          </button>
        )}
        {confirming && (
          <span className="slack-confirm" role="group" aria-label="Delete this message?">
            <span>Delete this message? This can’t be undone.</span>
            <button type="button" className="danger" onClick={remove}>
              Delete
            </button>
            <button type="button" className="secondary" autoFocus onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        )}
      </div>
      {!message.pending && !editing && (
        <div className={`slack-actions${picking ? " open" : ""}`} role="toolbar" aria-label="Message actions">
          <span className="menu-anchor">
            <button type="button" className="icon-btn" aria-label="Add a reaction" aria-expanded={picking} data-tip="Add a reaction" onClick={() => setPicking((p) => !p)}>
              <SmilePlus size={14} aria-hidden="true" />
            </button>
            {picking && <EmojiPicker onPick={react} onClose={() => setPicking(false)} />}
          </span>
          {onThread && (
            <button type="button" className="icon-btn" aria-label="Reply in thread" data-tip="Reply in thread" onClick={() => onThread(message.threadTs ?? message.ts)}>
              <MessageSquareText size={14} aria-hidden="true" />
            </button>
          )}
          {permalink && (
            <button type="button" className="icon-btn" aria-label="Copy link" data-tip={copied ? "Copied" : "Copy link"} onClick={copy}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />}
            </button>
          )}
          <button type="button" className="icon-btn" aria-label="Launch agent" data-tip="Launch an agent with this" onClick={() => onLaunch(message)}>
            <Play size={14} aria-hidden="true" />
          </button>
          {mine && (
            <>
              <button type="button" className="icon-btn" aria-label="Edit message" data-tip="Edit" onClick={() => onEdit(message.ts)}>
                <Pencil size={14} aria-hidden="true" />
              </button>
              <button type="button" className="icon-btn danger-hover" aria-label="Delete message" data-tip="Delete" onClick={() => setConfirming(true)}>
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
});
