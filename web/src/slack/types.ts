/**
 * The Slack tab's shapes, shared by the server (`web/server/slack/`, which
 * normalizes Slack's Web API answers into these) and the page
 * (`web/src/slack/`). Times are Slack's message timestamps (`ts`, "1730000000.000100"),
 * which also identify a message within its conversation.
 */

export type SlackConversationKind = "channel" | "private" | "im" | "mpim";

export type SlackUser = {
  id: string;
  /** Their display name, else real name, else handle. */
  name: string;
  realName: string;
  /** Slack's profile image (72 px), loaded through `/api/slack/avatar?user=`. */
  avatarUrl?: string;
  isBot: boolean;
  deleted: boolean;
  /** Their status emoji and text, when set. */
  statusEmoji?: string;
  statusText?: string;
  /** Hex colour Slack gives them ("9f69e7"), for initials without an avatar. */
  color?: string;
  timezone?: string;
};

export type SlackConversation = {
  id: string;
  kind: SlackConversationKind;
  /** A channel's name ("eng-web"); a DM's other person's name; a group DM's names joined. */
  name: string;
  /** A DM's other person. */
  userId?: string;
  /** A group DM's people (not you). */
  userIds?: string[];
  topic?: string;
  purpose?: string;
  isMember: boolean;
  isArchived: boolean;
  /** Muted in Slack's preferences; unread muted channels never show as needing you. */
  isMuted?: boolean;
  /** Starred in Slack ("starred" section), when Slack says so. */
  isStarred?: boolean;
  memberCount?: number;
  /** Where you've read to (a ts; "0000000000.000000" when never). Undefined until known. */
  lastRead?: string;
  /** The newest message's ts, when known. */
  latest?: string;
  /** Unread messages from others since `lastRead` (at most 100 counted; `unreadMore` past that). */
  unread?: number;
  unreadMore?: boolean;
  /** Unread messages that mention you (or DMs: every unread message). */
  mentions?: number;
};

export type SlackFile = {
  id: string;
  name: string;
  title?: string;
  /** "image/png" … */
  mimetype: string;
  /** Slack's short type ("png", "pdf", "gdoc"). */
  filetype?: string;
  size?: number;
  /** Slack's private address; loaded only through `/api/slack/file` or `/api/slack/image`. */
  url?: string;
  /** A small preview for images (`thumb_360`), when Slack made one. */
  thumbUrl?: string;
  width?: number;
  height?: number;
  /** Slack's page for it. */
  permalink?: string;
  /** Hidden by Slack (deleted, or on a plan that hides old files). */
  hidden?: boolean;
};

export type SlackReaction = {
  /** Slack's emoji name, without colons ("thumbsup", "party-parrot"). */
  name: string;
  count: number;
  userIds: string[];
};

/**
 * Slack's rich text, kept as Slack sends it (blocks of type `rich_text` and
 * their elements: sections, lists, quotes, preformatted; text with style,
 * links, user, channel, usergroup, emoji, broadcast, date). Rendered by the
 * page's `Message.tsx`; anything else falls back to `text` (mrkdwn).
 */
export type SlackRichElement = {
  type: string;
  text?: string;
  url?: string;
  user_id?: string;
  channel_id?: string;
  usergroup_id?: string;
  name?: string;
  unicode?: string;
  range?: string;
  timestamp?: number;
  format?: string;
  fallback?: string;
  style?: { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean };
  /** Lists: "bullet" or "ordered" (`style` above is a text's; a list's style is here). */
  list_style?: "bullet" | "ordered";
  indent?: number;
  offset?: number;
  border?: number;
  elements?: SlackRichElement[];
};
/** A block's text object: `mrkdwn` (or `markdown`) is formatted, `plain_text` only has its :emoji: drawn. */
export type SlackBlockText = { type: string; text: string };
/** A block's button: a link when it has an address; others only work in Slack (they call the app that sent it). */
export type SlackBlockButton = { text: string; url?: string; style?: "primary" | "danger" };
/**
 * The blocks the page draws: `rich_text` (its `elements`), `markdown`,
 * `header` and `section` (`text`, a section's `fields` and accessory button
 * in `buttons`), `context` (its words in `texts`), `divider` and `actions`
 * (its `buttons`).
 */
export type SlackBlock = {
  type: string;
  block_id?: string;
  elements?: SlackRichElement[];
  text?: SlackBlockText;
  fields?: SlackBlockText[];
  texts?: SlackBlockText[];
  buttons?: SlackBlockButton[];
};
/** A legacy attachment's field: a title over its value, `short` ones two to a row. */
export type SlackAttachmentField = { title?: string; value?: string; short?: boolean };

export type SlackMessage = {
  /** Its timestamp, which is its id within its conversation. */
  ts: string;
  conversationId: string;
  /** Set on a thread's parent (equal to `ts`) and on its replies (the parent's ts). */
  threadTs?: string;
  userId?: string;
  /** The bot or integration that sent it (`B…`); the server names it from `bots.info` when the message doesn't. */
  botId?: string;
  /** A bot's or integration's name, when not from a person. */
  botName?: string;
  botIconUrl?: string;
  /** mrkdwn, as Slack keeps it. */
  text: string;
  /** Rich text and section blocks only (others are dropped by the server). */
  blocks?: SlackBlock[];
  files?: SlackFile[];
  reactions?: SlackReaction[];
  /** A thread parent's replies. */
  replyCount?: number;
  replyUserIds?: string[];
  latestReply?: string;
  /** Edited at (ts). */
  edited?: string;
  /** Slack's subtype ("channel_join", "bot_message", "thread_broadcast", "tombstone"…). */
  subtype?: string;
  /** Attachments (link previews, and apps' cards): titles, text, their own blocks and fields. */
  attachments?: SlackAttachment[];
};

export type SlackAttachment = {
  /** The line above the card. */
  pretext?: string;
  authorName?: string;
  title?: string;
  text?: string;
  url?: string;
  serviceName?: string;
  color?: string;
  blocks?: SlackBlock[];
  fields?: SlackAttachmentField[];
  footer?: string;
};

export type SlackWorkspace = {
  teamId: string;
  teamName: string;
  /** "https://acme.slack.com/" */
  url: string;
  selfId: string;
  users: SlackUser[];
  conversations: SlackConversation[];
  /** Custom emoji: name → image address (or "alias:other"). */
  emoji: Record<string, string>;
  /** Whether messages arrive live (Socket Mode) or by polling. */
  live: SlackLive;
};

export type SlackLive = {
  /** "socket": live; "polling": no app token, or the socket is down (then `reason`). */
  mode: "socket" | "polling";
  reason?: string;
};

export type SlackHistory = {
  messages: SlackMessage[];
  /** Older messages remain (ask with `before` = the oldest ts here). */
  more: boolean;
  /** People the messages name whom the workspace doesn't list (a shared channel's, from another organisation). */
  users?: SlackUser[];
};

export type SlackThread = {
  parent?: SlackMessage;
  replies: SlackMessage[];
  more: boolean;
  /** As a history's: people not in the workspace's list. */
  users?: SlackUser[];
};

export type SlackSearchHit = SlackMessage & { permalink?: string };
export type SlackSearch = { term: string; messages: SlackSearchHit[]; total: number; users?: SlackUser[] };

/** Each conversation's read state, from the server's unread tracker. */
export type SlackUnreads = {
  conversations: Pick<SlackConversation, "id" | "lastRead" | "latest" | "unread" | "unreadMore" | "mentions">[];
  /** Conversations whose unread state isn't known yet (still being checked). */
  pending: number;
};

/** Slack can't be asked right now (off, no token, refused, rate limited): a normal answer, not an error. */
export type SlackUnavailable = { available: false; reason: string; retryAt?: number };

/** What arrives on `GET /api/slack/events` (server-sent events, one JSON object per event). */
export type SlackEvent =
  | { type: "message"; message: SlackMessage }
  | { type: "changed"; message: SlackMessage }
  | { type: "deleted"; conversationId: string; ts: string; threadTs?: string }
  | { type: "reaction"; conversationId: string; ts: string; reactions: SlackReaction[] }
  | { type: "marked"; conversationId: string; lastRead: string }
  | { type: "unreads"; unreads: SlackUnreads }
  | { type: "conversation"; conversation: SlackConversation }
  | { type: "user"; user: SlackUser }
  | { type: "live"; live: SlackLive }
  /** Something changed that the page can't patch in (reconnected, a gap): read again. */
  | { type: "resync" };

export type SlackUploaded = { id: string; name: string };

/** The server's whitelisted Slack writes (`POST /api/slack/m/<name>`). */
export type SlackWriteName =
  | "post"
  | "edit"
  | "delete"
  | "react"
  | "unreact"
  | "mark"
  | "openDm"
  | "share";

export type SlackWriteInputs = {
  /** `markdown` is Markdown (sent as `markdown_text`); `threadTs` replies in a thread; `broadcast` also sends it to the channel. */
  post: { conversationId: string; markdown: string; threadTs?: string; broadcast?: boolean };
  edit: { conversationId: string; ts: string; markdown: string };
  delete: { conversationId: string; ts: string };
  react: { conversationId: string; ts: string; name: string };
  unreact: { conversationId: string; ts: string; name: string };
  /** Read up to `ts`. */
  mark: { conversationId: string; ts: string };
  openDm: { userIds: string[] };
  /** Shares files uploaded with `POST /api/slack/upload` into a conversation (or thread), with an optional Markdown comment. */
  share: { conversationId: string; fileIds: string[]; markdown?: string; threadTs?: string };
};

export type SlackWriteResult = {
  message?: SlackMessage;
  conversation?: SlackConversation;
  reactions?: SlackReaction[];
  ok?: true;
};
