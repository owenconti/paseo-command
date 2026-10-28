/** The embedding API for the Atlas world. The macOS app (`native/`) draws it
 * with SpriteKit under the page; this hands the page's map surface to it. */
import { mountNativeAtlas, nativeWorldAvailable } from "./native/bridge";
import type { AtlasData, Entity } from "./world";
export type { AtlasData, Entity };
export { STATE_NAMES, STATE_TILE, MODEL_COLORS, MODEL_FAMILY, modelColor, modelName } from "./world";
export { nativeWorldAvailable };
/** Screen position in CSS pixels relative to the map surface. */
export type ScreenPoint = { x: number; y: number };
export type AtlasHandlers = {
  /** The user chose an entity on the map, or cleared the choice (Escape). */
  pick?: (entity: Entity | null) => void;
  hover?: (entity: Entity | null, at: ScreenPoint | null) => void;
  selection?: (entity: Entity | null) => void;
  zoom?: (zoom: number) => void;
  ready?: () => void;
  error?: (message: string) => void;
};
export type AtlasWorld = {
  kind: "atlas";
  /** Drawn by the native macOS app (SpriteKit), behind a transparent page. */
  native: true;
  update(data: AtlasData): void;
  select(id: string | null): void;
  /** Pans to an entity if it is out of view; `zoom` frames it closer too. */
  focus(id: string, zoom?: boolean): void;
  command(name: "home" | "in" | "out"): void;
  input(enabled: boolean): void;
  motion(reduced?: boolean): boolean;
  /** Undefined until the world is drawn. */
  inspect(): Record<string, unknown> | undefined;
  destroy(): void;
};
/** Mount the Atlas into the map surface, or null outside the native app
 * (a plain browser has no world to draw it). Data, selection and camera stay
 * with the caller. */
export function mountAtlas(parent: HTMLElement, handlers: AtlasHandlers = {}): AtlasWorld | null {
  return nativeWorldAvailable() ? mountNativeAtlas(parent, handlers) : null;
}
