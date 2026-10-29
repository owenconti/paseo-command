# Paseo Command — development

## User requirements

- `main` tracks `origin/main` at `github.com/owenconti/paseo-cc-ui` (private). Push only `main`, there.
  Do not publish elsewhere, stream build-room events, or send this project to phaser.io.
- Do not sign in to Phaser AE, reconnect an online project, reinstall its skill, or start its room streamer.
- The Phaser AE account was disconnected and its installed skill removed at the user’s request.
- The cached Phaser prototype and engine were removed at the user’s request. Do not restore them.
- The current SpriteKit app lives at `/Users/example/development/paseo-command`. The original app is preserved read only in `archive/legacy-app/`. Preserve the inherited React UI.
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
or open the user's macOS app, and do not run `app:restart` for an update: the app keeps running, its title bar
shows "Update ready · ⌘R" once a newer native build is on disk, and the user presses ⌘R when they want the
update. ⌘R first runs `app:refresh`, which restarts the server only if its own code (`web/server/`, the Vite
config, dependencies, the launcher) changed since it started; then it reloads the page, and swaps in a newer
native build in place, keeping the window and page. The server serves each new `web/dist` build without a restart.
Report the commit, whether the push succeeded, and whether the build succeeded.

## Commands

- `npm run app:install`: installs `rendering/` and `web/` dependencies.
- `npm run app:dev`: React UI, SDK API and the Atlas world on port 4310, bound to `0.0.0.0`.
- `npm run app:start`: detached preview of the built app and API, bound to `0.0.0.0`;
  run from a human terminal. Access it through localhost or a host network address on port 4310.
- `npm run app:stop`, `app:restart`, `app:refresh`, `app:status`: manage that detached preview.
  Restart preserves its port; refresh restarts it only when the server's own code changed. See `RUNNING.md`.
- `npm run app:build`: layout tests, then type-checks and bundles the app to `web/dist/`.
- `npm run app:update`: `app:build` and `native:build`, after merging to `main` (see above); ⌘R applies it.
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
- `web/server/`: inherited official Paseo SDK API, served with the app on all interfaces.
- `web/e2e/`: browser tests with every `/api` request answered in the browser.
- `web/src/Dispatch.tsx` `NewAgent`: a new agent opens in the panel as an empty conversation (host, where and
  branch in a small form) with the usual composer; its first message creates the agent. Its /skills and @files
  come from `GET /api/drafts/commands|files` (`web/server/api/drafts.ts`), as no agent exists yet.
  In Worktree mode a pull request can be chosen instead of a new branch (`web/src/PrPicker.tsx`: paste a number or URL,
  or search via `GET /api/drafts/prs`); the worktree checks out its branch as the Paseo app does (`pr` in `POST /api/dispatch`).
  Preset prompts from the data directory's `settings.json` (`{"presets":[{"name","prompt"}]}`, `GET /api/presets`,
  `web/server/presets.ts`) show as buttons that launch the agent at once; `{{pr}}` names the chosen pull request.
- `rendering/src/native/bridge.ts`: inside the native app, the Atlas world `mountAtlas` returns: it lays out and paints
  with the shared modules (`placement.ts`, `art.ts`, `terrain.ts`) and posts the result to Swift (`native/Sources/`),
  which draws, animates and owns camera, hover and picking under a transparent page.
- `native/Sources/PaseoCommandNative/TerminalDrawer.swift`: the macOS app's terminal panel on the right (View → Terminal, ⌃`; its left edge resizes it):
  tabs for the selected workspace's (or agent's) daemon terminals, + for a new one, × to end one, drawn by SwiftTerm.
  It talks to `web/server/api/terminals.ts`: `GET /api/terminals`, `POST /api/terminals/create|kill`, and the
  `/api/terminal` socket relaying a terminal's bytes (screen replay first) and its keys and size.
  `native/scripts/fake-server.ts` runs the real server against a fake daemon (with terminals) for checks.
- `web/src/AddProject.tsx`: the Projects tab's Add project panel. On a chosen host, browse its folders
  (`GET /api/folders`, folder names only) and register the open folder, make a new folder in it, or clone a
  pasted GitHub repo into it (`web/server/api/projects.ts`); New agent then opens on the new project.
- `web/server/asks.ts`: what an idle agent's last reply asks of you, judged once per reply by TypeSafe's Jev
  (`TYPESAFE_API_KEY`, else `typesafeApiKey` in the data directory's `secrets.json`): code splits the reply into
  sentences (`web/src/asks/sentences.ts`), Jev judges which ask you, their kind, a pick's options, and whether
  the reply waits on you. `POST /api/agents/:id/asks`, `GET /api/asks` (status). The composer offers the questions
  (`web/src/composer/AskStrip.tsx`) with quick replies; a reply that waits on you is the map's `asking` state
  and counts as needing you.
- `web/src/urlState.ts`: the panel's place (selection, subagent, tab, filter, host filter, list toggle) kept in
  the page's query, so a refresh returns there; a new selection pushes history, other changes replace it.
- `web/src/games/`: the panel header's mini games (gamepad button), a floating non-modal window with one game dealt at
  random by the server (`web/server/games.ts`, `/api/games`): no choosing or restarting, the next game only once it ends.
  Progress and each game's best score are kept in the data directory's `games.json`. Games implement `types.tsx`'s
  `GameDef` (plain JSON state) and are listed in `catalog.ts` and `registry.ts`.
- `web/server/probe.ts`: Probe's verdict (Diagonal's `diagonalprobe` review bot) on each workspace's open PR, from one
  read-only `gh api graphql` query per PR (`GET /api/probe`, polled by `web/src/useProbe.ts`): reviewing, approved,
  findings open (with their count), stale (new commits since, or deferred) or failed. The Atlas hangs a streamer in the
  verdict's colour, with Probe's mark (`rendering/src/assets/probe.png`), from the review flag's pole
  (`rendering/src/probe.ts`, `placeStreamers`); the flag's hover card adds a Probe line. `native:mock -- --probe` shows each.

## Atlas world

The app bundles `rendering/` directly; the bridge paints its art in the page and SpriteKit draws it.
Each project with workspaces is its own island (projects without workspaces are hidden, as are hosts without any; if no host has workspaces, each shows as a bare clearing): a ten-hex
landmark (rows of 3, 4, 3) in the middle, ringed by its workspaces, each touching it. Workspaces are placed
bottom, lower-left, lower-right, upper-left, upper-right, then top, a cell apart (later ones stand against
that ring). A workspace is a three-hex timber triangle pointing at the landmark, its cottage larger and centred
across all three. Each agent is a robot on its own light-tiled hex beside its workspace, growing away from
the landmark, oldest first: straight out, then alternating left and right. Islands are only these built cells:
no empty sand around them (the user removed it). A host's islands share one landmass of grass hex tiles (hexes everywhere) with a hex-edged shore in a generated sea, under the host's
banner (offline hosts are faded and labeled). Each agent's state shows only on its sand hex (fill, border colour, border motion: a light runs round
running borders, states that need you pulse); robots carry no rings or badges. Hosts, projects, workspaces and
agents each have their own hover border colour; hosts are not interactive on the map (no hover, no pick from land or banner). The user asked for water back (rejecting chart paper, and a plain meadow background), with each
host as a landmass; project islands sit on it on earthen banks with soft shadows.
The layout follows the map's aspect ratio: hosts shelf-pack and tall maps stack vertically.
Agents the daemon reports without a workspace wait at a flagged camp, laid out like a workspace.
Each landmark's paving carries props (`props.png`): a seeded mix of greenery and workshop gear, two lamps
lit while any of the project's agents is running, and a beacon that flares, in the most urgent state's colour,
when one needs approval, has a question or failed. Props keep off the landmark's art, its name and the kerb.
The world is assembled from generated transparent sprite atlases, a terrain texture,
and a strict axial hex grid. It is not a screenshot used as a background.
The sea's glints and cloud shadows drift slowly in 15 Hz steps. The world renders on demand: 30 fps for ambient
motion, full rate while handled, paused when nothing moves or the window is hidden.
The inherited React UI is preserved; its panels use the Galaxy theme, as in the user's reference.
Five original references are retained in `design/references/atlas-01.webp` through `atlas-05.webp`.
Artwork provenance and generation prompts are in `rendering/ASSETS.md`.
Architecture uses the original `buildings.png` plus `structures.png`: eight project landmarks
and seven workspace cottages, balanced deterministically across neighbours (`STRUCTURE_SAMPLE` in the tests).

## Confirmed map constraints

Labels stay at fixed world scale. Do not add screen-size compensation.
All structures and scenery consume whole cells on the shared axial grid.
Workspaces use three hexes; project landmarks use ten (rows of 3, 4 and 3); each agent uses one.
One island per project with workspaces.
Center artwork and fit it completely inside its occupied cells. PR flags are the exception: each pole's foot stands at
its cell's centre, at full size, and the cloth may rise past the cell's upper edge (the user's choice).
Selection follows the outer perimeter of the occupied hexes, never a rectangle: a golden rim with a breathing
yellow halo over a warm wash, so the selected entity reads on any surface. Hover and selection
rims are inset within the cells so painted kerbs and banks never clip them; an agent hovers across its whole cell.
Hosts are picked from the Hosts tab only (land and banner are not interactive): the map rings its landmass and the lists narrow to it, the same
host filter as the Hosts tab; any other selection takes the highlight while it lasts.
Project, workspace and agent cells each have a distinct tile style (flagstones, timber decking, light sand
tiles); islands have no empty cells. Minimum zoom fits the land with a one-cell border (plus room for banners and map controls);
panning stays within that extent. The world never sends daemon actions; the React UI owns them.
