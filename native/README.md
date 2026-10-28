# Paseo Command for macOS (native Atlas)

A macOS app that shows the Paseo Command React app in a `WKWebView` and draws the Atlas world
natively with SpriteKit (Metal) underneath it. It builds with the Command Line Tools alone
(`swift build`; no Xcode project).

```sh
npm run native:build                 # swift build -c release, wrapped as native/build/Paseo Command.app
npm run native:run                   # opens it without taking focus, on http://127.0.0.1:4310/
npm run native:run -- --url http://127.0.0.1:4331/
```

The app shows whatever Paseo Command server it is pointed at (`--url`, or `PASEO_COMMAND_URL`;
default `http://127.0.0.1:4310/`, the app started by `npm run app:start`). That server must serve
a build that includes `rendering/src/native/bridge.ts` (any build from this commit on). Against a
mocked fleet instead of a daemon:

```sh
npm --prefix web run build
npm run native:mock -- --fleet large --port 4331   # web/dist plus a mocked API; mutations refused
npm run native:run -- --url http://127.0.0.1:4331/
```

Options: `--web-world` (leave the Atlas to Phaser in the page, for comparison), `--ambient <fps>`
(ambient frame rate, default 30), `--size <w>x<h>`, `--front` (show in front without activating),
`--ignore-occlusion`, `--checks`, `--info <path>` (window number and process ids as JSON; also the
base path for the `notifyutil` hooks below).

## How it fits together

- **Layout and art stay in JavaScript.** Inside the app, `mountAtlas` (rendering/src/atlas.ts)
  returns the bridge world (`rendering/src/native/bridge.ts`) instead of Phaser. It runs the same
  `layoutAtlas`, `placeStructures`, `plaza`, `labels`, `tiles`, `lights` and `robots` rules and
  the same painters (`art.ts`, `terrain.ts`) as the Phaser Atlas, and posts the result to Swift
  through the `paseoWorld` message handler: sprite frames and sea tiles once, terrain and banners
  as PNGs (only pieces Swift doesn't already hold), and positions. SpriteKit only draws, so it
  stays in step with the web Atlas.
- **SpriteKit draws and animates** (`AtlasScene.swift`): terrain, buildings, props, camp flags,
  banners, state tiles (pulse periods and the running light from the shared rules), lamps and
  beacon, walking robots and orbiting drones, sea glints and cloud shadows, hover and selection
  rims. It owns the camera (pan, zoom, fit, focus, minimum zoom and pan limits, ported from
  `camera.ts`) and picking (`pick.ts`), and reports picks, hover and zoom back as `paseo:world`
  events. The React app keeps every daemon action.
- **Overlays: a transparent page over the world.** The web view covers the whole window and
  draws no background; where the map is, the page is transparent and SpriteKit shows through.
  The page keeps every pointer and key event, so its toolbar, legend, tooltips, panels and dialogs
  work exactly as in a browser, and the map surface forwards its own pointer, wheel, pinch and
  key events to Swift. Nothing needs hit-region syncing, the web view stays first responder (its
  shortcuts and focus behave as before), and the SpriteKit view never takes input. The cost is a
  message per pointer event while the map is handled.
- **Rendering on demand** (`AtlasView.swift`): the display's full rate only while the map is
  handled or the camera moves, 30 Hz for ambient motion, 15 Hz when only the sea drifts, paused
  when nothing moves (reduced motion with no interaction) or the window is occluded or minimised.
- **Galaxy** still runs as Phaser in the page; switching worlds hides the SpriteKit view.

## Checks without screen recording

`--info /tmp/x.json` names files for hooks posted with `notifyutil -p <name>`:
`com.paseo.command.native.eval` runs `/tmp/x.js` in the page and writes `/tmp/x.out`;
`.snapshot` writes `/tmp/x.png` (SpriteKit's frame under the page's snapshot); `.info` rewrites
`/tmp/x.json`; `.pan` drags the map for 10 s; `.resize` alternates the window size; `.quit`.

Measurements against the web Atlas are in [MEASUREMENTS.md](MEASUREMENTS.md)
(`node native/scripts/measure.mjs`).
