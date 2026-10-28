# DOM Atlas — design

## Intent

The Phaser Atlas is smooth, but it keeps the CPU and GPU busy while the map just sits open. Phaser
re-renders the whole high-density WebGL canvas many times a second for ambient motion: sea glints and
cloud drift, the running-border lights, pulses, the breathing selection halo, walking robots and drones.
The user has seen far more graphic-heavy web apps run lighter. The bet here is to let the browser do the
work: compose the map from DOM, SVG and CSS so the compositor moves pre-painted layers, and only the few
live bits repaint.

This builds a second Atlas renderer next to the Phaser one, so the two can be compared by look and by cost
before anyone decides to replace the Phaser Atlas.

## Goals

- A DOM/SVG/CSS Atlas that draws the same fleet with the same art and follows every rule in the
  "Atlas world" and "Confirmed map constraints" sections of `CLAUDE.md`. That covers layout, cells, tile
  styles, hover and selection rims, state on sand hexes only, labels at fixed world scale, minimum zoom
  and pan bounds, hosts not interactive on the map, and the world never sending daemon actions.
- **Success:** CPU and GPU use clearly lower than the Phaser Atlas on the same fleet, both idle and while
  panning or zooming. "Clearly lower" is the bar; there is no fixed number.
- It is reached at its own URL (the user's choice). My call on what that means: the same app at a
  separate path, e.g. `/dom`, where the map's Atlas is the DOM renderer and everything else (React
  panels, Galaxy, toolbar) is unchanged. The toolbar gets no new entry.

## Non-goals

- Galaxy. It stays on Phaser.
- Replacing or deleting the Phaser Atlas. That is a later decision, made after comparing.
- New art, new effects or layout changes. `world.ts` layout rules don't change.
- Any change to the React panels, the SDK API or the engine under `phaser/` / `game/node_modules/`.

## Anti-goals (it fails even if it "works")

- It looks different from the Phaser Atlas: other colours or positions, blurry art at rest, labels that
  change size with the screen, rectangular selection.
- It is not actually cheaper. For example, a `requestAnimationFrame` loop that touches the DOM every frame,
  animated SVG or CSS filters (blur, drop-shadow, glow) running constantly, or thousands of separately
  animated elements.
- It drifts from the Phaser Atlas because rules get re-implemented instead of shared.

## Constraints

- Local only, per `CLAUDE.md`. No publishing, no Phaser AE account or streamer.
- Do not edit the Phaser engine. The original `paseo-command` project is read only.
- Real state stays truthful: running, idle, completed/unread, approval, question, failure and offline all
  stay distinct, exactly as `STATE_TILE` and the pulse periods in `AtlasScene.agentTiles` define them.
- Reduced motion behaves as in the Phaser Atlas: everything still, with a steady selection wash.
- Test against the mocked fleet only (`web/e2e/`), never a real daemon.

## What was decided (the user's calls)

- Atlas only; Galaxy untouched.
- Side by side first, reached at a new URL (not a toolbar entry).
- Same art, same rules. Effects are not simplified away.
- Success means a noticeable drop in CPU/GPU use, judged in Activity Monitor with Chrome on the user's Mac.
- The baseline is the Atlas as committed on `main` at 73df182. The plaza props, lamps and beacon glows
  that are being worked on (uncommitted at the time of writing) are out of scope and can be ported later.
  Build in a worktree from that commit, and rebase on whatever lands on `main` before merging. If the
  plaza work has landed by then, the DOM Atlas simply doesn't show it yet.

## Proposed approach (my calls, open to the builder's judgment where noted)

### Share the brain

- `world.ts` (layout, axial geometry, `point`, `footprint`, `cellBounds`, state vocabulary) is used as-is
  by both renderers.
- `terrain.ts` and `textures.ts` currently paint into 2D canvases and then register them as Phaser
  textures. Split each painter so the canvas-producing part is renderer-neutral (returns an
  `HTMLCanvasElement`, or frame rectangles for sprite atlases), with a thin Phaser wrapper that keeps the
  current call sites working. The Phaser Atlas must render pixel-identically afterwards.
- Hover/selection perimeter tracing and similar pure geometry that now lives inside `AtlasScene.ts`
  moves into a shared module both renderers call, rather than being copied.

### Embedding

- A new `mountDomAtlas(parent, handlers)` (or an option on `mountAtlas`; builder's call) returns a DOM
  implementation of the same `AtlasWorld` interface (`update`, `select`, `focus`, `command`, `input`,
  `motion`, `inspect`, `destroy`) and emits the same handler callbacks. `WORLDS` and `WorldKind` are
  unchanged: it is still the "atlas" world, only drawn differently.
- The app serves the same page at the new path (e.g. `/dom`). There, `NativeWorld.tsx` mounts the DOM
  renderer whenever the Atlas world is chosen. Galaxy and ⌘⌥T behave as normal. Both the Vite dev server
  and the built preview (`app:start`) must serve that path, and `urlState.ts` query handling must keep
  working on it.
- Note the new path in `CLAUDE.md` ("Structure" and "Atlas world").
- Phaser is not loaded until a Phaser world is shown. Lazy-loading it is welcome but optional.

### Layers (back to front), all inside one viewport element

1. **Sea.** The `water` texture as a repeating CSS background on a layer that covers the viewport.
   Glints and cloud shadows are their own repeating layers that drift with CSS `transform` keyframes
   using `steps()`, matching today's 15 Hz stepping and speeds (`DRIFT_RATE`, `DRIFT_SPEED`, and the
   0.6/0.25 and 1/0.4 factors in `AtlasScene.update`). They stay anchored to the world as the camera
   moves, so their offset follows the camera transform.
2. **World container.** A single element whose CSS `transform: translate(...) scale(...)` is the camera.
   Everything below lives inside it in world coordinates:
   - Each host's landmass is painted once to a canvas and placed as an image at its world rect.
   - Project islands, banks, shadows, flagstone/timber/sand tiles, buildings, cottages and scenery are
     painted once into per-host (or per-island) bitmaps. These repaint only when the layout changes,
     never per frame.
   - Robots and drones are small positioned elements that show their sprite frame from the sprite atlas.
   - Banners and labels are HTML text at fixed world size. They scale with the container, which is the
     "fixed world scale" rule. There is no screen-size compensation.
3. **Live SVG overlay** (in the same world container, one `<svg>`): the agent state hexes (fill and
   border), hover rims, and the selection rim, halo and wash.
   - Pulses are CSS `opacity` keyframes per state period, with each tile's phase set by a negative
     `animation-delay` taken from the same seeded `random(seedOf(id + "pulse"))`.
   - The running light is an animated `stroke-dashoffset` on a hex path, a sixth of the perimeter,
     fading from head to tail. A gradient along the path or a few stacked dashes are both fine.
   - The selection halo's blur is computed once (a static SVG filter result or a pre-blurred image), and
     only its opacity breathes. No live filter animation.

### Motion

- Working robots wander as today (`walkRobots`), but as discrete legs instead of per-frame updates. When
  a leg starts, JS picks the target with the same seeded rng, then starts a Web Animations API animation
  of `transform` (turn, then walk with bob). JS runs again only when the leg ends. Hand swing and tinker
  are CSS keyframes.
- Drones orbit with a CSS rotation keyframe around their robot's wrapper, so they follow the wandering
  robot for free. Depth swapping on the far side of the circle is the builder's call. Approximating it
  with a clip or two-layer trick is fine if it looks the same.
- Reduced motion: `motion(true)` and `prefers-reduced-motion` set a class that pauses or cancels every
  animation and puts the elements in their still pose.

### Camera and input

- Pan with drag, wheel or pinch zoom, arrow keys, and F/home/in/out with the same easing, limits, minimum
  zoom fit (land plus a one-cell border and banner/control room) and pan clamping as the Phaser Atlas.
  The constants and rules for this should be shared, not re-derived.
- Pointer picking converts screen to world through the inverse camera transform, then to an axial cell
  with `world.ts` maths. No per-element DOM hit-testing. Hosts never pick or hover.
- During a pan or zoom gesture the world container gets `will-change: transform` so it stays one
  composited layer. At rest the hint is removed so text and SVG re-rasterise crisply at the new scale.
  Bitmaps are painted at enough density (e.g. device pixel ratio × max zoom, capped) that they don't look
  soft at max zoom. The builder chooses the cap, or tiles bitmaps if memory demands it.

### `inspect()` and tests

- `inspect()` returns the same shape as `AtlasScene.inspect()` (selected, hovered, selectionEdgeCount,
  islands, worldLabels scale, scenery…), with `renderer: "DOM"`. The existing `web/e2e/atlas.e2e.ts`
  assertions should then pass for both kinds. Run the Atlas e2e suite against both, parameterised.
- Add a visual comparison: screenshot both renderers at the same camera on the mocked fleet. They should
  match closely; the builder sets the tolerance.

### Measuring the result

- A repeatable script opens each path in **headed Chrome on the Mac**, against a mocked fleet. Headless
  Chromium may render WebGL in software, which would make the Phaser numbers meaningless.
- For each renderer it records 30 s idle and 10 s of scripted panning and zooming.
- It samples process-level CPU % for the Chrome renderer and GPU processes, the same figures Activity
  Monitor shows (e.g. `ps`/`top` on their PIDs), plus GPU time if it can be read (e.g. `powermetrics`
  where permitted). It reports the two renderers side by side.
- A Chrome trace is a secondary diagnostic, not the verdict.
- Run it on two fleets (my call): the existing e2e mock, and a scaled one of about 8 hosts, 40 projects,
  ~150 agents with a realistic mix of running and needs-you states. That way DOM costs that grow with
  element count show up.

### Cost spike first (my call)

Before the full port, build a throwaway spike at the new path: real sea layers with drift, the host
landmasses as bitmaps, ~150 state hexes with running lights and pulses, and the breathing selection
halo. Measure it with the script above against the Phaser Atlas on the scaled fleet. If it isn't clearly
cheaper, stop and report the numbers to the user before going further. Otherwise continue with the full
port, keeping what the spike proved and not its code by default.

## Left to the builder

- Module layout under `rendering/src/` (e.g. `rendering/src/dom/`), and the exact path name.
- Whether static art is one bitmap per host, per island, or tiled.
- Exact technique for the running-light gradient, halo pre-blur and drone depth.
- Bitmap density cap and tiling, provided art stays crisp at rest at every allowed zoom.
- Whether to lazy-load Phaser.

## Done when

- The new path shows the live fleet in the DOM Atlas with the same look and rules as the Phaser Atlas,
  and the normal path is unchanged.
- Atlas e2e passes for both renderers, and the Phaser Atlas is unchanged.
- The measurement shows a clear CPU/GPU drop, and the numbers are reported to the user.
- Committed, merged to local `main`, then rebuilt and restarted per `CLAUDE.md`.
