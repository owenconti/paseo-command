# Village art — final kit

All 151 original required frame names are present. There are **220 frames** in
eleven PNG/JSON pairs (the twelfth, the host keeps, was removed: see below), all at nominal **scale 3**, with true alpha and explicit anchors.
The complete first pass was delivered before this refinement pass.

| Sheet | Frames | Final artwork |
| --- | ---: | --- |
| buildings | 11 | Six roof variants, four empty front bays each, extension arch, foundation steps, warm lantern, flower box, ivy |
| banner | 13 | Blank navy/gold banner, parchment plaques and three-slice pieces, low dark workspace name plate |
| tiles | 7 | Five painted stained-glass state windows, carved masonry surround/sill, optional separate sill |
| robots | 73 | Eight vivid palettes, four idle/four work poses each, eight flying drones, neutral floor light |
| fountain | 7 | Tall blue crystal/low basin, grey offline crystal with still water, glow, four ripples |
| ground | 18 | Seamless grass/cobble/path, round plaza, porch and cap pieces, organic paving transitions |
| scenery | 50 | Six tree silhouettes, three blossom trees, bushes/flowers, crates, tent, lamps/banners, walls/ruins, modular cliff waterfall, rocky riverbanks, bridge, pond and moat |
| hud | 8 | Wood/gold panel, status pill, divider, four ivory pictograms, dot |
| ground-warm | 13 | Muted rounded cobbles, eight grass transitions, paving blob, shallow one-step robot ledge in three pieces |
| cottages | 11 | Six workspace cottages with registered pane/doorstep rectangles, five matching stained-glass panes |
| district | 9 | Straight/diagonal paths, low horizontal/vertical fences, three hedges, stone entrance gate |

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

The original compression pass brought eight PNGs to **8,242,573 bytes (8.24 MB / 7.86 MiB)**, down from
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
frames, compressed to **338,204 bytes**. At that pass the nine-sheet kit totalled
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

## Stained-glass status fixtures

The five state faces now look like painted, internally lit stained-glass
windows set into the village's stone architecture. Glossy enamel, flat white
app glyphs, bright gold icon borders and the artwork's empty count plaque have
been replaced by mottled glass, warm ivory painted emblems, dark oak/lead seams,
chipped limestone, and a carved stone sill with timber corbels.

- `tile-merged`: emerald/moss green, painted check.
- `tile-review`: azure/cobalt blue, three-junction branching path.
- `tile-draft`: amber, parchment scroll and quill.
- `tile-failing`: ruby red, triangular warning mark.
- `tile-none`: cool slate, three stacked timber storage compartments/crates.
- `tile-frame`: the matching empty architectural arch and integrated carved
  sill; it has no count/name-plate slot.
- `tile-sill`: optional separate crop of that sill, **150x40 source px**, with
  bottom contact anchor **ax 0.5 / ay 0.925**. It is already in `tile-frame` and
  need not be drawn twice. The crop occupies x168/y294 in `tiles.png`.

All six existing frame rectangles, dimensions, positions and anchors remain
**identical**: state faces 132x132, surround 150x164, atlas 438x464. Faces inset
their glass content at source x11/y20, 110x100, aligning with the surround's
opening under the existing frame/tile placement. The renderer still owns any
live state dot; its separately drawn empty `plateStrip` must be removed or
replaced with the carved sill during integration.

The seven-frame `tiles.png` is a **55,523-byte** indexed PNG (256 colours,
dithering off), down from 136,201 bytes. All nine sheets now total
**8,500,099 bytes (8.50 MB)**. Other sheet pairs were untouched by this repaint.
The warm upper-left lighting, paint texture and small-size state distinction
were reviewed against the hall and private concept in
`rendering/artifacts/village/tiles-v6/mock.png`; it also shows every state at
86px and 43px surround widths. `build-tiles-v6.py`, `prompts-v6.json`, the raw
generated source and `tiles-v6/validation.json` retain the recipe/proof. No
concept pixels are used in the sprites. This repaint used one built-in
imagegen call.

## Cottage hierarchy — first complete pass live

The new host-district hierarchy kit is ready for integration. It adds twenty
frames in **`cottages.png/json`** (334,501-byte PNG) and **`district.png/json`**
(151,959-byte PNG). The whole eleven-sheet set is **8,986,559 bytes (8.99 MB)**.
All prior sheet pairs, including the project and dashboard halls, are unchanged.

- `cottage-0`: slate-blue gabled house.
- `cottage-1`: purple round tower house.
- `cottage-2`: teal workshop shed with lean-to.
- `cottage-3`: rust-roof market stall house and side awning.
- `cottage-4`: green-roof bakery with oven chimney.
- `cottage-5`: thatched small chapel and bell cupola.

Each cottage fits within a 360x360 painted source-pixel envelope (approximately
120x120 at nominal scale 3), plus three-pixel transparent safety padding. Forms
keep their natural proportions. Each has one front dark arched status-window
opening, and a doorstep off to one side where its robot can stand. No text,
name/sign plaque or robot is baked in. Perspective, chipped limestone, worn
timber, roof detail and upper-left warm light follow the existing halls.

**`pane: {x,y,w,h}` is in frame-local source pixels**, including the frame's
safety padding, never atlas coordinates or fractions. It bounds the actual dark
window aperture inside the surrounding arch. Draw the matching cottage pane
into this rectangle. **`doorstep: {x,y,w,h}`** uses the same units and locates
the little side step; use its lower edge/nearby ground for the agent's feet.
Bottom-centre anchors exclude the three-pixel bottom safety padding.

`cottage-pane-merged`, `cottage-pane-review`, `cottage-pane-draft`,
`cottage-pane-failing` and `cottage-pane-none` reuse the current stained-glass
art, trimmed from its hall-facing canvas and masked to the cottages' deeper
rounded arch. All five have 90x100 source-pixel frames and centre anchors.
They can scale directly to each cottage's `pane` rectangle; code need not
handle the old tile canvas's transparent margins. Windows remain blank until
code overlays one, so state stays truthful.

District prop names: `path-stone-straight`, `path-stone-diagonal`,
`path-stone-diagonal-reverse` (the extra reverse slope), `fence-h`, `fence-v`,
`hedge-0`, `hedge-1`, `hedge-2`, `district-gate`. Path frames have organic
grass edges; fences are low worn oak. The gateway's passage has real alpha so
the district terrain shows through it. No district or host name is baked in.

The two atlases are 256-colour indexed PNGs with dithering off. Bounds, clean
alpha, nonempty frames and every pane/doorstep rectangle were checked on the
compressed outputs. `rendering/artifacts/village/cottages-v7/first-pass.png`
shows all six panes in their apertures, robots beside their doorsteps and the
district props. The private recipe is `build-cottages.py`; exact source prompts
are in `prompts-v7.json` and `rendering/ASSETS.md`. This first complete pass
uses two new built-in imagegen calls. Existing hall and robot art is preserved.

## Host keep — removed

The host keeps were removed at the user's request: a host is its crystal fountain alone, its name on a wooden board on two
posts at the fountain's foot (painted by the page, `rendering/src/signboard.ts`). `keeps.png` / `keeps.json` are no longer
in the kit (git history keeps them); the notes below describe them as they were.

## Hall name boards

Each hall frame in `buildings.json` has a **`sign: {x,y,w,h}` in frame-local source pixels**: where its project's name board
stands on its front over the door (the page paints the board; no name is baked into the sprite). A gabled hall's
(`hall-blue`, `hall-purple`, `hall-green`, `hall-red`) is `120,110 560×84`, its foot on the gable's base beam, as wide as the
roof between its chimneys' outer edges; `workshop-rust`'s is `120,133 560×84`, over its gear on its beam; `dome-teal`'s is
`140,196 520×84`, its foot on the cornice under the dome. The board is the box's height and no wider than it; its iron
brackets reach below it onto the beam or cornice.

## Host keep — first complete pass (since removed)

**`keeps.png` / `keeps.json`** adds seven frames, compressed to **718,161 bytes**.
The whole twelve-sheet set is **9,704,720 bytes (9.70 MB)**, still below 10 MB.
All previous sheet pairs are unchanged.

- `keep-0`: single square stone keep with crenellated crown.
- `keep-1`: narrower twin-towered gatehouse and central closed gate.
- `keep-2`: stepped keep with a round corner turret and small slate roof.
- `keep-offline-0`, `keep-offline-1`, `keep-offline-2`: the same geometry,
  alpha, signs, anchors and exterior pixels, with dark unlit window glass.
- `keep-flag`: blank neutral pennant on an iron pole. Its feet anchor is the
  **pole's foot**, offset left of the cloth's centre, for exact roof mounting.

The three keeps have 680px painted height plus safety padding (686px frames),
about 1.2x the existing halls' painted source height, and narrower footprints.
They share the Village's warm upper-left light, three-quarter facade camera,
chipped limestone, worn oak, amber windows and restrained ivy. Offline variants
remove all bright window highlights, without repainting or dimming the stone.

Each online/offline keep frame has **`sign: {x,y,w,h}` in frame-local source
pixels**, bounding the usable blank centre of its physically mounted timber
name board. These are not atlas positions or fractions. Fit dark serif text
there; no host name is baked into the sprite. The sign is part of the building,
with carved wood edges and brackets, rather than a floating UI plaque.

**`flag: {x,y}`** gives a matching frame-local source-pixel roof attachment
point; place the pennant's feet anchor there. `keep-flag` also provides a
**`cloth` rectangle** in frame-local source pixels for selective tinting if
desired. The cloth's neutral shading takes green or grey cleanly; status tint
and host clicking are renderer-owned.

The first pass uses two new built-in generations. The keep sheet is a
256-colour indexed PNG with dithering off. Compressed-output checks confirm
identical online/offline alpha, exterior pixels and sign rectangles, plus
nonempty bounds and valid sign/cloth positions. `keeps-v8/first-pass.png` in the
ignored art artifacts shows every variant with green/grey flags and sample
serif host names; text and tints occur only in that private mock. The private
recipe is `build-keeps.py`, prompts are `prompts-v8.json`, and the public exact
prompts/provenance are in `rendering/ASSETS.md`.

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
`rendering/ASSETS.md`. Twenty-one built-in `image_gen` calls supplied the art. No
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

