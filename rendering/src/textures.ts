import Phaser from "phaser";
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
    "trees",
    ...["teal", "violet", "lime", "blue"].map((name) => `robot-${name}`),
  ];
  for (const name of frames) {
    const sourceKey = name.startsWith("robot-")
      ? "robots"
      : name === "trees"
        ? "foliage"
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
