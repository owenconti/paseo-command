import Phaser from "phaser";
import { AtlasScene, type ScreenPoint } from "./AtlasScene";
import { GalaxyScene } from "./galaxy/GalaxyScene";
import { renderDensity } from "./display";
import type { AtlasData, Entity } from "./world";
export type { AtlasData, Entity, ScreenPoint };
export { STATE_NAMES, STATE_TILE, MODEL_COLORS, modelColor, modelName } from "./world";
export { providerColor, providerOf } from "./galaxy/layout";
export type AtlasHandlers = {
  /** The user chose an entity on the map, or cleared the choice (Escape). */
  pick?: (entity: Entity | null) => void;
  hover?: (entity: Entity | null, at: ScreenPoint | null) => void;
  selection?: (entity: Entity | null) => void;
  zoom?: (zoom: number) => void;
  ready?: () => void;
  error?: (message: string) => void;
};
/** The worlds the app can show. Each draws the same fleet. */
export const WORLDS = { atlas: "Atlas", galaxy: "Galaxy" } as const;
export type WorldKind = keyof typeof WORLDS;
export type AtlasWorld = {
  kind: WorldKind;
  scene: AtlasScene | GalaxyScene;
  update(data: AtlasData): void;
  select(id: string | null): void;
  /** Pans to an entity if it is out of view; `zoom` frames it closer too. */
  focus(id: string, zoom?: boolean): void;
  command(name: "home" | "in" | "out"): void;
  input(enabled: boolean): void;
  motion(reduced?: boolean): boolean;
  /** Undefined until the scene has started. */
  inspect(): ReturnType<AtlasScene["inspect"] | GalaxyScene["inspect"]> | undefined;
  destroy(): void;
};
/** Mount a world into an element. Data, selection and camera stay with the caller. */
export function mountAtlas(
  parent: HTMLElement,
  handlers: AtlasHandlers = {},
  kind: WorldKind = "atlas",
): AtlasWorld {
  const scene = kind === "galaxy" ? new GalaxyScene() : new AtlasScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: kind === "galaxy" ? "#090605" : "#1d6884",
    width: Math.max(1, Math.round(parent.clientWidth * renderDensity())),
    height: Math.max(1, Math.round(parent.clientHeight * renderDensity())),
    scale: {
      mode: Phaser.Scale.NONE,
      zoom: 1 / renderDensity(),
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    render: {
      antialias: true,
      roundPixels: false,
      mipmapFilter: "LINEAR_MIPMAP_LINEAR",
    },
    scene: [scene],
    audio: { noAudio: true },
    banner: false,
    // Keys belong to the map only while it has focus; typing elsewhere never pans it.
    input: { activePointers: 2, keyboard: { target: parent } },
  });
  let ready = false;
  let data: AtlasData | null = null;
  // The layout follows the map's shape: tall maps stack hosts and islands vertically.
  const aspect = () =>
    parent.clientWidth && parent.clientHeight
      ? parent.clientWidth / parent.clientHeight
      : 1.6;
  const relayout = () => data && !destroyed && scene.setData(data, aspect());
  game.events.on("atlas:pick", (e: Entity | null) => handlers.pick?.(e));
  game.events.on("atlas:hover", (e: Entity | null, at: ScreenPoint | null) =>
    handlers.hover?.(e, at),
  );
  game.events.on("atlas:selection", (e: Entity | null) =>
    handlers.selection?.(e),
  );
  game.events.on("atlas:zoom", (z: number) => handlers.zoom?.(z));
  game.events.on("atlas:error", (m: string) => handlers.error?.(m));
  // The selection the caller last asked for; applied once the scene can draw it.
  let selection: string | null = null;
  let destroyed = false;
  game.events.once("atlas:ready", () => {
    if (destroyed) return;
    ready = true;
    syncCanvasSize();
    scene.select(selection);
    handlers.ready?.();
  });
  const syncCanvasSize = () => {
    if (!game.isBooted || !parent.clientWidth || !parent.clientHeight) return;
    const density = renderDensity();
    const width = Math.round(parent.clientWidth * density);
    const height = Math.round(parent.clientHeight * density);
    // Reassigning an unchanged canvas size resets WebGL's drawing buffer.
    if (
      game.canvas.width === width &&
      game.canvas.height === height &&
      game.scale.zoom === 1 / density
    )
      return;
    if (game.scale.zoom !== 1 / density) game.scale.setZoom(1 / density);
    game.scale.resize(width, height);
    game.canvas.style.width = `${parent.clientWidth}px`;
    game.canvas.style.height = `${parent.clientHeight}px`;
    game.scale.updateBounds();
    // Keep the GPU drawing context and camera viewport aligned after a density change.
    game.renderer.resize(width, height);
    if (scene.sys.isActive()) {
      scene.cameras.main.setSize(width, height);
      relayout();
      scene.fit();
    }
  };
  const resize = new ResizeObserver(syncCanvasSize);
  resize.observe(parent);
  window.addEventListener("resize", syncCanvasSize);
  // Surrounding layout can move the canvas without resizing it; pointer mapping
  // must use where it is now.
  const rebound = () => game.isBooted && game.scale.updateBounds();
  for (const type of ["pointerenter", "pointerdown", "wheel"])
    parent.addEventListener(type, rebound, { capture: true, passive: true });
  return {
    kind,
    scene,
    update: (next) => {
      data = next;
      relayout();
    },
    select: (id) => {
      selection = id;
      if (ready && !destroyed) scene.select(id);
    },
    focus: (id, zoom) => ready && !destroyed && scene.focus(id, zoom),
    command: (name) => ready && !destroyed && scene.command(name),
    input: (enabled) => ready && !destroyed && scene.setInput(enabled),
    motion: (reduced) => scene.motion(reduced),
    inspect: () => (ready && !destroyed ? scene.inspect() : undefined),
    destroy: () => {
      destroyed = true;
      ready = false;
      resize.disconnect();
      window.removeEventListener("resize", syncCanvasSize);
      for (const type of ["pointerenter", "pointerdown", "wheel"])
        parent.removeEventListener(type, rebound, { capture: true });
      game.destroy(true);
    },
  };
}
