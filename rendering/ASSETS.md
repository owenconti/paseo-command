# Artwork provenance

Generated with the built-in `image_gen` tool for this local project. No Phaser AE crew, uploads or phaser.io services were used. The reference supplied by the user, now retained as `../design/references/atlas-05.webp`, was a style reference for the two sprite atlases. Original references remain references; none is used as the running scene's background.

The output PNGs are retained without destructive editing. Phaser registers and trims individual atlas frames at runtime. Transparent alpha is preserved. Local assets are bundled directly by the renderer.

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


## tree-v2.png — canopy clipping fix

Generated with the built-in image_gen tool, using buildings.png as a style reference. This standalone transparent sprite replaces the crowded tree frames from buildings.png; the original atlas remains in use for architecture and rocks. The tree is registered from its full source image with 20 pixels of extra frame padding, retaining faint leaf-edge alpha.

Original output: `exec-e7c370a3-1507-4bdd-ac14-ce509ecfcbe3.png`.

Exact prompt:

> Use case: stylized-concept. Create one SINGLE ISOLATED TREE game sprite on a genuinely transparent background. Reference image is a STYLE REFERENCE ONLY: match its round dense oak tree canopy, hand-painted watercolor/gouache leaf clusters, thin sepia ink contours, moss green and yellow-green foliage, warm highlights and fine brown branches. Camera straight down 90-degree overhead as in a fantasy strategy atlas. Show one complete irregular round deciduous oak canopy, including ALL its outer leaves and branches. Center it, occupying only the middle 60% of the square image with at least 20% completely empty transparent margin on every edge. No part of the tree or its soft tiny shadow may touch any image edge. Absolutely no rocks, shrubs, ground, trunks protruding as disconnected fragments, other trees, labels, numbers, grid, text or background. This will replace a tree extracted from a crowded sprite sheet that had accidentally included part of a rock: make this a clean standalone tree sprite with a complete natural leafy silhouette and zero neighboring objects. Keep painted texture and ink detail consistent with the source, not a photo or a 3D render.

## Galaxy textures (`src/assets/galaxy/`)

Copied from the original Paseo Command project, `Unity/Assets/Paseo/Art/Textures/`
(Barren, Clouds, Desert, Forest, Ice, Nebula, Ocean, RingedGas, Storm, Volcanic), and
re-encoded as JPEG at their full 1774 px width. They are equirectangular surface maps (and a grayscale
nebula density map) generated for that project; their prompts and checksums are in its
`art/galaxy/prompts/production-texture-prompts.json`. Stations, satellites, rings,
atmospheres, stars and rocks are drawn procedurally in `src/galaxy/paint.ts`, after the
original's Unity station and satellite geometry and its Galaxy reference screenshots.
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
