import Phaser from "phaser";
import PROPS from "./assets/props.json";
import STRUCTURES from "./assets/structures.json";
import { buildFrames, frameName, sourceRects, type ArtSources, type Frame } from "./art";

export function registerFrames(scene: Phaser.Scene): void {
  const sources: ArtSources = {
    buildings: scene.textures.get("buildings").getSourceImage() as HTMLImageElement,
    robots: scene.textures.get("robots").getSourceImage() as HTMLImageElement,
    foliage: scene.textures.get("foliage").getSourceImage() as HTMLImageElement,
    structures: scene.textures.get("structures").getSourceImage() as HTMLImageElement,
  };
  // The raw sheet's own trimmed rects: the Phaser thumbnail reads a
  // project's or workspace's art straight off the "buildings" texture.
  for (const [name, rect] of sourceRects(sources))
    if (!name.startsWith("robot-") && name !== "trees" && !(name in STRUCTURES))
      scene.textures.get("buildings").add(name, 0, ...rect);
  // Plaza props: greenery, workshop gear, and the lamps and beacon in both
  // states. Their source image isn't part of `ArtSources` (the DOM Atlas
  // omits plaza props), so they keep their own registration here.
  for (const [name, { rect }] of Object.entries(PROPS))
    trimFrame(scene, "props", name, rect as [number, number, number, number]);
  for (const [name, frame] of buildFrames(sources)) addFrame(scene, name, frame);
  for (const name of Object.keys(PROPS)) addPropFrame(scene, name);
}
function addFrame(scene: Phaser.Scene, name: string, frame: Frame): void {
  const key = `filtered-${name}`;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, frame.canvas);
  scene.textures.get(key).add(name, 0, frame.x, frame.y, frame.width, frame.height);
}
/** A plaza prop, cropped and padded the same way `buildFrames` does for
 * buildings and robots, from the "props" source sheet `registerFrames`
 * already trimmed above. */
function addPropFrame(scene: Phaser.Scene, name: string): void {
  const source = scene.textures.get("props");
  const frame = source.get(name);
  const gutter = 8;
  const side = 2 ** Math.ceil(Math.log2(Math.max(frame.cutWidth, frame.cutHeight) + gutter * 2));
  const prepared = scene.textures.createCanvas(`filtered-${name}`, side, side)!;
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
  const name = frameName(frame);
  const image = scene.add.image(x, y, `filtered-${name}`, name);
  image.setScale(width / image.width);
  return image;
}
