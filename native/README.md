# Paseo Command for macOS

A macOS app that shows the Paseo Command React app in a `WKWebView`. The page draws the fleet
itself (Crew) as well as its panels and pages; the app adds the native mode bar, Conquer, the
Terminal tab, the Files editors' terminals and the robot's browser. It builds with the Command
Line Tools alone (`swift build`; no Xcode project). There is no SpriteKit map any more.

```sh
npm run native:build                 # swift build -c release, wrapped as native/build/Paseo Command Dev.app
npm run native:run                   # opens it without taking focus, on http://127.0.0.1:4321/
npm run native:run -- --url http://127.0.0.1:4331/
```

**Flavours.** `npm run native:build` makes the dev flavour, `native/build/Paseo Command Dev.app`
(bundle id `io.github.owenconti.paseo-command.dev`, port 4321, no updates, data in
`~/Library/Application Support/Paseo Command Dev/`). `sh native/scripts/bundle.sh --release` (run by
`npm run release`) makes `native/release/Paseo Command.app` (`io.github.owenconti.paseo-command`, port 4310,
Sparkle updates, data in `~/Library/Application Support/Paseo Command/`), signed with the maintainer's
Developer ID under the hardened runtime (entitlements in `native/entitlements/`) and notarized by `npm run release`. Both carry `Contents/Resources/node/node` (Node for Apple silicon; the app supports Apple silicon Macs only),
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
(`ShellEnvironment.swift`). Its data, `logs/server.log` and the app's own `logs/native.log` (what it
notes, also on standard error) are in
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
default its own server, above). Against a mocked fleet instead of a daemon:

```sh
npm --prefix web run build
npm run native:mock -- --fleet large --port 4331   # web/dist plus a mocked API; mutations refused
npm run native:run -- --url http://127.0.0.1:4331/
```

The icon (`native/AppIcon.icns`) is drawn from the Atlas's own robot art by
`swift native/scripts/icon.swift`.

Options: `--size <w>x<h>`, `--front` (show in front without activating), `--background`,
`--ignore-occlusion` (the page and the robot's browser keep drawing while covered), `--no-server`,
`--info <path>` (window number and process ids as JSON; also the base path for the `notifyutil` hooks below).

## How it fits together

- **The page draws everything in the window's body.** Crew (the fleet as a chat app), the session
  panel and the pages (GitHub, Activity, Files, Settings) are the React app's, as in a browser; the
  page keeps every pointer and key event, and the web view stays first responder.
- **Native views stand in the map's place.** Conquer, the Terminal tab, the Files editors' terminals
  and the robot's browser lie in `content`, a pass-through view over the page, below the mode bar.
  The page says where its map area is (`viewport`, in its CSS pixels; until it does, the whole of
  `content`), where the Files editor and the robot's browser go (`editor`, `browser`), and which
  workspace the Terminal tab follows (`workspace`).
- **The splash** covers the window until the page posts `loaded` (its fleet is in), or a minute at most.

## Terminal tab

The terminals live only in the Terminal tab (there is no side or bottom panel): the mode bar's tab after Files, ⌘3 by its
place, ⌘` through the tabs, View → Show Terminal (⌃`) from anywhere, ⌘K "Show terminal". It shows the daemon's terminals for
the selected workspace (or the selected agent's) full size in the map's place, as Conquer lies, the session panel beside it (⌘B
hides it, the terminal keeping the keyboard), and starts a terminal as it opens if the workspace has none. In the tab ⌃` (View →
Back from Terminal) goes back to the side before it. One tab per terminal: + opens another, a tab's × ends it (after asking,
unless told not to ask again). A tab dragged onto a pane's edge splits that pane and shows there; dropped in a pane's middle it
takes that pane's place; a click on a tab not showing puts it in the current pane. The unsplit button (shown while split; View →
Unsplit Terminals) returns to one pane, the current terminal's, the others staying as tabs; a pane's tab dropped back on the tab
bar leaves the panes too. Each workspace keeps its panes while the app runs, and the tab keeps them while another shows. ⌘+ / ⌘−
/ ⌘0 (View) change the terminals' text size while the tab shows (or a Files editor has the keyboard), kept across launches. The
old panel's saved preferences (`terminalOpen`, `terminalDock`, its sizes) are ignored. Leaving the tab or switching workspace leaves terminals
running on the daemon. SwiftTerm draws them; the app server relays each over `/api/terminal`
(`web/server/api/terminals.ts`), replaying its recent screen first. To check it without a real
daemon:

```sh
npm --prefix web run build
web/node_modules/.bin/tsx --import ./web/server/test-setup.ts native/scripts/fake-server.ts --port 4332
npm run native:run -- --url 'http://127.0.0.1:4332/?agent=a-1' --no-server
```

Its terminal replays queries, `queries` asks them live and `nvim`, then `:q`, asks DA1 and XTVERSION as it quits; the fake
echoes ESC as `^[`, so an answer typed into the shell shows. `PASEO_TERMINAL_TRACE=/tmp/trace.jsonl` before the server logs
each frame both ways, timed (replay frames marked, dropped answers too); `--info`'s terminal `queries` counts what the app
took out, answered and dropped (`TerminalQueries.swift`).

## Conquer

The strip across the top switches the map's place between Crew (Command), Files, the Terminal tab, GitHub, Conquer, Activity and Settings (Activity and GitHub only while enabled; View → Show Files, ⇧⌘E, shows Files from anywhere; a GitHub pull request's link opens in the GitHub tab, and a Linear issue's in Linear's desktop app when it's installed (`LinearLink.swift`), else in Conquer; ⌘` steps through them in turn; Activity's tab shows its unread count); Conquer is a tabbed browser with its own persistent
cookie store. ⌘B toggles the React app panel even while a browser page has focus; ⌘S toggles Conquer's tab sidebar, restoring its width.
With the keyboard in Conquer, ⌘R reloads the current page and ⇧⌘R reloads it without cache; both are also in the Conquer menu and command palette.
Its native toolbar, tab list, find bar, suggestions and downloads use shared flat control primitives matching the React panel.
Their colors and control metrics are generated from `web/src/styles/tokens.css` (Light) and `web/src/themes.css` (Galaxy),
and the app bundles the same Inter and Source Sans body fonts. After changing those CSS tokens, run
`node native/scripts/theme.mjs` and commit `NativeTheme.swift`; `native:build` checks it for drift.

Closing the last ordinary tab selects a remaining pinned page, even if it is unloaded.
With no replacement, the browser stays empty; the address bar and New Tab still work.
Closing a pinned page only unloads it. `npm run native:test` checks these transitions in an
isolated process with nonpersistent storage and a loopback page fixture.

1Password fills Conquer's pages with its Universal Autofill (⌘\\, a system hotkey the app never sees) through the
accessibility tree: the page's fields (iframes' too) and its address (the web area's `AXURL`, and the window's `AXDocument`
while Conquer shows, `AppWindow`). It fills only apps with a real code signature, so use the release app, not the ad hoc
Dev build. macOS AutoFill isn't offered for other sites in a third-party WKWebView (see CLAUDE.md's Conquer notes).
`….key.<run>` with `\` in `<info>.key` sends ⌘\\ through the app's key path.

Conquer → Import Zen Cookies optionally copies Zen Browser's unexpired sessions after confirmation
(from its profile's `cookies.sqlite`, default space only); opening Conquer does not import cookies automatically. Check runs (`--info`) keep its
cookies and tabs to themselves; `notifyutil -p com.paseo.command.native.mode.<run>` switches sides, `….open.<run>`
opens `<info>.url`'s address in a tab, `….conquer.<run>` runs `<info>.do`'s steps a second apart (a command's name,
`folder <name>`, `into <n>`, `drag <tab> <folder|-> <index>`, `type <text>`, `find <text>`, `roundtrip`; see
`ConquerView.check`), `….key.<run>` presses `<info>.key`'s key (a character, `tab`, `→` or `←`, after any of ⌃ ⌥ ⇧; with ⌘ unless it starts with ⌃) as a key press would (key equivalents to the views, then the menu, else a key press to the focused view), and the snapshot hook
draws Conquer over the page while it shows. `….appopen.<run>` opens `<info>.url` as a link clicked in the chat would.

## Checks without screen recording

`--info /tmp/x.json` names files for hooks posted with `notifyutil -p <name>.x` (only a copy
launched with `--info` listens, under names ending in its info file's name, so the user's own copy
ignores them; such a copy keeps its page storage in memory, apart from the user's copy):
`com.paseo.command.native.eval` runs `/tmp/x.js` in the page and writes `/tmp/x.out`;
`.snapshot` writes `/tmp/x.png` (the page's snapshot with the native views over it; it draws the Terminal tab's text blank, and shows views that aren't on screen); `.windowshot` writes `/tmp/x-window.png`, the window as the screen shows it (with `--ignore-occlusion`, or WebKit throttles while covered); `.info` rewrites
`/tmp/x.json` (with the Terminal tab's state); `.resize` alternates
the window size; `.reload` runs the palette’s Restart app command; `.terminal` is ⌃` (the Terminal tab, or back from it); `.terminaltab` shows the Terminal tab (`--info`'s `terminalPlace`: `map` while it shows, else `hidden`); `.split` splits the current pane with another tab; `.unsplit` returns to one pane; `.newterminal` opens a terminal; `.zoom` enlarges its text; `.type` types
`/tmp/x.type` into its terminal; `.files` shows the Files tab and `.command` Crew; `.quit`.
The robot's browser (`BoardBrowser.swift`; `--info`'s `browser`: each robot's tabs and where their pages are, the stage's
frame and holes, hosting): `.browser` runs `/tmp/x.browser`'s requests (a JSON list, each as the server relays an agent's
browser tool call: `{"host": "local", "request": {"requestId", "agentId", "workspaceId", "command": {"command", "args"}}}`) one
after another and writes their answers to `/tmp/x.browser.out`; `.browserfocus` gives the shown page the keyboard. With
`--ignore-occlusion` its pages draw while the window is covered, as the app's page does. The fake server serves a page at
`/__page` and takes `POST /__browser {"command": "new_tab", "args": {"url": …}}` as an agent's call through its fake daemon
(the app registers with it once the page has `world:browserTools` on).
