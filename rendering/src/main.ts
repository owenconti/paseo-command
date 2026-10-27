import Phaser from "phaser";
import { AtlasScene } from "./AtlasScene";
import { showGuide, showSelection } from "./inspector";
import type { Entity } from "./world";
import "./style.css";
import { renderDensity } from "./display";
showGuide();
document.querySelector("#inspector")!.addEventListener("change", (event) => {
  const picker = event.target as HTMLSelectElement;
  if (picker.id === "agent-picker" && picker.value) scene.select(picker.value);
});
const scene = new AtlasScene();
const parent = document.querySelector<HTMLDivElement>("#game")!;
const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  backgroundColor: "#72bfd0",
  width: Math.round(parent.clientWidth * renderDensity()),
  height: Math.round(parent.clientHeight * renderDensity()),
  scale: {
    mode: Phaser.Scale.NONE,
    zoom: 1 / renderDensity(),
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: true,
    roundPixels: false,
    mipmapFilter: "LINEAR_MIPMAP_LINEAR",
  },
  scene: [scene],
  audio: { noAudio: true },
  banner: false,
  input: { activePointers: 2 },
});
game.events.on("atlas:selection", (entity: Entity | null) =>
  showSelection(scene, entity),
);
game.events.on("atlas:zoom", (zoom: number) => {
  document.querySelector("#zoom")!.textContent = `${Math.round(zoom * 100)}%`;
});
game.events.once("atlas:ready", () => {
  document.querySelector<HTMLElement>("#loading")!.hidden = true;
  document
    .querySelectorAll<HTMLButtonElement>("[data-command]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        scene.command(button.dataset.command!),
      ),
    );
  const button = document.querySelector<HTMLButtonElement>("#motion")!;
  button.setAttribute(
    "aria-pressed",
    String(matchMedia("(prefers-reduced-motion: reduce)").matches),
  );
  button.addEventListener("click", () => {
    const paused = scene.motion();
    button.setAttribute("aria-pressed", String(paused));
    button.textContent = paused
      ? "Resume ambient motion"
      : "Pause ambient motion";
  });
});
game.events.on("atlas:error", (message: string) => {
  const node = document.querySelector<HTMLElement>("#loading")!;
  node.hidden = false;
  node.textContent = message;
});
const syncCanvasSize = () => {
  if (!game.isBooted) return;
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
    scene.fit();
  }
};
const resize = new ResizeObserver(syncCanvasSize);
resize.observe(parent);
window.addEventListener("resize", syncCanvasSize);
window.addEventListener(
  "pagehide",
  () => {
    resize.disconnect();
    window.removeEventListener("resize", syncCanvasSize);
    game.destroy(true);
  },
  { once: true },
);
// A small inspection surface for checking this rendering study without touching any daemon.
Object.assign(window, {
  atlasPreview: {
    inspect: () => scene.inspect(),
    select: (id: string | null) => scene.select(id),
    focus: (id: string) => scene.focus(id),
    command: (name: string) => scene.command(name),
  },
});
