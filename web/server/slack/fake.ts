/**
 * A fake Slack for tests: a small workspace kept in Slack's Web API shapes
 * (so the server's normalize code is exercised) behind `SLACK.fetch`, and a
 * fake Socket Mode behind `SLACK.connect`. Requests dispatch on the method
 * name in the address to one function in `METHODS`. Files, avatars, emoji
 * and uploads answer on Slack's hosts. Nothing here reaches the network.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { resetSlackActivity, slackActivityFile } from "../activity/slack";
import { secretsFile } from "../secrets";
import { readSettings, settingsFile, writeSettings } from "../settings";
import { SLACK, resetSlackClient, type SlackSocket } from "./client";
import { resetSlackEvents } from "./events";
import { resetSlackFiles } from "./files";
import { resetSlackLive } from "./live";
import { resetSlackReads } from "./reads";
import { resetSlackSocket } from "./socket";
import { resetSlackUnreads } from "./unreads";

type Raw = Record<string, unknown>;

export type FakeUser = {
  id: string;
  name: string;
  real_name: string;
  deleted?: boolean;
  is_bot?: boolean;
  color?: string;
  tz?: string;
  profile: { display_name: string; real_name: string; image_72?: string; status_emoji?: string; status_text?: string };
};
export type FakeConversation = {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_private?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_member: boolean;
  is_archived?: boolean;
  user?: string;
  members?: string[];
  topic?: { value: string };
  purpose?: { value: string };
  num_members?: number;
  last_read: string;
  /** A DM or group DM shown in Slack's sidebar; closed ones (`false`) aren't. */
  is_open?: boolean;
};
export type FakeMessage = Raw & { ts: string; channel: string; user?: string; text: string; thread_ts?: string; subtype?: string };
export type FakeWorkspace = {
  team: { id: string; name: string; url: string };
  selfId: string;
  users: FakeUser[];
  /** People from another organisation (a shared channel's): not in users.list, but users.info knows them. */
  externals: FakeUser[];
  conversations: FakeConversation[];
  messages: FakeMessage[];
  emoji: Record<string, string>;
  /** Files as stored (by id): their bytes and type. */
  files: Map<string, { name: string; type: string; bytes: Buffer; url: string }>;
  /** Uploads waiting for `files.completeUploadExternal`. */
  uploads: Map<string, { name: string; length: number; bytes?: Buffer }>;
  /** chat.update refuses `markdown_text` (as an older Slack might), so the server falls back to mrkdwn `text`. */
  refuseMarkdownUpdate?: boolean;
};

/** A message ts `minutes` ago, with a distinct fraction. */
const NOW = Math.floor(Date.now() / 1000);
const ago = (minutes: number, n: number) => `${NOW - minutes * 60}.${String(n).padStart(6, "0")}`;

export const FAKE_IDS = {
  team: "T0FAKE",
  owen: "U0OWEN",
  sam: "U0SAM",
  ria: "U0RIA",
  bot: "U0BOT",
  general: "C0GENERAL",
  random: "C0RANDOM",
  secret: "G0SECRET",
  dm: "D0SAM",
  group: "G0GROUP",
  outside: "C0OUTSIDE",
  image: "F0IMAGE",
  pdf: "F0PDF",
  ts: {
    join: ago(130, 1),
    morning: ago(120, 2),
    /** Owen's thread parent in #general, with two replies. */
    parent: ago(90, 3),
    reply1: ago(80, 4),
    reply2: ago(70, 5),
    /** Ria's image with reactions; #general is read to here. */
    image: ago(60, 6),
    /** Sam mentions Owen (unread). */
    mention: ago(30, 7),
    /** CI's bot message (unread). */
    bot: ago(20, 8),
    lunch: ago(200, 9),
    secret: ago(50, 10),
    dmOld: ago(100, 11),
    dm1: ago(40, 12),
    dm2: ago(10, 13),
    group1: ago(15, 14),
    group2: ago(5, 15),
    outside: ago(25, 16),
  },
};

const I = FAKE_IDS;
const T = I.ts;
export const FAKE_USER_TOKEN = "xoxp-fake-user";
export const FAKE_APP_TOKEN = "xapp-fake-app";
export const FAKE_AVATAR = "https://avatars.slack-edge.com/fake/sam_72.png";
export const FAKE_EMOJI = "https://emoji.slack-edge.com/T0FAKE/party-parrot/abc.gif";
export const FAKE_IMAGE = `https://files.slack.com/files-pri/${I.team}-${I.image}/chart.png`;
export const FAKE_PDF = `https://files.slack.com/files-pri/${I.team}-${I.pdf}/plan.pdf`;
/** A 1×1 PNG. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const user = (id: string, handle: string, display: string, real: string, extra: Partial<FakeUser> = {}, image?: string): FakeUser => ({
  id,
  name: handle,
  real_name: real,
  color: "9f69e7",
  tz: "America/Toronto",
  ...extra,
  profile: { display_name: display, real_name: real, ...(image ? { image_72: image } : {}), ...(extra.profile ?? {}) },
});

const fileRecord = (id: string, name: string, mimetype: string, url: string, image = false): Raw => ({
  id,
  name,
  title: name,
  mimetype,
  filetype: name.split(".").pop(),
  size: 1234,
  url_private: url,
  permalink: `https://acme.slack.com/files/${I.sam}/${id}/${name}`,
  ...(image ? { thumb_360: url.replace(/\.png$/, "_360.png"), original_w: 800, original_h: 600 } : {}),
});

/** The sample workspace: Owen (you), Sam, Ria and a bot; #general (a thread, an image, a mention), #random, a private channel, a DM, a group DM. */
export function fakeWorkspace(): FakeWorkspace {
  const files = new Map<string, { name: string; type: string; bytes: Buffer; url: string }>([
    [I.image, { name: "chart.png", type: "image/png", bytes: PNG, url: FAKE_IMAGE }],
    [I.pdf, { name: "plan.pdf", type: "application/pdf", bytes: Buffer.from("%PDF-1.4 fake"), url: FAKE_PDF }],
  ]);
  return {
    team: { id: I.team, name: "Acme", url: "https://acme.slack.com/" },
    selfId: I.owen,
    users: [
      user(I.owen, "owen", "Owen", "Owen Conti"),
      user(I.sam, "sam", "Sam", "Sam Rivera", { profile: { display_name: "Sam", real_name: "Sam Rivera", status_emoji: ":coffee:", status_text: "Brewing" } }, FAKE_AVATAR),
      user(I.ria, "ria", "", "Ria Patel", {}, "https://evil.example/ria.png"),
      user(I.bot, "ci", "CI", "CI Bot", { is_bot: true }),
      user("U0GONE", "gone", "Gone", "Gone Person", { deleted: true }),
    ],
    externals: [
      user("U0JO", "jo", "Jo", "Jo Lee", { team_id: "T0PARTNER" } as Partial<FakeUser>, "https://avatars.slack-edge.com/fake/jo_72.png"),
      user("U0KIM", "kim", "", "Kim Park", { team_id: "T0PARTNER" } as Partial<FakeUser>),
    ],
    conversations: [
      { id: I.general, name: "general", is_channel: true, is_member: true, topic: { value: "Company news" }, purpose: { value: "Everyone" }, num_members: 4, last_read: T.image },
      { id: I.random, name: "random", is_channel: true, is_member: true, num_members: 3, last_read: T.lunch },
      { id: I.secret, name: "secret-plans", is_group: true, is_private: true, is_member: true, num_members: 2, last_read: "0000000000.000000" },
      { id: I.dm, is_im: true, user: I.sam, is_member: true, last_read: T.dmOld },
      { id: I.group, name: "mpdm-owen--sam--ria-1", is_mpim: true, is_group: true, is_member: true, last_read: T.group2 },
      { id: I.outside, name: "outside", is_channel: true, is_member: false, num_members: 9, last_read: "" },
    ],
    messages: [
      { channel: I.general, ts: T.join, user: I.ria, subtype: "channel_join", text: "<@U0RIA> has joined the channel" },
      { channel: I.general, ts: T.morning, user: I.sam, text: "Morning all" },
      {
        channel: I.general,
        ts: T.parent,
        user: I.owen,
        text: "Shall we ship *Friday*?",
        thread_ts: T.parent,
        reply_count: 2,
        reply_users: [I.sam, I.ria],
        latest_reply: T.reply2,
        blocks: [
          {
            type: "rich_text",
            block_id: "b1",
            elements: [
              {
                type: "rich_text_section",
                elements: [
                  { type: "text", text: "Shall we ship " },
                  { type: "text", text: "Friday", style: { bold: true, sparkle: true } },
                  { type: "text", text: "?" },
                ],
              },
              { type: "rich_text_list", style: "bullet", indent: 0, elements: [{ type: "rich_text_section", elements: [{ type: "text", text: "tests" }] }] },
            ],
          },
          { type: "actions", block_id: "b2", elements: [{ type: "button", text: { type: "plain_text", text: "Click" } }] },
        ],
      },
      { channel: I.general, ts: T.reply1, user: I.sam, text: `Yes <@${I.owen}>`, thread_ts: T.parent, parent_user_id: I.owen },
      { channel: I.general, ts: T.reply2, user: I.ria, text: "Agreed", thread_ts: T.parent, parent_user_id: I.owen },
      {
        channel: I.general,
        ts: T.image,
        user: I.ria,
        text: "The chart",
        files: [fileRecord(I.image, "chart.png", "image/png", FAKE_IMAGE, true)],
        reactions: [{ name: "thumbsup", count: 2, users: [I.sam, I.owen] }],
      },
      { channel: I.general, ts: T.mention, user: I.sam, text: `<@${I.owen}> can you look at the PR?` },
      {
        channel: I.general,
        ts: T.bot,
        user: I.bot,
        subtype: "bot_message",
        username: "CI",
        text: "Build passed",
        blocks: [{ type: "section", text: { type: "mrkdwn", text: "*Build* passed" } }, { type: "divider" }],
        attachments: [{ title: "Run 42", title_link: "https://ci.example/run/42", text: "All green", color: "2eb886" }],
      },
      { channel: I.random, ts: T.lunch, user: I.sam, text: "lunch?" },
      { channel: I.secret, ts: T.secret, user: I.ria, text: "The secret plan", files: [fileRecord(I.pdf, "plan.pdf", "application/pdf", FAKE_PDF)] },
      { channel: I.dm, ts: T.dmOld, user: I.owen, text: "see you" },
      { channel: I.dm, ts: T.dm1, user: I.sam, text: "hey" },
      { channel: I.dm, ts: T.dm2, user: I.sam, text: "are you there?" },
      { channel: I.group, ts: T.group1, user: I.ria, text: "group hello" },
      { channel: I.group, ts: T.group2, user: I.owen, text: "hi" },
      { channel: I.outside, ts: T.outside, user: I.sam, text: `outside news <@${I.owen}>` },
    ],
    emoji: {
      "party-parrot": FAKE_EMOJI,
      parrot: "alias:party-parrot",
      loop: "alias:loop",
      evil: "https://evil.example/evil.png",
    },
    files,
    uploads: new Map(),
  };
}

export type FakeContext = { ws: FakeWorkspace; params: Raw };
/** Slack's own error answer (`{ ok: false, error }`), thrown by a method. */
export class FakeSlackError extends Error {
  constructor(public code: string, public extra: Raw = {}) {
    super(code);
  }
}
const fail = (code: string, extra: Raw = {}) => new FakeSlackError(code, extra);

let counter = 100;
/** A fresh ts, now, unique within the run. */
export const nextTs = () => `${Math.floor(Date.now() / 1000)}.${String(++counter).padStart(6, "0")}`;

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined ? "" : String(v));
const n = (ts: unknown) => Number(str(ts));

function conversationFor(ws: FakeWorkspace, id: unknown): FakeConversation {
  const c = ws.conversations.find((x) => x.id === id);
  if (!c) throw fail("channel_not_found");
  return c;
}
function messageFor(ws: FakeWorkspace, channel: unknown, ts: unknown): FakeMessage {
  const m = ws.messages.find((x) => x.channel === channel && x.ts === ts);
  if (!m) throw fail("message_not_found");
  return m;
}
/** A message as Slack answers it (without the `channel` the fake keeps). */
const shape = (m: FakeMessage): Raw => {
  const { channel: _c, ...rest } = m;
  return { type: "message", ...rest };
};
const latestOf = (ws: FakeWorkspace, id: string) =>
  ws.messages.filter((m) => m.channel === id && (!m.thread_ts || m.thread_ts === m.ts || m.subtype === "thread_broadcast")).sort((a, b) => n(b.ts) - n(a.ts))[0];

/**
 * A conversation as Slack answers it: `conversations.info` (`info`) adds where you've read to and the latest
 * message, and the member count only when asked (`include_num_members`); `users.conversations` (`listed`)
 * leaves out is_member and num_members, as Slack does.
 */
const conversationRecord = (ws: FakeWorkspace, c: FakeConversation, info = false, opts: { listed?: boolean; counts?: boolean } = {}): Raw => {
  // Slack lists no group DM's members here (conversations.members does).
  const { last_read, is_member, num_members, members: _members, ...rest } = c;
  const latest = latestOf(ws, c.id);
  return {
    ...rest,
    created: 1600000000,
    ...(opts.listed ? {} : { is_member }),
    ...(opts.counts && num_members !== undefined ? { num_members } : {}),
    ...(info && last_read && (c.is_member || c.is_im) ? { last_read } : {}),
    ...(info && latest ? { latest: shape(latest) } : {}),
  };
};

/** A cursor-paged answer: `cursor` is the index to start at. */
function paged(items: unknown[], params: Raw, key: string): Raw {
  const start = Number(str(params.cursor) || 0);
  const limit = Math.max(1, Math.min(1000, Number(str(params.limit) || 100)));
  const page = items.slice(start, start + limit);
  const next = start + limit < items.length ? String(start + limit) : "";
  return { [key]: page, response_metadata: { next_cursor: next } };
}

const topLevel = (m: FakeMessage) => !m.thread_ts || m.thread_ts === m.ts || m.subtype === "thread_broadcast";

function permalinkOf(ws: FakeWorkspace, m: FakeMessage) {
  const base = `${ws.team.url}archives/${m.channel}/p${m.ts.replace(".", "")}`;
  return m.thread_ts && m.thread_ts !== m.ts ? `${base}?thread_ts=${m.thread_ts}&cid=${m.channel}` : base;
}

function post(ws: FakeWorkspace, channel: string, fields: Partial<FakeMessage> & { text: string }): FakeMessage {
  conversationFor(ws, channel);
  const m: FakeMessage = { channel, ts: nextTs(), user: ws.selfId, ...fields };
  if (m.thread_ts) {
    const parent = messageFor(ws, channel, m.thread_ts);
    parent.thread_ts = parent.ts;
    parent.reply_count = Number(parent.reply_count ?? 0) + 1;
    parent.latest_reply = m.ts;
    parent.reply_users = [...new Set([...((parent.reply_users as string[]) ?? []), ws.selfId])];
    m.parent_user_id = parent.user;
  }
  ws.messages.push(m);
  return m;
}

export const METHODS: Record<string, (ctx: FakeContext) => Raw> = {
  "auth.test": ({ ws }) => ({ url: ws.team.url, team: ws.team.name, team_id: ws.team.id, user: "owen", user_id: ws.selfId }),
  "users.list": ({ ws, params }) => paged(ws.users, params, "members"),
  "conversations.members": ({ ws, params }) => {
    const c = conversationFor(ws, params.channel);
    return { members: c.members ?? (c.is_im ? [ws.selfId, c.user] : ws.users.map((u) => u.id)) };
  },
  "users.info": ({ ws, params }) => {
    const found = [...ws.users, ...ws.externals].find((u) => u.id === params.user);
    if (!found) throw fail("user_not_found");
    return { user: found };
  },
  // Integrations that post with only their bot_id.
  "bots.info": ({ params }) => {
    if (params.bot !== "B0ALERTS") throw fail("bot_not_found");
    return { bot: { id: "B0ALERTS", name: "Alerts", deleted: false, icons: { image_72: "https://avatars.slack-edge.com/fake/alerts_72.png" } } };
  },
  "users.conversations": ({ ws, params }) => {
    const types = str(params.types).split(",");
    const list = ws.conversations
      .filter((c) => c.is_member && !(params.exclude_archived === "true" && c.is_archived))
      .filter((c) => {
        const t = c.is_im ? "im" : c.is_mpim ? "mpim" : c.is_private ? "private_channel" : "public_channel";
        return types.includes(t);
      })
      .map((c) => conversationRecord(ws, c, false, { listed: true }));
    return paged(list, params, "channels");
  },
  "emoji.list": ({ ws }) => ({ emoji: ws.emoji }),
  "conversations.info": ({ ws, params }) => ({
    channel: conversationRecord(ws, conversationFor(ws, params.channel), true, { counts: params.include_num_members === "true" }),
  }),
  "conversations.history": ({ ws, params }) => {
    const c = conversationFor(ws, params.channel);
    // Slack refuses a never-read conversation's last_read as a bound.
    if (params.oldest !== undefined && !(n(params.oldest) > 0)) throw fail("invalid_ts_oldest");
    const inclusive = params.inclusive === "true";
    const latest = params.latest ? n(params.latest) : Infinity;
    const oldest = params.oldest ? n(params.oldest) : -Infinity;
    const limit = Number(str(params.limit) || 100);
    const all = ws.messages
      .filter((m) => m.channel === c.id && topLevel(m))
      .filter((m) => (inclusive ? n(m.ts) <= latest && n(m.ts) >= oldest : n(m.ts) < latest && n(m.ts) > oldest))
      .sort((a, b) => n(b.ts) - n(a.ts));
    return { messages: all.slice(0, limit).map(shape), has_more: all.length > limit };
  },
  "conversations.replies": ({ ws, params }) => {
    const parent = messageFor(ws, params.channel, params.ts);
    const oldest = params.oldest ? n(params.oldest) : -Infinity;
    const limit = Number(str(params.limit) || 100);
    const replies = ws.messages
      .filter((m) => m.channel === parent.channel && m.thread_ts === parent.ts && m.ts !== parent.ts && n(m.ts) > oldest)
      .sort((a, b) => n(a.ts) - n(b.ts));
    return { messages: [shape(parent), ...replies.slice(0, limit).map(shape)], has_more: replies.length > limit };
  },
  "conversations.mark": ({ ws, params }) => {
    const c = conversationFor(ws, params.channel);
    c.last_read = str(params.ts);
    return {};
  },
  "conversations.open": ({ ws, params }) => {
    const users = str(params.users).split(",").filter(Boolean);
    if (!users.length) throw fail("not_enough_users");
    for (const u of users) if (!ws.users.some((x) => x.id === u)) throw fail("user_not_found");
    if (users.length === 1) {
      let im = ws.conversations.find((c) => c.is_im && c.user === users[0]);
      if (!im) {
        im = { id: `D0${users[0].slice(1)}`, is_im: true, user: users[0], is_member: true, last_read: "0000000000.000000" };
        ws.conversations.push(im);
      }
      // Slack answers only the id unless `return_im` is set.
      return { channel: params.return_im === "true" ? conversationRecord(ws, im) : { id: im.id } };
    }
    const members = [...new Set([ws.selfId, ...users])].sort();
    let mpim = ws.conversations.find((c) => c.is_mpim && [...(c.members ?? [])].sort().join() === members.join());
    if (!mpim) {
      const handles = members.map((id) => ws.users.find((u) => u.id === id)!.name);
      mpim = { id: `G0${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "")}`, name: `mpdm-${handles.join("--")}-1`, is_mpim: true, is_group: true, is_member: true, members, last_read: "0000000000.000000" };
      ws.conversations.push(mpim);
    }
    return { channel: { id: mpim.id } };
  },
  "search.messages": ({ ws, params }) => {
    const query = str(params.query).trim();
    const count = Number(str(params.count) || 20);
    const words = query.toLowerCase();
    const matches = ws.messages
      .filter((m) => ws.conversations.some((c) => c.id === m.channel))
      .filter((m) => (/^<@[A-Z0-9]+>$/.test(query) ? m.text.includes(query) : m.text.toLowerCase().includes(words)))
      .sort((a, b) => n(b.ts) - n(a.ts));
    return {
      query,
      messages: {
        total: matches.length,
        matches: matches.slice(0, count).map((m) => {
          const c = conversationFor(ws, m.channel);
          // Search's matches carry no thread_ts: the permalink says the thread.
          const { thread_ts: _t, ...rest } = shape(m);
          return { ...rest, channel: { id: c.id, name: c.name ?? c.id }, permalink: permalinkOf(ws, m) };
        }),
      },
    };
  },
  "chat.postMessage": ({ ws, params }) => {
    const text = str(params.markdown_text || params.text);
    if (!text) throw fail("no_text");
    if (text.length > 12000) throw fail("msg_too_long");
    const m = post(ws, str(params.channel), {
      text,
      ...(params.thread_ts ? { thread_ts: str(params.thread_ts) } : {}),
      ...(params.reply_broadcast === true || params.reply_broadcast === "true" ? { subtype: "thread_broadcast" } : {}),
    });
    return { channel: m.channel, ts: m.ts, message: shape(m) };
  },
  "chat.update": ({ ws, params }) => {
    if (params.markdown_text !== undefined && ws.refuseMarkdownUpdate) throw fail("invalid_arguments");
    const m = messageFor(ws, params.channel, params.ts);
    if (m.user !== ws.selfId) throw fail("cant_update_message");
    m.text = str(params.markdown_text ?? params.text);
    m.edited = { user: ws.selfId, ts: nextTs() };
    delete m.blocks;
    return { channel: m.channel, ts: m.ts, text: m.text, message: shape(m) };
  },
  "chat.delete": ({ ws, params }) => {
    const m = messageFor(ws, params.channel, params.ts);
    if (m.user !== ws.selfId) throw fail("cant_delete_message");
    ws.messages = ws.messages.filter((x) => x !== m);
    return { channel: m.channel, ts: m.ts };
  },
  "reactions.add": ({ ws, params }) => {
    const m = messageFor(ws, params.channel, params.timestamp);
    const name = str(params.name);
    if (name !== "thumbsup" && name !== "tada" && name !== "+1" && !Object.hasOwn(ws.emoji, name)) throw fail("invalid_name");
    const list = (m.reactions as { name: string; count: number; users: string[] }[] | undefined) ?? [];
    const r = list.find((x) => x.name === name);
    if (r?.users.includes(ws.selfId)) throw fail("already_reacted");
    if (r) {
      r.users.push(ws.selfId);
      r.count++;
    } else list.push({ name, count: 1, users: [ws.selfId] });
    m.reactions = list;
    return {};
  },
  "reactions.remove": ({ ws, params }) => {
    const m = messageFor(ws, params.channel, params.timestamp);
    const list = (m.reactions as { name: string; count: number; users: string[] }[] | undefined) ?? [];
    const r = list.find((x) => x.name === params.name);
    if (!r?.users.includes(ws.selfId)) throw fail("no_reaction");
    r.users = r.users.filter((u) => u !== ws.selfId);
    r.count--;
    m.reactions = list.filter((x) => x.count > 0);
    return {};
  },
  "reactions.get": ({ ws, params }) => {
    const m = messageFor(ws, params.channel, params.timestamp);
    return { type: "message", channel: m.channel, message: shape(m) };
  },
  "files.getUploadURLExternal": ({ ws, params }) => {
    const length = Number(str(params.length));
    if (!params.filename || !Number.isInteger(length) || length < 1) throw fail("invalid_arguments");
    const id = `F0UP${++counter}`;
    ws.uploads.set(id, { name: str(params.filename), length });
    return { upload_url: `https://files.slack.com/upload/v1/${id}`, file_id: id };
  },
  "files.completeUploadExternal": ({ ws, params }) => {
    const files = JSON.parse(str(params.files) || "[]") as { id: string }[];
    const records = files.map(({ id }) => {
      const up = ws.uploads.get(id);
      if (!up?.bytes) throw fail("file_not_found");
      const url = `https://files.slack.com/files-pri/${ws.team.id}-${id}/${up.name}`;
      ws.files.set(id, { name: up.name, type: "application/octet-stream", bytes: up.bytes, url });
      ws.uploads.delete(id);
      return fileRecord(id, up.name, "application/octet-stream", url);
    });
    if (params.channel_id) {
      post(ws, str(params.channel_id), {
        text: str(params.initial_comment),
        files: records,
        ...(params.thread_ts ? { thread_ts: str(params.thread_ts) } : {}),
      });
    }
    return { files: records.map((f) => ({ id: f.id, title: f.title })) };
  },
  "apps.connections.open": () => ({ url: `wss://wss.fake.slack/link/?ticket=${++counter}` }),
};

/** A fake Socket Mode connection: the test pushes envelopes in and reads the acks out. */
export class FakeSocket implements SlackSocket {
  sent: string[] = [];
  closed = false;
  /** Pings the server sent. */
  pings = 0;
  /** Answers pings with pongs, as Slack does; false makes the connection go silent. */
  answersPings = true;
  private handlers: Record<string, ((...args: unknown[]) => void)[]> = {};
  constructor(public url: string) {}
  on(event: string, fn: (...args: never[]) => void) {
    (this.handlers[event] ??= []).push(fn as (...args: unknown[]) => void);
    return this;
  }
  private emit(event: string, ...args: unknown[]) {
    for (const fn of this.handlers[event] ?? []) fn(...args);
  }
  send(data: string) {
    if (this.closed) throw new Error("closed");
    this.sent.push(data);
  }
  close(code = 1000) {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", code);
  }
  ping() {
    if (this.closed) throw new Error("closed");
    this.pings++;
    if (this.answersPings) queueMicrotask(() => this.emit("pong"));
  }
  /** A WebSocket ping from Slack (ws answers it itself). */
  serverPing() {
    this.emit("ping");
  }
  /** Slack's greeting: the connection is live. */
  hello() {
    this.push({ type: "hello", num_connections: 1 });
  }
  /** Sends one envelope as Slack would (a Buffer, as ws gives). */
  push(envelope: Raw) {
    this.emit("message", Buffer.from(JSON.stringify(envelope)));
  }
  /** Sends one Events API event; answers its envelope id. */
  event(event: Raw): string {
    const id = randomUUID();
    this.push({ envelope_id: id, type: "events_api", accepts_response_payload: false, payload: { type: "event_callback", event } });
    return id;
  }
  /** Slack's routine "refresh" request. */
  disconnect() {
    this.push({ type: "disconnect", reason: "refresh_requested" });
  }
  /** The connection breaks (no clean close). */
  drop() {
    this.closed = true;
    this.emit("close", 1006);
  }
  /** The envelope ids acknowledged so far. */
  get acks(): string[] {
    return this.sent.map((s) => String((JSON.parse(s) as Raw).envelope_id));
  }
}

export type FakeFailure = { error: string; status?: number; retryAfter?: number; needed?: string };

export type FakeSlack = {
  ws: FakeWorkspace;
  /** Every Web API call: its method, params and token. */
  calls: { method: string; params: Raw; token: string }[];
  /** Every other address fetched (files, avatars, emoji, uploads), with its token if any. */
  fetched: { url: string; token: string }[];
  sockets: FakeSocket[];
  /** The newest socket. */
  socket(): FakeSocket | undefined;
  /** Makes every later call of `method` answer this error, until `clear` or restore. */
  fail(method: string, failure: FakeFailure): void;
  clear(method: string): void;
  /** Calls of `method` so far. */
  count(method: string): number;
  restore(): void;
};

/** A file's text, or undefined when it doesn't exist. */
function snapshot(file: string): string | undefined {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}
function putBack(file: string, text: string | undefined): void {
  if (text === undefined) rmSync(file, { force: true });
  else writeFileSync(file, text);
}

/** Forgets everything the Slack server keeps in memory (cooldowns, workspace, unreads, socket, listeners, files, mentions). */
export function resetSlack(): void {
  resetSlackSocket();
  resetSlackClient();
  resetSlackReads();
  resetSlackUnreads();
  resetSlackLive();
  resetSlackEvents();
  resetSlackFiles();
  resetSlackActivity();
}

/** Parses a fake request's params: a form, else JSON. */
function paramsOf(init?: RequestInit): Raw {
  const body = typeof init?.body === "string" ? init.body : "";
  const type = new Headers(init?.headers).get("content-type") ?? "";
  if (type.startsWith("application/json")) return JSON.parse(body || "{}") as Raw;
  return Object.fromEntries(new URLSearchParams(body));
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/**
 * Points SLACK.fetch and SLACK.connect at the fake and turns Slack on as a
 * user would: `integrations.slack` in settings.json and fake `slackUserToken`
 * (and, unless `appToken: false`, `slackAppToken`) in the (test) data
 * directory's secrets.json. Everything kept in memory is reset; `restore()`
 * puts both files back (and removes the test's slack-activity.json).
 */
export function installFakeSlack(ws: FakeWorkspace = fakeWorkspace(), opts: { appToken?: boolean; autoHello?: boolean } = {}): FakeSlack {
  resetSlack();
  const realFetch = SLACK.fetch;
  const realConnect = SLACK.connect;
  const failures = new Map<string, FakeFailure>();
  const calls: FakeSlack["calls"] = [];
  const fetched: FakeSlack["fetched"] = [];
  const sockets: FakeSocket[] = [];
  const secrets = secretsFile();
  const settings = settingsFile();
  const activity = slackActivityFile();
  const hadSecrets = snapshot(secrets);
  const hadSettings = snapshot(settings);
  const hadActivity = snapshot(activity);
  let kept: Raw = {};
  try {
    const raw: unknown = JSON.parse(hadSecrets ?? "{}");
    if (raw && typeof raw === "object" && !Array.isArray(raw)) kept = raw as Raw;
  } catch {
    // An unreadable file is replaced for the test and put back by restore().
  }
  mkdirSync(dirname(secrets), { recursive: true });
  writeFileSync(
    secrets,
    JSON.stringify({ ...kept, slackUserToken: FAKE_USER_TOKEN, ...(opts.appToken === false ? {} : { slackAppToken: FAKE_APP_TOKEN }) }),
  );
  if (opts.appToken === false) {
    const raw = JSON.parse(readFileSync(secrets, "utf8")) as Raw;
    delete raw.slackAppToken;
    writeFileSync(secrets, JSON.stringify(raw));
  }
  rmSync(activity, { force: true });
  const integrations = readSettings()?.integrations;
  writeSettings({ integrations: { ...(integrations && typeof integrations === "object" ? integrations : {}), slack: true } });

  SLACK.fetch = (async (target: unknown, init?: RequestInit) => {
    const address = String(target);
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const token = auth.replace(/^Bearer /, "");
    if (address.startsWith(SLACK.api)) {
      const method = address.slice(SLACK.api.length);
      const params = paramsOf(init);
      calls.push({ method, params, token });
      const failure = failures.get(method);
      if (failure) {
        const headers: Record<string, string> = failure.retryAfter !== undefined ? { "retry-after": String(failure.retryAfter) } : {};
        return json(failure.status ?? 200, { ok: false, error: failure.error, ...(failure.needed ? { needed: failure.needed } : {}) }, headers);
      }
      const wanted = method === "apps.connections.open" ? FAKE_APP_TOKEN : FAKE_USER_TOKEN;
      if (!token) return json(200, { ok: false, error: "not_authed" });
      if (token !== wanted)
        return json(200, { ok: false, error: token === FAKE_APP_TOKEN || token === FAKE_USER_TOKEN ? "not_allowed_token_type" : "invalid_auth" });
      const run = METHODS[method];
      if (!run) return json(200, { ok: false, error: "unknown_method" });
      try {
        return json(200, { ok: true, ...run({ ws, params }) });
      } catch (e) {
        if (e instanceof FakeSlackError) return json(200, { ok: false, error: e.code, ...e.extra });
        throw e;
      }
    }
    fetched.push({ url: address, token });
    // Uploads: the bytes posted where getUploadURLExternal said, without the token.
    const upload = /^https:\/\/files\.slack\.com\/upload\/v1\/(F\w+)$/.exec(address);
    if (upload) {
      const up = ws.uploads.get(upload[1]);
      if (init?.method !== "POST" || !up || token) return new Response("", { status: 403 });
      up.bytes = Buffer.from(init.body as Uint8Array);
      return new Response("OK - 1", { status: 200 });
    }
    if (address.startsWith("https://files.slack.com/files-pri/")) {
      // Without the token Slack answers its sign-in page, as it does.
      if (token !== FAKE_USER_TOKEN) return new Response("<html>Sign in</html>", { status: 200, headers: { "content-type": "text/html" } });
      const file = [...ws.files.values()].find((f) => f.url === address || f.url.replace(/\.png$/, "_360.png") === address);
      if (!file) return new Response("", { status: 404 });
      return new Response(new Uint8Array(file.bytes), {
        status: 200,
        headers: { "content-type": file.type, "content-length": String(file.bytes.length) },
      });
    }
    if (address.startsWith("https://avatars.slack-edge.com/fake/") || address === FAKE_EMOJI) {
      // Public CDNs: never with the token.
      if (token) return new Response("", { status: 400 });
      return new Response(new Uint8Array(PNG), { status: 200, headers: { "content-type": address === FAKE_EMOJI ? "image/gif" : "image/png" } });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;

  SLACK.connect = (url: string) => {
    const s = new FakeSocket(url);
    sockets.push(s);
    if (opts.autoHello !== false) queueMicrotask(() => s.hello());
    return s;
  };

  return {
    ws,
    calls,
    fetched,
    sockets,
    socket: () => sockets.at(-1),
    fail: (method, failure) => void failures.set(method, failure),
    clear: (method) => void failures.delete(method),
    count: (method) => calls.filter((c) => c.method === method).length,
    restore() {
      resetSlack();
      SLACK.fetch = realFetch;
      SLACK.connect = realConnect;
      putBack(secrets, hadSecrets);
      putBack(settings, hadSettings);
      putBack(activity, hadActivity);
    },
  };
}
