/** Crew's pieces, shared by its map (CrewMap.tsx), its conversation (CrewDetail.tsx, also the session panel's beside
 * the other tabs) and the chat (an agent's report shows its robot): robots in their provider's colour and their idle or
 * work frames, running subagents' drones, the status sheet's state marks, glows and PR, Probe and auto-merge
 * medallions (`sheets.ts`, from the art in rendering/src/assets/dungeon), and the strip above the message box. */
import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { Globe } from "lucide-react";
import robotsUrl from "../../../rendering/src/assets/dungeon/robots.png";
import statusUrl from "../../../rendering/src/assets/dungeon/status.png";
import { AUTO_MERGE } from "../model/prStatus";
import { STATE_NAMES, modelName, type State } from "../model/fleet";
import { atlasData } from "../atlasData";
import { worldSnapshot } from "../worldBridge";
import { useProbe } from "../useProbe";
import { autoMergeLine, flagTip } from "../flagTip";
import type { Agent, Host, Project, Workspace } from "../types";
import { type RosterAgent, type RosterWorkspace } from "./roster";
import { droneColors, droneFrames, frameOf, frameStyle, glowOf, markOf, medalsOf, poseOf, robotColorOf, robotFrames } from "./sheets";
import "./crew.css";

/** The fleet as Crew reads it (the hosts, projects, workspaces and agents as one snapshot, with each state). */
export type CrewFleet = {
  hosts: Host[];
  projects: Project[];
  workspaces: Workspace[];
  agents: Agent[];
  permissions: Set<string>;
  questions: Set<string>;
  asking: Set<string>;
  unread: Set<string>;
};
export function useCrewData(props: CrewFleet) {
  const probe = useProbe();
  const revision = useRef(0);
  const snapshot = useMemo(
    () => worldSnapshot({ ...props, revision: ++revision.current }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.hosts, props.projects, props.workspaces, props.agents, props.permissions, props.unread],
  );
  const data = useMemo(() => atlasData(snapshot, props.questions, props.asking, probe), [snapshot, props.questions, props.asking, probe]);
  return { snapshot, data };
}
export type CrewData = ReturnType<typeof useCrewData>["data"];
export type CrewWorkspace = CrewData["workspaces"][number];

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
export function Drones({ agent, size }: { agent: RosterAgent; size: number }) {
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
export function Status({ frame, size, className, tip }: { frame: string; size: number; className?: string; tip?: string }) {
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
export function Portrait({ agent, size, mark = true }: { agent: RosterAgent; size: number; mark?: boolean }) {
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

/** A workspace's PR, Probe and auto-merge medallions, each with its tooltip. */
export function Medals({ workspace: w, pr, size }: { workspace: RosterWorkspace | CrewWorkspace; pr?: Workspace["pr"]; size: number }) {
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
}

/** At the conversation's foot, above its message box: the agent's robot (working, resting or offline), its state and progress, and its
 * workspace with its pull request's medallions. Its name and tools are the conversation's own header's. */
export function Stage(props: {
  agent: RosterAgent;
  sentence?: string;
  workspace?: CrewWorkspace;
  medals: (w: CrewWorkspace, size: number) => ReactNode;
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
