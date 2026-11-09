import type { Agent } from "../types";
/** Conversation controls follow a stable roster of the map's robots. Reading a reply must not reorder the next robot. */
export function conversationOrder(agents: Agent[]): Agent[] {
  const key = (a: Agent) => [
    a.host || "",
    a.projectId || "",
    a.workspaceId || a.cwd,
    a.createdAt || a.created || "",
    a.id,
  ];
  return [...agents].sort((a, b) => {
    const left = key(a),
      right = key(b);
    for (let i = 0; i < left.length; i++) {
      const n = left[i]!.localeCompare(right[i]!);
      if (n) return n;
    }
    return 0;
  });
}
