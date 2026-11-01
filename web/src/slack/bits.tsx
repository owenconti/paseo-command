import { useState, type MouseEvent } from "react";
import { Hash, Lock, Users } from "lucide-react";
import { openExternal } from "../links";
import { macApp, postAppLink } from "../worldBridge";
import { slackAvatarHref, slackEmojiHref } from "./api";
import { emojiFace, fromCodePoints, withSkinTone } from "./emoji";
import { useSlack } from "./store";
import type { SlackConversation, SlackUser } from "./types";

/** Avatars that didn't load, by user: their initials show from then on, without asking again. */
const noAvatar = new Set<string>();

const initials = (name: string) =>
  name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0]?.toUpperCase() ?? "")
    .join("") || "?";

/** A person's square avatar (Slack's), through the app server, else their initials on their colour. */
export function Avatar({ user, name: shown, size = 36, botIcon }: { user?: SlackUser; name?: string; size?: number; botIcon?: string }) {
  const [broken, setBroken] = useState(false);
  const name = shown ?? user?.name ?? "Someone";
  const src = botIcon ? undefined : user?.avatarUrl && !broken && !noAvatar.has(user.id) ? slackAvatarHref(user.id) : undefined;
  return (
    <span
      className="slack-avatar"
      style={{ width: size, height: size, ...(src ? {} : { background: user?.color ? `#${user.color}` : undefined }) }}
      aria-hidden="true"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => {
            if (user) noAvatar.add(user.id);
            setBroken(true);
          }}
        />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.4) }}>{initials(name)}</span>
      )}
    </span>
  );
}

/** An emoji: standard as itself, custom as its image (through the app server), unknown as `:name:`. */
export function Emoji({ name, unicode, skin, big }: { name: string; unicode?: string; skin?: number; big?: boolean }) {
  const custom = useSlack((d) => d.workspace?.emoji);
  const fromSlack = fromCodePoints(unicode);
  if (fromSlack) return <span className={`slack-emoji${big ? " big" : ""}`} data-tip={`:${name}:`}>{fromSlack}</span>;
  const face = emojiFace(name, custom);
  if (face.kind === "unicode")
    return (
      <span className={`slack-emoji${big ? " big" : ""}`} data-tip={`:${name}:`}>
        {withSkinTone(face.char, skin)}
      </span>
    );
  if (face.kind === "custom")
    return (
      <img
        className={`slack-emoji custom${big ? " big" : ""}`}
        src={slackEmojiHref(face.name)}
        alt={`:${name}:`}
        data-tip={`:${name}:`}
        loading="lazy"
        draggable={false}
      />
    );
  return <span className="slack-emoji-name">:{name}:</span>;
}

/** A conversation's mark: # for a channel, a lock for a private one, the person for a DM, people for a group DM. */
export function ConversationIcon({ conversation, size = 14 }: { conversation?: SlackConversation; size?: number }) {
  const user = useSlack((d) => (conversation?.userId ? d.users.get(conversation.userId) : undefined));
  if (!conversation || conversation.kind === "channel") return <Hash size={size} aria-hidden="true" className="slack-conv-icon" />;
  if (conversation.kind === "private") return <Lock size={size} aria-hidden="true" className="slack-conv-icon" />;
  if (conversation.kind === "im") return <Avatar user={user} size={size + 4} />;
  return <Users size={size} aria-hidden="true" className="slack-conv-icon" />;
}

/** Opens a web link as the chat does: in Conquer inside the macOS app, else the browser. */
export function openWebLink(url: string): void {
  if (macApp() && /^https?:/i.test(url)) postAppLink(url);
  else openExternal(url);
}

/** A link's click: in the macOS app, a web link opens in Conquer (a new tab); ⌥-click and others as usual. */
export function onLinkClick(e: MouseEvent<HTMLAnchorElement>): void {
  if (e.button !== 0 || e.altKey || e.metaKey) return;
  const href = e.currentTarget.href;
  if (!/^https?:/i.test(href) || new URL(href).origin === location.origin) return;
  e.preventDefault();
  openWebLink(href);
}

// ── Times ────────────────────────────────────────────────────────────

/** A Slack ts as its moment; an unsent message's (local) is now, as is anything malformed. */
export function tsDate(ts: string): Date {
  const date = new Date(Number(ts.split(".")[0]) * 1000);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** "10:42 AM". */
export const timeOf = (ts: string) => tsDate(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** The local day a ts falls on ("2026-10-31"), for day dividers. */
export function dayOf(ts: string): string {
  const d = tsDate(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** A day divider's words: Today, Yesterday, else "Monday, October 28" (with the year when it isn't this one). */
export function dayLabel(ts: string, now = new Date()): string {
  const d = tsDate(ts);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** A moment's full words, for a time's tooltip. */
export const fullTime = (ts: string) =>
  tsDate(ts).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** "120 KB", "4.2 MB". */
export { sizeText } from "../linear/files";
