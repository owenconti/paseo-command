/** Galaxy vocabulary and its deterministic layout, built from the same
 * host-qualified fleet description as the Atlas. It never talks to a daemon. */
import {
  campKey,
  modelName,
  random,
  seedOf,
  tileState,
  type AtlasData,
  type Entity,
  type State,
} from "../world.ts";

export type Family =
  | "ocean"
  | "forest"
  | "desert"
  | "volcanic"
  | "ice"
  | "ringedgas"
  | "barren"
  | "storm";
export const FAMILIES: Family[] = [
  "ocean",
  "forest",
  "desert",
  "volcanic",
  "ice",
  "ringedgas",
  "barren",
  "storm",
];
/** Families drawn with a tilted ring around them. */
export const RINGED = new Set<Family>(["ringedgas", "storm"]);

/** Provider colours, as the original Galaxy shows them. Gold and red stay
 * reserved for waiting, approval and failure. */
const PROVIDERS: Record<string, number> = {
  claude: 0xda7454,
  codex: 0x35c48f,
  openai: 0x35c48f,
  gemini: 0x4f8bff,
  copilot: 0xb07cff,
  opencode: 0xf06bb4,
  cursor: 0xc9ced8,
  grok: 0xd6b47e,
  kimi: 0x9be15d,
  zai: 0xff7a8a,
  minimax: 0x8c9bff,
  pi: 0xe8e07a,
};
const SPARE = [0xd6b47e, 0x9be15d, 0xff7a8a, 0x8c9bff, 0xe8e07a];
export function providerOf(model: string): string {
  const slash = model.indexOf("/");
  return (slash > 0 ? model.slice(0, slash) : model).trim().toLowerCase();
}
export function providerColor(model: string): number {
  const p = providerOf(model);
  if (!p) return 0x9aa4b0;
  return PROVIDERS[p] ?? SPARE[seedOf(p) % SPARE.length]!;
}

/** Nebula tints for host regions, in order: ochre, steel blue, warm umber, teal, deep blue, wine. */
export const REGION_TINTS = [0x9a4f22, 0x2f5a9a, 0x6e4a32, 0x1f6a6a, 0x26357a, 0x6a2a3e];

export type Planet = {
  /** The project's key, or a host-level key for workspaces without a project. */
  id: string;
  host: string;
  name: string;
  x: number;
  y: number;
  r: number;
  family: Family;
  /** Ring tilt in degrees, for ringed families. */
  tilt: number;
  /** An unnamed body that only carries a host's unfiled workspaces. */
  decorative: boolean;
  stale: boolean;
  /** Counts shown under the name. */
  caption: string;
};
export type Station = {
  id: string;
  host: string;
  planet: string;
  name: string;
  orbit: number;
  angle: number;
  /** Stations with a working agent travel along their orbit. */
  moving: boolean;
  /** Agents the daemon reports without a workspace: no station is drawn. */
  camp: boolean;
  stale: boolean;
  /** The most urgent state among its agents, if any. */
  state?: State;
};
export type Satellite = {
  id: string;
  host: string;
  station: string;
  planet: string;
  name: string;
  model: string;
  modelName: string;
  color: number;
  state: State;
  subagents: number;
  slot: number;
};
export type Region = {
  host: string;
  name: string;
  online: boolean;
  tint: number;
  /** Bodies inside the region: centre and radius. */
  blobs: { x: number; y: number; r: number }[];
  /** Where the host's name stands: the middle of its systems. */
  label: { x: number; y: number };
  bounds: { x: number; y: number; width: number; height: number };
};
export type Rock = { x: number; y: number; r: number; seed: number; host: string };
export type GalaxyLayout = {
  regions: Region[];
  planets: Planet[];
  stations: Station[];
  satellites: Satellite[];
  rocks: Rock[];
  entities: Entity[];
  bounds: { x: number; y: number; width: number; height: number };
  /** Changes whenever any body is added, removed, renamed or moved. */
  signature: string;
};

/** Radius of the formation a station keeps around itself for its satellites. */
export const FORMATION = 112;
const LABEL_WIDTH = 300;
const GAP = 30;
const byName = <T extends { name: string; key: string }>(a: T, b: T) =>
  a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "S"}`;

type System = {
  planet: Omit<Planet, "x" | "y">;
  stations: Omit<Station, "state">[];
  /** Bounding half-extents around the planet's centre, label included. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  x: number;
  y: number;
};

function systems(host: AtlasData["hosts"][number], data: AtlasData): System[] {
  const projects = data.projects.filter((p) => p.host === host.key).sort(byName);
  const known = new Set(projects.map((p) => p.key));
  const workspaces = data.workspaces.filter((w) => w.host === host.key).sort(byName);
  const wsKeys = new Set(workspaces.map((w) => w.key));
  const groups = new Map<string, { key: string; name: string; stale?: boolean; camp?: boolean }[]>(
    projects.map((p) => [p.key, []]),
  );
  const unfiledKey = `unfiled\u001f${host.key}`;
  const unfiled: { key: string; name: string; stale?: boolean; camp?: boolean }[] = [];
  const groupOf = (project?: string) => (project && known.has(project) ? groups.get(project)! : unfiled);
  for (const w of workspaces) groupOf(w.project).push(w);
  const homeless = data.agents.filter((a) => a.host === host.key && !(a.workspace && wsKeys.has(a.workspace)));
  for (const project of [...new Set(homeless.map((a) => a.project ?? ""))].sort()) {
    const owner = project && known.has(project) ? project : "";
    const key = campKey(host.key, owner);
    const group = groupOf(owner || undefined);
    if (!group.some((c) => c.key === key)) group.push({ key, name: "No workspace", camp: true });
  }
  const bodies = projects.map((p) => ({ key: p.key, name: p.name, stale: !!p.stale, decorative: false }));
  if (unfiled.length) bodies.push({ key: unfiledKey, name: "", stale: false, decorative: true });
  return bodies.map((body) => {
    const cottages = body.decorative ? unfiled : groups.get(body.key)!;
    const rng = random(seedOf(body.key + "planet"));
    const family = body.decorative ? "barren" : FAMILIES[seedOf(body.key) % FAMILIES.length]!;
    const r = body.decorative ? 34 : Math.min(150, 74 + rng() * 30 + cottages.length * 9);
    const ringed = RINGED.has(family);
    const orbit = (ringed ? r * 1.8 : r) + 70;
    // Stations start in the gaps either side of due east, where the name stands.
    const angle0 = Math.PI / Math.max(1, cottages.length) + (rng() - 0.5) * 0.2;
    const stations = cottages.map((c, i) => ({
      id: c.key,
      host: host.key,
      planet: body.key,
      name: c.name,
      orbit: orbit + (i % 2) * 44,
      angle: angle0 + (i * Math.PI * 2) / Math.max(1, cottages.length),
      moving: false,
      camp: !!c.camp,
      stale: !!c.stale,
    }));
    const reach = stations.length ? orbit + 44 + FORMATION + 24 : ringed ? r * 1.85 : r * 1.2;
    return {
      planet: {
        id: body.key,
        host: host.key,
        name: body.name,
        r,
        family,
        tilt: -18 + rng() * 14,
        decorative: body.decorative,
        stale: body.stale,
        caption: "",
      },
      stations,
      left: reach,
      // The name stands clear of every orbit, to the right.
      right: reach + LABEL_WIDTH,
      // Orbits are seen at an angle: flattened vertically.
      top: stations.length ? (orbit + 44) * 0.62 + FORMATION + 30 : reach,
      bottom: stations.length ? (orbit + 44) * 0.62 + FORMATION + 30 : reach,
      x: 0,
      y: 0,
    };
  });
}

const overlaps = (a: System, b: System, gap: number) =>
  a.x - a.left - gap < b.x + b.right &&
  a.x + a.right + gap > b.x - b.left &&
  a.y - a.top - gap < b.y + b.bottom &&
  a.y + a.bottom + gap > b.y - b.top;

/** The host's name stands at the centre of its region. */
export const HOST_FONT = 84;
const centreBox = (name: string, online: boolean): System => {
  const width = (name.length + (online ? 0 : 10)) * HOST_FONT * 0.5 + 80;
  return {
    planet: { id: "", host: "", name: "", r: 0, family: "barren", tilt: 0, decorative: true, stale: false, caption: "" },
    stations: [],
    left: width / 2,
    right: width / 2,
    top: HOST_FONT,
    bottom: HOST_FONT,
    x: 0,
    y: 0,
  };
};
/** Rings of planetary systems around the host's name: up to eight per ring,
 * evenly spaced, each ring pushed out until nothing overlaps. */
function ring(list: System[], centre: System, seed: string) {
  const order = [...list].sort((a, b) => a.planet.name.localeCompare(b.planet.name) || a.planet.id.localeCompare(b.planet.id));
  const placed: System[] = [centre];
  const turn = random(seedOf(seed))() * Math.PI * 2;
  const PER_RING = 8;
  for (let start = 0, k = 0; start < order.length; start += PER_RING, k++) {
    const batch = order.slice(start, start + PER_RING);
    const offset = turn + k * 0.4;
    // Wide maps of systems sit on a slightly flattened ellipse.
    for (let radius = 260; ; radius += 24) {
      batch.forEach((s, i) => {
        const a = offset + (i * Math.PI * 2) / batch.length;
        s.x = Math.cos(a) * radius * 1.15 - (s.right - s.left) / 2;
        s.y = Math.sin(a) * radius * 0.9;
      });
      const clear = batch.every(
        (s, i) => placed.every((p) => !overlaps(s, p, GAP)) && batch.every((o, j) => j === i || !overlaps(s, o, GAP)),
      );
      if (clear) break;
    }
    placed.push(...batch);
  }
}
const extent = (list: System[]) => ({
  minX: Math.min(...list.map((s) => s.x - s.left)),
  maxX: Math.max(...list.map((s) => s.x + s.right)),
  minY: Math.min(...list.map((s) => s.y - s.top)),
  maxY: Math.max(...list.map((s) => s.y + s.bottom)),
});

/** Hosts are nebula regions, shelf-packed to suit the viewport's shape. */
export function layoutGalaxy(data: AtlasData, aspect = 1.6): GalaxyLayout {
  const hosts = [...data.hosts].sort((a, b) => Number(b.local) - Number(a.local) || byName(a, b));
  const target = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  const groups = hosts.map((host) => {
    const list = systems(host, data);
    if (!list.length)
      list.push({
        planet: { id: `empty\u001f${host.key}`, host: host.key, name: "", r: 30, family: "barren", tilt: 0, decorative: true, stale: false, caption: "" },
        stations: [],
        left: 40,
        right: 40,
        top: 40,
        bottom: 40,
        x: 0,
        y: 0,
      });
    const centre = centreBox(host.name, host.online);
    ring(list, centre, host.key);
    const e = extent([...list, centre]);
    return { host, list, width: e.maxX - e.minX + 240, height: e.maxY - e.minY + 240, e };
  });
  const HOST_GAP = 260;
  let best: { moves: { x: number; y: number }[]; score: number } | null = null;
  const total = groups.reduce((sum, g) => sum + g.width + HOST_GAP, 0);
  const widest = Math.max(...groups.map((g) => g.width));
  for (let k = 0; k <= 8; k++) {
    const capacity = widest + ((total - widest) * k) / 8;
    const moves: { x: number; y: number }[] = [];
    let x = 0,
      y = 0,
      rowHeight = 0,
      maxX = 0;
    for (const g of groups) {
      if (x > 0 && x + g.width > capacity + 1) {
        x = 0;
        y += rowHeight + HOST_GAP;
        rowHeight = 0;
      }
      moves.push({ x, y });
      x += g.width + HOST_GAP;
      maxX = Math.max(maxX, x - HOST_GAP);
      rowHeight = Math.max(rowHeight, g.height);
    }
    const height = y + rowHeight;
    const score = Math.abs(Math.log(maxX / height / target));
    if (!best || score < best.score - 1e-9) best = { moves, score };
  }
  const regions: Region[] = [];
  const planets: Planet[] = [];
  const stations: Station[] = [];
  const satellites: Satellite[] = [];
  const rocks: Rock[] = [];
  const stationById = new Map<string, Station>();
  groups.forEach((g, i) => {
    const move = best!.moves[i]!;
    const dx = move.x + 120 - g.e.minX,
      dy = move.y + 120 - g.e.minY;
    const blobs: Region["blobs"] = [];
    const label = { x: dx, y: dy };
    for (const s of g.list) {
      const planet = { ...s.planet, x: s.x + dx, y: s.y + dy };
      planets.push(planet);
      blobs.push({ x: planet.x + (s.right - s.left) / 2, y: planet.y, r: Math.max(s.left, s.top) + 160 });
      for (const st of s.stations) {
        const station: Station = { ...st };
        stations.push(station);
        stationById.set(station.id, station);
      }
    }
    regions.push({
      host: g.host.key,
      name: g.host.name,
      online: g.host.online,
      tint: REGION_TINTS[i % REGION_TINTS.length]!,
      blobs,
      label,
      bounds: { x: move.x, y: move.y, width: g.width, height: g.height },
    });
    // Decorative rocks drift in the region's open space; they carry no identity.
    const rng = random(seedOf(g.host.key + "rocks"));
    const own = planets.filter((p) => p.host === g.host.key);
    for (let n = 0; n < 40 && rocks.filter((r) => r.host === g.host.key).length < 6 + own.length; n++) {
      const x = move.x + rng() * g.width,
        y = move.y + rng() * g.height,
        r = 5 + rng() * 9;
      const clear = own.every((p) => Math.hypot(p.x - x, p.y - y) > p.r + 170);
      if (clear) rocks.push({ x, y, r, seed: Math.floor(rng() * 1e9), host: g.host.key });
    }
  });
  const online = new Map(hosts.map((h) => [h.key, h.online]));
  const counts = new Map<string, number>();
  for (const a of [...data.agents].sort(byName)) {
    if (!online.has(a.host)) continue;
    const home =
      (a.workspace && stationById.get(a.workspace)) ||
      stationById.get(campKey(a.host, a.project ?? "")) ||
      stationById.get(campKey(a.host, ""));
    if (!home) continue;
    const slot = counts.get(home.id) ?? 0;
    counts.set(home.id, slot + 1);
    satellites.push({
      id: a.key,
      host: a.host,
      station: home.id,
      planet: home.planet,
      name: a.name,
      model: providerOf(a.model),
      modelName: modelName(a.model),
      color: providerColor(a.model),
      state: online.get(a.host) ? a.state : "offline",
      subagents: a.subagents ?? 0,
      slot,
    });
  }
  for (const st of stations) {
    const own = satellites.filter((s) => s.station === st.id);
    st.state = tileState(own.map((s) => s.state));
    st.moving = own.some((s) => s.state === "running");
  }
  for (const p of planets) {
    const own = satellites.filter((s) => s.planet === p.id);
    const ws = stations.filter((s) => s.planet === p.id && !s.camp).length;
    const need = own.filter((s) => ["approval", "question", "failed"].includes(s.state)).length;
    const done = own.filter((s) => s.state === "done").length;
    const running = own.filter((s) => s.state === "running").length;
    const subs = own.reduce((sum, s) => sum + s.subagents, 0);
    const parts: string[] = [];
    if (need) parts.push(`${need} NEED${need === 1 ? "S" : ""} YOU`);
    if (running) parts.push(`${running} RUNNING`);
    if (subs) parts.push(plural(subs, "SUBAGENT"));
    if (done) parts.push(`${done} UNREAD`);
    p.caption = parts.length ? parts.join(" · ") : plural(ws, "WORKSPACE");
  }
  const entity = (e: Partial<Entity> & Pick<Entity, "id" | "kind" | "name" | "host">): Entity => ({
    position: { q: 0, r: 0 },
    ...e,
  });
  const entities: Entity[] = [
    ...regions.map((r) => entity({ id: r.host, kind: "host", name: r.name, host: r.host, stale: !r.online })),
    ...planets
      .filter((p) => !p.decorative)
      .map((p) => entity({ id: p.id, kind: "project", name: p.name, host: p.host, stale: p.stale })),
    ...stations.map((s) =>
      entity({
        id: s.id,
        kind: "workspace",
        name: s.name,
        host: s.host,
        project: s.planet,
        camp: s.camp,
        stale: s.stale,
      }),
    ),
    ...satellites.map((s) =>
      entity({
        id: s.id,
        kind: "agent",
        name: s.name,
        host: s.host,
        project: s.planet,
        workspace: s.station,
        state: s.state,
        modelName: s.modelName,
        subagents: s.subagents,
      }),
    ),
  ];
  const minX = Math.min(...regions.map((r) => r.bounds.x)),
    minY = Math.min(...regions.map((r) => r.bounds.y)),
    maxX = Math.max(...regions.map((r) => r.bounds.x + r.bounds.width)),
    maxY = Math.max(...regions.map((r) => r.bounds.y + r.bounds.height));
  const signature = JSON.stringify([
    regions.map((r) => [r.host, r.name, r.online, Math.round(r.bounds.x), Math.round(r.bounds.y)]),
    planets.map((p) => [p.id, p.name, Math.round(p.x), Math.round(p.y), Math.round(p.r)]),
    stations.map((s) => [s.id, s.name]),
  ]);
  return {
    regions,
    planets,
    stations,
    satellites,
    rocks,
    entities,
    bounds: regions.length ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: 800, height: 600 },
    signature,
  };
}
