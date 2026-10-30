import { useEffect, useState } from "react";
import { robotPortrait } from "../../rendering/src/art";
import { MODEL_COLORS, modelColor } from "../../rendering/src/world";
import robotsUrl from "../../rendering/src/assets/robots.png";

/** The Atlas robot for a provider/model, as an image URL, painted once per colour. */
const portraits = new Map<string, Promise<string>>();
let sheet: Promise<HTMLImageElement> | undefined;

function portrait(colour: string): Promise<string> {
  let hit = portraits.get(colour);
  if (!hit) {
    sheet ??= new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = robotsUrl;
    });
    hit = sheet.then((img) => robotPortrait(img, colour).toDataURL());
    portraits.set(colour, hit);
  }
  return hit;
}

/** A provider's robot enamel as a CSS colour. */
export const robotColour = (provider: string | undefined) =>
  `#${MODEL_COLORS[modelColor(provider ?? "")].toString(16).padStart(6, "0")}`;

export function useRobotPortrait(provider: string | undefined) {
  const colour = modelColor(provider ?? "");
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    portrait(colour).then(
      (url) => live && setSrc(url),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [colour]);
  return src;
}
