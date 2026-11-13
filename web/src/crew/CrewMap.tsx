/** The Crew map: the fleet as a chat app, drawn by the page itself (in a plain browser too), in the map's place.
 * A roster of robots on the left (Needs you pinned first, then host › project › workspace › agent, oldest first),
 * and on the right the open conversation (the app's own detail: the agent's `Session`, New agent, a workspace or
 * project) under a stage strip that shows the agent's robot, its state and progress, and its workspace's PR
 * medallions. With nothing open, an overview of every robot by state. The robots, drones, state marks and
 * glows, and the PR, Probe and auto-merge medallions are the Dungeon Board's sheets (`sheets.ts`). The session
 * panel is gone while it shows (main.tsx's `crewShown`): this is where the conversation is. */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import robotsUrl from "../../../rendering/src/assets/dungeon/robots.png";
import statusUrl from "../../../rendering/src/assets/dungeon/status.png";
import { AUTO_MERGE } from "../../../rendering/src/prStatus";
import { STATE_NAMES, modelName, type State } from "../../../rendering/src/world";
import { atlasData, selectionKey } from "../atlasData";
import { worldSnapshot, targetSelection } from "../worldBridge";
import { useProbe } from "../useProbe";
import { flagTip } from "../flagTip";
import { readStore, writeStore } from "../api";
import { setUnityWorldTheme } from "../theme";
import { ChatDecorContext, type ChatDecor } from "../chatDecor";
import { ResizeEdge } from "../ResizeEdge";
import { onAppCommand } from "../appCommands";
import type { Agent, Host, Project, Selection, Workspace } from "../types";
import type { WorkSummaries } from "../useWorkingOn";
import { buildRoster, overview, type RosterAgent, type RosterWorkspace } from "./roster";
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
};

const ROSTER_WIDTH = "crew:rosterWidth";
const COLLAPSED = "crew:collapsed";
const ROSTER_DEFAULT = 290;

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
      {...(tip ? { "data-tip": tip, role: "img", "aria-label": tip } : { "aria-hidden": true })}
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
  const [width, setWidth] = useState(() => readStore<number>(ROSTER_WIDTH, ROSTER_DEFAULT));
  const resize = (w: number) => {
    const next = Math.round(Math.max(220, Math.min(460, w)));
    setWidth(next);
    writeStore(ROSTER_WIDTH, next);
  };
  const selected = selectionKey(props.selection, snapshot);
  const rosterRef = useRef<HTMLElement>(null);

  // The panels keep the app's look: Galaxy, or Light while the system is light.
  useEffect(() => {
    setUnityWorldTheme("galaxy");
    return () => setUnityWorldTheme(null);
  }, []);
  // ⌘K "Filter the crew…": the roster's filter field.
  const filterField = useRef<HTMLInputElement>(null);
  useEffect(() => onAppCommand("crew-filter", () => filterField.current?.focus()), []);
  // A selection made elsewhere (J/K, ⌘K, a notification) scrolls its row into view.
  useEffect(() => {
    rosterRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const pick = (kind: "agent" | "workspace" | "project", key: string) => {
    if (props.blocked) return;
    const s = targetSelection({ kind, key }, snapshot);
    if (s) props.select(s);
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
  const placeOf = (a: RosterAgent) => {
    const w = a.workspace ? data.workspaces.find((x) => x.key === a.workspace) : undefined;
    const p = a.project ? data.projects.find((x) => x.key === a.project) : undefined;
    return [w?.name, p?.name].filter(Boolean).join(" · ");
  };
  const subtitle = (a: RosterAgent, pinned: boolean) => {
    if (a.state === "running") return summaryOf(a) || "Working…";
    const state = STATE_NAMES[a.state];
    return pinned ? [state, placeOf(a)].filter(Boolean).join(" · ") : state;
  };

  /** ↑/↓ (and Home/End) move through the roster's rows. */
  const rosterKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || e.target instanceof HTMLInputElement) return;
    const rows = [...(rosterRef.current?.querySelectorAll<HTMLButtonElement>(".crew-row, .crew-head") ?? [])];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
  };

  const agentRow = (a: RosterAgent, pinned = false) => (
    <button
      key={`${pinned ? "pin" : "row"}:${a.key}`}
      className="crew-row"
      data-state={a.state}
      aria-current={selected === a.key ? "true" : undefined}
      onClick={() => pick("agent", a.key)}
    >
      <Portrait agent={a} size={30} mark={false} />
      <span className="crew-row-text">
        <b>{a.name}</b>
        <small className={a.state === "running" ? "crew-shimmer" : undefined}>{subtitle(a, pinned)}</small>
      </span>
      {a.state === "done" ? (
        <span className="crew-unread" data-tip="Replied · unread" aria-label="Unread reply" role="img" />
      ) : (
        markOf(a.state) && (
          <Status
            frame={markOf(a.state)!}
            size={20}
            className={a.state === "running" ? "spin" : pinned ? "pulse" : ""}
            tip={STATE_NAMES[a.state]}
          />
        )
      )}
    </button>
  );
  const medals = (w: RosterWorkspace | (typeof data.workspaces)[number], size: number) => {
    const pr = workspaceRow(w)?.pr;
    const list = medalsOf(w.labels, w.probe);
    if (!list.length && !w.autoMerge) return null;
    return (
      <span className="crew-medals">
        {list.map((m) => {
          const tip = flagTip(m.flag, pr, w.probe);
          return <Status key={m.kind} frame={m.frame} size={size} tip={[tip.title, tip.description].filter(Boolean).join(": ")} />;
        })}
        {w.autoMerge && <Status frame="seal-automerge" size={size} tip={`${AUTO_MERGE.name}: ${AUTO_MERGE.description}`} />}
      </span>
    );
  };

  const shownAgent = props.selection?.type === "agent" ? data.agents.find((a) => a.key === selected) : undefined;
  const decor = useMemo<ChatDecor>(() => {
    if (!shownAgent) return {};
    const color = robotColorOf(shownAgent.model);
    return {
      replyAvatar: (live) => <Robot color={color} state={live && shownAgent.state === "running" ? "running" : "idle"} size={30} />,
      working: <Robot color={color} state="running" size={24} />,
    };
  }, [shownAgent?.model, shownAgent?.state]);

  return (
    <div className="crew-map" data-world="crew" style={{ "--crew-roster": `${width}px` } as CSSProperties}>
      <nav className="crew-roster" aria-label="Crew" ref={rosterRef} onKeyDown={rosterKeys}>
        <div className="crew-roster-head">
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
          <button className="crew-new" data-tip="New agent (D)" aria-label="New agent" onClick={props.onDispatch}>
            <Plus size={15} />
          </button>
        </div>
        <div className="crew-roster-body">
          {roster.needYou.length > 0 && (
            <section className="crew-group crew-need" aria-label="Needs you">
              <h3 className="crew-label">
                <i aria-hidden="true" />Needs you · {roster.needYou.length}
              </h3>
              {roster.needYou.map((a) => agentRow(a, true))}
            </section>
          )}
          {roster.hosts.map((h) => {
            const hostShut = collapsed.includes(h.key);
            return (
              <section key={h.key} className="crew-group" data-offline={!h.online || undefined} aria-label={h.name}>
                <h3 className="crew-label">
                  <button className="crew-fold" aria-expanded={!hostShut} onClick={() => toggle(h.key)}>
                    <ChevronDown size={12} aria-hidden="true" />
                    {h.name}
                    {!h.online && <span className="crew-offline">offline</span>}
                  </button>
                </h3>
                {!hostShut &&
                  h.projects.map((p) => {
                    const shut = collapsed.includes(p.key);
                    return (
                      <div key={p.key} className="crew-project">
                        <div className="crew-project-head">
                          <button className="crew-fold small" aria-expanded={!shut} aria-label={`${shut ? "Show" : "Hide"} ${p.name}`} onClick={() => toggle(p.key)}>
                            <ChevronDown size={12} aria-hidden="true" />
                          </button>
                          <button className="crew-head project" aria-current={selected === p.key ? "true" : undefined} onClick={() => pick("project", p.key)}>
                            {p.name}
                          </button>
                        </div>
                        {!shut && (
                          <>
                            {p.workspaces.map((w) => (
                              <div key={w.key} className="crew-ws">
                                <button className="crew-head workspace" aria-current={selected === w.key ? "true" : undefined} onClick={() => pick("workspace", w.key)}>
                                  <span className="crew-ws-name">{w.name}</span>
                                  {medals(w, 16)}
                                </button>
                                {w.agents.map((a) => agentRow(a))}
                              </div>
                            ))}
                            {p.loose.map((a) => agentRow(a))}
                          </>
                        )}
                      </div>
                    );
                  })}
                {!hostShut && h.loose.map((a) => agentRow(a))}
              </section>
            );
          })}
          {filter && !roster.hosts.length && <p className="crew-none">No agent matches “{filter}”.</p>}
        </div>
        <ResizeEdge
          label="Resize the crew"
          value={width}
          min={220}
          max={460}
          grows="right"
          onResize={resize}
          onReset={() => resize(ROSTER_DEFAULT)}
        />
      </nav>
      <section className="crew-main" aria-label="Conversation">
        {shownAgent && !props.empty && (
          <Stage
            agent={shownAgent}
            sentence={summaryOf(shownAgent)}
            workspace={shownAgent.workspace ? data.workspaces.find((w) => w.key === shownAgent.workspace) : undefined}
            medals={medals}
            onWorkspace={(key) => pick("workspace", key)}
          />
        )}
        {props.empty ? (
          <Overview
            data={data}
            loaded={props.loaded}
            summaryOf={summaryOf}
            placeOf={placeOf}
            onPick={(key) => pick("agent", key)}
            onDispatch={props.onDispatch}
          />
        ) : (
          <div className="detail-content crew-detail" id="detail-panel">
            <ChatDecorContext.Provider value={decor}>{props.detail}</ChatDecorContext.Provider>
          </div>
        )}
      </section>
    </div>
  );
}

/** Above the open conversation: the agent's robot (working, resting or offline), its state and progress, and its
 * workspace with its pull request's medallions. Its name and tools are the conversation's own header's. */
function Stage(props: {
  agent: RosterAgent;
  sentence?: string;
  workspace?: ReturnType<typeof atlasData>["workspaces"][number];
  medals: (w: ReturnType<typeof atlasData>["workspaces"][number], size: number) => ReactNode;
  onWorkspace: (key: string) => void;
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
    </div>
  );
}

/** With nothing open: every robot, by state, the ones that need you first. */
function Overview(props: {
  data: ReturnType<typeof atlasData>;
  loaded: boolean;
  summaryOf: (a: RosterAgent) => string | undefined;
  placeOf: (a: RosterAgent) => string;
  onPick: (key: string) => void;
  onDispatch: () => void;
}) {
  const sections = overview(props.data);
  const total = props.data.agents.length;
  const need = sections.find((s) => s.id === "need")?.agents.length ?? 0;
  const running = props.data.agents.filter((a) => a.state === "running").length;
  return (
    <div className="crew-overview">
      <header className="crew-overview-head">
        <div>
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
        <button className="crew-primary" onClick={props.onDispatch}>
          <Plus size={14} aria-hidden="true" />
          New agent
        </button>
      </header>
      {sections.map((s) => (
        <section key={s.id} className="crew-overview-section" aria-label={s.title}>
          <h3 className="crew-label">
            {s.title} · {s.agents.length}
          </h3>
          <div className="crew-cards">
            {s.agents.map((a) => (
              <button key={a.key} className="crew-card" data-state={a.state} onClick={() => props.onPick(a.key)}>
                <Portrait agent={a} size={48} />
                <span className="crew-card-text">
                  <b>{a.name}</b>
                  <small>{props.placeOf(a) || STATE_NAMES[a.state]}</small>
                  <small className={a.state === "running" ? "crew-shimmer" : "crew-card-state"}>
                    {a.state === "running" ? props.summaryOf(a) || "Working…" : STATE_NAMES[a.state]}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
