/**
 * The Village's sprite contract: every frame the village draws, by sheet, with
 * the size it is drawn at (village units: the concept's pixels; the sheets are
 * painted at `SHEET_SCALE`× that) and its anchor. The real sheets live in
 * `assets/village/<sheet>.png|json`; until a frame is there the bridge paints a
 * labelled placeholder of this size under the same name. PR, Probe and state
 * markers come from the Dungeon Board's status sheet (`assets/dungeon/status`). Pure.
 */
import { PR_LABELS } from "../prStatus.ts";
import { PROBE_STATES } from "../probe.ts";

/** Placeholders are painted at this many pixels per village unit. */
export const SHEET_SCALE = 3;
/** The Village's sheets are drawn at this many sheet pixels per village unit (the concept's pixels):
 * their buildings are painted 786 px wide for the concept's 450, as the artist's mock lays them out.
 * (Their JSON says `scale: 3`, the brief's nominal scale; the borrowed Dungeon Board sheets keep theirs.) */
export const VILLAGE_PX = 1.75;

/** Where a frame's position is: its feet (bottom centre), its top-left corner,
 * its centre or its top centre (hanging things). */
export type Anchor = "feet" | "top-left" | "center" | "top-center" | { x: number; y: number };
export type Insets = { left: number; right: number; top: number; bottom: number };
export type FrameSpec = {
  sheet: string;
  /** Village units. */
  w: number;
  h: number;
  anchor: Anchor;
  tile?: "x" | "y" | "xy";
  /** 9-slice insets, village units: the same all round, or each side's. */
  slice?: number | Insets;
  /** Drawn from a sheet (rather than a placeholder). */
  real?: boolean;
  /** A cottage's window (for its pull request's stained-glass pane) and its doorstep, as shares of the frame. */
  pane?: { x: number; y: number; w: number; h: number };
  doorstep?: { x: number; y: number; w: number; h: number };
};
/** The workspaces' cottages. */
export const COTTAGES = ["cottage-0", "cottage-1", "cottage-2", "cottage-3", "cottage-4", "cottage-5"] as const;

/** Robot colours the robots sheet paints. */
export const ROBOT_COLORS = ["orange", "white", "green", "blue", "cyan", "purple", "pink", "yellow"] as const;
export type RobotColor = (typeof ROBOT_COLORS)[number];

/** The banners' white icons (drawn by the page over the banner frame, from the Dungeon Board's icon set). */
export const ICONS = [
  "layers", "code", "cube", "chart", "flask", "person", "gear", "globe", "book",
  "terminal", "database", "rocket", "shield", "bolt", "leaf", "castle",
] as const;
export type Icon = (typeof ICONS)[number];

/** A workspace's status tile: from its PR's labels. */
export const TILES = ["merged", "review", "draft", "failing", "none"] as const;
export type TileKind = (typeof TILES)[number];

/** The building variants, dealt to projects so neighbours differ. */
export const BUILDINGS = ["hall-blue", "hall-purple", "dome-teal", "workshop-rust", "hall-green", "hall-red"] as const;

/** Each animation's frame count. */
export const ANIMATIONS: Record<string, number> = {
  "water-ripple": 4,
  waterfall: 4,
  ...Object.fromEntries(ROBOT_COLORS.flatMap((c) => [[`robot-${c}-idle`, 4], [`robot-${c}-work`, 4]])),
};
/** An animation's frame names, in order. */
export const framesOf = (base: string) => Array.from({ length: ANIMATIONS[base] ?? 1 }, (_, i) => `${base}-${i}`);

const spec = (sheet: string, w: number, h: number, anchor: Anchor, extra: Partial<FrameSpec> = {}): FrameSpec => ({ sheet, w, h, anchor, ...extra });
const anim = (base: string, s: FrameSpec): [string, FrameSpec][] => framesOf(base).map((n) => [n, { ...s }]);
const many = (base: string, n: number, s: FrameSpec): [string, FrameSpec][] => Array.from({ length: n }, (_, i) => [`${base}-${i}`, { ...s }]);

export const MARKS = ["approval", "question", "asking", "failure", "done"] as const;

export const FRAMES: Record<string, FrameSpec> = Object.fromEntries([
  // buildings: each a whole hall (roof and walls), standing on its feet; the arcade of bays stands in front of it.
  ...BUILDINGS.map((b) => [b, spec("buildings", 449, 300, "feet")] as [string, FrameSpec]),
  ["bay-arch", spec("buildings", 103, 103, "feet")],
  // The workspaces' cottages (their window and doorstep from the sheet), and the panes for their windows.
  ...COTTAGES.map((c) => [c, spec("cottages", 202, 209, "feet", { pane: { x: 0.31, y: 0.58, w: 0.21, h: 0.23 }, doorstep: { x: 0.66, y: 0.91, w: 0.29, h: 0.07 } })] as [string, FrameSpec]),
  ...TILES.map((t) => [`cottage-pane-${t}`, spec("cottages", 51, 57, "center")] as [string, FrameSpec]),
  // A district's boundary and gate, and stepping-stone paths.
  ["path-stone-straight", spec("district", 158, 78, "feet")],
  ["path-stone-diagonal", spec("district", 158, 130, "feet")],
  ["path-stone-diagonal-reverse", spec("district", 158, 130, "feet")],
  ["fence-h", spec("district", 158, 55, "feet")],
  ["fence-v", spec("district", 55, 141, "feet")],
  ...["hedge-0", "hedge-1", "hedge-2"].map((h) => [h, spec("district", 115, 64, "feet")] as [string, FrameSpec]),
  ["district-gate", spec("district", 158, 149, "feet")],
  ["foundation-steps", spec("buildings", 446, 55, "feet")],
  ["wall-lantern", spec("buildings", 30, 45, "feet")],
  ["flower-box", spec("buildings", 70, 49, "feet")],
  ["ivy", spec("buildings", 58, 96, "feet")],
  // banner and plaques
  ["banner", spec("banner", 137, 134, "feet")],
  ["plaque", spec("banner", 257, 140, "feet", { slice: 40 })],
  ["plaque-left", spec("banner", 46, 140, "top-left")],
  ["plaque-mid", spec("banner", 168, 137, "top-left", { tile: "x" })],
  ["plaque-right", spec("banner", 46, 140, "top-left")],
  // The wide (4:1) plaque and the workspaces' name plates, in three pieces each.
  ["plaque-wide", spec("banner", 411, 103, "center")],
  ["plaque-wide-left", spec("banner", 21, 103, "top-left")],
  ["plaque-wide-mid", spec("banner", 14, 103, "top-left", { tile: "x" })],
  ["plaque-wide-right", spec("banner", 21, 103, { x: 1, y: 0 })],
  ["plate-left", spec("banner", 10, 24, "top-left")],
  ["plate-mid", spec("banner", 7, 24, "top-left", { tile: "x" })],
  ["plate-right", spec("banner", 10, 24, { x: 1, y: 0 })],
  // status tiles
  ...TILES.map((t) => [`tile-${t}`, spec("tiles", 75, 75, "center")] as [string, FrameSpec]),
  ["tile-frame", spec("tiles", 86, 94, "feet")],
  // robots
  ...ROBOT_COLORS.flatMap((c) => [
    ...anim(`robot-${c}-idle`, spec("robots", 75, 86, "feet")),
    ...anim(`robot-${c}-work`, spec("robots", 75, 86, "feet")),
    [`drone-${c}`, spec("robots", 24, 31, "feet")] as [string, FrameSpec],
  ]),
  ["floorlight", spec("robots", 106, 34, "center")],
  // the fountain
  ["fountain-on", spec("fountain", 312, 286, "feet")],
  ["fountain-off", spec("fountain", 312, 286, "feet")],
  ["crystal-glow", spec("fountain", 243, 243, "center")],
  ...anim("water-ripple", spec("fountain", 158, 65, "center")),
  // ground
  ["grass", spec("ground", 439, 439, "top-left", { tile: "xy" })],
  ["cobble", spec("ground", 439, 439, "top-left", { tile: "xy" })],
  ["path", spec("ground", 439, 439, "top-left", { tile: "xy" })],
  ["plaza-ring", spec("ground", 723, 395, "center")],
  // Paving with organic edges: each piece's ragged side faces its name's direction (corners two sides).
  ...["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((d) => [`cobble-edge-${d}`, spec("ground", 223, 223, "top-left")] as [string, FrameSpec]),
  ["cobble-blob", spec("ground", 723, 518, "center")],
  // The warmer paving (grey-brown stones, darker mortar, grass over its edges) and the shallow porch ledge.
  ["cobble-warm", spec("ground-warm", 256, 256, "top-left", { tile: "xy" })],
  ...["n", "s", "e", "w", "nw", "ne", "sw", "se"].map((d) => [`cobble-warm-edge-${d}`, spec("ground-warm", 128, 128, "top-left")] as [string, FrameSpec]),
  ["cobble-warm-blob", spec("ground-warm", 606, 370, "center")],
  ["porch-ledge-left", spec("ground-warm", 24, 22, { x: 0, y: 1 })],
  ["porch-ledge-mid", spec("ground-warm", 100, 22, { x: 0, y: 1 }, { tile: "x" })],
  ["porch-ledge-right", spec("ground-warm", 24, 22, { x: 1, y: 1 })],
  ["cobble-edge-mask", spec("ground", 723, 518, "center")],
  ["porch", spec("ground", 483, 72, "feet")],
  ["porch-left", spec("ground", 46, 72, { x: 0, y: 0.976 })],
  ["porch-mid", spec("ground", 394, 69, { x: 0, y: 1 }, { tile: "x" })],
  ["porch-right", spec("ground", 46, 72, { x: 1, y: 0.976 })],
  // scenery
  ...many("tree", 6, spec("scenery", 150, 170, "feet")),
  ...many("blossom", 3, spec("scenery", 140, 160, "feet")),
  ...many("bush", 4, spec("scenery", 64, 46, "feet")),
  ...many("flowers", 4, spec("scenery", 56, 30, "feet")),
  ...many("crates", 3, spec("scenery", 60, 50, "feet")),
  ["barrel", spec("scenery", 26, 34, "feet")],
  ["tent", spec("scenery", 140, 120, "feet")],
  ["lamp-on", spec("scenery", 24, 86, "feet")],
  ["lamp-off", spec("scenery", 24, 86, "feet")],
  ["pennant", spec("scenery", 40, 120, "feet")],
  ["wall-h", spec("scenery", 120, 64, "top-left", { tile: "x" })],
  ["wall-tower", spec("scenery", 64, 112, "feet")],
  ...anim("waterfall", spec("scenery", 295, 302, "feet")),
  // The cliff the river falls from: its top, a middle that repeats down, and its foot meeting the banked river.
  ["cliff-top", spec("scenery", 257, 180, "top-center")],
  ["cliff-mid", spec("scenery", 257, 206, "top-center", { tile: "y" })],
  ["cliff-foot", spec("scenery", 257, 214, "top-center")],
  ["ruin-0", spec("scenery", 295, 269, "feet")],
  ["ruin-1", spec("scenery", 269, 238, "feet")],
  ["lamp-post-banner", spec("scenery", 89, 195, "feet")],
  ["river", spec("scenery", 257, 411, "center", { tile: "y" })],
  ["river-water", spec("scenery", 439, 439, "top-left", { tile: "xy" })],
  ["river-bank-left", spec("scenery", 110, 411, "center", { tile: "y" })],
  ["river-bank-right", spec("scenery", 110, 411, "center", { tile: "y" })],
  ["river-bend", spec("scenery", 312, 278, "center")],
  ["moat-pond", spec("scenery", 446, 189, "center")],
  ["grass-tufts", spec("scenery", 113, 47, "feet")],
  ["bridge", spec("scenery", 150, 170, "feet")],
  ...many("rocks", 3, spec("scenery", 64, 40, "feet")),
  ["pond", spec("scenery", 220, 96, "center")],
  ["flowerbed", spec("scenery", 115, 83, "feet")],
  // hud
  ["panel-9slice", spec("hud", 96, 96, "top-left", { slice: 22 })],
  ["pill", spec("hud", 200, 44, "top-left", { slice: 20 })],
  ["divider", spec("hud", 180, 8, "top-left")],
  ...["pr", "issue", "workspaces", "agents"].map((n) => [`icon-${n}`, spec("hud", 26, 26, "center")] as [string, FrameSpec]),
  ["dot", spec("hud", 12, 12, "center")],
  // the Dungeon Board's status sheet and banner icons, shared
  ...MARKS.map((m) => [`mark-${m}`, spec("status", 20, 22, "center")] as [string, FrameSpec]),
  ...PR_LABELS.map((l) => [`pr-${l.flag}`, spec("status", 18, 18, "center")] as [string, FrameSpec]),
  ...PROBE_STATES.map((p) => [`probe-${p.state}`, spec("status", 18, 18, "center")] as [string, FrameSpec]),
  ["seal-automerge", spec("status", 10, 10, "center")],
  ...ICONS.map((i) => [`icon-${i}`, spec("ui", 26, 26, "center")] as [string, FrameSpec]),
]);

/** Sheets borrowed from the Dungeon Board: only these frames are taken from them. */
export const SHARED_SHEETS = ["status", "ui"];
export const sharedFrame = (name: string) => /^(mark|pr|probe|seal)-/.test(name) || (/^icon-/.test(name) && ICONS.includes(name.slice(5) as Icon));

/** A frame's anchor, as a share of its width and height from its top-left. */
export function anchorShare(anchor: Anchor): { x: number; y: number } {
  if (typeof anchor === "object") return anchor;
  return anchor === "feet" ? { x: 0.5, y: 1 } : anchor === "center" ? { x: 0.5, y: 0.5 } : anchor === "top-center" ? { x: 0.5, y: 0 } : { x: 0, y: 0 };
}

type SheetFrame = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The anchor: `ax`/`ay` as shares of the frame (the Village's sheets), or `anchor` in frame pixels (the Dungeon Board's). */
  ax?: number;
  ay?: number;
  anchor?: { x: number; y: number };
  /** 9-slice insets in sheet pixels: the same all round, or each side's (`l`/`t`/`r`/`b`, or spelt out). */
  slice?: number | Insets | { l: number; t: number; r: number; b: number };
  /** Frame-local rects in sheet pixels (cottages). */
  pane?: { x: number; y: number; w: number; h: number };
  doorstep?: { x: number; y: number; w: number; h: number };
};
/** A sheet's description (`assets/village/<sheet>.json`): frames in sheet pixels, anchors frame-local. */
export type SheetJson = { image?: string; scale?: number; frames?: Record<string, SheetFrame> };

/** Take each frame a sheet has at its own size, anchor and 9-slice (village units). `only` limits it to some frames. */
export function applySheet(sheet: SheetJson, only: (name: string) => boolean = () => true, px?: number): string[] {
  const scale = px ?? sheet.scale ?? SHEET_SCALE;
  const taken: string[] = [];
  for (const [name, f] of Object.entries(sheet.frames ?? {})) {
    const spec = FRAMES[name];
    if (!spec || !only(name) || !(f.w > 0 && f.h > 0)) continue;
    spec.w = f.w / scale;
    spec.h = f.h / scale;
    if (f.ax !== undefined && f.ay !== undefined) spec.anchor = f.ax <= 1 && f.ay <= 1 ? { x: f.ax, y: f.ay } : { x: f.ax / f.w, y: f.ay / f.h };
    else if (f.anchor) spec.anchor = { x: f.anchor.x / f.w, y: f.anchor.y / f.h };
    const sl = f.slice;
    if (typeof sl === "number") spec.slice = sl / scale;
    else if (sl && "l" in sl) spec.slice = { left: sl.l / scale, right: sl.r / scale, top: sl.t / scale, bottom: sl.b / scale };
    else if (sl) spec.slice = { left: sl.left / scale, right: sl.right / scale, top: sl.top / scale, bottom: sl.bottom / scale };
    const share = (r?: { x: number; y: number; w: number; h: number }) => (r ? { x: r.x / f.w, y: r.y / f.h, w: r.w / f.w, h: r.h / f.h } : undefined);
    if (f.pane) spec.pane = share(f.pane);
    if (f.doorstep) spec.doorstep = share(f.doorstep);
    spec.real = true;
    taken.push(name);
  }
  return taken;
}
/** A frame's 9-slice insets (village units), each side. */
export function sliceOf(spec: FrameSpec): Insets {
  const s = spec.slice ?? 0;
  return typeof s === "number" ? { left: s, right: s, top: s, bottom: s } : s;
}
