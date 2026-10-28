import Phaser from "phaser";
import PROPS from "./assets/props.json";
import STRUCTURES from "./assets/structures.json";
// Regions are atlas frames, not a flattened map. Phaser owns their cropping and rendering.
const BUILDING_FRAMES: Record<string, number[]> = {
  manor: [0, 0, 575, 550],
  observatory: [585, 0, 470, 550],
  conservatory: [1060, 0, 476, 550],
  "cottage-slate": [65, 560, 455, 464],
  "cottage-brown": [600, 560, 430, 464],
  rocks: [1422, 852, 86, 71],
  // The grove's flowering shrub, below the big tree (whose canopy ends at y 839).
  shrub: [1104, 840, 140, 133],
};
export function registerFrames(scene: Phaser.Scene): void {
  for (const [name, rect] of Object.entries(BUILDING_FRAMES))
    trimFrame(
      scene,
      "buildings",
      name,
      rect as [number, number, number, number],
    );
  for (const [name, rect] of Object.entries(STRUCTURES))
    trimFrame(scene, "structures", name, rect as [number, number, number, number], 0, 0);
  // Foliage has its own source image so atlas neighbors cannot enter its frame.
  const foliage = scene.textures
    .get("foliage")
    .getSourceImage() as HTMLImageElement;
  for (const name of ["trees", "tree-small"])
    trimFrame(
      scene,
      "foliage",
      name,
      [0, 0, foliage.width, foliage.height],
      4,
      20,
    );
  // Plaza props: greenery, workshop gear, and the lamps and beacon in both states.
  for (const [name, { rect }] of Object.entries(PROPS))
    trimFrame(scene, "props", name, rect as [number, number, number, number]);
  const robots = scene.textures
    .get("robots")
    .getSourceImage() as HTMLImageElement;
  ["teal", "violet", "lime", "blue"].forEach((name, i) =>
    trimFrame(scene, "robots", `robot-${name}`, [
      ((i % 2) * robots.width) / 2,
      (Math.floor(i / 2) * robots.height) / 2,
      robots.width / 2,
      robots.height / 2,
    ]),
  );
  // Separate power-of-two GPU textures allow proper mip filtering at overview zoom.
  // Each sprite keeps transparent gutters so neighboring atlas artwork cannot bleed in.
  const frames = [
    ...Object.keys(BUILDING_FRAMES),
    ...Object.keys(STRUCTURES),
    "trees",
    ...Object.keys(PROPS),
    ...["teal", "violet", "lime", "blue"].map((name) => `robot-${name}`),
  ];
  for (const name of frames) {
    const sourceKey = name in STRUCTURES ? "structures" : name.startsWith("robot-")
      ? "robots"
      : name === "trees"
        ? "foliage"
        : name in PROPS
          ? "props"
          : "buildings";
    const source = scene.textures.get(sourceKey);
    const frame = source.get(name);
    const gutter = 8;
    const side =
      2 **
      Math.ceil(
        Math.log2(Math.max(frame.cutWidth, frame.cutHeight) + gutter * 2),
      );
    const prepared = scene.textures.createCanvas(
      `filtered-${name}`,
      side,
      side,
    )!;
    const context = prepared.getContext();
    context.drawImage(
      source.getSourceImage() as HTMLImageElement,
      frame.cutX,
      frame.cutY,
      frame.cutWidth,
      frame.cutHeight,
      gutter,
      gutter,
      frame.cutWidth,
      frame.cutHeight,
    );
    prepared.add(name, 0, gutter, gutter, frame.cutWidth, frame.cutHeight);
    prepared.refresh();
  }
  // Claude's orange and ChatGPT's white robots are the teal robot re-enamelled.
  const teal = scene.textures.get("filtered-robot-teal");
  const base = teal.getSourceImage() as HTMLCanvasElement;
  const tealFrame = teal.get("robot-teal");
  for (const [name, paint] of ROBOT_PAINT) {
    const key = `robot-${name}`;
    const prepared = scene.textures.createCanvas(`filtered-${key}`, base.width, base.height)!;
    const context = prepared.getContext();
    context.drawImage(base, 0, 0);
    const image = context.getImageData(0, 0, base.width, base.height);
    repaint(image.data, paint);
    context.putImageData(image, 0, 0);
    prepared.add(key, 0, tealFrame.cutX, tealFrame.cutY, tealFrame.cutWidth, tealFrame.cutHeight);
    prepared.refresh();
  }
  for (const name of ["teal", "violet", "lime", "blue", ...ROBOT_PAINT.map(([n]) => n)])
    splitRobot(scene, `robot-${name}`);
}
/** Where a robot's hands sit in its frame (px from the frame's top left), and
 * their reach. Every robot in the atlas shares one drawing, so one measure
 * serves all; the frame's trim leaves 5px around the silhouette. */
const HAND = { x: 5 + 44, y: 5 + 237, rx: 47, ry: 50 };
const SILHOUETTE_WIDTH = 488;
/** Cut a robot's hands into their own sprites, so they can move, and mend the
 * shoulders they covered by carrying the brass down from just above. */
function splitRobot(scene: Phaser.Scene, key: string): void {
  const texture = scene.textures.get(`filtered-${key}`);
  const frame = texture.get(key);
  const source = texture.getSourceImage() as HTMLCanvasElement;
  const fw = frame.cutWidth,
    fh = frame.cutHeight;
  const whole = document.createElement("canvas");
  whole.width = fw;
  whole.height = fh;
  const wctx = whole.getContext("2d", { willReadFrequently: true })!;
  wctx.drawImage(source, frame.cutX, frame.cutY, fw, fh, 0, 0, fw, fh);
  const pixels = wctx.getImageData(0, 0, fw, fh);
  const body = new Uint8ClampedArray(pixels.data);
  const centres = [
    { side: "l", x: HAND.x, shoulder: [5 + 48, 5 + 100] },
    { side: "r", x: 5 + SILHOUETTE_WIDTH - (HAND.x - 5), shoulder: [5 + SILHOUETTE_WIDTH - 100, 5 + SILHOUETTE_WIDTH - 48] },
  ];
  const inside = (px: number, py: number, cx: number) =>
    ((px - cx) / HAND.rx) ** 2 + ((py - HAND.y) / HAND.ry) ** 2 <= 1;
  for (const c of centres) {
    const hand = new Uint8ClampedArray(fw * fh * 4);
    for (let py = Math.floor(HAND.y - HAND.ry); py <= HAND.y + HAND.ry; py++)
      for (let px = Math.floor(c.x - HAND.rx); px <= c.x + HAND.rx; px++) {
        if (px < 0 || py < 0 || px >= fw || py >= fh || !inside(px, py, c.x)) continue;
        const i = (py * fw + px) * 4;
        for (let k = 0; k < 4; k++) hand[i + k] = pixels.data[i + k]!;
        // The shoulder ring runs on under the hand; elsewhere the hand leaves air.
        const [from, to] = c.shoulder as [number, number];
        const above = ((5 + 186) * fw + px) * 4;
        if (px >= from && px <= to && py <= 5 + 232 && pixels.data[above + 3]! > 200)
          for (let k = 0; k < 4; k++) body[i + k] = pixels.data[above + k]!;
        else body[i + 3] = 0;
      }
    addCanvasFrame(scene, `${key}-hand-${c.side}`, hand, fw, fh);
  }
  addCanvasFrame(scene, `${key}-body`, body, fw, fh);
}
function addCanvasFrame(
  scene: Phaser.Scene,
  name: string,
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  const gutter = 8;
  const prepared = scene.textures.createCanvas(`filtered-${name}`, width + gutter * 2, height + gutter * 2)!;
  const image = prepared.getContext().createImageData(width, height);
  image.data.set(data);
  prepared.getContext().putImageData(image, gutter, gutter);
  prepared.add(name, 0, gutter, gutter, width, height);
  prepared.refresh();
}
/** New enamel for the teal robot: hue (degrees), saturation scale, and how
 * lightness maps (`l * scale + offset`). Brass, ink and highlights keep. */
type Paint = { hue: number; saturation: number; scale: number; offset: number };
const ROBOT_PAINT: [string, Paint][] = [
  ["orange", { hue: 18, saturation: 0.62, scale: 1, offset: 0.12 }],
  ["white", { hue: 40, saturation: 0.06, scale: 0.4, offset: 0.6 }],
];
/** Recolour the teal enamel's pixels (teal hues with some colour), in place. */
function repaint(data: Uint8ClampedArray, paint: Paint): void {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const r = data[i]! / 255,
      g = data[i + 1]! / 255,
      b = data[i + 2]! / 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      l = (max + min) / 2,
      d = max - min;
    if (d < 0.06) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    if (h < 150 || h > 220 || s < 0.15) continue;
    const nl = Math.min(1, l * paint.scale + paint.offset),
      ns = Math.min(1, s * paint.saturation);
    const c = (1 - Math.abs(2 * nl - 1)) * ns,
      x = c * (1 - Math.abs(((paint.hue / 60) % 2) - 1)),
      m = nl - c / 2;
    const [r1, g1, b1] =
      paint.hue < 60 ? [c, x, 0] : paint.hue < 120 ? [x, c, 0] : [0, c, x];
    data[i] = Math.round((r1 + m) * 255);
    data[i + 1] = Math.round((g1 + m) * 255);
    data[i + 2] = Math.round((b1 + m) * 255);
  }
}
function trimFrame(
  scene: Phaser.Scene,
  key: string,
  name: string,
  [x, y, w, h]: [number, number, number, number],
  alphaThreshold = 90,
  padding = 5,
): void {
  const source = scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(source, x, y, w, h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++)
      if (data[(py * w + px) * 4 + 3]! > alphaThreshold) {
        left = Math.min(left, px);
        top = Math.min(top, py);
        right = Math.max(right, px);
        bottom = Math.max(bottom, py);
      }
  left = Math.max(0, left - padding);
  top = Math.max(0, top - padding);
  right = Math.min(w, right + padding + 1);
  bottom = Math.min(h, bottom + padding + 1);
  scene.textures
    .get(key)
    .add(
      name,
      0,
      x + left,
      y + top,
      Math.max(1, right - left),
      Math.max(1, bottom - top),
    );
}
export function sprite(
  scene: Phaser.Scene,
  x: number,
  y: number,
  frame: string,
  width: number,
): Phaser.GameObjects.Image {
  const name = frame === "tree-small" ? "trees" : frame;
  const image = scene.add.image(x, y, `filtered-${name}`, name);
  image.setScale(width / image.width);
  return image;
}
