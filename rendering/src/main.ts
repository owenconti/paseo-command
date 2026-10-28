import { mountAtlas } from "./atlas";
import { showGuide, showSelection } from "./inspector";
import { SAMPLE, STRUCTURE_SAMPLE } from "./sample";
import { layoutAtlas, type State } from "./world";
import "./style.css";
// The standalone study draws an explicitly illustrative fleet and never connects to a daemon.
const data = structuredClone(new URLSearchParams(location.search).has("structures") ? STRUCTURE_SAMPLE : SAMPLE);
let layout = layoutAtlas(data);
const parent = document.querySelector<HTMLDivElement>("#game")!;
const order: State[] = ["running", "idle", "done", "approval", "question", "failed"];
const cycle = (id: string) => {
  const agent = data.agents.find((a) => a.key === id);
  if (!agent) return;
  agent.state = order[(order.indexOf(agent.state) + 1) % order.length]!;
  layout = layoutAtlas(data);
  world.update(data);
  world.select(id);
};
// ?world=galaxy previews the Galaxy with the same sample fleet.
const kind = new URLSearchParams(location.search).get("world") === "galaxy" ? "galaxy" : "atlas";
const world = mountAtlas(parent, {
  pick: (entity) => world.select(entity?.id ?? null),
  selection: (entity) => showSelection(world, layout, entity, cycle),
  zoom: (zoom) => {
    document.querySelector("#zoom")!.textContent = `${Math.round(zoom * 100)}%`;
  },
  ready: () => {
    document.querySelector<HTMLElement>("#loading")!.hidden = true;
    document
      .querySelectorAll<HTMLButtonElement>("[data-command]")
      .forEach((button) =>
        button.addEventListener("click", () => {
          const command = button.dataset.command!;
          if (command === "home" || command === "in" || command === "out")
            world.command(command);
          else world.focus(command, true);
        }),
      );
    const button = document.querySelector<HTMLButtonElement>("#motion")!;
    button.setAttribute(
      "aria-pressed",
      String(matchMedia("(prefers-reduced-motion: reduce)").matches),
    );
    button.addEventListener("click", () => {
      const paused = world.motion();
      button.setAttribute("aria-pressed", String(paused));
      button.textContent = paused
        ? "Resume ambient motion"
        : "Pause ambient motion";
    });
  },
  error: (message) => {
    const node = document.querySelector<HTMLElement>("#loading")!;
    node.hidden = false;
    node.textContent = message;
  },
}, kind);
world.update(data);
showGuide(layout);
document.querySelector("#inspector")!.addEventListener("change", (event) => {
  const picker = event.target as HTMLSelectElement;
  if (picker.id === "agent-picker" && picker.value) world.select(picker.value);
});
window.addEventListener("pagehide", () => world.destroy(), { once: true });
// A small inspection surface for checking this rendering study without touching any daemon.
Object.assign(window, {
  atlasPreview: {
    inspect: () => world.inspect(),
    select: (id: string | null) => world.select(id),
    focus: (id: string) => world.focus(id, true),
    command: (name: "home" | "in" | "out") => world.command(name),
  },
});
