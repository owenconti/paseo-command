/**
 * The Dungeon Board's own art for its dialogue box: the HUD's gold-framed
 * panel, the parchment label and the stone medallion (cut from the board's
 * `ui` sheet for CSS border images), and the robots' frames for the portrait.
 */
import uiUrl from "../../../rendering/src/assets/dungeon/ui.png";
import uiSheet from "../../../rendering/src/assets/dungeon/ui.json";
import robotsUrl from "../../../rendering/src/assets/dungeon/robots.png";
import robotsSheet from "../../../rendering/src/assets/dungeon/robots.json";
import { robotColor } from "../../../rendering/src/dungeon/layout";

type Frame = { x: number; y: number; w: number; h: number; slice?: { left: number; right: number; top: number; bottom: number } };
const uiFrames = (uiSheet as unknown as { frames: Record<string, Frame> }).frames;
const robotSheetFrames = (robotsSheet as unknown as { frames: Record<string, Frame> }).frames;
/** The sheets are painted at 3× the board's units. */
export const SHEET_SCALE = 3;

export const ROBOTS_URL = robotsUrl;
/** The robots sheet's size, for CSS background sizing. */
export const ROBOTS_SHEET = { width: 1024, height: 2706 };

let sheet: Promise<HTMLImageElement> | undefined;
const cuts = new Map<string, Promise<string>>();

/** A frame of the `ui` sheet as its own image, for a CSS border image. */
export function uiFrame(name: "panel" | "label" | "medallion"): Promise<string> {
  let hit = cuts.get(name);
  if (!hit) {
    sheet ??= new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = uiUrl;
    });
    const f = uiFrames[name]!;
    hit = sheet.then((img) => {
      const canvas = document.createElement("canvas");
      canvas.width = f.w;
      canvas.height = f.h;
      canvas.getContext("2d")!.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      // A short blob: address (kept for the page's life), not a long data URL in every style attribute.
      return new Promise<string>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("no frame"))), "image/png"),
      );
    });
    cuts.set(name, hit);
  }
  return hit;
}

/** A `ui` frame's nine-slice insets in sheet pixels. */
export const uiSlice = (name: "panel" | "label") => uiFrames[name]!.slice!;

/** The robot's frames for its provider/model, as the board paints it: idle, or at work. */
export function robotFrames(provider: string, working: boolean): Frame[] {
  const colour = robotColor(provider);
  const prefix = `robot-${colour}-${working ? "work" : "idle"}-`;
  const frames = Object.keys(robotSheetFrames)
    .filter((k) => k.startsWith(prefix))
    .sort()
    .map((k) => robotSheetFrames[k]!);
  return frames.length ? frames : [robotSheetFrames["robot-orange-idle-0"]!];
}
