import { useMemo, useState } from "react";
import { ChevronRight, LoaderCircle, PanelLeftClose, RefreshCw, Search } from "lucide-react";
import { readStore, writeStore } from "../api";
import { ConversationIcon } from "./bits";
import { sidebarSections, type SectionKey } from "./sections";
import { isLive, needsYou, titleWith, useSlack } from "./store";
import type { SlackConversation } from "./types";

function Item({ c, title, selected, onOpen }: { c: SlackConversation; title: string; selected: boolean; onOpen: () => void }) {
  const unread = !!c.unread && !c.isMuted;
  const badge = c.mentions ? (c.mentions > 99 ? "99+" : String(c.mentions)) : undefined;
  return (
    <button
      type="button"
      className={`slack-nav-item${selected ? " selected" : ""}${unread || c.mentions ? " unread" : ""}${c.isMuted ? " muted" : ""}`}
      aria-current={selected ? "page" : undefined}
      data-conversation={c.id}
      onClick={onOpen}
    >
      <ConversationIcon conversation={c} />
      <span className="slack-nav-label">{c.kind === "channel" || c.kind === "private" ? c.name : title}</span>
      {badge && (
        <span className="slack-nav-badge" aria-label={`${c.mentions} ${c.mentions === 1 ? "mention" : "mentions"}`}>
          {badge}
        </span>
      )}
      {!badge && needsYou(c) && <span className="sr-only">unread</span>}
    </button>
  );
}

/**
 * The Slack view's sidebar, as Slack's: the workspace and search, then
 * Unreads, Starred, Channels and Direct messages (sections open and close,
 * remembered). Unread conversations are bold, with a badge counting what
 * mentions you; muted ones are dimmed. Whether changes arrive live or by
 * polling shows at the foot.
 */
export function Sidebar({
  openId,
  keep,
  searching,
  onOpen,
  onSearch,
  onHide,
  onRefresh,
  refreshing,
}: {
  openId?: string;
  /** The open conversation stays in Unreads while open, if it was there. */
  keep?: string;
  searching: boolean;
  onOpen: (id: string) => void;
  onSearch: () => void;
  onHide: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const teamName = useSlack((d) => d.workspace?.teamName);
  const conversations = useSlack((d) => d.conversations);
  const users = useSlack((d) => d.users);
  const pending = useSlack((d) => d.unreadsPending);
  const live = useSlack((d) => d.live);
  const liveNow = useSlack(isLive);
  const streamDown = useSlack((d) => d.stream === "down");
  const titleOf = useMemo(() => (c: SlackConversation) => titleWith(users, c), [users]);
  const sections = useMemo(() => sidebarSections(conversations.values(), titleOf, keep), [conversations, titleOf, keep]);
  const [closed, setClosed] = useState<SectionKey[]>(() => readStore<SectionKey[]>("slack:sectionsClosed", []));
  const toggle = (key: SectionKey) =>
    setClosed((was) => {
      const next = was.includes(key) ? was.filter((k) => k !== key) : [...was, key];
      writeStore("slack:sectionsClosed", next);
      return next;
    });

  return (
    <>
      <header className="slack-sidebar-head">
        <h2>{teamName ?? "Slack"}</h2>
        <button type="button" className="icon-btn" aria-label="Search Slack" aria-pressed={searching} data-tip="Search all messages (/)" onClick={onSearch}>
          <Search size={14} aria-hidden="true" />
        </button>
        <button type="button" className="icon-btn" aria-label="Refresh" data-tip="Ask Slack again" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? <LoaderCircle size={14} className="spinning" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
        </button>
        <button type="button" className="icon-btn" aria-label="Hide the Slack sidebar" data-tip="Hide the sidebar (⌘S)" onClick={onHide}>
          <PanelLeftClose size={14} aria-hidden="true" />
        </button>
      </header>
      <div className="slack-nav">
        {conversations.size === 0 && <p className="slack-nav-note">Loading…</p>}
        {sections.map((s) => {
          const open = !closed.includes(s.key);
          return (
            <section key={s.key} aria-labelledby={`slack-nav-${s.key}`}>
              <h3>
                <button type="button" id={`slack-nav-${s.key}`} className="slack-nav-section" aria-expanded={open} onClick={() => toggle(s.key)}>
                  <ChevronRight size={12} className="slack-nav-chevron" aria-hidden="true" />
                  {s.title}
                </button>
              </h3>
              {open &&
                s.items.map((c) => <Item key={c.id} c={c} title={titleOf(c)} selected={c.id === openId} onOpen={() => onOpen(c.id)} />)}
              {open && s.items.length === 0 && <p className="slack-nav-note">None yet.</p>}
            </section>
          );
        })}
      </div>
      <footer className="slack-sidebar-foot" role="status">
        {pending > 0 && (
          <span className="slack-foot-line">
            <LoaderCircle size={11} className="spinning" aria-hidden="true" />
            Checking {pending} {pending === 1 ? "conversation" : "conversations"} for unreads…
          </span>
        )}
        {live && (
          <span
            className={`slack-foot-line${liveNow ? " live" : ""}`}
            data-tip={liveNow ? "Messages arrive as they’re sent (Socket Mode)" : (live.reason ?? (streamDown ? "The app server’s event stream is down" : undefined))}
          >
            <span className="slack-live-dot" aria-hidden="true" />
            {liveNow ? "Live" : "Checking every 20 s"}
          </span>
        )}
      </footer>
    </>
  );
}
