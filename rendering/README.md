# Paseo Command — Atlas rendering study

A local, interactive proof of the top-down visual direction in the five supplied references. It uses open-source Phaser **4.2.1**, with no Phaser AE account, online project, publishing, build-room streamer, or daemon connection.

```sh
npm run render:install  # from the repository root, first installation only
npm run render:dev      # http://127.0.0.1:4320
npm run render:build    # TypeScript check and production bundle
```

The terrain is generated on a shared axial hex grid. Exposed edges receive coastline treatment; interior edges remain fine grid lines. Landmarks, cottages, trees, rocks and robots are separate sprite frames, not a flattened scene. Four model colors and five state treatments reproduce the reference hierarchy. All identities and activity in this study are explicitly illustrative.

Drag to pan, scroll to zoom around the pointer, use arrows to pan, and press Home or F to fit the map. Local and Macmini frame their islands. Select a robot, cottage or landmark; the guide becomes an inspector. The sample-agent selector provides keyboard access. An agent's **Preview next state** button cycles only its local sample state. Ambient motion respects the system preference and can be paused.

The existing React interface and live-daemon app in `web/` have not been redesigned or replaced. The preview is a focused rendering slice to confirm the artwork before integration. The earlier Phaser AE prototype remains in `game/`.

## Files

- `src/world.ts`: typed sample fleet, axial coordinates, deterministic seed and model/state vocabulary.
- `src/terrain.ts`: hex land, exposed coast edges, painted material, paths and scenery.
- `src/textures.ts`: reusable atlas frames and alpha-bounds trimming at load time.
- `src/AtlasScene.ts`: Phaser scene, world entities, state markers, camera and selection.
- `src/inspector.ts`: preview guide, sample-only inspector and keyboard selection.
- `src/main.ts`: game lifecycle, page events and local inspection surface.
- `src/style.css`: preview chrome and responsive guide.
- `public/assets/`: generated local sprite atlases and seamless textures; see `ASSETS.md`.

`window.atlasPreview.inspect()` reports the scene, zoom, selected identity and sample agent states for browser verification. Its `select`, `focus` and `command` methods use the same scene paths as visible controls.

## Current limits

This is a 2D painted-sprite rendering layer, not freely rotatable 3D geometry. The cottage atlas has two variants, the landmark atlas has three, and the terrain has one material. Trees now use a standalone transparent sprite with a complete canopy and independent padding. Robot motion currently uses status signals; walking, multi-direction robot animation, dynamic fleet layout, live snapshot updates and conversation integration remain future work. Labels and scenery are placed for this sample fleet; collision-aware dynamic placement is not yet implemented. Ocean ripples are ambient texture movement, not a water simulation.

## Validation of this slice

- `npm run render:build` passes strict TypeScript and bundles the production app.
- Desktop (1600×1000) and mobile (390×844) browser captures are in `artifacts/` (ignored).
- Actual canvas pointer selection opens the matching sample agent.
- Both island focus controls, fit, zoom in/out, inspector focus, close, sample selector, and motion pause/resume were exercised.
- The state preview cycled through approval, failed, running, idle and done, returning to its starting state.
- No browser runtime errors were reported during these checks.
- Original screenshots are in `artifacts/atlas-desktop.png`, `atlas-detail.png`, and `atlas-mobile.png`.

Tree clipping correction: verified the new source has transparent margins on every edge, checked the 150% browser close-up, and confirmed the build passes without browser runtime errors. Scenery placement reserves project-banner footprints.

## Tile and camera constraints

- All structures use integer axial cell footprints. Cottages own one cell; landmarks own the central cell and its six neighbors. Agents share their workspace cell.
- Artwork is centered on its assigned footprint and fitted completely inside it. Selection and hover trace exposed footprint edges, not a rectangle or a custom oversized hex.
- Scenery is assigned to free land cells and its rotated bounds are fitted to its cell. There is no offshore rock scatter.
- Labels have fixed world dimensions and scale naturally with the camera. Textures use mipmapped independent sprite frames with transparent gutters; the canvas uses a stable 2x backing buffer for sharper raster output.
- Minimum zoom fits the actual land bounds plus a border one hex wide/high. Panning is clamped to that extent. As with any aspect-preserving fit, a viewport with a different aspect ratio can show extra ocean on the unconstrained axis.
- `npm run render:test` checks whole-cell land ownership, non-overlap, footprint perimeter edges and artwork fitting.

Browser checks additionally verified all 14 actual rendered structures, all scenery footprints, world-label scales, repeated zoom-out clamping, pointer selection, and desktop resizing.
