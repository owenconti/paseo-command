/**
 * The only ways this server changes Slack: a fixed list of named writes
 * (`SlackWriteName`), each with its input checked field by field before
 * anything is sent. An unknown name or field is refused; every call is
 * `essential` (it is the user's own action, so it goes out even while Slack
 * has the method cooling down).
 */
import type { SlackConversation, SlackReaction, SlackWriteName, SlackWriteResult } from "../../src/slack/types";
import { followSlackThread } from "../activity/slack";
import { SlackError, slackCall } from "./client";
import { toMrkdwn } from "./mrkdwn";
import { messageOf, reactionsOf, recOf } from "./normalize";
import { CONVERSATION_ID, conversationFrom, keepConversation, keptWorkspace, readWorkspace, TS_PATTERN } from "./reads";
import { noteMarked } from "./unreads";

type Vars = Record<string, unknown>;
type Check = (value: unknown, name: string) => unknown;

/** Slack's limit for `markdown_text`. */
export const MAX_MARKDOWN = 12_000;
const USER = /^[UW][A-Z0-9]{2,20}$/;
const FILE = /^F[A-Z0-9]{2,20}$/;
const EMOJI = /^[a-z0-9_+'-]{1,100}$/;
const invalid = (message: string) => new SlackError("invalid", message);

const pattern =
  (re: RegExp, what: string): Check =>
  (v, name) => {
    if (typeof v !== "string" || !re.test(v)) throw invalid(`${name} must be ${what}`);
    return v;
  };
const conversation = pattern(CONVERSATION_ID, "a conversation id");
const ts = pattern(TS_PATTERN, "a message ts");
const markdown =
  (min: number): Check =>
  (v, name) => {
    if (typeof v !== "string" || v.trim().length < min || v.length > MAX_MARKDOWN)
      throw invalid(`${name} must be ${min ? "1" : "0"} to ${MAX_MARKDOWN} characters`);
    return v;
  };
const bool: Check = (v, name) => {
  if (typeof v !== "boolean") throw invalid(`${name} must be true or false`);
  return v;
};
/** An emoji's name, colons stripped ("+1", "party-parrot"). */
const emoji: Check = (v, name) => {
  const value = typeof v === "string" ? v.trim().replace(/^:|:$/g, "") : "";
  if (!EMOJI.test(value)) throw invalid(`${name} must be an emoji name`);
  return value;
};
const ids =
  (re: RegExp, what: string, max: number): Check =>
  (v, name) => {
    if (!Array.isArray(v) || !v.length || v.length > max) throw invalid(`${name} must be 1 to ${max} ${what}`);
    const out = v.map((x) => pattern(re, what)(x, name) as string);
    if (new Set(out).size !== out.length) throw invalid(`${name} must not repeat`);
    return out;
  };

/** The checked fields of `input`: every `required` one present, every present one known and valid. */
function fields(input: unknown, required: Record<string, Check>, optional: Record<string, Check> = {}): Vars {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("Expected an object");
  const given = input as Vars;
  const known = { ...required, ...optional };
  for (const name of Object.keys(given)) if (!Object.hasOwn(known, name)) throw invalid(`Unexpected field ${name}`);
  for (const name of Object.keys(required)) if (given[name] === undefined) throw invalid(`Missing field ${name}`);
  const out: Vars = {};
  for (const [name, check] of Object.entries(known)) if (given[name] !== undefined) out[name] = check(given[name], name);
  return out;
}

type Write = { validate(input: unknown): Vars; run(vars: Vars): Promise<SlackWriteResult> };

const essential = { essential: true } as const;

/** A message's reactions as Slack has them now (after a react or unreact); undefined when Slack won't say. */
async function reactionsNow(channel: string, timestamp: string): Promise<SlackReaction[] | undefined> {
  try {
    const r = await slackCall("reactions.get", { channel, timestamp, full: true });
    return reactionsOf(recOf(r.message).reactions) ?? [];
  } catch {
    return undefined;
  }
}

/** Slack refused `markdown_text` on this call (older or limited methods): send mrkdwn `text` instead. */
const markdownRefused = (e: unknown) =>
  e instanceof SlackError && ["invalid_arguments", "invalid_arg_name", "markdown_text_conflict", "invalid_blocks"].includes(e.code ?? "");

export const WRITES: Record<SlackWriteName, Write> = {
  post: {
    validate: (input) => {
      const v = fields(input, { conversationId: conversation, markdown: markdown(1) }, { threadTs: ts, broadcast: bool });
      if (v.broadcast && !v.threadTs) throw invalid("broadcast needs threadTs");
      return v;
    },
    async run(v) {
      const r = await slackCall(
        "chat.postMessage",
        {
          channel: v.conversationId,
          markdown_text: v.markdown,
          ...(v.threadTs ? { thread_ts: v.threadTs } : {}),
          ...(v.broadcast ? { reply_broadcast: true } : {}),
        },
        { ...essential, json: true },
      );
      const channel = typeof r.channel === "string" && CONVERSATION_ID.test(r.channel) ? r.channel : (v.conversationId as string);
      const message = messageOf({ ...recOf(r.message), ts: recOf(r.message).ts ?? r.ts }, channel);
      if (v.threadTs) followSlackThread(channel, v.threadTs as string);
      return message ? { message } : { ok: true };
    },
  },
  edit: {
    validate: (input) => fields(input, { conversationId: conversation, ts, markdown: markdown(1) }),
    async run(v) {
      let r: Record<string, unknown>;
      try {
        r = await slackCall("chat.update", { channel: v.conversationId, ts: v.ts, markdown_text: v.markdown }, { ...essential, json: true });
      } catch (e) {
        if (!markdownRefused(e)) throw e;
        r = await slackCall("chat.update", { channel: v.conversationId, ts: v.ts, text: toMrkdwn(v.markdown as string) }, { ...essential, json: true });
      }
      const message = messageOf({ ...recOf(r.message), ts: r.ts ?? v.ts }, v.conversationId as string);
      return message ? { message } : { ok: true };
    },
  },
  delete: {
    validate: (input) => fields(input, { conversationId: conversation, ts }),
    async run(v) {
      await slackCall("chat.delete", { channel: v.conversationId, ts: v.ts }, essential);
      return { ok: true };
    },
  },
  react: {
    validate: (input) => fields(input, { conversationId: conversation, ts, name: emoji }),
    async run(v) {
      try {
        await slackCall("reactions.add", { channel: v.conversationId, timestamp: v.ts, name: v.name }, essential);
      } catch (e) {
        // Already there is what was asked for.
        if (!(e instanceof SlackError && e.code === "already_reacted")) throw e;
      }
      const reactions = await reactionsNow(v.conversationId as string, v.ts as string);
      return reactions ? { reactions } : { ok: true };
    },
  },
  unreact: {
    validate: (input) => fields(input, { conversationId: conversation, ts, name: emoji }),
    async run(v) {
      try {
        await slackCall("reactions.remove", { channel: v.conversationId, timestamp: v.ts, name: v.name }, essential);
      } catch (e) {
        if (!(e instanceof SlackError && e.code === "no_reaction")) throw e;
      }
      const reactions = await reactionsNow(v.conversationId as string, v.ts as string);
      return reactions ? { reactions } : { ok: true };
    },
  },
  mark: {
    validate: (input) => fields(input, { conversationId: conversation, ts }),
    async run(v) {
      await slackCall("conversations.mark", { channel: v.conversationId, ts: v.ts }, essential);
      noteMarked(v.conversationId as string, v.ts as string);
      return { ok: true };
    },
  },
  openDm: {
    validate: (input) => fields(input, { userIds: ids(USER, "user ids", 8) }),
    async run(v) {
      const userIds = v.userIds as string[];
      if (!keptWorkspace()) await readWorkspace().catch(() => undefined);
      const r = await slackCall("conversations.open", { users: userIds.join(","), return_im: true }, essential);
      const raw = recOf(r.channel);
      // Slack may answer only the id: say what it is from whom it's with.
      const shaped =
        raw.is_im === undefined && raw.is_mpim === undefined
          ? { ...raw, ...(userIds.length === 1 ? { is_im: true, user: userIds[0] } : { is_mpim: true, members: userIds }) }
          : raw;
      const found: SlackConversation | null = conversationFrom(shaped);
      if (!found) throw new SlackError("failed", "Slack didn't open the conversation.");
      keepConversation(found);
      return { conversation: found };
    },
  },
  share: {
    validate: (input) =>
      fields(input, { conversationId: conversation, fileIds: ids(FILE, "file ids", 10) }, { markdown: markdown(0), threadTs: ts }),
    async run(v) {
      const comment = typeof v.markdown === "string" && v.markdown.trim() ? toMrkdwn(v.markdown) : undefined;
      await slackCall(
        "files.completeUploadExternal",
        {
          files: (v.fileIds as string[]).map((id) => ({ id })),
          channel_id: v.conversationId,
          ...(v.threadTs ? { thread_ts: v.threadTs } : {}),
          ...(comment ? { initial_comment: comment } : {}),
        },
        // A form, with `files` as JSON text: Slack's files methods don't take JSON bodies.
        essential,
      );
      if (v.threadTs) followSlackThread(v.conversationId as string, v.threadTs as string);
      return { ok: true };
    },
  },
};

/** Runs the named write with checked input; throws a SlackError (`invalid` for bad names or input). */
export async function slackWrite(name: string, input: unknown): Promise<SlackWriteResult> {
  if (!Object.hasOwn(WRITES, name)) throw invalid(`Unknown write ${name}`);
  const write = WRITES[name as SlackWriteName];
  return write.run(write.validate(input));
}
