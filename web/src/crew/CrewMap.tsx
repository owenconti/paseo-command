/** The Crew map: the fleet as a chat app, drawn by the page itself (in a plain browser too), in the map's place.
 * With nothing open it is the map: each host, its projects and their workspaces (as the graphical maps group them,
 * oldest first), each workspace a panel of its agents' robots as large nodes with their state and progress. Picking
 * one opens it across the whole view (the app's own detail: the agent's `Session`, New agent, a workspace or
 * project) under a stage strip that shows the agent's robot, its state and progress, and its workspace's PR
 * medallions; Back (or Esc) returns to the map. The robots, drones, state marks and glows, and the PR, Probe and
 * auto-merge medallions are the Dungeon Board's sheets (`sheets.ts`). The session panel is gone while it shows
 * (main.tsx's `crewShown`): this is where the conversation is. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Globe, Plus, Search, X } from "lucide-react";
import robotsUrl from "../../../rendering/src/assets/dungeon/robots.png";
import statusUrl from "../../../rendering/src/assets/dungeon/status.png";
import { AUTO_MERGE } from "../../../rendering/src/prStatus";
import { STATE_NAMES, modelName, type State } from "../../../rendering/src/world";
import { atlasData, selectionKey } from "../atlasData";
import { worldSnapshot, targetSelection } from "../worldBridge";
import { useProbe } from "../useProbe";
import { autoMergeLine, flagTip } from "../flagTip";
import { readStore, writeStore } from "../api";
import { ChatDecorContext, ChatFooterContext, type ChatDecor } from "../chatDecor";
import { onAppCommand } from "../appCommands";
import { ResizeEdge } from "../ResizeEdge";
import type { Agent, Host, Project, Selection, Workspace } from "../types";
import type { WorkSummaries } from "../useWorkingOn";
import { buildRoster, type RosterAgent, type RosterWorkspace } from "./roster";
import { droneColors, droneFrames, frameOf, frameStyle, glowOf, markOf, medalsOf, poseOf, robotColorOf, robotFrames } from "./sheets";
import "./crew.css";

type Props = {
  hosts: Host[];
  projects: Project[];
  workspaces: Workspace[];
  agents: Agent[];
  permissions: Set<string>;
  questions: Set<string>;
  asking: Set<string>;
  unread: Set<string>;
  selection: Selection;
  select: (value: Selection) => void;
  workingOn?: WorkSummaries;
  /** The open conversation, New agent, workspace or project (main.tsx's detail). */
  detail: ReactNode;
  /** Nothing is open: the overview shows in the detail's place. */
  empty: boolean;
  loaded: boolean;
  blocked: boolean;
  onDispatch: () => void;
  /** The open agent's browser (the macOS app's): shown beside its conversation, its tabs, B's toggle. */
  browser?: { shown: boolean; tabs: number; toggle: () => void };
};

const COLLAPSED = "crew:collapsed";
/** The conversation panel's width (CSS px), once resized; else its default (crew.css). */
const DRAWER_WIDTH = "crew:drawerWidth";
const DRAWER_MIN = 360;
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

/** A robot in its provider's colour: its idle frames (blinking now and then) or, while it runs, its work frames. */
export function Robot({ color, state, size, title }: { color: string; state: State; size: number; title?: string }) {
  const pose = poseOf(state);
  const frames = robotFrames(color, pose);
  const first = frameOf("robots", frames[0]!)!;
  return (
    <span
      className={`crew-bot ${pose}${state === "offline" ? " off" : ""}`}
      style={{ width: (size * first.w) / first.h, height: size }}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {frames.map((name) => (
        <span key={name} className="crew-f" style={frameStyle("robots", robotsUrl, frameOf("robots", name)!, size)} />
      ))}
    </span>
  );
}

/** Running subagents as drones circling their robot (up to four), each in its own model's colour. */
function Drones({ agent, size }: { agent: RosterAgent; size: number }) {
  const n = Math.min(agent.state === "running" ? (agent.subagents ?? 0) : 0, 4);
  if (!n) return null;
  const sample = frameOf("robots", "drone-grey-0")!;
  const h = size * 0.26, w = (h * sample.w) / sample.h;
  return (
    <span className="crew-drones" aria-hidden="true" style={{ "--crew-orbit": `${size * 0.55}px` } as CSSProperties}>
      {droneColors(agent.model, n, agent.subagentModels).map((color, i) => (
        <span key={i} className="crew-orbit" style={{ animationDelay: `${(-3.6 * i) / n}s` }}>
          <span className="crew-drone" style={{ animationDelay: `${(-3.6 * i) / n}s`, width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 }}>
            {droneFrames(color).map((name) => (
              <span key={name} className="crew-f" style={frameStyle("robots", robotsUrl, frameOf("robots", name)!, h)} />
            ))}
          </span>
        </span>
      ))}
    </span>
  );
}

/** A frame of the status sheet: a state mark, a PR, Probe or auto-merge medallion, or a state glow. */
function Status({ frame, size, className, tip }: { frame: string; size: number; className?: string; tip?: string }) {
  const f = frameOf("status", frame);
  if (!f) return null;
  return (
    <span
      className={`crew-status ${className ?? ""}`}
      style={frameStyle("status", statusUrl, f, size)}
      // A read-only summary: the app's tooltip layer shows its tip on hover (Tooltip.tsx's `data-summary`).
      {...(tip ? { "data-tip": tip, "data-summary": "", role: "img", "aria-label": tip } : { "aria-hidden": true })}
    />
  );
}

/** The robot with its state's glow beneath it, its mark at its shoulder and its drones. */
function Portrait({ agent, size, mark = true }: { agent: RosterAgent; size: number; mark?: boolean }) {
  const glow = frameOf("status", glowOf(agent.state));
  const needs = ["failed", "approval", "question", "asking"].includes(agent.state);
  return (
    <span className="crew-portrait" data-state={agent.state} style={{ width: size * 1.05, height: size * 1.08 }}>
      {glow && (
        <span
          className={`crew-glow${needs ? " pulse" : ""}`}
          style={frameStyle("status", statusUrl, glow, size * 0.42)}
          aria-hidden="true"
        />
      )}
      <Robot color={robotColorOf(agent.model)} state={agent.state} size={size} />
      <Drones agent={agent} size={size} />
      {mark && markOf(agent.state) && (
        <Status frame={markOf(agent.state)!} size={size * 0.38} className={`crew-mark${agent.state === "running" ? " spin" : needs ? " pulse" : ""}`} />
      )}
    </span>
  );
}

export function CrewMap(props: Props) {
  const probe = useProbe();
  const revision = useRef(0);
  const snapshot = useMemo(
    () => worldSnapshot({ ...props, revision: ++revision.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.hosts, props.projects, props.workspaces, props.agents, props.permissions, props.unread],
  );
  const data = useMemo(() => atlasData(snapshot, props.questions, props.asking, probe), [snapshot, props.questions, props.asking, probe]);
  const [filter, setFilter] = useState("");
  const roster = useMemo(() => buildRoster(data, filter), [data, filter]);
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
      const grid = node.querySelector<HTMLElement>(".crew-workspaces");
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
  // What was last opened from the map: coming back, the map shows it and gives it the keyboard.
  const opened = useRef<string | null>(null);

  // ⌘K "Filter the crew…": the map's filter field (the map shows first).
  const filterField = useRef<HTMLInputElement>(null);
  const focusFilter = useRef(false);
  useEffect(
    () =>
      onAppCommand("crew-filter", () => {
        if (filterField.current) return filterField.current.focus();
        focusFilter.current = true;
        props.select(null);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  useLayoutEffect(() => {
    if (!props.empty) return;
    if (focusFilter.current) {
      focusFilter.current = false;
      filterField.current?.focus();
      return;
    }
    const key = opened.current;
    if (!key) return;
    const node = board.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    node?.focus({ preventScroll: true });
    node?.scrollIntoView({ block: "center" });
  }, [props.empty]);

  // What is open stays in view as the map narrows beside it (or is chosen elsewhere: J/K, ⌘K, a notification).
  useEffect(() => {
    if (selected) board.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const pick = (kind: "agent" | "workspace" | "project", key: string) => {
    if (props.blocked) return;
    const s = targetSelection({ kind, key }, snapshot);
    if (!s) return;
    opened.current = key;
    props.select(s);
  };
  const rowOf = (key: string) => snapshot.agents.find((a) => a.key === key);
  const summaryOf = (a: RosterAgent) => {
    const row = rowOf(a.key);
    return (row && props.workingOn?.[row.clientId ?? row.id]?.sentence) || undefined;
  };
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

  const medals = (w: RosterWorkspace | (typeof data.workspaces)[number], size: number) => {
    const pr = workspaceRow(w)?.pr;
    const list = medalsOf(w.labels, w.probe);
    if (!list.length && !w.autoMerge) return null;
    return (
      <span className="crew-medals">
        {list.map((m) => {
          const tip = flagTip(m.flag, pr, w.probe);
          return <Status key={m.kind} frame={m.frame} size={size} tip={`${tip.title}: ${tip.facts || tip.description}`} />;
        })}
        {w.autoMerge && <Status frame="seal-automerge" size={size} tip={autoMergeLine(pr) || `${AUTO_MERGE.name}: ${AUTO_MERGE.description}`} />}
      </span>
    );
  };

  const node = (a: RosterAgent) => {
    const running = a.state === "running";
    return (
      <button key={a.key} className="crew-node" data-key={a.key} data-state={a.state} aria-current={selected === a.key ? "true" : undefined} onClick={() => pick("agent", a.key)}>
        <Portrait agent={a} size={NODE} />
        <span className="crew-node-text">
          <span className="crew-node-name">
            {a.state === "done" && <span className="crew-unread" data-tip="Replied · unread" data-summary="" aria-label="Unread reply" role="img" />}
            {a.name}
          </span>
          <small className={running ? "crew-node-state crew-shimmer" : "crew-node-state"}>
            {running ? summaryOf(a) || "Working…" : STATE_NAMES[a.state]}
          </small>
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

  const shownAgent = props.selection?.type === "agent" ? data.agents.find((a) => a.key === selected) : undefined;
  const decor = useMemo<ChatDecor>(() => {
    if (!shownAgent) return {};
    const color = robotColorOf(shownAgent.model);
    return {
      replyAvatar: (live) => <Robot color={color} state={live && shownAgent.state === "running" ? "running" : "idle"} size={30} />,
      working: <Robot color={color} state="running" size={24} />,
    };
  }, [shownAgent?.model, shownAgent?.state]);

  const total = data.agents.length;
  const running = roster.counts.running ?? 0;
  const need = (["failed", "approval", "question", "asking"] as State[]).reduce((n, s) => n + (roster.counts[s] ?? 0), 0);

  const open = !props.empty;
  return (
    <div ref={root} className="crew-map" data-world="crew" data-open={open || undefined} data-browser={(open && shownAgent && props.browser?.shown) || undefined}>
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
          <label className="crew-search">
            <Search size={13} aria-hidden="true" />
            <input
              ref={filterField}
              value={filter}
              placeholder="Filter agents…"
              aria-label="Filter agents"
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && filter) {
                  e.stopPropagation();
                  setFilter("");
                }
              }}
            />
            {filter && (
              <button className="crew-clear" aria-label="Clear the filter" onClick={() => setFilter("")}>
                <X size={12} />
              </button>
            )}
          </label>
          <button className="crew-primary" onClick={props.onDispatch}>
            <Plus size={14} aria-hidden="true" />
            New agent
          </button>
        </header>
        {roster.hosts.map((h) => {
          const hostShut = collapsed.includes(h.key);
          return (
            <section key={h.key} className="crew-host" data-offline={!h.online || undefined} aria-label={h.name}>
              <h3 className="crew-host-head">
                <button className="crew-fold" aria-expanded={!hostShut} onClick={() => toggle(h.key)}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {h.name}
                </button>
                {!h.online && <span className="crew-offline">offline</span>}
              </h3>
              {!hostShut && (
                <>
                  {h.projects.map((p) => {
                    const shut = collapsed.includes(p.key);
                    return (
                      <section key={p.key} className="crew-project" aria-label={p.name}>
                        <div className="crew-project-head">
                          <button className="crew-fold small" aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} ${p.name}`} onClick={() => toggle(p.key)}>
                            <ChevronDown size={14} aria-hidden="true" />
                          </button>
                          <button className="crew-head project" data-key={p.key} aria-current={selected === p.key ? "true" : undefined} onClick={() => pick("project", p.key)}>
                            {p.name}
                          </button>
                        </div>
                        {!shut && (
                          <div className="crew-workspaces">
                            {p.workspaces.map((w) => (
                              <article key={w.key} className="crew-ws" aria-label={w.name} style={{ "--crew-n": Math.max(1, w.agents.length), gridColumn: `span ${Math.min(cols, Math.max(1, w.agents.length))}` } as CSSProperties}>
                                <button className="crew-head workspace" data-key={w.key} aria-current={selected === w.key ? "true" : undefined} onClick={() => pick("workspace", w.key)}>
                                  <span className="crew-ws-name">{w.name}</span>
                                  {medals(w, 24)}
                                </button>
                                {w.agents.length ? <div className="crew-nodes">{w.agents.map(node)}</div> : <p className="crew-ws-empty">No agents</p>}
                              </article>
                            ))}
                            {camp(p.loose)}
                          </div>
                        )}
                      </section>
                    );
                  })}
                  {h.loose.length > 0 && <div className="crew-workspaces">{camp(h.loose)}</div>}
                </>
              )}
            </section>
          );
        })}
        {filter && !roster.hosts.length && <p className="crew-none">No agent matches “{filter}”.</p>}
      </div>
      {open && (
        <aside ref={drawer} className="crew-drawer" id="crew-drawer" aria-label="Conversation">
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
          <div className="detail-content crew-detail" id="detail-panel">
            <ChatDecorContext.Provider value={decor}>
              <ChatFooterContext.Provider
                value={
                  shownAgent && (
                    <Stage
                      browser={props.browser}
                      agent={shownAgent}
                      sentence={summaryOf(shownAgent)}
                      workspace={shownAgent.workspace ? data.workspaces.find((w) => w.key === shownAgent.workspace) : undefined}
                      medals={medals}
                      onWorkspace={(key) => pick("workspace", key)}
                    />
                  )
                }
              >
                {props.detail}
              </ChatFooterContext.Provider>
            </ChatDecorContext.Provider>
          </div>
        </aside>
      )}
    </div>
  );
}

/** At the conversation's foot, above its message box: the agent's robot (working, resting or offline), its state and progress, and its
 * workspace with its pull request's medallions. Its name and tools are the conversation's own header's. */
function Stage(props: {
  agent: RosterAgent;
  sentence?: string;
  workspace?: ReturnType<typeof atlasData>["workspaces"][number];
  medals: (w: ReturnType<typeof atlasData>["workspaces"][number], size: number) => ReactNode;
  onWorkspace: (key: string) => void;
  browser?: { shown: boolean; tabs: number; toggle: () => void };
}) {
  const { agent, workspace } = props;
  const running = agent.state === "running";
  const subagents = running ? agent.subagents ?? 0 : 0;
  return (
    <div className="crew-stage" data-state={agent.state} aria-live="polite">
      <Portrait agent={agent} size={50} />
      <div className="crew-stage-text">
        <div className="crew-stage-state">
          <i aria-hidden="true" />
          <b>{STATE_NAMES[agent.state]}</b>
          {agent.model && <span>{modelName(agent.model)}</span>}
          {subagents > 0 && <span>{subagents} subagent{subagents === 1 ? "" : "s"}</span>}
        </div>
        {running && (
          <>
            <div className="crew-stage-work crew-shimmer">{props.sentence || "Working…"}</div>
            <div className="crew-progress" aria-hidden="true">
              <i />
            </div>
          </>
        )}
        {!running && props.sentence && <div className="crew-stage-work">{props.sentence}</div>}
      </div>
      {workspace && (
        <div className="crew-stage-place">
          <button className="crew-chip" data-tip="Show the workspace" onClick={() => props.onWorkspace(workspace.key)}>
            {workspace.name}
          </button>
          {props.medals(workspace, 26)}
        </div>
      )}
      {props.browser && (
        <button
          className="crew-chip crew-browser-toggle"
          aria-pressed={props.browser.shown}
          aria-keyshortcuts="B"
          data-tip={props.browser.shown ? "Hide the browser (B, ⇧⌘W)" : "Show its browser (B)"}
          onClick={props.browser.toggle}
        >
          <Globe size={13} aria-hidden="true" />
          Browser{props.browser.tabs ? ` · ${props.browser.tabs}` : ""}
        </button>
      )}

    </div>
  );
}
