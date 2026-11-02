import { compareTs, needsYou } from "./store";
import type { SlackConversation, SlackRecentThread, SlackSection } from "./types";

/** The sidebar's sections: Recent, Slack's own kinds, and the app's own (`section:<id>`). */
export type SectionKey = "recent" | "unreads" | "starred" | "channels" | "dms" | `section:${string}`;
export type SidebarSection = {
  key: SectionKey;
  title: string;
  items: SlackConversation[];
  /** One of the app's own sections (it can be renamed, moved and deleted, and conversations moved into it). */
  section?: SlackSection;
};

/** How many rows Recent shows. */
export const RECENT_MAX = 20;

/** A row of Recent: a conversation, or a thread you're in (with its conversation, when known). */
export type RecentItem =
  | { kind: "conversation"; key: string; latest: string; conversation: SlackConversation }
  | { kind: "thread"; key: string; latest: string; thread: SlackRecentThread; conversation?: SlackConversation };

/**
 * Recent: the conversations (channels you're in, DMs, group DMs) and threads
 * you're in with the newest messages, from anyone, newest first: at most
 * `max`. A conversation's newest is what the page knows (`latest`, from the
 * server's unread checks, reads and live events); one not known yet waits.
 */
export function recentItems(
  conversations: Iterable<SlackConversation>,
  threads: SlackRecentThread[],
  max = RECENT_MAX,
): RecentItem[] {
  const byId = new Map<string, SlackConversation>();
  for (const c of conversations) byId.set(c.id, c);
  const items: RecentItem[] = [];
  for (const c of byId.values())
    if (listed(c) && c.latest) items.push({ kind: "conversation", key: `c:${c.id}`, latest: c.latest, conversation: c });
  for (const t of threads) {
    const c = byId.get(t.conversationId);
    if (c?.isArchived) continue;
    items.push({ kind: "thread", key: `t:${t.conversationId}:${t.threadTs}`, latest: t.latest, thread: t, ...(c ? { conversation: c } : {}) });
  }
  return items.sort((a, b) => compareTs(b.latest, a.latest)).slice(0, max);
}

/** Whether the sidebar lists a conversation: channels you're in, and every DM, not archived. */
export const listed = (c: SlackConversation) =>
  !c.isArchived && (c.kind === "im" || c.kind === "mpim" || c.isMember);

const byLatest = (a: SlackConversation, b: SlackConversation) =>
  a.latest && b.latest ? compareTs(b.latest, a.latest) : a.latest ? -1 : b.latest ? 1 : 0;

/**
 * The sidebar's sections, as Slack's: Unreads (those that need you, mentions
 * first, then newest), the app's own sections (`custom`, each in its own
 * order), Starred, Channels (by name), Direct messages (newest first). A
 * conversation shows once, in the first that takes it; `keep` (the open one)
 * stays in Unreads while it's open, so reading it doesn't move it. Recent
 * (`recentItems`) stands apart, above them all.
 */
export function sidebarSections(
  conversations: Iterable<SlackConversation>,
  titleOf: (c: SlackConversation) => string,
  keep?: string,
  custom: SlackSection[] = [],
): SidebarSection[] {
  const all = [...conversations].filter(listed);
  const byId = new Map(all.map((c) => [c.id, c]));
  const byTitle = (a: SlackConversation, b: SlackConversation) => titleOf(a).localeCompare(titleOf(b));
  const unread = all
    .filter((c) => needsYou(c) || c.id === keep)
    .sort((a, b) => Number(!!b.mentions) - Number(!!a.mentions) || byLatest(a, b) || byTitle(a, b));
  const taken = new Set(unread.map((c) => c.id));
  const own: SidebarSection[] = custom.map((section) => {
    const items = section.conversationIds.map((id) => byId.get(id)).filter((c): c is SlackConversation => !!c && !taken.has(c.id));
    return { key: `section:${section.id}` as const, title: section.name, items, section };
  });
  for (const s of own) for (const c of s.items) taken.add(c.id);
  const starred = all.filter((c) => !taken.has(c.id) && c.isStarred).sort(byTitle);
  for (const c of starred) taken.add(c.id);
  const channels = all.filter((c) => !taken.has(c.id) && (c.kind === "channel" || c.kind === "private")).sort(byTitle);
  const dms = all.filter((c) => !taken.has(c.id) && (c.kind === "im" || c.kind === "mpim")).sort((a, b) => byLatest(a, b) || byTitle(a, b));
  const sections: SidebarSection[] = [
    { key: "unreads", title: "Unreads", items: unread },
    ...own,
    { key: "starred", title: "Starred", items: starred },
    { key: "channels", title: "Channels", items: channels },
    { key: "dms", title: "Direct messages", items: dms },
  ];
  return sections.filter((s) => s.items.length > 0 || s.section || s.key === "channels" || s.key === "dms");
}

// ── The app's own sections ───────────────────────────────────────────

/** A new section's id. */
export const newSectionId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The sections with a new one (named) at the end, or holding `conversationId` (taken from any other). */
export function addSection(sections: SlackSection[], id: string, name: string, conversationId?: string): SlackSection[] {
  const rest = conversationId ? withoutConversation(sections, conversationId) : sections;
  return [...rest, { id, name: name.trim(), conversationIds: conversationId ? [conversationId] : [] }];
}

export const renameSection = (sections: SlackSection[], id: string, name: string): SlackSection[] =>
  sections.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));

export const deleteSection = (sections: SlackSection[], id: string): SlackSection[] => sections.filter((s) => s.id !== id);

/** Moves a section to `index` (clamped) among the others. */
export function moveSection(sections: SlackSection[], id: string, index: number): SlackSection[] {
  const from = sections.findIndex((s) => s.id === id);
  if (from < 0) return sections;
  const rest = sections.filter((s) => s.id !== id);
  const to = Math.max(0, Math.min(rest.length, index));
  return [...rest.slice(0, to), sections[from], ...rest.slice(to)];
}

/** The sections with `conversationId` in none of them (back in Channels or Direct messages). */
export function withoutConversation(sections: SlackSection[], conversationId: string): SlackSection[] {
  return sections.map((s) => (s.conversationIds.includes(conversationId) ? { ...s, conversationIds: s.conversationIds.filter((c) => c !== conversationId) } : s));
}

/**
 * Moves a conversation into a section (out of any other), before `beforeId`
 * when that's in it, else at its end; to `undefined`, out of every section.
 */
export function moveConversation(sections: SlackSection[], conversationId: string, sectionId: string | undefined, beforeId?: string): SlackSection[] {
  const rest = withoutConversation(sections, conversationId);
  if (!sectionId) return rest;
  return rest.map((s) => {
    if (s.id !== sectionId) return s;
    const at = beforeId ? s.conversationIds.indexOf(beforeId) : -1;
    const ids = [...s.conversationIds];
    ids.splice(at < 0 ? ids.length : at, 0, conversationId);
    return { ...s, conversationIds: ids };
  });
}

/** The section holding a conversation, if any. */
export const sectionOf = (sections: SlackSection[], conversationId: string) => sections.find((s) => s.conversationIds.includes(conversationId));

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
