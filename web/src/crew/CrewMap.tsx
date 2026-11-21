/** The Crew map: the fleet as a chat app, drawn by the page itself (in a plain browser too), in the map's place on the
 * Command tab (it is the only map). With nothing open it is the map: each host, its projects and their workspaces
 * (oldest first), each workspace a panel of its agents' robots as large nodes with their state and progress. Picking one
 * opens it in the drawer on the map's right (`CrewDetail`, the same component the session panel shows beside the other
 * tabs); Back (or Esc) returns to the map. A workspace's head archives it, and a claimed pool box's host head releases
 * the box. The robots, drones, marks, glows and medallions are `parts.tsx`'s. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Archive, ArrowLeft, ChevronDown, FolderTree, Globe, GripVertical, RotateCcw, Terminal, X } from "lucide-react";
import { STATE_NAMES, STATE_PRIORITY, modelName, type State } from "../model/fleet";
import { PoolClaims } from "../PoolClaims";
import { PoolBoxes } from "./PoolBoxes";
import { selectionKey } from "../atlasData";
import { targetSelection } from "../worldBridge";
import { readStore, writeStore } from "../api";
import { ResizeEdge } from "../ResizeEdge";
import { claimedBoxOf, jobOnBox, jobText, type PoolBox, type PoolJob } from "../pool";
import { placeText } from "../names";
import { workspaceKey } from "../workspaces";
import type { Selection, Workspace } from "../types";
import type { WorkSummaries } from "../useWorkingOn";
import { buildRoster, hostAgents, hostSpans, projectAgents, stateTally, type RosterAgent, type RosterWorkspace } from "./roster";
import { CrewDetail } from "./CrewDetail";
import { orderHosts, placeHost, showHosts, stepHost, useHostOrder } from "./hostOrder";
import { Medals, Portrait, useCrewData, type CrewFleet } from "./parts";
import { CrewSide, type SideCard } from "./CrewSide";
import { setSideOrder } from "./sideOrder";
import { readCrewSideWidth, setCrewSideHidden, toggleCrewSide, useCrewSideHidden, writeCrewSideWidth } from "./sideStore";
import { onAppCommand } from "../appCommands";
import { modalOpen } from "../focus";
import "./crew.css";

type Props = CrewFleet & {
  selection: Selection;
  select: (value: Selection) => void;
  workingOn?: WorkSummaries;
  /** The open conversation, New agent, workspace or project (main.tsx's detail). */
  detail: ReactNode;
  /** Nothing is open: the overview shows in the detail's place. */
  empty: boolean;
  /** Which of Crew shows: the map (the macOS app's Crew tab, full width: what is open waits for the Command tab), the
   *  open conversation (its Command tab: the map aside), or both (a browser: an agent opens over the map, ← Crew goes back). */
  place: "map" | "conversation" | "both";
  /** The Command tab with nothing open: back to the Crew tab. */
  onShowMap?: () => void;
  /** The Crew tab: show the Command tab, where what was picked opens. */
  onShowConversation?: () => void;
  loaded: boolean;
  blocked: boolean;
  /** New agent (⌘N, ⌘K; the map has no button for it): a pending pool claim's row opens it. */
  onDispatch: () => void;
  /** The open agent's browser (the macOS app's): shown beside its conversation, its tabs, B's toggle. */
  browser?: { shown: boolean; tabs: number; toggle: () => void };
  /** The Files tab (src/code/FilesPane.tsx): the workspace's changes and files in the app's own editor; F's toggle. */
  code?: { shown: boolean; toggle: () => void };
  /** A terminal in its workspace beside the conversation (the workspace's shell, kept): shown or hidden, ⇧⌘T's toggle. */
  terminal?: { shown: boolean; toggle: () => void };
  /** Archive a workspace (its confirmation), and those being archived (by `workspaceKey`). */
  onArchive?: (w: Workspace) => void;
  archiving?: Set<string>;
  /** Pool boxes (Settings → Pool boxes): a claimed box's host head releases it (its confirmation). */
  pool?: { boxes: PoolBox[]; running: PoolJob[]; release: (box: PoolBox) => void };
};

const COLLAPSED = "crew:collapsed";
/** The Pool boxes section's fold, kept with the hosts' and projects'. */
const POOL_FOLD = "pool:boxes";
/** The conversation panel's width (CSS px), once resized; else its default (crew.css). */
const DRAWER_WIDTH = "crew:drawerWidth";
const DRAWER_MIN = 360;
/** In focus (an agent open: the map steps aside), the conversation's width beside its tools, once resized. */
const CHAT_WIDTH = "crew:focusChatWidth";
const CHAT_MIN = 380;
/** The tools (files, browser) keep at least this much beside the conversation. */
const TOOLS_KEEP = 360;
/** How much of the map stays beside the panel on a wide window (under 900 px the panel lies over the map). */
const MAP_KEEP = 320;
const CARD_GAP = 14;
/** The map's columns: as many one-robot cards (a tile, the 6 px after it, 10 px padding each side, the border; at least
 * 240 px) as fit across `width`. Every row uses them; a card spans as many as it has robots. */
export function columnsFor(width: number, tile: number): number {
  const card = Math.max(240, tile + 6 + 16);
  return Math.max(1, Math.floor((width + CARD_GAP) / (card + CARD_GAP)));
}
/** The map's robots, CSS px tall. */
const NODE = 72;

export function CrewMap(props: Props) {
  const { snapshot, data } = useCrewData(props);
  // A claimed pool box's host stays on the map with nothing on it, so it can be released (and shows releasing).
  const keepHosts = new Set(
    props.pool
      ? props.hosts
          .filter((h) => props.pool!.boxes.some((b) => b.label === h.label && (b.status === "claimed" || !!jobOnBox(props.pool!.running, b.id))))
          .map((h) => (h.local ? "local" : h.serverId))
      : [],
  );
  const roster = useMemoRoster(data, keepHosts);
  // The hosts in the user's order (dragging a head, ⌥↑ / ⌥↓ on it, ⌘K), the rest after as the fleet has them.
  const { order: hostOrder } = useHostOrder();
  const hosts = useMemo(() => orderHosts(roster.hosts, hostOrder), [roster.hosts, hostOrder]);
  const shownHosts = hosts.map((h) => h.key).join("\n");
  useEffect(() => showHosts(shownHosts ? shownHosts.split("\n") : []), [shownHosts]);
  const [drag, setDrag] = useState<{ key: string; over?: string; before?: boolean } | null>(null);
  /** Before or after `over`, by which half of it the pointer is in (reading order: left to right, then down). */
  const dragOver = (e: DragEvent<HTMLElement>, over: string) => {
    if (!drag || drag.key === over) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    const before = (e.clientX - r.left) / r.width + (e.clientY - r.top) / r.height < 1;
    if (drag.over !== over || drag.before !== before) setDrag({ ...drag, over, before });
  };
  const drop = (e: DragEvent<HTMLElement>) => {
    if (!drag?.over) return setDrag(null);
    e.preventDefault();
    const others = hosts.map((h) => h.key).filter((k) => k !== drag.key);
    placeHost(drag.key, others.indexOf(drag.over) + (drag.before ? 0 : 1));
    setDrag(null);
  };
  /** ⌥↑ / ⌥← earlier, ⌥↓ / ⌥→ later, on a host's head; it keeps the keyboard as it moves. */
  const hostKeys = (e: KeyboardEvent<HTMLElement>, key: string) => {
    if (!e.altKey || e.metaKey || e.ctrlKey) return;
    const by = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : 0;
    if (!by) return;
    e.preventDefault();
    e.stopPropagation();
    stepHost(key, by);
    requestAnimationFrame(() => board.current?.querySelector<HTMLElement>(`.crew-host[data-host="${CSS.escape(key)}"] .crew-host-head .crew-fold`)?.focus({ preventScroll: true }));
  };
  const [collapsed, setCollapsed] = useState<string[]>(() => readStore<string[]>(COLLAPSED, []));
  const toggle = (key: string) =>
    setCollapsed((now) => {
      const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
      writeStore(COLLAPSED, next);
      return next;
    });
  const selected = selectionKey(props.selection, snapshot);
  const board = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  // How many columns the map's grids have, measured as it resizes (the conversation opening or resized beside it).
  const [cols, setCols] = useState(1);
  useLayoutEffect(() => {
    const node = board.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const grid = node.querySelector<HTMLElement>(".crew-hosts");
      if (!grid) return;
      const tile = parseFloat(getComputedStyle(grid).getPropertyValue("--crew-tile")) || 198;
      setCols(columnsFor(grid.clientWidth, tile));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [roster.hosts.length > 0]);
  const drawer = useRef<HTMLElement>(null);
  // The panel's width, dragged on its left edge (or ←/→ there; double-click for the default). Set on the map's frame,
  // where the robot's browser (a sibling, BoardBrowser.tsx) reads it too.
  const [drawerWidth, setDrawerWidth] = useState<number | null>(() => readStore<number | null>(DRAWER_WIDTH, null));
  const drawerMax = () => {
    const w = root.current?.clientWidth ?? window.innerWidth;
    return Math.max(DRAWER_MIN, w < 900 ? w : w - MAP_KEEP);
  };
  const resizeDrawer = (w: number | null) => {
    const next = w === null ? null : Math.round(Math.max(DRAWER_MIN, Math.min(drawerMax(), w)));
    setDrawerWidth(next);
    writeStore(DRAWER_WIDTH, next);
  };
  useLayoutEffect(() => {
    const frame = root.current?.parentElement;
    if (!frame) return;
    if (drawerWidth === null) frame.style.removeProperty("--crew-drawer");
    else frame.style.setProperty("--crew-drawer", `${drawerWidth}px`);
    return () => {
      frame.style.removeProperty("--crew-drawer");
    };
  }, [drawerWidth]);
  // Focus: an agent open (in the macOS app, the Command tab). The map steps aside (kept, with its scroll), the
  // conversation stands on the left and its tools (Files, the terminal and the browser: main's FilesPane, WorkspaceEditor and BoardBrowser, beside
  // it) fill the right. On the Command tab whatever is open takes the window; the Crew tab is the map alone (what is open
  // waits for the Command tab). In a browser a strip's ← Crew goes back to the map.
  const isAgent = props.selection?.type === "agent";
  const place = props.place;
  const focus = !props.empty && (place === "conversation" || (isAgent && place === "both"));
  /** The Command tab, nothing open: the map aside and a word in its place. */
  const nothingOpen = place === "conversation" && props.empty;
  const toolsShown = focus && !!(props.browser?.shown || props.terminal?.shown || props.code?.shown);
  // The crew list down the left of the macOS app's Command tab, unless hidden (⌘S, ⌘K); a browser keeps the map and ← Crew.
  const sideHidden = useCrewSideHidden();
  const sideHere = place === "conversation";
  const sideShown = sideHere && !sideHidden;
  const [sideWidth, setSideWidth] = useState(readCrewSideWidth);
  const sideW = sideShown ? sideWidth : 0;
  useLayoutEffect(() => {
    const frame = root.current?.parentElement;
    if (!frame) return;
    frame.style.setProperty("--crew-side", `${sideW}px`);
    return () => {
      frame.style.removeProperty("--crew-side");
    };
  }, [sideW]);
  // ⌘S hides or shows it wherever the keyboard is on the Command tab, but the Files tab (where ⌘S saves) and dialogs.
  useEffect(() => {
    if (!sideHere) return;
    const key = (e: globalThis.KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s" || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest?.(".files-view") || modalOpen()) return;
      e.preventDefault();
      if (!e.repeat) toggleCrewSide();
    };
    window.addEventListener("keydown", key);
    const off = onAppCommand("crew-sidebar", () => toggleCrewSide());
    return () => {
      window.removeEventListener("keydown", key);
      off();
    };
  }, [sideHere]);
  const [chatWidth, setChatWidth] = useState<number | null>(() => readStore<number | null>(CHAT_WIDTH, null));
  const chatMax = () => Math.max(CHAT_MIN, (root.current?.clientWidth ?? window.innerWidth) - sideW - TOOLS_KEEP);
  const resizeChat = (w: number | null) => {
    const next = w === null ? null : Math.round(Math.max(CHAT_MIN, Math.min(chatMax(), w)));
    setChatWidth(next);
    writeStore(CHAT_WIDTH, next);
  };
  useLayoutEffect(() => {
    const frame = root.current?.parentElement;
    if (!frame) return;
    if (chatWidth === null) frame.style.removeProperty("--crew-chat");
    else frame.style.setProperty("--crew-chat", `${chatWidth}px`);
    return () => {
      frame.style.removeProperty("--crew-chat");
    };
  }, [chatWidth]);
  // What was last opened from the map: coming back, the map shows it and gives it the keyboard.
  const opened = useRef<string | null>(null);

  const mapShown = !focus && !nothingOpen;
  useLayoutEffect(() => {
    if (!mapShown) return;
    const key = opened.current;
    if (!key) return;
    const node = board.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: "center" });
  }, [mapShown]);
  // The strip (a browser's ← Crew) takes the top of focus; without it (the macOS app's tabs), nothing does.
  const strip = focus && place === "both";
  useLayoutEffect(() => {
    const frame = root.current?.parentElement;
    if (!frame) return;
    frame.style.setProperty("--crew-strip", strip ? "40px" : "0px");
    return () => {
      frame.style.removeProperty("--crew-strip");
    };
  }, [strip]);

  // What is open stays in view as the map narrows beside it (or is chosen elsewhere: J/K, ⌘K, a notification).
  useEffect(() => {
    if (selected) board.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  // The crew list's order, as agent ids, for J/K and ↑/↓ (`sideOrder.ts`).
  const snapshotNow = useRef(snapshot);
  snapshotNow.current = snapshot;
  const onSideOrder = useCallback(
    (keys: string[] | null) =>
      setSideOrder(
        keys &&
          keys.flatMap((key) => {
            const s = targetSelection({ kind: "agent", key }, snapshotNow.current);
            return s?.type === "agent" ? [s.id] : [];
          }),
      ),
    [],
  );
  const pick = (kind: "agent" | "workspace" | "project", key: string) => {
    if (props.blocked) return;
    const s = targetSelection({ kind, key }, snapshot);
    if (!s) return;
    opened.current = key;
    props.select(s);
    // The macOS app's Crew tab: what you pick opens on the Command tab, the one already open too (picking it again changes
    // nothing open, so nothing else would take you there).
    if (place === "map") props.onShowConversation?.();
  };
  const rowOf = (key: string) => snapshot.agents.find((a) => a.key === key);
  // The roster keys hosts as Crew's data does: "local", else the server id.
  const rosterKey = (h: { local: boolean; serverId: string }) => (h.local ? "local" : h.serverId);
  const hostLabel = (key: string) => props.hosts.find((h) => rosterKey(h) === key)?.label;
  const summaryOf = (a: RosterAgent) => {
    const row = rowOf(a.key);
    return (row && props.workingOn?.[row.clientId ?? row.id]?.sentence) || undefined;
  };
  // The crew list's cards: every agent with its project, workspace, host and times, in the map's order.
  const sideItems = useMemo(() => {
    if (!sideHere) return [];
    const rows = new Map(props.agents.map((r) => [`${r.host || "local"}|${r.id}`, r]));
    const out: SideCard[] = [];
    for (const h of hosts) {
      const host = { key: h.key, name: h.name, local: h.key === "local" };
      const add = (a: RosterAgent, project?: { key: string; name: string }, workspace?: RosterWorkspace) => {
        const snap = snapshot.agents.find((x) => x.key === a.key);
        const row = snap && rows.get(`${snap.hostId}|${snap.clientId ?? snap.id}`);
        const active = [row?.updatedAt, row?.lastUserMessageAt].filter((t): t is string => !!t).sort().at(-1);
        out.push({
          key: a.key,
          state: a.state,
          ...(a.created ? { created: a.created } : {}),
          ...(row?.lastUserMessageAt ? { prompted: row.lastUserMessageAt } : {}),
          ...(active ? { active } : {}),
          ...(project ? { project } : {}),
          host,
          order: out.length,
          agent: a,
          ...(workspace ? { workspace } : {}),
        });
      };
      for (const p of h.projects) {
        const project = { key: p.key, name: p.name };
        for (const w of p.workspaces) for (const a of w.agents) add(a, project, w);
        for (const a of p.loose) add(a, project);
      }
      for (const a of h.loose) add(a);
    }
    return out;
  }, [sideHere, hosts, props.agents, snapshot]);
  const workspaceRow = (w: { key: string } | undefined) => {
    const s = w && snapshot.workspaces.find((x) => x.key === w.key);
    return s && props.workspaces.find((x) => x.workspaceId === s.id && (x.host || "local") === s.hostId);
  };

  /** Arrow keys (and Home/End) move through the map's robots and heads, in reading order. */
  const boardKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key) || e.target instanceof HTMLInputElement) return;
    const items = [...(board.current?.querySelectorAll<HTMLButtonElement>(".crew-node, .crew-head") ?? [])];
    if (!items.length) return;
    e.preventDefault();
    e.stopPropagation();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.max(0, Math.min(items.length - 1, at < 0 ? 0 : at + step));
    items[next]?.focus();
  };

  const medals = (w: Parameters<typeof Medals>[0]["workspace"], size: number) => <Medals workspace={w} pr={workspaceRow(w)?.pr} size={size} />;

  const node = (a: RosterAgent) => {
    const running = a.state === "running";
    return (
      <button key={a.key} className="crew-node" data-key={a.key} data-state={a.state} aria-current={marked === a.key ? "true" : undefined} onClick={() => pick("agent", a.key)}>
        <Portrait agent={a} size={NODE} />
        <span className="crew-node-text">
          <span className="crew-node-name">
            {a.state === "done" && <span className="crew-unread" data-tip="Replied · unread" data-summary="" aria-label="Unread reply" role="img" />}
            {a.name}
          </span>
          <span className="crew-node-status">
            <i aria-hidden="true" />
            <b>{STATE_NAMES[a.state]}</b>
            {a.model && <span>{modelName(a.model)}</span>}
          </span>
          {/* What it is doing, and a bar sliding while it runs; kept (empty) otherwise, so tiles stay one height. */}
          <small className={running ? "crew-node-work crew-shimmer" : "crew-node-work"}>{running ? summaryOf(a) || "Working…" : "\u00a0"}</small>
          <span className="crew-progress" data-on={running || undefined} aria-hidden="true">
            <i />
          </span>
        </span>
      </button>
    );
  };
  const camp = (agents: RosterAgent[]) =>
    agents.length > 0 && (
      <article className="crew-ws camp" aria-label="Without a workspace" style={{ "--crew-n": agents.length, gridColumn: `span ${Math.min(cols, agents.length)}` } as CSSProperties}>
        <div className="crew-ws-head">
          <span className="crew-ws-name">Without a workspace</span>
        </div>
        <div className="crew-nodes">{agents.map(node)}</div>
      </article>
    );

  const total = data.agents.length;
  const running = roster.counts.running ?? 0;
  const need = (["failed", "approval", "question", "asking"] as State[]).reduce((n, s) => n + (roster.counts[s] ?? 0), 0);

  // The macOS app's Crew tab is the map alone, full width: what is open is the Command tab's.
  const open = !props.empty && place !== "map";
  // What is open is marked on the map only while it shows beside it (a browser): on the macOS app's Crew tab it's the Command
  // tab's, so no card stays marked as you come back.
  const marked = place === "map" ? null : selected;
  return (
    <div
      ref={root}
      className="crew-map"
      data-world="crew"
      data-open={open || undefined}
      data-focus={focus || nothingOpen || undefined}
      data-place={place}
      data-tools={toolsShown || undefined}
      data-browser={(open && props.selection?.type === "agent" && (props.browser?.shown || props.terminal?.shown || props.code?.shown)) || undefined}
    >
      {strip && <FocusStrip back={() => props.select(null)} />}
      {sideShown && (
        <CrewSide
          items={sideItems}
          selected={selected}
          open={(key) => pick("agent", key)}
          medals={medals}
          summaryOf={summaryOf}
          width={sideWidth}
          resize={(w) => setSideWidth(writeCrewSideWidth(w))}
          hide={() => setCrewSideHidden(true)}
          onOrder={onSideOrder}
        />
      )}
      {nothingOpen && (
        <div className="crew-command-empty">
          <p>No conversation is open.</p>
          <p>Open an agent from the crew list or the Crew tab, or step through them with J and K.</p>
          {props.onShowMap && (
            <button className="page-btn" onClick={props.onShowMap}>
              Show the crew
            </button>
          )}
        </div>
      )}
      {toolsShown && (
        <div className="crew-tool-tabs" role="tablist" aria-label="Tools">
          {props.code && (
            <button role="tab" aria-selected={props.code.shown} aria-keyshortcuts="F Shift+Meta+F" onClick={() => !props.code!.shown && props.code!.toggle()}>
              <FolderTree size={13} aria-hidden="true" />
              Files
            </button>
          )}
          {props.terminal && (
            <button role="tab" aria-selected={props.terminal.shown} aria-keyshortcuts="Shift+Meta+T" onClick={() => !props.terminal!.shown && props.terminal!.toggle()}>
              <Terminal size={13} aria-hidden="true" />
              Terminal
            </button>
          )}
          {props.browser && (
            <button role="tab" aria-selected={props.browser.shown} aria-keyshortcuts="B Shift+Meta+B" onClick={() => !props.browser!.shown && props.browser!.toggle()}>
              <Globe size={13} aria-hidden="true" />
              Browser{props.browser.tabs ? ` · ${props.browser.tabs}` : ""}
            </button>
          )}
          <span className="crew-tool-tabs-spacer" />
          <button
            className="crew-tool-tabs-close"
            aria-label="Hide the tools"
            aria-keyshortcuts="Alt+Meta+B"
            data-tip="Hide the tools: the conversation takes the width (⌥⌘B shows them again; the terminal keeps running)"
            onClick={() => (props.code?.shown ? props.code.toggle() : props.terminal?.shown ? props.terminal.toggle() : props.browser?.toggle())}
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="crew-board" ref={board} onKeyDown={boardKeys} role="region" aria-label="Crew" style={{ "--crew-cols": cols } as CSSProperties}>
        <header className="crew-board-head">
          <div className="crew-board-title">
            <h2>Your crew</h2>
            <p>
              {!props.loaded && !total
                ? "Waiting for Paseo hosts…"
                : !total
                  ? "No agents yet."
                  : [
                      `${total} agent${total === 1 ? "" : "s"}`,
                      running ? `${running} working` : "",
                      need ? `${need} need${need === 1 ? "s" : ""} you` : "nothing needs you",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
            </p>
          </div>
        </header>
        <PoolClaims agents={props.agents} onOpen={props.onDispatch} />
        {props.pool && (
          <PoolBoxes
            boxes={props.pool.boxes}
            running={props.pool.running}
            hostOf={(label) => {
              const h = props.hosts.find((x) => x.label === label);
              if (!h) return undefined;
              const key = rosterKey(h);
              const agents = data.agents.filter((a) => a.host === key);
              return {
                key,
                online: !!data.hosts.find((x) => x.key === key)?.online,
                agents: agents.length,
                workspaces: data.workspaces.filter((w) => w.host === key).length,
                running: agents.filter((a) => a.state === "running").length,
              };
            }}
            release={props.pool.release}
            shut={collapsed.includes(POOL_FOLD)}
            toggle={() => toggle(POOL_FOLD)}
            showHost={(key) => {
              if (collapsed.includes(key)) toggle(key);
              requestAnimationFrame(() => {
                const head = board.current?.querySelector<HTMLElement>(`.crew-host[data-host="${CSS.escape(key)}"] .crew-fold`);
                head?.scrollIntoView({ block: "start", behavior: "smooth" });
                head?.focus({ preventScroll: true });
              });
            }}
          />
        )}
        <div className="crew-hosts">
        {hosts.map((h) => {
          const hostShut = collapsed.includes(h.key);
          const spans = hostSpans(h, cols, (k) => collapsed.includes(k));
          return (
            <section
              key={h.key}
              className="crew-host"
              data-host={h.key}
              data-offline={!h.online || undefined}
              data-dragging={drag?.key === h.key || undefined}
              data-drop={drag?.over === h.key ? (drag.before ? "before" : "after") : undefined}
              aria-label={h.name}
              style={{ gridColumn: `span ${spans.span}` }}
              onDragOver={(e) => dragOver(e, h.key)}
              onDragLeave={(e) => {
                if (drag?.over === h.key && !e.currentTarget.contains(e.relatedTarget as Node | null)) setDrag({ key: drag.key });
              }}
              onDrop={drop}
            >
              <h3
                className="crew-host-head"
                draggable={hosts.length > 1}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", h.name);
                  setDrag({ key: h.key });
                }}
                onDragEnd={() => setDrag(null)}
              >
                {hosts.length > 1 && <GripVertical size={13} className="crew-host-grip" aria-hidden="true" />}
                <button
                  className="crew-fold"
                  aria-expanded={!hostShut}
                  aria-keyshortcuts={hosts.length > 1 ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
                  onClick={() => toggle(h.key)}
                  onKeyDown={(e) => hostKeys(e, h.key)}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                  {h.name}
                </button>
                {!h.online && <span className="crew-offline">offline</span>}
                {hostShut && <Tally agents={hostAgents(h)} />}
                {(() => {
                  const box = props.pool && claimedBoxOf(props.pool.boxes, hostLabel(h.key));
                  if (!box || !props.pool) return null;
                  const job = jobOnBox(props.pool.running, box.id);
                  const releasing = job?.kind === "release";
                  // Nothing left on it (closed or archived outside the app, which releases nothing): say it can go.
                  const spare =
                    !job &&
                    h.online &&
                    !data.workspaces.some((w) => w.host === h.key) &&
                    !data.agents.some((a) => a.host === h.key && a.state === "running");
                  return (
                    <>
                    {spare && (
                      <span className="crew-spare" data-tip="No workspaces or running agents: release it to return it to the pool">
                        Claimed · idle
                      </span>
                    )}
                    <button
                      className="crew-head-action"
                      disabled={!!job}
                      data-tip={job ? jobText(job) : `Release pool box ${box.label}: restore it and return it to the pool`}
                      aria-label={`Release pool box ${box.label}`}
                      onClick={() => props.pool!.release(box)}
                    >
                      <RotateCcw size={12} aria-hidden="true" />
                      {releasing ? "Releasing…" : "Release"}
                    </button>
                    </>
                  );
                })()}
              </h3>
              {!hostShut && (
                <>
                  {h.projects.map((p) => {
                    const shut = collapsed.includes(p.key);
                    return (
                      <section key={p.key} className="crew-project" aria-label={p.name} style={{ gridColumn: `span ${spans.projects[p.key] ?? 1}` }}>
                        <div className="crew-project-head">
                          <button className="crew-fold small" aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} ${p.name}`} onClick={() => toggle(p.key)}>
                            <ChevronDown size={14} aria-hidden="true" />
                          </button>
                          <button className="crew-head project" data-key={p.key} aria-current={marked === p.key ? "true" : undefined} onClick={() => pick("project", p.key)}>
                            {p.name}
                          </button>
                          {shut && <Tally agents={projectAgents(p)} />}
                        </div>
                        {!shut && (
                          <div className="crew-workspaces">
                            {p.workspaces.map((w) => (
                              <article key={w.key} className={`crew-ws${w.probe?.state === "reviewing" ? " probe-reviewing" : ""}`} aria-label={w.name} style={{ "--crew-n": Math.max(1, w.agents.length), gridColumn: `span ${Math.min(cols, Math.max(1, w.agents.length))}` } as CSSProperties}>
                                <div className="crew-ws-top">
                                  <button className="crew-head workspace" data-key={w.key} aria-current={marked === w.key ? "true" : undefined} onClick={() => pick("workspace", w.key)}>
                                    <span className="crew-ws-name">{w.name}</span>
                                    {medals(w, 24)}
                                  </button>
                                  {(() => {
                                    const row = workspaceRow(w);
                                    if (!row || !props.onArchive) return null;
                                    const leaving = props.archiving?.has(workspaceKey(row));
                                    const name = placeText(row.name, "workspace");
                                    return (
                                      <button
                                        className="crew-ws-archive"
                                        disabled={leaving || props.blocked}
                                        data-tip={leaving ? `Archiving ${name}…` : `Archive workspace ${name}`}
                                        aria-label={`Archive workspace ${name}`}
                                        onClick={() => props.onArchive!(row)}
                                      >
                                        <Archive size={13} aria-hidden="true" />
                                      </button>
                                    );
                                  })()}
                                </div>
                                {w.agents.length ? <div className="crew-nodes">{w.agents.map(node)}</div> : <p className="crew-ws-empty">No agents</p>}
                              </article>
                            ))}
                            {camp(p.loose)}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {h.loose.length > 0 && (
                    <div className="crew-project loose" style={{ gridColumn: `span ${spans.loose}` }}>
                      <div className="crew-workspaces">{camp(h.loose)}</div>
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
        </div>
      </div>
      {open && (
        <aside ref={drawer} className="crew-drawer" id="crew-drawer" aria-label="Conversation">
          {focus ? (
            toolsShown && (
              <ResizeEdge
                label="Resize the conversation beside its tools"
                controls="crew-drawer"
                value={chatWidth ?? drawer.current?.getBoundingClientRect().width ?? 560}
                min={CHAT_MIN}
                max={chatMax()}
                grows="right"
                onResize={resizeChat}
                onReset={() => resizeChat(null)}
              />
            )
          ) : (
            <ResizeEdge
              label="Resize the conversation"
              controls="crew-drawer"
              value={drawerWidth ?? drawer.current?.getBoundingClientRect().width ?? 560}
              min={DRAWER_MIN}
              max={drawerMax()}
              grows="left"
              onResize={resizeDrawer}
              onReset={() => resizeDrawer(null)}
            />
          )}
          <CrewDetail
            hosts={props.hosts}
            projects={props.projects}
            workspaces={props.workspaces}
            agents={props.agents}
            permissions={props.permissions}
            questions={props.questions}
            asking={props.asking}
            unread={props.unread}
            selection={props.selection}
            select={props.select}
            workingOn={props.workingOn}
            detail={props.detail}
          />
        </aside>
      )}
    </div>
  );
}


function useMemoRoster(data: ReturnType<typeof useCrewData>["data"], keepHosts: Set<string>) {
  const kept = [...keepHosts].sort().join("\n");
  const [memo] = useState(() => ({ data: null as unknown, kept: "", roster: null as unknown as ReturnType<typeof buildRoster> }));
  if (memo.data !== data || memo.kept !== kept) Object.assign(memo, { data, kept, roster: buildRoster(data, "", keepHosts) });
  return memo.roster;
}

/** A folded host's or project's agents counted by state, most urgent first: a dot in the state's colour and the count. */
function Tally({ agents }: { agents: readonly { state: State }[] }) {
  const tally = stateTally(agents);
  if (!tally.length) return null;
  const said = tally.map(({ state, count }) => `${count} ${STATE_NAMES[state].toLowerCase()}`).join(", ");
  return (
    <span className="crew-tally" role="img" aria-label={said}>
      {tally.map(({ state, count }) => (
        <span key={state} className="crew-tally-item" data-state={state} data-tip={`${count} · ${STATE_NAMES[state]}`} aria-hidden="true">
          <i />
          {count}
        </span>
      ))}
    </span>
  );
}

/** Focus's strip across the top in a browser (the macOS app has its Crew tab instead): back to the crew. */
function FocusStrip({ back }: { back: () => void }) {
  return (
    <nav className="crew-focus-strip" aria-label="The crew">
      <button className="crew-focus-back" onClick={back} aria-keyshortcuts="Escape" data-tip="Back to the crew (Esc)">
        <ArrowLeft size={14} aria-hidden="true" />
        Crew
      </button>
    </nav>
  );
}
