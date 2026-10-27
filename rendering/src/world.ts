export type State = "running" | "idle" | "done" | "approval" | "failed";
export type Model = "teal" | "violet" | "lime" | "blue";
export type Axial = { q: number; r: number };
export type Entity = {
  id: string;
  kind: "host" | "project" | "workspace" | "agent";
  name: string;
  host: string;
  project?: string;
  workspace?: string;
  position: Axial;
  art?: string;
  state?: State;
  model?: Model;
  number?: string;
  task?: string;
};
export const HEX_RADIUS = 68;
export const MODEL_NAMES: Record<Model, string> = {
  teal: "Claude Opus 5.5",
  violet: "GPT-6.1-Sol",
  lime: "Claude Sonnet 5",
  blue: "GPT-6-Astra",
};
export const STATE_NAMES: Record<State, string> = {
  running: "Working",
  idle: "Idle",
  done: "Done · waiting for you",
  approval: "Needs approval",
  failed: "Failed · needs attention",
};
export const MODEL_COLORS: Record<Model, number> = {
  teal: 0x25b6b9,
  violet: 0x9962d7,
  lime: 0xa3d640,
  blue: 0x398cdb,
};
export const projects: Entity[] = [
  {
    id: "manor",
    kind: "project",
    name: "paseo-command",
    host: "local",
    position: { q: -3, r: -2 },
    art: "manor",
  },
  {
    id: "observatory",
    kind: "project",
    name: "diagonal-api",
    host: "local",
    position: { q: 3, r: -2 },
    art: "observatory",
  },
  {
    id: "conservatory",
    kind: "project",
    name: "web",
    host: "local",
    position: { q: -2, r: 3 },
    art: "conservatory",
  },
  {
    id: "infra",
    kind: "project",
    name: "infra",
    host: "macmini",
    position: { q: 7, r: 4 },
    art: "observatory",
  },
];
const specs: {
  project: string;
  q: number;
  r: number;
  model: Model;
  state: State;
  name: string;
  task: string;
}[] = [
  {
    project: "manor",
    q: -2,
    r: 0,
    model: "teal",
    state: "running",
    name: "Workspace navigation",
    task: "Refining keyboard navigation between project workspaces.",
  },
  {
    project: "manor",
    q: 0,
    r: 0,
    model: "violet",
    state: "idle",
    name: "Conversation layout",
    task: "Ready for another task.",
  },
  {
    project: "manor",
    q: 2,
    r: 0,
    model: "blue",
    state: "done",
    name: "Atlas rendering",
    task: "The initial rendering layer is ready for your review.",
  },
  {
    project: "observatory",
    q: -2,
    r: 0,
    model: "violet",
    state: "running",
    name: "API response types",
    task: "Checking the response model against the daemon contract.",
  },
  {
    project: "observatory",
    q: 0,
    r: 0,
    model: "lime",
    state: "approval",
    name: "Schema update",
    task: "Waiting for approval before applying a database migration.",
  },
  {
    project: "observatory",
    q: 2,
    r: 0,
    model: "blue",
    state: "failed",
    name: "Integration checks",
    task: "An integration check failed. Review the test output before continuing.",
  },
  {
    project: "conservatory",
    q: -1,
    r: 0,
    model: "lime",
    state: "running",
    name: "Frontend components",
    task: "Building the project selection components.",
  },
  {
    project: "conservatory",
    q: 1,
    r: 0,
    model: "teal",
    state: "idle",
    name: "Accessibility review",
    task: "Ready for another task.",
  },
  {
    project: "infra",
    q: -1,
    r: 0,
    model: "blue",
    state: "running",
    name: "Deployment pipeline",
    task: "Checking the deployment configuration.",
  },
  {
    project: "infra",
    q: 1,
    r: 0,
    model: "violet",
    state: "idle",
    name: "Host configuration",
    task: "Ready for another task.",
  },
];
export const workspaces: Entity[] = specs.map((s, i) => {
  const p = projects.find((p) => p.id === s.project)!;
  return {
    id: `workspace-${i + 1}`,
    kind: "workspace",
    name: s.name,
    host: p.host,
    project: p.id,
    position: { q: p.position.q + s.q - 1, r: p.position.r + 3 },
    art: i % 3 === 1 ? "cottage-brown" : "cottage-slate",
    number: String(i + 1).padStart(2, "0"),
  };
});
export const agents: Entity[] = specs.map((s, i) => ({
  ...workspaces[i]!,
  id: `agent-${i + 1}`,
  kind: "agent",
  name: s.name,
  workspace: workspaces[i]!.id,
  art: `robot-${s.model}`,
  state: s.state,
  model: s.model,
  task: s.task,
}));
export const hosts: Entity[] = [
  {
    id: "local",
    kind: "host",
    name: "LOCAL",
    host: "local",
    position: { q: 0, r: -6 },
    art: "manor",
  },
  {
    id: "macmini",
    kind: "host",
    name: "MACMINI",
    host: "macmini",
    position: { q: 7, r: 1 },
    art: "observatory",
  },
];
export const entities = [...hosts, ...projects, ...workspaces, ...agents];
export const point = ({ q, r }: Axial) => ({
  x: HEX_RADIUS * Math.sqrt(3) * (q + r / 2),
  y: HEX_RADIUS * 1.5 * r,
});
export const cellKey = (a: Axial) => `${a.q},${a.r}`;
export const distance = (a: Axial, b: Axial) =>
  Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(a.q + a.r - b.q - b.r),
  );
export const seedOf = (key: string) => {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
};
export function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
export function landCells(host: string): Axial[] {
  const occupied = new Map<string, Axial>();
  const hostProjects = projects.filter((p) => p.host === host);
  for (const p of hostProjects) {
    // A common lattice with breathing room around each landmark and its workspaces.
    const center = { q: p.position.q, r: p.position.r + 1 };
    const radius = host === "local" ? 3 : 2;
    for (let q = -radius; q <= radius; q++)
      for (let r = -radius; r <= radius; r++)
        if (distance({ q, r }, { q: 0, r: 0 }) <= radius) {
          const a = { q: center.q + q, r: center.r + r };
          occupied.set(cellKey(a), a);
        }
  }
  return [...occupied.values()];
}

/** World structures own whole cells on the same lattice as the land. */
export function footprint(entity: Entity): Axial[] {
  const center = entity.position;
  const offsets =
    entity.kind === "project"
      ? [
          { q: 0, r: 0 },
          { q: 1, r: 0 },
          { q: 1, r: -1 },
          { q: 0, r: -1 },
          { q: -1, r: 0 },
          { q: -1, r: 1 },
          { q: 0, r: 1 },
        ]
      : [{ q: 0, r: 0 }];
  return offsets.map((offset) => ({
    q: center.q + offset.q,
    r: center.r + offset.r,
  }));
}
export function insideFootprint(x: number, y: number, cells: Axial[]): boolean {
  return cells.some((cell) => {
    const center = point(cell),
      dx = Math.abs(x - center.x),
      dy = Math.abs(y - center.y);
    return (
      dx <= (HEX_RADIUS * Math.sqrt(3)) / 2 + 0.001 &&
      dy + dx / Math.sqrt(3) <= HEX_RADIUS + 0.001
    );
  });
}
/** Includes the full sprite rectangle, rather than relying on a visual overlap. */
export function fittedWidth(
  x: number,
  y: number,
  aspect: number,
  maximum: number,
  cells: Axial[],
): number {
  const fits = (width: number) => {
    const halfW = width / 2 + 3,
      halfH = width / aspect / 2 + 3;
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      if (
        !insideFootprint(x - halfW + 2 * halfW * t, y - halfH, cells) ||
        !insideFootprint(x - halfW + 2 * halfW * t, y + halfH, cells) ||
        !insideFootprint(x - halfW, y - halfH + 2 * halfH * t, cells) ||
        !insideFootprint(x + halfW, y - halfH + 2 * halfH * t, cells)
      )
        return false;
    }
    return true;
  };
  let low = 0,
    high = maximum;
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
}

export function landBounds() {
  const centers = ["local", "macmini"].flatMap((host) =>
    landCells(host).map(point),
  );
  const halfWidth = (HEX_RADIUS * Math.sqrt(3)) / 2;
  const left = Math.min(...centers.map((p) => p.x)) - halfWidth;
  const right = Math.max(...centers.map((p) => p.x)) + halfWidth;
  const top = Math.min(...centers.map((p) => p.y)) - HEX_RADIUS;
  const bottom = Math.max(...centers.map((p) => p.y)) + HEX_RADIUS;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
/** Undirected exposed edges, shared by paving, selection and placement diagnostics. */
export function footprintEdges(cells: Axial[]) {
  const result = new Map<
    string,
    { a: { x: number; y: number }; b: { x: number; y: number } }
  >();
  const key = (p: { x: number; y: number }) =>
    `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
  for (const cell of cells) {
    const c = point(cell);
    const v = Array.from({ length: 6 }, (_, i) => ({
      x: c.x + Math.cos((i * Math.PI) / 3 - Math.PI / 2) * HEX_RADIUS,
      y: c.y + Math.sin((i * Math.PI) / 3 - Math.PI / 2) * HEX_RADIUS,
    }));
    for (let i = 0; i < 6; i++) {
      const a = v[i]!,
        b = v[(i + 1) % 6]!,
        id = [key(a), key(b)].sort().join(":");
      if (result.has(id)) result.delete(id);
      else result.set(id, { a, b });
    }
  }
  return [...result.values()];
}
