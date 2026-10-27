# Artwork provenance

Generated with the built-in `image_gen` tool for this local project. No Phaser AE crew, uploads or phaser.io services were used. The reference supplied by the user, now retained as `../design/references/atlas-05.webp`, was a style reference for the two sprite atlases. Original references remain references; none is used as the running scene's background.

The output PNGs are retained without destructive editing. Phaser registers and trims individual atlas frames at runtime. Transparent alpha is preserved. All five local assets are used by the renderer.

## buildings.png

Original output: `exec-beb808dc-f1d4-4117-911e-b941ae7b9ad7.png`.

Exact prompt:

> Use case: stylized-concept. Create a production GAME SPRITE ATLAS, not a scene or screenshot. The attached image is STYLE REFERENCE ONLY: hand painted ink-and-watercolor fantasy cartography, slate blue tiled roofs, aged cream limestone, fine brass trim, restrained sunlit shadows. Output a landscape transparent PNG arranged as an EXACT 3-column by 2-row GRID, six equal cells, generous transparent gutters. All six subjects fully inside their own cell with equal margin. Camera STRICT ORTHOGRAPHIC STRAIGHT DOWN 90-degree overhead, looking at roofs; no horizon, no isometric tilt or visible front facades. Top left: large square manor courtyard with four slate-roof wings around an open garden and tiny central round fountain. Top middle: round brass-ribbed slate-and-glass observatory dome with an offset opening. Top right: cross-shaped Victorian glass conservatory with pale blue panes and brass framing. Bottom left: small rectangular slate roof cottage with timber porch and chimney. Bottom middle: a second small cottage with brown timber roof and small chimney. Bottom right: a little isolated grove of two moss-green leafy trees, a shrub and three grey shoreline boulders viewed vertically from above. Ground only inside manor courtyard; other sprites have no island, terrain, grass base, hexagon, number, label, text, banner or UI. Building footprints must be sharp and exquisitely detailed but readable when scaled to 200px. Painterly game art with thin sepia contour ink, rich material detail, warm old-world miniature architecture. Transparent exterior, never a checkerboard.

## robots.png

Original output: `exec-f68807de-d4bf-4c9d-bd65-75d50dd83114.png`.

Exact prompt:

> Use case: stylized-concept. Production transparent GAME SPRITE ATLAS: EXACT 2 columns by 2 rows, four equally sized cells with very wide transparent gutters. Four versions of the SAME adorable spherical enamel-and-brass helper robot. Camera strict vertically overhead 90-degree top-down, a little dark face visor on forward lower edge visible from above, small round metal hands/feet to either side, tiny brass antenna, glossy domed round head with painted highlight. Antique brass edging. Top-left turquoise teal, top-right violet purple, bottom-left fresh lime green, bottom-right cobalt blue. Match attached reference's small robot illustrations: charming hand painted fantasy map art, fine dark ink outlines, watercolor/gouache material detail, tiny soft grounding shadow only. Robot centered in each quadrant and occupies about 60% of each cell. No ground tile, no island, no labels, no letters, no text, no status marks, no circles or magical glow around robots. Everything outside each single robot must be genuinely transparent. Do not make a 3D render or pixel art. Consistent scale across all four.

## water.png

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
