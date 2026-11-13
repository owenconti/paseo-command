/** The Dungeon Board's sprite sheets as the Crew map draws them in the page: the front-facing robots (two idle frames,
 * four work frames and two drone frames per colour) and the status sheet (state marks and glows, PR, Probe and
 * auto-merge medallions). Pure: frame rectangles and the CSS that shows one at a size. */
import robotsMap from "../../../rendering/src/assets/dungeon/robots.json";
import statusMap from "../../../rendering/src/assets/dungeon/status.json";
import { robotColor, ROBOT_OF, STATE_GLOW, STATE_MARK } from "../../../rendering/src/dungeon/layout";
import { modelColor, type State } from "../../../rendering/src/world";
import { prFlags, type PrFlag } from "../../../rendering/src/prStatus";
import type { ProbeVerdict } from "../../../rendering/src/probe";

export type Rect = { x: number; y: number; w: number; h: number };
export type SheetName = "robots" | "status";
/** Each sheet's pixel size (the PNGs'; `sheets.test.ts` reads them to check). */
export const SHEET_SIZE: Record<SheetName, { w: number; h: number }> = {
  robots: { w: 1024, h: 2706 },
  status: { w: 1024, h: 196 },
};
const FRAMES: Record<SheetName, Record<string, Rect>> = {
  robots: (robotsMap as { frames: Record<string, Rect> }).frames,
  status: (statusMap as { frames: Record<string, Rect> }).frames,
};

export const frameOf = (sheet: SheetName, name: string): Rect | undefined => FRAMES[sheet][name];

/** One frame of a sheet drawn `height` CSS px tall (its width follows), as background properties. */
export function frameStyle(sheet: SheetName, url: string, frame: Rect, height: number) {
  const s = height / frame.h;
  const { w, h } = SHEET_SIZE[sheet];
  const px = (n: number) => `${Math.round(n * 1000) / 1000}px`;
  return {
    width: px(frame.w * s),
    height: px(height),
    backgroundImage: `url("${url}")`,
    backgroundSize: `${px(w * s)} ${px(h * s)}`,
    backgroundPosition: `${px(-frame.x * s)} ${px(-frame.y * s)}`,
    backgroundRepeat: "no-repeat",
  };
}

export type Pose = "idle" | "work";
/** A robot's frames for a pose, in order (idle: open eyes, then the blink; work: its four). */
export function robotFrames(color: string, pose: Pose): string[] {
  const n = pose === "idle" ? 2 : 4;
  const names = Array.from({ length: n }, (_, i) => `robot-${color}-${pose}-${i}`);
  return names.every((name) => FRAMES.robots[name]) ? names : robotFrames("grey", pose);
}
export const droneFrames = (color: string) =>
  FRAMES.robots[`drone-${color}-0`] ? [`drone-${color}-0`, `drone-${color}-1`] : ["drone-grey-0", "drone-grey-1"];

/** A robot's colour by its provider/model, as on the board: Claude orange, ChatGPT white, others their own. */
export const robotColorOf = (model: string) => robotColor(model || "unknown");
/** Each running subagent's drone colour: its own model's where the daemon says, else its agent's. */
export function droneColors(agentModel: string, count: number, models: readonly string[] = []): string[] {
  return Array.from({ length: count }, (_, i) => {
    const m = models[i];
    return m ? robotColorOf(m) : (ROBOT_OF[modelColor(agentModel || "unknown")] ?? robotColorOf(agentModel));
  });
}

/** Robots work while running and rest otherwise (offline ones are greyed by the page). */
export const poseOf = (state: State): Pose => (state === "running" ? "work" : "idle");
export const markOf = (state: State): string | undefined => (state === "running" ? "mark-running" : STATE_MARK[state]);
export const glowOf = (state: State): string => STATE_GLOW[state];

export type Medal = { kind: "ci" | "review" | "probe"; flag: PrFlag | "probe"; frame: string };
/** A workspace's medallions, in the board's order: CI, review (or conflicts), then Probe's verdict. */
export function medalsOf(labels: readonly string[] | undefined, probe?: ProbeVerdict): Medal[] {
  const flags = prFlags(labels);
  return [
    ...(flags.ci ? [{ kind: "ci" as const, flag: flags.ci, frame: `pr-${flags.ci}` }] : []),
    ...(flags.review ? [{ kind: "review" as const, flag: flags.review, frame: `pr-${flags.review}` }] : []),
    ...(probe ? [{ kind: "probe" as const, flag: "probe" as const, frame: `probe-${probe.state}` }] : []),
  ];
}
