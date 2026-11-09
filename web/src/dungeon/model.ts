import type { AtlasData } from "../../../rendering/src/world";
export type AgentTray = "waiting" | "running" | "replies" | "failures";
export type DungeonTray =
  | "waiting"
  | "running"
  | "replies"
  | "problems"
  | "review"
  | "assigned"
  | "issues"
  | "inbox";
export const DUNGEON_TRAYS: {
  id: DungeonTray;
  label: string;
  title: string;
  service?: "GitHub" | "Linear";
}[] = [
  { id: "waiting", label: "Waiting", title: "Waiting on you" },
  { id: "replies", label: "Replies", title: "Unread replies" },
  { id: "problems", label: "Problems", title: "Failures and blocked work" },
  {
    id: "review",
    label: "Reviews",
    title: "GitHub review requests",
    service: "GitHub",
  },
  {
    id: "assigned",
    label: "Assigned",
    title: "Assigned pull requests",
    service: "GitHub",
  },
  {
    id: "issues",
    label: "Issues",
    title: "Assigned Linear issues",
    service: "Linear",
  },
  {
    id: "inbox",
    label: "Inbox",
    title: "Unread Linear Inbox",
    service: "Linear",
  },
  { id: "running", label: "Running", title: "Running agents" },
];
export const BELT_SLOTS: DungeonTray[] = [
  "replies",
  "problems",
  "review",
  "assigned",
  "issues",
  "inbox",
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
