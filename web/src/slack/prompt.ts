import type { SlackConversationKind } from "./types";

/** Slack messages a new agent starts from (New agent's `DispatchTarget.slack`). */
export type SlackContext = {
  conversationId: string;
  /** "#eng-web", or a DM's person ("Ana"), or a group DM's people. */
  conversationName: string;
  kind: SlackConversationKind;
  /** The message (or thread) in Slack, when known. */
  permalink?: string;
  /** The message's ts (a thread's parent's), which also keys the draft. */
  ts: string;
  /** Whether `messages` are a thread (its parent and replies). */
  thread: boolean;
  /** Oldest first, as plain text with names. */
  messages: { author: string; at: string; text: string }[];
};

/** How much of the conversation goes into a prompt. */
const TEXT_LIMIT = 12_000;

/** Slack's address for a message ("https://acme.slack.com/archives/C1/p1730000000000100"), a reply's with its thread. */
export function permalinkOf(workspaceUrl: string | undefined, conversationId: string, ts: string, threadTs?: string): string | undefined {
  if (!workspaceUrl || !/^\d+\.\d+$/.test(ts)) return undefined;
  const base = workspaceUrl.endsWith("/") ? workspaceUrl : `${workspaceUrl}/`;
  const link = `${base}archives/${conversationId}/p${ts.replace(".", "")}`;
  return threadTs && threadTs !== ts ? `${link}?thread_ts=${threadTs}&cid=${conversationId}` : link;
}

/** The conversation as a prompt quotes it: where it is, its link, then each message with who wrote it. */
export function slackBlock(ctx: SlackContext): string {
  const where = ctx.kind === "im" ? `a direct message with ${ctx.conversationName}` : ctx.kind === "mpim" ? `a group message with ${ctx.conversationName}` : ctx.conversationName;
  const head = `Slack ${ctx.thread ? "thread" : "messages"} in ${where}`;
  let body = ctx.messages
    .map((m) => `${m.author}${m.at ? ` (${m.at.slice(0, 16).replace("T", " ")} UTC)` : ""}:\n${m.text.split("\n").map((l) => `> ${l}`).join("\n")}`)
    .join("\n\n");
  if (body.length > TEXT_LIMIT) body = `…${body.slice(body.length - TEXT_LIMIT)}`;
  return [head, ctx.permalink, "", body].filter((l) => l !== undefined).join("\n");
}

/** The first message New agent offers for Slack messages, to edit before sending. */
export const slackPrompt = (ctx: SlackContext) => `Look into this and help with what it asks.\n\n${slackBlock(ctx)}`;

/** A short name for the context (New agent's subtitle, a preset's `{{slack}}`). */
export const slackLabel = (ctx: SlackContext) => `${ctx.thread ? "a thread" : "a message"} in ${ctx.conversationName}`;
