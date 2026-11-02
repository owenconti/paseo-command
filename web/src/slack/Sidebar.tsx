import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Ellipsis, LoaderCircle, MessageSquareText, PanelLeftClose, Plus, RefreshCw, Search } from "lucide-react";
import { readStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { placeBelow } from "../linear/Picker";
import { ConversationIcon } from "./bits";
import {
  addSection,
  deleteSection,
  moveConversation,
  moveSection,
  newSectionId,
  recentItems,
  renameSection,
  sectionOf,
  sidebarSections,
  type RecentItem,
  type SectionKey,
} from "./sections";
import { isLive, needsYou, slackStore, titleWith, useSlack } from "./store";
import type { SlackConversation, SlackRecentThread, SlackSection } from "./types";

/** What a dragged conversation row, and a dragged section heading, carry. */
const DRAG_CONVERSATION = "application/x-paseo-slack-conversation";
const DRAG_SECTION = "application/x-paseo-slack-section";

const badgeOf = (n: number | undefined) => (n ? (n > 99 ? "99+" : String(n)) : undefined);

/** Right-click (or the context-menu key): where the menu opens. */
function menuPoint(e: ReactMouseEvent<HTMLElement>): { x: number; y: number } {
  const r = e.currentTarget.getBoundingClientRect();
  // From the keyboard there's no pointer: under the row's start.
  return e.clientX === 0 && e.clientY === 0 ? { x: r.left + 24, y: r.bottom } : { x: e.clientX, y: e.clientY };
}

function Item({
  c,
  title,
  selected,
  onOpen,
  onMenu,
  inRecent = false,
}: {
  c: SlackConversation;
  title: string;
  selected: boolean;
  onOpen: () => void;
  onMenu: (at: { x: number; y: number }) => void;
  /** Recent's copy of the row (the conversation also shows in its own section). */
  inRecent?: boolean;
}) {
  const unread = !!c.unread && !c.isMuted;
  const badge = badgeOf(c.mentions);
  return (
    <button
      type="button"
      className={`slack-nav-item${selected ? " selected" : ""}${unread || c.mentions ? " unread" : ""}${c.isMuted ? " muted" : ""}`}
      aria-current={selected ? "page" : undefined}
      {...(inRecent ? { "data-recent-conversation": c.id } : { "data-conversation": c.id })}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_CONVERSATION, c.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(menuPoint(e));
      }}
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

/** A thread you're in, in Recent: "Thread in #channel" and its first words; bold while a reply from someone else is unread. */
function ThreadItem({ t, where, selected, onOpen }: { t: SlackRecentThread; where: string; selected: boolean; onOpen: () => void }) {
  const label = `Thread in ${where}`;
  return (
    <button
      type="button"
      className={`slack-nav-item slack-nav-thread${selected ? " selected" : ""}${t.unread ? " unread" : ""}`}
      aria-current={selected ? "page" : undefined}
      data-thread={`${t.conversationId}:${t.threadTs}`}
      data-tip={t.text ? `${label}: ${t.text}` : label}
      onClick={onOpen}
    >
      <MessageSquareText size={14} className="slack-conv-icon" aria-hidden="true" />
      <span className="slack-nav-label">
        {label}
        {t.text && <span className="slack-nav-words"> · {t.text}</span>}
      </span>
      {t.mention && (
        <span className="slack-nav-badge" aria-label="1 mention">
          1
        </span>
      )}
      {!t.mention && t.unread && <span className="sr-only">unread</span>}
    </button>
  );
}

type MenuItem = { label: string; run: () => void; danger?: boolean };

/** A small menu at a point (a row's or a section's): ↑/↓ move, Enter picks, Esc or a click elsewhere closes. */
function Menu({ at, label, items, onClose }: { at: { x: number; y: number }; label: string; items: MenuItem[]; onClose: () => void }) {
  const menu = useRef<HTMLDivElement | null>(null);
  const place = useCallback((el: HTMLDivElement | null) => {
    menu.current = el;
    if (el) placeBelow(el);
  }, []);
  useEffect(() => {
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus({ preventScroll: true });
    const down = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", down, true);
    return () => document.removeEventListener("mousedown", down, true);
  }, [onClose]);
  return createPortal(
    <span className="menu-anchor slack-menu-anchor" style={{ left: Math.max(8, Math.min(at.x, window.innerWidth - 240)), top: at.y }}>
      <div
        ref={place}
        role="menu"
        aria-label={label}
        className="popover-menu left slack-menu"
        onBlur={(e) => {
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) onClose();
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab") return;
          // The menu's keys are its own (not the view's ⌥↑/↓, nor the page's Esc).
          e.stopPropagation();
          const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
          const i = all.indexOf(document.activeElement as HTMLElement);
          const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: all.length - 1 }[e.key as "Home"];
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (to !== undefined && all.length) {
            e.preventDefault();
            all[(to + all.length) % all.length].focus();
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className={item.danger ? "danger-text" : undefined}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </span>,
    document.body,
  );
}

/** A section's name being typed (a new section, or a renamed one): Enter saves, Esc puts it back. */
function NameField({ initial, label, onDone }: { initial: string; label: string; onDone: (name: string | undefined) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (name: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(name?.trim() ? name.trim().slice(0, 80) : undefined);
  };
  return (
    <input
      className="slack-nav-name"
      aria-label={label}
      placeholder="Section name"
      value={value}
      maxLength={80}
      autoFocus
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(undefined);
        }
      }}
      onBlur={() => finish(value)}
    />
  );
}

type Naming = { kind: "new"; conversationId?: string } | { kind: "rename"; id: string };
type OpenMenu = { at: { x: number; y: number }; conversationId?: string; sectionId?: string };

/**
 * The Slack view's sidebar, as Slack's: the workspace and search, then
 * Recent (the conversations and threads you're in with the newest messages),
 * Unreads, your own sections (made here: Slack doesn't let apps read the ones
 * made in Slack), Starred, Channels and Direct messages (sections open and
 * close, remembered). Unread conversations are bold, with a badge counting
 * what mentions you; muted ones are dimmed. A conversation's context menu,
 * or dragging it, moves it into a section; a section's renames, moves or
 * deletes it, and dragging its heading moves it. Whether changes arrive live
 * or by polling shows at the foot.
 */
export function Sidebar({
  openId,
  openThreadTs,
  keep,
  searching,
  onOpen,
  onOpenThread,
  onSearch,
  onHide,
  onRefresh,
  refreshing,
}: {
  openId?: string;
  openThreadTs?: string;
  /** The open conversation stays in Unreads while open, if it was there. */
  keep?: string;
  searching: boolean;
  onOpen: (id: string) => void;
  onOpenThread: (conversationId: string, threadTs: string) => void;
  onSearch: () => void;
  onHide: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const teamName = useSlack((d) => d.workspace?.teamName);
  const conversations = useSlack((d) => d.conversations);
  const users = useSlack((d) => d.users);
  const threads = useSlack((d) => d.recentThreads);
  const custom = useSlack((d) => d.sections);
  const pending = useSlack((d) => d.unreadsPending);
  const live = useSlack((d) => d.live);
  const liveNow = useSlack(isLive);
  const streamDown = useSlack((d) => d.stream === "down");
  const titleOf = useMemo(() => (c: SlackConversation) => titleWith(users, c), [users]);
  const sections = useMemo(() => sidebarSections(conversations.values(), titleOf, keep, custom), [conversations, titleOf, keep, custom]);
  const recent = useMemo(() => recentItems(conversations.values(), threads), [conversations, threads]);
  const [closed, setClosed] = useState<SectionKey[]>(() => readStore<SectionKey[]>("slack:sectionsClosed", []));
  const setOpen = (key: SectionKey, open: boolean) =>
    setClosed((was) => {
      if (was.includes(key) !== open) return was;
      const next = open ? was.filter((k) => k !== key) : [...was, key];
      writeStore("slack:sectionsClosed", next);
      return next;
    });
  const toggle = (key: SectionKey) => setOpen(key, closed.includes(key));
  const [naming, setNaming] = useState<Naming>();
  const [menu, setMenu] = useState<OpenMenu>();
  const [deleting, setDeleting] = useState<string>();
  const [dropAt, setDropAt] = useState<SectionKey>();
  const nav = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenu(undefined), []);

  const save = (next: SlackSection[]) => void slackStore.saveSections(next);
  const finishNaming = (name: string | undefined) => {
    const was = naming;
    setNaming(undefined);
    if (!was || !name) return;
    if (was.kind === "new") {
      const id = newSectionId();
      save(addSection(slackStore.getState().sections, id, name, was.conversationId));
      setOpen(`section:${id}`, true);
    } else save(renameSection(slackStore.getState().sections, was.id, name));
  };
  const moveTo = (conversationId: string, sectionId: string | undefined) => {
    save(moveConversation(slackStore.getState().sections, conversationId, sectionId));
    if (sectionId) setOpen(`section:${sectionId}`, true);
  };

  // ⌘K: Recent shows (opened, scrolled to); a new section is named (for the open conversation, when asked).
  useEffect(() => {
    const offs = [
      onAppCommand("slack-recent", () => {
        setOpen("recent", true);
        requestAnimationFrame(() => {
          const head = document.getElementById("slack-nav-recent");
          head?.scrollIntoView({ block: "start" });
          (nav.current?.querySelector<HTMLElement>("[data-recent] .slack-nav-item") ?? head)?.focus({ preventScroll: true });
        });
      }),
      onAppCommand("slack-new-section", (arg) =>
        setNaming({ kind: "new", ...(typeof arg === "string" && conversations.has(arg) ? { conversationId: arg } : {}) }),
      ),
    ];
    return () => offs.forEach((off) => off());
  });

  // Dropping a dragged row on a section (before the row it's dropped on), or on Channels or Direct messages (out of every section).
  const dropProps = (key: SectionKey, section?: SlackSection) => {
    const takes = key.startsWith("section:") || key === "channels" || key === "dms";
    if (!takes) return {};
    const kinds = (e: DragEvent) => [...e.dataTransfer.types];
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        const types = kinds(e);
        if (!types.includes(DRAG_CONVERSATION) && !(section && types.includes(DRAG_SECTION))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dropAt !== key) setDropAt(key);
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt((k) => (k === key ? undefined : k));
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        setDropAt(undefined);
        const all = slackStore.getState().sections;
        const movedSection = e.dataTransfer.getData(DRAG_SECTION);
        if (movedSection && section) {
          e.preventDefault();
          if (movedSection !== section.id) save(moveSection(all, movedSection, all.filter((s) => s.id !== movedSection).findIndex((s) => s.id === section.id)));
          return;
        }
        const id = e.dataTransfer.getData(DRAG_CONVERSATION);
        if (!id) return;
        e.preventDefault();
        if (!section) {
          if (sectionOf(all, id)) save(moveConversation(all, id, undefined));
          return;
        }
        const before = (e.target as HTMLElement).closest<HTMLElement>("[data-conversation]")?.dataset.conversation;
        if (before !== id) save(moveConversation(all, id, section.id, before));
      },
    };
  };

  const recentOpen = !closed.includes("recent");
  const menuItems = (): MenuItem[] => {
    if (!menu) return [];
    const all = custom;
    if (menu.conversationId) {
      const id = menu.conversationId;
      const inSection = sectionOf(all, id);
      return [
        ...all.filter((s) => s.id !== inSection?.id).map((s) => ({ label: `Move to ${s.name}`, run: () => moveTo(id, s.id) })),
        { label: "Move to a new section…", run: () => setNaming({ kind: "new", conversationId: id }) },
        ...(inSection ? [{ label: `Remove from ${inSection.name}`, run: () => moveTo(id, undefined) }] : []),
      ];
    }
    const i = all.findIndex((s) => s.id === menu.sectionId);
    const s = all[i];
    if (!s) return [];
    return [
      { label: "Rename…", run: () => setNaming({ kind: "rename", id: s.id }) },
      ...(i > 0 ? [{ label: "Move up", run: () => save(moveSection(all, s.id, i - 1)) }] : []),
      ...(i < all.length - 1 ? [{ label: "Move down", run: () => save(moveSection(all, s.id, i + 1)) }] : []),
      { label: "Delete section…", danger: true, run: () => setDeleting(s.id) },
    ];
  };
  const menuTitle = menu?.conversationId
    ? `Move ${titleOf(conversations.get(menu.conversationId)!)}`
    : `Section ${custom.find((s) => s.id === menu?.sectionId)?.name ?? ""}`;

  const recentRow = (item: RecentItem) => {
    if (item.kind === "conversation") {
      const c = item.conversation;
      return (
        <div key={item.key} data-recent>
          <Item
            c={c}
            title={titleOf(c)}
            selected={c.id === openId && !openThreadTs}
            onOpen={() => onOpen(c.id)}
            onMenu={(at) => setMenu({ at, conversationId: c.id })}
            inRecent
          />
        </div>
      );
    }
    const t = item.thread;
    return (
      <div key={item.key} data-recent>
        <ThreadItem
          t={t}
          where={item.conversation ? titleOf(item.conversation) : "a conversation"}
          selected={t.conversationId === openId && t.threadTs === openThreadTs}
          onOpen={() => onOpenThread(t.conversationId, t.threadTs)}
        />
      </div>
    );
  };

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
      <div className="slack-nav" ref={nav}>
        {conversations.size === 0 && <p className="slack-nav-note">Loading…</p>}
        {conversations.size > 0 && (
          <section aria-labelledby="slack-nav-recent" className="slack-nav-recent">
            <h3>
              <button type="button" id="slack-nav-recent" className="slack-nav-section" aria-expanded={recentOpen} onClick={() => toggle("recent")}>
                <ChevronRight size={12} className="slack-nav-chevron" aria-hidden="true" />
                Recent
              </button>
            </h3>
            {recentOpen && recent.map(recentRow)}
            {recentOpen && recent.length === 0 && (
              <p className="slack-nav-note">{pending > 0 ? "Finding recent conversations…" : "Nothing recent yet."}</p>
            )}
          </section>
        )}
        {sections.map((s) => {
          const open = !closed.includes(s.key);
          const own = s.section;
          return (
            <section
              key={s.key}
              aria-labelledby={`slack-nav-${s.key}`}
              className={dropAt === s.key ? "drop-target" : undefined}
              data-section={own?.id}
              {...dropProps(s.key, own)}
            >
              <h3 className={own ? "slack-nav-own" : undefined}>
                {own && naming?.kind === "rename" && naming.id === own.id ? (
                  <NameField initial={own.name} label={`Rename ${own.name}`} onDone={finishNaming} />
                ) : (
                  <button
                    type="button"
                    id={`slack-nav-${s.key}`}
                    className="slack-nav-section"
                    aria-expanded={open}
                    onClick={() => toggle(s.key)}
                    draggable={!!own}
                    onDragStart={
                      own
                        ? (e) => {
                            e.dataTransfer.setData(DRAG_SECTION, own.id);
                            e.dataTransfer.effectAllowed = "move";
                          }
                        : undefined
                    }
                    onContextMenu={
                      own
                        ? (e) => {
                            e.preventDefault();
                            setMenu({ at: menuPoint(e), sectionId: own.id });
                          }
                        : undefined
                    }
                  >
                    <ChevronRight size={12} className="slack-nav-chevron" aria-hidden="true" />
                    <span className="slack-nav-section-name">{s.title}</span>
                  </button>
                )}
                {own && naming?.kind !== "rename" && (
                  <button
                    type="button"
                    className="icon-btn slack-nav-more"
                    aria-label={`${own.name} section options`}
                    data-tip="Rename, move or delete"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      setMenu({ at: { x: r.left, y: r.bottom }, sectionId: own.id });
                    }}
                  >
                    <Ellipsis size={13} aria-hidden="true" />
                  </button>
                )}
              </h3>
              {own && deleting === own.id && (
                <div className="slack-confirm slack-nav-confirm" role="group" aria-label={`Delete ${own.name}?`}>
                  <span>
                    Delete {own.name}?{" "}
                    {own.conversationIds.length ? "Its conversations go back to Channels and Direct messages." : ""}
                  </span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      setDeleting(undefined);
                      save(deleteSection(slackStore.getState().sections, own.id));
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    autoFocus
                    onClick={() => setDeleting(undefined)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setDeleting(undefined);
                      }
                    }}
                  >
                    Keep
                  </button>
                </div>
              )}
              {open &&
                s.items.map((c) => (
                  <Item
                    key={c.id}
                    c={c}
                    title={titleOf(c)}
                    selected={c.id === openId}
                    onOpen={() => onOpen(c.id)}
                    onMenu={(at) => setMenu({ at, conversationId: c.id })}
                  />
                ))}
              {open && s.items.length === 0 && <p className="slack-nav-note">{own ? "Drag conversations here." : "None yet."}</p>}
            </section>
          );
        })}
        {conversations.size > 0 &&
          (naming?.kind === "new" ? (
            <div className="slack-nav-new">
              <NameField initial="" label="New section's name" onDone={finishNaming} />
            </div>
          ) : (
            <button type="button" className="slack-nav-add" onClick={() => setNaming({ kind: "new" })}>
              <Plus size={12} aria-hidden="true" />
              New section
            </button>
          ))}
      </div>
      {menu && <Menu at={menu.at} label={menuTitle} items={menuItems()} onClose={closeMenu} />}
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
