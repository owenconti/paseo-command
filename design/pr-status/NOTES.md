# PR status emblem artwork provenance

Generated with the built-in `image_gen` tool for this local project, 2026-10-28. No Phaser AE, phaser.io, crew, room streamer, publishing or asset-upload tools were used. Artwork only: no application code was changed and no commit or build/restart was performed.

Style references: `../../rendering/src/assets/buildings.png`, `../../rendering/src/assets/props.png`, and `../../rendering/src/assets/tree-v2.png`. Placement context: `/tmp/prmock/app.png` (inspected) and `/tmp/prmock/ws.png` (inspected, supplied to the first generation as scale context, and used for the preview). Reference art is not part of the generated atlas.

## emblems.png — chosen atlas

1536 × 1024 RGBA, exactly three columns by two rows of 512 × 512 cells. Each complete padded sprite is centered in its cell and has a maximum dimension of 308 pixels (60.16% of the cell). Coordinates are zero-based, left to right.

| Cell | State | Shape / colour / glyph |
| --- | --- | --- |
| Top left | CI running | Round, amber, hourglass |
| Top middle | CI green | Round, emerald, solitary check |
| Top right | CI failing | Round, red, cross |
| Bottom left | Awaiting review | Pointed shield seal, sky blue, eye |
| Bottom middle | Approved | Pointed shield seal, violet, laurel enclosing a check |
| Bottom right | Changes requested | Pointed shield seal, orange, quill |

Original outputs, both retained unchanged as alternates:

- `emblems-alt-1.png`: `exec-c391fa33-1783-4683-b101-6be602e368fd.png`.
- `emblems-alt-2.png`: `exec-79e93eed-108f-41bd-b586-fb5bc005fc54.png`.

Both originals are also retained at `/Users/example/.codex/generated_images/01a182ce-3bf8-7b33-9893-b559af5af5b0/`.

The first generation had good readable glyphs and genuine alpha but subjects occupied roughly 80% of their cells. A second image_gen edit requested wider gutters, preserving the artwork. It still kept the emblems too large and slightly off center. The chosen final therefore uses complete subject crops from the second output, repacked locally following the atlas-compositing approach documented for `props.png` in `../../rendering/ASSETS.md`.

Packaging: alpha > 1 locates each subject within its own 512 × 512 source cell. Add six pixels of original padding on every side, preserve all RGBA values within that crop, and resize the whole crop proportionally with Lanczos to a maximum of 308 pixels. Center each crop on a new fully transparent 1536 × 1024 image. No colours were repainted, no glyphs redrawn, and no alpha threshold was applied to retained pixels. This excludes remote alpha=1 generator speckles outside the padded subject crop, while preserving faint edge alpha inside it. Original outputs are unmodified.

| State | Source crop [left, top, right, bottom] | Destination [x, y] | Padded sprite size |
| --- | --- | --- | --- |
| CI running | [61, 66, 478, 482] | [102, 102] | 308 × 307 |
| CI green | [559, 65, 976, 484] | [614, 102] | 307 × 308 |
| CI failing | [1055, 65, 1474, 484] | [1126, 102] | 308 × 308 |
| Awaiting review | [71, 515, 471, 958] | [117, 614] | 278 × 308 |
| Approved | [566, 515, 971, 958] | [627, 614] | 282 × 308 |
| Changes requested | [1064, 515, 1466, 958] | [1140, 614] | 279 × 308 |

Validation: all six cells populated in the requested order; all four canvas corners have alpha zero; each cell has at least 100 pixels of completely transparent margin on every side of its subject. No checkerboard, text, labels, terrain or tile is present in the atlas. Circles remain circles and shields are front-facing. Overall subject size and lighting are consistent.

## preview.png

1508 × 606 RGB contact sheet, preview only. All six emblems appear individually at both 32 and 48 pixels maximum dimension, alpha-composited over the same unscaled 230 × 198 cottage screenshot crop: `/tmp/prmock/ws.png`, rectangle [182, 78, 412, 276]. The emblem center corresponds to screenshot coordinate [340, 185], beside the cottage roof. Each sprite is cropped to its actual alpha bounds before proportional Lanczos downsampling; preview sizes refer to the whole emblem, not its 512 pixel atlas cell. Labels, dark framing and map crops are preview-only.

Visually inspected both the full final atlas and this preview. The six colour/glyph combinations remain distinct at 32 pixels; the violet shield and enclosing laurel distinguish review approval from the green CI check. The laurel is the busiest glyph and loses individual leaf detail at 32 pixels; 48 pixels gives a clearer approval check. The hourglass is static artwork; no animation is included. Absolute label-colour values are not encoded: colours are painted interpretations of amber, emerald, red, sky blue, violet and orange.

## Exact first-generation prompt

> Use case: stylized-concept.
> Asset: production transparent GAME SPRITE ATLAS of SIX small GitHub pull-request status objects for the existing Atlas fantasy map. These are physical painted brass-and-enamel medallions and wax seals, not flat software UI icons.
> Input images 1 (buildings.png), 2 (props.png), and 3 (tree-v2.png) are STYLE REFERENCES ONLY: match their hand-painted ink-and-watercolour/gouache fantasy cartography, fine thin sepia contours, antique brass edging, warm cream highlights, restrained material detail and upper-left sunlight. Image 4 (ws.png) is placement/scale context ONLY: the emblems will sit on or beside that cottage and be viewed at 24–48 pixels. Do not include any reference buildings, trees, terrain or map in the output.
> Composition: EXACT 3 columns x 2 rows of six equal SQUARE cells, landscape 3:2 canvas, ideally 1536 x 1024. Centers exactly at one-sixth, one-half and five-sixths of canvas width; one-quarter and three-quarters of canvas height. ONE emblem precisely centered in each cell. Each emblem occupies approximately 60% of its cell width and height, with generous genuinely transparent gutters. All six same overall size and visual weight. Everything including tiny contact shadows fully inside its own cell.
> Camera: strictly orthographic straight down onto objects lying flat, their decorated faces parallel to the image plane, entirely front-facing glyphs, circles remain circles. No tilt, perspective, visible side faces or standing elevation.
> TOP ROW, CI GROUP: identical ROUND antique-brass-rimmed enamel medallion silhouettes with thin sepia outside contour and broad clean enamel fields.
> Top left: CI RUNNING. Amber/gold enamel. One large bold warm-ivory HOURGLASS with a simple brass frame, two clear glass triangles and sand. Compact, instantly readable silhouette, taking at least 55% of the face. No other symbol.
> Top middle: CI GREEN. Rich emerald enamel. One large bold warm-ivory CHECK MARK, thick uninterrupted strokes, taking at least 60% of the face. No laurel, ribbon or other symbol.
> Top right: CI FAILING. Deep red enamel. One large bold warm-ivory diagonal CROSS with two thick equal strokes, taking at least 60% of the face. It is a pictorial failure cross, not lettering.
> BOTTOM ROW, REVIEW GROUP: matching softly irregular wax-seal SHIELD silhouettes with broad shoulders and a clearly POINTED BOTTOM, subtly rimmed in antique brass. All three share that shield shape, clearly distinct from the circular CI medallions.
> Bottom left: AWAITING REVIEW. Sky blue wax/enamel shield. One large bold warm-ivory EYE with a dark central pupil and clear almond outline, taking at least 60% of the face. Simple, readable, no tiny eyelashes.
> Bottom middle: APPROVED. Violet wax shield, stamped with a broad warm-ivory LAUREL WREATH framing a small solid approval check. The laurel must dominate as the distinctive review-approval glyph; visually different from the solitary large CI check above. Keep it simple enough to read at 32 pixels.
> Bottom right: CHANGES REQUESTED. Clear saturated burnt-orange wax/enamel shield. One large diagonal warm-ivory QUILL with a broad feather silhouette and clear dark central shaft, taking at least 65% of the face. Minimal feather cuts, not intricate linework.
> Rendering: painterly tactile enamel and wax with restrained gouache variation, fine aged brass highlights, small authentic imperfections. Strong simple silhouettes and high-contrast glyphs are more important than tiny ornament. Thin rims, broad colored centers, no excessive engraving, jewels, chains, ribbons, external flourishes or glow. Consistent upper-left lighting across all six.
> Absolutely NO text, letters, numbers, labels, captions, logos, watermarks, arrows, grid lines, cell dividers, ground, tiles, paving, hexagons, scenery or background wash. GENUINE transparent alpha everywhere outside the six isolated emblems, NEVER checkerboard or an opaque background. No photorealism, no 3D render, no pixel art.

## Exact second-generation prompt

Reference input: the first generated atlas, `exec-c391fa33-1783-4683-b101-6be602e368fd.png`.

> Use case: precise-object-edit.
> Edit the attached six-emblem atlas. Change ONLY the layout/scale of the six existing complete emblems: give them much wider transparent gutters and precise equal-cell registration. Preserve their painted designs, all six glyphs, colours, materials, upper-left lighting, fine sepia contours, sharp edges and transparent alpha.
> Output a landscape 1536 x 1024 RGBA transparent PNG, EXACT 3 columns x 2 rows of 512 x 512 square cells. Precisely center each subject at (256,256), (768,256), (1280,256), (256,768), (768,768), (1280,768). Each complete emblem, including rim and tiny shadow, must have a maximum dimension of approximately 308 pixels (60% of one 512px cell). Keep at least 100 pixels of completely transparent margin on every side of each emblem within its cell. Do not enlarge subjects to fill the frame.
> Maintain row order exactly: top = amber hourglass round medallion, emerald solitary-check round medallion, red cross round medallion; bottom = sky-blue eye shield, violet laurel-and-check shield, orange quill shield. Keep the broad pointed review shields distinct from the round CI medallions. All emblems have equal maximum dimensions and visual weight. Keep each glyph bold and high contrast for display at 32 and 48 pixels.
> No additional objects, ground, glow, background wash, text, labels, numbers, grid lines, cell boundaries, checkerboard or opaque background. Everything outside the six physical emblems must be genuinely transparent alpha. Flat front-facing orthographic view; no perspective. Preserve the hand-painted fantasy-cartography style.

## flags.png — standing flag revision

Generated with the built-in `image_gen` tool, 2026-10-28, in response to the request for flags planted on the cottage's timber decking. Artwork only; existing emblem files are preserved. No code changes, commit, build/restart, publishing, asset uploads or Phaser AE services.

Reference inputs to the first flag generation, in order:

1. `../../rendering/src/assets/props.png` — hand-painted materials and brass prop fittings.
2. `/tmp/prmock/ws.png` — cottage camera and decking placement context.
3. `emblems.png` — the six existing colour/glyph identities.

Original outputs, retained unchanged:

- `flags-alt-1.png`: `exec-0b97d0d2-4d85-44a0-bced-51bd4d1e0f95.png`. The first pass made complete readable flags, but the blue swallowtail extended beyond its nominal cell boundary.
- `flags-alt-2.png`: `exec-348043d6-2ba9-4241-9415-d5f7f3d0a6a1.png`. The second pass corrected the overly wide review banners and supplied the chosen painted subjects.

Both originals remain at `/Users/example/.codex/generated_images/01a182ce-3bf8-7b33-9893-b559af5af5b0/`.

### Final atlas and registration

`flags.png` is 1536 × 1024 RGBA: EXACT 3 columns × 2 rows of 512 × 512 cells. Top row: amber hourglass, emerald check, red cross. Bottom row: sky-blue eye, violet laurel/check, orange quill. CI cloth is rectangular; review cloth has a swallowtail notch at its right free edge. Every flag has a short turned-timber pole, brass collars and finial, tiny weighted brass foot, and a gently waving cloth face. One static frame per flag; no animation or sway implementation is included.

As with the earlier atlases, local packaging normalizes the generated subjects without repainting them. In each source cell, alpha > 1 locates the subject; the source crop includes six extra pixels on every side. Alpha > 20 is used only to measure solid finial-to-foot height for consistent scaling and base registration. Each whole RGBA crop is resized proportionally with Lanczos so that this measured height is 292 pixels. No threshold is applied to retained alpha; all original crop colours and faint edge pixels are preserved. Remote alpha=1 speckles outside the padded crop are excluded. The final complete padded images are 304–306 pixels tall.

All six flags share the same pole-base anchor within their cell: **[156, 404]**, measured at the pole center and bottom edge of its weighted foot. With an untrimmed 512 × 512 cell this corresponds to normalized [0.3046875, 0.7890625]. Pole center and footing bottom are registered to this anchor rather than centering the whole assembly, because cloth extends to the right. This leaves the pole planted consistently when frames are positioned or given a slight sway.

| State | Source crop [left, top, right, bottom] | Destination [x, y] | Padded size |
| --- | --- | --- | --- |
| CI running | [127, 89, 443, 469] | [114, 107] | 253 × 304 |
| CI green | [610, 89, 919, 469] | [628, 106] | 248 × 305 |
| CI failing | [1090, 89, 1404, 469] | [1140, 106] | 252 × 305 |
| Awaiting review | [131, 569, 483, 948] | [117, 619] | 283 × 305 |
| Approved | [610, 569, 964, 949] | [628, 618] | 285 × 306 |
| Changes requested | [1090, 569, 1454, 950] | [1140, 619] | 293 × 306 |

Validation: genuine alpha, six complete isolated assemblies in the correct cells, at least 95 pixels of fully transparent margin around each subject on every cell edge, consistent base anchors, no neighbouring flag fragments, labels, checkerboard, scenery, ground or tiles. After resampling, the sky-blue flag was shifted down one pixel to register its painted foot bottom precisely; all six foot bottoms measured at alpha > 20 now sit at local y=404. Viewed the full final atlas and the final 32/48 pixel preview. The cloth faces deliberately show an upright elevation for readable glyphs, with the small elliptical weighted foot supplying the elevated-map cue.

### flags-preview.png

932 × 606 RGB preview. Three combinations at both **32 pixels tall** and **48 pixels tall**: running + awaiting review; CI green + approved; CI failing + changes requested. Each panel uses the same unscaled screenshot crop from `/tmp/prmock/ws.png`, rectangle [182, 78, 412, 276]. Flags are downsampled from their actual alpha bounds; the stated height is the entire visible flag assembly including finial, pole and foot, not just the cloth.

The two footing anchors sit at screenshot coordinates [336, 244] and [372, 244], on the lower-right timber decking beside the cottage. No new ground or procedural shadows are drawn. Labels, framing and screenshot background appear only in the preview.

Legibility: all six colour/glyph combinations and the rectangular versus forked cloth shapes remain distinguishable at 32 pixels total height. The approval laurel is the busiest motif; individual leaves soften at 32 pixels, with the central check clearer at 48 pixels. Colours are painted interpretations, not exact flat UI swatches.

### Exact first flag-generation prompt

> Use case: stylized-concept.
> Create a production transparent GAME SPRITE ATLAS of SIX tiny STANDING FLAGS for a hand-painted fantasy strategy map. This is new artwork repainting the status emblems as actual cloth flags on poles. They must look planted on timber decking beside a cottage, NOT floating badges, flat UI icons or flags lying on the ground.
> Reference image 1, props.png: STYLE AND MATERIAL REFERENCE ONLY, particularly its antique brass lamp fittings and workshop props. Reference image 2, ws.png: camera and placement context ONLY, the cottage's roof is seen from above but standing details are visible. Reference image 3, emblems.png: exact six colour/glyph identities ONLY. Do not include any of the reference scenery or medallions.
> Match hand-painted ink-and-watercolour/gouache fantasy cartography: thin sepia ink contours, warm timber, aged antique brass, cream painted motifs, gentle upper-left light, crisp but handmade edges and restrained painterly detail.
> EXACT 3 columns x 2 rows, six equal square cells, landscape 1536 x 1024 RGBA PNG. One complete isolated flag assembly per cell. Wide EMPTY TRANSPARENT gutters. Each full assembly approximately 300 pixels tall, centered in its 512px cell with at least 95px of empty margin on every side. Consistent scale, flagpole height, footing size and illumination across all six. The bottom of every tiny base must sit at the same local y coordinate in its cell.
> Each assembly: one SHORT upright turned-timber flagpole with antique-brass collars, a small round brass finial, and a TINY low round weighted brass foot. No platform or ground under the foot. Cloth attached to upper pole and extending to the RIGHT. Broad cloth carries one large bold high-contrast cream pictorial glyph. Cloth is about TWO THIRDS of total flag height: prioritize a big readable glyph and short exposed pole below. Gently billowing fabric with only one broad shallow wave and a slim gold stitched hem. No drooping fabric, flapping blur, flying parts, tassels, ropes, ornamental streamers or additional symbols. One static frame per flag.
> Camera: match a standing miniature prop beside the supplied cottage; a mildly elevated orthographic view, tiny elliptical top of the brass footing visible, pole upright in screen space, banner turned TOWARD THE VIEWER enough to show the entire glyph clearly. No extreme foreshortening. The cloth is a vertical upright surface, not a horizontal flag lying flat. All six viewed at the SAME angle.
> TOP ROW = CI, all three cloth banners have a SQUARE / short RECTANGULAR silhouette, straight free edge on the right:
> 1. TOP LEFT: AMBER / warm gold cloth with one large cream HOURGLASS. Very simple bold hourglass silhouette: two clear triangles, thick top and bottom rails, dark narrow center. No cog.
> 2. TOP MIDDLE: EMERALD cloth with one very large bold cream CHECK MARK, thick clean strokes, no wreath.
> 3. TOP RIGHT: RED cloth with one very large bold cream diagonal CROSS, two equal thick strokes. No lettering.
> BOTTOM ROW = REVIEW, all three cloth banners have a SWALLOW-TAILED silhouette: broad banner with a deep unmistakable V-shaped notch cut into the RIGHT free edge, two pointed tails. Same overall area and height as CI flags, keep glyph left of the notch and fully readable:
> 4. BOTTOM LEFT: SKY BLUE cloth with a large bold cream EYE, almond outline and one dark pupil, no eyelashes.
> 5. BOTTOM MIDDLE: VIOLET cloth with a cream LAUREL WREATH around a cream approval CHECK. Simplified bold wreath with only three broad leaves on each side and an ample clear center check. It must remain distinct from the solitary CI check.
> 6. BOTTOM RIGHT: ORANGE cloth with a large diagonal cream QUILL, simple broad feather silhouette and clear dark central shaft, very few feather cuts.
> Glyphs occupy most of each banner face. These complete objects will be shown only 28–48 pixels TALL, so no intricate filigree, tiny marks or fussy folds across the glyphs. Strong colour blocks, distinct rectangular versus forked silhouettes, bold glyphs and a clearly visible planted foot are essential.
> GENUINE TRANSPARENT ALPHA background outside all six assemblies. No opaque backdrop, no checkerboard, no gradient, no ground wash. Tiny tight contact shadow only directly under each small foot, no cast shadow shapes extending beyond the object. Absolutely no ground, tiles, timber decking, terrain, cottage, island, grid lines, labels, text, letters, numbers, logos or watermark. No circular medallions or shields. No 3D render, photorealism or pixel art.

### Exact second flag-generation prompt

Reference input: the first flag output, `exec-0b97d0d2-4d85-44a0-bced-51bd4d1e0f95.png`.

> Use case: precise-object-edit.
> Correct the spacing of the attached six painted standing flags, retaining all six designs, their upright timber-and-brass poles, weighted feet, gentle cloth waves, colours and bold glyphs. Preserve transparent alpha and hand-painted fantasy-map style.
> Make a spacious EXACT 3-column x 2-row game sprite atlas, 1536 x 1024 pixels. Six equal 512x512 square cells. Every complete flag assembly, including pole, finial, cloth and foot, MUST fit inside the MIDDLE 60% of its own cell. Shrink the six complete assemblies uniformly to only 300 pixels tall, with at least 100 completely transparent pixels of padding above and below each. Center the whole flag within its cell, including its cloth. Do not let the cloth approach or cross any grid boundary: the original first blue review flag reaches too far right. This revision needs substantially MORE EMPTY SPACE than the original.
> Within each cell the foot bottom sits at local y=406; finial at local y=106. All six pole footings at identical heights within their row and all six poles identical in height, material and fittings. The three rectangular CI banners and three swallow-tailed review banners should have similar widths and visual weight: make the review cloth narrower than in the reference, but preserve a clear deep notch on the right and do not compress or truncate glyphs.
> Top row left-to-right: amber hourglass rectangle, emerald single-check rectangle, red cross rectangle.
> Bottom row left-to-right: sky-blue eye swallowtail, violet laurel-and-check swallowtail, orange quill swallowtail.
> Keep the laurel simplified with broad leaves so it remains legible at 32 pixels total flag height. Large cream glyphs, no minute detailing. Keep banner faces visible and mildly elevated standing-prop camera. Exactly one complete standing flag per cell; no medallions.
> No text, numbers, grid lines, labels, scenery, ground, tiles, background wash or checkerboard. Genuine fully transparent background around all six objects. No large cast shadows or glow. Deliver only the widely spaced six-flag transparent atlas.
