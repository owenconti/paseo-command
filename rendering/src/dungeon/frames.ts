/**
 * The Dungeon Board's sprite contract: every frame the board draws, by sheet,
 * with the size it is drawn at (board units: the concept's pixels; the sheets
 * are painted at `SHEET_SCALE`× that) and its anchor. The real sheets live in
 * `assets/dungeon/<sheet>.png|json`; until a frame is there the bridge paints
 * a plain placeholder of this size under the same name. Pure.
 */
import { PR_LABELS } from "../prStatus.ts";
import { PROBE_STATES } from "../probe.ts";

/** Sheets are drawn at this many pixels per board unit. */
export const SHEET_SCALE = 3;

/** Where a frame's position is: its feet (bottom centre), its top-left corner,
 * its centre or its top centre (hanging things). */
export type Anchor = "feet" | "top-left" | "center" | "top-center" | { x: number; y: number };
export type FrameSpec = {
  sheet: string;
  /** Board units. */
  w: number;
  h: number;
  anchor: Anchor;
  tile?: "x" | "y" | "xy";
  /** 9-slice insets, board units: the same all round, or each side's. */
  slice?: number | { left: number; right: number; top: number; bottom: number };
  /** Drawn from a sheet (rather than a placeholder). */
  real?: boolean;
};

/** Robot colours the robots sheet paints. */
export const ROBOT_COLORS = ["orange", "white", "blue", "purple", "green", "yellow", "red", "grey", "teal", "pink"] as const;
export type RobotColor = (typeof ROBOT_COLORS)[number];

/** The project medallions' icons. */
export const ICONS = [
  "layers", "code", "cube", "chart", "flask", "person", "gear", "globe", "book",
  "terminal", "database", "rocket", "shield", "bolt", "leaf", "castle",
] as const;
export type Icon = (typeof ICONS)[number];

/** Each animation's frame count. */
export const ANIMATIONS: Record<string, number> = {
  "candle": 3,
  "gate-portcullis-lit": 4,
  "torch": 4,
  "brazier": 4,
  "forge": 4,
  "crystal": 4,
  "alchemy-tank": 4,
  "magic-circle": 4,
  "candelabra": 4,
  "wall-candles": 4,
  ...Object.fromEntries(ROBOT_COLORS.flatMap((c) => [[`robot-${c}-idle`, 2], [`robot-${c}-work`, 4], [`drone-${c}`, 2]])),
};
/** An animation's frame names, in order. */
export const framesOf = (base: string) => Array.from({ length: ANIMATIONS[base] ?? 1 }, (_, i) => `${base}-${i}`);

const spec = (sheet: string, w: number, h: number, anchor: Anchor, extra: Partial<FrameSpec> = {}): FrameSpec => ({ sheet, w, h, anchor, ...extra });
const anim = (base: string, s: FrameSpec): [string, FrameSpec][] => framesOf(base).map((n) => [n, s]);

export const STATE_GLOWS = ["running", "idle", "done", "approval", "question", "asking", "failure", "offline"] as const;
export const MARKS = ["approval", "question", "asking", "failure", "done", "running"] as const;

export const FRAMES: Record<string, FrameSpec> = Object.fromEntries([
  // robots
  ...ROBOT_COLORS.flatMap((c) => [
    ...anim(`robot-${c}-idle`, spec("robots", 34, 32, "feet")),
    ...anim(`robot-${c}-work`, spec("robots", 34, 32, "feet")),
    ...anim(`drone-${c}`, spec("robots", 14, 12, "center")),
  ]),
  // alcoves
  ["alcove-left", spec("alcoves", 16, 112, "top-left")],
  ["alcove-right", spec("alcoves", 16, 112, "top-left")],
  ...[0, 1, 2, 3].map((i) => [`alcove-slot-${i}`, spec("alcoves", 38, 112, "top-left")] as [string, FrameSpec]),
  ["alcove-top", spec("alcoves", 38, 20, "top-left", { tile: "x" })],
  ["alcove-ledge", spec("alcoves", 66, 16, "top-left", { tile: "x" })],
  ...anim("candle", spec("alcoves", 8, 18, "feet")),
  // gate
  ["gate-arch", spec("gate", 168, 318, "feet")],
  ...anim("gate-portcullis-lit", spec("gate", 84, 80, "top-left")),
  ["gate-portcullis-dark", spec("gate", 84, 80, "top-left")],
  ["gate-medallion", spec("gate", 68, 68, "center")],
  ["gate-surround", spec("gate", 331, 229, "top-left")],
  ["stairs-top", spec("gate", 84, 18, "top-left")],
  ["stairs-mid", spec("gate", 84, 24, "top-left", { tile: "y" })],
  ["stairs-bottom", spec("gate", 100, 22, "top-left")],
  ["banner-crown", spec("gate", 50, 100, "top-center")],
  // stone
  ["wall-brick", spec("stone", 32, 32, "top-left", { tile: "xy" })],
  ["wall-brick-dark", spec("stone", 32, 32, "top-left", { tile: "xy" })],
  ["floor-flag", spec("stone", 32, 18, "top-left", { tile: "x" })],
  ["ledge-face", spec("stone", 32, 16, "top-left", { tile: "x" })],
  ["ledge-end-left", spec("stone", 14, 34, "top-left")],
  ["ledge-end-right", spec("stone", 14, 34, "top-left")],
  ["pillar", spec("stone", 26, 32, "top-left", { tile: "y" })],
  ["pillar-cap", spec("stone", 32, 14, "top-left")],
  ["pillar-base", spec("stone", 32, 14, "top-left")],
  ["niche-arch", spec("stone", 60, 84, "feet")],
  ["window-barred", spec("stone", 48, 58, "center")],
  ["border", spec("stone", 32, 20, "top-left", { tile: "x" })],
  ["border-corner", spec("stone", 20, 20, "top-left")],
  ["corbel-left", spec("stone", 29, 31, "top-center")],
  // Rougher masonry variants, mixed per tile, and painted warm reflection glazes for near fixtures.
  ...["wall-brick", "terrace-floor"].flatMap((n) => [2, 3].map((v) => [`${n}-${v}`, spec("stone", 160, 76, "top-left", { tile: "xy" })] as [string, FrameSpec])),
  ...["rampart-x", "floor-flag"].flatMap((n) => [2, 3].map((v) => [`${n}-${v}`, spec("stone", 66, 22, "top-left", { tile: "x" })] as [string, FrameSpec])),
  ...[0, 1, 2].map((i) => [`light-spill-wall-${i}`, spec("stone", 108, 101, "center")] as [string, FrameSpec]),
  ...[0, 1].map((i) => [`light-spill-floor-${i}`, spec("stone", 121, 68, "center")] as [string, FrameSpec]),
  ["corbel-right", spec("stone", 29, 31, "top-center")],
  // The three-quarter view's thick low walls with lit tops, and the warm terrace floor.
  ["rampart-x", spec("stone", 66, 22, "top-left", { tile: "x" })],
  ["rampart-y", spec("stone", 22, 66, "top-left", { tile: "y" })],
  ...["tl", "tr", "bl", "br"].map((c) => [`rampart-corner-${c}`, spec("stone", 67, 67, "top-left")] as [string, FrameSpec]),
  ...["left", "right", "top", "bottom"].map((e) => [`rampart-end-${e}`, spec("stone", 23, 23, "top-left")] as [string, FrameSpec]),
  ["rampart-t-down", spec("stone", 67, 45, "top-left")],
  ["rampart-return-left", spec("stone", 49, 49, "top-left")],
  ["rampart-return-right", spec("stone", 49, 49, "top-left")],
  ["terrace-floor", spec("stone", 72, 60, "top-left", { tile: "xy" })],
  // Side-room recesses, each holding a vignette.
  ...["arch", "cave", "magic", "forge"].map((r) => [`room-${r}`, spec("stone", 130, 200, "feet")] as [string, FrameSpec]),
  // The upper wall's dressing.
  ["pillar-capital", spec("stone", 55, 37, "top-left")],
  ["window-arch", spec("stone", 66, 91, "feet")],
  ["chain-pair", spec("props", 61, 101, "top-center")],
  // ui
  ["label", spec("ui", 64, 36, "top-left", { slice: 12 })],
  ["plaque", spec("ui", 96, 64, "top-left", { slice: 16 })],
  ["medallion", spec("ui", 58, 58, "center")],
  ...ICONS.map((i) => [`icon-${i}`, spec("ui", 26, 26, "center")] as [string, FrameSpec]),
  ["node", spec("ui", 14, 14, "center")],
  ["panel", spec("ui", 96, 64, "top-left", { slice: 16 })],
  ...["hosts", "projects", "workspaces", "agents"].map((n) => [`count-${n}`, spec("ui", 28, 28, "center")] as [string, FrameSpec]),
  ...["online", "offline", "warning"].map((n) => [`dot-${n}`, spec("ui", 10, 10, "center")] as [string, FrameSpec]),
  // props
  ...anim("torch", spec("props", 16, 40, "top-center")),
  ["torch-out", spec("props", 16, 40, "top-center")],
  ...anim("brazier", spec("props", 40, 56, "feet")),
  ["banner-purple-layers", spec("props", 40, 92, "top-center")],
  ["banner-purple", spec("props", 40, 92, "top-center")],
  ["banner-navy-hammers", spec("props", 40, 92, "top-center")],
  ["banner-blue-anvil", spec("props", 40, 92, "top-center")],
  ["barrel", spec("props", 26, 32, "feet")],
  ["barrels", spec("props", 52, 36, "feet")],
  ["crate", spec("props", 30, 30, "feet")],
  ["crates", spec("props", 54, 46, "feet")],
  ["shelf-potions", spec("props", 56, 72, "feet")],
  ["bookcase-ladder", spec("props", 84, 112, "feet")],
  ...anim("forge", spec("props", 92, 92, "feet")),
  ["anvil", spec("props", 42, 28, "feet")],
  ...anim("crystal", spec("props", 72, 92, "feet")),
  ...anim("alchemy-tank", spec("props", 84, 124, "feet")),
  ...anim("magic-circle", spec("props", 104, 40, "center")),
  ["armor", spec("props", 32, 66, "feet")],
  ...anim("candelabra", spec("props", 35, 49, "feet")),
  ["candelabra-out", spec("props", 35, 49, "feet")],
  ...anim("wall-candles", spec("props", 44, 51, "top-center")),
  ["wall-candles-out", spec("props", 44, 51, "top-center")],
  ["scroll-desk", spec("props", 64, 46, "feet")],
  ["table", spec("props", 52, 36, "feet")],
  ["rug-red", spec("props", 134, 36, "center")],
  ["chain", spec("props", 10, 60, "top-center")],
  ["portcullis-side", spec("props", 30, 62, "feet")],
  ["cobweb", spec("props", 40, 40, "top-left")],
  // status
  ...MARKS.map((m) => [`mark-${m}`, spec("status", 20, 22, "center")] as [string, FrameSpec]),
  ...STATE_GLOWS.map((g) => [`glow-${g}`, spec("status", 54, 20, "center")] as [string, FrameSpec]),
  ...PR_LABELS.map((l) => [`pr-${l.flag}`, spec("status", 18, 18, "center")] as [string, FrameSpec]),
  ...PROBE_STATES.map((p) => [`probe-${p.state}`, spec("status", 18, 18, "center")] as [string, FrameSpec]),
  ["seal-automerge", spec("status", 10, 10, "center")],
]);

/** A frame's anchor, as a share of its width and height from its top-left. */
export function anchorShare(anchor: Anchor): { x: number; y: number } {
  if (typeof anchor === "object") return anchor;
  return anchor === "feet" ? { x: 0.5, y: 1 } : anchor === "center" ? { x: 0.5, y: 0.5 } : anchor === "top-center" ? { x: 0.5, y: 0 } : { x: 0, y: 0 };
}

/** A sheet's description (`assets/dungeon/<sheet>.json`): frames in sheet pixels, anchors frame-local. */
export type SheetJson = {
  image?: string;
  scale?: number;
  frames?: Record<string, { x: number; y: number; w: number; h: number; anchor?: { x: number; y: number }; slice?: { left: number; right: number; top: number; bottom: number }; tile?: string }>;
};
/** Take each frame a sheet has at its own size, anchor and 9-slice (board units). */
export function applySheet(sheet: SheetJson): string[] {
  const scale = sheet.scale ?? SHEET_SCALE;
  const taken: string[] = [];
  for (const [name, f] of Object.entries(sheet.frames ?? {})) {
    const spec = FRAMES[name];
    if (!spec || !(f.w > 0 && f.h > 0)) continue;
    spec.w = f.w / scale;
    spec.h = f.h / scale;
    if (f.anchor) spec.anchor = { x: f.anchor.x / f.w, y: f.anchor.y / f.h };
    if (f.slice) spec.slice = { left: f.slice.left / scale, right: f.slice.right / scale, top: f.slice.top / scale, bottom: f.slice.bottom / scale };
    spec.real = true;
    taken.push(name);
  }
  return taken;
}
/** A frame's 9-slice insets (board units), each side. */
export function sliceOf(spec: FrameSpec): { left: number; right: number; top: number; bottom: number } {
  const s = spec.slice ?? 0;
  return typeof s === "number" ? { left: s, right: s, top: s, bottom: s } : s;
}
