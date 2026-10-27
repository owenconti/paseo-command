# Paseo Command — local development

## User requirements

- Work locally. Do not publish, upload, stream build-room events, or send this project to phaser.io.
- Do not sign in to Phaser AE, reconnect an online project, reinstall its skill, or start its room streamer.
- The Phaser AE account was disconnected and its installed skill removed at the user’s request.
- Cached engine files under `phaser/` and `game/node_modules/` remain available for local builds. Do not edit the engine.
- The original `/Users/example/development/paseo-command` project is read only. Preserve its React UI; focus current development on the game world.

## Product and references

Paseo Command visualizes hosts, projects, workspaces and agents from the Paseo daemon.
The React app and official SDK API are in `web/`. The renderer is in `game/`.
The user’s five supplied top-down illustrations guide the Atlas world: blue water,
parchment hex islands, project landmarks, workspace cottages, and model-colored robots.
The attached illustrations are references, not full-screen backgrounds.
Real state must remain truthful: distinguish running, idle, completed/unread, approval,
question, failure and offline. Test daemon mutations against fake daemons only.
The current world renderer is an early procedural prototype, not finished reference-quality art.

## Commands

- `npm run build`: local engine gate and bundle to `dist/`.
- `npm run smoke`: local headless smoke check.
- `npm run play -- "shot"`: local engine play tool; does not use the account CLI.
- `npm run serve`: local world preview on http://127.0.0.1:4173.
- `npm run app:dev`: builds the world, copies it to `web/public/world/`, and starts React plus the loopback API on port 4310.
- `npm run app:build`: checks and builds world and React UI.
- `npm run app:typecheck`: checks React and API TypeScript.

Read `game/README.md` and `game/docs/make-a-3d-game.md` for engine APIs.
Any publishing, asset-upload, crew or account instructions in generated engine documentation
are superseded by the user’s local-only requirements above. Local assets belong in the
repository and should be included through local build tooling.

## Structure

- `game/main.ts`, `game/art.ts`, `game/debug.ts`: engine boot, primitive models and debug bridge.
- `game/world/`: world rendering and host-qualified snapshot state.
- `web/src/NativeWorld.tsx`: browser adapter between the inherited React surface and local engine.
- `web/server/`: inherited official Paseo SDK API, bound to loopback.
- `scripts/`: local build/preview helpers.

## Initial Atlas rendering study

`rendering/` is the current standalone, local rendering study using open-source Phaser 4.2.1.
It is separate from the earlier cached Phaser AE prototype in `game/`.
Use `npm run render:dev` (http://127.0.0.1:4320) and `npm run render:build`.
The world is assembled from generated transparent sprite atlases, a terrain texture,
and a strict axial hex grid. It is not a screenshot used as a background.
This preview uses clearly labeled illustrative data and never connects to a daemon.
The existing React UI is untouched by the rendering study. Do not redesign it.
Five original references are retained in `design/references/atlas-01.webp` through `atlas-05.webp`.
Artwork provenance and generation prompts are in `rendering/ASSETS.md`.

## Confirmed map constraints

Labels stay at fixed world scale. Do not add screen-size compensation.
All structures and scenery consume whole cells on the shared axial grid.
Cottages use one hex; project landmarks currently use seven. Agents share workspace cells.
Center artwork and fit it completely inside its occupied cells.
Selection follows the outer perimeter of the occupied hexes, never a rectangle.
Rocks remain entirely on land. Minimum zoom fits the land with a one-cell ocean border;
panning stays within that extent. Keep the local rendering study separate from live daemon actions.
