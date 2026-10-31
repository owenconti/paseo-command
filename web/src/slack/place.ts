import { readStore, writeStore } from "../api";
import { runAppCommand } from "../appCommands";

/** Where the user is in the Slack view: the open conversation, its open thread, and a message to show. */
export type SlackPlace = {
  conversationId?: string;
  /** The open thread's parent. */
  threadTs?: string;
  /** A message to scroll to and mark (a search hit, an Activity item), once. */
  ts?: string;
};

const STORE_KEY = "slack:place";
const ID = /^[CDG][A-Z0-9]{1,30}$/;
const TS = /^\d{9,11}\.\d{1,8}$/;

/** A remembered (or otherwise untrusted) place as a valid one: malformed parts are dropped. */
export function checkPlace(raw: unknown): SlackPlace {
  if (!raw || typeof raw !== "object") return {};
  const p = raw as Record<string, unknown>;
  if (typeof p.conversationId !== "string" || !ID.test(p.conversationId)) return {};
  return {
    conversationId: p.conversationId,
    ...(typeof p.threadTs === "string" && TS.test(p.threadTs) ? { threadTs: p.threadTs } : {}),
    ...(typeof p.ts === "string" && TS.test(p.ts) ? { ts: p.ts } : {}),
  };
}

/** The remembered place (localStorage). */
export const readPlace = (): SlackPlace => checkPlace(readStore<unknown>(STORE_KEY, null));

/** Remembers the place; a message to show (`ts`) is for once, so it isn't kept. */
export function writePlace(p: SlackPlace): void {
  const { ts: _, ...kept } = p;
  writeStore(STORE_KEY, kept);
}

/**
 * Opens a conversation (a thread, a message) in the Slack tab: remembered for
 * the view to read as it mounts, and asked of it at once if it shows. The
 * Activity tab calls it.
 */
export function openSlackPlace(target: { conversationId: string; threadTs?: string; ts?: string }): void {
  const place = checkPlace(target);
  if (!place.conversationId) return;
  writeStore(STORE_KEY, place);
  runAppCommand("slack-open", place);
}
