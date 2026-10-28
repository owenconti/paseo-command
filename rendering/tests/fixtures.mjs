/** A larger fleet: many projects, a crowded workspace, an orphan workspace,
 * an agent without a workspace, a host without workspaces and an offline host. */
export const crowded = {
  hosts: [
    { key: "local", name: "local", online: true, local: true },
    { key: "a", name: "alpha", online: true, local: false },
    { key: "b", name: "bravo", online: false, local: false },
    { key: "c", name: "charlie", online: true, local: false },
  ],
  projects: Array.from({ length: 7 }, (_, i) => ({
    key: `p${i}`,
    host: i < 5 ? "local" : "a",
    name: `project-${i}`,
  })).concat([{ key: "pb", host: "b", name: "offline-project" }]),
  workspaces: [
    ...Array.from({ length: 11 }, (_, i) => ({
      key: `w${i}`,
      host: "local",
      project: i < 9 ? "p0" : "p3",
      name: `workspace ${i}`,
    })),
    { key: "orphan", host: "local", name: "orphan workspace" },
    { key: "wb", host: "b", project: "pb", name: "remote" },
  ],
  agents: [
    ...Array.from({ length: 6 }, (_, i) => ({
      key: `x${i}`,
      host: "local",
      workspace: "w0",
      project: "p0",
      name: `crowd ${i}`,
      model: "claude/claude-opus-5-5",
      state: "running",
    })),
    {
      key: "homeless",
      host: "local",
      project: "p3",
      name: "no workspace",
      model: "codex/gpt-6.1-sol",
      state: "idle",
    },
    {
      key: "far",
      host: "b",
      workspace: "wb",
      name: "far",
      model: "claude/claude-sonnet-5",
      state: "running",
    },
  ],
};
