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

/** The visible/focused chart's actions, only while they can do something. */
export function mermaidPalette(diagram: DiagramCommand | null): Command[] {
  if (!diagram) return [];
  const command = (
    action: MermaidAction,
    label: string,
    keywords: string,
  ): Command => ({
    id: `mermaid-${action}`,
    group: "Actions",
    page: "Command" as const,
    label,
    keywords: `mermaid chart diagram graph ${keywords}`,
    run: () => runAppCommand("mermaid-diagram", { id: diagram.id, action }),
  });
  const commands = [command("copy", "Copy Mermaid source", "code clipboard")];
  if (!diagram.ready) return commands;
  commands.push(
    command(
      "source",
      diagram.source ? "Show Mermaid diagram" : "Show Mermaid source",
      "code preview",
    ),
  );
  commands.push(
    command(
      diagram.expanded ? "close" : "expand",
      diagram.expanded ? "Close expanded diagram" : "Expand Mermaid diagram",
      "full screen large",
    ),
  );
  if (!diagram.source || diagram.expanded) {
    if (diagram.zoom < 4)
      commands.push(command("in", "Zoom in on Mermaid diagram", "larger"));
    if (diagram.zoom > 0.25)
      commands.push(command("out", "Zoom out of Mermaid diagram", "smaller"));
    commands.push(command("fit", "Reset Mermaid diagram zoom", "reset"));
  }
  return commands;
}
