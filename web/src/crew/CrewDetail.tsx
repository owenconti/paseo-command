/** What is open, as Crew shows it: the app's own detail (the agent's `Session`, a subagent's, New agent, a workspace,
 * a project or Add project, main.tsx's `detailView`), with the open agent's robot beside each reply and in the working
 * row (`ChatDecorContext`) and its strip above the message box (`ChatFooterContext`, `Stage`): its robot, state and
 * progress, workspace and medallions, and its browser's button. The same component in Crew's drawer, on the Command
 * tab, and in the session panel beside the other tabs (GitHub, Files, Terminal, Conquer, Activity). */
import { useMemo, type ReactNode } from "react";
import { selectionKey } from "../atlasData";
import { targetSelection } from "../worldBridge";
import { ChatDecorContext, ChatFooterContext, type ChatDecor } from "../chatDecor";
import type { Selection } from "../types";
import type { WorkSummaries } from "../useWorkingOn";
import { Medals, Robot, Stage, useCrewData, type CrewFleet, type CrewWorkspace } from "./parts";
import { robotColorOf } from "./sheets";

export type CrewDetailProps = CrewFleet & {
  selection: Selection;
  select: (value: Selection) => void;
  workingOn?: WorkSummaries;
  /** The open conversation, New agent, workspace or project. */
  detail: ReactNode;
  /** The open agent's browser (the macOS app's, on Crew): shown beside its conversation, its tabs, B's toggle. */
  browser?: { shown: boolean; tabs: number; toggle: () => void };
};

export function CrewDetail(props: CrewDetailProps) {
  const { snapshot, data } = useCrewData(props);
  const selected = selectionKey(props.selection, snapshot);
  const shownAgent = props.selection?.type === "agent" ? data.agents.find((a) => a.key === selected) : undefined;
  const workspaceRow = (key: string) => {
    const s = snapshot.workspaces.find((x) => x.key === key);
    return s && props.workspaces.find((x) => x.workspaceId === s.id && (x.host || "local") === s.hostId);
  };
  const row = shownAgent && snapshot.agents.find((a) => a.key === shownAgent.key);
  const sentence = (row && props.workingOn?.[row.clientId ?? row.id]?.sentence) || undefined;
  const decor = useMemo<ChatDecor>(() => {
    if (!shownAgent) return {};
    const color = robotColorOf(shownAgent.model);
    return {
      replyAvatar: (live) => <Robot color={color} state={live && shownAgent.state === "running" ? "running" : "idle"} size={30} />,
      working: <Robot color={color} state="running" size={24} />,
    };
  }, [shownAgent?.model, shownAgent?.state]);
  const medals = (w: CrewWorkspace, size: number) => <Medals workspace={w} pr={workspaceRow(w.key)?.pr} size={size} />;
  return (
    <div className="detail-content crew-detail" id="detail-panel">
      <ChatDecorContext.Provider value={decor}>
        <ChatFooterContext.Provider
          value={
            shownAgent && (
              <Stage
                browser={props.browser}
                agent={shownAgent}
                sentence={sentence}
                workspace={shownAgent.workspace ? data.workspaces.find((w) => w.key === shownAgent.workspace) : undefined}
                medals={medals}
                onWorkspace={(key) => {
                  const s = targetSelection({ kind: "workspace", key }, snapshot);
                  if (s) props.select(s);
                }}
              />
            )
          }
        >
          {props.detail}
        </ChatFooterContext.Provider>
      </ChatDecorContext.Provider>
    </div>
  );
}
