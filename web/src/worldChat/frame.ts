/** Shared gold-framed navy panels from the Dungeon dialogue box, cut once and reused. */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import uiUrl from "../../../rendering/src/assets/dungeon/ui.png";
import uiSheet from "../../../rendering/src/assets/dungeon/ui.json";
type Frame = {
  x: number;
  y: number;
  w: number;
  h: number;
  slice?: { left: number; right: number; top: number; bottom: number };
};
const uiFrames = (uiSheet as unknown as { frames: Record<string, Frame> })
  .frames;
let sheet: Promise<HTMLImageElement> | undefined;
const cuts = new Map<string, Promise<string>>();

/** A frame of the `ui` sheet as its own image, for a CSS border image. */
export function uiFrame(
  name: "panel" | "label" | "medallion",
): Promise<string> {
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
      canvas
        .getContext("2d")!
        .drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
      // A short blob: address (kept for the page's life), not a long data URL in every style attribute.
      return new Promise<string>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(URL.createObjectURL(blob))
              : reject(new Error("no frame")),
          "image/png",
        ),
      );
    });
    cuts.set(name, hit);
  }
  return hit;
}

/** A `ui` frame's nine-slice insets in sheet pixels. */
export const uiSlice = (name: "panel" | "label") => uiFrames[name]!.slice!;

/** A compact tooltip can use the same painted frame without inheriting the whole dialogue theme. */
export function useGameTooltipFrame(
  enabled: boolean,
): CSSProperties | undefined {
  const [panel, setPanel] = useState<string>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    uiFrame("panel").then(
      (url) => live && setPanel(url),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [enabled]);
  return useMemo(
    () =>
      enabled && panel
        ? ({ "--game-tooltip-frame": `url(${panel})` } as CSSProperties)
        : undefined,
    [enabled, panel],
  );
}
