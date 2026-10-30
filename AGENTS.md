# Paseo Command — development

## User requirements

- `main` tracks `origin/main` at `github.com/owenconti/paseo-command`. Push only `main`, there.
  Do not publish elsewhere, stream build-room events, or send this project to phaser.io.
- Do not sign in to Phaser AE, reconnect an online project, reinstall its skill, or start its room streamer.
- The Phaser AE account was disconnected and its installed skill removed at the user’s request.
- The cached Phaser prototype and engine were removed at the user’s request. Do not restore them.
- The current SpriteKit app lives in this checkout. The original app is preserved read only in ignored `archive/legacy-app/` where available. Preserve the inherited React UI.
- Public history was sanitized. Never merge or push branches or tags from the old private repository (`paseo-cc-ui`); review and cherry-pick needed changes onto current `main`. Keep all recovery bundles and local archives private. Use a GitHub noreply commit email and run `npm run public:check -- --history` before pushing.
- When you need to ask the user a question, use the ask-question tool (`AskUserQuestion`) rather than asking in plain text.
- Anything you ask the user to review, such as a plan, description or summary, must be in your visible reply,
  never only in your reasoning: the user does not see your thoughts.

## Checkout and worktrees

- `paseo-command/` is the main checkout on local `main`.
- Use Paseo’s default worktree location: `~/.paseo/worktrees/<project-hash>/<slug>/`.
  Create workspaces through Paseo; do not add a custom worktree folder, helper command,
  placement plugin or root override for this app. Use local `main` as the base.
- `archive/` and `.paseo-command/` contain preserved history/assets and runtime data;
  do not stage them into the app repository.
- `archive/legacy-app/` owns its own historical worktrees in its `worktrees/` folder.
- The old `paseo-cc-phaser-ae` compatibility symlink was removed at the user’s request.
  Use `paseo-command` for all work.
- See `DIRECTORIES.md` for the folder inventory and relocation notes.

## Product and references

Paseo Command visualizes hosts, projects, workspaces and agents from the Paseo daemon.
The React app and official SDK API are in `web/`. The Atlas world is drawn by the macOS app in
`native/` (SpriteKit, under the React app in a WKWebView); its layout and art are in `rendering/`.
The user removed the Phaser renderers (the web Atlas and the Galaxy world): in a plain browser the
panels work and the map area says it is drawn by the macOS app. Do not add further worlds unless asked.
The user’s five supplied top-down illustrations guide the Atlas world: blue water,
parchment hex islands, project landmarks, workspace cottages, and model-colored robots (Claude orange,
ChatGPT/Codex white; other providers keep a stable colour of their own).
The attached illustrations are references, not full-screen backgrounds.
Real state must remain truthful: distinguish running, idle, completed/unread, approval,
question, failure and offline. Test daemon mutations against fake daemons only.
The Atlas uses generated painted sprites; it is not yet finished reference-quality art.

## Command palette

The command palette (⌘K, `web/src/CommandPalette.tsx`) lists what the app can do. Its entries are
`paletteCommands` in `web/src/main.tsx` (the open agent's own in `agentCommands`), ranked by `web/src/palette.ts`.
Whenever you add, rename, remove or change a user-facing action (a button, a key, a menu item, a native
View or Conquer menu command), update its palette entry in the same change: label, `keys`, `keywords`, and the
condition it shows under (only when it would work). Actions owned by a component reach it through
`runAppCommand`/`onAppCommand` (`web/src/appCommands.ts`); native menu items go through
`postNative({ type: "menu", action })`, handled in `WorldWindow.swift`'s `"menu"` case. Keep the keyboard
shortcuts dialog (`web/src/ShortcutsButton.tsx`) in step with any keys you add.

## Completing a feature

Once the requested feature or fix is implemented and validated, commit it (one commit per fix) and merge it into
local `main`. If working directly on `main`, commit the completed feature there. Then push `main` to
`origin` (`git push origin main`; no force push unless the user asks). Do not push other branches.
Preserve unrelated work in the checkout.

Then, from the main checkout on `main`, rebuild the web app and the macOS app:

```sh
npm run app:update   # app:build && native:build
```

This is part of completing the feature. It does not restart the app server, so open pages, their
daemon connections and terminals stay connected. Never quit, relaunch
or open the user's macOS app, and do not run `app:restart` for an update: the app keeps running, its mode bar
shows "Update ready · Restart app" once a newer native build is on disk. The user chooses **Restart app**
in the command palette (⌘K) when they want the update; it has no keyboard shortcut or native menu item.
Restart app first runs `app:refresh`, which restarts the server only if its own code (`web/server/`, the Vite
config, dependencies, the launcher) changed since it started; then restarts the app with the latest
native build, keeping the window position and page. The server serves each new `web/dist` build without a restart.
If you made a Paseo workspace (worktree) for the work, archive it once its branch is merged into `main` and pushed
(remove any `node_modules` symlinks you added to it first), so finished work leaves no workspace behind on the map.
Report the commit, whether the push succeeded, whether the build succeeded, and that the workspace was archived.

## Commands

- `npm run app:install`: installs `rendering/` and `web/` dependencies.
- `npm run app:dev`: React UI, SDK API and the Atlas world on port 4310, bound to `127.0.0.1`.
- `npm run app:start`: detached preview of the built app and API, bound to `127.0.0.1`;
  run from a human terminal. Access it on this machine at port 4310. Do not expose this unauthenticated API through a proxy or tunnel.
- `npm run app:stop`, `app:restart`, `app:refresh`, `app:status`: manage that detached preview.
  Restart preserves its port; refresh restarts it only when the server's own code changed. See `RUNNING.md`.
- `npm run app:build`: layout tests, then type-checks and bundles the app to `web/dist/`.
- `npm run app:update`: `app:build` and `native:build`, after merging to `main` (see above); Restart app in the command palette applies it.
- `npm run app:typecheck`: checks React, API and Atlas TypeScript.
- `npm run app:e2e`: browser tests of the Atlas against a mocked fleet (no daemon is reached).
- `npm run native:build`, `native:run [-- --url …]`: the macOS app (`native/`) that draws the Atlas with
  SpriteKit under the React app in a WKWebView; `native:mock` serves web/dist with a mocked fleet. See `native/README.md`.
  The app starts the app server itself (`app:start` on its URL's port) when it isn't running, and again if it stops;
  the server keeps running after the app quits. Check runs pass `--no-server`.
  Launch it with `open -g` and `--background` for checks; it must never take the user's focus.
- `npm run render:test`: layout and tile tests.

The earlier cached Phaser AE prototype, engine, generated build and prototype-only npm commands
were removed at the user’s request.
Local assets belong in the repository and are included through local build tooling.

## Structure

- `rendering/src/world.ts`: Atlas vocabulary, axial geometry and the deterministic fleet layout.
- `rendering/src/placement.ts`, `camera.ts`, `outline.ts`, `pick.ts`, `ribbon.ts`: where structures, props,
  flags, banners, tiles and robots stand, and the camera, outline and picking rules (ported to Swift).
- `rendering/src/art.ts`, `terrain.ts`: the sprite frames and the painted sea, landmasses and islands.
- `rendering/src/atlas.ts`: `mountAtlas(parent, handlers)`, the embedding API (null outside the macOS app).
- `rendering/src/sample.ts`: illustrative fleets for the layout tests.
- `web/src/NativeWorld.tsx`: maps the React app's host-qualified world snapshot to the Atlas,
  forwards map picks as selections and draws app selections on the map.
- `web/server/`: inherited official Paseo SDK API, served with the app on loopback only.
- `web/e2e/`: browser tests with every `/api` request answered in the browser.
- `web/src/Dispatch.tsx` `NewAgent`: a new agent opens in the panel as an empty conversation (host, where and
  branch in a small form) with the usual composer; its first message creates the agent. Its /skills and @files
  come from `GET /api/drafts/commands|files` (`web/server/api/drafts.ts`), as no agent exists yet.
  Its provider picker also lists the host's Paseo agent profiles (`GET /api/profiles`, the daemon config's `agentProfiles`):
  one sets provider, model, thinking and mode, and sends its feature values (`features` in `POST /api/dispatch`) while unchanged.
  In Worktree mode a pull request can be chosen instead of a new branch (`web/src/PrPicker.tsx`: paste a number or URL,
  or search via `GET /api/drafts/prs`); the worktree checks out its branch as the Paseo app does (`pr` in `POST /api/dispatch`).
  Preset prompts from `~/.paseo-command/settings.json` (`{"presets":[{"name","prompt"}]}`, `GET /api/presets`,
  `web/server/presets.ts`; `PASEO_COMMAND_SETTINGS` overrides the path, and an older `settings.json` in the data
  directory is moved there on first read) show as buttons that launch the agent at once; `{{pr}}` names the chosen pull request.
  They are edited in the app (`web/src/PresetsEditor.tsx`, from Settings or New agent; `POST /api/presets` keeps the file's
  other keys and never overwrites an unreadable file); `web/src/presetsStore.ts` shares them across the page.
  The same `settings.json` keeps the Linear workspace (`linearWorkspace`; `GET`/`POST /api/settings`,
  `web/server/settings.ts`), which the page once kept in localStorage and moves into the file on load.
- `rendering/src/native/bridge.ts`: inside the native app, the Atlas world `mountAtlas` returns: it lays out and paints
  with the shared modules (`placement.ts`, `art.ts`, `terrain.ts`) and posts the result to Swift (`native/Sources/`),
  which draws, animates and owns camera, hover and picking under a transparent page.
- `native/Sources/PaseoCommandNative/TerminalDrawer.swift`: the macOS app's terminal panel on the right or docked at the bottom (View → Terminal, ⌃`; Terminal at Bottom or
  the panel's dock button moves it; its inner edge resizes it; ⌘+ / ⌘− / ⌘0 size its text; Maximize Terminal, ⇧⌘↩ or its button, lays it over the
  map only, the page's panels staying in view): tabs for the selected workspace's (or agent's) daemon terminals, drawn by SwiftTerm. Opening the panel
  starts a terminal if the workspace has none; + opens another; a tab's × ends it. Tabs drag onto a pane's edge to split it (`PaneLayout`), or its middle to replace it;
  the unsplit button (View → Unsplit Terminals) or dropping a pane's tab on the tab bar undoes splits.
  It talks to `web/server/api/terminals.ts`: `GET /api/terminals`, `POST /api/terminals/create|kill`, and the
  `/api/terminal` socket relaying a terminal's bytes (screen replay first) and its keys and size.
  `native/scripts/fake-server.ts` runs the real server against a fake daemon (with terminals) for checks.
- `web/src/AddProject.tsx`: the Projects tab's Add project panel. On a chosen host, browse its folders
  (`GET /api/folders`, folder names only) and register the open folder, make a new folder in it, or clone a
  pasted GitHub repo into it (`web/server/api/projects.ts`); New agent then opens on the new project.
  A project is renamed in place (its title, `POST /api/projects/:id/rename`; the pencil on its row or view) and removed
  after confirming (`web/src/RemoveProjectDialog.tsx`, `POST /api/projects/:id/remove`: Paseo archives its workspaces and
  unregisters it; the folder stays). Moving a project's folder isn't offered: the daemon has no call for it.
- `web/server/asks.ts`: what an idle agent's last reply asks of you, judged once per reply by TypeSafe's Jev
  (`TYPESAFE_API_KEY`, else `typesafeApiKey` in the data directory's `secrets.json`): code splits the reply into
  sentences and keeps only questions and requests (`web/src/asks/sentences.ts`, `mayAsk`), Jev judges which ask you, their kind, a pick's options, and whether
  the reply waits on you. `POST /api/agents/:id/asks`, `GET /api/asks` (status). The composer offers the questions
  (`web/src/composer/AskStrip.tsx`) with quick replies; a reply that waits on you is the map's `asking` state
  and counts as needing you.
  In the same request Jev picks an obvious next reply, if one clearly fits (≥ 0.85), from fixed templates in
  `web/src/asks/suggestions.ts` (`{pr}` filled from the reply when it names one PR); never when the reply asks a pick or open
  question. The composer shows it as "You might say" (`web/src/composer/SuggestStrip.tsx`); one click sends it.
  Open questions then get two or three answers drafted by a helper agent on the daemon's metadata model, as the current
  work summary is (`web/server/askAnswers.ts`, `runHelper` in `workingOn.ts`); the strip shows them as quick replies.
  Hovering the strip marks the questions' sentences in the transcript (`web/src/asks/highlight.ts`, CSS Highlight API).
- `web/src/urlState.ts`: the panel's place (selection, subagent, tab, filter, host filter, list toggle) kept in
  the page's query, so a refresh returns there; a new selection pushes history, other changes replace it.
- `web/src/games/`: the panel header's mini games (gamepad button), a floating non-modal window with one game dealt at
  random by the server (`web/server/games.ts`, `/api/games`): no choosing or restarting, the next game only once it ends.
  Progress and each game's best score are kept in the data directory's `games.json`. Games implement `types.tsx`'s
  `GameDef` (plain JSON state) and are listed in `catalog.ts` and `registry.ts`.
- `web/server/probe.ts`: Probe's verdict (Diagonal's `diagonalprobe` review bot) on each workspace's open PR, from one
  read-only `gh api graphql` query per PR (`GET /api/probe`, polled by `web/src/useProbe.ts`): reviewing, approved,
  findings open (with their count), stale (new commits since, or deferred) or failed. The Atlas sets a medallion of its own in the
  workspace's first cell (the one facing its landmark): enamel in the verdict's colour round an original review magnifier,
  with a glyph badge (`rendering/src/probe.ts`, `placeProbes`, `paintProbe`); its hover card
  says the verdict. `native:mock -- --probe` shows each.
- Host load: `web/server/hostStats.ts` (`GET /api/hoststats`, polled by `web/src/useHostStats.ts`) asks each online host's
  daemon for the `host-stats` plugin's `stats.snapshot` (github.com/owenconti/paseo-cc-plugins, installed per daemon) over
  `invokePluginRpc`; a host without it is left out. Its host banner gains a second line, `CPU · MEM · DISK` percents
  (`statParts` in `rendering/src/placement.ts`, `RIBBON_DETAIL` in `ribbon.ts`; 90% and over in red). `native:mock -- --stats` shows it.
- Auto-merge: a PR's `autoMerge` comes from Paseo's GitHub facts (`autoMergeRequest`), else gh's (`web/server/links.ts`).
  While it's on, a teal seal with a merge mark sits on the review medallion's upper-right rim, else the CI one's (`placeSeals`,
  `paintSeal`, `AUTO_MERGE` in `rendering/src/prStatus.ts`); the medallion's hover card says how it merges and who turned it on.
- Apple Music bar: `web/src/MusicBar.tsx` floats in the map's top-left corner (macOS app only) with Music's current track,
  its art and ⏮ ⏯ ⏭; with Music closed it offers play, which opens Music without focus and resumes. The app reads and drives
  Music by AppleScript (`native/Sources/PaseoCommandNative/Music.swift`, about once a second while the window shows) over the
  `paseoMusic` message handler and `paseo:music` events; macOS asks once for Automation permission (`NSAppleEventsUsageDescription`).
- Conquer (experiment): the COMMAND / CONQUER strip across the macOS app's top (⌘` steps Command → Conquer → Linear; View menu; the tabs light on hover)
  switches the map's place between the map and Conquer, a WebKit browser (`native/Sources/PaseoCommandNative/Conquer.swift`),
  laid exactly over the map (`placeConquer` in `WorldWindow.swift`): the panels and terminal stay, and ⌘B (the page's panel toggle)
  gives it the window's width. The hidden side keeps running. Conquer takes its keys only while it has the keyboard (`hasKeyFocus`),
  so the chat panel keeps ⌘L and the rest.
  Back/forward/reload and the address bar (suggestions from its history, `ConquerExtras.swift`) run along the top of the page
  (`PageBar.swift`). Its sidebar, as in Zen and Arc: pinned tabs and their folders (one level; drag to reorder, pin above New Tab, unpin below it, into and out of folders;
  right-click for Pin, Back to Pinned Page, Replace Pinned URL with Current URL, Move to Folder, Rename, Delete), New Tab, then the other tabs (`ConquerTabs.swift`), each with
  its favicon or a spinner. A closed pinned tab only unloads. Its commands (`ConquerView.commands`, the Conquer menu) take their keys ahead of
  the page: ⌘T, ⇧⌘T reopen, ⌘W, ⌘L, ⌘E or ⌃Tab next tab, ⌘1…⌘8 that tab, ⌘9 the last, ⌘D pin, ⌘[ ⌘], ⌘F ⌘G ⇧⌘G find,
  ⌘+ ⌘− ⌘0 zoom (per site), ⌘P print, ⇧⌘J downloads. App restart is only in the React command palette, without a shortcut. It has its own persistent cookie store,
  optionally seeded after confirmation through Conquer → Import Zen Cookies from Zen Browser's profile (`ZenCookies.swift`): a copy of
  `cookies.sqlite`, default space only, unpartitioned and unexpired; Zen is never written to. Its tabs (`conquerState`), sidebar width, zooms,
  history (`~/Library/Application Support/Paseo Command/conquer-history.json`) and the mode come back on launch; tabs come back unloaded.
- Linear (the mode bar's third tab, after Command and Conquer; View menu; palette "Show your Linear issues"): the page draws
  `web/src/LinearView.tsx` over the map's frame while the app reports `paseo:mode` `linear` (`useAppMode`, `web/src/appMode.ts`;
  the page asks with a `mode` message). It lists the open issues assigned to you, grouped by state, beside the chosen one's
  details (description, links, comments), read-only from Linear (`web/server/linear.ts`, `GET /api/linear/issues[/KEY]`, with
  `LINEAR_API_KEY` or `linearApiKey` in `secrets.json`). Launch agent opens New agent with the issue (`DispatchTarget.issue`):
  Worktree on Linear's branch name, the composer's draft naming the issue; presets take `{{issue}}` and the issue's details.
- Web links clicked in the chat (`.session`, `openInAppBrowser` in `web/src/Session.tsx`, `postAppLink` → the `openLink` message)
  switch to Conquer and open there as a new tab, once its tabs are restored (`whenStarted`).

## Atlas world

The app bundles `rendering/` directly; the bridge paints its art in the page and SpriteKit draws it.
Each project with workspaces is its own island (projects without workspaces are hidden, as are hosts without any; if no host has workspaces, each shows as a bare clearing): a ten-hex
landmark (rows of 3, 4, 3) in the middle, ringed by its workspaces, each touching it. Workspaces are placed
oldest first (then by id; never by their changing titles, so nothing swaps places): bottom, lower-left, lower-right, upper-left, upper-right, then top, a cell apart (later ones stand against
that ring). A workspace is a three-hex light-dirt triangle pointing at the landmark, its cottage larger and centred
across all three, with no plants beside it so its PR medallions stand clear. Each agent is a robot on its own light-tiled hex beside its workspace, growing away from
the landmark, oldest first: straight out, then alternating left and right. Islands are only these built cells:
no empty sand around them (the user removed it). A host's islands share one landmass of grass hex tiles (hexes everywhere) with a hex-edged shore in a generated sea, under the host's
banner (offline hosts are faded and labeled). Each agent's state shows only on its sand hex (fill, border colour, border motion: a light runs round
running borders, states that need you pulse); robots carry no rings or badges. Hosts, projects, workspaces and
agents each have their own hover border colour; hosts are not interactive on the map (no hover, no pick from land or banner). The user asked for water back (rejecting chart paper, and a plain meadow background), with each
host as a landmass; project islands sit on it on earthen banks with soft shadows.
The layout follows the map's aspect ratio: hosts shelf-pack and tall maps stack vertically.
Agents the daemon reports without a workspace wait at a flagged camp, laid out like a workspace.
Each landmark's paving carries props (`props.png`): three seeded pieces of greenery and workshop gear, two lamps
lit while any of the project's agents is running, and a beacon that flares, in the most urgent state's colour,
when one needs approval, has a question or failed. Props keep off the landmark's art, its name and the kerb.
Every item (landmarks, cottages, plaza props, lamps and beacons, robots, PR medallions) casts a soft shadow under a noon sun: centred
beneath it and showing evenly on every side, so it never turns as a robot does. The page paints each frame's `<frame>-shadow`
(`shadowOf`, `SHADOW` in `rendering/src/native/bridge.ts`); structures' come as sprites, and Swift places those of lamps, PR medallions and robots (lighter).
The world is assembled from generated transparent sprite atlases, a terrain texture,
and a strict axial hex grid. It is not a screenshot used as a background.
The sea's glints and cloud shadows drift slowly in 15 Hz steps. The world renders on demand: 30 fps for ambient
motion, full rate while handled, paused when nothing moves or the window is hidden.
The inherited React UI is preserved; its panels follow the system's appearance: the Galaxy theme (as in the user's
reference) when it is dark, the Light theme when it is light (`worldLook` in `web/src/theme.ts`). The terminal panel and Conquer's chrome and pages follow it too
(their tones are `Ink` in `native/Sources/PaseoCommandNative/Textures.swift`).
Five original references may be retained locally in ignored `design/references/atlas-01.webp` through `atlas-05.webp`; they are not redistributed.
Artwork provenance and generation prompts are in `rendering/ASSETS.md`.
Architecture uses the original `buildings.png` plus `structures.png`: eight project landmarks
and seven workspace cottages, balanced deterministically across neighbours (`STRUCTURE_SAMPLE` in the tests).

## Confirmed map constraints

Labels stay at fixed world scale. Do not add screen-size compensation.
All structures and scenery consume whole cells on the shared axial grid.
Workspaces use three hexes; project landmarks use ten (rows of 3, 4 and 3); each agent uses one.
One island per project with workspaces.
Center artwork and fit it completely inside its occupied cells. Everything is seen from directly above: PR status shows
as flat enamel medallions (`medallions.png`) in a workspace's two yard cells, set a little beyond each cell's centre
away from the cottage (the user replaced the side-view PR flags, which looked like they were floating).
Selection follows the outer perimeter of the occupied hexes, never a rectangle: a golden rim with a breathing
yellow halo over a warm wash, so the selected entity reads on any surface. Hover and selection
rims are inset within the cells so painted kerbs and banks never clip them; an agent hovers across its whole cell.
Hosts are picked from the Hosts tab only (land and banner are not interactive): the map rings its landmass and the lists narrow to it, the same
host filter as the Hosts tab; any other selection takes the highlight while it lasts.
Project, workspace and agent cells each have a distinct tile style (flagstones, light dirt, light sand
tiles); islands have no empty cells. Minimum zoom fits the land with a one-cell border (plus room for banners and map controls);
panning stays within that extent. The world never sends daemon actions; the React UI owns them.
