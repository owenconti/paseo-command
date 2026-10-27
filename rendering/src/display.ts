// A stable 2x backing buffer keeps painted sprites and world text crisp.
// The camera remains in world units; this is raster density, never label scaling.
export function renderDensity(): number {
  return 2;
}
