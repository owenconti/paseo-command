/** Painted action-belt pieces. Text, counts and interaction remain live HTML. */
import sheetUrl from "./hud.webp";
import queueUrl from "./queues.webp";
const BASE_ART = [
  "waiting",
  "running",
  "slot",
  "replies",
  "failures",
  "review",
  "blocked",
  "dispatch",
  "panel",
] as const;
const QUEUE_ART = ["assigned", "issues", "inbox"] as const;
export const HUD_ART = [...BASE_ART, ...QUEUE_ART] as const;
export type HudArt = (typeof HUD_ART)[number];
const image = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("The command belt artwork could not load."));
    img.src = src;
  });
function cuts(
  img: HTMLImageElement,
  names: readonly HudArt[],
  columns: number,
  rows: number,
) {
  return Object.fromEntries(
    names.map((name, i) => {
      const x = Math.round(((i % columns) * img.naturalWidth) / columns),
        y = Math.round((Math.floor(i / columns) * img.naturalHeight) / rows);
      const w =
          Math.round((((i % columns) + 1) * img.naturalWidth) / columns) - x,
        h =
          Math.round(
            ((Math.floor(i / columns) + 1) * img.naturalHeight) / rows,
          ) - y;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const pixels = ctx.getImageData(0, 0, w, h).data;
      let l = w,
        t = h,
        r = 0,
        b = 0;
      for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++) {
          if (pixels[(yy * w + xx) * 4 + 3]! < 24) continue;
          l = Math.min(l, xx);
          r = Math.max(r, xx);
          t = Math.min(t, yy);
          b = Math.max(b, yy);
        }
      const cut = document.createElement("canvas");
      cut.width = Math.max(1, r - l + 1);
      cut.height = Math.max(1, b - t + 1);
      cut
        .getContext("2d")!
        .drawImage(
          canvas,
          l,
          t,
          cut.width,
          cut.height,
          0,
          0,
          cut.width,
          cut.height,
        );
      return [name, cut.toDataURL("image/png")];
    }),
  );
}
let loaded: Promise<Record<HudArt, string>> | undefined;
export function loadHudArt(): Promise<Record<HudArt, string>> {
  return (loaded ??= Promise.all([image(sheetUrl), image(queueUrl)]).then(
    ([base, queues]) =>
      ({
        ...cuts(base, BASE_ART, 3, 3),
        ...cuts(queues, QUEUE_ART, 3, 1),
      }) as Record<HudArt, string>,
  ));
}
