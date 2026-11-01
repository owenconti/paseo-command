/**
 * Turns Slack's Web API and event records into the page's shared types
 * (`web/src/slack/types.ts`). Everything is checked and clipped here (text
 * 40,000, names 120; https addresses only), only the blocks the page draws
 * are kept (`blocksOf`), and malformed records come back as null and are dropped.
 */
import type {
  SlackAttachment,
  SlackAttachmentField,
  SlackBlock,
  SlackBlockButton,
  SlackBlockText,
  SlackConversation,
  SlackConversationKind,
  SlackFile,
  SlackMessage,
  SlackReaction,
  SlackRichElement,
  SlackUser,
} from "../../src/slack/types";

export type Raw = Record<string, unknown>;

export const strOf = (v: unknown) => (typeof v === "string" ? v : "");
export const recOf = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
export const listOf = (v: unknown): Raw[] => (Array.isArray(v) ? v.map(recOf) : []);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const opt = (s: string, n = 120) => (s ? clip(s, n) : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export const TS = /^\d{9,11}\.\d{6}$/;
const ID = /^[A-Z0-9]{2,24}$/;
export const tsOf = (v: unknown) => (typeof v === "string" && TS.test(v) ? v : undefined);
const idOf = (v: unknown) => (typeof v === "string" && ID.test(v) ? v : undefined);

/** An https address, else undefined. */
export const httpsUrl = (v: unknown) => {
  try {
    const url = new URL(strOf(v));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** When a ts was (ISO). */
export const tsTime = (ts: string) => new Date(Math.round(Number(ts) * 1000)).toISOString();

export function userOf(raw: unknown): SlackUser | null {
  const u = recOf(raw);
  const id = idOf(u.id);
  if (!id) return null;
  const p = recOf(u.profile);
  const handle = strOf(u.name);
  const realName = strOf(p.real_name) || strOf(u.real_name) || handle;
  const name = strOf(p.display_name) || realName || handle || id;
  const color = strOf(u.color);
  return {
    id,
    name: clip(name, 120),
    realName: clip(realName, 120),
    avatarUrl: httpsUrl(p.image_72) ?? httpsUrl(p.image_48),
    isBot: u.is_bot === true || id === "USLACKBOT",
    deleted: u.deleted === true,
    statusEmoji: opt(strOf(p.status_emoji).replace(/^:|:$/g, ""), 100),
    statusText: opt(strOf(p.status_text), 200),
    color: /^[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : undefined,
    timezone: opt(strOf(u.tz), 60),
  };
}

export const kindOf = (c: Raw): SlackConversationKind =>
  c.is_im === true ? "im" : c.is_mpim === true ? "mpim" : c.is_private === true || c.is_group === true ? "private" : "channel";

/** What the conversation builder needs of the workspace: you, and people by id and by handle. */
export type People = { selfId: string; byId: Map<string, SlackUser>; byHandle: Map<string, string> };

/** A group DM's handles (not yours), from Slack's `mpdm-alice--bob--you-1` name. */
const mpimHandles = (name: string, people: People) =>
  name
    .replace(/^mpdm-/, "")
    .replace(/-\d+$/, "")
    .split("--")
    .filter((h) => h && people.byHandle.get(h) !== people.selfId);

/** A group DM's people (not you) the workspace knows, from its name. */
function mpimPeople(name: string, people: People): string[] {
  return mpimHandles(name, people)
    .map((h) => people.byHandle.get(h))
    .filter((id): id is string => !!id);
}

export function conversationOf(raw: unknown, people: People): SlackConversation | null {
  const c = recOf(raw);
  const id = idOf(c.id);
  if (!id) return null;
  const kind = kindOf(c);
  const named = strOf(c.name);
  let name = clip(named, 120);
  let userId: string | undefined;
  let userIds: string[] | undefined;
  if (kind === "im") {
    userId = idOf(c.user);
    name = (userId && people.byId.get(userId)?.name) || userId || "Direct message";
  } else if (kind === "mpim") {
    const members = Array.isArray(c.members) ? c.members.map(idOf).filter((m): m is string => !!m && m !== people.selfId) : [];
    userIds = members.length ? members : mpimPeople(named, people);
    const names = userIds.map((u) => people.byId.get(u)?.name ?? u);
    // Handles the workspace doesn't know (someone from elsewhere): named as Slack has them, not left out.
    if (!members.length) names.push(...mpimHandles(named, people).filter((h) => !people.byHandle.has(h)));
    name = clip(names.join(", ") || named || "Group message", 120);
  }
  const latest = tsOf(recOf(c.latest).ts) ?? tsOf(c.latest);
  return {
    id,
    kind,
    name,
    ...(userId ? { userId } : {}),
    ...(userIds ? { userIds } : {}),
    topic: opt(strOf(recOf(c.topic).value), 500),
    purpose: opt(strOf(recOf(c.purpose).value), 500),
    isMember: kind === "im" || kind === "mpim" ? true : c.is_member === true,
    isArchived: c.is_archived === true || c.is_user_deleted === true,
    memberCount: num(c.num_members),
    lastRead: tsOf(c.last_read),
    ...(latest ? { latest } : {}),
  };
}

const STYLE_KEYS = ["bold", "italic", "strike", "code"] as const;

/** One rich text element, its known fields only, nested at most 8 deep. */
function elementOf(raw: unknown, depth: number): SlackRichElement | null {
  const e = recOf(raw);
  const type = strOf(e.type);
  if (!/^[a-z_]{1,40}$/.test(type) || depth > 8) return null;
  const out: SlackRichElement = { type };
  for (const k of ["text", "user_id", "channel_id", "usergroup_id", "name", "unicode", "range", "format", "fallback"] as const) {
    const v = strOf(e[k]);
    if (v) out[k] = clip(v, k === "text" ? 40_000 : 300);
  }
  const url = httpsUrl(e.url) ?? (/^(http|mailto):/i.test(strOf(e.url)) ? clip(strOf(e.url), 2000) : undefined);
  if (url) out.url = url;
  for (const k of ["timestamp", "indent", "offset", "border"] as const) {
    const v = num(e[k]);
    if (v !== undefined) out[k] = v;
  }
  const style = recOf(e.style);
  if (type === "rich_text_list") {
    if (e.style === "bullet" || e.style === "ordered") out.list_style = e.style;
  } else if (Object.keys(style).length) {
    const s: NonNullable<SlackRichElement["style"]> = {};
    for (const k of STYLE_KEYS) if (style[k] === true) s[k] = true;
    if (Object.keys(s).length) out.style = s;
  }
  if (Array.isArray(e.elements)) {
    out.elements = e.elements
      .slice(0, 2000)
      .map((x) => elementOf(x, depth + 1))
      .filter((x): x is SlackRichElement => !!x);
  }
  return out;
}

/** A block's text object, clipped; undefined without words. */
function blockTextOf(raw: unknown, max = 40_000): SlackBlockText | undefined {
  const t = recOf(raw);
  const text = strOf(t.text);
  if (!text.trim()) return undefined;
  return { type: t.type === "plain_text" ? "plain_text" : "mrkdwn", text: clip(text, max) };
}

/** A button as the page can show it: its label, and its address when it's a link. */
function buttonOf(raw: unknown): SlackBlockButton | undefined {
  const b = recOf(raw);
  if (b.type !== "button") return undefined;
  const text = strOf(recOf(b.text).text);
  if (!text.trim()) return undefined;
  const url = httpsUrl(b.url);
  return {
    text: clip(text, 120),
    ...(url ? { url } : {}),
    ...(b.style === "primary" || b.style === "danger" ? { style: b.style } : {}),
  };
}

/**
 * The blocks the page draws (rich text, Markdown, headers, sections with
 * their fields and button, context lines, dividers and buttons); images,
 * menus and inputs are dropped.
 */
export function blocksOf(raw: unknown): SlackBlock[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const blocks: SlackBlock[] = [];
  for (const item of raw.slice(0, 50)) {
    const b = recOf(item);
    const block_id = opt(strOf(b.block_id), 255);
    const id = block_id ? { block_id } : {};
    if (b.type === "rich_text") {
      const elements = listOf(b.elements).map((x) => elementOf(x, 0)).filter((x): x is SlackRichElement => !!x);
      blocks.push({ type: "rich_text", ...id, elements });
    } else if (b.type === "markdown") {
      // A message sent with markdown_text: its Markdown as Slack keeps it.
      const text = strOf(b.text);
      if (text) blocks.push({ type: "markdown", ...id, text: { type: "markdown", text: clip(text, 40_000) } });
    } else if (b.type === "header") {
      const text = blockTextOf(b.text, 300);
      if (text) blocks.push({ type: "header", ...id, text: { ...text, type: "plain_text" } });
    } else if (b.type === "section") {
      const text = blockTextOf(b.text);
      const fields = listOf(b.fields).slice(0, 10).map((f) => blockTextOf(f, 2000)).filter((f): f is SlackBlockText => !!f);
      const button = buttonOf(b.accessory);
      if (!text && !fields.length) continue;
      blocks.push({ type: "section", ...id, ...(text ? { text } : {}), ...(fields.length ? { fields } : {}), ...(button ? { buttons: [button] } : {}) });
    } else if (b.type === "context") {
      const texts = listOf(b.elements).slice(0, 10).map((e) => blockTextOf(e, 2000)).filter((t): t is SlackBlockText => !!t);
      if (texts.length) blocks.push({ type: "context", ...id, texts });
    } else if (b.type === "divider") {
      blocks.push({ type: "divider", ...id });
    } else if (b.type === "actions") {
      const buttons = listOf(b.elements).slice(0, 25).map(buttonOf).filter((x): x is SlackBlockButton => !!x);
      if (buttons.length) blocks.push({ type: "actions", ...id, buttons });
    }
  }
  return blocks.length ? blocks : undefined;
}

/** A legacy attachment (a link preview, or an app's card), or null when it has nothing to show. */
export function attachmentOf(raw: unknown): SlackAttachment | null {
  const a = recOf(raw);
  const blocks = blocksOf(a.blocks);
  const fields = listOf(a.fields)
    .slice(0, 20)
    .map((f): SlackAttachmentField => ({ title: opt(strOf(f.title), 300), value: opt(strOf(f.value), 2000), ...(f.short === true ? { short: true } : {}) }))
    .filter((f) => f.title || f.value);
  const out: SlackAttachment = {
    pretext: opt(strOf(a.pretext), 3000),
    authorName: opt(strOf(a.author_name), 120),
    title: opt(strOf(a.title), 300),
    // With blocks of its own, its fallback only repeats them.
    text: opt(strOf(a.text) || (blocks ? "" : strOf(a.fallback)), 3000),
    url: httpsUrl(a.title_link) ?? httpsUrl(a.from_url) ?? httpsUrl(a.original_url),
    serviceName: opt(strOf(a.service_name), 120),
    color: /^#?[0-9a-f]{6}$/i.test(strOf(a.color)) ? strOf(a.color).replace(/^#?/, "#") : undefined,
    ...(blocks ? { blocks } : {}),
    ...(fields.length ? { fields } : {}),
    footer: opt(strOf(a.footer), 300),
  };
  for (const k of Object.keys(out) as (keyof SlackAttachment)[]) if (out[k] === undefined) delete out[k];
  // One with only an address (Slack couldn't preview it) still says where it goes.
  return out.title || out.text || out.url || out.pretext || blocks || fields.length ? out : null;
}

export function fileOf(raw: unknown): SlackFile | null {
  const f = recOf(raw);
  const id = typeof f.id === "string" && /^F[A-Z0-9]{2,24}$/.test(f.id) ? f.id : undefined;
  if (!id) return null;
  const hidden = f.mode === "tombstone" || f.mode === "hidden_by_limit" || f.file_access === "access_denied";
  return {
    id,
    name: clip(strOf(f.name) || strOf(f.title) || "file", 255),
    title: opt(strOf(f.title), 255),
    mimetype: /^[\w.+-]{1,60}\/[\w.+-]{1,80}$/.test(strOf(f.mimetype)) ? strOf(f.mimetype).toLowerCase() : "application/octet-stream",
    filetype: opt(strOf(f.filetype), 40),
    size: num(f.size),
    url: httpsUrl(f.url_private),
    thumbUrl: httpsUrl(f.thumb_360) ?? httpsUrl(f.thumb_480),
    width: num(f.original_w),
    height: num(f.original_h),
    permalink: httpsUrl(f.permalink),
    ...(hidden ? { hidden: true } : {}),
  };
}

export function reactionsOf(raw: unknown): SlackReaction[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = listOf(raw)
    .map((r) => ({
      name: clip(strOf(r.name), 100),
      count: num(r.count) ?? 0,
      userIds: Array.isArray(r.users) ? r.users.map(idOf).filter((u): u is string => !!u) : [],
    }))
    .filter((r) => r.name && r.count > 0);
  return out;
}

/** A message, as history, replies, search and events give it; null when it has no ts. */
export function messageOf(raw: unknown, conversationId: string): SlackMessage | null {
  const m = recOf(raw);
  const ts = tsOf(m.ts);
  if (!ts) return null;
  const files = listOf(m.files).map(fileOf).filter((f): f is SlackFile => !!f);
  const reactions = reactionsOf(m.reactions);
  const blocks = blocksOf(m.blocks);
  const attachments = listOf(m.attachments)
    .slice(0, 10)
    .map(attachmentOf)
    .filter((a): a is SlackAttachment => !!a);
  const profile = recOf(m.bot_profile);
  const icons = recOf(m.icons);
  const replyUserIds = Array.isArray(m.reply_users) ? m.reply_users.map(idOf).filter((u): u is string => !!u) : [];
  const edited = tsOf(recOf(m.edited).ts);
  const subtype = /^[a-z_]{1,60}$/.test(strOf(m.subtype)) ? strOf(m.subtype) : undefined;
  return {
    ts,
    conversationId,
    ...(tsOf(m.thread_ts) ? { threadTs: tsOf(m.thread_ts) } : {}),
    ...(idOf(m.user) ? { userId: idOf(m.user) } : {}),
    ...(/^B[A-Z0-9]{2,20}$/.test(strOf(m.bot_id)) ? { botId: strOf(m.bot_id) } : {}),
    ...(opt(strOf(m.username) || strOf(profile.name)) ? { botName: opt(strOf(m.username) || strOf(profile.name)) } : {}),
    ...(httpsUrl(icons.image_48) ?? httpsUrl(recOf(profile.icons).image_48)
      ? { botIconUrl: httpsUrl(icons.image_48) ?? httpsUrl(recOf(profile.icons).image_48) }
      : {}),
    text: clip(strOf(m.text), 40_000),
    ...(blocks ? { blocks } : {}),
    ...(files.length ? { files } : {}),
    ...(reactions?.length ? { reactions } : {}),
    ...(num(m.reply_count) ? { replyCount: num(m.reply_count) } : {}),
    ...(replyUserIds.length ? { replyUserIds } : {}),
    ...(tsOf(m.latest_reply) ? { latestReply: tsOf(m.latest_reply) } : {}),
    ...(edited ? { edited } : {}),
    ...(subtype ? { subtype } : {}),
    ...(attachments.length ? { attachments } : {}),
  };
}

/** Message subtypes that are someone saying something (they count as unread); joins, leaves and topic changes don't. */
const SPOKEN = new Set(["bot_message", "thread_broadcast", "file_share", "me_message"]);
export const isSpoken = (subtype: string | undefined) => !subtype || SPOKEN.has(subtype);
