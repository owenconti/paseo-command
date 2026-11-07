/**
 * The Dungeon Board's deterministic layout: a front cutaway of a dungeon, one
 * floor per host (stacked in the Atlas's host order), its gate in the middle
 * (its round surround, plaque, gold node, portcullis, stairs down to the next floor),
 * its projects alternating left and right of the gate, outward from it, each
 * a terrace with a pair of wall candles (no icon or label: its name is on the hover card, as on the Islands)
 * over its workspaces' candle-lit alcoves in a row beneath, and the agents' robots on each alcove's front ledge.
 * Gold links run from the host's node to each project and workspace. A side
 * with more projects than fit wraps onto further tiers within its floor; the
 * gate stays central and the tiers are chosen to fit the map's aspect.
 * Decorations are seeded per host and never cover what the board says.
 *
 * Units are the concept's pixels (y down, x = 0 down the gates). Pure: no DOM.
 */
import {
  agentEntity,
  hostGroups,
  modelColor,
  random,
  seedOf,
  sortedHosts,
  tileState,
  type AtlasData,
  type Cottage,
  type Entity,
  type State,
} from "../world.ts";
import { BEACON_STATES } from "../placement.ts";
import { probeGlyph } from "../probe.ts";
import { FRAMES, anchorShare, type Icon, ICONS } from "./frames.ts";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Board geometry, in the concept's pixels (measured from its LOCAL floor). */
export const D = {
  /** Robots: their visible size, and the pitch they stand at. */
  robot: 47,
  robotH: 55,
  slot: 50,
  /** An alcove's room either side of its robots; at least this many robots' room. */
  alcoveEnd: 38,
  /** Its stone sides (the frame's width). */
  alcoveSide: 17,
  minSlots: 2,
  alcoveGap: 12,
  projectGap: 22,
  /** Side content starts this far from the gates' centre line; the first tier's link drops at `drop`,
   * lower tiers' run down at `trunk`, beside the stairs. */
  inner: 80,
  drop: 150,
  trunk: 70,
  /** Each end of a floor is a side room this wide. */
  sideRoom: 160,
  /** A side's content is at least this wide, so a small fleet still reads as the concept's hall. */
  minSide: 210,
  /** Floor: its upper band (gate medallion, plaque, node) above its first tier. */
  band: 116,
  tierH: 244,
  tierGap: 0,
  /** The stone ledge's face under a tier's floor. */
  ledge: 28,
  /** Below the last floor: the stairs' foot, braziers, rugs and the crown banner. */
  foot: 92,
  /** Below the foot's furnishings, room the HUD's count bar lies over (nothing the board says is under it). */
  footPad: 82,
  /** Within a tier (from its top). */
  /** A project's mark: no icon or label (names are on the hover cards, as on the Islands): its terrace and the pair
   * of wall candles flanking this point, `markR` either side, which is also where its alarm glows. */
  markY: 32,
  markR: 29,
  busY: 76,
  alcoveY: 86,
  alcoveH: 128,
  /** Where the PR medallions sit on the alcove's lintel (below its top). */
  lintelY: 13,
  feetY: 201,
  floorY: 214,
  /** The thick front wall closing each tier (its top). */
  frontY: 230,
  /** The wall above the first floor, which the HUD's title lies over. */
  topBand: 64,
  /** Within a floor (from its top). */
  gateMedallionY: 48,
  gateMedallionR: 24,
  /** The gate's big round surround, from just above the floor's top. */
  surroundY: -5,
  surroundW: 333,
  surroundH: 229,
  /** The host's sign: a wooden board hanging on chains (the box includes them) between the surround's upper opening
   * and the gate's arch, its name and load painted on it. */
  plaqueY: 52,
  plaqueH: 99,
  plaqueMin: 316,
  nodeY: 158,
  portcullisY: 176,
  portcullisW: 85,
  portcullisH: 83,
  archY: 158,
  archW: 145,
  archH: 121,
  stairsY: 235,
  stairsW: 120,
  /** Type (board px): the host sign's painted name and stats line (projects and workspaces carry no labels). */
  font: { host: 32, stats: 18 },
  /** A PR medallion on an alcove's lintel. */
  flag: 18,
  flagInset: 16,
};

export type TextKind = keyof typeof D.font;
/** Text width in board px for a kind's type; the bridge measures with the real font. */
export type Measure = (text: string, kind: TextKind) => number;
export const approxMeasure: Measure = (text, kind) => text.length * D.font[kind] * (kind === "stats" ? 0.58 : 0.56);

export type DFloor = {
  host: Entity;
  online: boolean;
  top: number;
  height: number;
  tiers: number;
  /** The whole floor, end to end. */
  rect: Rect;
  medallion: Pt;
  /** Its sign (chains included). */
  plaque: Rect;
  /** The host's name and whether it's offline, as one string (for the signature and checks). */
  title: string;
  /** The name painted on the sign (in capitals, as the Atlas's banners name hosts). */
  name: string;
  stats: { text: string; alert: boolean }[];
  node: Pt;
  portcullis: Rect;
  /** Stairs from the gate down to the next floor (or the foot). */
  stairs: Rect;
  arch: Rect;
  /** The big round arch round the plaque, the host's icon in its top. */
  surround: Rect;
  piers: Rect[];
  /** Each tier's top. */
  tierTops: number[];
  last: boolean;
};
export type DProject = {
  key: string;
  host: string;
  entity?: Entity;
  name: string;
  side: -1 | 1;
  tier: number;
  floor: number;
  /** Its whole span on its tier. */
  span: Rect;
  /** The middle of its terrace's back wall, between its candles: where its alarm glows. */
  mark: Pt;
  /** Its junction on the tier's bus, from which links drop to its alcoves. */
  node: Pt;
  /** Its two torches, lit while any of its agents runs (top centre). */
  torches: Pt[];
  /** Its terrace's back wall, above its alcoves: its pick box and the hover and selection rims' box. */
  rect: Rect;
  stale: boolean;
};
export type DFlag = { workspace: string; flag: string; frame: string; x: number; y: number; size: number };
export type DWorkspace = {
  entity: Entity;
  project: string;
  floor: number;
  rect: Rect;
  node: Pt;
  slots: number;
  /** Interior variant per slot (alcove-slot-<n>). */
  interiors: number[];
  candles: Pt[];
  flags: DFlag[];
  seal?: { x: number; y: number; size: number };
  /** Agents' keys, oldest first. */
  agents: string[];
};
export type DAgent = {
  entity: Entity;
  feet: Pt;
  rect: Rect;
  floor: number;
  /** Its robot's colour on the robots sheet: Claude's orange, ChatGPT's white, any other provider its own. */
  robot: string;
  /** Its running subagents' drones' colours, oldest first (its own where a model isn't known). */
  drones: string[];
};
export type DDecor = {
  /** A frame, or an animation's base name. */
  frame: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rect: Rect;
  floor: number;
  flip?: boolean;
  /** A light it gives (torches, braziers, candles, the forge, crystal, tank, circle); `dy` from its top, else its middle. */
  light?: { color: number; reach: number; dy?: number };
  /** Lit with its project's work, rather than always. */
  project?: string;
  /** Drawn behind the board's structures (floor props, rugs) or in front. */
  layer: "back" | "front";
  /** A side room's recess, which its vignette's props stand in. */
  recess?: boolean;
  /** The vignette it belongs to (its props may overlap one another). */
  group?: string;
};
export type DungeonLayout = {
  /** The board, end to end and top to bottom (without the HUD, which keeps screen size). */
  bounds: Rect;
  floors: DFloor[];
  projects: DProject[];
  workspaces: DWorkspace[];
  agents: DAgent[];
  /** Gold links, as polylines, and the round nodes at their joints. */
  links: Pt[][];
  nodes: Pt[];
  /** From each workspace's host node along the links to it: light runs this way to working agents. */
  runs: Record<string, Pt[]>;
  decor: DDecor[];
  /** The wall above the first floor. */
  topBand: { rect: Rect; piers: Rect[] };
  entities: Entity[];
  counts: { hosts: number; projects: number; workspaces: number; agents: number };
  /** Changes whenever anything's place changes. */
  signature: string;
};

const ICON_WORDS: [RegExp, Icon][] = [
  [/tool|kit|build|package|module/i, "cube"],
  [/core|api|code|dev|cli|sdk|lib/i, "code"],
  [/platform|infra|stack|layer/i, "layers"],
  [/growth|analytic|metric|stat|chart|insight/i, "chart"],
  [/experiment|lab|test|research|ab-/i, "flask"],
  [/customer|user|account|people|team|support/i, "person"],
  [/web|site|www|globe|cloud/i, "globe"],
  [/doc|book|wiki|guide|blog/i, "book"],
  [/term|shell|ops|script/i, "terminal"],
  [/data|db|sql|store|warehouse/i, "database"],
  [/launch|deploy|release|ship|rocket/i, "rocket"],
  [/sec|auth|guard|shield/i, "shield"],
  [/perf|fast|event|stream|bolt/i, "bolt"],
  [/green|eco|garden|plant/i, "leaf"],
  [/game|castle|world|atlas|dungeon/i, "castle"],
  [/config|setting|gear|engine/i, "gear"],
];
/** A project's medallion icon: from its name's words, else a stable pick. */
export function projectIcon(name: string, key: string): Icon {
  return ICON_WORDS.find(([re]) => re.test(name))?.[1] ?? ICONS[seedOf(key) % ICONS.length]!;
}

export const STATE_GLOW: Record<State, string> = {
  running: "glow-running",
  idle: "glow-idle",
  done: "glow-done",
  approval: "glow-approval",
  question: "glow-question",
  asking: "glow-asking",
  failed: "glow-failure",
  offline: "glow-offline",
};
/** The marker over a robot's head, for the states that need you (and running's gear). */
export const STATE_MARK: Partial<Record<State, string>> = {
  approval: "mark-approval",
  question: "mark-question",
  asking: "mark-asking",
  failed: "mark-failure",
  done: "mark-done",
};
/** Other providers' robot colours (the sheet has more than the Atlas's palette). */
const OTHER_ROBOTS = ["blue", "purple", "green", "yellow", "red", "grey", "teal", "pink"];
/** A robot's colour for its provider/model: Claude orange, ChatGPT white, and any other
 * provider a stable colour of its own (by the provider's name, so its models share it). */
export function robotColor(model: string): string {
  const atlas = modelColor(model);
  if (atlas === "orange" || atlas === "white") return atlas;
  const provider = (model.split("/")[0] || model).toLowerCase();
  return OTHER_ROBOTS[seedOf(provider) % OTHER_ROBOTS.length]!;
}
/** Robot sheet colours for the Atlas's model colours (drones whose model isn't known). */
export const ROBOT_OF: Record<string, string> = {
  orange: "orange",
  white: "white",
  teal: "teal",
  violet: "purple",
  lime: "green",
  blue: "blue",
};

type Alcove = { cottage: Cottage; width: number; slots: number };
type Block = {
  key: string;
  project?: AtlasData["projects"][number];
  alcoves: Alcove[];
  /** In outward units from its inner edge. */
  width: number;
  labelW: number;
  labelC: number;
  /** Each alcove's start, outward from the inner edge, in outward order. */
  starts: number[];
};


function block(group: ReturnType<typeof hostGroups>[number], side: -1 | 1, measure: Measure): Block {
  const alcoves = group.cottages.map((cottage): Alcove => {
    const slots = Math.max(D.minSlots, cottage.agents.length);
    const width = 2 * D.alcoveEnd + slots * D.slot;
    return { cottage, width, slots };
  });
  // Reading left to right, oldest first: on the left side the outward order is reversed.
  const outward = side === 1 ? alcoves : [...alcoves].reverse();
  const starts: number[] = [];
  let at = 0;
  for (const a of outward) {
    starts.push(at);
    at += a.width + D.alcoveGap;
  }
  const end = at - D.alcoveGap;
  // The mark (a wall candle either side of it) keeps clear of the first tier's link, which drops at `drop` from the
  // gates' line.
  void measure;
  const labelW = D.markR * 2 + 64;
  const torchRoom = 8;
  const labelC = Math.max(end / 2, D.drop - D.inner + 34 + labelW / 2, labelW / 2 + torchRoom);
  const width = Math.max(end, labelC + labelW / 2 + torchRoom);
  return { key: group.key, project: group.project, alcoves: outward, width, labelW, labelC, starts };
}

type Tiered = { left: Block[][]; right: Block[][]; tiers: number; side: number; sideL: number; sideR: number };
function tierUp(blocks: Block[], capacity: number): Tiered {
  const sides: [Block[], Block[]] = [[], []];
  blocks.forEach((b, i) => sides[i % 2]!.push(b));
  const pack = (list: Block[]) => {
    const rows: Block[][] = [];
    let width = Infinity;
    for (const b of list) {
      if (rows.length && width + D.projectGap + b.width <= capacity) {
        rows[rows.length - 1]!.push(b);
        width += D.projectGap + b.width;
      } else {
        rows.push([b]);
        width = b.width;
      }
    }
    return rows;
  };
  const left = pack(sides[0]),
    right = pack(sides[1]);
  const widthOf = (row: Block[]) => row.reduce((s, b) => s + b.width, 0) + D.projectGap * Math.max(0, row.length - 1);
  const sideL = Math.max(D.minSide, ...left.map(widthOf)), sideR = Math.max(D.minSide, ...right.map(widthOf));
  return { left, right, tiers: Math.max(1, left.length, right.length), side: Math.max(sideL, sideR), sideL, sideR };
}

const floorHeight = (tiers: number, last: boolean) =>
  D.band + tiers * D.tierH + (tiers - 1) * D.tierGap + (last ? D.foot + D.footPad : 0);

function rectOf(frame: string, x: number, y: number, w?: number): { w: number; h: number; rect: Rect } {
  const base = FRAMES[frame] ?? FRAMES[`${frame}-0`]!;
  const width = w ?? base.w;
  const h = (base.h * width) / base.w;
  const a = anchorShare(base.anchor);
  return { w: width, h, rect: { x: x - a.x * width, y: y - a.y * h, w: width, h } };
}

export const overlaps = (a: Rect, b: Rect, pad = 0) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const pad = (r: Rect, p: number): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
/** A link segment's box, with room for its glow. */
export function segmentRect(a: Pt, b: Pt, glow = 4): Rect {
  return { x: Math.min(a.x, b.x) - glow, y: Math.min(a.y, b.y) - glow, w: Math.abs(a.x - b.x) + 2 * glow, h: Math.abs(a.y - b.y) + 2 * glow };
}

/** Side-room vignettes: props standing on a room's floor, by offset from its middle. */
/** Side-room vignettes: a recess (130 × 200, standing on the tier's floor) and its props, each at its sheet size,
 * placed by its top-left corner from the recess's, as the art's own room compositions place them. */
/** Side-room vignettes: a recess (130 × 200, on the tier's floor) and the props that inhabit it, each by its
 * height (the main one about two thirds of the recess's), its centre's offset from the recess's middle (mirrored
 * on the right) and how far above the floor its feet stand; companions within an object's width of it. */
const VIGNETTES: { name: string; room: string; glow?: { color: number; reach: number; dy: number }; props: { frame: string; h: number; dx: number; up?: number; light?: { color: number; reach: number } }[] }[] = [
  { name: "library", room: "room-arch", props: [{ frame: "bookcase-ladder", h: 136, dx: 6 }, { frame: "table", h: 32, dx: -46 }, { frame: "candelabra", h: 34, dx: -46, up: 26, light: { color: 0xffb040, reach: 46 } }] },
  { name: "crystal", room: "room-cave", glow: { color: 0xb06bff, reach: 120, dy: 140 }, props: [{ frame: "crystal", h: 104, dx: 4, light: { color: 0xc080ff, reach: 90 } }, { frame: "barrel", h: 40, dx: -50 }] },
  { name: "magic", room: "room-magic", glow: { color: 0x3fb8ff, reach: 120, dy: 100 }, props: [{ frame: "magic-circle", h: 100, dx: -10, up: 22 }, { frame: "armor", h: 94, dx: 42 }] },
  { name: "forge", room: "room-forge", glow: { color: 0xff7a2a, reach: 110, dy: 150 }, props: [
    { frame: "forge", h: 124, dx: 10, light: { color: 0xff9a3a, reach: 50 } }, { frame: "anvil", h: 44, dx: -40 },
    { frame: "shelf-potions", h: 58, dx: -48, up: 64 }, { frame: "table", h: 30, dx: 56 }, { frame: "candelabra", h: 30, dx: 56, up: 24, light: { color: 0xffb040, reach: 40 } } ] },
  { name: "alchemy", room: "room-arch", glow: { color: 0xc06bff, reach: 100, dy: 140 }, props: [{ frame: "alchemy-tank", h: 122, dx: 2 }, { frame: "crate", h: 38, dx: -52 }] },
  // A storeroom: armour standing at the back, barrels and crates before it, a shelf up the wall, so the arch never reads empty.
  { name: "storage", room: "room-arch", props: [{ frame: "armor", h: 98, dx: -4 }, { frame: "shelf-potions", h: 44, dx: 32, up: 96 }, { frame: "barrels", h: 54, dx: -32 }, { frame: "crates", h: 58, dx: 34 }, { frame: "candelabra", h: 28, dx: 34, up: 52, light: { color: 0xffb040, reach: 40 } }] },
];
/** Themed banners, over the end rooms. */
/** The wall banners: plain cloth, no icons (the user's call), in the old rhythm's colours. */
const THEMED = ["banner-navy-plain", "banner-blue-plain", "banner-purple-plain"];
const BANNERS = ["banner-purple-plain", "banner-purple-plain", "banner-navy-plain", "banner-blue-plain"];
const FLOOR_PROPS = ["barrel", "barrels", "crate", "crates", "shelf-potions", "table"];
/** Small things on the walkways and beside the side rooms, as the concept strews them. */
const CLUTTER = ["barrel", "crate", "candle", "barrel", "crate", "candle", "shelf-potions", "table"];
const TORCH_LIGHT = { color: 0xffa03a, reach: 56 };
/** A project's terrace wall (its pick box): its span inside the returns, from above its candles to just over the bus,
 * kept `clear` of the gate's line (the host's plaque). */
function terraceBox(span: Rect, y0: number, clear: number): Rect {
  let x0 = span.x + 24, x1 = span.x + span.w - 24;
  if (x0 < 0 && x1 > -clear) x1 = Math.min(x1, -clear);
  if (x1 > 0 && x0 < clear) x0 = Math.max(x0, clear);
  return { x: x0, y: y0 + 4, w: Math.max(0, x1 - x0), h: D.busY - 10 };
}

/** A side room's recess, in board units. */
const ROOM = { w: 130, h: 200 };

/**
 * Lay the fleet out as the Dungeon Board. Its width follows its content, not
 * the map's shape (`_aspect` is kept for the map styles' common call); `measure`
 * gives text widths (the bridge's real font; only the host plaques carry text).
 */
export function layoutDungeon(data: AtlasData, _aspect = 1.6, measure: Measure = approxMeasure): DungeonLayout {
  const planned = sortedHosts(data).map((host) => ({ host, groups: hostGroups(host, data) }));
  // Hosts without workspaces stay off the board, unless none has any: then each shows as an empty floor.
  const shown = planned.some((h) => h.groups.length) ? planned.filter((h) => h.groups.length) : planned;
  const blocksOf = shown.map((h) =>
    h.groups.map((g, i) => block(g, i % 2 === 0 ? -1 : 1, measure)),
  );
  // Each side wraps its projects onto tiers at a capacity; the one whose board best fits the map's shape wins.
  const widths = [...new Set(blocksOf.flat().map((b) => b.width))];
  const widest = Math.max(D.minSide, ...widths);
  const total = Math.max(widest, ...blocksOf.map((bs) => bs.reduce((s, b) => s + b.width + D.projectGap, 0)));
  const candidates = [...new Set([widest, ...blocksOf.flat().map((_, i, all) => all.slice(0, i + 1).reduce((s, b) => s + b.width + D.projectGap, 0))])]
    .filter((c) => c >= widest && c <= total)
    .sort((a, b) => a - b);
  if (!candidates.includes(total)) candidates.push(total);
  // Floors keep their natural width; a side wraps onto more tiers only while the board would be
  // far wider than tall (aiming for an aspect between 0.8 and 1.6), fewest tiers first.
  let best: { tiered: Tiered[]; score: number } | null = null;
  for (const capacity of [...candidates].reverse()) {
    const tiered = blocksOf.map((bs) => tierUp(bs, capacity));
    const side = Math.max(...tiered.map((t) => t.side));
    const width = 2 * (D.inner + side + D.sideRoom);
    const height = tiered.reduce((s, t, i) => s + floorHeight(t.tiers, i === tiered.length - 1), 0);
    const ratio = width / height;
    const score = ratio > 1.6 ? Math.log(ratio / 1.6) : ratio < 0.8 ? Math.log(0.8 / ratio) : 0;
    if (!best || score < best.score - 1e-9) best = { tiered, score };
    if (score === 0) break;
  }
  const tiered = best!.tiered;
  const side = Math.max(D.minSide, ...tiered.map((t) => t.side));
  const half = D.inner + side + D.sideRoom;

  const floors: DFloor[] = [];
  const projects: DProject[] = [];
  const workspaces: DWorkspace[] = [];
  const agents: DAgent[] = [];
  const links: Pt[][] = [];
  const nodes: Pt[] = [];
  const runs: Record<string, Pt[]> = {};
  const hostEntities: Entity[] = [];
  const agentRows = new Map(data.agents.map((a) => [a.key, a]));
  let top = D.topBand;
  shown.forEach(({ host }, f) => {
    const t = tiered[f]!;
    // Each floor is as wide as its own content and side rooms: a narrower floor than the widest steps in, the rock
    // round it dark, so the board's silhouette is excavated rather than a rectangle.
    const halfL = D.inner + t.sideL + D.sideRoom, halfR = D.inner + t.sideR + D.sideRoom;
    const sideHalf = (s: number) => (s === -1 ? halfL : halfR);
    const last = f === shown.length - 1;
    const height = floorHeight(t.tiers, last);
    // As the Atlas's banners name hosts: in capitals.
    const plaqueTitle = host.name.toUpperCase() + (host.online ? "" : " · OFFLINE");
    const stats = host.online && host.stats
      ? (
          [
            ["CPU", host.stats.cpu],
            ["MEM", host.stats.memory],
            ["DISK", host.stats.disk],
          ] as const
        ).flatMap(([n, v]) => (v === undefined ? [] : [{ text: `${n} ${Math.round(v)}%`, alert: v >= 90 }]))
      : [];
    const statsLine = stats.map((s) => s.text).join(" · ");
    const plaqueW = Math.max(
      D.plaqueMin,
      // The sign's caps and the status gem beside the name.
      Math.ceil(measure(host.name.toUpperCase(), "host") + 116),
      Math.ceil(measure(statsLine || "OFFLINE", "stats") + 90),
    );
    const node = { x: 0, y: top + D.nodeY };
    const tierTops = Array.from({ length: t.tiers }, (_, i) => top + D.band + i * (D.tierH + D.tierGap));
    const floorLine = tierTops[t.tiers - 1]! + D.floorY;
    const nextTop = top + height;
    const entity: Entity = {
      id: host.key,
      kind: "host",
      name: host.name,
      host: host.key,
      position: { q: 0, r: 0 },
      stale: !host.online,
      ...(host.stats ? { stats: host.stats } : {}),
    };
    hostEntities.push(entity);
    floors.push({
      host: entity,
      online: host.online,
      top,
      height,
      tiers: t.tiers,
      rect: { x: -halfL, y: top, w: halfL + halfR, h: height },
      medallion: { x: 0, y: top + D.gateMedallionY },
      plaque: { x: -plaqueW / 2, y: top + D.plaqueY, w: plaqueW, h: D.plaqueH },
      title: plaqueTitle,
      name: host.name.toUpperCase(),
      stats,
      node,
      portcullis: { x: -D.portcullisW / 2, y: top + D.portcullisY, w: D.portcullisW, h: D.portcullisH },
      stairs: {
        x: -D.stairsW / 2,
        y: top + D.stairsY,
        w: D.stairsW,
        h: (last ? floorLine + D.foot : nextTop + D.surroundY) - (top + D.stairsY),
      },
      arch: { x: -D.archW / 2, y: top + D.archY, w: D.archW, h: D.archH },
      surround: { x: -D.surroundW / 2, y: top + D.surroundY, w: D.surroundW, h: D.surroundH },
      // Block pillars at the floor's ends and between its hall and side rooms.
      piers: ([[22, 44], [D.sideRoom, 29]] as const).flatMap(([d, w]) =>
        [-1, 1].map((s) => ({ x: s * (sideHalf(s) - d) - w / 2, y: top + 45, w, h: tierTops[t.tiers - 1]! + D.frontY - (top + 45) })),
      ),
      tierTops,
      last,
    });
    nodes.push(node);
    const online = host.online;
    for (const [rows, s] of [[t.left, -1], [t.right, 1]] as const) {
      rows.forEach((row, tier) => {
        const y0 = tierTops[tier]!;
        const busY = y0 + D.busY;
        let cursor = D.inner;
        const busNodes: number[] = [];
        let dropX: number | null = null;
        const tierRuns: { ws: string; x: number }[] = [];
        for (const b of row) {
          const X = (u: number) => s * (cursor + u);
          const labelC = X(b.labelC);
          const mark = { x: labelC, y: y0 + D.markY };
          const projNode = { x: labelC, y: busY };
          const entity: Entity | undefined = b.project
            ? {
                id: b.project.key,
                kind: "project",
                name: b.project.name,
                host: host.key,
                position: { q: 0, r: 0 },
                stale: !!b.project.stale,
              }
            : undefined;
          const span = { x: Math.min(X(0), X(b.width)), y: y0, w: b.width, h: D.tierH };
          projects.push({
            key: b.key,
            host: host.key,
            entity,
            name: b.project?.name ?? "No project",
            side: s,
            tier,
            floor: f,
            span,
            mark,
            node: projNode,
            // Its wall candles flank its mark.
            torches: [
              { x: labelC - D.markR - 22, y: y0 + D.markY - 22 },
              { x: labelC + D.markR + 22, y: y0 + D.markY - 22 },
            ],
            // Its pick box: the terrace's back wall, where its medallion was and along its span, from above its candles
            // down to the bus (which runs over it), inside its returns; on the top tier clear of the host's plaque.
            rect: terraceBox(span, y0, tier === 0 ? plaqueW / 2 + 6 : 0),
            stale: !!b.project?.stale,
          });
          busNodes.push(projNode.x);
          nodes.push(projNode);
          b.alcoves.forEach((a, k) => {
            const x0 = s === 1 ? X(b.starts[k]!) : X(b.starts[k]! + a.width);
            const rect = { x: x0, y: y0 + D.alcoveY, w: a.width, h: D.alcoveH };
            const cx = x0 + a.width / 2;
            const wsNode = { x: cx, y: busY };
            const c = a.cottage;
            const wsEntity: Entity = {
              id: c.key,
              kind: "workspace",
              name: c.name,
              host: host.key,
              project: b.project?.key,
              position: { q: 0, r: 0 },
              stale: !!c.stale,
              camp: c.camp,
              ...(c.flags ? { flags: c.flags } : {}),
              ...(c.probe ? { probe: c.probe } : {}),
              ...(c.autoMerge ? { autoMerge: true } : {}),
            };
            const flagY = y0 + D.alcoveY + D.lintelY;
            const left = { x: x0 + D.flagInset, y: flagY },
              right = { x: x0 + a.width - D.flagInset, y: flagY };
            const flags: DFlag[] = [];
            if (c.flags?.ci) flags.push({ workspace: c.key, flag: c.flags.ci, frame: `pr-${c.flags.ci}`, ...left, size: D.flag });
            if (c.flags?.review) flags.push({ workspace: c.key, flag: c.flags.review, frame: `pr-${c.flags.review}`, ...right, size: D.flag });
            if (c.probe)
              flags.push({
                workspace: c.key,
                flag: "probe",
                frame: `probe-${c.probe.state}`,
                // Beside the review medallion on the lintel, inward.
                x: c.flags?.review ? right.x - D.flag - 4 : right.x,
                y: flagY,
                size: D.flag,
              });
            const sealOn = c.autoMerge ? (flags.find((fl) => fl.flag === c.flags?.review) ?? flags.find((fl) => fl.flag === c.flags?.ci)) : undefined;
            const rng = random(seedOf(c.key + "alcove"));
            workspaces.push({
              entity: wsEntity,
              project: b.key,
              floor: f,
              rect,
              node: wsNode,
              slots: a.slots,
              interiors: Array.from({ length: a.slots }, () => Math.floor(rng() * 4)),
              candles: [
                { x: x0 + 30, y: y0 + D.alcoveY + D.alcoveH - 14 },
                { x: x0 + a.width - 31, y: y0 + D.alcoveY + D.alcoveH - 14 },
              ],
              flags,
              ...(sealOn ? { seal: { x: sealOn.x + 7, y: sealOn.y - 7, size: 10 } } : {}),
              agents: c.agents,
            });
            busNodes.push(wsNode.x);
            nodes.push(wsNode);
            // From the bus down to the alcove's top centre.
            links.push([wsNode, { x: cx, y: rect.y }]);
            tierRuns.push({ ws: c.key, x: cx });
            const n = c.agents.length;
            c.agents.forEach((key, i) => {
              const row = agentRows.get(key);
              if (!row) return;
              const feet = { x: cx + (i - (n - 1) / 2) * D.slot, y: y0 + D.feetY };
              const e = agentEntity(row, { workspace: c.key, project: b.project?.key }, online);
              agents.push({
                robot: robotColor(row.model),
                drones: (row.subagentModels ?? []).map(robotColor),
                entity: e,
                feet,
                // Its pick box: no wider than its pitch, so neighbours' never overlap.
                rect: { x: feet.x - Math.min(D.robot + 4, D.slot - 2) / 2, y: feet.y - D.robotH - 2, w: Math.min(D.robot + 4, D.slot - 2), h: D.robotH + 6 },
                floor: f,
              });
            });
          });
          cursor += b.width + D.projectGap;
        }
        if (!busNodes.length) return;
        // Tier 0 drops from the host's node line at its innermost node; lower tiers down the trunk beside the gate.
        const outer = busNodes.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m));
        dropX = s * (tier === 0 ? D.drop : D.trunk);
        const corner = { x: dropX, y: node.y };
        const foot = { x: dropX, y: busY };
        links.push([node, corner, foot, { x: outer, y: busY }]);
        if (tier > 0) nodes.push(foot);
        for (const r of tierRuns) runs[r.ws] = [node, corner, foot, { x: r.x, y: busY }, { x: r.x, y: y0 + D.alcoveY }];
      });
    }
    top = nextTop;
  });
  const boardH = top;
  // The board's extent: its widest reach either side (floors step in where they're narrower).
  const left = floors.length ? Math.min(...floors.map((f) => f.rect.x)) : -half;
  const right = floors.length ? Math.max(...floors.map((f) => f.rect.x + f.rect.w)) : half;
  const bounds = { x: left, y: 0, w: right - left, h: boardH };
  /** The upper wall above the first floor, with a pillar either side of the gate's column. */
  // The wall above the first floor is as wide as the first floor.
  const topHalf = (s: number) => (floors[0] ? (s === -1 ? -floors[0].rect.x : floors[0].rect.x + floors[0].rect.w) : half);
  const topBand = { rect: floors[0] ? { x: floors[0].rect.x, y: 0, w: floors[0].rect.w, h: D.topBand } : { x: -half, y: 0, w: half * 2, h: D.topBand }, piers: [-1, 1].map((s) => ({ x: s * (D.surroundW / 2 + 60) - 14, y: 8, w: 28, h: D.topBand - 8 })) };

  // Everything the board says or shows, which decorations keep clear of.
  const reserved: Rect[] = [
    ...floors.flatMap((fl) => [fl.plaque, fl.portcullis, fl.stairs, fl.surround, fl.arch,
      // The thick front wall closing each tier.
      ...fl.tierTops.map((y0) => ({ x: fl.rect.x, y: y0 + D.frontY, w: fl.rect.w, h: 28 }))]),
    // Each project's terrace wall behind its medallion.
    ...projects.map((p) => ({ x: p.span.x, y: p.span.y + 20, w: p.span.w, h: 30 })),
    ...projects.flatMap((p) => [p.rect, ...p.torches.map((t) => rectOf("torch", t.x, t.y).rect)]),
    ...workspaces.map((w) => w.rect),
    ...agents.map((a) => ({ ...a.rect, x: a.rect.x - 4, y: a.rect.y - 8, w: a.rect.w + 14, h: a.rect.h + 8 })),
    ...links.flatMap((l) => l.slice(1).map((b, i) => segmentRect(l[i]!, b))),
  ];
  const decor: DDecor[] = [];
  const piers = floors.flatMap((fl) => fl.piers.map((r) => pad(r, 4)));
  reserved.push(...piers, ...topBand.piers.map((r) => pad(r, 4)));
  /** Place a decoration where it covers nothing the board shows (`overPiers`: it may stand in front of a pillar). */
  const place = (item: Omit<DDecor, "w" | "h" | "rect"> & { w?: number }, keepClear = true, overPiers = false, group?: string) => {
    const { w, h, rect } = rectOf(item.frame, item.x, item.y, item.w);
    const blocking = overPiers ? reserved.filter((r) => !piers.includes(r)) : reserved;
    // A vignette's own props may overlap each other, as a scene's do.
    const others = decor.filter((d) => !d.recess && (!group || d.group !== group)).map((d) => d.rect);
    if (keepClear && [...blocking, ...others].some((r) => overlaps(r, rect, 2))) return false;
    if (rect.x < bounds.x || rect.x + rect.w > bounds.x + bounds.w) return false;
    decor.push({ ...item, w, h, rect });
    return true;
  };
  // The wall above the first floor: torches either side of the gate's column and by the ends, and windows.
  {
    const rng = random(seedOf(floors.map((x) => x.host.id).join("|") + "top"));
    const lit0 = (light: { color: number; reach: number }) => (floors[0]?.online ? { light } : {});
    for (const s of [-1, 1] as const) {
      place({ frame: "torch", x: s * (D.surroundW / 2 + 30), y: 18, w: 24, floor: 0, layer: "front", ...lit0(TORCH_LIGHT) });
      place({ frame: "torch", x: s * (topHalf(s) - 200 - rng() * 60), y: 16, w: 24, floor: 0, layer: "front", ...lit0(TORCH_LIGHT) });
      place({ frame: "window-barred", x: s * (D.surroundW / 2 + 130 + rng() * 40), y: 42, w: 40, floor: 0, layer: "back" });
      if (FRAMES["window-arch"]?.real) place({ frame: "window-arch", x: s * (topHalf(s) - 110), y: 74, w: 40, floor: 0, layer: "back" });
    }
  }
  floors.forEach((fl, f) => {
    // Each side's own reach from the gate's line (a floor's two sides may differ).
    const sideHalf = (s: number) => (s === -1 ? -fl.rect.x : fl.rect.x + fl.rect.w);
    const rng = random(seedOf(fl.host.id + "decor"));
    const pick = <T,>(list: T[]) => list[Math.floor(rng() * list.length)]!;
    const online = fl.online;
    const lit = (light: { color: number; reach: number }) => (online ? { light } : {});
    // Projects' own torches: lit while they work (the bridge decides).
    for (const p of projects.filter((p) => p.floor === f))
      for (const t of p.torches) {
        const { w, h, rect } = rectOf("torch", t.x, t.y);
        decor.push({ frame: "torch", x: t.x, y: t.y, w, h, rect, floor: f, project: p.entity?.id ?? p.key, layer: "front", light: TORCH_LIGHT });
      }
    // Side rooms: each tier's floor ends hold a vignette in its own recess, seeded, distinct where it can be.
    // Dealt through the board in one sequence (rotated by the hosts shown), so neighbouring rooms differ.
    const rotation = seedOf(floors.map((x) => x.host.id).join("|")) % VIGNETTES.length;
    let dealt = rotation + floors.slice(0, f).reduce((n, x) => n + 2 * x.tiers, 0);
    const deck = VIGNETTES;
    fl.tierTops.forEach((y0) => {
      for (const s of [-1, 1] as const) {
        const v = deck[dealt++ % deck.length]!;
        const mid = s * (sideHalf(s) - D.sideRoom / 2);
        const left = mid - ROOM.w / 2, feet = y0 + D.floorY - 7, top = feet - ROOM.h;
        const recess = FRAMES[v.room]?.real ? v.room : "niche-arch";
        const group = `${fl.host.id}:${y0}:${s}`;
        place({ frame: recess, x: mid, y: feet, w: ROOM.w, floor: f, layer: "back", recess: true, group }, false);
        if (v.glow && online) decor[decor.length - 1]!.light = { color: v.glow.color, reach: v.glow.reach, dy: v.glow.dy };
        for (const prop of v.props) {
          const spec = FRAMES[prop.frame] ?? FRAMES[`${prop.frame}-0`]!;
          const a = anchorShare(spec.anchor);
          const w = (prop.h * spec.w) / spec.h, cx = mid + prop.dx * -s, foot = feet - (prop.up ?? 0);
          // Its anchor point, from where its box's middle and feet should be.
          place({ frame: prop.frame, x: cx - (0.5 - a.x) * w, y: foot - (1 - a.y) * prop.h, w, floor: f, layer: "front", group, ...(prop.light ? lit(prop.light) : {}) }, false);
        }
        // A torch by the room's outer wall.
        place({ frame: "torch", x: s * (sideHalf(s) - 16), y: y0 + 120, floor: f, layer: "front", ...lit(TORCH_LIGHT) });
      }
    });
    // Torches on the wall between alcoves.
    for (const w of workspaces.filter((w) => w.floor === f)) {
      for (const x of [w.rect.x - D.alcoveGap / 2, w.rect.x + w.rect.w + D.alcoveGap / 2])
        if (Math.abs(x) > D.inner) place({ frame: "torch", x, y: w.rect.y + 34, floor: f, layer: "front", ...lit(TORCH_LIGHT) });
    }
    // The upper wall, as the concept dresses it: the host's pair of layered banners flanking the gate is the strong
    // motif; themed banners hang over the end rooms; between them, irregular clusters of torches, the odd window or
    // chain, and dark breaks (the bridge lays shadow patches there).
    const hostX = D.surroundW / 2 + 40;
    for (const s of [-1, 1] as const) {
      // Their full hanging length: mounted high, then nudged outward if it would cover something.
      let hung = false;
      // (Below the first floor the floor above's front wall takes the wall's top, so it hangs from just under it.)
      const mount = f === 0 ? fl.top + 8 : fl.top + 28;
      for (const nudge of [0, 24, 48, 72])
        if ((hung = place({ frame: "banner-purple-plain", x: s * (hostX + nudge), y: mount, w: f === 0 ? 64 : 56, floor: f, layer: "back" }))) break;
      if (hung)
        place({ frame: "torch", x: s * (hostX + 50), y: fl.top + 56, w: 24, floor: f, layer: "front", ...lit(TORCH_LIGHT) });
      place({ frame: THEMED[(seedOf(fl.host.id) + (s === 1 ? 1 : 0)) % THEMED.length]!, x: s * (sideHalf(s) - D.sideRoom / 2), y: fl.top + 40, w: 60, floor: f, layer: "back" });
      for (let x = hostX + 100 + rng() * 30; x < sideHalf(s) - D.sideRoom - 30; x += 52 + rng() * 50) {
        const roll = rng();
        const arch = FRAMES["window-arch"]?.real ? "window-arch" : "niche-arch";
        const chains = FRAMES["chain-pair"]?.real ? "chain-pair" : "chain";
        if (roll < 0.42) {
          // A cluster: one torch, or two close together.
          place({ frame: "torch", x: s * x, y: fl.top + 58 + rng() * 12, w: 22, floor: f, layer: "front", ...lit(TORCH_LIGHT) });
          if (rng() < 0.65) place({ frame: "torch", x: s * (x + 26), y: fl.top + 58 + rng() * 12, w: 22, floor: f, layer: "front", ...lit(TORCH_LIGHT) });
        } else if (roll < 0.66) {
          // A pair of wall candles, an intentional cluster with its own warm spill.
          place({ frame: "wall-candles", x: s * x, y: fl.top + 56 + rng() * 10, w: 30, floor: f, layer: "front", ...lit({ color: 0xffb840, reach: 50 }) });
        } else if (roll < 0.72) place({ frame: "window-barred", x: s * x, y: fl.top + 82, w: 42, floor: f, layer: "back" });
        else if (roll < 0.8) place({ frame: arch, x: s * x, y: fl.top + 112, w: 42, floor: f, layer: "back" });
        else if (roll < 0.86) place({ frame: chains, x: s * x, y: fl.top + 4, w: chains === "chain-pair" ? 34 : 9, floor: f, layer: "back" });
        // Otherwise a dark break.
      }
      // Floor props, windows and niches in leftover space between a tier's projects and its room.
      fl.tierTops.forEach((y0) => {
        const used = projects.filter((p) => p.floor === f && p.side === s && p.span.y === y0);
        const edge = used.length ? Math.max(...used.map((p) => (s === 1 ? p.span.x + p.span.w : -p.span.x))) : D.inner;
        for (let x = edge + 30; x < sideHalf(s) - D.sideRoom - 30; x += 60 + rng() * 40) place({ frame: pick(FLOOR_PROPS), x: s * x, y: y0 + D.floorY, w: (FRAMES[FLOOR_PROPS[0]!]!.w) * 1.3, floor: f, layer: "front" });
        for (let x = edge + 40; x < sideHalf(s) - D.sideRoom - 40; x += 110 + rng() * 40)
          place({ frame: rng() < 0.5 ? "window-barred" : "niche-arch", x: s * x, y: rng() < 0.5 ? y0 + 60 : y0 + 150, floor: f, layer: "back" });
      });
    }
    // Clutter on free floor: in the gaps beside alcoves, on the walkways and beside the side rooms.
    for (const s of [-1, 1] as const)
      fl.tierTops.forEach((y0) => {
        for (let x = D.inner + 6; x < sideHalf(s) - 20; x += 22 + rng() * 14) {
          if (rng() < 0.45) continue;
          const frame = pick(CLUTTER);
          const spec = FRAMES[frame] ?? FRAMES[`${frame}-0`]!;
          const w = frame === "candle" ? 9 : Math.min(spec.w, frame === "shelf-potions" || frame === "table" ? 46 : 28);
          place({ frame, x: s * x, y: y0 + D.frontY - 2, w, floor: f, layer: "front", ...(frame === "candle" ? lit({ color: 0xffb050, reach: 34 }) : {}) });
        }
      });
    // The foot of the last stairs: braziers either side, then on each side a scribe's corner (rug, desk, candelabra).
    if (fl.last) {
      const y = fl.top + fl.height - D.footPad - 6;
      const lip = fl.tierTops[fl.tiers - 1]! + D.frontY + 40;
      place({ frame: "banner-crown", x: 0, y: lip + 2, w: 70, floor: f, layer: "front" }, false);
      for (const s of [-1, 1] as const) {
        // Each side's corner its own: small seeded offsets, so the foreground isn't a mirror.
        const jog = (k: string, r: number) => ((seedOf(fl.host.id + k + s) % 1000) / 1000 - 0.5) * 2 * r;
        place({ frame: "brazier", x: s * (112 + jog("b", 8)), y, w: 66, floor: f, layer: "front", ...lit({ color: 0xff9a3a, reach: 30 }) }, false);
        const rug = FRAMES["rug-red"]!, rugW = 140, rugH = (rug.h * rugW) / rug.w;
        place({ frame: "rug-red", x: s * (292 + jog("r", 10)), y: lip - 6 + anchorShare(rug.anchor).y * rugH, w: rugW, floor: f, layer: "back" }, false);
        // The scribe's desk on the rug's outer end, a candelabra on it.
        const corner = `${fl.host.id}:foot:${s}`;
        place({ frame: "scroll-desk", x: s * (436 + jog("d", 10)), y, w: 86, floor: f, layer: "front", group: corner }, false);
        place({ frame: "candelabra", x: s * (436 + jog("d", 10) + (s === -1 ? 24 : -26)), y: y - 52, w: 26, floor: f, layer: "front", group: corner, ...lit({ color: 0xffb040, reach: 40 }) }, false);
      }
    }
  });

  const shownProjects = projects.filter((p) => p.entity).map((p) => p.entity!);
  const entities = [...hostEntities, ...shownProjects, ...workspaces.map((w) => w.entity), ...agents.map((a) => a.entity)];
  const round = (r: Rect) => [r.x, r.y, r.w, r.h].map((v) => Math.round(v * 10) / 10);
  const signature = JSON.stringify([
    round(bounds),
    floors.map((fl) => [fl.host.id, fl.title, fl.online, fl.stats.map((s) => s.text), round(fl.rect)]),
    projects.map((p) => [p.key, p.name, round(p.rect)]),
    workspaces.map((w) => [
      w.entity.id,
      w.entity.name,
      round(w.rect),
      w.flags.map((fl) => fl.frame),
      w.entity.probe ? probeGlyph(w.entity.probe) : 0,
      w.seal ? 1 : 0,
    ]),
    agents.map((a) => [a.entity.id, a.feet.x, a.feet.y]),
  ]);
  return {
    bounds,
    floors,
    projects,
    workspaces,
    agents,
    links,
    nodes,
    runs,
    decor,
    topBand,
    entities,
    counts: {
      hosts: floors.length,
      projects: shownProjects.length,
      workspaces: workspaces.filter((w) => !w.entity.camp).length,
      agents: agents.length,
    },
    signature,
  };
}

/** The most urgent state among a project's agents that the medallion flares for. */
export function projectAlarm(layout: DungeonLayout, project: string): State | undefined {
  const states = layout.agents.filter((a) => a.entity.project === project).map((a) => a.entity.state!);
  return tileState(states.filter((s) => BEACON_STATES.includes(s)));
}
/** Whether any of a project's agents is running. */
export const projectWorking = (layout: DungeonLayout, project: string) =>
  layout.agents.some((a) => a.entity.project === project && a.entity.state === "running");

/** The HUD's subtitle: short and true. */
export function hudSubtitle(layout: DungeonLayout): string {
  const states = layout.agents.map((a) => a.entity.state);
  const running = states.filter((s) => s === "running").length;
  const needs = states.filter((s) => s === "approval" || s === "question" || s === "asking" || s === "failed" || s === "done").length;
  const parts = [running ? `${running} running` : "", needs ? `${needs} need${needs === 1 ? "s" : ""} you` : ""].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  if (layout.floors.length && layout.floors.every((f) => !f.online)) return "Every host offline";
  return "All quiet";
}

/** The spans a tier's cutaway (its ledge face, underside and shadow) runs across, from x to x: the floor's
 * width less its ends, opened round the next floor's gate surround below a floor's last tier, as its front
 * rampart is, so the next host's arch and icon read whole. */
export function cutawaySpans(fl: DFloor, y0: number): [number, number][] {
  const L = fl.rect.x + 26, R = fl.rect.x + fl.rect.w - 26;
  const opens = !fl.last && y0 === fl.tierTops[fl.tiers - 1];
  return opens ? [[L, -D.surroundW / 2 + 2], [D.surroundW / 2 - 2, R]] : [[L, R]];
}
