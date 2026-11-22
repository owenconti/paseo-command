import { useSyncExternalStore } from "react";
import { readStore, writeStore } from "./api";

/** Whether conversations show only what was said (the user's ask): the agent's thinking and tool calls (the
 *  timeline's activity blocks) hidden, its replies, your messages, reports, pages and notices kept. One setting
 *  for every conversation, kept in localStorage; the conversation header's button and ⌘K switch it. Off by default. */
const STORE = "chat:conversationOnly";
let on = readStore<unknown>(STORE, false) === true;
const listeners = new Set<() => void>();
export const conversationOnly = () => on;
export function setConversationOnly(next: boolean) {
  if (next === on) return;
  on = next;
  writeStore(STORE, next);
  listeners.forEach((l) => l());
}
export const toggleConversationOnly = () => setConversationOnly(!on);
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const useConversationOnly = () => useSyncExternalStore(subscribe, () => on, () => on);
