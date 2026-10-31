# Paseo Command for macOS (native Atlas)

A macOS app that shows the Paseo Command React app in a `WKWebView` and draws the Atlas world
natively with SpriteKit (Metal) underneath it. It builds with the Command Line Tools alone
(`swift build`; no Xcode project).

```sh
npm run native:build                 # swift build -c release, wrapped as native/build/Paseo Command Dev.app
npm run native:run                   # opens it without taking focus, on http://127.0.0.1:4321/
npm run native:run -- --url http://127.0.0.1:4331/
```

**Flavours.** `npm run native:build` makes the dev flavour, `native/build/Paseo Command Dev.app`
(bundle id `io.github.owenconti.paseo-command.dev`, port 4321, no updates, data in
`~/Library/Application Support/Paseo Command Dev/`). `sh native/scripts/bundle.sh --release` (run by
`npm run release`) makes `native/release/Paseo Command.app` (`io.github.owenconti.paseo-command`, port 4310,
Sparkle updates, data in `~/Library/Application Support/Paseo Command/`), signed with the self-signed
"Paseo Command Release" identity. Both carry `Contents/Resources/node/node` (Node for Apple silicon; the app supports Apple silicon Macs only),
`server/server.mjs` (an esbuild bundle of `web/server/native.ts`, from `npm run app:bundle-server`) and
`ui/` (`web/dist`).

**Updating.** The dev copy has no updater: `npm run app:update` (web app, bundled server, this app) replaces
the executable inside the bundle while a copy runs, and Restart app (⌘K) relaunches it at the same
window position and page. The released app updates through Sparkle: its mode bar shows "Update ready ·
Restart app" when a newer release is downloaded, and Restart app installs it and relaunches
(`Updater.swift`). Restart app has no keyboard shortcut or native menu item.

**It runs its own server.** When the page it shows is on this machine (the default
`http://127.0.0.1:<port>/`: 4310 for the released app, 4321 for the dev copy), the app
runs the server it carries, wherever it is installed: `Contents/Resources/node/node
Contents/Resources/server/server.mjs` (`ServerManager.swift`), with the environment of your shell
as an interactive login shell, read once at launch, so your `gh` and keys are found
(`ShellEnvironment.swift`). Its data and `logs/server.log` are in
`~/Library/Application Support/<app name>/`. The server is tied to the app: it is started
again if the page later finds it gone, and stops when the app quits (and exits by itself if the
app dies). `scripts/app-server.mjs` is for browser-only work from a checkout and is not used by the
app. Anything else on the port is reported, never stopped. `--no-server` turns this off; check
runs against the mock fleet use it.

On the released app's first launch, `LegacyState.swift` migrates the old app's (`local.paseo.command.native`)
preferences and WebKit data once (if the old app is open it first offers to quit it, and skips the
migration this launch if you decline; a folder that fails to copy is retried next launch). Only if an old checkout server is still running on the app's port does
`OldInstall.swift` offer to stop it, then copy its `secrets.json`, `games.json`, `forks.json` and
`archived-subagents.json` from `<checkout>/.paseo-command/` once (and only if none of them exists yet in the data
folder). Otherwise copy them by hand while the app is closed.

The app shows whatever Paseo Command server it is pointed at (`--url`, or `PASEO_COMMAND_URL`;
default its own server, above). That server must serve
a build that includes `rendering/src/native/bridge.ts` (any build from this commit on). Against a
mocked fleet instead of a daemon:

```sh
npm --prefix web run build
npm run native:mock -- --fleet large --port 4331   # web/dist plus a mocked API; mutations refused
npm run native:run -- --url http://127.0.0.1:4331/
```

The icon (`native/AppIcon.icns`) is drawn from the Atlas's own robot art by
`swift native/scripts/icon.swift`.

Options: `--ambient <fps>`
(ambient frame rate, default 30), `--size <w>x<h>`, `--front` (show in front without activating),
`--ignore-occlusion`, `--checks`, `--info <path>` (window number and process ids as JSON; also the
base path for the `notifyutil` hooks below).

## How it fits together

- **Layout and art stay in JavaScript.** Inside the app, `mountAtlas` (rendering/src/atlas.ts)
  returns the bridge world (`rendering/src/native/bridge.ts`). It runs the shared `layoutAtlas`,
  `placeStructures`, `placeFlags`, `plaza`, `labels`, `tiles`, `lights` and `robots` rules and the
  painters (`art.ts`, `terrain.ts`), and posts the result to Swift
  through the `paseoWorld` message handler: sprite frames and sea tiles once, terrain and banners
  as PNGs (only pieces Swift doesn't already hold), and positions. SpriteKit only draws.
- **SpriteKit draws and animates** (`AtlasScene.swift`): terrain, buildings, props, camp flags,
  banners, PR flags (the running CI one sways), state tiles (pulse periods and the running light from the shared rules), lamps and
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
- **No web renderer.** The Phaser Atlas and Galaxy were removed; in a plain browser the panels work
  and the map area says the map is drawn by this app.

## Terminal panel

View → Terminal (⌃`) opens a panel on the right, beside the map and panels, with the daemon's terminals for the
selected workspace (or the selected agent's), and starts a terminal there as it opens if the workspace has none. One tab per terminal: + opens
another, a tab's × ends it (after asking, unless told not to ask again). A tab dragged onto a pane's edge splits that pane
and shows there; dropped in a pane's middle it takes that pane's place; a click on a tab not showing puts it in the current
pane. The unsplit button (shown while split; View → Unsplit Terminals) returns to one pane, the current terminal's, the
others staying as tabs; a pane's tab dropped back on the tab bar leaves the panes too. Each workspace keeps its panes while the app runs. Its inner edge drags to resize it. The dock button (or View → Terminal at
Bottom) moves it under the map and panels and back; each side keeps its own size. The maximize button (View → Maximize
Terminal, ⇧⌘↩) lays the panel over the whole map, leaving the page's panels in view, and back. ⌘+ / ⌘− / ⌘0 (View) change
the terminals' text size while the panel shows, kept across launches. Closing the panel or switching workspace leaves terminals
running on the daemon. SwiftTerm draws them; the app server relays each over `/api/terminal`
(`web/server/api/terminals.ts`), replaying its recent screen first. To check it without a real
daemon:

```sh
npm --prefix web run build
web/node_modules/.bin/tsx --import ./web/server/test-setup.ts native/scripts/fake-server.ts --port 4332
npm run native:run -- --url 'http://127.0.0.1:4332/?agent=a-1' --no-server
```

## Conquer

The strip across the top switches the map's place between the map, Conquer and Linear (⌘` steps through them in turn); Conquer is a tabbed browser with its own persistent
cookie store. ⌘B toggles the React app panel even while a browser page has focus; ⌘S toggles Conquer's tab sidebar, restoring its width.
Its native toolbar, tab list, find bar, suggestions and downloads use shared flat control primitives matching the React panel.
Their colors and control metrics are generated from `web/src/styles/tokens.css` (Light) and `web/src/themes.css` (Galaxy),
and the app bundles the same Inter and Source Sans body fonts. After changing those CSS tokens, run
`node native/scripts/theme.mjs` and commit `NativeTheme.swift`; `native:build` checks it for drift.

Closing the last ordinary tab selects a remaining pinned page, even if it is unloaded.
With no replacement, the browser stays empty; the address bar and New Tab still work.
Closing a pinned page only unloads it. `npm run native:test` checks these transitions in an
isolated process with nonpersistent storage and a loopback page fixture.

Conquer → Import Zen Cookies optionally copies Zen Browser's unexpired sessions after confirmation
(from its profile's `cookies.sqlite`, default space only); opening Conquer does not import cookies automatically. Check runs (`--info`) keep its
cookies and tabs to themselves; `notifyutil -p com.paseo.command.native.mode.<run>` switches sides, `….open.<run>`
opens `<info>.url`'s address in a tab, `….conquer.<run>` runs `<info>.do`'s steps a second apart (a command's name,
`folder <name>`, `into <n>`, `drag <tab> <folder|-> <index>`, `type <text>`, `find <text>`, `roundtrip`; see
`ConquerView.check`), `….key.<run>` presses ⌘ and `<info>.key`'s character as a key press would, and the snapshot hook
draws Conquer over the map while it shows. `….appopen.<run>` opens `<info>.url` as a link clicked in the chat would.

## Checks without screen recording

`--info /tmp/x.json` names files for hooks posted with `notifyutil -p <name>.x` (only a copy
launched with `--info` listens, under names ending in its info file's name, so the user's own copy
ignores them; such a copy keeps its page storage in memory, apart from the user's copy):
`com.paseo.command.native.eval` runs `/tmp/x.js` in the page and writes `/tmp/x.out`;
`.snapshot` writes `/tmp/x.png` (SpriteKit's frame under the page's snapshot); `.info` rewrites
`/tmp/x.json` (with the terminal panel's state); `.pan` drags the map for 10 s; `.resize` alternates
the window size; `.reload` runs the palette’s Restart app command; `.terminal` toggles the panel; `.dock` moves it between right and bottom; `.maximize` lays it over the map and back; `.divider` drags the panel's divider 150 points towards the map; `.split` splits the current pane with another tab; `.unsplit` returns to one pane; `.newterminal` opens a terminal; `.zoom` enlarges its text; `.type` types
`/tmp/x.type` into its terminal; `.quit`.

Measurements against the web Atlas are in [MEASUREMENTS.md](MEASUREMENTS.md)
(`node native/scripts/measure.mjs`).
