import type { AtlasData } from "../../../rendering/src/world";
export type AgentTray = "waiting" | "running" | "replies" | "failures";
export type DungeonTray = AgentTray | "review" | "blocked";
export const DUNGEON_TRAYS: {
  id: DungeonTray;
  label: string;
  title: string;
}[] = [
  { id: "waiting", label: "Waiting", title: "Waiting on you" },
  { id: "replies", label: "Replies", title: "Unread replies" },
  { id: "failures", label: "Failures", title: "Failed agents" },
  { id: "review", label: "PR review", title: "Pull requests in review" },
  { id: "blocked", label: "Blocked", title: "Blocked issues" },
  { id: "running", label: "Running", title: "Running agents" },
];
export function hudAgents(data: AtlasData, tray: AgentTray) {
  return data.agents.filter(
    (a) =>
      a.state !== "offline" &&
      data.hosts.some((h) => h.key === a.host && h.online) &&
      {
        waiting: ["approval", "question", "asking"],
        running: ["running"],
        replies: ["done"],
        failures: ["failed"],
      }[tray].includes(a.state ?? "idle"),
  );
}
