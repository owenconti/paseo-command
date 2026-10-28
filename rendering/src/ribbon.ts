/** The parchment banners that name hosts and projects, at fixed world scale. */
type P = { x: number; y: number };
type Box = { x: number; y: number; width: number; height: number };
type Kind = "host" | "project";

export const LABEL_FONT = "Georgia, serif";
/** The soft shadow under a banner, and the light along its top edge. */
export const RIBBON_SHADOW = { color: 0x6e5936, alpha: 0.13, radius: 2 };
export const RIBBON_BODY_RADIUS = 3;
export const RIBBON_HIGHLIGHT = { color: 0xfff7d9, alpha: 0.8, width: 0.7, inset: 4 };
/** Line widths of the tails' and body's outlines. */
export const RIBBON_STROKE = { tail: 1.2, body: 1.4 };

/** A banner caption's type: hosts set wide in capitals, projects in bold. */
export function ribbonFont(kind: Kind): { size: number; weight: "normal" | "bold"; letterSpacing: number } {
  return kind === "host"
    ? { size: 29, weight: "normal", letterSpacing: 5 }
    : { size: 21, weight: "bold", letterSpacing: 0 };
}

/** Shorten a caption with an ellipsis until `measure` puts it within
 * `maxWidth`, keeping at least one letter. */
export function fitCaption(text: string, maxWidth: number, measure: (s: string) => number): string {
  let shown = text,
    caption = text;
  while (measure(caption) > maxWidth && shown.length > 1) {
    shown = shown.slice(0, -1);
    caption = shown.trimEnd() + "…";
  }
  return caption;
}

/** A banner around a caption `captionWidth` wide, centred on (0, 0): its
 * shadow and body boxes, two swallow tails, and its colours. */
export function ribbonShape(
  kind: Kind,
  captionWidth: number,
  faded: boolean,
): {
  width: number;
  height: number;
  shadow: Box;
  body: Box;
  tails: P[][];
  fill: number;
  tailFill: number;
  stroke: number;
  text: string;
} {
  const host = kind === "host";
  const width = Math.max(host ? 150 : 90, captionWidth + (host ? 56 : 34)),
    height = host ? 38 : 26;
  const l = -width / 2,
    r = width / 2,
    t = -height / 2,
    b = height / 2;
  return {
    width,
    height,
    shadow: { x: l + 3, y: t + 5, width, height },
    body: { x: l, y: t, width, height },
    tails: [
      [
        { x: l - 17, y: t + 5 },
        { x: l + 10, y: t + 7 },
        { x: l + 10, y: b + 10 },
        { x: l - 19, y: b + 8 },
        { x: l - 11, y: 3 },
      ],
      [
        { x: r + 17, y: t + 5 },
        { x: r - 10, y: t + 7 },
        { x: r - 10, y: b + 10 },
        { x: r + 19, y: b + 8 },
        { x: r + 11, y: 3 },
      ],
    ],
    fill: faded ? 0xe2dccb : 0xf5e8bd,
    tailFill: faded ? 0xc9c1a8 : 0xdcc995,
    stroke: 0x8c7447,
    text: faded ? "#6d6656" : "#3e3322",
  };
}
