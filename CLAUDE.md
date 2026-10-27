# Paseo Command — local development

## User requirements

- Work locally. Do not publish, upload, stream build-room events, or send this project to phaser.io.
- Do not sign in to Phaser AE, reconnect an online project, reinstall its skill, or start its room streamer.
- The Phaser AE account was disconnected and its installed skill removed at the user’s request.
- Cached engine files under `phaser/` and `game/node_modules/` remain available for local builds. Do not edit the engine.
- The original `/Users/example/development/paseo-command` project is read only. Preserve its React UI; focus current development on the game world.

## Finishing each fix

- The user runs the app with `vite preview` on port 4310, which serves the built `web/dist/`.
  After every fix or task, commit it (one commit per fix) and run `npm run app:build` so a page
  refresh shows the change.

## Product and references

Paseo Command visualizes hosts, projects, workspaces and agents from the Paseo daemon.
The React app and official SDK API are in `web/`. The Atlas world renderer is in `rendering/`.
Two worlds draw the same fleet: Atlas (default) and Galaxy, chosen in the map toolbar (remembered;
⌘⌥T steps worlds). The user asked for Galaxy; do not add further worlds unless asked.
The user’s five supplied top-down illustrations guide the Atlas world: blue water,
parchment hex islands, project landmarks, workspace cottages, and model-colored robots.
The attached illustrations are references, not full-screen backgrounds.
Real state must remain truthful: distinguish running, idle, completed/unread, approval,
question, failure and offline. Test daemon mutations against fake daemons only.
The Atlas uses generated painted sprites; it is not yet finished reference-quality art.

## Commands

- `npm run app:install`: installs `rendering/` and `web/` dependencies.
- `npm run app:dev`: React UI, loopback SDK API and the Atlas world on http://127.0.0.1:4310.
- `npm run app:build`: layout tests, then type-checks and bundles the app to `web/dist/`.
- `npm run app:typecheck`: checks React, API and Atlas TypeScript.
- `npm run app:e2e`: browser tests of the Atlas against a mocked fleet (no daemon is reached).
- `npm run render:dev`: standalone Atlas study with illustrative data on http://127.0.0.1:4320.
- `npm run render:build`, `npm run render:test`: study bundle and layout/tile tests.

The earlier cached Phaser AE prototype in `game/` (with `npm run build`, `smoke`, `play`, `serve`)
is no longer used by the app. Any publishing, asset-upload, crew or account instructions in its
generated engine documentation are superseded by the user’s local-only requirements above.
Local assets belong in the repository and are included through local build tooling.

## Structure

- `rendering/src/world.ts`: Atlas vocabulary, axial geometry and the deterministic fleet layout.
- `rendering/src/AtlasScene.ts`, `terrain.ts`, `textures.ts`: Phaser 4 scene, islands and sprites.
- `rendering/src/atlas.ts`: `mountAtlas(parent, handlers, kind)`, the embedding API for both worlds.
- `rendering/src/galaxy/`: Galaxy layout (`layout.ts`), painters (`paint.ts`) and scene (`GalaxyScene.ts`).
  Hosts are nebula regions, projects textured rotating planets, workspaces orbiting stations, agents
  provider-coloured satellites whose running beams relay through their station to the planet.
  Surface, cloud and nebula maps come from the original project's Unity textures (`src/assets/galaxy/`).
- `rendering/src/main.ts`, `inspector.ts`, `sample.ts`: standalone study with illustrative data.
- `web/src/NativeWorld.tsx`: maps the React app's host-qualified world snapshot to the Atlas,
  forwards map picks as selections and draws app selections on the map.
- `web/server/`: inherited official Paseo SDK API, bound to loopback.
- `web/e2e/`: browser tests with every `/api` request answered in the browser.

## Atlas world

The app bundles `rendering/` directly; Phaser resolves from `rendering/node_modules`.
Each project with workspaces is its own island (projects without workspaces are hidden): a ten-hex
landmark (rows of 3, 4, 3) in the middle, ringed by its workspaces, each touching it. Workspaces are placed
bottom, lower-left, lower-right, upper-left, upper-right, then top, a cell apart (later ones stand against
that ring). A workspace is a three-hex timber triangle pointing at the landmark, its cottage larger and centred
across all three. Each agent is a robot on its own light-tiled hex beside its workspace, growing away from
the landmark, oldest first: straight out, then alternating left and right. Islands are only these built cells:
no empty sand around them (the user removed it). A host's islands share one landmass of grass hex tiles (hexes everywhere) with a hex-edged shore in a generated sea, under the host's
banner (offline hosts are faded and labeled). Each agent's hex takes the colour of its state. The user asked for water back (rejecting chart paper, and a plain meadow background), with each
host as a landmass; project islands sit on it on earthen banks with soft shadows.
The layout follows the map's aspect ratio: hosts shelf-pack and tall maps stack vertically.
Agents the daemon reports without a workspace wait at a flagged camp, laid out like a workspace.
The world is assembled from generated transparent sprite atlases, a terrain texture,
and a strict axial hex grid. It is not a screenshot used as a background.
The standalone study (`render:dev`) uses clearly labeled illustrative data and never connects to a daemon.
The inherited React UI is preserved; its panels use the Galaxy theme, as in the user's reference.
Five original references are retained in `design/references/atlas-01.webp` through `atlas-05.webp`.
Artwork provenance and generation prompts are in `rendering/ASSETS.md`.

## Confirmed map constraints

Labels stay at fixed world scale. Do not add screen-size compensation.
All structures and scenery consume whole cells on the shared axial grid.
Workspaces use three hexes; project landmarks use ten (rows of 3, 4 and 3); each agent uses one.
One island per project with workspaces.
Center artwork and fit it completely inside its occupied cells.
Selection follows the outer perimeter of the occupied hexes, never a rectangle.
Project, workspace and agent cells each have a distinct tile style (flagstones, timber decking, light sand
tiles); islands have no empty cells. Minimum zoom fits the land with a one-cell border (plus room for banners and map controls);
panning stays within that extent. The world never sends daemon actions; the React UI owns them.
