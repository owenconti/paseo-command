# Paseo Command — Atlas layout and art

The Atlas world's rules and artwork, shared by the macOS app (`native/`), which draws it with
SpriteKit. Inside the app the React page mounts the bridge world (`src/native/bridge.ts`): it lays
the fleet out (`layoutAtlas` in `src/world.ts`), places structures, props, PR flags, banners, tiles
and robots (`src/placement.ts`), paints the sprite frames and terrain (`src/art.ts`, `src/terrain.ts`)
and posts the result to Swift. Camera, outline and picking rules (`camera.ts`, `outline.ts`,
`pick.ts`) are ported to Swift in `native/Sources/PaseoCommandNative/Geometry.swift`.

```sh
npm run render:test     # layout and tile constraints, from the repository root
```

Artwork provenance and generation prompts are in `ASSETS.md`.
