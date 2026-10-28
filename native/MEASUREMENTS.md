# Native Atlas measurements

(The Phaser web Atlas these compare against has since been removed; `measure.mjs` now measures the
native app alone.)

Fleet: `large` from `web/e2e/fleets.ts` (8 hosts, one offline; 40 projects; 70 workspaces; 150
agents), served by `npm run native:mock` (no daemon). Window 1440×900 points on a 2× display.
Method: `native/scripts/measure.mjs`, which takes cumulative CPU time (`ps -o time=`) over each
phase after a settle period, as `scripts/measure-world.mjs` on `dom-atlas` does. "Web Atlas" means
Phaser drawing in the same app's WKWebView (`--web-world`), so both variants share one browser
engine and window.

## Status: no valid native run yet

Every native run so far had its window off the visible screen (another Space or covered), so macOS
stopped SpriteKit's display link (0 frames drawn) and those rows measure nothing. The user stopped
performance testing at that point, preferring to judge the app in use. The table keeps only runs
whose page or SpriteKit view was actually drawing.

### Web Atlas in the app's WKWebView (2026-10-28, 15 s idle, 10 s pan, window visible)

phase | app | WebContent | WebKit GPU | total (% of one core)
--- | --- | --- | --- | ---
idle | 1.1 | 17.1 | 16.2 | 34.4
pan | 1.1 | 13.0 | 14.0 | 28.2

The system-wide GPU utilization rose from about 58% (app closed) to 96–99% during this run.
With the window covered, WebKit throttled Phaser to about 10 fps and it still cost 35–47% of a
core. For reference, `dom-atlas`'s Chrome measurements of the Phaser Atlas on the same fleet read
about 63% settled (renderer plus GPU process).

### What the native app does (checked, not timed)

- Ambient motion renders at 30 fps (debug log: 33–35 frames per second asked 30), full rate only
  while the map is handled or the camera moves.
- With reduced motion and nothing moving, it draws no frames at all (debug log: no frames over 7 s).
- It pauses when its window is occluded or minimised, and the page's WebKit processes stay idle
  because the page draws no world.
- During the native runs above, the page's processes cost 1.8% (idle) and 6.6% (scripted pan,
  which forwards every pointer event to Swift), against 33% for the same page drawing Phaser. These
  exclude SpriteKit's own drawing, which those runs never did.

## To finish

Run `node native/scripts/measure.mjs --rounds 3` with the window visible on the active screen (it
runs as a background accessory and takes no focus), and check the "SpriteKit fps", "page rAF/s"
and "window visible" columns before trusting a row.
