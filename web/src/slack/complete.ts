import { matchEmoji } from "./emoji";
import type { SlackUser } from "./types";

export type Suggestion = { key: string; insert: string; label: string; detail?: string; userId?: string; emoji?: string };
/** What the composer offers at the caret: people after `@`, emoji after `:` and two letters; where the word starts. */
export type Completion = { kind: "user" | "emoji"; start: number; items: Suggestion[] };

/** People whose name, real name or handle starts with (then contains) `query`; not deleted. */
export function matchUsers(users: Iterable<SlackUser>, query: string, limit = 8): SlackUser[] {
  const q = query.toLowerCase();
  const live = [...users].filter((u) => !u.deleted);
  const words = (u: SlackUser) => [u.name, u.realName].map((s) => s.toLowerCase());
  const starts = live.filter((u) => words(u).some((w) => w.startsWith(q) || w.split(/\s+/).some((p) => p.startsWith(q))));
  const contains = q ? live.filter((u) => !starts.includes(u) && words(u).some((w) => w.includes(q))) : [];
  const order = (a: SlackUser, b: SlackUser) => Number(a.isBot) - Number(b.isBot) || a.name.localeCompare(b.name);
  return [...starts.sort(order), ...contains.sort(order)].slice(0, limit);
}

/**
 * The completion for the word before the caret: `@na` offers people (and
 * inserts `<@U…>`, which Slack shows as their name), `:ta` offers emoji
 * (inserting `:tada:`). Null anywhere else.
 */
export function completionAt(
  text: string,
  caret: number,
  users: Iterable<SlackUser>,
  custom: Record<string, string> = {},
): Completion | null {
  const before = text.slice(0, caret);
  const at = /(^|[\s(])@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
  if (at) {
    const items = matchUsers(users, at[2]).map((u) => ({
      key: u.id,
      insert: `<@${u.id}> `,
      label: u.name,
      detail: u.realName !== u.name ? u.realName : undefined,
      userId: u.id,
    }));
    return items.length ? { kind: "user", start: caret - at[2].length - 1, items } : null;
  }
  const colon = /(^|[\s(]):([a-z0-9_+'-]{2,30})$/i.exec(before);
  if (colon) {
    const items = matchEmoji(colon[2], custom).map((name) => ({ key: name, insert: `:${name}: `, label: `:${name}:`, emoji: name }));
    return items.length ? { kind: "emoji", start: caret - colon[2].length - 1, items } : null;
  }
  return null;
}

/** The text with a suggestion in place of the word it completes; and where the caret goes. */
export function applySuggestion(text: string, caret: number, completion: Completion, item: Suggestion): { text: string; caret: number } {
  const next = `${text.slice(0, completion.start)}${item.insert}${text.slice(caret).replace(/^ /, "")}`;
  return { text: next, caret: completion.start + item.insert.length };
}

/** Where the composer keeps what's typed until it's sent: the conversation, and the thread a reply is for. */
export const draftKey = (conversationId: string, threadTs?: string) => `slack:draft:${conversationId}${threadTs ? `:${threadTs}` : ""}`;
