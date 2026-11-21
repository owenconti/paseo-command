/** The crew as a list down the Command tab's left (the user's ask: a persistent sidebar beside the conversation; the Crew
 *  tab keeps the map). Hosts › projects › workspaces › agents in the map's order, each agent with its robot, name and
 *  state; what is open is marked and kept in view. A click opens it, as the map's does. ⌘S (and ⌘K) hides or shows it
 *  (`sideStore.ts`); its right edge resizes it. Folds are its own (`crew:sideCollapsed`), apart from the map's. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, PanelLeftClose } from "lucide-react";
import { STATE_NAMES, type State } from "../model/fleet";
import { readStore, writeStore } from "../api";
import { ResizeEdge } from "../ResizeEdge";
import { Medals, Robot } from "./parts";
import { robotColorOf } from "./sheets";
import type { RosterAgent, RosterHost, RosterWorkspace } from "./roster";
import { SIDE } from "./sideStore";

const COLLAPSED = "crew:sideCollapsed";
const NEEDS: State[] = ["failed", "approval", "question", "asking"];

type Props = {
  hosts: RosterHost[];
  /** The open thing's key (an agent's, a workspace's, a project's), marked. */
  selected: string | null;
  pick: (kind: "agent" | "workspace" | "project", key: string) => void;
  medals: (w: RosterWorkspace, size: number) => React.ReactNode;
  /** What a running agent is doing, in a sentence. */
  summaryOf: (a: RosterAgent) => string | undefined;
  width: number;
  resize: (w: number | null) => void;
  hide: () => void;
};

export function CrewSide(props: Props) {
  const [collapsed, setCollapsed] = useState<string[]>(() => readStore<string[]>(COLLAPSED, []));
  const toggle = (key: string) =>
    setCollapsed((now) => {
      const next = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
      writeStore(COLLAPSED, next);
      return next;
    });
  const list = useRef<HTMLDivElement>(null);
  // What is open stays in view (chosen here, on the map, with J/K, ⌘K or a notification).
  useEffect(() => {
    if (props.selected) list.current?.querySelector(`[data-key="${CSS.escape(props.selected)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [props.selected]);
  /** ↑/↓ (Home/End) move through its rows. */
  const keys = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || e.metaKey || e.altKey) return;
    const rows = [...(list.current?.querySelectorAll<HTMLButtonElement>("button.crew-side-row") ?? [])];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (e.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  };
  const current = (key: string) => (props.selected === key ? "true" : undefined);

  const agent = (a: RosterAgent) => {
    const summary = a.state === "running" ? props.summaryOf(a) : undefined;
    return (
      <button
        key={a.key}
        className="crew-side-row agent"
        data-key={a.key}
        data-state={a.state}
        data-needs={NEEDS.includes(a.state) || undefined}
        aria-current={current(a.key)}
        onClick={() => props.pick("agent", a.key)}
      >
        <Robot color={robotColorOf(a.model)} state={a.state} size={22} />
        <span className="crew-side-text">
          <span className="crew-side-name">
            {a.state === "done" && <span className="crew-unread" aria-label="Unread reply" role="img" />}
            {a.name}
          </span>
          <span className={`crew-side-state${summary ? " crew-shimmer" : ""}`}>
            <i aria-hidden="true" />
            {summary || STATE_NAMES[a.state]}
          </span>
        </span>
      </button>
    );
  };
  const loose = (agents: RosterAgent[]) =>
    agents.length > 0 && (
      <div className="crew-side-ws loose">
        <span className="crew-side-loose">Without a workspace</span>
        {agents.map(agent)}
      </div>
    );

  return (
    <nav className="crew-side" id="crew-side" aria-label="Crew list" style={{ width: props.width }} onKeyDown={keys}>
      <div className="crew-side-head">
        <h2>Crew</h2>
        <button className="crew-side-hide" aria-label="Hide the crew list" aria-keyshortcuts="Meta+S" data-tip="Hide the crew list (⌘S)" onClick={props.hide}>
          <PanelLeftClose size={14} aria-hidden="true" />
        </button>
      </div>
      <div className="crew-side-list" ref={list}>
        {props.hosts.map((h) => {
          const hostShut = collapsed.includes(h.key);
          return (
            <section key={h.key} className="crew-side-host" data-offline={!h.online || undefined} aria-label={h.name}>
              <button className="crew-side-fold host" aria-expanded={!hostShut} onClick={() => toggle(h.key)}>
                <ChevronDown size={12} aria-hidden="true" />
                <span>{h.name}</span>
                {!h.online && <small>offline</small>}
              </button>
              {!hostShut && (
                <>
                  {h.projects.map((p) => {
                    const shut = collapsed.includes(p.key);
                    return (
                      <section key={p.key} className="crew-side-project" aria-label={p.name}>
                        <div className="crew-side-project-head">
                          <button className="crew-side-fold small" aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} ${p.name}`} onClick={() => toggle(p.key)}>
                            <ChevronDown size={12} aria-hidden="true" />
                          </button>
                          <button className="crew-side-row project" data-key={p.key} aria-current={current(p.key)} onClick={() => props.pick("project", p.key)}>
                            {p.name}
                          </button>
                        </div>
                        {!shut && (
                          <>
                            {p.workspaces.map((w) => (
                              <div key={w.key} className={`crew-side-ws${w.probe?.state === "reviewing" ? " probe-reviewing" : ""}`}>
                                <button className="crew-side-row workspace" data-key={w.key} aria-current={current(w.key)} onClick={() => props.pick("workspace", w.key)}>
                                  <span className="crew-side-ws-name">{w.name}</span>
                                  {props.medals(w, 16)}
                                </button>
                                {w.agents.map(agent)}
                              </div>
                            ))}
                            {loose(p.loose)}
                          </>
                        )}
                      </section>
                    );
                  })}
                  {loose(h.loose)}
                </>
              )}
            </section>
          );
        })}
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
