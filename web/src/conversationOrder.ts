import type { Agent } from "./types";
/** J/K and the conversation's ‹ › follow a stable roster (host, project, workspace, age): reading a reply never reorders it. */
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
