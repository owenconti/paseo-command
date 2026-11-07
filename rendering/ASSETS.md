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
