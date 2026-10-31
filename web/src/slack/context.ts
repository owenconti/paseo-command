import { EMOJI } from "./emoji";
import { messageBlocks, plainText, type Names } from "./mrkdwn";
import { permalinkOf, type SlackContext } from "./prompt";
import { compareTs, conversationTitle, findMessage, threadKey, userName, type SlackData } from "./store";
import type { SlackMessage } from "./types";

/** Messages before the chosen one that come with it, for context. */
const BEFORE = 5;
/** A thread's messages at most. */
const THREAD_LIMIT = 60;

/** How a prompt (and the page's plain text) names people, channels and emoji. */
export function namesOf(d: SlackData): Names {
  return {
    user: (id) => d.users.get(id)?.name,
    channel: (id) => d.conversations.get(id)?.name,
    emoji: (name) => EMOJI[name],
  };
}

/** A message as plain text with names (its files named too). */
export function messageText(d: SlackData, m: SlackMessage): string {
  const text = plainText(messageBlocks(m), namesOf(d));
  const files = (m.files ?? []).map((f) => `[file: ${f.title || f.name}]`).join(" ");
  return [text, files].filter(Boolean).join("\n");
}

const isoOf = (ts: string) => {
  const date = new Date(Number(ts.split(".")[0]) * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};

/**
 * What a new agent starts from: the thread (its parent and replies) when
 * `threadTs` is open, else the chosen message and a few before it.
 * Undefined when the page doesn't have the message.
 */
export function slackContext(d: SlackData, conversationId: string, ts: string, threadTs?: string): SlackContext | undefined {
  const c = d.conversations.get(conversationId);
  if (!c) return undefined;
  let chosen: SlackMessage[];
  let thread = false;
  const root = threadTs ?? ts;
  const loaded = d.threads.get(threadKey(conversationId, root));
  if (threadTs || loaded?.loaded) {
    const parent = loaded?.parent ?? findMessage(d, conversationId, root);
    chosen = [...(parent ? [parent] : []), ...(loaded?.replies ?? [])].filter((m) => !m.pending).slice(0, THREAD_LIMIT);
    thread = chosen.length > 1 || !!threadTs;
  } else {
    const list = (d.history.get(conversationId)?.messages ?? []).filter((m) => !m.pending);
    const at = list.findIndex((m) => m.ts === ts);
    chosen = at < 0 ? [findMessage(d, conversationId, ts)].filter((m): m is SlackMessage => !!m) : list.slice(Math.max(0, at - BEFORE), at + 1);
  }
  if (chosen.length === 0) return undefined;
  chosen.sort((a, b) => compareTs(a.ts, b.ts));
  return {
    conversationId,
    conversationName: conversationTitle(d, c),
    kind: c.kind,
    permalink: permalinkOf(d.workspace?.url, conversationId, thread ? root : ts),
    ts: root,
    thread,
    messages: chosen.map((m) => ({
      author: m.botName ?? userName(d, m.userId),
      at: isoOf(m.ts),
      text: messageText(d, m),
    })),
  };
}
