/** The Crew map: the fleet as a chat app, drawn by the page itself (in a plain browser too), in the map's place on the
 * Command tab (it is the only map). With nothing open it is the map: each host, its projects and their workspaces
 * (oldest first), each workspace a panel of its agents' robots as large nodes with their state and progress. Picking one
 * opens it in the drawer on the map's right (`CrewDetail`, the same component the session panel shows beside the other
 * tabs); Back (or Esc) returns to the map. A workspace's head archives it, and a claimed pool box's host head releases
 * the box. The robots, drones, marks, glows and medallions are `parts.tsx`'s. */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Archive, ChevronDown, FolderPlus, Plus, RotateCcw, Search, X } from "lucide-react";
import { STATE_NAMES, modelName, type State } from "../model/fleet";
import { PoolClaims } from "../PoolClaims";
import { PoolBoxes } from "./PoolBoxes";
import { selectionKey } from "../atlasData";
import { targetSelection } from "../worldBridge";
import { readStore, writeStore } from "../api";
import { onAppCommand } from "../appCommands";
import { ResizeEdge } from "../ResizeEdge";
import { claimedBoxOf, jobText, type PoolBox, type PoolJob } from "../pool";
import { placeText } from "../names";
import { workspaceKey } from "../workspaces";
import type { Selection, Workspace } from "../types";
import type { WorkSummaries } from "../useWorkingOn";
import { buildRoster, hostAgents, projectAgents, stateTally, type RosterAgent } from "./roster";
import { CrewDetail } from "./CrewDetail";
import { Medals, Portrait, useCrewData, type CrewFleet } from "./parts";
import "./crew.css";

type Props = CrewFleet & {
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
  /** Add a project (a folder, a new folder or a clone); New agent then opens on it. */
  onAddProject?: () => void;
  /** The open agent's browser (the macOS app's): shown beside its conversation, its tabs, B's toggle. */
  browser?: { shown: boolean; tabs: number; toggle: () => void };
  /** Archive a workspace (its confirmation), and those being archived (by `workspaceKey`). */
  onArchive?: (w: Workspace) => void;
  archiving?: Set<string>;
  /** Pool boxes (Settings → Pool boxes): a claimed box's host head releases it (its confirmation). */
  pool?: { boxes: PoolBox[]; job: PoolJob | null; jobs?: PoolJob[]; release: (box: PoolBox) => void };
};

const COLLAPSED = "crew:collapsed";
/** The Pool boxes section's fold, kept with the hosts' and projects'. */
const POOL_FOLD = "pool:boxes";
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

export function CrewMap(props: Props) {
  const { snapshot, data } = useCrewData(props);
  const [filter, setFilter] = useState("");
  // A claimed pool box's host stays on the map with nothing on it, so it can be released (and shows releasing).
  const keepHosts = new Set(
    props.pool
      ? props.hosts
          .filter((h) => props.pool!.boxes.some((b) => b.label === h.label && (b.status === "claimed" || props.pool!.job?.pool === b.id)))
          .map((h) => (h.local ? "local" : h.serverId))
      : [],
  );
  const roster = useMemoRoster(data, filter, keepHosts);
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
  // The roster keys hosts as Crew's data does: "local", else the server id.
  const rosterKey = (h: { local: boolean; serverId: string }) => (h.local ? "local" : h.serverId);
  const hostLabel = (key: string) => props.hosts.find((h) => rosterKey(h) === key)?.label;
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

  const medals = (w: Parameters<typeof Medals>[0]["workspace"], size: number) => <Medals workspace={w} pr={workspaceRow(w)?.pr} size={size} />;

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

  const open = !props.empty;
  return (
    <div ref={root} className="crew-map" data-world="crew" data-open={open || undefined} data-browser={(open && props.selection?.type === "agent" && props.browser?.shown) || undefined}>
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
          {props.onAddProject && (
            <button className="crew-secondary" onClick={props.onAddProject} data-tip="Add a folder, a new folder or a GitHub clone as a project">
              <FolderPlus size={14} aria-hidden="true" />
              Add project
            </button>
          )}
          <button className="crew-primary" onClick={props.onDispatch}>
            <Plus size={14} aria-hidden="true" />
            New agent
          </button>
        </header>
        <PoolClaims agents={props.agents} onOpen={props.onDispatch} />
        {props.pool && !filter && (
          <PoolBoxes
            boxes={props.pool.boxes}
            jobs={[...(props.pool.job ? [props.pool.job] : []), ...(props.pool.jobs ?? [])]}
            hostOf={(label) => {
              const h = props.hosts.find((x) => x.label === label);
              if (!h) return undefined;
              const key = rosterKey(h);
              return { key, online: !!data.hosts.find((x) => x.key === key)?.online, agents: data.agents.filter((a) => a.host === key).length };
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
        {roster.hosts.map((h) => {
          const hostShut = collapsed.includes(h.key);
          return (
            <section key={h.key} className="crew-host" data-host={h.key} data-offline={!h.online || undefined} aria-label={h.name}>
              <h3 className="crew-host-head">
                <button className="crew-fold" aria-expanded={!hostShut} onClick={() => toggle(h.key)}>
                  <ChevronDown size={14} aria-hidden="true" />
                  {h.name}
                </button>
                {!h.online && <span className="crew-offline">offline</span>}
                {hostShut && <Tally agents={hostAgents(h)} />}
                {(() => {
                  const box = props.pool && claimedBoxOf(props.pool.boxes, hostLabel(h.key));
                  if (!box || !props.pool) return null;
                  const job = props.pool.job;
                  const releasing = job?.kind === "release" && job.pool === box.id;
                  return (
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
                  );
                })()}
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
                          {shut && <Tally agents={projectAgents(p)} />}
                        </div>
                        {!shut && (
                          <div className="crew-workspaces">
                            {p.workspaces.map((w) => (
                              <article key={w.key} className="crew-ws" aria-label={w.name} style={{ "--crew-n": Math.max(1, w.agents.length), gridColumn: `span ${Math.min(cols, Math.max(1, w.agents.length))}` } as CSSProperties}>
                                <div className="crew-ws-top">
                                  <button className="crew-head workspace" data-key={w.key} aria-current={selected === w.key ? "true" : undefined} onClick={() => pick("workspace", w.key)}>
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
            {...(props.browser ? { browser: props.browser } : {})}
          />
        </aside>
      )}
    </div>
  );
}


function useMemoRoster(data: ReturnType<typeof useCrewData>["data"], filter: string, keepHosts: Set<string>) {
  const kept = [...keepHosts].sort().join("\n");
  const [memo] = useState(() => ({ data: null as unknown, filter: "", kept: "", roster: null as unknown as ReturnType<typeof buildRoster> }));
  if (memo.data !== data || memo.filter !== filter || memo.kept !== kept)
    Object.assign(memo, { data, filter, kept, roster: buildRoster(data, filter, keepHosts) });
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
