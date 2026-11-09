/** The embedding API for the Atlas world. The macOS app (`native/`) draws it
 * with SpriteKit under the page; this hands the page's map surface to it. */
import { mountNativeAtlas, nativeWorldAvailable, type MapStyle as AtlasStyle } from "./native/bridge";
import { mountNativeDungeon } from "./dungeon/bridge";
/** The map's styles: the Atlas's hex Islands and its Overworld (one world, switched in place),
 * and the Dungeon Board (a world of its own, mounted in their place). */
export type MapStyle = AtlasStyle | "dungeon";
import type { AtlasData, Entity } from "./world";
import type { MapFlag } from "./prStatus";
export type { AtlasData, Entity };
export { STATE_NAMES, STATE_TILE, MODEL_COLORS, MODEL_FAMILY, modelColor, modelName } from "./world";
export { nativeWorldAvailable };
/** Screen position in CSS pixels relative to the map surface: the top centre of what a card is about, and its
 * bottom edge (`bottom`, when the world says), where the card goes when there's no room above it. */
export type ScreenPoint = { x: number; y: number; bottom?: number };
export type AtlasHandlers = {
  /** The user chose an entity on the map, or cleared the choice (Escape). */
  pick?: (entity: Entity | null) => void;
  /** `flag` is the hovered workspace's medallion under the pointer, if any. */
  hover?: (entity: Entity | null, at: ScreenPoint | null, flag?: MapFlag) => void;
  selection?: (entity: Entity | null) => void;
  zoom?: (zoom: number) => void;
  ready?: () => void;
  error?: (message: string) => void;
  /** The Dungeon Board's vault niches: a card to show under the pointer (null to hide it), and a link to open on a click
   * (a pull request's or an issue's, through the app's own link routing). */
  card?: (card: { title: string; detail: string; lines: string[] } | null, at: ScreenPoint | null) => void;
  open?: (url: string) => void;
  /** The page's own account for the app's diagnostics (the live connection's state). */
  status?: () => Record<string, unknown>;
};
export type AtlasWorld = {
  /** Which world it is: the Atlas (Islands and Overworld), or the Dungeon Board. */
  kind: "atlas" | "dungeon";
  /** Drawn by the native macOS app (SpriteKit), behind a transparent page. */
  native: true;
  update(data: AtlasData): void;
  select(id: string | null): void;
  /** Pans to an entity if it is out of view; `zoom` frames it closer too. */
  focus(id: string, zoom?: boolean): void;
  /** The Dungeon Board's conversation (its dialogue box): frame the robot `id` (an entity id, as select takes) above a box
   * covering the map's bottom `inset` CSS px, or with null end it and put the camera back where it was. The other worlds ignore it. */
  talk(id: string | null, inset?: number): void;
  /** Draw the hex islands or the Overworld (the Atlas's styles; the Dungeon Board has one). */
  style(style: AtlasStyle): void;
  command(name: "home" | "in" | "out"): void;
  /** The workspace whose daemon terminals the app's terminal drawer shows
   * (the selected one, or the selected agent's), or null. */
  workspace(info: { id: string; host: string; name: string } | null): void;
  input(enabled: boolean): void;
  motion(reduced?: boolean): boolean;
  /** Undefined until the world is drawn. */
  inspect(): Record<string, unknown> | undefined;
  destroy(): void;
};
/** Mount the Atlas into the map surface, or null outside the native app
 * (a plain browser has no world to draw it). Data, selection and camera stay
 * with the caller. */
export function mountAtlas(parent: HTMLElement, handlers: AtlasHandlers = {}, style: MapStyle = "islands"): AtlasWorld | null {
  if (!nativeWorldAvailable()) return null;
  if (style === "dungeon") return mountNativeDungeon(parent, handlers);
  return mountNativeAtlas(parent, handlers, style);
}
