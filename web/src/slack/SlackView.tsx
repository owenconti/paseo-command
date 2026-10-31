import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { MessagesSquare, PanelLeftOpen, RefreshCw } from "lucide-react";
import { errorMessage, readStore, removeStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { modalOpen } from "../focus";
import { useSecretRevision } from "../integrationSettings";
import { isTyping } from "../worldShortcut";
import { slackContext } from "./context";
import { Conversation } from "./Conversation";
import { slackKeyAction, type SlackKey } from "./keys";
import { checkPlace, readPlace, writePlace, type SlackPlace } from "./place";
import type { SlackContext } from "./prompt";
import { Search } from "./Search";
import { Sidebar } from "./Sidebar";
import { listed, sidebarSections, stepConversation } from "./sections";
import {
  compareTs,
  findMessage,
  loadHistory,
  loadThread,
  loadUnreads,
  loadWorkspace,
  needsYou,
  setSlackNotice,
  slackStore,
  titleWith,
  useSlack,
  useSlackLive,
  type ShownMessage,
} from "./store";
import { changeTextStep, checkTextStep, textSizeKey, type TextChange } from "./textSize";
import { Thread } from "./Thread";
import type { SlackConversationKind, SlackSearchHit } from "./types";
import "./slack.css";

export type { SlackContext } from "./prompt";
export { openSlackPlace } from "./place";

/** What ⌘K needs to know of the Slack view, to offer only what works. */
export type SlackViewState = {
  /** The sidebar's conversations, in its order (⌘K's "Go to #x"); `unread` when one needs you. */
  conversations: { id: string; name: string; kind: SlackConversationKind; unread?: number }[];
  openConversationId?: string;
  threadOpen: boolean;
  /** Conversations that need you (unread, not muted; or mentioning you). */
  unreadCount: number;
  /** Unread messages that mention you (DMs count each), where known. */
  mentionCount: number;
  /** A conversation with messages shows, so an agent can be launched from it. */
  canLaunch: boolean;
  /** The search shows (Esc closes it). */
  searching: boolean;
};

/** The sidebar's width: its default, and the least it and the rest of the view keep. */
const SIDEBAR = { width: 260, min: 180, restMin: 360 };
const sidebarMax = (viewWidth: number) => Math.max(SIDEBAR.min, viewWidth - SIDEBAR.restMin);
/** The thread beside the conversation: its default and least width, and the least the conversation keeps. */
const THREAD = { width: 420, min: 320, conversationMin: 360 };
/** From this width the thread shows beside the conversation; narrower, in its place. */
const BESIDE_MIN = 1100;
/** How long a message opened to (a search hit, an Activity item) stays marked. */
const HIGHLIGHT_MS = 4000;
/** Layers in the view that keep their own keys while open. */
const LAYERS = ".popover-menu, .autocomplete, .lightbox, .slack-confirm";

/**
 * The Slack tab, in the map's place (the macOS app's mode bar), laid out as
 * Slack is: the sidebar (Unreads, Starred, Channels, Direct messages, and
 * search), the open conversation, and its open thread beside it (in its
 * place when narrow). Messages come live from the app server's events (or
 * by polling every 20 s while they can't), and a conversation is marked
 * read as its newest message shows. Any message (or thread) can start an
 * agent: New agent opens with it quoted. As Linear's, the sidebar's inner
 * edge resizes it, ⌘S hides it, ⌘+ ⌘− ⌘0 size the text, and the place comes
 * back after a reload.
 */
export function SlackView({
  onLaunch,
  onNotice,
  onViewState,
}: {
  onLaunch: (context: SlackContext) => void;
  onNotice: (message: string) => void;
  /** The view's conversations and offers, for ⌘K (undefined once it goes). */
  onViewState?: (state: SlackViewState | undefined) => void;
}) {
  useSlackLive(true);
  useEffect(() => setSlackNotice(onNotice), [onNotice]);
  const ws = useSlack((d) => d.workspace);
  const unavailable = useSlack((d) => d.unavailable);
  const [workspaceError, setWorkspaceError] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);

  // The place: the open conversation and thread, and a message to show once.
  const [place, setPlaceState] = useState<SlackPlace>(() => readPlace());
  const setPlace = useCallback((next: SlackPlace) => {
    setPlaceState(next);
    writePlace(next);
  }, []);
  const placeRef = useRef(place);
  placeRef.current = place;
  const conversationId = place.conversationId;
  const threadTs = place.threadTs;
  useEffect(() => {
    slackStore.setOpen({ conversationId, threadTs });
    return () => slackStore.setOpen({});
  }, [conversationId, threadTs]);
  // A message opened to stays marked a while.
  useEffect(() => {
    if (!place.ts) return;
    const timer = setTimeout(() => setPlaceState(({ ts: _, ...rest }) => rest), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [place.ts]);

  // Search, in the conversation's place.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState(() => readStore<string>("slack:search", ""));
  const searchFocus = useRef<(() => void) | null>(null);
  const composerFocus = useRef<(() => void) | null>(null);
  const threadComposerFocus = useRef<(() => void) | null>(null);
  const find = useCallback(() => {
    setSearching(true);
    requestAnimationFrame(() => searchFocus.current?.());
  }, []);
  const setSearch = (q: string) => {
    setQuery(q);
    writeStore("slack:search", q);
  };

  // The layout: the sidebar's width (resized, hidden), the thread's, and the text size.
  const [view, setView] = useState<HTMLElement | null>(null);
  const [viewWidth, setViewWidth] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => readStore("slack:sidebarWidth", SIDEBAR.width));
  const [sidebarHidden, setSidebarHidden] = useState(() => readStore("slack:sidebarHidden", false));
  const [threadWidth, setThreadWidth] = useState(() => readStore("slack:threadWidth", THREAD.width));
  const width = viewWidth ? Math.round(Math.min(sidebarMax(viewWidth), Math.max(SIDEBAR.min, sidebarWidth))) : sidebarWidth;
  const threadMax = Math.max(THREAD.min, viewWidth - (sidebarHidden ? 0 : width) - THREAD.conversationMin);
  const threadW = viewWidth ? Math.round(Math.min(threadMax, Math.max(THREAD.min, threadWidth))) : threadWidth;
  const drag = useRef<{ x: number; width: number; edge: "sidebar" | "thread" } | null>(null);
  const resizeSidebar = (next: number) => {
    const w = viewWidth ? Math.round(Math.min(sidebarMax(viewWidth), Math.max(SIDEBAR.min, next))) : next;
    setSidebarWidth(w);
    writeStore("slack:sidebarWidth", w);
  };
  const resizeThread = (next: number | null) => {
    const w = next === null ? THREAD.width : Math.round(Math.min(threadMax, Math.max(THREAD.min, next)));
    setThreadWidth(w);
    if (next === null) removeStore("slack:threadWidth");
    else writeStore("slack:threadWidth", w);
  };
  useEffect(() => {
    if (!view) return;
    const watch = new ResizeObserver(() => setViewWidth(view.clientWidth));
    watch.observe(view);
    return () => watch.disconnect();
  }, [view]);
  const [textStep, setTextStep] = useState(() => checkTextStep(readStore<unknown>("slack:textSize", undefined)));
  useEffect(() => {
    document.documentElement.style.setProperty("--slack-text", `${textStep}px`);
  }, [textStep]);
  const resizeText = (change: TextChange) =>
    setTextStep((step) => {
      const next = changeTextStep(step, change);
      writeStore("slack:textSize", next);
      return next;
    });
  const toggleSidebar = () =>
    setSidebarHidden((hidden) => {
      writeStore("slack:sidebarHidden", !hidden);
      return !hidden;
    });

  // Reads.
  const loadWs = useCallback(
    (fresh: boolean) =>
      loadWorkspace(fresh).then(
        () => setWorkspaceError(undefined),
        (e) => {
          setWorkspaceError(errorMessage(e));
          throw e;
        },
      ),
    [],
  );
  useEffect(() => {
    loadWs(false)
      .then(() => loadUnreads())
      .catch(() => {});
  }, [loadWs]);
  const refresh = () => {
    setRefreshing(true);
    setRevision((r) => r + 1);
    const { conversationId: c, threadTs: t } = placeRef.current;
    Promise.all([
      loadWs(true).then(() => loadUnreads()),
      c ? loadHistory(c, true) : undefined,
      c && t ? loadThread(c, t, true) : undefined,
    ])
      .catch((e) => onNotice(`Couldn’t refresh Slack: ${errorMessage(e)}`))
      .finally(() => setRefreshing(false));
  };
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // A Slack token saved, replaced or removed in Settings: ask Slack again at once.
  const userToken = useSecretRevision("slackUserToken");
  const appToken = useSecretRevision("slackAppToken");
  useEffect(() => {
    if (userToken || appToken) refreshRef.current();
  }, [userToken, appToken]);

  // With nothing open, the first conversation that needs you, else the first channel.
  const order = useCallback(() => {
    const d = slackStore.getState();
    return sidebarSections(d.conversations.values(), (c) => titleWith(d.users, c), keepRef.current).flatMap((s) => s.items);
  }, []);
  useEffect(() => {
    if (!ws || placeRef.current.conversationId) return;
    const first = order()[0];
    if (first) setPlace({ conversationId: first.id });
  }, [ws, order, setPlace]);

  // As a conversation opens: where you'd read to (the "New" line), and whether it was unread (it stays in Unreads while open).
  const conversation = useSlack((d) => (conversationId ? d.conversations.get(conversationId) : undefined));
  const [opened, setOpened] = useState<{ id: string; lastRead?: string; keep: boolean }>();
  const keepRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!conversation || opened?.id === conversation.id) return;
    setOpened({ id: conversation.id, lastRead: conversation.lastRead, keep: needsYou(conversation) });
  }, [conversation, opened?.id]);
  const shownOpened = opened?.id === conversationId ? opened : undefined;
  keepRef.current = shownOpened?.keep ? shownOpened.id : undefined;

  const openConversation = useCallback(
    (id: string, ts?: string) => {
      setSearching(false);
      setPlace({ conversationId: id, ...(ts ? { ts } : {}) });
    },
    [setPlace],
  );
  const openThread = useCallback((ts: string) => setPlace({ ...placeRef.current, threadTs: ts, ts: undefined }), [setPlace]);
  const closeThread = useCallback(() => {
    const { threadTs: _, ts: __, ...rest } = placeRef.current;
    setPlace(rest);
  }, [setPlace]);
  const openHit = (hit: SlackSearchHit) => {
    setSearching(false);
    if (hit.threadTs && hit.threadTs !== hit.ts) setPlace({ conversationId: hit.conversationId, threadTs: hit.threadTs, ts: hit.ts });
    else setPlace({ conversationId: hit.conversationId, ts: hit.ts });
  };
  const step = useCallback(
    (dir: 1 | -1, unreadOnly: boolean) => {
      const next = stepConversation(order(), placeRef.current.conversationId, dir, unreadOnly);
      if (next) openConversation(next);
      return !!next;
    },
    [order, openConversation],
  );

  // The message the keyboard or pointer is on: ⌘K's Launch agent takes it (else the open thread, else the newest).
  const selected = useRef<string | undefined>(undefined);
  const onSelect = useCallback((ts: string) => {
    selected.current = ts;
  }, []);
  useEffect(() => {
    selected.current = undefined;
  }, [conversationId]);
  const launchFrom = useCallback(
    (m?: ShownMessage) => {
      const d = slackStore.getState();
      const { conversationId: c, threadTs: t } = placeRef.current;
      if (!c) return;
      const inThread = !!t && (!m || m.threadTs === t);
      let context: SlackContext | undefined;
      if (inThread) context = slackContext(d, c, t!, t);
      else {
        const ts = m?.ts ?? (selected.current && findMessage(d, c, selected.current) ? selected.current : undefined);
        const newest = d.history.get(c)?.messages.filter((x) => !x.pending).at(-1)?.ts;
        const at = ts ?? newest;
        if (at) context = slackContext(d, c, at);
      }
      if (context) onLaunch(context);
      else onNotice("There’s no message here to start an agent from yet.");
    },
    [onLaunch, onNotice],
  );

  // ⌘K's commands.
  useEffect(() => {
    const offs = [
      onAppCommand("slack-refresh", () => refreshRef.current()),
      onAppCommand("slack-sidebar", toggleSidebar),
      onAppCommand("slack-search", find),
      onAppCommand("slack-go", (arg) => {
        if (typeof arg === "string" && checkPlace({ conversationId: arg }).conversationId) openConversation(arg);
      }),
      onAppCommand("slack-open", (arg) => {
        const next = checkPlace(arg);
        if (!next.conversationId) return;
        setSearching(false);
        setPlace(next);
      }),
      onAppCommand("slack-next-unread", () => {
        if (!step(1, true)) onNotice("Nothing else in Slack is unread.");
      }),
      onAppCommand("slack-mark-read", () => {
        const c = placeRef.current.conversationId;
        const newest = c && slackStore.getState().history.get(c)?.messages.filter((m) => !m.pending).at(-1)?.ts;
        const latest = c && slackStore.getState().conversations.get(c)?.latest;
        const to = newest && latest ? (compareTs(newest, latest) > 0 ? newest : latest) : (newest ?? latest);
        if (c && to) void slackStore.markRead(c, to);
      }),
      onAppCommand("slack-close-thread", closeThread),
      onAppCommand("slack-compose", () => {
        setSearching(false);
        requestAnimationFrame(() => composerFocus.current?.());
      }),
      onAppCommand("slack-launch", () => launchFrom()),
      onAppCommand("slack-text-bigger", () => resizeText("bigger")),
      onAppCommand("slack-text-smaller", () => resizeText("smaller")),
      onAppCommand("slack-text-actual", () => resizeText("actual")),
    ];
    return () => offs.forEach((off) => off());
  }, [find, openConversation, setPlace, step, closeThread, launchFrom, onNotice]);

  // ⌘S, as in Conquer, and ⌘+ ⌘− ⌘0 (the text size): while Slack shows, the page has the keys.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      const change = textSizeKey(e);
      if (change) {
        e.preventDefault();
        resizeText(change);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const narrow = viewWidth > 0 && viewWidth < BESIDE_MIN;
  const threadOnly = !!threadTs && narrow;
  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || !e.key || modalOpen()) return;
    const layered = [...e.currentTarget.querySelectorAll(LAYERS)].some((layer) => !layer.closest("[inert]"));
    const { key, metaKey, shiftKey, ctrlKey, altKey } = e;
    const action = e.defaultPrevented || layered ? null : slackKeyAction({ key, metaKey, shiftKey, ctrlKey, altKey, target });
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(target);
    if (action && keyAction(action)) {
      e.preventDefault();
      e.stopPropagation();
    } else if (plain && (/^[a-z]$/i.test(e.key) || e.key.startsWith("Arrow"))) e.stopPropagation();
  };
  const keyAction = (action: SlackKey): boolean => {
    switch (action) {
      case "previous":
      case "next":
        step(action === "next" ? 1 : -1, false);
        return true;
      case "previousUnread":
      case "nextUnread":
        step(action === "nextUnread" ? 1 : -1, true);
        return true;
      case "search":
        find();
        return true;
      case "back":
        // With nothing to close, Esc stops here: the page's own would clear the map's (hidden) selection.
        if (placeRef.current.threadTs) closeThread();
        else if (searching) setSearching(false);
        else return true;
        // The keyboard stays in the view as what had it goes.
        view?.focus({ preventScroll: true });
        return true;
      case "compose":
        if (searching) return false;
        (placeRef.current.threadTs ? threadComposerFocus : composerFocus).current?.();
        return true;
    }
  };

  // ⌘K's view state, sent only as it changes.
  const conversations = useSlack((d) => d.conversations);
  const users = useSlack((d) => d.users);
  const hasMessages = useSlack((d) => !!conversationId && !!d.history.get(conversationId)?.messages.some((m) => !m.pending));
  const viewState = (() => {
    const shown = [...conversations.values()].filter(listed);
    const sections = sidebarSections(shown, (c) => titleWith(users, c), keepRef.current);
    return JSON.stringify({
      conversations: sections.flatMap((s) =>
        s.items.map((c) => ({ id: c.id, name: titleWith(users, c), kind: c.kind, ...(needsYou(c) ? { unread: c.unread ?? c.mentions ?? 0 } : {}) })),
      ),
      ...(conversationId ? { openConversationId: conversationId } : {}),
      threadOpen: !!threadTs,
      unreadCount: shown.filter(needsYou).length,
      mentionCount: shown.reduce((n, c) => n + (c.mentions ?? 0), 0),
      canLaunch: hasMessages,
      searching,
    } satisfies SlackViewState);
  })();
  useEffect(() => {
    onViewState?.(JSON.parse(viewState) as SlackViewState);
  }, [viewState, onViewState]);
  useEffect(() => () => onViewState?.(undefined), [onViewState]);

  if (!ws && (unavailable || workspaceError))
    return (
      <section className="slack-view slack-unavailable" aria-label="Slack" ref={setView}>
        <MessagesSquare size={28} strokeWidth={1.5} aria-hidden="true" />
        <h2>{unavailable ? "Slack isn’t connected" : "Slack didn’t answer"}</h2>
        <p>{unavailable?.reason ?? workspaceError}</p>
        <button className="secondary" onClick={refresh} disabled={refreshing}>
          <RefreshCw size={12} aria-hidden="true" />
          Try again
        </button>
      </section>
    );

  const showMain = !threadOnly;
  const columns = [
    sidebarHidden ? null : `${width}px`,
    showMain ? "minmax(0, 1fr)" : null,
    threadTs ? (threadOnly ? "minmax(0, 1fr)" : `${threadW}px`) : null,
  ].filter(Boolean);
  const edge = (kind: "sidebar" | "thread") => ({
    role: "separator",
    "aria-orientation": "vertical" as const,
    tabIndex: 0,
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, width: kind === "sidebar" ? width : threadW, edge: kind };
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || d.edge !== kind) return;
      if (kind === "sidebar") resizeSidebar(d.width + e.clientX - d.x);
      else resizeThread(d.width - (e.clientX - d.x));
    },
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
    onLostPointerCapture: () => (drag.current = null),
    onDoubleClick: () => (kind === "sidebar" ? resizeSidebar(SIDEBAR.width) : resizeThread(null)),
    onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      e.stopPropagation();
      const by = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 64 : 16);
      if (kind === "sidebar") resizeSidebar(width + by);
      else resizeThread(threadW - by);
    },
  });

  return (
    <section
      className={`slack-view${sidebarHidden ? " sidebar-hidden" : ""}${threadOnly ? " thread-only" : ""}`}
      aria-label="Slack"
      ref={setView}
      style={{ gridTemplateColumns: columns.join(" ") }}
      // A click on the view's background keeps the keyboard in it, for its keys.
      tabIndex={-1}
      onKeyDown={onKey}
    >
      <nav className="slack-sidebar" id="slack-sidebar" aria-label="Slack conversations" hidden={sidebarHidden}>
        <Sidebar
          openId={conversationId}
          keep={keepRef.current}
          searching={searching}
          onOpen={(id) => openConversation(id)}
          onSearch={find}
          onHide={toggleSidebar}
          onRefresh={refresh}
          refreshing={refreshing}
        />
        <div
          className="slack-resize"
          {...edge("sidebar")}
          aria-label="Resize the Slack sidebar"
          aria-controls="slack-sidebar"
          aria-valuemin={SIDEBAR.min}
          aria-valuemax={viewWidth ? sidebarMax(viewWidth) : undefined}
          aria-valuenow={width}
          aria-description="Drag, or use the arrow keys, to change the sidebar's width. Shift resizes faster; double-click restores the default."
        />
      </nav>
      {sidebarHidden && (
        <button className="icon-btn slack-show-sidebar" aria-label="Show the Slack sidebar" data-tip="Show the sidebar (⌘S)" onClick={toggleSidebar}>
          <PanelLeftOpen size={14} aria-hidden="true" />
        </button>
      )}
      {showMain && (
        <div className="slack-main">
          {unavailable && (
            <p className="slack-banner" role="status">
              {unavailable.reason}
              {unavailable.retryAt ? ` Trying again ${new Date(unavailable.retryAt).toLocaleTimeString()}.` : ""}
            </p>
          )}
          {searching ? (
            <Search
              query={query}
              onQuery={setSearch}
              onOpen={openHit}
              onClose={() => setSearching(false)}
              focusRef={searchFocus}
              revision={revision}
              sidebarHidden={sidebarHidden}
            />
          ) : conversationId ? (
            <Conversation
              key={conversationId}
              conversationId={conversationId}
              unreadFrom={shownOpened?.lastRead}
              highlightTs={place.threadTs ? undefined : place.ts}
              onThread={openThread}
              onLaunch={launchFrom}
              onSelect={onSelect}
              composerFocus={composerFocus}
              sidebarHidden={sidebarHidden}
            />
          ) : (
            <div className="slack-empty">
              <p>{ws ? "No conversations yet." : "Loading Slack…"}</p>
            </div>
          )}
          {threadTs && !threadOnly && (
            <div
              className="slack-resize"
              {...edge("thread")}
              aria-label="Resize the thread"
              aria-controls="slack-thread"
              aria-valuemin={THREAD.min}
              aria-valuemax={viewWidth ? threadMax : undefined}
              aria-valuenow={threadW}
              aria-description="Drag, or use the arrow keys, to change the thread's width. Shift resizes faster; double-click restores the default."
            />
          )}
        </div>
      )}
      {conversationId && threadTs && (
        <Thread
          key={`${conversationId}:${threadTs}`}
          conversationId={conversationId}
          threadTs={threadTs}
          highlightTs={place.ts}
          beside={!threadOnly}
          onClose={closeThread}
          onLaunch={launchFrom}
          onSelect={onSelect}
          composerFocus={threadComposerFocus}
        />
      )}
    </section>
  );
}
