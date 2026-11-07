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
| `halls.png` | 2784 × 1856 | 16 |
| `host.png` | 2368 × 1664 | 6 |
| `props.png` | 3072 × 2560 | 27 |
| `robots.png` | 2048 × 768 | 24 |
| `stalls.png` | 1536 × 1984 | 17 |
| `status.png` | 896 × 896 | 13 |
| `terrain.png` | 4096 × 2432 | 72 |
| `theme-farm.png` | 4096 × 1696 | 23 |
| `theme-forest.png` | 4096 × 1440 | 24 |
| `theme-volcanic.png` | 4096 × 2464 | 30 |
| `ui-world.png` | 2048 × 768 | 9 |
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

The booth is an open wooden frame with short sloping timber end caps, a plain sign-support header, dark warm-brown plank interior, pale front floor and a low mossy stone base. It has no full-width cloth roof. A separate small striped canopy attaches behind **one** outer corner; side clusters supply wooden crates, barrels and a warm lit lantern or brazier on a stump. The name sign is assembled separately from `ui-world.png`'s blank label parts. Robots and nameplates are not baked into booth sprites.

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

## Dungeon Board

The geometry kit is v3, robots are v4, and material/furnishing refinements are v5–v7. Artwork was generated with the built-in
`image_gen` tool on 2026-11-06.
The private `design/references/dungeon-concept.png` was inspected at 3×,
particularly its LOCAL floor, left terrace, workspace recess and central gate.
It is a style/composition reference only: no reference pixels enter the sheets.
Reference crops and comparisons remain ignored and private. No Phaser service
or publishing was used. These are original generated designs under the artwork
terms above.

The seven transparent PNG sheets and JSON maps live in `src/assets/dungeon/`.
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
| `stone` | 35 | Existing architecture plus the full raised rampart kit, terrace floor and two diagonal returns |
| `ui` | 28 | Simple clipped parchment, thin bronze borders, dark discs in pale octagonal mounts, pictograms/counts/dots |
| `props` | 54 | Furnishings, animated fires/magic, candelabra and wall-candle families, unlit variants |
| `status` | 27 | Existing markers, glows and PR/Probe states, plus violet `mark-asking` / `glow-asking` |

There are 247 frames: the 235 earlier frames, ten candle-fixture frames from v6,
and two underside corbels from v7. The original required names and optional
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
- `artifacts/dungeon/contact-sheet.png`: all 247 labelled frames.
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

Remaining differences: the concept's masonry has more bespoke pixel-like chips,
uneven joints and integrated painted shadows. V3 is smoother, its joins and
courses more systematic, and some camera angles vary slightly between modular
parts. Its warm pools are composited sprite glows rather than lighting painted
continuously across the whole scene. The mock deliberately omits text and
connector lines, which belong to the renderer.


## Village — modular painterly village kit (2026-11-06)

The Village kit is original generated artwork made with the built-in `image_gen`
tool in nineteen calls. The user's private `design/references/village-concept.png`
was inspected as a visual reference for the warm painterly pixel-art village,
three-quarter overhead perspective, golden upper-left light, roofs, crystal,
round robots and materials. No pixels from that image were copied into any
sprite, texture, mask or final sheet. It is neither redistributed nor used as a
background. No external game service was used.

Finals are `src/assets/village/<sheet>.png` and matching `.json`, with `scale: 3`:
`buildings` (11 frames), `banner` (13), `tiles` (6), `robots` (73), `fountain` (7),
`ground` (18), `scenery` (50) and `hud` (8): 186 original frames. The supplemental
`ground-warm` sheet below adds thirteen; the stained-glass revision adds a
separate sill; `cottages` and `district` add twenty, for 220 total. All 151 originally
requested names remain present. The thirty-four additional frames beyond the
first complete 152-frame pass are documented in `src/assets/village/STATUS.md`.

The first pass used six generated sheets. The second used four generations:
stronger cobalt robot animation (editing the first generated robot sheet), rocky
river/cliff/moat pieces, distinct forest/blossom trees, and supplemental drones,
steps, lanterns, flower boxes, ivy, crates and white HUD pictograms. The last two
calls replaced the fountain with a low basin and dominant tall crystal cluster,
then corrected the grey offline version to have still water and no jets. The
last edit used the newly generated fountain as its target; the final online and
offline sprites both come from that corrected output. Tool requests asked for
real transparent alpha, except the intentionally opaque terrain sheet.

The private builder, raw outputs, exact prompts and intermediates live in ignored
`artifacts/village/`. Run its `build.py` with its local Python environment to
rebuild; rebuilding needs those private raw sources. `--validate-only` validates
the public final sheets without opening the concept. The builder only opens
generated source art. It trims and registers connected silhouettes, removes
alpha below 16/255, normalises alpha at or above 240/255, clears hidden RGB at
zero alpha, resizes, recolours selected enamel/roof materials, assembles modular
building details and packs transparent gutters. It stages and validates complete
sheets before replacing each live file with an atomic rename.

Buildings have four dark empty arched bays and include warm lanterns, flower
boxes and shallow foundation steps. The two added hall colours recolour only
the generated blue roof. Text, project icons, names, labels and counts remain
renderer-owned; banners, plaques and count plates are blank. Fixed status tile
icons and ivory HUD pictograms are generated artwork. Plaques/porches include
separate cap/middle pieces and full-frame slice insets. The HUD panel and status
pill also declare slice insets, measured in sheet pixels, to preserve corners.

Robots are roughly 58 concept pixels tall, with eight shell palettes and four
idle/four wrench-work poses per palette. Recolouring changes blue enamel only:
bronze, dark outlines, white speculars, cyan eyes and glowing cyan antenna tips
are protected. White enamel is kept white. The eight poses have one canvas and
anchor; feet are registered individually, so wrench silhouettes cannot move the
body sideways. Eight separately generated rotor/thruster drones share their
colours. White floor/crystal glows and four registered ripple overlays are
simple neutral alpha primitives made during assembly for runtime tinting.

Grass, cobble and path occupy 256x256 concept pixels at scale 3. Their opposite
RGBA edges match exactly. Terrain source tiles repeat twice within each final
tile to keep blades and cobbles at village scale; grass is slightly muted.
Organic paving transition sprites and a white alpha mask are cut from the
generated paving with deterministic soft irregular edges. No reference pixels
are involved. The banked river, separate banks and lily-pad moat are registered
repeat pieces; repeating joins blend in premultiplied colour, with matching
opposite edge texels. Four waterfall frames move water/foam colour detail while
keeping the stone cliff and alpha silhouette fixed.

Validation checks all required names, scale, PNG mode, bounds, nonempty alpha,
zero-alpha RGB, non-overlapping packed frames, declared repeat edges, and shared
robot animation canvases/anchors. The private `validation.json` records sizes
and counts. `contact-sheet.png` shows every frame. `mock.png` assembles only
Village sprites in the concept's general arrangement with blank text/icon
fields. Private `comparison.png` places it beside the concept for visual review;
that comparison is never a final asset. The modular kit retains some differences
from the single painted concept: repeated architecture and paving, simpler
shared lighting, and less bespoke interlocking foliage and shadows.

Exact prompts and source output filenames follow. Source filenames identify
provenance; no downloads or restoration from external services are required.

### Village source: buildings

Original output: `exec-7af8740d-fa76-49b1-a8e2-fb0eb98740c3.png`.

Exact prompt:

> Use case: stylized-concept. Production GAME SPRITE SHEET on genuine TRANSPARENT alpha, 3072x2048 landscape. EXACT 2 columns x 2 rows; four separate fully visible fantasy village project buildings, generous transparent gutters. Warm richly detailed painterly pixel-art RPG village, 3/4 top-down orthographic viewpoint looking south at front facades, roof ridge horizontal. Warm golden afternoon from upper left, crisp dark-brown contours, exquisite small slate shingles and chipped limestone blocks, gold details, amber-lit windows, lush moss and little ivy. Each building a squat broad 260x220 concept-pixel silhouette, NOT tall or isometric diamond. Each has EXACTLY FOUR equally spaced dark empty arched bays along the lower front facade, facing camera directly, reserved for later status tile overlays. Small amber arched windows ABOVE the four bays, roof above those. Entire facade and complete roof visible. Upper left: guild hall with BLUE slate hipped/gabled roof, two short corner chimneys, carved warm stone and timber. Upper right: guild hall with PURPLE slate hipped/gabled roof and two corner chimneys. Lower left: round observatory building with broad ribbed TEAL turquoise dome and gold ribs/cupola, rectangular stone facade below dome with four bays. Lower right: rustic mechanic workshop with RUST orange tile roof, side chimney and small brass gear decoration, four bays at front. Match cozy detailed fantasy management game art, rich golden edges and deep dark eaves. Buildings only, NO floor plinth extending far out, NO ground patches, NO trees, NO robots, NO banners, NO plaques, NO signs, NO lettering, NO icons, NO painted status tiles. Each sprite must be separate and not overlap any other cell. Actual transparent exterior, no checkerboard, no background, no white matte. The four arched lower recesses MUST be dark empty openings with stone edging, no doors.

### Village source: robots

Original output: `exec-22d93cd9-864e-4959-ba4e-904908c8e379.png`.

Exact prompt:

> Use case: stylized-concept. Transparent GAME ANIMATION SPRITE SHEET, EXACT 4 columns x 2 rows, generous transparent gutters, eight separate poses of the SAME cute round WHITE enamel robot. Fantasy village painterly pixel-art, crisp dark brown outlines, warm golden afternoon highlights from upper left. 3/4 top-down camera facing round robot, chibi proportions like a tiny round metal mascot, large spherical glossy head almost entire body, midnight navy curved glass visor near bottom of sphere with two luminous CYAN oval eyes, short gold antenna with tiny metal ball, tiny bronze round hands and two little boot feet. White enamel glossy dome and brass rim, visibly rounded but handmade rich pixel illustration, NOT vector and NOT plastic 3D. Top row four IDLE breathing poses: neutral, slightly raised body, neutral, blink eyes; all feet at same baseline. Bottom row four WORK poses: holding a small spanner in right hand at waist, raising it halfway, lifting the little spanner, leaning to work; same body same face same camera. Each bot fully within its cell occupies 65% of height, all at same scale. No floor disc, no platforms, no glow rings, no ground, no scenery, no text or symbols. TRUE transparent alpha, never checkerboard or colored backdrop. Output 1536x1024.

### Village source: fountain

Original output: `exec-aba38418-7734-48c6-9cbc-783663ceec6c.png`.

Exact prompt:

> Use case: stylized-concept. Transparent game sprite kit EXACT 3 columns x 2 rows with wide gutters. Warm detailed painterly pixel-art fantasy village, golden afternoon light upper left, 3/4 top down looking south, crisp dark-brown outlines and rich material detail. Six isolated objects, no ground patches. Top left: blue glowing CRYSTAL FOUNTAIN, central tall faceted azure crystal and 4 smaller crystals spraying little rivulets into a round stone basin, bronze/gold trim and azure water, round wide stepped limestone foundation, 180 concept px wide. Top middle: SAME fountain offline with grey dim crystals and STILL dark grey-blue water, exact same proportions. Top right: single isolated stone BAY ARCH module, broad dark empty arched recess in chipped warm limestone, small amber lamp at top, flat front at same perspective as village building, no doors no tile, 58px wide. Bottom left: long horizontal STONE PORCH, shallow perspective stone slab with a deep visible stone front step, chipped warm limestone and cobble surface, 280px wide 40px tall, perfectly straight horizontal joins, no objects. Bottom middle: round COBBLESTONE PLAZA, wide ellipse of concentric cobbles with radial fan pattern in warm beige, mossy cracks and golden outer curb, flat 3/4 top-down 420px wide, no buildings no fountain. Bottom right: small round POND clear blue water with lily pads and irregular low stone edge, same camera. No words, no icons, actual transparent background no checkerboard.

### Village source: decor

Original output: `exec-83c79cdc-f4f5-4c66-87ea-d689cd0ec68e.png`.

Exact prompt:

> Use case: stylized-concept. Production transparent GAME PROP SPRITE SHEET, EXACT 5 columns by 4 rows, 20 isolated objects. Warm richly detailed painterly pixel-art fantasy village, golden afternoon upper-left sunlight, dark brown fine outlines, 3/4 top-down south-facing consistent camera; rich mossy greens, amber limestone, brass and purple accents. Wide transparent gutter around every separate prop, full silhouettes, no touching. Row1 left to right: lush round oak tree with visible brown trunk; lush round yellow-green maple tree; smaller dense leafy dark green tree; pink blossom tree with rich clustered magenta and pale-pink flowers; a second pink cherry blossom tree. Row2: round dense green bush; little cluster of purple blue and white garden flowers; little cluster of warm yellow daisies; stack of three weathered wooden crates; single wooden barrel with iron hoops. Row3: warm glowing brass fantasy lamp post on stone base; SAME lamp unlit; small cream and burgundy canvas market tent with wooden stall and a few crates; horizontal crenellated warm limestone wall segment with ivy, straight ends for repeating; squat square crenellated limestone wall tower. Row4: upright purple hanging pennant on gold pole, blank cloth; tumbling waterfall over two dark mossy rocks with BLUE water and white foam; short wooden footbridge facing vertical with horizontal planks, limestone square anchor posts and timber handrails; cluster of 3 grey mossy boulders; shallow round low flower bed with pink and purple blossoms. No text, no logos, no people, no robots, no terrain rectangular backgrounds, transparent alpha, no checkerboard. 2048x1536.

### Village source: ui

Original output: `exec-968d2f0a-0e51-481a-8f09-2baa34f6717f.png`.

Exact prompt:

> Use case: stylized-concept. Transparent GAME UI SPRITE SHEET, EXACT 4 columns x 3 rows, twelve isolated sprite pieces, wide transparent gutters. Warm painterly pixel-art fantasy village interface, precise dark ink contour, amber brass and gold chipped edging, antique materials, lighting top left. Row1 left to right: blank DARK NAVY square hanging cloth banner, broad gold top pole with rounded finials and small bottom tassels, empty centre reserved for later icon; blank horizontal cream PARCHMENT NAME PLAQUE with curled end rolls and narrow ornate bronze frame, empty cream centre; broad vertical dark charcoal WOOD HUD PANEL with rich gold corner pieces and restrained thin gold border, large absolutely empty flat dark centre; long small dark charcoal status PILL with narrow bronze frame and rounded ends, empty centre. Row2 left to right: square glossy GREEN status tile with clear white CHECK icon; square glossy BLUE status tile with clear white branching pull request icon; square glossy golden YELLOW status tile with white document icon; square glossy RED status tile with white triangular warning exclamation icon. Row3 left to right: square glossy SLATE BLUE neutral status tile with white stack of three server racks icon; dark wood square tile FRAME with gold corner pieces, EMPTY centre and small empty dark count PLATE immediately beneath it; narrow horizontal brass divider flourish; soft round WHITE magical floor-light disc on transparent alpha seen from 3/4 overhead (flat elliptical glow) for robot feet. The status tiles have glossy enamel faces and small bevels; NO tile count, no numbers, no text anywhere. Sprite pieces only no layout, no panel contents, true transparent exterior, no checkerboard. Output 2048x1536.

### Village source: ground

Original output: `exec-12c6d673-3326-44ee-bf14-b74ccb552a65.png`.

Exact prompt:

> Use case: stylized-concept. Production TERRAIN TEXTURE ATLAS exact 2 columns x 2 rows, four square texture tiles with NO GUTTERS. Warm painterly pixel-art fantasy village 3/4 top down overhead ground, crisp miniature detail, golden afternoon light, art matching amber limestone fantasy village. Top left: richly detailed soft mossy olive GREEN GRASS, small varied grass blades and dark moss, no bushes or objects, no bare large patches. Top right: irregular closely fitted warm beige COBBLESTONE PLAZA paving, varied small rounded worn cobbles with dark mossy joints, frequent tiny chips, evenly distributed detail. Bottom left: warm worn PATH STONES in a compact uniform earthy stone paving texture, small honey beige irregular slabs with dark joints and slight moss, no edges or borders. Bottom right: clear luminous BLUE RIVER water, turquoise and cerulean ripples, a few small white foam streaks, no banks no fish no plants. Each square tile must be SEAMLESS and equal size, completely opaque material, no border between tiles, no vignette, no directionality gradient, NO perspective vanishing point, no props, no letters. Output 2048x2048.

### Village source: robots_v2

Original output: `exec-62d57a22-5200-449f-80ca-4c23b611ba6a.png`.

Exact prompt:

> Use case: precise-object-edit. Edit this transparent robot animation sprite sheet. Keep the SAME 4 column by 2 row layout, EXACT same eight poses, rounded chibi robot anatomy, short boots and hands, proportions, fantasy village pixel-art material, perspective and generous transparent gutters. Change ONLY the enamel shell and light rendering: shell must be vivid saturated COBALT BLUE instead of white/cream, with bright glossy reflected rim highlights INSIDE crisp dark brown outlines, richly shaded blue undersides, a small clean white specular glint on upper left. Bright CYAN luminous visor eyes with a cyan-white core and subtle bloom contained within navy visor. Antenna ball glows brilliant cyan. Keep warm brass/bronze trim and boots, navy visor and silver wrench. Eight poses are upper row idle/breathe/blink and lower row work wrench cycle. The robots must look richly painted, compact and round rather than pale or washed out. Actual transparent background, no matte, no checkerboard, no glow disc below feet. Every robot intact inside own cell, no added props or words. Keep feet consistently at same baseline. Output 1536x1024.

### Village source: river_v2

Original output: `exec-e1e4a9a3-c46c-49c2-9c35-2d2a8b3935d8.png`.

Exact prompt:

> Use case: stylized-concept. Transparent fantasy village GAME ENVIRONMENT KIT. Exact 3 columns x 2 rows with wide transparent gutters, all six objects separate. Warm richly detailed painterly PIXEL ART, crisp dark brown outlines, 3/4 top-down viewpoint, golden afternoon upper-left light. Top left: wide VERTICAL RIVER SEGMENT 150x240 concept pixels, blue turquoise water with depth shading darker in centre, irregular mossy grey/beige rocky banks on both sides, lush grasses, reeds, flowers and little stones, a few white foam curls and ripples; top and bottom open straight for seamless vertical continuation. Top middle: DRAMATIC WATERFALL CLIFF, a tall wall of rugged stacked stone and moss with turquoise river pouring over its top and cascading down in a wide white foaming sheet into a blue pool below, boulders and lush greenery at both sides, no bridge. Top right: wide HORIZONTAL MOAT POND, curving blue water framed by mossy stone banks, grass, a few pale lily pads and pink water lilies, open left/right for a moat. Bottom left: separate LEFT riverbank segment, irregular rugged mossy stone and grass shore with translucent shallow cyan water at its right edge, vertical tile open top/bottom. Bottom middle: separate RIGHT riverbank segment, irregular rugged mossy stone and grass shore with translucent shallow cyan water at its left edge, vertical tile open top/bottom. Bottom right: curving RIVER BEND turning from north to east, turquoise water and rocky grassy banks matching the river segment. True transparent exterior, no terrain rectangle beyond these objects, no sky, no buildings, no robots, no words, no decorative frames. Strong cosy RPG atmosphere, dense beautiful hand-painted pixel details.

### Village source: foliage_v2

Original output: `exec-55c333c9-1fa6-4977-9d66-2b5532e6c175.png`.

Exact prompt:

> Use case: stylized-concept. Production transparent GAME TREE SPRITE SHEET, exact 3 columns x 2 rows, SIX DIFFERENT intact lush fantasy village trees, wide transparent gutters with no touching. Rich painterly pixel-art as in a warm detailed RPG village, 3/4 top-down facing south, upper-left golden afternoon sunlight, crisp dark brown contours, detailed clustered leaves, visible brown trunks and spreading roots, NO ground base. Top left: wide old DARK EMERALD oak with asymmetric round dense canopy and thick crooked trunk. Top middle: YELLOW GREEN lime tree with dense soft rounded leaf clusters and forked trunk. Top right: tall medium forest-green elm with irregular pointed oval canopy, exposed branching trunk. Bottom left: broad dark OLIVE green mature oak with crown leaning left, thick rooted trunk and a few warm gold leaves. Bottom middle: rich bright PINK blossom tree with round densely packed flowering crown and dark twisting trunk. Bottom right: pale shell PINK cherry blossom tree with airy clustered petals, warm brown branched trunk. Trees occupy 80% of each cell, ALL foliage/trunk/roots completely visible within cell, no cropped leaf edges. Colors rich and varied rather than neon, under-canopy shadows deep olive. Actual transparent exterior, no checkerboard, no background, no grass islands, no labels or text. Output 1536x1024.

### Village source: details_v2

Original output: `exec-b022c1df-6f8a-41a1-b958-004ccf1e68c9.png`.

Exact prompt:

> Use case: stylized-concept. Transparent GAME PROP SPRITE SHEET exact 4 columns by 3 rows, twelve separate props with generous transparent gutters. Warm detailed painterly pixel-art fantasy village, 3/4 top-down front facing camera, golden afternoon upper-left light, dark sepia contours, amber warm limestone, glossy brass, blue enamel. Row1 left to right: tiny flying COBALT BLUE ROUND DRONE with navy visor, two brilliant cyan eyes, gold antenna and twin side bronze rotors, white cyan downward thruster, no feet; warm stone FOUNDATION STEP PLATFORM, broad horizontal 260px wide three shallow chipped limestone steps with small ivy tufts at either end, no building on it; single WALL LANTERN, little glowing amber glass hanging in elaborate brass bracket, no wall behind it; broad WOODEN FLOWER WINDOW BOX, lush green leaves trailing ivy and small pink white yellow flowers, empty dark wall behind it. Row2: long hanging IVY VINE clump with warm green and olive leaves; several loose yellow-green GRASS TUFTS together as one fringe object; single small wooden CRATE; two weathered wooden CRATES together with a small burlap sack. Row3: SMALL WHITE HUD ICON of stacked diamonds (workspace layers) with no tile behind it; SMALL WHITE HUD ICON of a round cute robot head with two eye holes and antenna, no tile; SMALL WHITE HUD ICON of a branching pull request, no tile; SMALL WHITE HUD ICON of a circle with small dot in centre (issue), no tile. Icons must be bold clear ivory pictograms, detailed painted props otherwise. All fields free of any words or counts. Actual transparent exterior, no white backdrop, no checkerboard. No extra objects, no terrain ground patches.

### Village source: fountain_v3

Original output: `exec-0a8d1816-f2ba-4c49-80c1-70930e2a1213.png`.

Exact prompt:

> Use case: stylized-concept. Transparent fantasy village GAME FOUNTAIN SPRITE SHEET, EXACT 2 columns x 1 row, two matched states of SAME fountain, plenty of empty transparent margin. Warm richly detailed painterly pixel-art, crisp dark brown outlines, 3/4 top-down looking south, upper-left golden afternoon lighting. A wide low round stepped limestone fountain basin with narrow gold bronze trim and blue water; a striking VERY TALL DOMINANT bright faceted azure crystal cluster rises DIRECTLY FROM WATER, a big pointed central crystal with two smaller leaning crystals at its foot. NO CENTRAL STONE COLUMN or pedestal. Main crystal cluster occupies the upper TWO THIRDS of the full sprite height; low stone basin and two round foundation steps occupy lower ONE THIRD. Large central crystal is a tall elegant luminous icy blue spear with royal blue shadow facets and cyan-white face highlights, three leaning little crystals frame its base, cyan light casts onto water, subtle small arcs of falling water. Crystal is clearly the focal point, almost as tall as basin is wide. Left: online, luminous BLUE crystals and sparkling turquoise water. Right: offline, exact same geometry and same camera, same stone basin, dim GREY crystals with no glow and STILL muted grey-blue water. No lamps or railings around fountain, no standalone pedestal props, no scenery, NO ground or grass patch, no labels or words. No decorative layout. Actual transparent exterior, no checkerboard, no backdrop, no matte. Each fountain about 180px wide and 190px tall at game scale. Output 1536x1024.

### Village source: fountain_off_fix

Original output: `exec-ed2bf4b2-4026-478e-bdfa-f16599c32d45.png`.

Exact prompt:

> Use case: precise-object-edit. Edit ONLY the RIGHT HAND fountain in this two-column transparent sprite sheet. The offline grey fountain must have completely STILL WATER: REMOVE every arching jet, falling water stream, splash, foam ring and ripple from the RIGHT fountain, replacing them with smooth quiet dark slate-blue water. Keep its grey crystal cluster but reduce its brightness to a dim neutral grey, no blue or cyan glow. Preserve exact geometry, frame positions, all stone and gold trim, large crystal silhouette, camera and painterly pixel-art texture. The LEFT luminous BLUE ONLINE fountain remains pixel-for-pixel unchanged. Keep two separate complete sprites on real transparent alpha, no backdrop, no checkerboard, no words. Critical: no streams or ripples anywhere in RIGHT fountain.


### Village integration follow-up — labels and modular cliff

Two additional built-in generations supplied a slender 4:1 parchment name plaque,
a low dark workspace name plate, top/mid/foot waterfall modules, two wall/tower
ruins and a lamp/banner pole. The kit now contains 186 frames; all previous 172
frames retain identical painted RGBA pixels, dimensions, anchors and metadata.
Only packed positions can change. The thirteen banner frames include both
complete new labels and the requested three-slice pieces. The fifty scenery
frames include the six new environment pieces. The earlier `plaza-ring` already
contains radial/concentric paving on a round plaza in three-quarter perspective.

The wide plaque is 240x60 concept pixels and the workspace plate 98x14; their
cap/middle pieces have exact shared heights and no interior safety padding at
joining edges. Narrow blank centre strips stretch without stretching end rolls
or rivets. Middle strips repeat with matching horizontal edge texels. All new
label centres are blank. The three cliff modules are 150 concept pixels wide,
with heights 105/120/125. The middle repeats vertically. Interface bands blend in
premultiplied colour; final open-cut interface rows match exactly between top,
middle, foot and the existing banked river. No alpha halo or empty padding breaks
the stack. The stone foot contains water foam entering the river.

The private follow-up review displays plaques at 60 and 54 pixels, workspace
plates at 14 pixels, three cliff middle repeats, the join into river, ruins,
blank banner poles and radial plaza. `review-followup.py` checks the previous
frames byte-for-byte and the exact interface rows; its report and assembled
image are in `artifacts/village/followup-validation.json` and
`artifacts/village/followup-review.png`. The builder's `--followup-only` path
reuses the existing painted kit before adding these pieces. The normal full
builder also includes them. No concept pixels were copied, and no renderer code
was edited by the artist.

### Village source: labels_v4

Original output: `exec-b031f522-270e-4381-94d8-5f9b04528e5c.png`.

Exact prompt:

> Use case: stylized-concept. Transparent fantasy village GAME UI SPRITE SHEET, EXACT TWO separated horizontal objects stacked one above the other, large transparent gutters. Warm richly detailed painterly pixel-art, fine dark-brown contour, golden afternoon light upper left, antique brass and parchment. TOP OBJECT: a WIDE LOW PARCHMENT SCROLL NAME PLAQUE, precisely 4:1 width-to-height silhouette, at game scale about 240px wide by 60px high. Broad perfectly BLANK pale cream parchment centre, warm darker paper edges, rolled parchment ends at left and right, slim restrained dark bronze rim. The end rolls are SHORT AND SLENDER, not big ornate columns, and exactly as tall as the plaque. Horizontal centre must be straight and plain for three-slice horizontal stretching, no centre medallion or top/bottom flourishes. BOTTOM OBJECT: a very SMALL LOW DARK WOOD NAME PLATE, precisely 7:1 width-to-height silhouette, at game scale about 98px wide by 14px high. Blank nearly charcoal centre, narrow dark bronze trim, tiny warm gold rivets at the corners, subtle rounded clipped ends; no ornate scrolls. Its left and right ends are narrow, middle entirely flat and empty, for three-slice horizontal stretching. These are game UI pieces, aligned horizontally straight front-on, no perspective tilt. NO text, letters, numbers, icons or glyphs, no sample UI, no status dots. Entire silhouettes fully inside canvas with wide transparent margins, actual transparent alpha, no matte, no checkerboard. Output 1536x1024.

### Village source: cliffs_v4

Original output: `exec-724ad8ea-e907-400b-aedc-2b976d180ef3.png`.

Exact prompt:

> Use case: stylized-concept. Production transparent fantasy village GAME ENVIRONMENT SPRITE KIT. EXACT 3 columns x 2 rows, six separate objects, generous transparent gutters. Warm richly detailed painterly PIXEL ART, crisp dark brown contours, 3/4 top-down facing south, upper-left golden afternoon light, grey and honey sandstone cliff, moss, rich green grasses, blue turquoise water with white foam. Top row: THREE MODULAR SECTIONS OF THE SAME tall vertical WATERFALL CLIFF, each the SAME WIDTH and same central waterfall water channel and stone side walls, to stack top/middle/foot. Top left CLIFF TOP: shallow blue river spills over a mossy rugged rock ledge into a broad central white-blue waterfall, stone cliff extends down to a straight OPEN BOTTOM CUT for joining middle. Top middle CLIFF MID: a repeatable straight vertical section of rugged cliff rock with a broad uninterrupted cascading white-blue WATERFALL down its centre, moss at outer rock edges, top AND bottom are straight OPEN CUTS for repeating vertically, no pool or ledge within this middle. Top right CLIFF FOOT: top starts as same open-cut cliff and falling water channel, water crashes into a blue foamy pool with mossy side boulders; pool has a blue stream exit open toward BOTTOM to join a river. Bottom left RUIN: L-shaped warm-grey sandstone crenellated castle wall with square corner tower and broken stone blocks, ivy and moss, seen 3/4 top down, no flags. Bottom middle RUIN: ruined square sandstone watchtower with broken battlements and a short crumbling adjoining wall, ivy, grey mossy stones at base. Bottom right LAMP POST BANNER: tall slender brass/wood pole with glowing amber lantern at top beside a hanging DARK NAVY cloth banner, small gold pole finials and small pointed lower cloth end, banner centre completely BLANK for code to paint icon. Full pole including little stone foot visible. All objects fully isolated on REAL transparent alpha, no checkerboard, no scenery rectangle, NO text, NO letters, NO numbers, NO icons on banner. Consistent small-scale cosy village art. Output 1536x1024.


### Village compression and resolution audit

A later local optimisation reduced the eight Village PNGs from 24,193,470 bytes
to 8,242,573 bytes (8.24 MB, 65.9% smaller). No new image generations were used.
This is perceptual palette quantisation rather than mathematically lossless RGB
compression. Python `imagequant` 1.1.5 (libimagequant) selects up to 256 colours
with dithering off; Pillow 11.3 writes optimised PNGs. `buildings`, `ground` and
`scenery` are indexed PNGs. Other sheets keep RGBA output, quantise opaque
colours and retain every translucent pixel's original RGBA. The complete floor
light, crystal glow and four water-ripple frames remain byte-identical.

The live renderer takes the Village's frames at 1.75 sheet pixels per world
unit, overriding their nominal JSON scale of 3. A source-resolution audit found
five fixed-draw-size outliers. They were reduced within their existing atlas
slots: `plaza-ring` 1266x692 to 735x402 (58.1% linear scale), `ruin-0` 516x471 to
333x304 (64.5%), `ruin-1` 471x417 to 333x295 (70.7%), `pennant` 115x252 to 81x178
(about 70.5%), and `divider` 486x130 to 396x24 (81.5% x / 18.5% y). The divider
retains 24px height because the HUD paints its 6-point strip through a 4x canvas,
and its width retains 2x Retina detail. Other auto-sized scenery and repeating
modules retain their pixel dimensions and renderer geometry.

All atlas dimensions and frame x/y positions, names, anchors and slice insets
are unchanged. Five frame maps are byte-identical; the other three change only
the five resized frames' width/height pairs. World draw sizes are preserved.
A current validation pass checks names, bounds, overlap, clean invisible RGB,
shared robot animation geometry and declared repeat edges. The three waterfall
interfaces, including foot to banked river, still match exactly after mapping.

Originals, staged finals, palette error metrics and the compression scripts are
retained privately in `artifacts/village/`. The visual checks compare buildings,
foliage, water, paving, resized decorations and glows on dark/light backgrounds
and at their current draw sizes. No obvious visual difference, halo or new glow
banding was observed. Those images are in `artifacts/village/compression/`, with
`final-report.json` and `draw-size-metrics.json`. Original artwork can be rebuilt
from the generated sources; refresh the private baseline and reapply compression
after such a rebuild. Existing source-size descriptions above are historical
where this resolution audit explicitly supersedes them.


### Village warm paving and shallow robot ledge

Two further built-in image generations provide original muted grey-brown/tan
rounded plaza cobbles and a shallow one-step robot ledge. The private concept
and the integration comparison were inspected visually. No reference pixels
were cut into or used as source pixels for any texture or sprite. The new
`ground-warm.png`/`.json` pair has thirteen frames: `cobble-warm`, eight
`cobble-warm-edge-*` transitions, `cobble-warm-blob`, and three `porch-ledge-*`
pieces. Its PNG is 338,204 bytes. All nine sheets total 8,580,777 bytes (8.58 MB),
and none of the preceding eight PNG/JSON pairs was rewritten in this pass.

The cobble source has quieter taupe/grey-brown faces and darker mortar. A local
RGB contrast curve (gain 1.4, offset -16) opens the painted faces without the
previous strong yellow cast. A generated tile is reduced and repeated twice
within the final 448x448 sheet-pixel tile, giving roughly 10–16-world-pixel stones
at the renderer's 1.75 source-pixel ratio. Opposite edge texels match exactly.
The 224x224 transition pieces use the generated cobbles and painted grass from
the existing terrain, with deterministic irregular masks making grass overlap
the stones. Their outside edges retain real alpha. An organic 1060x648 paving
blob repeats the same stones at the same density, for use under the fountain.

The ledge is a thin single limestone step with a narrow walking surface and
one darker front course, four generated neutral brass-rim sockets, and small
end chips/moss. It is cut into 42x39, 175x39 and 42x39 source-pixel pieces. The
repeated middle has one unlit socket and a horizontal repeat of 100 world
pixels, close to the robot pitch. Total depth is 22.3 world pixels. No light
colour is baked in: live state glows belong to the renderer. Joining pieces
have no interior padding and the middle's opposite RGBA texels match.

The supplemental atlas is indexed with libimagequant, 256 colours, dithering
off, and optimised with Pillow. Repeats are checked on the compressed output.
Its private recipe is `artifacts/village/build-warm.py`, with source outputs and
`prompts-v5.json`; the native-scale old/new paving, transitions and repeated
ledge review is `artifacts/village/warm/review.png`. The private validation report
records names, dimensions, repeat edges, native density and final bytes. Existing
source-size descriptions are unchanged; the new frames have nominal JSON scale
3 and the live renderer's density of 1.75 sheet pixels per world unit.

### Village source: cobble_warm_v5

Original output: `exec-f70205e6-a7e7-4018-9be8-5c38b0b8c4f2.png`.

Exact prompt:

> Use case: stylized-concept. Production SEAMLESS COBBLESTONE PLAZA MATERIAL TILE, square 1024x1024, completely opaque and filling every pixel, no margins. Original hand-painted painterly pixel-art texture for a richly detailed cosy fantasy village, 3/4 overhead ground plane with no vanishing point. The individual old worn cobbles are ROUNDED irregular stones, arranged in gently uneven loosely coursed rows, stones of varied warm GREY-BROWN, muted tan and taupe, NOT yellow/orange sandstone. Approximately 18 to 22 stones across full tile: at game display size 256x256px this means stones about 10 to 16 pixels wide, with some smaller joint stones. Mid-value faces: warm grey #a2947f, muted taupe #aaa08e, desaturated tan #b4a58c, cool warm-grey #979284, occasional darker brown-grey #8c806c. Darker thin mortar gaps #645b4b; tiny subtle olive moss #596546 only in a few gaps. Fine chipped stone edges, individual uneven softly bevelled stones, slight warm upper-left highlights without bright outlines. Stone faces painted with quiet local texture and a little variation in shade, not flat fills, and not noisy grain. Overall calm mid value and LOW saturation, warm neutral grey brown, NOT bright golden yellow, not honey, no orange cast, no large shiny highlights. No giant slab, no ring pattern, no border, no grass field, no flowers, no props, no text, no logos. Seamless all four opposite edges; evenly distributed detail, no vignette or large lighting gradient. Match natural muted cobbles in a detailed warm fantasy village square, darker mortar clearly separates every stone.

### Village source: porch_ledge_v5

Original output: `exec-b37328f5-d123-461a-abd9-c45392222c5f.png`.

Exact prompt:

> Use case: stylized-concept. Single ISOLATED VERY LONG SHALLOW STONE PORCH LEDGE game sprite on genuinely transparent background. Original warm painterly pixel-art fantasy village asset, 3/4 top-down view facing south, straight horizontal front edge, warm upper-left light, fine dark-brown outlines and muted grey-tan limestone. At game scale the ledge is about 400 pixels WIDE and only 22 pixels DEEP TOTAL including its visible front face: extremely low long strip, NOT a broad patio, NOT stairs. Only ONE shallow raised step. A narrow top walking surface of irregular warm grey/taupe stone slabs (about 14px apparent depth) over a single narrow darker stone block front face (about 8px tall); front and top together total22px, width400px, around18:1 overall ratio. Slender outer cap at left/right with small chamfer, straight join-friendly middle. Four small circular inset floor-light SOCKETS evenly spaced along the narrow top near the front edge, restrained dull brass ring and dark unlit centre, blank so the game can add colored light dynamically. No bright permanent colored lights. Fine little chips at stone corners, a few tiny moss flecks at far ends only, sophisticated grey-brown neutral palette matching muted cobblestone village paving, no bright yellow/orange cast. Show the entire ledge completely inside canvas with wide transparent margins on ALL sides. No building, no roof, no robots, no poles, no dirt/grass ground patch, no multiple steps, no rails, no text, no checkerboard. The long THIN one-step silhouette is essential. Output landscape 1536x1024.


### Village stained-glass status fixtures

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

### Village source: tiles_v6

Original output: `exec-150e0d20-af68-4c4c-b031-d3645a2a8957.png`.

Exact prompt:

> Use case: stylized-concept. Production transparent GAME ARCHITECTURE SPRITE SHEET, exact 3 columns x 2 rows with wide empty transparent gutters. Five small STAINED-GLASS STATUS WINDOWS and one matching EMPTY ARCH SURROUND, part of a hand-painted fantasy village stone hall. Camera near-front facade seen from 3/4 top-down, tiny visible upper surfaces and a shallow raised sill, golden afternoon light upper left. Painterly PIXEL-ART miniature material detail, warm grey/tan chipped limestone, dark worn oak, restrained aged bronze lead came. The windows are physical matte translucent stained glass lit softly from within, with uneven panes and painted emblems; NEVER glossy app buttons, shiny enamel, flat vector icons, gold icon frames or HUD panels. Each coloured glass face has a nearly square silhouette with a shallow rounded/arched upper edge, about132x132 at sprite sampling, a VERY THIN dark oak lip only. Large central emblem fills about55% of face and reads at 40px. Lead joints form only a few broad asymmetrical surrounding panes, no busy radial starburst behind emblem. Emblems are warm ivory/cream painted into glass, uneven painted edges with thin dark shadow/lead seam, never flat white cutout glyphs. TOP LEFT: deep moss/emerald GREEN stained glass, large clear painted CHECK emblem. TOP MIDDLE: cobalt/azure BLUE stained glass, large painted BRANCHING PATH emblem with 3 round junctions (pull request shape), simple and readable. TOP RIGHT: honey/AMBER stained glass, painted small rolled PARCHMENT SCROLL with a broad diagonal QUILL, simple bold silhouette. BOTTOM LEFT: deep warm ruby RED stained glass, large triangular warning emblem and exclamation, cream in dark outline. BOTTOM MIDDLE: cool desaturated SLATE BLUE smoked glass, three stacked old wooden STORAGE CRATE/rack compartments as painted emblem, with simple pale horizontal slats and tiny pale cyan inset rivets, fantasy storage/server state, no modern white server icon. BOTTOM RIGHT: matching EMPTY surrounding stone ARCH AND INTEGRATED SILL only, same family as the windows, footprint150 wide x164 high. Dark rough empty opening fills upper square area (a window face will overlay it), shallow rounded arch above, rough warm limestone blocks and a worn dark-oak inner lip. Below the opening, immediately attached, one broad carved STONE SILL with two little timber corbels, shallow worn carved edge and a few subtle moss flecks; no empty name/count plaque, no dark label slot, no riveted plate. The surround must look built into a village facade, understated rather than ornate. All six objects fully visible in own cell with same scale/camera/light. No text, letters, counts, labels, robots, buildings beyond these fixtures, backgrounds, checkerboard or ground patches. Genuinely transparent exterior. Output1536x1024.


### Village workspace cottages and district hierarchy — first complete pass

At the user's request, the map's visual hierarchy now has one district/fountain
per host, existing halls per project, small cottages per workspace and agents
beside the cottage doorsteps. Two new built-in generations paint the supporting
art; the existing halls, dashboard buildings, robots and all prior sheets remain
unchanged. The Islands screenshot was read as hierarchy context, not as artwork
to copy. The new architecture retains the Village's painterly pixel-art texture,
three-quarter facade perspective, warm upper-left light, grey/tan limestone,
worn timber and detailed roofs.

`cottages.png`/`.json` adds eleven frames: `cottage-0..5` and
`cottage-pane-merged|review|draft|failing|none`. The six forms are a slate-blue
gabled house, purple round tower house, teal workshop shed, rust-roof market
stall house with side awning, green-roof bakery with oven chimney, and thatched
small chapel with bell cupola. Each fits a 360x360 painted pixel envelope plus
three pixels of transparent padding, preserving its proportions. Each has one
blank front status-window aperture and a small step off to one side. No text,
name sign, banner, status colour or robot is baked into the cottage.

Each cottage's JSON includes `pane: {x,y,w,h}` bounding the actual dark window
aperture, and `doorstep: {x,y,w,h}` locating its small step. These are frame-local
source pixels, including the safety padding, not atlas positions or normalised
fractions. Crop/resize transforms are applied consistently to both rectangles.
Bottom-centre anchors exclude the bottom padding. The five cottage panes reuse
the current painted stained glass, cropped from the old 132px tile canvases,
resampled to 90x100 and masked to the cottages' deeper semicircular arch. Code
can draw one directly into the pane rectangle without handling tile margins.

`district.png`/`.json` adds nine frames: `path-stone-straight`,
`path-stone-diagonal`, `path-stone-diagonal-reverse`, `fence-h`, `fence-v`,
`hedge-0..2`, `district-gate`. The extra diagonal is a mirror of the generated
slope. Paths have varied rounded cobbles and grassy organic edges. Worn oak
fences and low hedges mark district edges without becoming high walls. The
stone entrance gate has ivy, a carved keystone and a real transparent passage;
no host text or sign is painted in.

The first complete pass is live. Both atlases are indexed PNGs with libimagequant
256-colour palettes, dithering off and Pillow optimisation: cottages 334,501
bytes; district 151,959 bytes. All eleven sheets total 8,986,559 bytes (8.99 MB),
with 220 frames. Previous PNG/JSON pairs are untouched. Validation checks the
new frame names, alpha, bounds, nonempty silhouettes, frame overlap, and that
every pane/doorstep rectangle remains inside its frame after cropping/resizing.

The private recipe is `artifacts/village/build-cottages.py`; raw outputs and
`prompts-v7.json` retain sources. `artifacts/village/cottages-v7/first-pass.png`
shows all six cottages with real panes in their apertures and provider robots
beside their doorsteps, plus the new district pieces. The state panes and robots
in that review are separately composited sprites. Their pixels are never baked
into production cottages. The first complete pass uses two new imagegen calls,
bringing the Village source generation count to nineteen.

### Village source: cottages_v7

Original output: `exec-a7504c0a-84e9-4b85-88a4-40c74a0ed6e9.png`.

Exact prompt:

> Use case: stylized-concept. Transparent GAME BUILDING SPRITE SHEET, EXACT 3 columns x 2 rows, SIX DIFFERENT SMALL WORKSPACE COTTAGES, each fully visible with generous transparent gutters. Same style as a richly detailed cosy painterly pixel-art fantasy village: 3/4 top-down looking south at front facades, warm golden afternoon from upper left, crisp fine dark brown contours, chipped grey-tan limestone, worn oak beams, individual little roof shingles, a few tiny ivy/flower accents. Each cottage modest and small, about120x120 game concept pixels, around one-third a village guild hall's width. Roof silhouettes distinct, front facade facing camera, not diamond/isometric rotation. EVERY cottage has EXACTLY ONE LARGE FRONT ARCH WINDOW with plain DARK EMPTY opening, thin oak lip and warm stone arch. That blank arched window is centered on a flat part of the front facade, about one-quarter cottage width and nearly square, reserved for a separately overlaid stained-glass state pane. Window has NO glass, no mullions, no shutter, no interior objects, no light or glow. A small rectangular closed timber door may be on the side only. A low shallow limestone DOORSTEP at the foot extends slightly to one side, enough for a round robot to stand BESIDE the cottage, but paint NO robot. TOP LEFT: little gabled stone-and-oak house with SLATE BLUE shingle roof and tiny chimney. TOP MIDDLE: short ROUND STONE TOWER HOUSE with PURPLE conical tiled roof, one flat front arch window. TOP RIGHT: low WORKSHOP SHED with TEAL tile roof, small lean-to at one side, one front arch window. BOTTOM LEFT: MARKET STALL HOUSE, warm RUST orange tiled roof and small cream/burgundy fabric awning off one side, one front arch window. BOTTOM MIDDLE: BAKERY cottage, GREEN shingle gable roof and stout little stone oven chimney, one front arch window; no painted bread/signs. BOTTOM RIGHT: tiny CHAPEL cottage with warm natural THATCH roof and a small bell cupola, one front arch window. Little warm highlights, textured painted materials, same scale/camera/light across all six. NO signs, text, labels, banners, symbols, counts, robots, terrain platforms or broad grass bases. Actual transparent alpha outside each full silhouette, no matte, no checkerboard, no cropped roof tips. Output1536x1024.

### Village source: district_props_v7

Original output: `exec-88dec70c-6339-4041-adcc-37e87c707190.png`.

Exact prompt:

> Use case: stylized-concept. Transparent fantasy village GAME ENVIRONMENT PROP KIT, EXACT 4 columns x 2 rows with eight fully separate props and wide transparent gutters. Richly detailed painterly pixel-art, crisp thin dark brown contours, 3/4 top-down looking south, warm golden afternoon upper-left light, grey/tan limestone and worn dark oak, deep olive greens, restrained moss. TOP LEFT: short STRAIGHT horizontal cottage-to-hall COBBLE PATH segment, around90x28 game concept pixels, varied rounded muted warm grey-brown/tan stones with dark mortar, organic edges with subtle grass at sides, no flat yellow rectangle. TOP SECOND: same short cobble path on a DIAGONAL from upper left to lower right, same stone scale/width, organic grassy side edges. TOP THIRD: LOW HORIZONTAL WOODEN DISTRICT FENCE segment, dark weathered oak posts and two narrow cross-rails, small brass pegs, low enough not to hide robots, straight open join-friendly ends. TOP RIGHT: same LOW FENCE running VERTICALLY away in ground plane, two rails and posts in same perspective, no rotation mismatch. BOTTOM LEFT: small LOW HEDGE clump with dense dark-green rounded leaves, around60px wide, no soil base. BOTTOM SECOND: same low hedge family but a longer gently irregular yellow-olive leaf clump, around75px wide. BOTTOM THIRD: third low hedge variant, rounded rich green foliage with a few tiny pale flowers, around65px wide. BOTTOM RIGHT: small DISTRICT STONE ARCH GATEWAY, about90px wide and100px high, warm grey/tan limestone posts and arch with a simple carved keystone, small ivy trails and a shallow threshold, completely empty dark open passage with actual transparent view through it, no iron door, no banner or sign. Props only, no buildings, no robots, no words, letters, numbers, icons or labels, no square terrain bases. Each whole prop isolated on genuine transparent alpha, no checkerboard or background. Output1536x1024.
