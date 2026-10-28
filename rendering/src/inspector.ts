import { STATE_NAMES, type AtlasLayout, type Entity, type State } from "./world";
import type { AtlasWorld } from "./atlas";
const root = document.querySelector<HTMLDivElement>("#inspector")!;
const icons = {
  host: '<path d="m19 3 15 8v16l-15 8L4 27V11Z"/><path d="m12 18 5-5 8 7-6 7Z"/>',
  project:
    '<path d="m5 18 14-12 14 12v15H5Z"/><path d="M9 17h20v12H9Zm4 0v12m12-12v12"/>',
  workspace:
    '<path d="m5 16 14-9 14 9-4 3H9Z"/><path d="M9 19v12h20V19M16 31v-9h6v9"/>',
  agent:
    '<circle cx="19" cy="19" r="12"/><path d="M8 25 5 31m25-6 3 6M19 7V3m-6 18h12"/>',
};
const GLYPH: Partial<Record<State, string>> = {
  approval: "!",
  question: "?",
};
export const stateIcon = (state: State) =>
  `<span aria-hidden="true" class="state-icon state-${state}">${state === "done" ? '<svg viewBox="0 0 24 24"><path d="m12 1 3 7 8 4-8 3-3 8-3-8-8-3 8-4Z"/></svg>' : state === "failed" ? '<svg viewBox="0 0 24 24"><path d="m6 6 12 12M6 18 18 6"/></svg>' : (GLYPH[state] ?? "")}</span>`;
const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const models = (layout: AtlasLayout) => [
  ...new Map(layout.agents.map((a) => [a.modelName, a.model])).entries(),
];
const guide = (layout: AtlasLayout) =>
  `<div class="guide-left"><h2>A living atlas</h2><p class="guide-intro">Every place is a project.<br>Every little robot, an agent.</p><div class="hierarchy">${[
    ["host", "Host", "An island of projects"],
    ["project", "Project", "A distinctive landmark"],
    ["workspace", "Workspace", "A cottage on its own hex"],
    ["agent", "Agent", "A robot at its workspace"],
  ]
    .map(
      ([type, name, description]) =>
        `<span><svg viewBox="0 0 38 38" aria-hidden="true">${icons[type as keyof typeof icons]}</svg></span><div><strong>${name}</strong><small>${description}</small></div>`,
    )
    .join(
      "",
    )}</div></div><div class="guide-right"><h3>Agent states</h3><div class="states">${(Object.keys(STATE_NAMES) as State[]).map((state) => `<div class="state-row">${stateIcon(state)}<span>${STATE_NAMES[state]}</span></div>`).join("")}</div><h3 class="models-heading">Model colours</h3><div class="models">${models(
    layout,
  )
    .map(
      ([name, key]) =>
        `<div><span class="model-swatch ${key}"></span>${escape(name ?? "")}</div>`,
    )
    .join(
      "",
    )}</div><p class="preview-footnote">Select a robot to inspect it.<br>All activity in this study is illustrative.</p><label class="sample-picker">Inspect a sample agent<select id="agent-picker" aria-label="Inspect a sample agent"><option value="">Choose an agent…</option>${layout.agents.map((a) => `<option value="${escape(a.id)}">${escape(a.name)}</option>`).join("")}</select></label></div>`;
export function showGuide(layout: AtlasLayout): void {
  root.innerHTML = guide(layout);
}
export function showSelection(
  world: AtlasWorld,
  layout: AtlasLayout,
  entity: Entity | null,
  cycle: (id: string) => void,
): void {
  if (!entity) {
    showGuide(layout);
    return;
  }
  const project = layout.projects.find((p) => p.id === entity.project),
    host = layout.hosts.find((h) => h.id === entity.host);
  root.innerHTML = `<div class="selection-top"><span>${entity.kind[0]!.toUpperCase() + entity.kind.slice(1)}</span><button id="close-selection" aria-label="Close selection">Back to guide</button></div><div class="entity-hero"><img id="entity-art" src="${world.scene!.thumbnail(entity)}" alt=""/></div><h2 class="selected-title"></h2>${entity.state ? `<div class="status-caption">${stateIcon(entity.state)}<span>${STATE_NAMES[entity.state]}</span></div>` : ""}<dl class="entity-facts"></dl><div class="entity-actions"><button id="focus-selection">Focus on the map</button>${entity.kind === "agent" ? '<button id="cycle-state">Preview next state</button>' : ""}</div><hr class="selection-separator"/><div class="agent-index" aria-label="Sample agents"></div><p class="preview-footnote">Sample data for checking the rendering style. No prompts, approvals or other commands are sent to a daemon.</p>`;
  root.querySelector(".selected-title")!.textContent = entity.name;
  const facts = root.querySelector(".entity-facts")!;
  const rows = [
    ["Host", host?.name ?? entity.host],
    ...(project ? [["Project", project.name]] : []),
    ...(entity.modelName ? [["Model", entity.modelName]] : []),
  ];
  for (const [key, value] of rows) {
    const term = document.createElement("dt"),
      detail = document.createElement("dd");
    term.textContent = key!;
    detail.textContent = value!;
    facts.append(term, detail);
  }
  root
    .querySelector("#close-selection")!
    .addEventListener("click", () => world.select(null));
  root
    .querySelector("#focus-selection")!
    .addEventListener("click", () => world.focus(entity.id, true));
  root
    .querySelector("#cycle-state")
    ?.addEventListener("click", () => cycle(entity.id));
  const agentIndex = root.querySelector(".agent-index")!;
  for (const agent of layout.agents.filter((a) =>
    entity.project
      ? a.project === entity.project
      : entity.kind === "project"
        ? a.project === entity.id
        : a.host === entity.host,
  )) {
    const button = document.createElement("button");
    button.innerHTML = `<span class="model-swatch ${agent.model}"></span><span></span>`;
    button.querySelector("span:nth-child(2)")!.textContent = agent.name;
    button.addEventListener("click", () => {
      world.select(agent.id);
      world.focus(agent.id, true);
    });
    agentIndex.append(button);
  }
}
