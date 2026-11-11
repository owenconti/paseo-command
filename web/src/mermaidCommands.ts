import { useEffect, useSyncExternalStore } from "react";
import type { Command } from "./palette";
import { onAppCommand, runAppCommand } from "./appCommands";

export type MermaidAction =
  "source" | "copy" | "expand" | "close" | "in" | "out" | "fit";
export type DiagramCommand = {
  id: string;
  root: HTMLElement;
  visible: boolean;
  ready: boolean;
  source: boolean;
  expanded: boolean;
  zoom: number;
  /** A visual reply's page (src/visual) shares this registry; its entries are named for it. */
  page?: boolean;
  run: (action: MermaidAction) => void;
};
const diagrams = new Map<string, DiagramCommand>();
const listeners = new Set<() => void>();
let active = "";
let shown: DiagramCommand | null = null;
function publish() {
  const available = [...diagrams.values()].filter(
    (d) =>
      d.expanded ||
      (d.visible &&
        (d.root.checkVisibility?.() ?? d.root.getClientRects().length > 0)),
  );
  const next =
    available.find((d) => d.expanded) ??
    available.find((d) => d.id === active) ??
    available.at(-1) ??
    null;
  if (shown === next) return;
  shown = next;
  for (const listener of listeners) listener();
}
export function registerDiagram(diagram: DiagramCommand) {
  diagrams.set(diagram.id, diagram);
  publish();
}
export function removeDiagram(id: string) {
  diagrams.delete(id);
  publish();
}
export function activateDiagram(id: string) {
  active = id;
  publish();
}
export function useMermaidCommands() {
  useEffect(
    () =>
      onAppCommand("mermaid-diagram", (arg) => {
        const ask = arg as { id?: string; action?: MermaidAction } | undefined;
        if (ask?.id && ask.action) diagrams.get(ask.id)?.run(ask.action);
      }),
    [],
  );
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => shown,
    () => null,
  );
}

/** The visible/focused chart's (or visual reply's page's) actions, only while they can do something. */
export function mermaidPalette(diagram: DiagramCommand | null): Command[] {
  if (!diagram) return [];
  const page = !!diagram.page;
  const command = (
    action: MermaidAction,
    label: string,
    keywords: string,
  ): Command => ({
    id: `${page ? "visual" : "mermaid"}-${action}`,
    group: "Actions",
    page: "Command" as const,
    label,
    keywords: `${page ? "visual reply html page render chart mockup" : "mermaid chart diagram graph"} ${keywords}`,
    run: () => runAppCommand("mermaid-diagram", { id: diagram.id, action }),
  });
  const commands = [
    command(
      "copy",
      page ? "Copy the visual reply’s HTML" : "Copy Mermaid source",
      "code clipboard source",
    ),
  ];
  if (!diagram.ready) return commands;
  commands.push(
    command(
      "source",
      diagram.source
        ? page
          ? "Show the visual reply’s page"
          : "Show Mermaid diagram"
        : page
          ? "Show the visual reply’s HTML"
          : "Show Mermaid source",
      "code preview",
    ),
  );
  commands.push(
    command(
      diagram.expanded ? "close" : "expand",
      diagram.expanded
        ? page
          ? "Close the expanded visual reply"
          : "Close expanded diagram"
        : page
          ? "Expand the visual reply"
          : "Expand Mermaid diagram",
      "full screen large",
    ),
  );
  if (!diagram.source || diagram.expanded) {
    const noun = page ? "the visual reply" : "Mermaid diagram";
    if (diagram.zoom < 4)
      commands.push(command("in", `Zoom in on ${noun}`, "larger"));
    if (diagram.zoom > 0.25)
      commands.push(command("out", `Zoom out of ${noun}`, "smaller"));
    commands.push(
      command(
        "fit",
        page ? "Reset the visual reply’s zoom" : "Reset Mermaid diagram zoom",
        "reset",
      ),
    );
  }
  return commands;
}
