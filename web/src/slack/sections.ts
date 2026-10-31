import { compareTs, needsYou } from "./store";
import type { SlackConversation } from "./types";

export type SectionKey = "unreads" | "starred" | "channels" | "dms";
export type SidebarSection = { key: SectionKey; title: string; items: SlackConversation[] };

/** Whether the sidebar lists a conversation: channels you're in, and every DM, not archived. */
export const listed = (c: SlackConversation) =>
  !c.isArchived && (c.kind === "im" || c.kind === "mpim" || c.isMember);

const byLatest = (a: SlackConversation, b: SlackConversation) =>
  a.latest && b.latest ? compareTs(b.latest, a.latest) : a.latest ? -1 : b.latest ? 1 : 0;

/**
 * The sidebar's sections, as Slack's: Unreads (those that need you, mentions
 * first, then newest), Starred, Channels (by name), Direct messages (newest
 * first). A conversation shows once, in the first that takes it; `keep` (the
 * open one) stays in Unreads while it's open, so reading it doesn't move it.
 */
export function sidebarSections(
  conversations: Iterable<SlackConversation>,
  titleOf: (c: SlackConversation) => string,
  keep?: string,
): SidebarSection[] {
  const all = [...conversations].filter(listed);
  const byTitle = (a: SlackConversation, b: SlackConversation) => titleOf(a).localeCompare(titleOf(b));
  const unread = all
    .filter((c) => needsYou(c) || c.id === keep)
    .sort((a, b) => Number(!!b.mentions) - Number(!!a.mentions) || byLatest(a, b) || byTitle(a, b));
  const taken = new Set(unread.map((c) => c.id));
  const starred = all.filter((c) => !taken.has(c.id) && c.isStarred).sort(byTitle);
  for (const c of starred) taken.add(c.id);
  const channels = all.filter((c) => !taken.has(c.id) && (c.kind === "channel" || c.kind === "private")).sort(byTitle);
  const dms = all.filter((c) => !taken.has(c.id) && (c.kind === "im" || c.kind === "mpim")).sort((a, b) => byLatest(a, b) || byTitle(a, b));
  return [
    { key: "unreads" as const, title: "Unreads", items: unread },
    { key: "starred" as const, title: "Starred", items: starred },
    { key: "channels" as const, title: "Channels", items: channels },
    { key: "dms" as const, title: "Direct messages", items: dms },
  ].filter((s) => s.items.length > 0 || s.key === "channels" || s.key === "dms");
}

/**
 * The conversation `step` from `current` in the sidebar's order (wrapping),
 * or only among those that need you; undefined when there's none.
 */
export function stepConversation(
  order: SlackConversation[],
  current: string | undefined,
  step: 1 | -1,
  unreadOnly = false,
): string | undefined {
  const at = order.findIndex((c) => c.id === current);
  for (let n = 1; n <= order.length; n++) {
    const i = (((at < 0 ? (step > 0 ? -1 : 0) : at) + step * n) % order.length + order.length) % order.length;
    const c = order[i];
    if (c.id === current) continue;
    if (!unreadOnly || needsYou(c)) return c.id;
  }
  return undefined;
}
