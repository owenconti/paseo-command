/** What a key does in the Slack tab, as in Slack. */
export type SlackKey = "previous" | "next" | "nextUnread" | "previousUnread" | "search" | "back" | "compose";

type Target = { tagName?: string; isContentEditable?: boolean } | null;
const typing = (target: Target) =>
  !!target && (target.isContentEditable === true || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? ""));

/**
 * The Slack tab's key for a keydown: ⌥↑ and ⌥↓ go to the previous and next
 * conversation (with ⇧, the previous and next unread one), as they do while
 * typing in Slack; ⌘F searches, typing or not; and, while not typing, / searches, Esc closes the thread
 * (then the search) and C writes in the open conversation. Null for every
 * other key, ⌘S (the sidebar), ⌘K (the palette) and ⌘+ ⌘− ⌘0 (the text) included.
 */
export function slackKeyAction(e: {
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: Target;
}): SlackKey | null {
  if (e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === "f") return "search";
  if (e.metaKey || e.ctrlKey) return null;
  if (e.altKey) {
    if (e.key === "ArrowUp") return e.shiftKey ? "previousUnread" : "previous";
    if (e.key === "ArrowDown") return e.shiftKey ? "nextUnread" : "next";
    return null;
  }
  if (typing(e.target) || e.shiftKey) return null;
  if (e.key === "/") return "search";
  if (e.key === "Escape") return "back";
  if (e.key.toLowerCase() === "c") return "compose";
  return null;
}
