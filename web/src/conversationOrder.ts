import type { Agent } from "./types";
/** J/K and the conversation's ‹ › follow a stable roster (host, project, workspace, age): reading a reply never reorders it.
 *  Hosts go in the map's order when `hostRank` gives it (Crew's host order, by key: "local" or the server id). */
export function conversationOrder(agents: Agent[], hostRank?: (key: string) => number): Agent[] {
  const key = (a: Agent) => [
    a.host || "",
    a.projectId || "",
    a.workspaceId || a.cwd,
    a.createdAt || a.created || "",
    a.id,
  ];
  return [...agents].sort((a, b) => {
    if (hostRank) {
      const ranked = hostRank(a.host || "local") - hostRank(b.host || "local");
      if (ranked) return ranked;
    }
    const left = key(a),
      right = key(b);
    for (let i = 0; i < left.length; i++) {
      const n = left[i]!.localeCompare(right[i]!);
      if (n) return n;
    }
    return 0;
  });
}
