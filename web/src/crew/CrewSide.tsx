/** The crew as a list down the Command tab's left (the user's ask: a persistent sidebar beside the conversation; the Crew
 *  tab keeps the map). After Paseo's app and T3 Code: no host level; its agents grouped by project (across hosts, by
 *  name), status, host or not at all, most recently active first or as created (its Display menu, ⌘K; `sideStore.ts`).
 *  Each agent is a card in the look of the strip above the message box: its robot with its glow, mark and drones, its
 *  name, its state in its colour and its model, what it is doing with a bar while it runs, its workspace (when not its
 *  own name), host (when not this Mac) and how long ago it was active, on a wash of its state's colour, its workspace's
 *  medallions in its corner. What is open is marked and kept in view; a click opens it, as the map's does. ⌘S (and ⌘K)
 *  hides or shows the list; its right edge resizes it. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, ChevronDown, PanelLeftClose, SlidersHorizontal } from "lucide-react";
import { STATE_NAMES, modelName } from "../model/fleet";
import { readStore, writeStore } from "../api";
import { ResizeEdge } from "../ResizeEdge";
import { shortAgo } from "../activity/rows";
import { Portrait } from "./parts";
import type { RosterAgent, RosterWorkspace } from "./roster";
import { groupItems, type SideItem } from "./sideList";
import { SIDE, SIDE_GROUPS, SIDE_SORTS, setCrewSideGroup, setCrewSideSort, useCrewSide } from "./sideStore";

const COLLAPSED = "crew:sideCollapsed";

export type SideCard = SideItem & { agent: RosterAgent; workspace?: RosterWorkspace };

type Props = {
  items: SideCard[];
  /** The open agent's key, marked. */
  selected: string | null;
  open: (key: string) => void;
  medals: (w: RosterWorkspace, size: number) => ReactNode;
  /** What a running agent is doing, in a sentence. */
  summaryOf: (a: RosterAgent) => string | undefined;
  width: number;
  resize: (w: number | null) => void;
  hide: () => void;
};

const words = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function CrewSide(props: Props) {
  const { group, sort } = useCrewSide();
  const [collapsed, setCollapsed] = useState<string[]>(() => readStore<string[]>(COLLAPSED, []));
  const toggle = (key: string) =>
    setCollapsed((now) => {
      const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
      writeStore(COLLAPSED, next);
      return next;
    });
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setMenu(false);
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", esc, true);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", esc, true);
    };
  }, [menu]);
  const list = useRef<HTMLDivElement>(null);
  // What is open stays in view (chosen here, on the map, with J/K, ⌘K or a notification).
  useEffect(() => {
    if (props.selected) list.current?.querySelector(`[data-key="${CSS.escape(props.selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [props.selected, group]);
  /** ↑/↓ (Home/End) move through its cards and group heads. */
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || e.metaKey || e.altKey || menu) return;
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>(".crew-side-card, .crew-side-group-head") ?? [])];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (e.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  };
  const groups = groupItems(props.items, group, sort);
  const now = Date.now();

  const card = (item: SideCard) => {
    const a = item.agent;
    const running = a.state === "running";
    const summary = props.summaryOf(a);
    const ws = item.workspace;
    // Its host (always, the user's ask, unless grouping says it), its workspace when that isn't the agent's own name (a
    // lone agent's worktree is often named for it), its project when grouping doesn't say it, and when it was last active.
    const meta = [
      group !== "host" ? item.host.name : "",
      ws && words(ws.name) !== words(a.name) ? ws.name : "",
      group !== "project" && item.project ? item.project.name : "",
    ].filter(Boolean);
    const ago = item.active || item.created ? shortAgo((item.active ?? item.created)!, now) : "";
    return (
      <button
        key={a.key}
        className="crew-side-card"
        data-key={a.key}
        data-state={a.state}
        aria-current={props.selected === a.key ? "true" : undefined}
        onClick={() => props.open(a.key)}
      >
        <Portrait agent={a} size={40} />
        <span className="crew-side-card-text">
          <span className="crew-side-card-name">
            {a.state === "done" && <span className="crew-unread" aria-label="Unread reply" role="img" />}
            <span className="crew-side-card-title">{a.name}</span>
            {ws && <span className="crew-side-card-medals">{props.medals(ws, 18)}</span>}
          </span>
          <span className="crew-side-card-state">
            <i aria-hidden="true" />
            <b>{STATE_NAMES[a.state]}</b>
            {a.model && <span>{modelName(a.model)}</span>}
          </span>
          {running && (
            <>
              <span className="crew-side-card-work crew-shimmer">{summary || "Working…"}</span>
              <span className="crew-progress" aria-hidden="true">
                <i />
              </span>
            </>
          )}
          {(meta.length > 0 || ago) && (
            <span className="crew-side-card-meta">
              {meta.length > 0 && <span className="crew-side-card-where">{meta.join(" · ")}</span>}
              {ago && (
                <time dateTime={item.active ?? item.created} title={new Date((item.active ?? item.created)!).toLocaleString()}>
                  {ago}
                </time>
              )}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <nav className="crew-side" id="crew-side" aria-label="Crew list" style={{ width: props.width }} onKeyDown={keys}>
      <div className="crew-side-head">
        <h2>Crew</h2>
        <div className="crew-side-menu-wrap" ref={menuRef}>
          <button
            className="crew-side-hide"
            aria-label="Display preferences"
            aria-haspopup="menu"
            aria-expanded={menu}
            data-tip="Group and sort"
            onClick={() => setMenu((m) => !m)}
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
          </button>
          {menu && (
            <div className="crew-side-menu" role="menu" aria-label="Display preferences">
              <p>Group by</p>
              {SIDE_GROUPS.map((o) => (
                <button key={o.value} role="menuitemradio" aria-checked={group === o.value} onClick={() => setCrewSideGroup(o.value)}>
                  {group === o.value ? <Check size={13} aria-hidden="true" /> : <span className="crew-side-menu-gap" />}
                  {o.label}
                </button>
              ))}
              <p>Sort by</p>
              {SIDE_SORTS.map((o) => (
                <button key={o.value} role="menuitemradio" aria-checked={sort === o.value} onClick={() => setCrewSideSort(o.value)}>
                  {sort === o.value ? <Check size={13} aria-hidden="true" /> : <span className="crew-side-menu-gap" />}
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="crew-side-hide" aria-label="Hide the crew list" aria-keyshortcuts="Meta+S" data-tip="Hide the crew list (⌘S)" onClick={props.hide}>
          <PanelLeftClose size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="crew-side-list" ref={list}>
        {groups.map((g) => {
          const shut = !!g.label && collapsed.includes(g.key);
          const needs = g.items.filter((i) => ["failed", "approval", "question", "asking"].includes(i.state)).length;
          return (
            <section key={g.key} className="crew-side-group" aria-label={g.label || "Agents"}>
              {g.label && (
                <button className="crew-side-group-head" aria-expanded={!shut} onClick={() => toggle(g.key)}>
                  <ChevronDown size={13} aria-hidden="true" />
                  <span className="crew-side-group-name">{g.label}</span>
                  {needs > 0 && group !== "status" && (
                    <span className="crew-side-group-needs" data-tip={`${needs} need${needs === 1 ? "s" : ""} you`}>
                      {needs}
                    </span>
                  )}
                  <span className="crew-side-group-count">{g.items.length}</span>
                </button>
              )}
              {!shut && <div className="crew-side-cards">{g.items.map(card)}</div>}
            </section>
          );
        })}
        {!props.items.length && <p className="crew-side-empty">No agents yet.</p>}
      </div>
      <ResizeEdge
        label="Resize the crew list"
        controls="crew-side"
        value={props.width}
        min={SIDE.min}
        max={SIDE.max}
        grows="right"
        onResize={props.resize}
        onReset={() => props.resize(null)}
      />
    </nav>
  );
}
