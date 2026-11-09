# Artwork provenance

Generated with the built-in `image_gen` tool for this project. No Phaser AE crew, uploads or phaser.io services were used. User-supplied illustrations were style references for the original sprite atlases. Those reference images are excluded from the repository and public history because their redistribution rights were not established; private local copies may remain in the ignored `design/references/` directory. None is used as the running scene's background.

The output PNGs are retained without destructive editing. The shared painters register and trim individual atlas frames at runtime. Transparent alpha is preserved. Local assets are bundled directly by the renderer. Original generated artwork is made available under the project's MIT license to the extent rights are held by the project; third-party marks and fonts retain their own rights.

Historical generator filenames below identify provenance, not files that must be downloaded or restored. Example home paths stand in for private generation archives.

## buildings.png

Original output: `exec-beb808dc-f1d4-4117-911e-b941ae7b9ad7.png`.

Exact prompt:

> Use case: stylized-concept. Create a production GAME SPRITE ATLAS, not a scene or screenshot. The attached image is STYLE REFERENCE ONLY: hand painted ink-and-watercolor fantasy cartography, slate blue tiled roofs, aged cream limestone, fine brass trim, restrained sunlit shadows. Output a landscape transparent PNG arranged as an EXACT 3-column by 2-row GRID, six equal cells, generous transparent gutters. All six subjects fully inside their own cell with equal margin. Camera STRICT ORTHOGRAPHIC STRAIGHT DOWN 90-degree overhead, looking at roofs; no horizon, no isometric tilt or visible front facades. Top left: large square manor courtyard with four slate-roof wings around an open garden and tiny central round fountain. Top middle: round brass-ribbed slate-and-glass observatory dome with an offset opening. Top right: cross-shaped Victorian glass conservatory with pale blue panes and brass framing. Bottom left: small rectangular slate roof cottage with timber porch and chimney. Bottom middle: a second small cottage with brown timber roof and small chimney. Bottom right: a little isolated grove of two moss-green leafy trees, a shrub and three grey shoreline boulders viewed vertically from above. Ground only inside manor courtyard; other sprites have no island, terrain, grass base, hexagon, number, label, text, banner or UI. Building footprints must be sharp and exquisitely detailed but readable when scaled to 200px. Painterly game art with thin sepia contour ink, rich material detail, warm old-world miniature architecture. Transparent exterior, never a checkerboard.

## robots.png

Original output: `exec-f68807de-d4bf-4c9d-bd65-75d50dd83114.png`.

Exact prompt:

> Use case: stylized-concept. Production transparent GAME SPRITE ATLAS: EXACT 2 columns by 2 rows, four equally sized cells with very wide transparent gutters. Four versions of the SAME adorable spherical enamel-and-brass helper robot. Camera strict vertically overhead 90-degree top-down, a little dark face visor on forward lower edge visible from above, small round metal hands/feet to either side, tiny brass antenna, glossy domed round head with painted highlight. Antique brass edging. Top-left turquoise teal, top-right violet purple, bottom-left fresh lime green, bottom-right cobalt blue. Match attached reference's small robot illustrations: charming hand painted fantasy map art, fine dark ink outlines, watercolor/gouache material detail, tiny soft grounding shadow only. Robot centered in each quadrant and occupies about 60% of each cell. No ground tile, no island, no labels, no letters, no text, no status marks, no circles or magical glow around robots. Everything outside each single robot must be genuinely transparent. Do not make a 3D render or pixel art. Consistent scale across all four.

## water.png (not currently used)

The Atlas now draws its islands on a procedurally generated meadow (`paintGround` and `paintClouds` in `src/terrain.ts`). This texture is kept for reference.


Original output: `exec-d548aefe-f04f-4c3d-b219-21c0ac288de4.png`.

Exact prompt:

> Use case: stylized-concept. Asset: seamless repeatable square OCEAN WATER TEXTURE TILE for a straight-down hand-painted fantasy strategy map. Entire image is only luminous cerulean and turquoise sea water with small irregular pale blue ripple curls and fine hand-painted watercolor variation, like an exquisitely illustrated antique island atlas with blue water. Medium blue body with lighter cyan shallows-like mottling distributed evenly throughout. Soft watercolor brush texture, fine airy inkless foam tracery distributed very sparsely. Strict 90 degree overhead flat map. No islands, no land, no shores, no objects, no fish, no boats, no dark vignette, no sun, no perspective, no horizon, no lettering. Seamless on all four edges, no prominent feature, calm refined artisanal strategy game art. Not photorealistic. Texture must look good repeated over a large map.

## sand.png

Original output: `exec-269c0f1c-c3ea-4fec-ba6a-66e8d839b6d5.png`.

Exact prompt:

> Use case: stylized-concept. Asset: seamless repeating terrain texture, square, flat straight-down surface for the parchment-colored land cells of an illustrated fantasy game atlas. Warm pale golden sand on aged ivory parchment, delicate uneven watercolor washes, very subtle ochre mottling, tiny sandstone grains, faint flecks of moss and weathered paper fibers. Organic and richly hand-painted but quiet, bright and nearly uniform in contrast; buildings and labels must read clearly on top. Cream and warm tan palette. No hexagon lines, no grid, no coast, no rocks, no trees, no objects, no writing, no symbols, no burnt or darkened edges, no vignette. Seamless all four edges. This is an actual repeatable material tile, not a scene or an illustration of a map.



## dirt.png

The workspace yards' light packed dirt (drawn over a workspace's three cells by `islandPiece` in `src/terrain.ts`).
Generated by GPT-6.1-Sol with its built-in image tool; checked seamless in a 2×2 repeat.

Original output: `exec-3c82d5ac-bcfe-4fa3-882a-4cde77313a22.png`.

Exact prompt:

> Use case: stylized-concept. Asset: seamless repeating terrain texture, square 1024 by 1024 pixels, opaque, flat straight-down surface for the workspace yard cells of an illustrated fantasy game atlas. Light packed dirt: soft warm light-brown / tan earth, gently trodden, delicate uneven watercolor washes, subtle darker ochre mottling, a few tiny pebbles and fine grit, faint scuffs. Hand-painted but quiet, light, and nearly uniform in contrast; a cottage and small flags must read clearly on top. Clearly browner and earthier than pale golden sand, lighter than mud. No hexagon lines, no grid, no paths, no ruts, no grass tufts, no rocks larger than grit, no objects, no writing, no burnt edges, no vignette. Seamless on all four edges, matching opposite edges without visible seams when repeated in a 2x2 grid. Even distributed detail without any dominant feature. An actual repeatable material tile, not a scene.

## tree-v2.png — canopy clipping fix

Generated with the built-in image_gen tool, using buildings.png as a style reference. This standalone transparent sprite replaces the crowded tree frames from buildings.png; the original atlas remains in use for architecture and rocks. The tree is registered from its full source image with 20 pixels of extra frame padding, retaining faint leaf-edge alpha.

Original output: `exec-e7c370a3-1507-4bdd-ac14-ce509ecfcbe3.png`.

Exact prompt:

> Use case: stylized-concept. Create one SINGLE ISOLATED TREE game sprite on a genuinely transparent background. Reference image is a STYLE REFERENCE ONLY: match its round dense oak tree canopy, hand-painted watercolor/gouache leaf clusters, thin sepia ink contours, moss green and yellow-green foliage, warm highlights and fine brown branches. Camera straight down 90-degree overhead as in a fantasy strategy atlas. Show one complete irregular round deciduous oak canopy, including ALL its outer leaves and branches. Center it, occupying only the middle 60% of the square image with at least 20% completely empty transparent margin on every edge. No part of the tree or its soft tiny shadow may touch any image edge. Absolutely no rocks, shrubs, ground, trunks protruding as disconnected fragments, other trees, labels, numbers, grid, text or background. This will replace a tree extracted from a crowded sprite sheet that had accidentally included part of a rock: make this a clean standalone tree sprite with a complete natural leafy silhouette and zero neighboring objects. Keep painted texture and ink detail consistent with the source, not a photo or a 3D render.

## props.png — plaza props and status pairs

Generated with the built-in `image_gen` tool using `buildings.png` and `tree-v2.png` as style references. Local artwork only; no Phaser AE services, publishing or asset uploads were used.

Original output: `exec-8f439e40-8aef-45be-acf6-0e407a18392c.png` (1448 × 1086 RGBA), retained unchanged at `/Users/example/.codex/generated_images/01a180b5-a24e-7b40-8e10-068686088936/`.

The final atlas is 2048 × 1536 RGBA, exactly four columns by three rows of 512 × 512 cells. Sprite names and alpha-derived frame rectangles (six pixels of padding) are in `src/assets/props.json`. All entries use `props.png`; rectangle format is `[x, y, width, height]`.

Compositing: the generator's grid was too tightly spaced, so complete prop crops were centered on a new fully transparent grid, preserving aspect ratio and resampling each whole crop to a maximum dimension of 320 pixels with Lanczos. No colors were repainted and no alpha threshold was applied. Source crop detection used alpha > 1 only to locate the visible subject, retaining a further six pixels of the original image and its faint edge alpha.

The first eight source search regions, in row order, were `[40,50,350,351]`, `[420,85,654,340]`, `[710,110,1115,315]`, `[1150,55,1430,350]`, `[38,400,347,711]`, `[380,395,703,705]`, `[738,375,1068,710]`, `[1118,435,1432,685]` (left, top, right, bottom). The alpha-derived crops within these regions retain each complete subject without neighbors.

Status compositing: each pair uses an identical 300 × 300 source crop centered on its unlit object: lamp `(186,873)`, beacon `(901,870)`. For the lit version, only the circular interior (96 pixel radius) is composited from the generated lit subject centered at lamp `(537,873)` or beacon `(1269,870)`. The unlit source supplies all exterior pixels for both states, keeping the brass/stone outer rim, silhouette and registration identical. No procedural flame, recoloring or additional glow was added. Pair frames have identical dimensions and identical positions relative to their cells.

Validation: all four corners have alpha zero; every grid boundary has a fully transparent 64 pixel gutter; complete subjects fit within their cells; both status pairs share pixel-identical exteriors outside the composited interior. The original generator's very faint alpha=1 speckles immediately beside some silhouettes are retained, while grid gutters are exactly alpha zero. A QA contact sheet at `/tmp/props-preview.png` shows all frames at 48 and 160 pixel widths over a pale grey paving background; this background is preview-only.

Exact prompt:

> Use case: stylized-concept.
> Create a production GAME SPRITE ATLAS on genuine transparent alpha, EXACT 4 columns x 3 rows of equal cells, ideally 1536 x 1152 pixels. Twelve separate props, one per cell, centered precisely on its cell center, occupying only 55–65% of its cell width/height, with WIDE completely transparent gutters. Every object and tiny contact shadow fully inside its cell. No neighbor bleeding.
> Input images 1 (buildings.png) and 2 (tree-v2.png) are STYLE REFERENCES ONLY: match their hand-painted ink-and-watercolor/gouache fantasy cartography, fine thin sepia contours, warm aged cream limestone, warm timber, antique brass, moss greens, tiny material details and restrained sunlit shadows. Consistent upper-left light. This atlas supplies small plaza props to that same world. Strong clear silhouettes readable at 30–60 pixels, fine detail when enlarged.
> Camera STRICT ORTHOGRAPHIC STRAIGHT DOWN 90 degrees overhead. View tops only: circular barrel lids, crate lids, planter soil, lamp caps; circles remain circles. Absolutely no isometric tilt, front or side facades, standing elevation or horizon. No ground, paving, grass, hexagons, background wash, checkerboard, labels, lettering, numbers, UI, logos. Only tiny tight soft contact shadows under objects. Everything outside individual props is genuinely transparent.
> EXACT CELL CONTENTS, left to right:
> ROW 1:
> 1. Square aged cream-limestone planter box full of moss-green flowering shrubs with pink and white blooms, viewed down into flowers and square rim.
> 2. Round terracotta pot holding a neatly clipped spherical dark green boxwood topiary, circular leafy top canopy with a hint of terra cotta rim.
> 3. Long narrow horizontal timber-edged raised flower bed filled with mixed lavender and marigold blooms and green foliage; view down into the bed.
> 4. Small potted citrus/lemon tree in a brass-banded wooden tub; round leafy canopy with several clear yellow lemons and hints of the wooden tub rim.
> ROW 2:
> 5. Compact stack of 2–3 wooden shipping crates with rope, unmarked stencil-free wooden lids, primarily square top faces.
> 6. Compact triangular cluster of three oak barrels with brass hoops, seen straight from above as three round detailed lids.
> 7. Large round wooden cable spool/reel with visible coiled copper cable on its top.
> 8. Small rectangular timber workbench/tool chest with hammer, wrench and a few gears lying on its flat top.
> ROW 3, matched status pairs:
> 9. UNLIT wrought-iron and antique-brass street lamp seen from directly above: round shallow lamp cap with radial glass panes, cool dark glass, tiny brass finial in center. No visible tall pole.
> 10. LIT version of cell 9. This is an IDENTICAL DUPLICATE of the lamp in cell 9, same shape, size, center, outlines, brass rim, spokes, finial and angle; ONLY glass panes become warm glowing amber yellow. Keep light spill strictly on its own rim; no large halo.
> 11. UNLIT round stone fire brazier / signal beacon bowl seen directly from above, thick cream-grey weathered carved stone circular rim, dark cold coals and ash inside.
> 12. LIT version of cell 11. This is an IDENTICAL DUPLICATE of the bowl in cell 11, same exact diameter, outline, stone rim pattern, center, angle and size. ONLY inside the bowl changes to bright orange-red flame cores and yellow tips, viewed from overhead, tiny sparks contained inside the bowl. No tall side-view flames or large halo.
> Keep both lit/unlit pairs perfectly registered so their frames can swap without jumping. All 12 props have consistent painted detail and scale. No 3D render, no photorealism, no pixel art.


## structures.png — five landmarks and five cottages

Generated with the built-in `image_gen` tool on 2026-10-28, as ten individual transparent
sprites. The existing buildings atlas and all five `design/references/atlas-0*.webp` images
were visually reviewed for style; the generator received the textual style specification,
without reference-image attachments. No Phaser AE service, publishing or project upload was used.
`buildings.png` is unchanged.

Landmarks: octagonal clock hall, cruciform burgundy library, circular lighthouse workshop
with copper side wings, windmill and granary, horseshoe foundry.
Cottages: oval golden thatch, L-shaped terracotta tile, rounded turf roof, hexagonal
lavender-grey stone slab roof, narrow cedar A-frame.

Exact prompts for each subject are retained verbatim in `src/assets/structures-prompts.json`.
Original generated output filenames are in `src/assets/structures-sources.json`; originals
remain under `/Users/example/.codex/generated_images/01a182c9-59d1-7ab2-b25b-31b63b1745b5/`.

Atlas assembly: 2560 × 1024 RGBA, five columns by two rows of 512 × 512 cells.
Frame names/rectangles are in `src/assets/structures.json`, landmarks on the first row,
cottages on the second. Each whole source silhouette was located with alpha > 8 and
six pixels of source padding, then proportionally downsampled with Lanczos to a maximum
440 × 440 and centered within its cell. Source alpha within those crops is preserved;
no repainting, background replacement or recolouring. This discards only remote near-invisible
alpha speckling outside the padded subject bounds. Cell gutters are genuinely transparent.
Runtime trimming uses alpha > 0 to preserve the complete resampled silhouettes, and the
existing footprint-fitting logic sizes landmarks to ten cells and cottages to three.

Local review: `npm run render:dev`, then `http://127.0.0.1:4320/?structures`.
This illustrative fixture exercises all eight landmark and seven cottage choices using
normal deterministic neighbour balancing. Review screenshots are in `rendering/artifacts/`
(ignored local files): `structures-contact-sheet.png`, `structures-overview.png`,
`structures-0.png` through `structures-7.png`, and `structures-cottages.png`.

## medallions.png — PR status medallions

Workspaces show their pull request status as flat enamel medallions set into their yard, seen from directly above
like the rest of the map. They replaced the upright PR flags (drawn from the side, so they looked like they were
floating); the flags' atlas is kept as `../design/pr-status/flags-atlas.png`, with its history further below in
`../design/pr-status/NOTES.md`.

Generated locally by a GPT-6.1-Sol agent with the built-in image tool, using `flags.png`, the emblem atlas in
`../design/pr-status/emblems.png` and `props.png` as references. Packaging only cropped, scaled and centred the
generated subjects; nothing was repainted. The raw output and a preview over `dirt.png` are in `../design/pr-status/`
(`medallions-raw-1.png`, `medallions-preview.png`).

Original output: `/Users/example/.codex/generated_images/01a18a11-c654-73e3-8014-0e303c7ce4e7/exec-52ab77a7-1415-4f78-9444-ec60a0689891.png`.

A 1536 × 1536 RGBA atlas, three columns of 512 px cells, in `PR_LABELS` order (`src/prStatus.ts`): CI running (amber
hourglass), CI green (emerald check), CI failing (red cross), awaiting review (sky eye), approved (violet laurel and
check), changes requested (orange quill), merge conflicts (pink crossed swords); the last two cells are transparent.
The Atlas trims each cell into a frame (`flag-<state>`), lays the medallions in a workspace's two yard cells
(`placeFlags`, `MEDALLION`), and rocks only the CI-running one.

Exact prompt:

> Use case: stylized-concept.
> Asset: production RGBA game sprite atlas of seven ground medallions for Paseo Command's ink-and-watercolor fantasy map.
> Create one square 1536 × 1536 image arranged as exactly 3 columns × 3 rows of 512px square cells. One circular disc centered at each occupied cell center, each identical 380px diameter with generous transparent gutters. Bottom middle and bottom right cells entirely empty transparent.
> Camera: STRICTLY DIRECTLY ABOVE, 90 degree orthographic. Perfect circles, decorated faces parallel to image plane. Flat discs inlaid into a yard, without any visible side, thickness, tilt or perspective.
> All seven share precisely the same simple antique brass circular rim with eight small inset rivets, broad flat strongly colored enamel field, large warm ivory emblem with fine dark sepia contours. Hand-painted ink and watercolor/gouache fantasy cartography, restrained painterly enamel variation, crisp confident outlines, warm brass highlights. Consistent gentle overhead illumination. No extruded emblem or directional cast shadow. Designed to read clearly at 34px diameter: broad bold glyphs occupying about two thirds of disc diameter, minimal internal detail.
> Row 1 left: amber/gold enamel, ivory HOURGLASS, simple two triangular glass chambers with sand and broad end bars.
> Row 1 center: rich emerald green enamel, one large ivory CHECK MARK.
> Row 1 right: strong red enamel, one large ivory CROSS (X).
> Row 2 left: sky blue enamel, one large ivory EYE, almond outline with a clear central dark pupil.
> Row 2 center: violet enamel, ivory LAUREL WREATH enclosing a bold ivory CHECK MARK, few broad leaves and clear center.
> Row 2 right: vivid orange enamel, one large ivory QUILL diagonally from lower left to upper right, simple feather and shaft.
> Row 3 left: vivid rose/magenta PINK enamel, ivory CROSSED SWORDS with broad blades, obvious crossguards, short grips and round pommels, distinct from the red X.
> Row 3 center and right: FULLY TRANSPARENT, no subjects.
> Constraints: identical circular silhouettes and diameter for all seven, no shields or flags. Genuine transparent alpha everywhere outside physical discs. NO baked drop shadow, glow, ground, dirt, text, labels, numbers, watermark, checkerboard pattern, scenery, extra subjects, heavy embossing or photorealism. Do not put rivets beyond the circle perimeter. No background wash.

### Earlier: flags.png — PR status flags (retired, now `../design/pr-status/flags-atlas.png`)

Generated locally by a GPT-6.1-Sol agent with the built-in `image_gen` tool, using `props.png`, a crop of the
running map and an earlier emblem atlas as references. Local artwork only; no Phaser AE services, publishing or
asset uploads were used. The same file, its two alternates, the emblem atlas it was repainted from and the exact
prompts are kept in `../design/pr-status/` (`NOTES.md`).

Original outputs: `exec-0b97d0d2-4d85-44a0-bced-51bd4d1e0f95.png` and `exec-348043d6-2ba9-4241-9415-d5f7f3d0a6a1.png`
(chosen subjects), at `/Users/example/.codex/generated_images/01a182ce-3bf8-7b33-9893-b559af5af5b0/`.

A 1536 × 1536 RGBA atlas, three columns of 512 px cells, in `PR_LABELS` order (`src/prStatus.ts`):
CI running (amber hourglass), CI green (emerald check), CI failing (red cross) on square cloths; awaiting review
(sky eye), approved (violet laurel and check), changes requested (orange quill) on swallow-tailed cloths. Each is a
turned-timber pole with a brass foot, registered so every foot sits at [156, 404] in its cell. Packaging only
cropped, scaled and registered the generated subjects; nothing was repainted. The Atlas trims each cell into a
frame (`flag-<state>`), plants the flags in a workspace's two yard cells, and sways only the CI-running flag.

The third row's first cell is the merge conflicts flag (pink swallow-tailed cloth, crossed swords), which flies in
the review flag's place. It was generated the same way by a GPT-6.1-Sol agent with `image_gen`, registered to the
same foot anchor, and pasted in unchanged from `../design/pr-status/flag-conflicts.png`; its prompts and originals
are in `../design/pr-status/NOTES.md`. The rest of that row is transparent.

## Review symbol

`paintProbe` in `src/native/bridge.ts` draws an original cream magnifying glass with
canvas paths on the verdict's enamel medallion. It requires no external artwork.
The previously copied Probe GitHub avatar is excluded from the repository and
public history; the `diagonalprobe` integration still identifies the review bot by name.

## Overworld style

The Overworld sprites are original **HD painted, pixel-art-flavoured illustrations**,
generated with the built-in `image_gen` tool on **2026-11-06**. Chunky readable shapes,
dark outlines, smooth gradients, soft shading, glossy highlights and warm glows follow
the user's original concept. There is no fixed pixel grid, palette restriction,
nearest-neighbour downsampling or binary output alpha. All twelve sheets use smooth
RGBA sampling. The preceding strict-pixel pass is superseded and preserved privately in
ignored `artifacts/overworld/pixel-v1/`; it is not the current art direction.

The private `design/references/overworld-concept.png` was a style and subject reference
only, never traced, cropped into distributed assets or used as their background. Approved
HD robots supplied a shared finish reference for the other groups. Crops of the concept
appear only in ignored review/comparison artifacts. No Phaser tooling, app-code changes,
commits, pushes or publication were part of this artwork work.

**One authoritative prompt record:** [`src/assets/overworld/prompts.json`](src/assets/overworld/prompts.json),
keyed by sheet. It preserves every exact generation/edit prompt, input roles and raw
filenames from the prior record and all five group records. Superseded pixel-era calls
are explicitly `archived: true`, `selected: false`, `era: "pixel-v1"`; current HD lineage
uses `era: "hd-concept"`. Shared sources occur under each sheet that consumes them.
The per-group prompt files were merged and removed. Metadata links now point here.
All original raw outputs remain unchanged in ignored `artifacts/overworld/raw/`.

Frame rectangles use `x`, `y`, `w`, `h`; anchors are frame-local pixels with y increasing
downward. Intended footprints and assembly contracts are at **4× concept display scale**
(divide dimensions by four for the approximately1200px-wide map). Frame canvas padding
is not a ground footprint. Use explicit animation orders, repeat axes, attachment points,
badge slots, plateau topology and stall/slice assembly metadata rather than inferring
them from packed cell positions. Current JSON frame maps contain only the HD frames;
historical prompts do not reintroduce historical frames.



| Sheet | Size | HD frames |
| --- | --- | ---: |
| `halls.png` | 2784 × 1280 | 6 (repainted 2026-11-07, below) |
| `host.png` | 2368 × 1152 | 2 (repainted 2026-11-07, below) |
| `props.png` | 3072 × 2560 | 27 |
| `robots.png` | 2048 × 768 | 24 |
| `stalls.png` | 1536 × 1984 | 17 |
| `status.png` | removed 2026-11-07 (the Overworld draws no medallions) | — |
| `terrain.png` | 4096 × 2432 | 72 |
| `theme-farm.png` | 4096 × 1696 | 23 |
| `theme-forest.png` | 4096 × 1440 | 24 |
| `theme-volcanic.png` | 4096 × 2464 | 30 |
| `ui-world.png` | removed 2026-11-07 (the Overworld draws no labels or plaques) | — |
| `water.png` | 4096 × 3200 | 68 |



### Robots — HD painted-enamel revision

Revised with the built-in `image_gen` tool on **2026-11-06**, at the user's direction to
match the original concept's rendering rather than strict pixel art. Only `robots.png`,
`robots.json`, the `robots` prompt entries and these provenance notes changed; all other
world-sheet PNGs and JSONs were verified byte-identical to the preceding version.

The full private concept and close crops of its `api` and `data` stalls were attached as
style/proportion references. The `api`, `analytics`, `app` and `data` robot groups were
visually studied. Their chunky rounded-square helmets, dark visors, luminous oval eyes,
stubby bodies, dark contours, glossy enamel and warm reflected light guided an original
robot design. No reference pixels enter the final sprite atlas. Private reference crops
and the side-by-side review remain only in ignored `artifacts/overworld/`.

Two additional exact prompts are under `robots` in `src/assets/overworld/prompts.json`:

| Raw output (ignored, retained unchanged) | Original generator output | Use |
| --- | --- | --- |
| `raw/robots-hd-01.png` | `exec-1b97b863-d458-4cce-9422-5d9593be216c.png` | Rejected: the neutral draft looked too metallic/chrome beside the reference |
| `raw/robots-hd-02.png` | `exec-3c63651a-9117-4afe-b642-cd201f2d7401.png` | Chosen: richer orange enamel, stronger dark contour, compact painted finish |

Atlas: **2048×768 RGBA**, eight columns by three rows of **256×256** cells. Each color has
`idle-0`, `idle-1`, `working-0` through `working-3`, `drone-0`, `drone-1`; color prefixes are
`orange`, `pearl`, `neutral`, preserving the original frame names. Standing robots are
approximately **200 pixels tall** with broad transparent margins. Drones are smaller and
hover above their soft shadows. All frames use the same `[128,224]` ground anchor and the
JSON retains explicit animation order and timing. There is no pixel-grid scale or palette
list in this robot metadata; smooth sampling is requested.

Processing is local in `artifacts/overworld/robots-hd.py` (ignored), and affects only the
robots and their own review artifacts. The chosen source's eight cells are resized using
**Lanczos**. A source alpha threshold locates the body bounds for sizing only; it is never
applied to the output alpha. Source RGBA is retained through resizing. One canonical
head/body/feet/shadow supplies the registered standing frames: idle composites only the
generated eyelid region, and working composites feathered arm/hand regions, including
their changing occlusion/reflected shadows at the torso edges. The central chest, helmet
and feet stay registered. The drone similarly changes only its hover-pod regions.

Orange uses the generated enamel colors. Pearl and neutral use continuous chroma/luminance
transforms of that same source, preserving the shading, specular detail, contours and
alpha; neutral is fully greyscale for multiply tinting. **No pixel snapping, posterization,
nearest-neighbour resampling, palette restriction, dithering or alpha binarization is used.**
The final PNG retains all **256 alpha levels** and more than **54,000 distinct RGBA colors**.
The old pixel atlas, JSON, prompt snapshot and review are preserved in
`artifacts/overworld/pixel-v1/`.

Review: **`artifacts/overworld/robots-review.png`**. Every frame appears at its native
256×256 size over mid-grey `#777777` and the concept's sea blue `#024587`, with labels.
A private `api` stall crop is paired with the new robots at approximately 36-pixel body
height, both shown at native map scale and enlarged equally for inspection; the `data`
stall supplies another native-scale pair. Additional 50/60-pixel samples show the requested
map-size range. The source crops are review-only and never committed. Robot-specific
registration, alpha, color and unchanged-other-sheet checks are recorded in
`artifacts/overworld/robots-validation.json`.

Remaining visual distinction: the new design's helmet, visor and chest panel are more
regular and cleanly shaped than the concept's loosely painted miniature details. Required
orange/pearl/neutral colors also differ from its illustrated blue/purple/green robots.


### Host and world UI — HD painted revision

**Superseded 2026-11-07** (see "Overworld without overlays" below): the castles' emblem disc was repainted out, the banner and
emblem frames dropped and `ui-world.png` removed. The record below is kept for provenance.

Generated with the built-in **image_gen** tool on **2026-11-06**. Exact prompts, input reference roles, raw paths and original generator filenames for all six calls are in `rendering/src/assets/overworld/prompts.json`. No API/CLI generation, app code, commits, pushes or publication were used.

The private original concept `design/references/overworld-concept.png` guided the architecture, blue roofs, purple cloth, blank gold-rimmed navy emblem discs, parchment frames and luminous gold links. The approved `robots.png` supplied the smooth painted-enamel rendering anchor. Reference images were attached to generation calls. No concept pixels enter either distributed atlas; private crops appear only in the ignored review.

#### Deliverables

- `host.png`: **2368×1664 RGBA**, six frames: `castle-online`, `castle-offline`, `banner-0`, `banner-1`, `banner-2`, `emblem-blank`. Castle art is 1040×1004 inside 1152×1152 frames. Banner frames are 288×448, with ~234×360 material footprint; the wider cloth is ~186×294 (approximately 2:3), with a ~168px blank emblem filling most of its width. Standalone emblem uses a 384×384 frame with ~304×304 face/rim footprint. The castle has its large blank emblem; the name plaque remains separate. Offline has unlit windows, cold stone/roofs and aged brass. Banner animation is the explicit 0→1→2 sequence at 220ms per frame.
- `ui-world.png`: **2048×768 RGBA**, nine frames: `label-left|middle|right`, `host-plaque-left|middle|right`, `path-node`, `path-segment`, `path-elbow`. Small label assembles to 640×160; host plaque to 1000×240 with space for name and stats. Middle strips repeat along X. Node is 192×192 including the entire soft glow; straight segment is 128×64; elbow is 128×128 with ports left `(0,32)` and bottom `(96,128)`, rotatable by quarter turns. JSON declares anchors, intended 4× footprints, slice parts/insets, repeat axes, ports, animation order and timing.

#### Raw provenance

All raw outputs remain byte-for-byte untouched in ignored `rendering/artifacts/overworld/raw/host/`:

| Raw file | Original generator output |
| --- | --- |
| `castle-online-01.png` | `exec-5c223512-9bbd-432c-9f83-c2648b5d11ec.png` |
| `ui-world-01.png` | `exec-f2e11043-314e-411f-bb39-685b917388d7.png` |
| `banner-disc-elbow-01.png` | `exec-0737e540-e503-4413-ab1f-1ce8ed860b82.png` |
| `banner-disc-elbow-02-clean.png` | `exec-c539e87c-0082-42c8-96cb-540c41c32866.png` |
| `castle-offline-01.png` | `exec-3f178248-de3e-4627-bf2a-8e252ff57502.png` |
| `banner-wide-01.png` | `exec-9ec6a76f-62df-4ac0-b164-4f1f88703baa.png` |

The banner cleanup call removes surrounding haze while retaining only the elbow's glow. Raw displays contain warm RGB beneath zero alpha; blue-background compositing confirms genuine transparency. The offline castle is a built-in image edit of the online source. Existing pixel-v1 `host.png/json` and `ui-world.png/json` were preserved in ignored `artifacts/overworld/pixel-v1/` before replacement.

#### Processing and validation

Processing/packing is documented in ignored `raw/host/process-host.py`. Sources are cropped and normalized with **Lanczos**. Both castle states use identical source alpha, crop and resize transform, preserving the exact outer silhouette and anchor. Banner frames reuse the canonical pole, crossbar, upper cloth and blank emblem region; only the lower generated cloth varies, with a short continuous blend beneath the emblem. Stretchable parchment centers use a continuous shared RGBA column; only the cap's join-side band blends to that profile. The generated elbow's two ports blend to the straight segment's profile, making their boundary pixels exactly equal. The node's remote glow has a continuous boundary fade. No pixel snapping, nearest-neighbour downsampling, palette reduction, posterization or binary alpha is used; both atlases retain all **256 alpha levels**.

`raw/host/validation-host.json` records matching castle alpha, exact left/middle/right joins, exact X-repeat edges and elbow ports, plus SHA-256 hashes. All passed. The review is **`rendering/artifacts/overworld/host-review.png`**: every frame on mid-grey and sea blue, 3×3 checks of all three X-repeatable strips, matching concept crops at the same 4× scale, reconstructed blank plaques, link pieces, and a composition alongside the approved robots. The straight strip and sliced middle pieces repeat only along X; vertical repetition in the 3×3 review intentionally shows separate rows.

Remaining visual differences: the generated castle is taller, more symmetrical and more heavily gold-trimmed than the concept's compact keep, with a small raised central battlement. The parchment corner hardware and circle rims are cleaner and more regular than the concept's loose miniature brushwork. All faces remain blank for code-written labels/icons. Only the group's two sheets, their metadata, prompt file and private group artifacts were touched; the coordinator can merge these provenance notes into ASSETS.md.

#### Banner width touch-up

At the user’s request, `banner-0/1/2` were regenerated with substantially wider purple cloth, gold trim and swallowtail tips. The cloth is approximately 186×294 at the shared 4× scale (width:height ≈0.63, near 2:3), with a 168px blank dark gold-rimmed disc occupying about 90% of its width. Frames are 288×448, retain their previous atlas origins and pole ground anchor `(61,381)`, and preserve their 0→1→2 timing. The disc, upper cloth, crossbar and pole are identical across frames; only lower cloth folds move gently. The review’s banner detail now compares the wider sprite with the original concept banner at the same 4× scale.

The two castle frames and standalone emblem remain pixel-identical, and `ui-world.png/json` remain byte-identical to their pre-touch-up files. No other sheet was touched by this task. The original narrow host atlas/metadata/review are privately preserved in `raw/host/before-wide-*`. Raw generation is untouched. There is no new application code, commit, push or upload.


### Overworld buildings — HD painted revision (2026-11-06)

**Historical stalls v2:** the full-width-awning stall construction described in this initial buildings revision is superseded by the v3 open-booth revision below. Halls, camp and signboard remain unchanged. The v2 stall PNG/JSON are preserved privately in `artifacts/overworld/stalls-v2/`.


Generated with the built-in `image_gen` tool, requesting genuinely transparent RGBA backgrounds. Exact prompts and reference roles for all four generations are in `rendering/src/assets/overworld/prompts.json`. The private `design/references/overworld-concept.png` was attached as a style and subject reference only. Approved `robots.png` was the material/scale reference for the hall, stall, camp and signboard. The generated hall was the badge-sheet registration/material reference. No private reference pixels appear in either final atlas. Concept crops appear only in the ignored review image.

Untouched generator outputs, copied byte-for-byte into `rendering/artifacts/overworld/raw/buildings/`:

| Raw output | Original generator filename |
| --- | --- |
| `halls-hd-01.png` | `exec-bd856d1d-4281-4394-88b9-bea0079e58f4.png` |
| `stalls-hd-01.png` | `exec-1dfcaa60-860a-43ca-82ea-ca1990ab9e81.png` |
| `badges-hd-01.png` | `exec-6a141b67-02a7-43de-b5e2-b6612a0ce88f.png` |
| `camp-sign-hd-01.png` | `exec-766aaa6b-14d7-4647-bc61-40e29ce00d13.png` |

The preceding pixel `halls.png`/`.json` and `stalls.png`/`.json` pairs were preserved in `rendering/artifacts/overworld/pixel-v1/` before replacement.

Final deliverables:

- `halls.png` (2784 × 1856), 16 frames: `hall-red`, `hall-purple`, `hall-blue`, `hall-green`, `hall-amber`, `hall-teal`; `badge-code`, `badge-cube`, `badge-chart`, `badge-flask`, `badge-person`, `badge-layers`, `badge-gear`, `badge-globe`, `badge-book`, `badge-rocket`.
- `stalls.png` (1440 × 3600), 17 frames: `stall-{blue,red,purple,green,yellow}-{left,middle,right}`, `camp`, `signboard-blank`.
- Matching JSON maps provide frame coordinates, anchors in frame pixels, per-frame intended footprint at the 4× concept scale, badge slots, signboard label rectangle, camp robot slots, and stall assembly instructions. These are static assets; `animations` is empty.

Processing used Pillow with Lanczos resampling throughout. No nearest-neighbour sampling, palette reduction, pixel snapping, or output-alpha thresholding was used. Both final atlases retain all 256 alpha levels. One hall source produces all six roof variants with a spatially restricted continuous hue/chroma transform that retains source value, geometry and alpha. One stall source produces all five awning variants in the same way. Badge frames reuse the blank disc/rim cropped from the hall itself, with generated white glyphs separated by continuous colour coverage. The unrelated specular streak from each source badge face is omitted from its glyph extraction. A high-resolution soft mask isolates the canonical disc from the roof behind it. Glyph bounds are detected for cropping; source soft edges remain smooth. All badge anchors align to the hall JSON's `badgeSlot` centre.

Stall cuts follow corresponding cream-stripe phases row by row, then use a 20-pixel feather to a common source-derived RGBA boundary column. This makes all three part joins agree exactly, including alpha. The repeatable middle is 216 × 540 pixels and tiles on **x only** (`tile: true`, `tileAxes: "x"`). Left and right ends are each 240 × 540. For N robots, place left at x=0, middle i at x=240+i×216, and right at x=240+N×216, all at y=0. Width is 480+216×N. Draw approved robots after the stall at native 256 × 256 frame size (physical body height 200): their frame top-left is `(240+i×216+108−128, 426−224)`. No robots are baked into the production sheets. The camp has two clear robot positions beside the tent.

Validation: 16 hall/badge frames and 17 stall/camp/sign frames fit their atlases. All six hall variants and all five versions of each stall part have identical alpha and registration. For every awning colour, the left/right join columns and the middle's periodic edges are byte-identical in RGBA. Assembly checks use 1, 3 and 6 approved robots; the review also contains 3×3 middle-repeat grids for all five colours (horizontal continuity only), every frame on mid-grey and concept sea blue, ten hall badge overlays, camp placement, and same-scale concept comparisons.

Review: `rendering/artifacts/overworld/buildings-review.png` (ignored/private). The new hall has a somewhat deeper facade and more prominent stone doorway than the concept's flatter small halls. Stall spacing expands to preserve the approved 200-pixel robot bodies, making multi-robot stalls broader relative to the hall than the fixed concept examples. The camp tent is closer to a canvas pavilion than the concept's narrow A-frame. Materials, warm light, smooth painted detail, blank labels and gold/navy badges follow the supplied concept. No app code was changed, no commit or push was made, and no external service was uploaded to.


### Overworld stalls v3 — open wooden booths (2026-11-06)

The current `stalls.png` is **1536 × 1984**, with **17 frames**: `booth-left`, `booth-middle`, `booth-right`; blue/red/purple/yellow `awning-corner-{colour}-left` and mirrored `-right`; `booth-side-props-left-1/2` and `booth-side-props-right-1/2`; the unchanged `camp` and `signboard-blank` frames. The previous v2 full-width striped awning was rejected and is archived with its JSON under ignored `artifacts/overworld/stalls-v2/`.

The booth is an open wooden frame with short sloping timber end caps, a plain sign-support header, dark warm-brown plank interior, pale front floor and a low mossy stone base. It has no full-width cloth roof. A separate small striped canopy attaches behind **one** outer corner; side clusters supply wooden crates, barrels and a warm lit lantern or brazier on a stump. Booths carry no name sign: since 2026-11-07 names are only in the map's hover cards. Robots and nameplates are not baked into booth sprites.

Generated with the built-in `image_gen` tool. All three exact prompts, input reference paths and generator filenames are recorded in the authoritative [`src/assets/overworld/prompts.json`](src/assets/overworld/prompts.json), under `stalls`, `revision: "stalls-v3"`. The private 4× concept crops `ref-stall-api-web.png`, `ref-stall-cli.png`, `ref-stall-marketing.png`, `ref-stall-events.png` and `ref-stall-prod.png` were visually studied; the subject/style crops listed per generation were attached as references. No reference pixels enter the production atlas. Raw outputs remain byte-for-byte unchanged:

| Raw output under `artifacts/overworld/raw/buildings-v3/` | Original generator filename |
| --- | --- |
| `booth-01.png` | `exec-dfe66844-92a8-4134-84eb-de2665f37124.png` |
| `awning-corner-01.png` | `exec-684fe512-b447-49a4-8045-ccd6a55254ca.png` |
| `side-props-01.png` | `exec-067e1fa3-6df8-45c6-bc0b-4563e5b69484.png` |

Processing uses Lanczos resampling and retains smooth RGBA (all 256 alpha levels), without palette reduction, pixel snapping or binarized output alpha. The booth was cut into two 80 × 448 end pieces and one **216 × 448** middle. A 16px smooth feather to a common source-derived RGBA edge profile makes left-to-middle, repeated-middle and middle-to-right joins identical. The middle tiles on **x only**. Blue canopy geometry is shared across continuous red/purple/yellow hue variants; alpha is identical, and the right-facing versions are exact horizontal mirrors. Side-prop clusters are four separate generated compositions. Camp and signboard retain their exact v2 frame RGBA, anchors and footprints, relocated only in the atlas.

Assembly is explicit in `stalls.json`: for N robots, booth width is **160 + 216 × N**, height 448. Left starts `(0,0)`, middle i `(80+216×i,0)`, right `(80+216×N,0)`. Draw approved robot frames at **0.72×** their 256px size (about 144px body height), feet at y=372 and centres at `80+216×i+108`. The blank label rectangle is `(40,32,boothWidth−80,160)`. Draw one corner canopy first: its frame anchor attaches at `(80,32)` on the left or `(boothWidth−80,32)` on the right. Side-prop anchors attach at `(-20,448)` and `(boothWidth+20,448)`.

The ignored/private [`artifacts/overworld/stalls-v3-review.png`](artifacts/overworld/stalls-v3-review.png) shows 1/2/3/4-robot booths beside the concept crops at their existing 4× pixel scale, with real blank label parts and approved robots at 0.72×. It also shows all 17 frames on mid-grey and concept sea blue, a 3×3 middle-repeat check, the CLI detail and full production booth strip. Validation confirms disjoint frame rectangles, matching RGBA join columns, identical canopy variant alpha, exact mirrored canopies, and unchanged camp/signboard pixels. The specified 216px robot pitch gives the multi-robot booths more space between characters than the concept's tightly packed examples; the review retains that difference visibly. No application code, commits, pushes, release or external upload was part of this revision.


### Overworld terrain — HD painted revision, 2026-11-06

Generated with the built-in `image_gen` tool on 2026-11-06. Five original generations supply the materials, cliff/architecture/decal source, sea, water modules, and rocks/clouds. Exact prompts and original generator filenames are in `rendering/src/assets/overworld/prompts.json`. The private concept was attached as a style/subject reference; the approved robot atlas was an additional style reference for the first two generations. Reference pixels appear only in the ignored review, never in either exported atlas. No app code, commits, pushes, publishing, Phaser tooling or daemon mutations were involved.

#### Deliverables

- `rendering/src/assets/overworld/terrain.png`: **4096×2432 RGBA, 72 frames**.
- `rendering/src/assets/overworld/terrain.json`: frame rectangles, anchors, intended footprints at 4× concept scale, repeat axes, stacking information and the plateau assembly contract.
- `rendering/src/assets/overworld/water.png`: **4096×3200 RGBA, 68 frames**.
- `rendering/src/assets/overworld/water.json`: the same frame information and 17 registered, four-frame animation sequences in explicit playback order (180 ms per frame).
- `rendering/src/assets/overworld/prompts.json`: all five exact generation prompts and provenance.
- `rendering/artifacts/overworld/terrain-review.png`: labelled grey/sea-blue contact sheet for every exported frame, scale-matched concept comparisons, every tileable in a 3×3 repeat, all full-cliff and short-terrace corner joins, a stair stack, and a stepped island assembled from exported pieces beside an unchanged approved pearl robot.

##### Terrain frame inventory

Two compatible quiet `grass-0|1` tiles; `dirt-cobble` and `dirt`; a 768-pixel-wide horizontally repeating generated `cliff-face`; a matching short `cliff-step`; the complete `stairs` plus a seamless repeating `stairs-tread`; `bridge`; separate `flowers` and `grass-tuft` decals; four progressively sized `sea-rock-0…3` sprites with foam; three `cloud-0…2` sprites.

The modular plateau uses fifteen non-empty marching-square corner configurations, exported as **30 separate cliff/top layers**, `plateau-1…f-cliff|top`. Four corner bits mean NW=1, NE=2, SW=4, SE=8; zero draws nothing. Each has a **256×256 logical footprint**, even when the cliff image extends below it. Front cliffs drop **160 pixels**. The top mask is antialiased. Draw all cliff layers first and all top layers afterward, with matching origins; do not use the larger frame height as the grid stride. Masks 6 and 9 deliberately preserve disconnected diagonal land. The solid f top supplies the interior.

Named combined aliases provide `cliff-front|back|left|right`, four `cliff-outer-nw|ne|sw|se` and four `cliff-inner-nw|ne|sw|se` modules. They are conveniences for a single edge; prefer the separate layers for multi-row plateaus. Twelve matching `step-*` modules provide the **40-pixel** terrace drop, including all four convex and four reentrant turns; combine them with the corresponding plateau top layers. Render low terraces before high ones. The JSON records each named piece's topology, so corner orientation does not depend on guessing a filename.

##### Water frame inventory

Four **768×768** seamless sea frames; four horizontal and four vertical river frames; four vertically repeating waterfall-middle frames; four fixed-origin splash-base frames; and **48 shoreline frames**, comprising four frames each for front/back/left/right, four outer corners and four inner corners. The shoreline pieces use the same topology, grid origins and cliff drop as the plateau modules. Draw them behind the corresponding cliff layers. The four animation frames are all distinct; the river and waterfall share a fixed alpha silhouette across animation, and the splash keeps its original spray silhouette. Motion is a small cyclic material displacement, rather than independent redrawing of land banks or cliff geometry.

#### Raw sources and preservation

Untouched generator outputs are retained byte-for-byte in `rendering/artifacts/overworld/raw/terrain/`:

| Local raw | Original generator output |
| --- | --- |
| `materials-01.png` | `exec-f0309d81-c400-4652-a36f-e6835d4baf36.png` |
| `cliffs-01.png` | `exec-61ad2e8e-614c-43f7-a9ca-11e16d731f1e.png` |
| `sea-01.png` | `exec-91c257f6-b168-4703-8570-bf08f483edfa.png` |
| `water-modules-01.png` | `exec-321f1fac-d8dd-4602-b018-9190f1423ae3.png` |
| `rocks-clouds-01.png` | `exec-d68ef427-9239-455d-8ec8-4c05265669f1.png` |

The preceding terrain PNG/JSON were preserved at `rendering/artifacts/overworld/pixel-v1/terrain.png|json` before replacement. No other group's sheets were modified.

#### Processing

The exported art derives from generated bitmap material; it is not a traced concept crop or a procedural pixel-art replacement. Whole object crops retain their source alpha and are resampled with Lanczos. Alpha >10 is used only to locate a padded subject bounding box; it is never used to binarize the exported alpha. Narrow opposing texture edge bands are cross-blended for seamless repeats. The two grass variants share feathered border material so they can mix.

Cliff stone and grassy-lip pixels from the generated strip are projected through a shared set of rounded rectangular topology masks. Rock is extruded downward from each front-facing edge, with a narrow bevel at side/back boundaries. Full and short cliffs share the same original rock material and the same top masks. This supplies consistent corners without asking separate generations to invent incompatible join profiles. Shore foam retains the generated froth texture, projected along the same coast's softened boundary field; the across-band coordinate preserves the original foam breakup. River rotation supplies the corresponding vertical stream. Animation uses cyclic displacement of the generated material and fixed registration. No source was pixel-snapped, nearest-neighbor downsampled, posterized or palette-quantized.

Both atlases have **32-pixel transparent packing gutters** and all 256 alpha values. Original source images remain unchanged; compositing and mask projection occur only in the exported derivatives.

#### Verification and remaining differences

`raw/terrain/verification.json` records directional repeat checks, the assembly grid, topology results, alpha coverage and raw SHA-256s. `raw/terrain/final-validation.json` records frame bounds/metadata, empty packing gutters, original-output byte comparisons and four distinct registered images for all 17 animations.

All **47 repeatable frames** have zero RGBA mismatch between their first and last pixels along the declared repeat axis. Every one appears in a labelled 3×3 repeat. All **128 valid full-cliff topology adjacency pairs** have matching corner-mask edge profiles and pixel-identical visible top-edge profiles on both review backgrounds; all **100 valid rectangular short-terrace pairings** are also assembled in the review. The large review island uses a stepped perimeter, reentrant corners, a short raised terrace, stairs, bridge, river/waterfall/splash, decals and a sea rock. There is no painting over its joins.

The materials now have smooth painted shading and belong much more closely to the concept's glossy robot world than the former pixel pass. Remaining differences are visible in the comparisons: the sea has finer, more densely distributed highlights; the waterfall is silkier and more luminous; the cobbles are rounder; and the intentionally modular island outlines are regular rounded steps rather than the concept's irregular sculpted coastline. Sparse decals are separate, leaving the building areas clear for the integrating agent to populate.


### Overworld themes — HD painted revision (2026-11-06)

Generated with the built-in `image_gen` tool. The private original concept was attached as a style/subject reference, and the approved `robots.png` as a finish reference. Reference pixels appear only in the ignored review; none were packed into these atlases. No app code, uploads, commits, pushes or Phaser tools were involved.

Exact prompts for all five calls are in `src/assets/overworld/prompts.json`. Unchanged generator PNGs are retained under `artifacts/overworld/raw/themes/`:

| Local raw file | Generator filename | Use |
| --- | --- | --- |
| `forest-01.png` | `exec-0e197b0f-a950-4638-893d-28ad1ccf0fc2.png` | First vegetation/ruins pass; superseded by extraction refinement |
| `forest-alpha-02.png` | `exec-5fe91013-4358-4658-8eb5-3eb584300dfb.png` | Selected forest vegetation/ruins; tool background-extraction refinement |
| `mountains-01.png` | `exec-b3f265ef-ad45-42b9-ab4e-cb6df77b7e0e.png` | Three snowy peaks, three volcanic mountains, erupting volcano body, separate smoke |
| `farm-01.png` | `exec-03339874-983b-449d-b860-955f336824f4.png` | Windmill body/rotor, crops, fence, autumn trees and farm props |
| `volcanic-01.png` | `exec-ce2fcb7c-74ef-4623-a5b6-13f4724d984e.png` | Crystals, mining structures/track, rocks, dead trees and lava |

Prior pixel PNG/JSON files were copied to ignored `artifacts/overworld/pixel-v1/theme-{forest,farm,volcanic}.{png,json}` before replacement.

| Atlas | Size | Frames | Contents |
| --- | --- | ---: | --- |
| `theme-forest.png` | 4096 x 1440 | 24 | Four deciduous, four pine/fir, two blossom, three bush, three flower, three mossy boulder, three snowy mountain, wall ruin and standing arch |
| `theme-farm.png` | 4096 x 1696 | 23 | One windmill body, four registered separate sail frames, four assembled windmill convenience frames, wheat, fence rail/post/corner, four autumn trees, two hay bales, scarecrow, farm cart, lavender rows and flower rows |
| `theme-volcanic.png` | 4096 x 2464 | 30 | Three lava mountains, volcano body, three registered separate smoke frames and three assembled erupting frames, three pool and three river frames, four crystals, mine entrance, rail and curve, ore cart, watchtower, three rocks and two charred trees |

Processing is preserved in ignored `artifacts/overworld/raw/themes/package.py`. It uses smooth source RGBA and Lanczos sizing, with bicubic rotation for the windmill sails. There is no nearest-neighbour resampling, palette restriction, posterization, pixel snapping or binary output alpha. A temporary alpha threshold locates subject bounds only. The forest source placed rows unevenly, so its crop boundaries follow verified empty row gutters instead of nominal equal-height cells. Every sheet retains all 256 alpha levels. The raw PNGs are unchanged; exact source cells, subject crops, any interior insets, resampling and registration information are in each atlas JSON.

All dimensions and per-frame `footprint` fields are at the intended 4x concept scale: vegetation roughly 280–340 px tall, windmill body 420 px, tower 380 px, large peaks 760–820 px wide; the approved standing robot is about 200 px tall. Standing anchors are bottom-centre; modular repeats use top-left anchors. Rotor and smoke anchors are their attachment points. Frames have at least 64 px between frame rectangles and 32 px atlas outer padding.

The windmill uses one unchanged body and one canonical generated rotor, rotated in 22.5-degree steps, with explicit frame order/timing. Its JSON supplies the body's rotor attachment point. The volcano similarly keeps one fixed rock/lava body; only its separate plume expands slightly, registered at the crater. The pool and river vary a subtle traveling molten glow while retaining fixed geometry and identical alpha. Separate pieces and assembled convenience animations are both provided.

Repeats: wheat is an interior source crop scaled with Lanczos, made periodic through a cosine-windowed blend with half-period offsets in both axes. River crops omit the source's transparent end padding and use the same periodic blend in y. Only shared boundary pixels are equalized; no strip is stretched to a flat color. Fence and mine straight rails use interior generated strips and continuous RGBA edge crossfades. The fence corner assembles exactly those straight rails with the generated post, and the mine curve is a bilinear polar warp of its straight rail, with four-pixel matching terminal ports. The generated corner candidates remain in raw source sheets but are superseded by these registered modular derivatives. Metadata declares repeat axes and connection ports. Opposing declared tile edges and both ports of each modular corner match byte-for-byte in RGBA.

Review: `artifacts/overworld/themes-review.png` (3360 x 22149). All 77 frames appear at native asset scale on mid-grey #777777 and concept sea blue #024587. It includes 4x concept crops alongside original sprites and the approved robot, literal 3x3 tile repetitions, and fence/track corner joins. Reference pixels stay in this ignored review only. A smaller navigation image and machine-readable dimensions, hashes, smooth-alpha, tile-edge and animation-registration checks are under `artifacts/overworld/raw/themes/`. The review found and corrected uneven forest-row cropping and transparent padding in the lava repeat.

Remaining visual distinctions: standalone trees have more regular, clearly outlined leaf clusters than the concept's densely overlapping miniature foliage; snowy peaks have more fine painted rock texture; the windmill is rounder and more golden, with broader sails; track and fence corner modules use clean right-angle joins suitable for assembly. Wheat has a fairly regular repeating motif. These are original, separable sprites, so the concept's surrounding terrain shadows and tightly composed scenery are not baked into them. Smoke/lava cycles are subtle three-frame ambient variations rather than a simulated eruption.


### Overworld props and status — HD painted revision

**`status.png` removed 2026-11-07** (see "Overworld without overlays" below): the Overworld draws no PR, Probe or auto-merge
medallions. Its record below is kept for provenance.

Generated with the built-in `image_gen` tool on **2026-11-06**. The first three generations used
the private `design/references/overworld-concept.png` as style/subject reference and
`rendering/src/assets/overworld/robots.png` as the approved HD finish anchor. The concept
was never traced or copied into asset files. Private reference crops appear only in
the ignored review image. No application code, commit, push, upload or Phaser tooling.
One subsequent targeted edit used a crop of the two original status frames as its only
input, replacing their unclear findings/count-box and auto-merge/branch-node marks.

Exact prompts, input roles, raw paths and original generator filenames:
`rendering/src/assets/overworld/prompts.json`.

| Untouched raw PNG in `rendering/artifacts/overworld/raw/props/` | Generator filename |
| --- | --- |
| `props-static-hd-01.png` | `exec-c40f327a-c2ad-4fb1-bdf9-2ad2f8f1b6d6.png` |
| `props-lights-hd-01.png` | `exec-ac01faae-8296-478e-912f-8d4df231e3f8.png` |
| `status-hd-01.png` | `exec-8f8c4119-2490-4e8d-bc6b-802d3269b7ba.png` |
| `status-touchup-hd-02.png` | `exec-69441bca-9f40-473a-99bb-09b010fd634a.png` |

The previous pixel `props.png/json` and `status.png/json` were preserved in
`rendering/artifacts/overworld/pixel-v1/` before replacement. Robots and every other
group's sheets are outside this assignment and were not edited.

#### Deliverables

`rendering/src/assets/overworld/props.png` is **3072 × 2560 RGBA**, six columns by
five rows of **512 × 512** cells, with **27 frames**:

- `barrel-0`, `barrel-1`, `crate-0`, `crate-1`, `sack-0`, `sack-1`.
- `market-goods-table`, `bench`, `potted-plant`, `archery-target`, `well`, `tent-small`,
  `signpost`, `fence`, `flowers-0`, `flowers-1` (the last two are planted flower pots).
- `lantern-unlit`, `lantern-lit` (iron post), `stone-lamp-unlit`, `stone-lamp-lit`.
- `brazier-unlit`, `brazier-lit-0`, `brazier-lit-1`, `brazier-lit-2`.
- `campfire-0`, `campfire-1`, `campfire-2` (stone ring, crossed logs and two seat logs).

Every standing frame uses the **[256, 432]** ground anchor. `props.json` records
per-frame pixel rectangles, intended ground footprints at **4× concept scale**, source
crops, smooth resize scales and registration. `brazier-lit` and `campfire` each loop
through frames 0–2 at **140 ms/frame**, with explicit order and durations. Barrels are
100/80 pixels tall, crates 100/80, sacks 90, table 210 pixels wide, bench 180 wide,
plant 120 tall, target 180 tall, well 170 wide, tent 220 wide, signpost 150 tall,
fence 180 wide, flower pots 90/80 tall, iron post 260 tall and stone post 340 tall.
These are intended subject dimensions; transparent cell padding is additional.

`rendering/src/assets/overworld/status.png` is **896 × 896 RGBA**, four columns by
four rows of **224 × 224** cells, with **13 frames**, all anchored at **[112, 112]**:

- `ci-running` — amber hourglass.
- `ci-green` — emerald check; `ci-failing` — red cross.
- `review-awaiting` — sky eye; `review-approved` — violet laurel/check;
  `review-changes` — orange quill; `conflicts` — pink crossed swords.
- `probe-reviewing` — blue magnifier/three dots; `probe-approved` — green magnifier/check;
  `probe-findings` — orange magnifier/clear exclamation mark; `probe-stale` — grey magnifier/refresh;
  `probe-failed` — red magnifier/cross.
- `auto-merge` — bold teal seal with two broad white paths joining one upward arrow.

The seven PR states, five Probe verdicts and seal follow `rendering/src/prStatus.ts`,
`rendering/src/probe.ts` and the medallion/Probe/auto-merge descriptions in ASSETS.md.
Those definitions contain no merged/draft/closed medallion states, so none were invented.
Normal discs have an intended **160-pixel diameter**, **40 px on the map**. The seal is
**72 pixels**, **18 px on the map** (**45%** of a normal badge's diameter), centered on
a badge's upper-right rim with an offset of approximately **[+14,-14] map pixels**.
`status.json` records canonical enamel colors, glyph descriptions and seal placement.
The previous blank findings `countArea` was removed in the targeted edit; the badge
now conveys findings with a clear exclamation mark, without digits or a count inset.
All marks are original simple glyphs, with no copied avatar, text, number or logo.

#### Processing and checks

Reproducible group-only packing/QA: `rendering/artifacts/overworld/raw/props/pack.py`.
Raw PNGs remain byte-for-byte unchanged. Cropping and downsampling use **Lanczos**.
Opaque-alpha bounds are used only to locate and size subjects; output alpha is never
binarized. No pixel snapping, nearest-neighbour sampling, posterization, palette
quantization or dithering. Final props retain **256 alpha levels**, status **249**.
Both backgrounds are genuinely transparent; there is no checkerboard or ground slab.

Lamps share one canonical unlit fixture. Generated lit glass regions are composited
inside that fixture; a continuous alpha weight isolates the external warm glow from
opaque generated geometry. Thus there is no second contour from the independently
generated lit pose. Braziers share the unlit bowl exterior, iron supports and masonry;
only embers/flame/halo change above the bowl. Campfires share the first frame's stones,
logs and seats; only flame/halo above them change. Exterior warm glow can change
transparent background pixels. Assertions confirm all fully opaque structure pixels
in the fixed base regions remain byte-identical across each registered group.

Badges use one generated golden rim and smoothly composite the generated enamel/glyph
interiors inside it. This gives every state the same circle and rim. Source circles
are normalized to their intended circular diameter with smooth resampling. The seal
uses the same rim at 45% scale. The targeted edit replaces only the generated enamel/
glyph interiors of `probe-findings` and `auto-merge`, preserving their shared golden
rim style. No glyphs were procedurally painted. The other eleven status frames are
byte-identical to the preceding revision, as are both props PNG and JSON files.

Checks passed: frame counts; metadata/image dimensions; every frame in bounds and
nonempty; genuine 0–255 transparency in every frame; shared structural registration;
ordered nonempty animations; all requested props and all 13 code-defined badges.
Minimum fully transparent frame margin is **38 px** for props and **30 px** for status
(at least **76/60 px** between adjacent frame subjects). No item is declared tileable;
there are no terrain textures or repeatable strips in these two sheets.

Final PNG SHA-256:

- props: `f332e2110caab786677e1f1163d31a27bc3abf14655cf3a2b2f8efd95aeda6dc`
- status: `7e1829c7422df158e37dc740f9b4a3e7aea242c1dd241b288e3c43bcfb161074`

Raw PNG SHA-256:

- static: `5f087f18698758be6c96e949f5c9017b27537755ced834df51e8ecb25009b313`
- lights: `2ca6bfc48ba2502229b89771e5b611b435fc0d9625f11372d37f989a7df1bcf1`
- status: `67b6a3bd858dd4d69d64d80560f084e143687b067a0c085378f26b4a174f9cea`
- targeted status edit: `273515c2ef5ea171135623eb3b384b36842174d0415dfa27e1bfea8dd1c61264`

#### Review and remaining visual distinctions

**`rendering/artifacts/overworld/props-review.png`** contains every frame labelled over
mid-grey **#777777** and concept sea blue **#024587**, including native **40 px** badges
and **18 px** seal samples. A dedicated row shows the seal perched on the upper-right
rim of six 40 px badges over both backgrounds, including the revised findings badge.
Private concept bridge-lamp, camp/tent and crate crops are
shown at approximately matched concept scale, next to the approved orange robot.
A concept dark/gold project-badge crop is normalized to a similar displayed diameter
to compare materials; it is not one of the app's status symbols.

The final sprites share the robots' rounded dark outlines, rich warm materials,
smooth painted shading and glossy highlights. They remain cleaner and more regular
than the concept's loosely painted miniature details. Badge rims are more polished,
and their saturated colored enamel is brighter than the concept's dark project discs
so status colors remain distinguishable. The stone lamp has a stepped freestanding
masonry foot instead of the concept's bridge-integrated parapet, allowing independent
placement. None of these files is integrated into app code yet.


### Integrated composition review

The ignored `artifacts/overworld/mock-full.png` assembles three themed host islands using
only current atlas frames and their JSON assembly contracts, with plain demonstration
text on blank plaques. Sea/water animations are shown at frame0. Its display-size version
is `mock-full-1200.png`; `mock-vs-concept.png` puts that view beside the private concept.
The concept is included only in this ignored comparison, never in the mock or the assets.
The local script is `artifacts/overworld/mock-full.py`. Assembly observations and coverage
checks are recorded in `mock-full-report.json` and `mock-full-findings.md` beside it.

### Overworld concept materials — textures.png

Generated with the built-in **`image_gen`** tool on **2026-11-06**, as a separate
material atlas. The existing `overworld/terrain.png|json` and `water.png|json` were
left byte-identical. No application code, commit, publishing, upload or Phaser tools
were involved. All nine exact generation/edit prompts, reference roles and source
filenames are recorded under **`textures`** in
[`src/assets/overworld/prompts.json`](src/assets/overworld/prompts.json).

The six ignored `artifacts/overworld/ref-tex-{sea,sea2,grass,grass2,cliff,cliff2}.png`
images were inspected and supplied as private material references. Their pixels are
never packed into the atlas; they appear only in the ignored comparison review.
Source art is newly generated, crisp painted, pixel-art-flavoured fantasy material,
with smooth antialiasing and unrestricted color, rather than strict pixel art.

`src/assets/overworld/textures.png` is **2176×3008 RGBA**, eight frames with
**32-pixel transparent gutters**. `textures.json` records exact frame rectangles,
top-left anchors, 4× intended footprints, concept-scale footprints, repeat axes,
material names, source filenames, and explicit sea animation order:

| Frames | Size at 4× source scale | Seamless axes | Contents |
| --- | --- | --- | --- |
| `sea-0…3` | 1024×1024 each | x, y | Registered blue sea, isolated short cyan/white crescent crests, dark troughs; small cyclic crest drift |
| `grass` | 512×512 | x, y | Sunlit yellow-green meadow, fine blade/tuft marks, sparse tiny flower specks |
| `grass-shade` | 512×512 | x, y | Matching blade layout in cooler, darker under-tree green |
| `rock` | 1024×256 | x only | Grey/blue-grey vertical cliff facets, warm upper-left planes, dark crevices, sparse moss |
| `rock-volcanic` | 1024×256 | x only | The same generated facet layout in muted purple-grey |

The sea animation loops in frame order 0,1,2,3 at **200 ms per frame**, with one
fixed 1024×1024 frame/anchor/footprint and small wraparound material displacements
of `(0,0)`, `(2,1)`, `(3,0)`, `(1,-1)` source pixels. All four are distinct. Rock's
top image edge is the grass-lip junction; its separate grassy lip is supplied by
the terrain renderer. Rock is intentionally not a vertically repeating material.

Untouched generator outputs are kept byte-for-byte in
`artifacts/overworld/raw/terrain/`. Iterations remain private for provenance:

| Raw filename | Original generator filename | Selection |
| --- | --- | --- |
| `textures-sea-01.png` | `exec-0dfa8457-a510-4118-a99a-77d8e5569d2d.png` | Initial darker sea |
| `textures-sea-02-color.png` | `exec-a4b63665-012e-4b49-8442-7d735659c1c7.png` | Color revision |
| `textures-sea-03-color.png` | `exec-f25ba601-62dc-4427-a166-42cdf2649a7f.png` | Color revision, too much fine sparkle at map scale |
| `textures-sea-04-density.png` | `exec-016c8df6-ad72-47c8-bacd-7a4babeb1b8f.png` | Reduced flecks, quieter crest distribution |
| `textures-sea-05-final-color.png` | `exec-86290146-6eca-4635-b7a5-bb745416209e.png` | **Selected sea** |
| `textures-grass-01.png` | `exec-55dcc2ec-f54e-494c-b0a4-32dafad5b84e.png` | Initial sunny grass |
| `textures-grass-02-shade.png` | `exec-7ea50627-fd4d-4949-8fc1-3dd77f31b8c3.png` | Paired sun/shade material |
| `textures-grass-03-color.png` | `exec-17405307-de5f-4705-a805-9e7a4a9706c7.png` | **Selected grass pair** |
| `textures-rock-01.png` | `exec-37299f6e-a91a-4ebf-886d-f3c59f46d418.png` | **Selected rock pair** |

Processing is limited to material-band crops, **Lanczos** resizing, narrow
opposing-edge blends to make repeat periods continuous, and the sea's small cyclic
displacements. Sea/grass use 16-pixel seam bands, rock uses 20 pixels, and displaced
sea frames receive an additional 8-pixel edge pass. Color correction and the
density revision were generated with `image_gen`, not painted procedurally or
applied with a palette lookup. No reference tracing/cropping into assets, nearest
neighbor downsampling, posterizing, pixel snapping or alpha binarization is used.
Material interiors are opaque, as expected for terrain, with genuine transparent
atlas gutters.

**`artifacts/overworld/textures-review.png`** shows every material tiled **2×2,
then downscaled exactly 4×**, beside the matching private concept crops also
downscaled exactly 4×. Thus the comparison uses the concept's original display
scale. Additional labelled 3×3 thumbnails inspect all eight repeat periods.

Validation in `raw/terrain/textures-validation.json` records **zero RGBA mismatch**
across every declared repeat axis, four distinct registered sea frames, all nine
raw-source byte comparisons and unchanged SHA-256s of the prior terrain/water
sheets. Final mean RGB values are approximately sea **(46,106,146)**, sunny grass
**(135,182,47)** and shaded grass **(63,112,38)**. A bright-crest component check
finds 227 components with median width **25 source pixels**; separate tiny glints
are included in that count. These are original repeatable materials, and their
distribution remains more regular than the concept's locally composed water and
meadow around rocks, buildings and foliage. The native-scale review exposes that
remaining difference rather than implying a pixel-identical reconstruction.


# Overworld round 2 — foliage and calm sea

Generated with the built-in **image_gen** tool on **2026-11-06**. Seven exact
generation/edit prompts, reference roles, selection flags and original generator
filenames are recorded in `prompts-foliage.json` beside this note. The original
concept and the three `ref2-forest`, `ref2-foliage-farm` and `ref2-coast-bottom`
crops were inspected and supplied as private style/subject references. Reference
pixels appear only in the ignored review, never in either distributed sheet.

## Deliverables

| Sheet | Canvas | Frames |
| --- | --- | --- |
| `rendering/src/assets/overworld/foliage.png` | 3072 × 1952 RGBA | 30 |
| `rendering/src/assets/overworld/sea2.png` | 2176 × 2176 RGBA | 4 |

Each has a matching JSON frame map with exact rectangles, frame-local pixel
anchors, footprints at 4× concept scale, concept-display footprints and provenance.
Foliage uses a bottom-centre ground anchor and supports overlapping scenery.
The atlas has 32px outer padding and at least 64px between frame rectangles.

Foliage inventory (all indices begin at zero):

- `forest-mass-0…7`: eight layered mixed fir/deciduous forest patches, **420–700px**
  wide, with continuous dark understory and occasional embedded blossom bushes.
- `forest-fir-0…3`: four dark fir groves, **500–650px** wide, for back edges.
- `autumn-mass-0…3`: four gold/orange/russet mixed groves, **560–650px** wide.
- `blossom-mass-0…2`: three green/pink/white mixed groves, **540–580px** wide.
- `bush-row-0…3`: four low flowering borders, **340–380px** wide.
- `flower-bed-0…3`: four small pink, blue, red and white/yellow clumps,
  **140–145px** wide.
- `volcanic-mass-0…2`: three green woodland/charcoal-purple boulder mixtures,
  **600–650px** wide, with no baked lava or mountain peak.

`sea-calm-0…3` are **1024 × 1024** opaque water materials within transparent
32px atlas gutters. They repeat on both axes (`tile: true`, `tileAxes: "xy"`).
The explicit animation order is 0, 1, 2, 3, looping at **240ms per frame**.
All four share their origin, canvas, footprint and generated wave layout; tiny
wraparound displacements `(0,0)`, `(1,0)`, `(2,1)`, `(1,1)` source pixels provide
a restrained ambient loop. These are registered derivatives of one selected
generated tile, rather than independently generated waves that would flicker.

## Raw provenance

Untouched tool PNGs are preserved byte-for-byte in `raw/foliage/`:

| Raw output | Use |
| --- | --- |
| `forest-01.png` | Selected: eight mixed forest masses |
| `fir-autumn-01.png` | Selected: four fir and four autumn groves |
| `blossom-volcanic-01.png` | Selected: three blossom and three rocky woodland masses |
| `bush-flower-01.png` | Selected: four flowering borders and four small beds |
| `sea-calm-01.png` | Superseded: wave marks too long |
| `sea-calm-02-small-crests.png` | Superseded: short crests accepted, body too dark |
| `sea-calm-03-royal-blue.png` | Selected: deep royal-blue body and sparse short crests |

Foliage source sheets are 1536 × 1024 with genuine smooth alpha. Sea source
outputs are 1254 × 1254 opaque RGB. The tools' original filenames and paths are
in the prompt record. `raw/foliage/validation.json` records SHA-256 hashes and
byte comparisons with those original tool outputs.

## Processing and verification

`raw/foliage/pack.py` preserves the processing recipe. Foliage processing is
limited to separating source cells, locating subject bounds, cropping and
**Lanczos downsampling**; no frame is enlarged. An alpha threshold finds crop
bounds only; saved alpha is never thresholded or binarized. Leaf colors, shading,
flower shapes and silhouettes come from image_gen. No palette quantization,
nearest-neighbour filtering, traced reference parts or procedural replacement
art is used.

The selected sea is Lanczos-downsampled to 1024px and receives a narrow **32px
smoothstep opposing-edge blend**. The registered drift frames receive an **8px**
boundary pass. Final declared repeat edges match **exactly in all RGBA channels**
for every sea frame on both axes. All four frames have distinct hashes. Every
foliage frame retains more than 100 different alpha levels, and all rectangles
and anchors pass bounds checks. All seven raw outputs match their original
generator files byte-for-byte.

`rendering/artifacts/overworld/foliage-review.png` (**1800 × 5757**) shows every
frame on mid-grey and concept sea blue. Foliage contact images are shown at half
source scale; separate reference comparison panels use **identical concept
display scale**: the supplied 3× crops are divided by three and 4× source art by
four. Each sea frame is also repeated literally **3 × 3** without margins or
inter-tile crossfades, then displayed at quarter source scale. The final review
and its comparison and repeat sections were visually inspected. The review
contains private concept crops and must stay ignored.

## Remaining visual differences and assembly

The new foliage has connected overlapping canopy masses and dark lower rows,
rather than the previous isolated tree sprites. Crown/leaf and flower shapes
remain more regular and neatly outlined than the concept's locally composed,
loosely painted miniature foliage. Their silhouettes are generally shallow,
wide patches; stagger and overlap back firs with front masses to build taller
forests without placing individual trees. Some grove variants have fewer
separately countable crowns because the layers merge into a single canopy.

The water is intentionally calm, deep blue and sparse in short cyan crest marks;
it does not reproduce the concept's energetic surf beside rocks and waterfalls.
Localized lighter cyan coastal water must come from separately placed shore
water/surf art. A repeated open-sea tile cannot know where a coastline is, so it
does not bake in a global cyan-to-blue coastal gradient. The four frames provide
subtle drift rather than a full hydrodynamic wave simulation.

No application code or existing sheet was changed for this group. No builds,
commits, pushes, uploads, app launches or Phaser tools were involved.


# Overworld coast decals — coast.png

Generated with the built-in **image_gen** tool on **2026-11-06**. Ten exact generation/edit
prompts and original generator filenames are preserved in `prompts-coast.json`. Untouched
raw PNG outputs live in ignored `raw/coast/`. The private concept's `ref2-coast-left.png`
and `ref2-coast-bottom.png` were visual/material references only. The approved
`theme-forest.png` supplied an additional painted-finish reference for the initial fronts.
No reference pixels are packed into the distributed atlas; concept crops appear only in
the ignored review. No app code, commit, push, upload or Phaser tooling was used.

## Deliverables

`rendering/src/assets/overworld/coast.png` is **3072 × 2560 RGBA**, eight columns by
eight rows of **384 × 320** cells. `coast.json` records every rectangle, frame-local
anchor, 4× footprint, concept footprint, original source crop, overlap contract and
ordered animation. All 64 frames use the waterline anchor **[192, 240]**.

- `cliff-front-0…7`: eight continuous rocky walls, **360 × 180** art pixels, shallow
  yellow-green mossy overhanging lip, broad vertical grey/lavender facets, dark wet foot.
  Each has irregular top and bottom edges and a **24 px continuous alpha fade** at
  both ends. Start with **48 px overlap / 312 px placement step**.
- `cliff-corner-left-0…2`, `cliff-corner-right-0…2`: three rounded headlands per side,
  **280 × 180** art pixels. The open continuation side has the same 24 px joining fade;
  the rounded outside contour retains its generated alpha. A second generation uses
  a shallow grassy top, so the front face joins without the original deep grass return.
- `outcrop-0…5`: six original rock heaps/single boulders, respectively **220 × 140**,
  **160 × 150**, **120 × 90**, **190 × 100**, **130 × 160**, **110 × 90** art pixels.
- Every preceding rock frame has a **`-volcanic`** counterpart, for **40 rock frames**
  total. Volcanic material uses muted purple-grey basalt, indigo crevices, cool grass
  and darker wet feet. No lava is baked into these coast pieces.
- `surf-0-0…3` through `surf-5-0…3`: **24 frames**, six four-phase looping groups.
  Groups 0–3 are 300 px wide cliff-foot ribbons: gentle, scalloped, inlet and left
  headland (mirror for right). Groups 4–5 are **240 / 150 px** wide hollow foam rings.
  Explicit order **0 → 1 → 2 → 3**, **180 ms per frame**, one fixed anchor and one
  common source crop/resize transform across all four phases in each group.

Divide positions and sizes by **four** at concept map display scale. Footprints describe
the ground/water contact, not transparent canvas padding. Cliffs are decals stamped
along the front-facing outline; the existing island painter supplies the plateau behind
the thin generated lip. The sheet intentionally contains no painted sea patch.

The front frames declare **`tile: true` / `tileMode: "overlap-x"`**. This means repeatable
overlap stamps, **not** rectangular seamless texture tiles; there is no vertical repeat.
Corners, outcrops and surf do not declare rectangular tiling. Fronts can be alternated
with small waterline offsets; curved outlines need local positioning without rotating
the rock facets away from screen vertical. Waterline anchors also align the separate
foam rings with the outcrop feet.

## Generation and processing

The first front pass had unwanted white haze; a targeted image_gen transparency edit
removed it. The initial corner/outcrop sheet received an analogous cleanup. Volcanic
versions are generated material edits, not procedural recoloring. Surf likewise received
a targeted edit to remove diffuse background haze while preserving the foam strokes.
Initial corners exposed too much plateau and did not meet the front lip at the same
height; the final six shallow corners were generated separately, followed by a volcanic
material edit. The original corner/outcrop sheets now supply only the six outcrops per
theme. All rejected/partially selected raw outputs remain unchanged for provenance.

Reproducible group-only packing and review: `raw/coast/pack.py`. Processing is cropping,
**Lanczos** resampling, atlas placement and the narrow continuous joining alpha fades.
Front source crops preserve broad facet proportions rather than squeezing each entire
extra-wide generated wall into a narrower decal. Alpha thresholds locate subject bounds
only; output alpha is never thresholded or binarized. Surf rows 3/4 split in the actual
empty gutter at source y=660, preserving the large ring's upper crest and preventing it
from entering the headland animation. No reference tracing, procedural rock/foam painting,
palette reduction, nearest-neighbour sampling or pixel snapping is used.

## Review and checks

**`rendering/artifacts/overworld/coast-review.png`** shows all **64 frames**, each over
grey **#777777** and concept sea blue **#024587**, at full asset resolution. Its upper
section puts a coast assembled **only from this sheet's pieces** next to both requested
private coast crops at a common **3× concept display scale**: the supplied crops are
already 3×, while the new 4× art is resized by 0.75. A second row shows the volcanic
assembly. Smaller previews show both assemblies at native concept display scale.

Private assembly-only images: `raw/coast/mock-coast.png` and
`raw/coast/mock-coast-volcanic.png`. `raw/coast/mock-coast-surf.gif` previews the four
foam phases over a fixed assembled coast. These mocks contain a solid sea-color backing
only; no other atlas, procedural landscape or reference artwork supplies their coast.

`raw/coast/validation-coast.json` records successful checks: **64 nonempty/in-bounds
frames**, transparent margins, partial-alpha contours, six groups of **four distinct
registered generated phases**, original raw PNG SHA-256 preservation and unchanged
existing sheets. The pack script verifies source bytes before/after processing and
asserts every pre-existing PNG/JSON sheet remains byte-identical during packing.

## Remaining differences

The concept composes its headlands, inlets and foam individually. These reusable decals
still have a more regular facet rhythm and denser, more decorative grass lips. Foam is
brighter and more luminous than the concept's broken chalk-white brush marks. The mock
is a coast construction test with a shallow top lip, not a complete island; application
integration and plateau masking are outside this artwork assignment. The generated
corners also have less dramatic depth than the concept's largest projecting headlands.
These are useful original coast parts, not a pixel-identical reconstruction of the concept.

### Overworld without overlays — repaint, 2026-11-07

At the user's request the Overworld lost everything laid over its painting: names, plaques, emblems, icon badges, banners,
medallions. The castles' and halls' blank emblem discs and parchment signs were painted into their art, so they were repainted out
of the existing sprites by **local image processing only** (Python with Pillow, numpy and scipy; no generation, no external
service), by subagents in two competing attempts per sprite (structured period-aligned synthesis vs exemplar inpainting), judged,
then polished:

- `halls.png`: each of the six halls now has an unbroken tiled hip roof: the ridge's capping tiles run straight across between
  its end caps (the disc's place above it transparent, with the outline along the ridge), and the front plane's staggered courses
  and eave lip continue through where the disc and plaque were, rebuilt from the hall's own tiles (re-registered per tile, mirrored
  and varied in tone so they don't read as stamps); the door posts rise into a shaded soffit under the eave. Roof colour bleed on
  the timber under the eaves was repainted from the red hall's wood, and the gold ridge and hip caps are the red hall's gold in
  every hall. The ten `badge-*` frames were cleared and dropped and the sheet cropped to 2784 × 1280; the frame rectangles and
  anchors of the halls are unchanged, and `badgeSlot` / `plaqueRect` were removed from their metadata.
- `host.png`: in `castle-online` and `castle-offline` (still registered) the disc, its gold rim and its stone ring are gone: the
  central tower's shaft continues down into the keep course by course, and the back wall's and the front battlement's merlons run
  across at their own spacing, each castle from its own pixels (the offline one stays unlit). `banner-0..2` and `emblem-blank`
  were cleared and dropped and the sheet cropped to 2368 × 1152.

Every pixel outside each edit mask is unchanged (checked). Natural roof, flag and cone colours are not baked in: the page grades
each sheet as it loads (`SHEET_COLOURS` in `src/overworld/paint.ts`). The scripts, edit and colour-class masks, reviews and the
attempts' judgements are kept privately in ignored `artifacts/overworld/repaint-2026-11-07/`.

## Dungeon Board

The geometry kit is v3, robots are v4, and material/furnishing refinements are v5–v11. Artwork was generated with the built-in
`image_gen` tool on 2026-11-06 and 2026-11-07.
The private `design/references/dungeon-concept.png` was inspected at 3×,
particularly its LOCAL floor, left terrace, workspace recess and central gate.
It is a style/composition reference only: no reference pixels enter the sheets.
Reference crops and comparisons remain ignored and private. No Phaser service
or publishing was used. These are original generated designs under the artwork
terms above.

The eight transparent PNG sheets and JSON maps live in `src/assets/dungeon/`.
All maps declare `scale: 3`. Rectangles, relative anchors and nine-slice insets
are sheet pixels, divided by three for world units. Standing objects use
feet-centre, hanging pieces top-centre, symbols/glows centre and modular
architecture top-left. Animation frames retain one canvas and anchor.
Only animation frame zero supplies `fps`.

| Sheet | Frames | Current contents |
| --- | ---: | --- |
| `robots` | 80 | Smooth glossy shell, ten body colours, idle/work poses and flying drones |
| `alcoves` | 11 | Four sparse interiors, chunky piers, lintel, new ledge and three redrawn candle flames |
| `gate` | 12 | New upper host surround, lower arch, lit/dark portcullis, stairs with side walls, host disc and crown banner |
| `stone` | 50 | Architecture, raised ramparts, broad flagstones, three excavated-rock variants and gold reflection glazes |
| `ui` | 36 | Original UI kit plus blank wooden hanging signs, bracket and inset host-status gems |
| `props` | 57 | Furnishings, fires/magic, candle fixtures, unlit variants and three plain cloth banners |
| `status` | 27 | Existing markers, glows and PR/Probe states, plus violet `mark-asking` / `glow-asking` |
| `projects` | 55 | Shared project hall, end pillars, floor/back wall and eight muted valance/runner families |

There are 328 frames: the 235 earlier frames, ten candle-fixture frames from v6,
two underside corbels from v7, eight tile variants and five reflection glazes
from v8, two excavated-rock alternatives, and eleven world-sign/gem/plain-cloth
pieces, plus 55 project hall/cloth pieces. V9's lighting changes replace artwork in place.
The original required names and optional
`rampart-return-left` / `rampart-return-right` are retained. The two optional
diagonal wall runs let a terrace or alcove show the angled returns in the
reference. None of the required names was removed or renamed. PR/Probe names
continue to follow `prStatus.ts` and `probe.ts`.

The new stone kit comprises `rampart-x` (tile x), `rampart-y` (tile y), four
`rampart-corner-tl|tr|bl|br` pieces, four `rampart-end-left|right|top|bottom`
pieces, `rampart-t-down`, and `terrace-floor` (tile xy).
`alcove-ledge` tiles x, and `gate-surround` contains the upper arch's dark
blank opening for the host icon. Existing `gate-arch` and `gate-medallion`
remain separate usable pieces.

Native concept sizing guides the art: the v3 robot design was approximately
36×42 px. V4 uses approximately 150×175 visible sheet pixels, with the renderer
fitting its trimmed alpha to the display size. A workspace label is 120×35, the host plaque 275×65, and the project medallion
55 px across. The label's nine-slice also produces a 195×38 project label without
stretching its corners. The lower gate arch is 145 px wide and its portcullis
85 px wide. Stair sections include their block side walls: about 120 px overall
with an approximately 80 px walking surface. A rampart run is 22 px tall.
Every piece uses the same scale, top-left light and grey/periwinkle stone palette.

The interiors are deliberately sparse: `alcove-slot-0` is plain dark brick;
1 has a small monitor and desk at one side; 2 has a small shelf; 3 has a crate.
Warm light pools on their floor and front step. Single tall candles stand in
brass holders. Recolours affect robot shells, protecting dark outlines, visors,
white eyes and thrusters. Shell flecks and the contrasting helmet rim are gone.
The upper host icon is drawn into the surround's dark arch opening rather than
onto an ornate coin above it. Name fields and icon centres remain blank.

`prompts.json` retains all exact prompts, generated source filenames and v2 raw
crop rectangles. The first pass used nine generations (including its rejected
ornate robot calibration); v2 used eleven more generations. V2 sources cover the
rampart kit, sparse alcoves, simple UI, smooth robots, upper surround, gate/stairs,
two prop sets, flame variants, supplemental architecture and the asking/wall
addendum. The existing white pictograms and PR/Probe enamel badges are retained
from their original generated sources. Raw outputs are ignored in
`artifacts/dungeon/v2/`; v1 sheets, prompts, script and review images are preserved
privately in `artifacts/dungeon/v1/`.

Assembly and checks are in `scripts/dungeon-art.py` (Python/Pillow, including
LittleCMS via Pillow's ImageCms). The builder was moved out of the tracked
assets folder in v3; its repository-root path is `rendering/scripts/dungeon-art.py`.
Whole connected silhouettes were detected before slicing, including subjects
that crossed the generator's requested cell boundaries. Sources were cropped,
registered and resized; modular rectangular strips use explicit dimensions.
V3 matches cool stone chroma in CIELab, rather than neutralising it. L* is held
fixed while a*/b* statistics are matched per sheet, interpolated across mortar,
brick, mid-face and lit-face luminance strata. Numeric sample regions, source
and target statistics, mapping parameters and round-trip L* errors are recorded
in `prompts.json` under `v3_colour_transfer`. Gold, flame, wood, cyan magic and
near-white highlights are protected. The back wall retains its darker values,
and the outside wall uses a separate much darker irregular stone source. Repeating edges are
cropped and blended over narrow bands to match opposite RGBA texels exactly.
The standard wall was checked in a 6×4 render for an atlas-border stripe/grid;
the dark wall has deliberately irregular courses and lower mean luminance.

Four genuinely different generated flame silhouettes and inner tongues are
registered to one base and composited onto identical holders/fireboxes for the
torch, brazier and forge; the candle uses the first three. These are shape
changes, not brightness-only flame pulses. `torch-out` has the same canvas and
anchor as `torch-0`, with a darkened unlit holder. Gate/crystal light pulses,
tank bubbles and travelling magic-ring light remain registered animations.
The new violet asking bubble carries three cream dots; its glow is a soft
ellipse matching the other state glows.

Source alpha below 12/255 is removed, opacity at or above 240/255 normalised,
zero-alpha RGB cleared, and useful edge alpha retained. At least four transparent
pixels separate packed frames; non-tile frames also have two pixels of interior
padding. PNG optimisation is lossless. The asset folder remains below 12 MB.

The builder writes a complete replacement set to ignored `v3/staging/` and
validates it before replacing live files with atomic renames. It never writes
an in-progress PNG into the path read by the renderer.
Run `python3 rendering/scripts/dungeon-art.py --validate-only` to check
live outputs; rebuilding also requires the ignored raw sources. The checks
cover names, scale, bounds, alpha, gutters, declared tile edges and animation
registration. Reports and 3×3 / wall 6×4 repeats are in ignored
`artifacts/dungeon/`. `--publish` rebuilds, checks and then replaces the live
asset set; `--publish-staged` checks an already complete stage before replacement.

Private review images:

- `artifacts/dungeon/calibration.png`: matching LOCAL-left crops at 3×.
- `artifacts/dungeon/contact-sheet.png`: all 260 labelled frames.
- `artifacts/dungeon/mock.png`: the LOCAL floor reconstructed only from sprites, beside the matching 1199×365 concept crop at 3×.
- `artifacts/dungeon/v3/local-floor.png`: the generated half of that comparison.
- `artifacts/dungeon/tile-wall-brick-6x4.png` and `tile-wall-brick-dark-6x4.png`: wall-repeat proofs.

V3 adds four empty side-room recesses to `stone`: `room-arch`, `room-cave`,
`room-magic` and `room-forge`. Each has 390×600 pixels of artwork (130×200
concept pixels at scale 3), plus transparent frame padding, with a bottom-centre
anchor. Their deep interiors provide space for separately placed props; the cave
has faint violet ambient and the magic recess faint blue ambient. Upper-wall
pieces are `pillar-capital` and `window-arch` in `stone`, and `chain-pair`
in `props`. The paired chains hang from a common top-centre anchor.

V3 used two further built-in generations: the four recesses and the three upper
wall pieces. Exact prompts and source filenames are in `v3_generations` in
`prompts.json`; originals remain private in `artifacts/dungeon/v3/`.
The recolouring updates `stone`, `gate`, `alcoves`, the stone medallion in
`ui`, and stone/steel portions of selected `props`. In v3, robots and status art
retained v2 pixels; the v4 robots below now replace that robot set. V2 sheets, metadata, builder and review images are preserved in
`artifacts/dungeon/v2/`, including `v2/assets/`.

Colour calibration sampled the private concept's stone-only regions, filtering
out warm reflections and saturated props. The measured cool lit faces average
about a*=14, b*=−27; brick about a*=13, b*=−26; mid faces about a*=18, b*=−34.
The transfer preserves alpha, frame geometry and L*. The recorded RGB round-trip
error remains below one L* unit in the sampled pixels. Lab measurements use the
sRGB profile and Pillow/LittleCMS's 8-bit Lab encoding. Comparisons of the gate,
rampart, pier and wall are in `artifacts/dungeon/v3/tone-comparison.png`.
The four recesses with separately composited props and the upper-wall dressing
are shown in `artifacts/dungeon/v3/rooms-mock.png`.

V4 updates only the robot sheet's artwork and frame map, retaining all 80 names
and `scale: 3`. A new built-in generation uses the v3 robots as the design
reference: stronger top/left rim light inside the dark outline, a glossy head
glint, and cyan-white eye bloom contained by the visor. Ten shell palettes are
more vivid; the white shell stays white and the grey shell medium steel-grey.
The connected dark visor, white pupils, eye bloom, cyan lamps/thrusters and dark
outlines are protected while recolouring.

Visible idle bodies are 150×175 pixels (about 1.4× the v3 sampling resolution);
drones are 63×42 pixels. Calm idle breathing changes height by three pixels,
with a blink. Four generated work poses have larger arm gestures and a
21-pixel crouch/rise cycle. Their feet are individually registered to one
common centre and baseline, within one pixel, so their head/body motion remains
intentional. All frames in each animation share a canvas and bottom-centre
ground-contact anchor. Flying drones use the same bottom-centre convention
at their thruster bases.

The exact v4 prompt and source filename are retained in `v4_generations` in
`prompts.json`. V3's `robots.png` and `robots.json` are preserved privately
in `artifacts/dungeon/v3/`. The new raw source is ignored at
`artifacts/dungeon/v4/robots-raw.png`. The updated builder supports
`--robots-only` to stage/check only the robot replacement, and
`--robots-only --publish` to atomically replace its checked PNG/JSON and
provenance. Other live sheets are not rewritten by that path.

`artifacts/dungeon/robots-v4.png` compares every body colour and two drone
colours against v3 at exactly the same displayed alpha bounds on the board's
stone. `artifacts/dungeon/v4/work-poses.png` and `work-animation.gif` show
the registered work cycle. The contact sheet includes all 235 frames with the
new robots. Validation checks the original name set, scale, shared animation
dimensions/anchors, feet positions, visible body resolution, bob amplitude,
alpha cleanliness and gutters before replacement.


V5 addresses the art-owned findings from the compare-6 critique. It preserves
all 235 names and every frame map byte-for-byte, including feet anchors and
nine-slice/tile/animation metadata. Robots and status PNGs remain byte-identical.
Three further built-in generations repaint the sparse monitor/shelf interiors,
pale parchment and gold/navy panels, and four compact yellow-white flames plus
four broad forge coal/fire beds. Exact prompts and original filenames are in
`v5_generations` in `prompts.json`; raw outputs are ignored in `artifacts/dungeon/v5/`.

The stone stays violet in shadow, but its lit bevels receive restrained warmer,
lighter painted material values. Terrace and paving use a stronger warm-grey
profile. The terrace's opaque-pixel mean Lab changes from approximately
(51.1, 12.1, −18.0) to (54.9, 13.5, +0.2); floor-flag from (52.6, 14.2, −13.0)
to (55.7, 15.2, +1.9). Violet mortar, deep recesses and cyan magic are protected.
These are albedo changes, not a claim that the app's spatial lighting is fixed.
The app still needs warm falloff and removal of excessive runtime darkening.
The label/plaque fields target pale cream around L*=91, a*=4, b*=27; the navy
panel regains a bright clipped gold rim. The new desk and shallow shelf remain
off to one side, with open room for the larger robots.

Fire animations have compact ivory/yellow hearts rather than long orange
ribbons. The forge has a multi-tongue coal/fire bed clipped into its firebox.
All holder/firebox geometry and animation anchors are registered; the existing
holder-stability checks still pass. No external glow was added to compete with
agents, and the lit gate texture was not made brighter.

The builder's `--art-only` mode stages this pass and checks it before
`--art-only --publish` atomically replaces changed sheets. It starts from the
preserved pre-v5 albedo in `artifacts/dungeon/v5/before/` so rerunning it does not
stack warming. Current robot/status art is retained. Newer provenance is kept
when older cached stages are used. The full raw-source rebuild includes the
same v5 pass. The folder remains below 12 MB.

`artifacts/dungeon/gaps.md` records ten ranked gaps, native crop coordinates,
art/code ownership and concrete fixes. `gaps.png` pairs the top five baseline
crops from the private concept and compare-6 capture. These remain ignored.
`artifacts/dungeon/v5/art-changes.png` shows before/after sprite evidence, and
`v5/material-metrics.json` records the numeric colour changes. The comparison
capture is not presented as an after-fix app screenshot; code-owned layout,
lighting, tint/compositing and prop placement still require integration.


V6 (2026-11-07) follows the compare-10 critique, recorded privately in
`artifacts/dungeon/gaps-2.md`. Its baseline fidelity score is 7/10; deliberate
agent emphasis/colours, the quieter gate and real fleet data are excluded.
The concept's gold was approximately attributed with a documented HSV/manual
region mask (`v6/gold-attribution.json`): parchment and trim account for about
47% of that mask, reflected stone/wood and alcoves about 33%, while direct
flames/candle fixtures/braziers/forge beds account for about 7.5%. These are
shares of a stricter proxy gold mask, not a reproduction of the user's
board-level 24%/18% classifier. White-hot cores are under-counted. This supports
adding believable sources and reflected pools rather than uniformly yellowing
more wall or brightening the gate.

One additional built-in generation supplies three-candle tabletop brass,
a paired wall sconce, a substantial unlit brazier bowl/pedestal and richer
red/gold rug embroidery. Its exact prompt/source are in `v6_generations` in
`prompts.json`; the raw output is ignored at `artifacts/dungeon/v6/props-raw.png`.
V5's registered fire art is reused for the lit fixtures and a broader brazier
fire bed. The brazier coals are contained in its mouth and the front rim is
painted over them. Existing banner gold is made a little brighter, preserving
cloth colours and glyphs. All existing frame rectangles and anchors remain
identical, including the brazier/rug/banner extents. Robots, gate/stair textures
and all other sheets retain their pixels.

The optional new `props` families are `candelabra-0..3` (three tabletop candles,
feet anchor) and `wall-candles-0..3` (paired wall sconce, top-centre anchor), plus
`candelabra-out` and `wall-candles-out`. Each family's four lit frames and
unlit frame share canvas and anchor; frame zero supplies 7 fps. The renderer
must register those animation bases, place them in room/desk groups and supply
local warm spill; the art addition does not itself change the app layout.
Physical rug/brazier/banners sizes remain the renderer's decision.

The builder's `--props-only` mode stages v6 from its preserved pre-pass props
in `artifacts/dungeon/v6/before/`, validates all sheets and old metadata, and
updates the contact sheet and `v6/props-review.png`. `--props-only --publish`
replaces only changed files with atomic renames. The full raw-source rebuild
includes the same v6 refinement. Original 235 names and all old anchors are
preserved; 245 total frames validate and the asset folder stays below 12 MB.
The critique's paired remaining-gap crops are `artifacts/dungeon/gaps-2.png`;
`v6/candle-poses.png` shows the registered new fire fixtures.


V7 follows the compare-13 review (`artifacts/dungeon/gaps-3.md`), scored 7.5/10
before new art integration. Improved furnishing/candle clusters are recognised;
remaining major issues are exposed wall mass, a platform strip crossing the next
host's arch/icon, and light/geometry continuity. No robot or gate-light changes
are made. Two built-in generations repaint hanging banners and supply actual
underside corbels; exact prompts/source rectangles are in `v7_generations`.

The four ordinary banners retain their names, 160-pixel width and exact
(80,2) mounting anchor, but their canvas becomes 246 pixels tall. This corrects
the squat whole-banner aspect ratio; it is an intentional natural-proportion
change, not merely higher sampling resolution. At a displayed width of 72 board
units, leave roughly 111 units of hanging clearance. Cloth is kept dark enough
to support agent priority. The crown retains its 136-pixel width and exact
(68,2) anchor, grows to 244 pixels tall and has a pointed drape with rich gold
fringe. Its final world footprint/placement still belongs to the renderer.

New `stone` entries `corbel-left` and `corbel-right` are 84×90 pixels of artwork
plus two pixels of padding on each side, top-centre anchored at (44,2). Their
wide upper mounting lip and shaded, stepped/chipped lower mass are designed to
carry a platform edge. The geometry is mirrored as a pair but both retain
upper-left illumination. Place a few substantial supports at actual wall/room
boundaries, not one under every block. Renderer registration and placement are
still required; these frames do not themselves fix the central arch cutout.

Every old frame name and exact pixel anchor is preserved. Apart from the five
intentionally taller/repainted banners, all old frames retain identical pixels
and dimensions, verified by decoding their before/after frame rectangles.
Robots remain byte-identical. All 247 frames pass alpha, gutter, declared tile
edge and animation-registration checks; the folder remains below 12 MB.

Raw outputs and the pre-pass kit are private in `artifacts/dungeon/v7/` and
`v7/before/`. The builder's `--hanging-only` mode stages and validates the pass;
`--hanging-only --publish` replaces its checked sheets atomically. The full
raw-source rebuild includes v7. `v7/art-review.png` compares old/new banners at
one width and shows the two corbels. `v7/join-crops.png` records the code-side
arch obstruction in compare-13. Review captures describe that baseline, not a
new app render after these assets have been integrated.


V8 is the illustration-finish polish: five new built-in generations supply
rough masonry materials, rampart pieces, pillar/return pieces, four empty room
recesses and five painted reflection glazes. Exact prompts, original source
filenames and whole-object crop rectangles are in `v8_generations` in
`prompts.json`. Raw sources remain private in `artifacts/dungeon/v8/`.
No strict-grid 8-bit conversion, synthetic random speckle or vector texture
stand-in is used: the chips, cracks, facets, varied block joints and spill
shapes come from generated raster artwork.

Thirty existing `stone` frames are rebuilt with uneven blocks and rougher
painted edges: wall/dark wall, rampart runs/corners/ends/T/returns, pillar/cap/
base/capital, ledge face/ends, floors, board borders and the four room recesses.
The already rough decorative windows/niche and v7 corbels retain their art.
`alcoves` receives matching rough piers, lintel and front ledge; its furnished
interiors and candle frames retain their pixels. Existing dimensions, exact
anchors, tile axes, names and animation metadata are preserved. Generated
material values/chroma are matched back to the accepted pre-v8 material palette;
contrast is allowed slightly more variation so cracks and chips survive.
The repeating materials were subsequently rebuilt from a sixth built-in
generation of 20 isolated painted stones. Its exact prompt and whole-stone
crop rectangles are recorded under `v8_structural_repair` in `prompts.json`;
the private source is `artifacts/dungeon/v8/seam-fix/units-raw.png`.

New static tile arrangements, in `stone`, are `wall-brick-2`, `wall-brick-3`,
`rampart-x-2`, `rampart-x-3`, `floor-flag-2`, `floor-flag-3`,
`terrace-floor-2`, `terrace-floor-3`. Every member has its base's dimensions,
anchor and tile axes. The initial edge-crossfade approach passed pixel checks
but failed visual review: it introduced soft strips and broken courses. The
current files supersede those earlier 6×4 proofs. Wall variants now share three
course heights (75, 77, 76 sheet pixels), approximately doubling the former
block size. Two variants include an interior stone spanning two courses.
Complete painted bricks straddle horizontal tile boundaries, and full mortar
lines meet at top/bottom. Runs
wrap through complete blocks. There are no blended edge strips or internal
half-patch joins; one cut texel is duplicated for the equal-edge test.

The final floor/rock revision replaces the rejected small basket-weave floor.
Two further built-in generations supply twelve broad paving slabs and twelve
excavated rock masses. Exact prompts and crop maps are `v8_floor_repair` and
`v8_rock_repair` in `prompts.json`; private raw sources and the prior live kit
are under `artifacts/dungeon/v8/floor-fix/`. Floors keep a nominal three broad
stones across the tile width, with irregular interior arrangements that differ
between the three variants. Generated slab silhouettes, grain and edge
highlights are mapped onto the laying polygons; faces and bevels remain painted
raster art. Boundary sites lie on the periodic cuts; interior sites vary freely,
so the shared joints do not impose the same internal motif on every variant.
The stone bodies are retuned toward lavender-grey, retaining warm edge flecks.
Exported floor Lab measurements (including mortar and warm edges) are recorded
in `floor-fix/validation.json`, with b* between −5 and 0 and a* below v5's.

`wall-brick-dark` is now dark, low-contrast excavated rock with fine fissures
and rough facets, rather than masonry. New `wall-brick-dark-2` and
`wall-brick-dark-3` have the same 480×228 size, top-left anchor and `tile: xy`.
Use stable spatial mixing for these too. Quiet centre crops from the generated
rock avoid repeating a conspicuous whole-mass silhouette or large diagonal
gash; the fine painted cracks and rubble texture remain. Existing frame names,
sizes, anchors and metadata are retained.

Individual stone exposure and course means are normalized to the accepted
material palette. A common periodic low-frequency luminance field is
subtracted across each variant family; only colour values change, preserving
painted cracks, chips and local bevels. The texture itself is never blurred.
One-dimensional runs retain their lit top/front-face contrast. Geometry and
lighting are checked separately: shared courses/edge stones, all cross-variant
RGBA joins, random 8×6 mixes (seed `0x5EA8`), native-pixel crops, 50% views and
large-blur views. Proofs are `artifacts/dungeon/v8/mixed-<family>-8x6.png`,
with `-50`, `-blur` and `-blur-50` companions. Layout and measurements are in
`v8/seam-fix/layout.json` and `v8/seam-fix/proof-metrics.json`; the latest wall,
floor and rock layouts and measurements are also in `v8/floor-fix/`. Choose variants
with stable spatial seeds; do not animate or flip them (illumination stays
upper-left).

The five static gold overlays, also in `stone`, are
`light-spill-wall-0`, `light-spill-wall-1`, `light-spill-wall-2`,
`light-spill-floor-0`, `light-spill-floor-1`. Wall variants share a 324×304
canvas/centre anchor; floor variants share 364×204. They have no FPS because
these are static painted alternatives, not animation frames. The generated
source contained neutral backing: warm-pigment chroma matting removes its white
and grey, then gold saturation and low alpha are enforced. No neutral/white
pixels survive with positive alpha. Peak alpha is below 0.46, with softly
transparent irregular edges and small painted gold facets. They are warm
reflection glazes, not hard circular or white bloom sprites. This original V8
extraction is superseded by the V9 replacement glazes described below.

Place one chosen glaze on nearby stone behind fixtures/props/agents, clipping
it to the intended masonry/plane where appropriate. Use restrained opacity with
additive light blending, and keep it off agent/status/label faces. Preserve
the cool mortar and existing agent-first hierarchy; do not stack all variants
at one fixture. `v8/spills-on-stone.png` demonstrates the actual exported alpha
on the rough wall and floor. `v8/masonry-review.png` compares original/revised
pieces at one frame size. `v8/texture-validation.json` records old-interface,
mixed-edge and spill-alpha checks.

The builder's `--rough-only` mode starts from `v8/before/`, stages the complete
replacement, checks it and refreshes the contact sheet. The `--seam-fix` mode
rebuilds the repeating materials against `v8/seam-fix/before/` and stages in
`v8/seam-fix/staging/`; it also refreshes all random 8×6 proofs. Adding
`--publish` installs checked files with atomic renames. `--materials-only`
(also `--floors-only`) stages the final wall, floor and rock revision in
`v8/floor-fix/staging/`; the full rebuild includes it too. There are 262 frames
after this pass, including the two new rock alternatives.
Robots and status PNGs are
byte-preserved, as are the gate, props and UI sheets. The asset folder remains
below 12 MB. Renderer registration/variant selection and light-overlay placement
are deliberately left to code; no app code or commits are changed by this pass.

V9 is a restrained illumination pass following `compare-18`. Its critique and
paired crops are private in `artifacts/dungeon/gaps-4.md` and `gaps-4.png`.
The capture's score is 7.5/10 before the new art or code changes are integrated;
an atlas review is not an after-fix app capture.

One built-in generation supplies replacement shapes for all five named light
glazes. Its exact prompt, source filename and cell crops are recorded under
`v9_light_refinement` in `prompts.json`; the original transparent output is
`artifacts/dungeon/v9/glazes-raw.png`. The generated alpha supplies the smooth
irregular silhouette and short painted chipped highlights. Saturated bright
gold RGB is enforced after resampling (R=255, G=176–220, B=32–68), with no
neutral backing or dark ochre pigment. Alpha is capped at 88/255 on walls and
80/255 on floors; external gutters and low-alpha noise are cleaned as usual.
Canvas sizes, centre anchors and names stay identical. `v9/glazes-review.png`
compares old/new over real stone under normal blending and under the renderer's
actual additive opacity. `v9/glaze-metrics.json` records exported colour/alpha.

Cool masonry mid faces receive a pointwise Lab lift capped at 7 encoded L
steps (2.75 conventional Lab L). It affects the structural stone, four alcove
frame/lintel/ledge pieces and gate/stair masonry. The darkest mortar/outlines,
gold pigment and room interiors remain protected; the broad floor tiles,
excavated rock, portcullis/fire animations, UI, props, robots and status keep
their pixels. A pointwise treatment keeps tile wraps and cross-variant edges
identical. `v9/stone-review.png` compares accepted/revised pieces at the same
dimensions; `v9/changed-frames.json` lists changed frames and affected pixels.

The code's deep-gold multiply pools are a separate concern: `#7a4c00` under
`multiplyX2` darkens every channel. Brighter art cannot make that treatment
illuminate unlit stone. The critique assigns that compositor correction, the
foreground terrace silhouette, room staging and upper-wall rhythm to code.
Do not compensate by whitening floors, brightening the gate or multiplying a
larger brown wash over the board.

`--lighting-only` stages from `v9/before/`, validates the complete sheets,
refreshes the contact sheet and random tile proofs, and writes the art reviews.
`--lighting-only --publish` installs checked files atomically. The full rebuild
also includes V9; historical version-only modes still reconstruct their own
passes. All 262 frame maps, dimensions and anchors are preserved. Only the
stone, alcoves and gate PNGs change; robots/status/props/UI PNGs are byte-identical.
`v9/validation.json` records the preservation checks. No app code or commits
are part of this art pass.

The V9 world-sign extension follows the user's removal of host/project icon
overlays and move from UI-like host plaques to painted hanging wood. It adds
eleven frames without removing or altering earlier frames. Two built-in image
generations supply a blank sign/fittings atlas and an emblem-removal edit of
the three existing cloth banners. Exact prompts, source filenames and whole-
object crop rectangles are under `v9_world_signs` in `prompts.json`; the private
sources and pre-pass kit are in `artifacts/dungeon/v9/signs/`.

New `ui` frames:

- `sign-board`: 829×244 sheet pixels; wood body 825×195 (275×65 concept units)
  plus 45 pixels of chain height and the usual gutters.
- `sign-board-tall`: 829×304; wood body 825×255 (275×85 units), for a host name
  and smaller stats line. Both signs have top-centre anchor `(414.5,2)` and
  `slice: {left:96,right:96,top:87,bottom:42}`. Keep their natural height for
  horizontal stretching. Chains, corner brackets, round rivets and end caps
  remain fixed; only the quiet grain in the long middle stretches. The wood
  body starts at sheet y=47. Suggested inner lettering bounds are x=112..717,
  y=100..196 on the normal board and y=100..256 on the tall board. Inset gems
  can sit to the left of a centred name; don't include chains in text layout.
- `sign-bracket`: 79×64, bottom-centre anchor `(39.5,62)`. One or two copies can
  mount the sign chains on the receiving masonry.
- `gem-online`, `gem-warning`, `gem-offline`: 46×46, centre anchor `(23,23)`;
  the bronze socket/gem body is about 30 pixels (10 concept units) across.
- `gem-online-0`, `gem-online-1`: same canvas and anchor; `fps:1` on phase 0.
  Only the soft outer emission changes, leaving the gem/socket body registered.
  `gem-online` is the phase-0 static appearance. Amber has restrained emission;
  the grey gem has a dark face and no emitted halo.

New `props` frames are `banner-purple-plain`, `banner-navy-plain` and
`banner-blue-plain`. Each has its respective source banner's exact 160×246
canvas and top-centre anchor `(80,2)`, with the same cloth colours, long drape,
rod and gold hem, and no emblem. The edit's whole banners are resampled into
their accepted source silhouettes' bounding rectangles. The old emblem banners
remain available for compatibility; the crown banner and its pixels remain
unchanged. `gate-surround` already has no baked glyph, so it is reused and no
duplicate `gate-surround-plain` frame is added.

Wood and fittings are generated raster illustration, not programmatic vector
stand-ins. The source board is scaled uniformly in width and its quiet vertical
middle is extended to the target face heights, preserving round rivets and the
thin edge. Gem socket dimensions are registered from the bronze rim; only the
generated outer glow is tinted/attenuated to remove neutral fringe and produce
the soft pulse. Sprites stay entirely blank of text. The ignored
`artifacts/dungeon/v9/sign-mock.png` alone paints “LOCAL” and the specified stats
on the tall sign beside a 3× concept crop. `v9/signs/sign-review.png` shows fixed
end caps/chains at widths 660, 829 and 1110, the plain cloth and the gem states.

`--signs-only` stages and checks the extension in `v9/signs/staging/`;
`--signs-only --publish` installs the completed sheets atomically. The full
rebuild includes these frames. `v9/signs/validation.json` records preservation
of all 262 earlier frames, horizontal-slice cap identity, gem registration and
the gate's already-blank recess. Only UI/props PNGs and maps change, all maps
remain scale 3, and the complete tracked asset folder remains below 12 MB.
The contact sheet is refreshed; no app code, commits or reference pixels are
included in the export.

V10 follows `compare-21`; the private review is `artifacts/dungeon/gaps-5.md`
with paired crops in `gaps-5.png`. Its 8/10 score excludes the new removal of
links/nodes, smaller signs and silhouette hover, as well as the earlier
deliberate differences. The source-frame diagnostic in
`v10/grade-diagnostic.json` shows that the then-current RGB loader grade moves
the floor from b*≈−4.0 to ≈−7.6 and L≈58 to ≈78 before scene shade. Warm pixels
skip that exposure branch, favouring the cool material. The review assigns
that temperature/exposure problem to code; no global floor or wall recolour is
baked in to compensate for it.

A built-in edit of an atlas material study supplies the warmer-front/bevel
colour reference. Its exact prompt and source/result filenames are recorded
under `v10_surface_fronts` in `prompts.json`; inputs and output are private in
`v10/warmth-edit.png` and `v10/warmth-study.png`. Production frames keep their
original generated geometry, chips, cracks and alpha. A bounded Lab b-only
refinement warms the low-wall front planes (body contribution up to +4 b*) and
existing painted bevels (up to +10 b* contribution); the hottest existing gold
is protected. There is no target L/a change, new glow field or resampled joint.
Front weighting is perpendicular to each tile's repeat axis, and edge
weighting comes from its existing painted luminance contrast, so cross-variant
wraps are retained.

Only the `rampart-*` / `ledge-*` frames in stone and `alcove-top` /
`alcove-ledge` receive this refinement (20 frames). The remaining source pixels,
including brick walls, floor flags/terraces, excavation, all four already-warm
alcove interiors, gates, signs, gems, plain banners, robots and state sprites
are preserved. `v10/fronts-review.png` compares the original/new fronts;
`v10/tone-metrics.json` records b* movement and conversion round-trip L drift.
The warm appearance still depends on correcting the renderer's separate grade
and letting the front planes remain visible at sufficient world depth.

`--surfaces-only` rebuilds this pass from `v10/before/`, stages in
`v10/staging/`, checks the complete sheets, refreshes the contact sheet and
random 8×6 tile proofs, and writes preservation metrics in `v10/validation.json`.
`--surfaces-only --publish` installs the checked files atomically; the full
raw-source rebuild also includes V10. Only the stone/alcoves PNGs change. All
273 names, frame maps, sizes, anchors and alpha remain unchanged, with no new
frames or renames. No link art, app-code changes or commits are included.

V11 is the small-scale masonry finish for the push from compare-24's 8.5/10
toward 9. The private, ranked art/code brief is `artifacts/dungeon/gaps-6.md`
with paired crops in `gaps-6.png`. It does not award a new scene score from a
source-art pass; architectural composition, joined-plane light/contact and
curated dressing remain code items for the next actual app capture.

One built-in generation supplies six quiet neutral material-detail swatches:
fine painted mineral grain, little nicks, pits and chipped clusters, without
new masonry joints or large crack motifs. The exact prompt, source filename
and grid are in `v11_masonry_wear` in `prompts.json`; the private raw is
`v11/wear-raw.png`. The existing production geometry is retained. A bounded
source window with visible micro-relief is selected, then its low-frequency
field is removed using a periodic large blur. Only sparse high-frequency
luminance detail is transferred into existing opaque cool stone faces. Warm
pigment, mortar and the alpha silhouette stay protected. The texture itself is
not blurred; no procedural noise, edge crossfade or softened boundary strip is
introduced. Repeat families use the same periodic detail field at their
boundaries, with a clean cut texel repeated for the equal-edge check.

The target change is bounded to 15 encoded L steps (about 5.9 conventional
Lab L) at rare stronger chipped points, with most affected pixels much smaller.
Larger faces remain quiet and the original palette/large painted shading stays
intact. Mean L/a/b movement is checked separately, and alpha is byte-compared.
The pass covers 31 existing stone/alcove frame pieces: brick variants,
ramparts/returns/ends, ledges, pillars/capitals/bases, corbels and alcove frames.
Floors, excavated rock, room interiors/recesses, gates, props/cloth, wood signs,
gems, agents and status keep their source pixels. No frame is added or renamed.

`v11/wear-review.png` compares the actual exports; `v11/wear-closeups.png`
uses strict 3× native-pixel crops to show fine detail without smoothing.
`v11/changed-frames.json` records crop selection/affected coverage;
`v11/tone-metrics.json` records actual L/a/b deltas. `--wear-only` rebuilds from
`v11/before/`, stages and checks both complete sheets in `v11/staging/`,
refreshes the contact sheet and random 8×6 proofs, and writes preservation
checks in `v11/validation.json`. `--wear-only --publish` installs checked files
atomically; the full raw-source build includes V11. Only stone/alcoves PNGs
change, all 273 maps/sizes/anchors and alpha remain unchanged, and the tracked
asset folder stays below 12 MB. No app code or commits are part of the pass.

The `projects` sheet is the selected **project hall + project colours** design
from `artifacts/dungeon/project-variants.png`. It groups child alcoves with one
continuous stone chamber and a restrained cloth colour, without bringing back
project names, emblems, host/project icons or graph links. The old sheets and
their frame maps remain untouched. The new map has `image: projects.png`,
`scale:3`, 55 static frames and the same frame/anchor/tile schema as the kit.

Hall frame dimensions/anchors in sheet pixels:

| Frame | Size | Anchor | Repeat |
| --- | --- | --- | --- |
| `hall-pillar-left`, `hall-pillar-right` | 126×408 | (63,408), bottom-centre | — |
| `hall-lintel` | 288×72 | (0,0) | x |
| `hall-lintel-end-left`, `hall-lintel-end-right` | 126×72 | (0,0) | — |
| `hall-floor` | 216×72 | (0,0) | x |
| `hall-back` | 288×192 | (0,0) | xy |

The pillar shaft/base is 136 world units high; its separate cap/lintel adds 24.
Together they give a 160-unit hall around the current 128-unit alcove, with
32 units of headroom. The pillars are 42 units wide, with a narrower visible
shaft and overhanging end cap. In a local coordinate system with hall top y=0,
place cap/lintel at y=0, pillar bodies at y=24 (feet y=160), and child alcoves
at y=32. The shared floor begins around y=154, allowing the existing alcove
front ledges to meet its rear top plane. These are assembly coordinates, not
an app layout change; existing outer child jambs can underlap the larger posts.

For every colour `c` in **teal, plum, wine, moss, ochre-brown, slate, rust,
indigo**, the cloth frames are:

| Frame pattern | Size | Anchor | Repeat |
| --- | --- | --- | --- |
| `valance-<c>` | 144×60 | (0,0) | x |
| `valance-<c>-end-left`, `valance-<c>-end-right` | 60×60 | (30,0), top-centre | — |
| `runner-<c>` | 144×36 | (0,0) | x |
| `runner-<c>-end-left`, `runner-<c>-end-right` | 42×36 | (0,0) | — |

The valance has a sewn gold-thread top hem and lower stitch, no metal pole or
finials. Fixed gathered ties terminate it. The runner has a quiet woven middle,
slightly worn border and fringed ends. All colour variants use exactly the same
silhouettes and registration; only cloth pigment changes, preserving gold
thread. They are dark, muted material identifiers, not semantic state colours:
measured mean body HSV values are about 0.35–0.43, with 95th-percentile values
below 0.58. Use normal alpha blending, no emission/halo, and do not derive their
colour from an agent state or apply the old purple grade to the cloth.

**Capped-repeat assembly:** first subtract the fixed end boxes, choose the
nearest whole number of natural repeat modules, and fit those modules to the
remaining width. This applies to the lintel and cloth strips. In particular,
do not clip a scallop at an arbitrary trough and attach a fixed tie: its end
phase must meet the tie. End caps keep their natural dimensions; middle-module
widths may vary slightly. Shared cut-column RGBA profiles match exactly, and
the builder checks every width remainder of the 288-pixel lintel and both
144-pixel cloth repeats, plus full halls of 1 through 8 alcoves. The floor may
repeat/clip behind the end posts; its top and front are one registered surface.

The hall uses the original built-in generated A kit from the review, sliced
and colour-matched to the accepted stone. A fresh built-in edit supplies the
canonical cloth master with a sewn top hem. Exact prompts, crop rectangles,
palette targets, derived-source references and exported frames are under
`projects_hall_colours` in `prompts.json`. Hall-floor combines the already
generated periodic paving/front face, and hall-back derives from the periodic
brick surface with a darker value. Toroidal resampling preserves their course
structure; no blurred edge strips are used.

`artifacts/dungeon/projects-production/build.py` reconstructs and validates
only this new sheet; `--publish` installs its complete PNG/map and prompt record
atomically and refreshes the contact sheet. The existing kit builder is not
overwritten. Raw/canonical cloth, hall-source records, repeat proofs and the
1–8 assembly views stay in that ignored directory. `projects-proof.png` shows
two neighbouring 2/4-alcove halls and all eight colours at 2×, using only the
new frames and existing alcove pieces. Its deliberately empty bays isolate
construction/colour joins; agent art is unchanged. `validation.json` records
alpha/gutter checks, exact tile/cap profiles, colour registration/darkness and
the variable-span checks. The new PNG is about 0.66 MB; older PNG/JSON sheets
are byte-preserved. No app code or commits are part of this production pass.

Remaining differences: the concept's masonry has more bespoke pixel-like chips,
uneven joints and integrated painted shadows. V3 is smoother, its joins and
courses more systematic, and some camera angles vary slightly between modular
parts. Its warm pools are composited sprite glows rather than lighting painted
continuously across the whole scene. The mock deliberately omits text and
connector lines, which belong to the renderer.

### Dungeon Board vault and At a Glance panel (reused art, 2026-11-08)

No new art was generated. The vault over the first gate reuses the dungeon's
own `stone.png` `niche-arch` as each group's stone niche and the
`assets/dungeon/tiles.png` stained-glass panes (`tile-merged`, `tile-review`,
`tile-draft`, `tile-failing`; see "Source: stained-glass status fixtures"),
inset in the niche's opening (`VAULT_GLASS` in `dungeon/layout.ts`). The panes
are graded at load in the dungeon bridge (saturation 0.82, darks a quarter of
the way toward the board's purple), so the robots stay the board's brightest
colour. The At a Glance panel is painted by the page on the dungeon's `ui.png`
`panel` (its HUD's navy and gold) with its `icon-chart`, and uses the
`assets/dungeon/hud.png` section icons (`icon-pr`, `icon-issue`,
`icon-workspaces`, `icon-agents`). Both sheets came from the removed Village
kit and were moved into `assets/dungeon/` unchanged.

### Dungeon Board vault issue panes (derived art, 2026-11-08)

`assets/dungeon/vault.png|json` (`issue-done`, `issue-progress`, `issue-todo`,
`issue-blocked`) are derived by `rendering/scripts/vault-issue-panes.py` from
the `tiles.png` panes of the same colours; no new art was generated
and no image generator was used. For each, the pane's opening is glazed again
with new seeded cells whose glass is copied from the pane's own clean glass
(its ivory icon and leading first painted over by the glass round them), each
cell a little lighter or darker, leaded in the pane's warm brown. A
circle-based status icon in the manner of Linear's is then leaded in, its
ivory sampled from the old icon's paint with a soft upper-left bevel: Done a
ring round a check, In Progress a ring half filled, Todo an empty ring,
Blocked a ring struck through. The copper frame and alpha are the source
pane's. Deterministic: run the script from the repository root to rebuild them.


## Dungeon Board stained glass and HUD icons (from the removed Village kit)

The Village map was removed at the user's request (2026-11-09), with its sheets
(buildings, banner, cottages, district, fountain, ground, ground-warm, robots and
scenery). Two of its sheets live on in `src/assets/dungeon/`, moved there
unchanged: `tiles.png|json` (the vault's stained-glass PR panes, and the source
`scripts/vault-issue-panes.py` glazes the issue panes from) and `hud.png|json`
(the At a Glance panel's `icon-pr`, `icon-issue`, `icon-workspaces` and
`icon-agents`). Both are original artwork made with the built-in `image_gen`
tool; the user's private `design/references/village-concept.png` was inspected
as a visual reference only, and no pixels from it were copied. The private
builder, raw outputs and intermediates remain in ignored `artifacts/village/`.
Their provenance follows.

### Source: stained-glass status fixtures (`tiles.png`)

One further built-in `image_gen` call replaces the five glossy app-style state
tiles with physical stained-glass windows, painted emblems and carved stone
surrounds that belong to the village facade. The user supplied app crops were
inspected as problem evidence. A private mock compares the old/new fixtures on
the same hall beside the concept's building materials. No pixels from the
concept or app screenshots were copied into any final sprite.

`tile-merged` is emerald/moss glass with a cream painted check; `tile-review`
azure/cobalt with a three-junction branching path; `tile-draft` amber with scroll
and quill; `tile-failing` ruby with a triangular warning; `tile-none` cool slate
with stacked timber storage compartments. Glass is mottled and softly lit from
within, without glossy specular blobs. Warm ivory emblems and dark lead/oak
seams replace flat white vector glyphs. Chipped limestone and timber corbels
have warm upper-left illumination matching the halls.

The five glass-only faces are inset into their original 132x132 canvases, at
11/20 with 110x100 content. Their shallow arch mask fits the repainted
`tile-frame`, whose 150x164 canvas contains the masonry surround, carved sill
and corbels, with no empty name/count slot. All six prior JSON frame records
remain identical, including anchors and atlas positions; the atlas remains
438x464. An optional `tile-sill` is 150x40 at x168/y294 with anchor ax0.5/ay0.925,
cut from the surround's lower section. It is already integrated into the full
surround. The renderer's separate empty plate-strip decoration is independent
of the artwork and must be removed/replaced during integration; live status
colour dots remain code-owned.

The seven-frame sheet is libimagequant-indexed, 256 colours with dithering off,
and optimised with Pillow: 55,523 bytes versus 136,201 previously. The whole
nine-sheet kit is now 8,500,099 bytes. Other sheets were untouched. Alpha,
nonempty bounds and exact preservation of the six existing frame records were
checked. The art mock checks all states at 86px and 43px surround widths and
compares their material language against both the hall and concept.

The private recipe is `artifacts/village/build-tiles-v6.py`; source outputs,
`prompts-v6.json`, the before snapshot and visual/validation artifacts are
retained in `artifacts/village/raw/` and `artifacts/village/tiles-v6/`. The mock
is `tiles-v6/mock.png`. The concept occurs only in that private review image,
never in the final tiles.

### Source: tiles_v6

Original output: `exec-150e0d20-af68-4c4c-b031-d3645a2a8957.png`.

Exact prompt:

> Use case: stylized-concept. Production transparent GAME ARCHITECTURE SPRITE SHEET, exact 3 columns x 2 rows with wide empty transparent gutters. Five small STAINED-GLASS STATUS WINDOWS and one matching EMPTY ARCH SURROUND, part of a hand-painted fantasy village stone hall. Camera near-front facade seen from 3/4 top-down, tiny visible upper surfaces and a shallow raised sill, golden afternoon light upper left. Painterly PIXEL-ART miniature material detail, warm grey/tan chipped limestone, dark worn oak, restrained aged bronze lead came. The windows are physical matte translucent stained glass lit softly from within, with uneven panes and painted emblems; NEVER glossy app buttons, shiny enamel, flat vector icons, gold icon frames or HUD panels. Each coloured glass face has a nearly square silhouette with a shallow rounded/arched upper edge, about132x132 at sprite sampling, a VERY THIN dark oak lip only. Large central emblem fills about55% of face and reads at 40px. Lead joints form only a few broad asymmetrical surrounding panes, no busy radial starburst behind emblem. Emblems are warm ivory/cream painted into glass, uneven painted edges with thin dark shadow/lead seam, never flat white cutout glyphs. TOP LEFT: deep moss/emerald GREEN stained glass, large clear painted CHECK emblem. TOP MIDDLE: cobalt/azure BLUE stained glass, large painted BRANCHING PATH emblem with 3 round junctions (pull request shape), simple and readable. TOP RIGHT: honey/AMBER stained glass, painted small rolled PARCHMENT SCROLL with a broad diagonal QUILL, simple bold silhouette. BOTTOM LEFT: deep warm ruby RED stained glass, large triangular warning emblem and exclamation, cream in dark outline. BOTTOM MIDDLE: cool desaturated SLATE BLUE smoked glass, three stacked old wooden STORAGE CRATE/rack compartments as painted emblem, with simple pale horizontal slats and tiny pale cyan inset rivets, fantasy storage/server state, no modern white server icon. BOTTOM RIGHT: matching EMPTY surrounding stone ARCH AND INTEGRATED SILL only, same family as the windows, footprint150 wide x164 high. Dark rough empty opening fills upper square area (a window face will overlay it), shallow rounded arch above, rough warm limestone blocks and a worn dark-oak inner lip. Below the opening, immediately attached, one broad carved STONE SILL with two little timber corbels, shallow worn carved edge and a few subtle moss flecks; no empty name/count plaque, no dark label slot, no riveted plate. The surround must look built into a village facade, understated rather than ornate. All six objects fully visible in own cell with same scale/camera/light. No text, letters, counts, labels, robots, buildings beyond these fixtures, backgrounds, checkerboard or ground patches. Genuinely transparent exterior. Output1536x1024.

### Source: details_v2 (`hud.png` icons)

Original output: `exec-b022c1df-6f8a-41a1-b958-004ccf1e68c9.png`.

Exact prompt:

> Use case: stylized-concept. Transparent GAME PROP SPRITE SHEET exact 4 columns by 3 rows, twelve separate props with generous transparent gutters. Warm detailed painterly pixel-art fantasy village, 3/4 top-down front facing camera, golden afternoon upper-left light, dark sepia contours, amber warm limestone, glossy brass, blue enamel. Row1 left to right: tiny flying COBALT BLUE ROUND DRONE with navy visor, two brilliant cyan eyes, gold antenna and twin side bronze rotors, white cyan downward thruster, no feet; warm stone FOUNDATION STEP PLATFORM, broad horizontal 260px wide three shallow chipped limestone steps with small ivy tufts at either end, no building on it; single WALL LANTERN, little glowing amber glass hanging in elaborate brass bracket, no wall behind it; broad WOODEN FLOWER WINDOW BOX, lush green leaves trailing ivy and small pink white yellow flowers, empty dark wall behind it. Row2: long hanging IVY VINE clump with warm green and olive leaves; several loose yellow-green GRASS TUFTS together as one fringe object; single small wooden CRATE; two weathered wooden CRATES together with a small burlap sack. Row3: SMALL WHITE HUD ICON of stacked diamonds (workspace layers) with no tile behind it; SMALL WHITE HUD ICON of a round cute robot head with two eye holes and antenna, no tile; SMALL WHITE HUD ICON of a branching pull request, no tile; SMALL WHITE HUD ICON of a circle with small dot in centre (issue), no tile. Icons must be bold clear ivory pictograms, detailed painted props otherwise. All fields free of any words or counts. Actual transparent exterior, no white backdrop, no checkerboard. No extra objects, no terrain ground patches.
