# Village art — final kit

All 151 required frame names are final and present. There are **199 frames** in
nine PNG/JSON pairs, all at nominal **scale 3**, with true alpha and explicit anchors.
The complete first pass was delivered before this refinement pass.

| Sheet | Frames | Final artwork |
| --- | ---: | --- |
| buildings | 11 | Six roof variants, four empty front bays each, extension arch, foundation steps, warm lantern, flower box, ivy |
| banner | 13 | Blank navy/gold banner, parchment plaques and three-slice pieces, low dark workspace name plate |
| tiles | 6 | Green/blue/yellow/red/slate tiles with fixed glyphs; blank count frame |
| robots | 73 | Eight vivid palettes, four idle/four work poses each, eight flying drones, neutral floor light |
| fountain | 7 | Tall blue crystal/low basin, grey offline crystal with still water, glow, four ripples |
| ground | 18 | Seamless grass/cobble/path, round plaza, porch and cap pieces, organic paving transitions |
| scenery | 50 | Six tree silhouettes, three blossom trees, bushes/flowers, crates, tent, lamps/banners, walls/ruins, modular cliff waterfall, rocky riverbanks, bridge, pond and moat |
| hud | 8 | Wood/gold panel, status pill, divider, four ivory pictograms, dot |
| ground-warm | 13 | Muted rounded cobbles, eight grass transitions, paving blob, shallow one-step robot ledge in three pieces |

The refined robots have bright cyan eyes and antenna tips, glossy vivid enamel,
and a roughly 58px painted height. Work frames are registered by the boots,
rather than by silhouettes that change when a wrench is raised. Drones have
rotors and thrusters. Roofs, brass, warm stone, lush foliage and water share the
golden upper-left light and three-quarter overhead camera.

New names beyond the 152-frame first pass:

- **buildings:** `foundation-steps`, `wall-lantern`, `flower-box`, `ivy`.
- **ground:** `cobble-edge-n`, `cobble-edge-s`, `cobble-edge-e`, `cobble-edge-w`,
  `cobble-edge-nw`, `cobble-edge-ne`, `cobble-edge-sw`, `cobble-edge-se`,
  `cobble-blob`, `cobble-edge-mask`.
- **scenery:** `river-water`, `river-bank-left`, `river-bank-right`, `moat-pond`,
  `river-bend`, `grass-tufts`.

The original `flowerbed` extra remains. `river` now includes rocky mossy banks,
depth shading and foam; `river-water` is the water-only seamless material.
`waterfall-0..3` now contain the tall stone cliff. `moat-pond` has lily pads and
water lilies for the moat near the bridge. Each building already incorporates
steps, two small lanterns and flower boxes; their separate pieces allow further
dressing. All original names remain stable.

Integration follow-up added fourteen frames (before the compression pass below,
all preceding 172 frames retained identical painted pixels and geometry):

- **banner:** `plaque-wide`, `plaque-wide-left`, `plaque-wide-mid`,
  `plaque-wide-right`, `plate`, `plate-left`, `plate-mid`, `plate-right`.
  The full plaque is 240x60 concept pixels (4:1), with slender scroll ends;
  its three-slice pieces are 36x180, 24x180 and 36x180 **sheet pixels**.
  Draw the caps 12px wide at 60px height and stretch/repeat the middle.
  The dark workspace plate is 98x14 concept pixels; its pieces are 18x42,
  12x42 and 18x42 sheet pixels (6px caps at 14px height). Centres are blank.
  These pieces have no interior padding, so their horizontal joins meet exactly.
- **scenery:** `cliff-top`, `cliff-mid`, `cliff-foot`, `ruin-0`, `ruin-1`,
  `lamp-post-banner`. All three cliff modules are 150 concept pixels wide;
  their heights are 105, 120 and 125. They have top-centre anchors and no
  interior padding. Stack top, any number of repeated middles, then foot, then
  `river`, all at the same width. Open interface rows match exactly, including
  alpha; `cliff-mid` repeats vertically. The foot has foam and joins the banked
  river. Two crenellated wall/tower ruins fit beside the cliff. The lamp banner
  has a blank navy cloth, gold trim, warm lantern and stone pole base.
- The existing **ground** `plaza-ring` already contains radial/concentric stones
  on a round plaza seen in the village's three-quarter perspective; it is retained.

`followup-review.png` shows the new labels at 60/54px and 14px heights, the
plaza, paired banner poles, ruins and a three-repeat cliff stack entering river.
`review-followup.py`/`followup-validation.json` record that pre-compression
preservation proof and matching cliff interfaces. `build.py --followup-only`
reuses the current painted kit and updates the supplemental pieces.

## Compression and resolution audit

The original eight PNGs total **8,242,573 bytes (8.24 MB / 7.86 MiB)**, down from
24,193,470 bytes: **65.9% smaller**, below the 10 MB target. This is perceptual
palette compression, not mathematically lossless RGB compression.

`buildings`, `ground` and `scenery` use 256-colour indexed PNGs. The other five
sheets keep RGBA output with opaque colours palette-reduced. Dithering is off.
All translucent RGBA pixels on those five sheets remain exact, and the complete
`floorlight`, `crystal-glow` and four `water-ripple-*` frames are byte-identical.
Glows, water, foliage and architecture were compared on dark/light backgrounds
and at current draw sizes. No obvious visual change or new halo/banding was
observed in those comparisons. Repeating edges and cliff interface rows still
match exactly after palette remapping.

The renderer uses `VILLAGE_PX = 1.75` (the JSON's `scale: 3` is nominal).
Most source frames are already sized appropriately for their actual draw size.
Five fixed-draw-size outliers were reduced **inside their existing atlas slots**:

| Frame | Old source px | New source px | Linear scale |
| --- | --- | --- | --- |
| plaza-ring | 1266x692 | 735x402 | 58.1% |
| ruin-0 | 516x471 | 333x304 | 64.5% |
| ruin-1 | 471x417 | 333x295 | 70.7% |
| pennant | 115x252 | 81x178 | 70.4% x / 70.6% y |
| divider | 486x130 | 396x24 | 81.5% x / 18.5% y |

The divider keeps 24 source pixels vertically because the HUD first renders its
6-point strip into a `TEXT_SCALE = 4` canvas; its width retains 2x Retina detail.
The other resized pieces approach 1.75 source pixels per world draw unit.
The plaza stays 420 units wide, ruins 190, and pennants 46 in the renderer.
Auto-sized scenery, animation registration and tiling geometry were retained.

Every **atlas dimension, frame x/y position, anchor and slice inset is unchanged**.
Five JSON files are byte-identical. Only the five `w`/`h` pairs above changed in
`ground.json`, `scenery.json` and `hud.json`; world draw sizes are preserved.
Earlier source-size notes describe the pre-compression art unless overridden by
this table. All 186 names remain present, and current live validation passes.

Private originals, final candidates, metrics and visual checks are in
`rendering/artifacts/village/compression/`: `final-report.json`,
`architecture-water-review.png`, `resizing-review.png`, `glow-review.png` and
`draw-size-metrics.json`. The recipe is `compress-final.py` beside that folder;
it uses Python `imagequant`/libimagequant with Pillow. Raw generation/building
steps produce the uncompressed art; refresh the private compression baseline
and reapply this optimisation after rebuilding source sheets.

## Warm paving and shallow robot ledge

The supplemental **`ground-warm.png` / `ground-warm.json`** pair adds thirteen
frames, compressed to **338,204 bytes**. The complete nine-sheet kit now totals
**8,580,777 bytes (8.58 MB / 8.18 MiB)**. The preceding eight sheet pairs were
not rewritten by this pass.

- `cobble-warm`: seamless muted warm grey-brown/taupe/tan rounded cobbles,
  darker mortar and subtle moss. Its 448x448 source pixels display at 256x256
  world pixels under the renderer's 1.75 ratio. Stone widths read around
  10–16 world pixels, matching the reference's scale. A local contrast curve
  opens the stone faces while preserving the darker joints, without the former
  strong yellow/ochre cast. This source is already toned; further old-paving
  colour grading may need to be removed by the renderer.
- `cobble-warm-edge-n`, `-s`, `-e`, `-w`, `-nw`, `-ne`, `-sw`, `-se`: each
  224x224 source pixels / 128x128 world pixels. Irregular grass from the painted
  terrain actually overlaps the stones; the outside edge is softly transparent.
- `cobble-warm-blob`: a companion organic paving patch for the fountain's
  centre, 1060x648 source pixels / about 606x370 world pixels. Its cobbles keep
  the tile's scale rather than stretching one small tile across the whole blob.
- `porch-ledge-left`, `porch-ledge-mid`, `porch-ledge-right`: source sizes
  **42x39**, **175x39**, **42x39**, respectively. At native density these are
  24px caps, a 100px repeated middle, and **22.3px total depth**, including the
  narrow top and darker front face of exactly one shallow step. The middle
  contains one small unlit brass-rim floor-light socket; code owns its state
  glow. The ends have small chips and restrained moss. These pieces join
  without interior padding; the middle tiles x with exact opposite edge texels.

The new sheet is a 256-colour indexed PNG with dithering off. Required names,
RGBA bounds, true transparency and repeat edges were checked after compression.
`rendering/artifacts/village/warm/review.png` shows old/new paving at native
scale, the eight grass transitions and a repeated shallow ledge. Raw outputs,
exact prompts (`prompts-v5.json`), the `build-warm.py` recipe and the private
`warm/validation.json` remain in the ignored art artifacts. No concept pixels
were copied into any sprite or texture.

Integration geometry:

- Standing pieces anchor at ground contact, excluding transparent frame padding.
  Robots share a common canvas, anchor and registered feet baseline.
- Terrain tiles use top-left anchors; flat surfaces, rivers, glows and masks use
  centre anchors. `tile` declares `x`, `y` or `xy` repeating axes; the declared
  opposite RGBA edge texels match exactly.
- `grass`, `cobble`, `path` and `river-water` are 256x256 concept pixels.
  `river` is 150x240; river banks are 64x240; the moat is 260x110.
- Paving edge pieces are 128x128 concept pixels with irregular soft exposed
  edges. `cobble-blob`/`cobble-edge-mask` are 420x300 before safety padding.
  The white mask has the same organic alpha silhouette as the paving blob.
- The current fountain is 180x190 before safety padding, with a low basin and a
  dominant crystal cluster. Its online and offline canvases/anchors match.
- Full `plaque`, `porch`, `panel-9slice` and `pill` declare `slice` insets in
  **sheet pixels**, not concept pixels. Preserve those corners when stretching.
  Plaque/porch cap pieces also declare `sliceRole`.
- Banners, name plaques and count plates are blank. Code supplies names, counts,
  project icons and dynamic status. The five fixed tile glyphs are painted in.

Provenance, every exact prompt, source filenames and assembly notes are in
`rendering/ASSETS.md`. Sixteen built-in `image_gen` calls supplied the art. No
concept pixels were copied, and the ignored concept is never a runtime asset.

Private files in ignored `rendering/artifacts/village/`:

- `build.py` — reproducible preparation/packing, `--validate-only` for live finals.
- `raw/`, `prompts*.json` — generated source outputs and exact prompts.
- `mock.png` — sprite-only reconstruction, with text/icon fields blank.
- `comparison.png` — side-by-side private concept comparison.
- `contact-sheet.png`, `robots-review.png` — visual checks.
- `robot-work.gif`, `robot-registration.json` — work cycle and independent
  painted-boot checks (centres and baselines vary by at most one sheet pixel).
- `validation.json` — required names, scale, dimensions, alpha, seams, bounds,
  frame overlap and shared robot animation canvas/anchor checks.

All checks pass. The kit approximates the concept with modular pieces; the
single painted image has more bespoke shadows, foliage joins and masonry.
No commits were made by the artist; integration and commit belong to the lead.
