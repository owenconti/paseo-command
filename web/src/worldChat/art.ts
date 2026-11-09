/**
 * The Dungeon Board's own art for its dialogue box: the HUD's gold-framed
 * panel, the parchment label and the stone medallion (cut from the board's
 * `ui` sheet for CSS border images), and the robots' frames for the portrait.
 */
import robotsUrl from "../../../rendering/src/assets/dungeon/robots.png";
import robotsSheet from "../../../rendering/src/assets/dungeon/robots.json";
import { robotColor } from "../../../rendering/src/dungeon/layout";
export { uiFrame, uiSlice } from "./frame";

type Frame = { x: number; y: number; w: number; h: number; slice?: { left: number; right: number; top: number; bottom: number } };
const robotSheetFrames = (robotsSheet as unknown as { frames: Record<string, Frame> }).frames;
/** The sheets are painted at 3× the board's units. */
export const SHEET_SCALE = 3;

export const ROBOTS_URL = robotsUrl;
/** The robots sheet's size, for CSS background sizing. */
export const ROBOTS_SHEET = { width: 1024, height: 2706 };

/** The robot's frames for its provider/model, as the board paints it: idle, or at work (the board now keeps to idle). */
export function robotFrames(provider: string, working: boolean): Frame[] {
  const colour = robotColor(provider);
  const prefix = `robot-${colour}-${working ? "work" : "idle"}-`;
  const frames = Object.keys(robotSheetFrames)
    .filter((k) => k.startsWith(prefix))
    .sort()
    .map((k) => robotSheetFrames[k]!);
  return frames.length ? frames : [robotSheetFrames["robot-orange-idle-0"]!];
}
