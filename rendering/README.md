# Paseo Command — Atlas and Galaxy worlds

The top-down Atlas world of Paseo Command, built with open-source Phaser **4.2.1**. The React app in `web/` embeds it through `mountAtlas()` and feeds it the live, host-qualified fleet from the Paseo daemon. This package also runs standalone as a rendering study with an explicitly illustrative fleet that never connects to a daemon.

```sh
npm run render:install  # from the repository root, first installation only
npm run render:dev      # standalone study, http://127.0.0.1:4320
npm run render:build    # TypeScript check and production bundle
npm run render:test     # layout and tile constraints
npm run app:dev         # the app with live daemon data, http://127.0.0.1:4310
```

The layout is deterministic and built from data. Every project is its own island: its landmark owns ten cells in rows of 3, 4 and 3, at the very top of the island, and its workspaces are one-hex cottages in rows of up to four directly below it, each row centred under the landmark. The landmark's rows are exactly its own cells, with no spare tiles beside it; land grows around the cottages below, so a project with no workspaces is just its landmark. A host's islands sit together on one landmass of grass hex tiles on the same grid (its islands, the gaps between them, a ring around them and a seeded partial second ring), with a hex-edged coast of beach, foam and shallows, never within a channel of another host's land, with the host's banner on its northern shore. They are packed by their actual cells, each in the highest open spot that keeps one clear cell from its neighbours; coast bumps grow only where they keep that clearance. Hosts are four cells apart, leaving a channel of sea between landmasses; the packer also keeps each host's group compact rather than a long strip. The arrangement follows the map's shape: every host's islands share one column limit and hosts shelf-pack into rows, choosing whichever limit best matches the viewport's aspect with the least empty ground, so tall maps stack vertically. Resizing the map re-lays it out. Agents are model-coloured robots that share their workspace cell, up to four per cell plus a `+N` count; robots are drawn large so they read at overview zoom. Workspaces without a project share a host-level island without a landmark. Agents without a workspace wait at a flagged camp cell on their project's island.

Agent states: working (pulsing waves in the model colour), idle (no mark), done and waiting for you (gold star), needs approval (amber `!`), has a question (blue `?`), failed (red ×) and offline (greyed robot on a faded island). Small lights beside a robot count its running subagents. Each occupied workspace tile also takes the colour of its most urgent agent (failed red, approval amber, question blue, done gold, working green, offline grey; idle stays plain) with a thick rim, pulsing for states that need you, so agent state reads even at full-map zoom. Robots are 46 world pixels. Cottages are drawn small and toward the top of their cell, leaving its lower part for robots; landmark art keeps some open ground inside its cells (the manor and observatory are drawn smaller).

Drag to pan, scroll to zoom around the pointer, use arrows to pan while the map has focus, and press F or Home to fit. Clicking a robot, cottage or landmark reports a pick. The app turns it into a selection, which opens the conversation, workspace or project, without moving the camera. Selections made elsewhere (the list, a notification) are outlined and panned into view, at the current zoom, only if they are off screen. A status change redraws only the robots; a structural change rebuilds the world while keeping the camera.

## Galaxy

The second world draws the same fleet as space (open the study with `?world=galaxy`). Hosts are tinted nebula regions with their name in large type; projects are planets from eight surface families (ocean, forest, desert, volcanic, ice, ringed gas, barren, storm) rendered as true spheres from equirectangular maps, slowly turning, with clouds, atmospheres and tilted rings; workspaces are space stations on flattened orbits, travelling while an agent works and ringed in their most urgent agent's state colour; agents are satellites in formation beyond their station, coloured by provider, with state badges, and a beam relayed satellite → station → planet while running. Planet captions count what needs you, what is running, subagents and unread replies. Decorative rocks carry no identity. Selection uses amber corner brackets; hover ivory.

## Files

- `src/world.ts`: data types, model/state vocabulary, axial geometry and `layoutAtlas()`.
- `src/terrain.ts`: generated sea, host landmasses, per-island hex land and the flagstone, decking and sand tile styles.
- `src/textures.ts`: reusable atlas frames and alpha-bounds trimming at load time.
- `src/AtlasScene.ts`: Phaser scene, entities, state markers, camera, hover and selection.
- `src/atlas.ts`: `mountAtlas(parent, handlers)`, the embedding API.
- `src/main.ts`, `src/inspector.ts`, `src/sample.ts`: the standalone study and its sample fleet.
- `src/assets/`: generated local sprite atlases and seamless textures; see `ASSETS.md`.

`inspect()` (on `window.paseoAtlas` in the app, `window.atlasPreview` in the study) reports islands, structures, agents and their states, the selection, the camera and the build count, for browser verification.

## Current limits

This is a 2D painted-sprite layer, not freely rotatable 3D geometry. The cottage atlas has two variants, the landmark atlas has three, and the terrain has one material. Robots signal state with markers; they do not walk. The sea is procedurally generated (depth mottling and faint ripple crests, a non-repeating large-scale variation layer, and a drifting glint layer). Each host's landmass is meadow grass; project islands sit on it on earthen banks with soft shadows. Cloud shadows drift slowly over everything except labels and robots. All motion pauses with reduced motion.

## Validation

- `npm run render:test`: whole-cell ownership, non-overlap, one island per host, islands never touching, agents sharing workspace cells, artwork fitting, overflow, camp and offline handling, deterministic signatures, and model colours, for both the sample and a crowded fleet.
- `npm run app:e2e`: in a real browser against a mocked fleet, all seven states draw as reported, the offline host is faded, a hovered robot shows its tooltip, a clicked robot opens its conversation, a list choice selects on the map, and live changes redraw without a reload.

## Tile and camera constraints

- All structures use integer axial cell footprints. Cottages own one cell; landmarks own ten cells in rows of 3, 4 and 3, with art and banner centred on those cells. Agents share their workspace cell.
- Artwork is centered on its assigned footprint and fitted completely inside it. Selection and hover trace exposed footprint edges, not a rectangle or a custom oversized hex.
- Empty cells carry no scenery (no trees, rocks or tufts); detail belongs to the structures. Each cell type has its own tile: landmark cells are laid flagstones in one world-anchored running bond, continuous across the courtyard's cells, with one kerb around it, workspace cells are timber decking with a timber kerb, and empty cells are plain sand.
- Labels have fixed world dimensions and scale naturally with the camera. Textures use mipmapped independent sprite frames with transparent gutters; the canvas uses a stable 2x backing buffer for sharper raster output.
- Minimum zoom fits the actual land bounds plus a border one hex wide/high. Panning is clamped to that extent. As with any aspect-preserving fit, a viewport with a different aspect ratio can show extra ground on the unconstrained axis.
