/** The approved Dungeon HUD kit: nine transparent, painted sprites; labels and counts stay live HTML. */
import sheetUrl from "./hud.webp";
export const HUD_ART = [
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
export type HudArt = (typeof HUD_ART)[number];
let loaded: Promise<Record<HudArt, string>> | undefined;
export function loadHudArt(): Promise<Record<HudArt, string>> {
  return (loaded ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("The command belt artwork could not load."));
    image.src = sheetUrl;
  }).then(
    (image) =>
      Object.fromEntries(
        HUD_ART.map((name, i) => {
          // The atlas has equal grid cells. Trim their transparent gutters so each UI piece sizes by its painted bounds.
          const x = Math.round(((i % 3) * image.naturalWidth) / 3),
            y = Math.round((Math.floor(i / 3) * image.naturalHeight) / 3);
          const w = Math.round((((i % 3) + 1) * image.naturalWidth) / 3) - x;
          const h =
            Math.round(((Math.floor(i / 3) + 1) * image.naturalHeight) / 3) - y;
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
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
      ) as Record<HudArt, string>,
  ));
}
